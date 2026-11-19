import { Op, Transaction } from 'sequelize';
import { LeaveBalance, Membership, User, sequelize } from '../../database';
import { AppError } from '../../utils/errors';
import { generateUuid } from '../../utils/crypto';
import { recordAuditEvent, type AuditContext } from '../screenshots/audit.service';
import type { Organization as OrganizationModel } from '../organizations/organization.model';
import type { LeaveBalance as LeaveBalanceModel } from './leaveBalance.model';
import {
  applyAdjustmentInTransaction,
  availableOf,
  ensureBalance,
  inRolledBackTransaction,
  loadLeaveTypeWithPolicy,
  withTransactionRetry,
} from './leaveBalance.service';
import { balancePeriodFor, localDate, roundUnits, toUnits } from './leaveCalendar';
import type { LeaveCreditAssignmentInput } from './leave.schemas';

type CreditTarget = {
  employeeId: string;
  employeeName: string;
  employeeEmail: string;
};

type FailedTarget = CreditTarget & {
  message: string;
  code: string;
};

export type CreditAssignmentOutcome = {
  employeeId: string;
  employeeName: string;
  leaveTypeId: string;
  leaveTypeName: string;
  mode: 'ADD' | 'SET';
  amount: number;
  unchanged: boolean;
  assignedBefore: number;
  assignedAfter: number;
  used: number;
  pending: number;
  availableBefore: number;
  availableAfter: number;
  periodStart: string;
  periodEnd: string;
};

function assignedOf(balance: LeaveBalanceModel): number {
  return roundUnits(
    toUnits(balance.entitledBalance) +
      toUnits(balance.accruedBalance) +
      toUnits(balance.adjustmentBalance) +
      toUnits(balance.carriedForwardBalance),
  );
}

function describeError(error: unknown): { message: string; code: string } {
  if (error instanceof AppError) return { message: error.message, code: error.code };
  return { message: 'Unexpected error', code: 'INTERNAL_ERROR' };
}

async function resolveTargets(
  organizationId: string,
  input: LeaveCreditAssignmentInput,
): Promise<{ targets: CreditTarget[]; failures: FailedTarget[] }> {
  if (input.allActive) {
    const memberships = await Membership.findAll({
      where: { organizationId, status: 'ACTIVE' },
      include: [
        {
          model: User,
          as: 'user',
          required: true,
          where: { status: 'ACTIVE' },
          attributes: ['id', 'name', 'email'],
        },
      ],
      order: [['createdAt', 'ASC']],
    });
    return {
      targets: memberships.map((membership) => ({
        employeeId: membership.userId,
        employeeName: membership.user?.name ?? membership.userId,
        employeeEmail: membership.user?.email ?? '',
      })),
      failures: [],
    };
  }

  const requestedIds = input.employeeIds ?? [];
  const memberships = await Membership.findAll({
    where: { organizationId, userId: { [Op.in]: requestedIds } },
    include: [
      {
        model: User,
        as: 'user',
        required: false,
        attributes: ['id', 'name', 'email', 'status'],
      },
    ],
  });
  const byEmployeeId = new Map(memberships.map((membership) => [membership.userId, membership]));

  const targets: CreditTarget[] = [];
  const failures: FailedTarget[] = [];
  for (const employeeId of requestedIds) {
    const membership = byEmployeeId.get(employeeId);
    const employee = membership
      ? {
          employeeId,
          employeeName: membership.user?.name ?? employeeId,
          employeeEmail: membership.user?.email ?? '',
        }
      : { employeeId, employeeName: employeeId, employeeEmail: '' };

    if (!membership) {
      failures.push({
        ...employee,
        message: 'Employee is not a member of this organization',
        code: 'EMPLOYEE_NOT_FOUND',
      });
      continue;
    }
    if (membership.status !== 'ACTIVE' || membership.user?.status !== 'ACTIVE') {
      failures.push({
        ...employee,
        message: 'This employee is not active',
        code: 'EMPLOYEE_INACTIVE',
      });
      continue;
    }
    targets.push(employee);
  }

  return { targets, failures };
}

async function assignOneInTransaction(options: {
  organization: OrganizationModel;
  target: CreditTarget;
  actorUserId: string;
  input: LeaveCreditAssignmentInput;
  context?: AuditContext;
  transaction: Transaction;
  now: Date;
  audit: boolean;
  batchId?: string | null;
}): Promise<CreditAssignmentOutcome> {
  const { organization, target, actorUserId, input, context, transaction, audit } = options;
  const now = options.now;

  const { type, policy } = await loadLeaveTypeWithPolicy(organization.id, input.leaveTypeId, {
    transaction,
  });
  if (!type.requiresBalance) {
    throw AppError.unprocessable(
      'This leave type does not use credits',
      'LEAVE_BALANCE_NOT_APPLICABLE',
    );
  }
  if (!policy.isActive) {
    throw AppError.conflict('The leave policy is inactive', 'LEAVE_POLICY_INACTIVE');
  }

  const today = localDate(now, organization.timezone);
  const anchor = input.effectiveDate ?? today;
  const period = balancePeriodFor(anchor, policy, organization.timezone);
  const currentPeriod = balancePeriodFor(today, policy, organization.timezone);

  let balance = await LeaveBalance.findOne({
    where: {
      organizationId: organization.id,
      employeeId: target.employeeId,
      leaveTypeId: type.id,
      periodStart: period.periodStart,
    },
    transaction,
    lock: Transaction.LOCK.UPDATE,
  });

  if (!balance) {
    // Only the current period may be created on demand. Credits for another
    // period need that period initialized first so we never mint retroactive
    // automatic credits from a single assignment.
    if (period.periodStart !== currentPeriod.periodStart) {
      throw AppError.conflict(
        'No balance exists for that period yet. Choose a date in the current period or initialize the balance first.',
        'LEAVE_BALANCE_NOT_FOUND',
      );
    }
    balance = await ensureBalance({
      organization,
      employeeId: target.employeeId,
      type,
      policy,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      transaction,
      now,
    });
  }

  const assignedBefore = assignedOf(balance);
  const used = toUnits(balance.approvedConsumed);
  const pending = toUnits(balance.pendingReserved);
  const availableBefore = availableOf(balance);
  const amount =
    input.mode === 'SET' ? roundUnits(input.credits - assignedBefore) : roundUnits(input.credits);

  if (amount === 0) {
    return {
      employeeId: target.employeeId,
      employeeName: target.employeeName,
      leaveTypeId: type.id,
      leaveTypeName: type.name,
      mode: input.mode,
      amount: 0,
      unchanged: true,
      assignedBefore,
      assignedAfter: assignedBefore,
      used,
      pending,
      availableBefore,
      availableAfter: availableBefore,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
    };
  }

  const outcome = await applyAdjustmentInTransaction({
    organization,
    employeeId: target.employeeId,
    actorUserId,
    input: {
      leaveTypeId: type.id,
      amount,
      reason: input.reason,
      periodStart: period.periodStart,
    },
    transaction,
    now,
    audit: false,
    batchId: options.batchId ?? null,
    auditMetadata: {
      creditAssignment: true,
      mode: input.mode,
      credits: input.credits,
      assignedBefore,
      used,
      pending,
    },
  });

  if (audit) {
    await recordAuditEvent(
      {
        organizationId: organization.id,
        actorUserId,
        targetEmployeeId: target.employeeId,
        action: input.mode === 'ADD' ? 'LEAVE_CREDITS_ADDED' : 'LEAVE_CREDITS_SET',
        entityType: 'LEAVE_BALANCE',
        entityId: outcome.balanceId,
        metadata: {
          leaveTypeId: type.id,
          leaveTypeName: type.name,
          mode: input.mode,
          credits: input.credits,
          amount,
          assignedBefore,
          assignedAfter: outcome.assignedAfter,
          used,
          pending,
          availableBefore,
          availableAfter: outcome.availableAfter,
          periodStart: outcome.periodStart,
          periodEnd: outcome.periodEnd,
          reason: input.reason,
          scope: input.allActive ? 'ALL_ACTIVE' : 'SELECTED',
          ...(options.batchId ? { batchId: options.batchId, bulk: true } : {}),
        },
      },
      { transaction, context },
    );
  }

  return {
    employeeId: target.employeeId,
    employeeName: target.employeeName,
    leaveTypeId: type.id,
    leaveTypeName: type.name,
    mode: input.mode,
    amount,
    unchanged: false,
    assignedBefore,
    assignedAfter: outcome.assignedAfter,
    used,
    pending,
    availableBefore,
    availableAfter: outcome.availableAfter,
    periodStart: outcome.periodStart,
    periodEnd: outcome.periodEnd,
  };
}

export async function previewLeaveCreditAssignment(options: {
  organization: OrganizationModel;
  actorUserId: string;
  input: LeaveCreditAssignmentInput;
}) {
  const { organization, actorUserId, input } = options;
  const { type, policy } = await loadLeaveTypeWithPolicy(organization.id, input.leaveTypeId);
  if (!type.requiresBalance) {
    throw AppError.unprocessable(
      'This leave type does not use credits',
      'LEAVE_BALANCE_NOT_APPLICABLE',
    );
  }
  if (!policy.isActive) {
    throw AppError.conflict('The leave policy is inactive', 'LEAVE_POLICY_INACTIVE');
  }

  const now = new Date();
  const period = balancePeriodFor(
    input.effectiveDate ?? localDate(now, organization.timezone),
    policy,
    organization.timezone,
  );
  const { targets, failures } = await resolveTargets(organization.id, input);

  const items: Array<
    | ({ employeeId: string; employeeName: string; ok: true } & CreditAssignmentOutcome)
    | ({ employeeId: string; employeeName: string; ok: false } & {
        message: string;
        code: string;
      })
  > = failures.map((failure) => ({
    employeeId: failure.employeeId,
    employeeName: failure.employeeName,
    ok: false,
    message: failure.message,
    code: failure.code,
  }));

  for (const target of targets) {
    try {
      const outcome = await withTransactionRetry(() =>
        inRolledBackTransaction((transaction) =>
          assignOneInTransaction({
            organization,
            target,
            actorUserId,
            input,
            transaction,
            now,
            audit: false,
          }),
        ),
      );
      items.push({ ok: true, ...outcome });
    } catch (error) {
      items.push({
        employeeId: target.employeeId,
        employeeName: target.employeeName,
        ok: false,
        ...describeError(error),
      });
    }
  }

  return {
    mode: input.mode,
    scope: input.allActive ? 'ALL_ACTIVE' : 'SELECTED',
    leaveType: { id: type.id, name: type.name },
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    summary: {
      selected: targets.length + failures.length,
      previewed: items.filter((item) => item.ok && !item.unchanged).length,
      unchanged: items.filter((item) => item.ok && item.unchanged).length,
      failed: items.filter((item) => !item.ok).length,
    },
    items,
  };
}

export async function assignLeaveCredits(options: {
  organization: OrganizationModel;
  actorUserId: string;
  input: LeaveCreditAssignmentInput;
  context?: AuditContext;
}) {
  const { organization, actorUserId, input, context } = options;
  const { type, policy } = await loadLeaveTypeWithPolicy(organization.id, input.leaveTypeId);
  if (!type.requiresBalance) {
    throw AppError.unprocessable(
      'This leave type does not use credits',
      'LEAVE_BALANCE_NOT_APPLICABLE',
    );
  }
  if (!policy.isActive) {
    throw AppError.conflict('The leave policy is inactive', 'LEAVE_POLICY_INACTIVE');
  }

  const now = new Date();
  const { targets, failures } = await resolveTargets(organization.id, input);
  const batchId = generateUuid();

  const items: Array<
    | ({
        employeeId: string;
        employeeName: string;
        ok: true;
        periodStart: string;
        periodEnd: string;
        assignedAfter: number;
        availableAfter: number;
      } & CreditAssignmentOutcome)
    | ({ employeeId: string; employeeName: string; ok: false } & {
        message: string;
        code: string;
      })
  > = failures.map((failure) => ({
    employeeId: failure.employeeId,
    employeeName: failure.employeeName,
    ok: false,
    message: failure.message,
    code: failure.code,
  }));

  for (const target of targets) {
    try {
      const outcome = await withTransactionRetry(() =>
        sequelize.transaction((transaction) =>
          assignOneInTransaction({
            organization,
            target,
            actorUserId,
            input,
            context,
            transaction,
            now,
            audit: true,
            batchId,
          }),
        ),
      );
      items.push({ ok: true, ...outcome });
    } catch (error) {
      items.push({
        employeeId: target.employeeId,
        employeeName: target.employeeName,
        ok: false,
        ...describeError(error),
      });
    }
  }

  return {
    batchId,
    mode: input.mode,
    scope: input.allActive ? 'ALL_ACTIVE' : 'SELECTED',
    leaveType: { id: type.id, name: type.name },
    summary: {
      requested: items.length,
      applied: items.filter((item) => item.ok && !item.unchanged).length,
      unchanged: items.filter((item) => item.ok && item.unchanged).length,
      failed: items.filter((item) => !item.ok).length,
    },
    items,
  };
}
