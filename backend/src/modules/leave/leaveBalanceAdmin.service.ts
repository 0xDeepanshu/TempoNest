import { Op, Transaction } from 'sequelize';
import {
  LeaveBalance,
  LeaveLedgerEntry,
  LeavePolicy,
  LeaveRequest,
  LeaveType,
  Membership,
  User,
  sequelize,
} from '../../database';
import { AppError } from '../../utils/errors';
import { generateUuid } from '../../utils/crypto';
import { paginate } from '../../utils/pagination';
import { recordAuditEvent, type AuditContext } from '../screenshots/audit.service';
import { toLeaveLedgerEntrySummary } from './leave.mapper';
import {
  accrualPeriodStart,
  balancePeriodFor,
  localDate,
  monthlyProrationRatio,
  roundUnits,
  scheduledAccrualDates,
  todayInTimezone,
  toUnits,
} from './leaveCalendar';
import {
  adjustLeaveBalance,
  ensureBalance,
  loadLeaveTypeWithPolicy,
  previewLeaveBalanceAdjustment,
  withTransactionRetry,
} from './leaveBalance.service';
import type { Organization as OrganizationModel } from '../organizations/organization.model';
import type { LeaveBalance as LeaveBalanceModel } from './leaveBalance.model';
import type { LeaveLedgerEntry as LeaveLedgerEntryModel } from './leaveLedgerEntry.model';
import type { LeavePolicy as LeavePolicyModel } from './leavePolicy.model';
import type { LeaveType as LeaveTypeModel } from './leaveType.model';
import type {
  BulkLeaveAdjustmentConfirmInput,
  BulkLeaveAdjustmentInput,
  LeaveAccrualPreviewQuery,
  LeaveAdjustmentInput,
  LeaveBalanceBackfillInput,
  LeaveBalanceBackfillQuery,
  LeaveBalanceReconciliationQuery,
  LeaveBalanceRepairInput,
  LeaveLedgerQuery,
} from './leave.schemas';

const BALANCE_FIELDS = [
  'entitledBalance',
  'accruedBalance',
  'adjustmentBalance',
  'carriedForwardBalance',
  'approvedConsumed',
  'pendingReserved',
  'availableBalance',
] as const;

function isZeroBalance(balance: LeaveBalanceModel): boolean {
  return BALANCE_FIELDS.every((field) => toUnits(balance[field]) === 0);
}

function policySnapshot(policy: LeavePolicyModel) {
  return {
    initialEntitlement: toUnits(policy.initialEntitlement),
    accrualFrequency: policy.accrualFrequency,
    accrualAmount: toUnits(policy.accrualAmount),
    accrualDayOfMonth: policy.accrualDayOfMonth,
    accrualEffectiveFrom: policy.accrualEffectiveFrom,
    prorateAccrual: policy.prorateAccrual,
    balancePeriodStartMonth: policy.balancePeriodStartMonth,
    balancePeriodStartDay: policy.balancePeriodStartDay,
    carryForwardAllowance: toUnits(policy.carryForwardAllowance),
    maxBalance: policy.maxBalance === null ? null : toUnits(policy.maxBalance),
    prorateInitialEntitlement: policy.prorateInitialEntitlement,
    isActive: policy.isActive,
  };
}

function errorDetails(error: unknown): { message: string; code: string } {
  if (error instanceof AppError) return { message: error.message, code: error.code };
  return { message: 'Unexpected error', code: 'INTERNAL_ERROR' };
}

type BackfillCandidate = {
  employeeId: string;
  employeeName: string;
  employeeEmail: string;
  type: LeaveTypeModel;
  policy: LeavePolicyModel;
  periodStart: string;
  periodEnd: string;
  balanceId: string | null;
};

async function loadBackfillCandidates(options: {
  organization: OrganizationModel;
  query: LeaveBalanceBackfillQuery | LeaveBalanceBackfillInput;
}): Promise<{
  asOf: string;
  timezone: string;
  candidates: BackfillCandidate[];
  configuredTypes: Array<{
    id: string;
    name: string;
    periodStart: string;
    periodEnd: string;
    policy: ReturnType<typeof policySnapshot>;
  }>;
  unconfiguredTypes: Array<{ id: string; name: string; reason: string }>;
}> {
  const { organization, query } = options;
  const employeeFilter =
    'employeeIds' in query && query.employeeIds?.length
      ? { userId: { [Op.in]: query.employeeIds } }
      : 'employeeId' in query && query.employeeId
        ? { userId: query.employeeId }
        : {};
  const typeFilter = (() => {
    if ('leaveTypeIds' in query && query.leaveTypeIds?.length) {
      return { id: { [Op.in]: query.leaveTypeIds } };
    }
    if ('leaveTypeId' in query && query.leaveTypeId) return { id: query.leaveTypeId };
    return {};
  })();

  const [memberships, types] = await Promise.all([
    Membership.findAll({
      where: {
        organizationId: organization.id,
        status: 'ACTIVE',
        ...employeeFilter,
      },
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
    }),
    LeaveType.findAll({
      where: {
        organizationId: organization.id,
        isActive: true,
        requiresBalance: true,
        ...typeFilter,
      },
      include: [{ model: LeavePolicy, as: 'policy', required: false }],
      order: [['name', 'ASC']],
    }),
  ]);

  const asOf = query.periodStart ?? todayInTimezone(organization.timezone);
  const configuredTypes: Array<{
    id: string;
    name: string;
    periodStart: string;
    periodEnd: string;
    policy: ReturnType<typeof policySnapshot>;
  }> = [];
  const unconfiguredTypes: Array<{ id: string; name: string; reason: string }> = [];
  const candidates: BackfillCandidate[] = [];

  for (const type of types) {
    const policy = type.policy;
    if (!policy) {
      unconfiguredTypes.push({ id: type.id, name: type.name, reason: 'NO_POLICY' });
      continue;
    }
    if (!policy.isActive) {
      unconfiguredTypes.push({ id: type.id, name: type.name, reason: 'INACTIVE_POLICY' });
      continue;
    }
    const period = balancePeriodFor(asOf, policy, organization.timezone);
    configuredTypes.push({
      id: type.id,
      name: type.name,
      ...period,
      policy: policySnapshot(policy),
    });
  }

  const periodStarts = [...new Set(configuredTypes.map((type) => type.periodStart))];
  const existing =
    memberships.length === 0 || configuredTypes.length === 0
      ? []
      : await LeaveBalance.findAll({
          where: {
            organizationId: organization.id,
            employeeId: { [Op.in]: memberships.map((membership) => membership.userId) },
            leaveTypeId: { [Op.in]: configuredTypes.map((type) => type.id) },
            periodStart: { [Op.in]: periodStarts },
          },
          attributes: ['id', 'employeeId', 'leaveTypeId', 'periodStart'],
        });
  const existingByKey = new Map(
    existing.map((balance) => [
      `${balance.employeeId}:${balance.leaveTypeId}:${balance.periodStart}`,
      balance.id,
    ]),
  );

  for (const membership of memberships) {
    for (const type of types) {
      const policy = type.policy;
      if (!policy || !policy.isActive) continue;
      const period = balancePeriodFor(asOf, policy, organization.timezone);
      candidates.push({
        employeeId: membership.userId,
        employeeName: membership.user?.name ?? membership.userId,
        employeeEmail: membership.user?.email ?? '',
        type,
        policy,
        ...period,
        balanceId:
          existingByKey.get(`${membership.userId}:${type.id}:${period.periodStart}`) ?? null,
      });
    }
  }

  return {
    asOf,
    timezone: organization.timezone,
    candidates,
    configuredTypes,
    unconfiguredTypes,
  };
}

export async function previewLeaveBalanceBackfill(options: {
  organization: OrganizationModel;
  query: LeaveBalanceBackfillQuery;
  maxItems?: number;
}) {
  const plan = await loadBackfillCandidates({
    organization: options.organization,
    query: options.query,
  });
  const maxItems = options.maxItems ?? 2000;
  const missing = plan.candidates.filter((candidate) => !candidate.balanceId);

  return {
    asOf: plan.asOf,
    timezone: plan.timezone,
    summary: {
      employees: new Set(plan.candidates.map((candidate) => candidate.employeeId)).size,
      leaveTypes: plan.configuredTypes.length,
      candidates: plan.candidates.length,
      missing: missing.length,
      existing: plan.candidates.length - missing.length,
      unconfiguredTypes: plan.unconfiguredTypes.length,
    },
    types: plan.configuredTypes,
    unconfiguredTypes: plan.unconfiguredTypes,
    items: plan.candidates.slice(0, maxItems).map((candidate) => ({
      employee: {
        id: candidate.employeeId,
        name: candidate.employeeName,
        email: candidate.employeeEmail,
      },
      leaveType: { id: candidate.type.id, name: candidate.type.name },
      periodStart: candidate.periodStart,
      periodEnd: candidate.periodEnd,
      balanceExists: Boolean(candidate.balanceId),
    })),
    truncated: plan.candidates.length > maxItems,
  };
}

type BackfillEmployeeResult = {
  employeeId: string;
  employeeName: string;
  employeeEmail: string;
  initialized: Array<{
    leaveTypeId: string;
    leaveTypeName: string;
    balanceId: string;
    availableBalance: number;
  }>;
  alreadyPresent: Array<{ leaveTypeId: string; leaveTypeName: string; balanceId: string }>;
  failed: Array<{ leaveTypeId: string; leaveTypeName: string; message: string; code: string }>;
};

export async function applyLeaveBalanceBackfill(options: {
  organization: OrganizationModel;
  actorUserId: string;
  input: LeaveBalanceBackfillInput;
  context?: AuditContext;
  now?: Date;
}) {
  const { organization, actorUserId, input, context } = options;
  const plan = await loadBackfillCandidates({ organization, query: input });
  const batchId = generateUuid();

  const results = new Map<string, BackfillEmployeeResult>();
  for (const candidate of plan.candidates) {
    const employee =
      results.get(candidate.employeeId) ??
      {
        employeeId: candidate.employeeId,
        employeeName: candidate.employeeName,
        employeeEmail: candidate.employeeEmail,
        initialized: [],
        alreadyPresent: [],
        failed: [],
      };
    results.set(candidate.employeeId, employee);

    if (candidate.balanceId) {
      employee.alreadyPresent.push({
        leaveTypeId: candidate.type.id,
        leaveTypeName: candidate.type.name,
        balanceId: candidate.balanceId,
      });
      continue;
    }

    try {
      const balance = await withTransactionRetry(() =>
        sequelize.transaction((transaction) =>
          initializeBalanceCandidate({
            organization,
            candidate,
            actorUserId,
            context,
            transaction,
            batchId,
            now: options.now,
          }),
        ),
      );
      employee.initialized.push({
        leaveTypeId: candidate.type.id,
        leaveTypeName: candidate.type.name,
        balanceId: balance.id,
        availableBalance: toUnits(balance.availableBalance),
      });
    } catch (error) {
      employee.failed.push({
        leaveTypeId: candidate.type.id,
        leaveTypeName: candidate.type.name,
        ...errorDetails(error),
      });
    }
  }

  const employees = [...results.values()];
  const initialized = employees.reduce((sum, employee) => sum + employee.initialized.length, 0);
  const alreadyPresent = employees.reduce(
    (sum, employee) => sum + employee.alreadyPresent.length,
    0,
  );
  const failed = employees.reduce((sum, employee) => sum + employee.failed.length, 0);

  return {
    batchId,
    asOf: plan.asOf,
    timezone: plan.timezone,
    summary: {
      employees: employees.length,
      initialized,
      alreadyPresent,
      failed,
      unconfiguredTypes: plan.unconfiguredTypes.length,
    },
    employees,
    unconfiguredTypes: plan.unconfiguredTypes,
  };
}

async function initializeBalanceCandidate(options: {
  organization: OrganizationModel;
  candidate: BackfillCandidate;
  actorUserId: string;
  context?: AuditContext;
  transaction: Transaction;
  batchId: string;
  now?: Date;
}): Promise<LeaveBalanceModel> {
  const { organization, candidate, actorUserId, context, transaction, batchId } = options;
  const { type, policy } = await loadLeaveTypeWithPolicy(
    organization.id,
    candidate.type.id,
    { transaction },
  );
  const balance = await ensureBalance({
    organization,
    employeeId: candidate.employeeId,
    type,
    policy,
    periodStart: candidate.periodStart,
    periodEnd: candidate.periodEnd,
    transaction,
    now: options.now,
  });

  await recordAuditEvent(
    {
      organizationId: organization.id,
      actorUserId,
      targetEmployeeId: candidate.employeeId,
      action: 'LEAVE_BALANCE_BACKFILLED',
      entityType: 'LEAVE_BALANCE',
      entityId: balance.id,
      metadata: {
        batchId,
        leaveTypeId: type.id,
        leaveTypeName: type.name,
        periodStart: balance.periodStart,
        periodEnd: balance.periodEnd,
        availableBalance: toUnits(balance.availableBalance),
        policy: policySnapshot(policy),
      },
    },
    { transaction, context },
  );

  return balance;
}

type ReconciliationBalance = {
  id: string;
  periodStart: string;
  periodEnd: string;
  canonical: boolean;
  zero: boolean;
  ledgerEntries: number;
  requests: number;
  safeToRemove: boolean;
  entitledBalance: number;
  accruedBalance: number;
  adjustmentBalance: number;
  carriedForwardBalance: number;
  approvedConsumed: number;
  pendingReserved: number;
  availableBalance: number;
};

type ReconciliationGroup = {
  employeeId: string;
  employeeName: string;
  employeeEmail: string;
  employeeActive: boolean;
  leaveTypeId: string;
  leaveTypeName: string;
  policy: ReturnType<typeof policySnapshot> | null;
  canonicalPeriodStart: string | null;
  issues: string[];
  balances: ReconciliationBalance[];
};

export async function getLeaveBalanceReconciliation(options: {
  organization: OrganizationModel;
  query: LeaveBalanceReconciliationQuery;
}) {
  const { organization, query } = options;
  const anchorDate = query.periodStart ?? todayInTimezone(organization.timezone);

  const [types, balances, memberships] = await Promise.all([
    LeaveType.findAll({
      where: { organizationId: organization.id },
      include: [{ model: LeavePolicy, as: 'policy', required: false }],
      order: [['name', 'ASC']],
    }),
    LeaveBalance.findAll({
      where: { organizationId: organization.id },
      include: [
        { model: User, as: 'employee', required: false, attributes: ['id', 'name', 'email'] },
      ],
      order: [
        ['employeeId', 'ASC'],
        ['leaveTypeId', 'ASC'],
        ['periodStart', 'ASC'],
      ],
    }),
    Membership.findAll({
      where: { organizationId: organization.id, status: 'ACTIVE' },
      attributes: ['userId'],
    }),
  ]);

  const activeEmployeeIds = new Set(memberships.map((membership) => membership.userId));
  const typeById = new Map(types.map((type) => [type.id, type]));
  const balanceIds = balances.map((balance) => balance.id);
  const ledgerCounts =
    balanceIds.length === 0
      ? new Map<string, number>()
      : new Map(
          (
            await LeaveLedgerEntry.findAll({
              where: { organizationId: organization.id, balanceId: { [Op.in]: balanceIds } },
              attributes: [
                'balanceId',
                [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
              ],
              group: ['balanceId'],
              raw: true,
            })
          ).map((row) => [
            String((row as unknown as { balanceId: string }).balanceId),
            Number((row as unknown as { count: string | number }).count),
          ]),
        );

  const grouped = new Map<string, LeaveBalanceModel[]>();
  for (const balance of balances) {
    const key = `${balance.employeeId}:${balance.leaveTypeId}`;
    const list = grouped.get(key) ?? [];
    list.push(balance);
    grouped.set(key, list);
  }

  const groups: ReconciliationGroup[] = [];
  for (const rows of grouped.values()) {
    const first = rows[0]!;
    const type = typeById.get(first.leaveTypeId) ?? null;
    const policy = type?.policy ?? null;
    const canonicalPeriodStart = policy
      ? balancePeriodFor(anchorDate, policy, organization.timezone).periodStart
      : null;
    const issues: string[] = [];
    if (!type) issues.push('MISSING_TYPE');
    if (!policy) issues.push('MISSING_POLICY');
    if (policy && !policy.isActive) issues.push('INACTIVE_POLICY');
    if (!activeEmployeeIds.has(first.employeeId)) issues.push('INACTIVE_EMPLOYEE');
    if (canonicalPeriodStart && !rows.some((row) => row.periodStart === canonicalPeriodStart)) {
      issues.push('NO_CURRENT_BALANCE');
    }

    const requestCounts =
      rows.length === 0
        ? new Map<string, number>()
        : new Map(
            (
              await LeaveRequest.findAll({
                where: {
                  organizationId: organization.id,
                  employeeId: first.employeeId,
                  leaveTypeId: first.leaveTypeId,
                  balancePeriodStart: { [Op.in]: rows.map((row) => row.periodStart) },
                },
                attributes: [
                  'balancePeriodStart',
                  [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
                ],
                group: ['balancePeriodStart'],
                raw: true,
              })
            ).map((row) => [
              String((row as unknown as { balancePeriodStart: string }).balancePeriodStart),
              Number((row as unknown as { count: string | number }).count),
            ]),
          );

    const reconciledRows: ReconciliationBalance[] = rows.map((balance) => {
      const canonical = balance.periodStart === canonicalPeriodStart;
      const zero = isZeroBalance(balance);
      const ledgerEntries = ledgerCounts.get(balance.id) ?? 0;
      const requests = requestCounts.get(balance.periodStart) ?? 0;
      const period = policy
        ? balancePeriodFor(balance.periodStart, policy, organization.timezone)
        : null;
      if (period && period.periodStart === balance.periodStart && period.periodEnd !== balance.periodEnd) {
        issues.push('PERIOD_END_MISMATCH');
      }
      return {
        id: balance.id,
        periodStart: balance.periodStart,
        periodEnd: balance.periodEnd,
        canonical,
        zero,
        ledgerEntries,
        requests,
        safeToRemove: !canonical && zero && ledgerEntries === 0 && requests === 0,
        entitledBalance: toUnits(balance.entitledBalance),
        accruedBalance: toUnits(balance.accruedBalance),
        adjustmentBalance: toUnits(balance.adjustmentBalance),
        carriedForwardBalance: toUnits(balance.carriedForwardBalance),
        approvedConsumed: toUnits(balance.approvedConsumed),
        pendingReserved: toUnits(balance.pendingReserved),
        availableBalance: toUnits(balance.availableBalance),
      };
    });

    if (reconciledRows.length > 1) issues.push('OVERLAPPING_PERIODS');
    if (issues.length === 0) continue;

    groups.push({
      employeeId: first.employeeId,
      employeeName: first.employee?.name ?? first.employeeId,
      employeeEmail: first.employee?.email ?? '',
      employeeActive: activeEmployeeIds.has(first.employeeId),
      leaveTypeId: first.leaveTypeId,
      leaveTypeName: type?.name ?? 'Unknown leave type',
      policy: policy ? policySnapshot(policy) : null,
      canonicalPeriodStart,
      issues: [...new Set(issues)],
      balances: reconciledRows,
    });
  }

  const unkeyedAccrualEntries = await LeaveLedgerEntry.count({
    where: {
      organizationId: organization.id,
      kind: 'ACCRUAL',
      accrualPeriod: null,
    },
  });
  const unconfiguredTypes = types
    .filter((type) => type.isActive && type.requiresBalance && (!type.policy || !type.policy.isActive))
    .map((type) => ({
      id: type.id,
      name: type.name,
      reason: type.policy ? 'INACTIVE_POLICY' : 'NO_POLICY',
    }));

  const allRows = groups.flatMap((group) => group.balances);

  return {
    generatedAt: new Date().toISOString(),
    asOf: anchorDate,
    timezone: organization.timezone,
    summary: {
      balancesScanned: balances.length,
      groupsScanned: grouped.size,
      groupsNeedingAttention: groups.length,
      overlappingGroups: groups.filter((group) => group.issues.includes('OVERLAPPING_PERIODS'))
        .length,
      currentMissingGroups: groups.filter((group) =>
        group.issues.includes('NO_CURRENT_BALANCE'),
      ).length,
      inactiveEmployeeGroups: groups.filter((group) =>
        group.issues.includes('INACTIVE_EMPLOYEE'),
      ).length,
      unconfiguredTypes: unconfiguredTypes.length,
      unkeyedAccrualEntries,
      safeToRemoveBalances: allRows.filter((row) => row.safeToRemove).length,
      manualReviewBalances: allRows.filter((row) => !row.safeToRemove).length,
    },
    unconfiguredTypes,
    groups,
  };
}

export async function repairLeaveBalanceReconciliation(options: {
  organization: OrganizationModel;
  actorUserId: string;
  input: LeaveBalanceRepairInput;
  context?: AuditContext;
}) {
  const { organization, actorUserId, input, context } = options;
  const batchId = generateUuid();
  const results: Array<{
    balanceId: string;
    repaired: boolean;
    message?: string;
    code?: string;
  }> = [];

  for (const balanceId of input.balanceIds) {
    try {
      await withTransactionRetry(() =>
        sequelize.transaction(async (transaction) => {
          const balance = await LeaveBalance.findOne({
            where: { id: balanceId, organizationId: organization.id },
            transaction,
            lock: Transaction.LOCK.UPDATE,
          });
          if (!balance) {
            throw AppError.notFound('Leave balance not found', 'LEAVE_BALANCE_NOT_FOUND');
          }

          const type = await LeaveType.findOne({
            where: { id: balance.leaveTypeId, organizationId: organization.id },
            include: [{ model: LeavePolicy, as: 'policy', required: false }],
            transaction,
          });
          if (!type?.policy) {
            throw AppError.conflict(
              'The leave type has no policy; this balance needs manual review',
              'LEAVE_BALANCE_MANUAL_REVIEW',
            );
          }

          const canonical = balancePeriodFor(
            todayInTimezone(organization.timezone),
            type.policy,
            organization.timezone,
          ).periodStart;
          if (balance.periodStart === canonical) {
            throw AppError.conflict(
              'This is the current balance period and cannot be removed',
              'LEAVE_BALANCE_CANONICAL',
            );
          }
          if (!isZeroBalance(balance)) {
            throw AppError.conflict(
              'Only empty balances without history can be removed',
              'LEAVE_BALANCE_HAS_VALUES',
            );
          }
          const ledgerEntries = await LeaveLedgerEntry.count({
            where: { balanceId: balance.id },
            transaction,
          });
          if (ledgerEntries > 0) {
            throw AppError.conflict(
              'This balance has ledger history and needs manual review',
              'LEAVE_BALANCE_HAS_LEDGER',
            );
          }
          const requestCount = await LeaveRequest.count({
            where: {
              organizationId: organization.id,
              employeeId: balance.employeeId,
              leaveTypeId: balance.leaveTypeId,
              balancePeriodStart: balance.periodStart,
            },
            transaction,
          });
          if (requestCount > 0) {
            throw AppError.conflict(
              'A leave request references this period; review it manually',
              'LEAVE_BALANCE_HAS_REQUESTS',
            );
          }

          const snapshot = {
            id: balance.id,
            employeeId: balance.employeeId,
            leaveTypeId: balance.leaveTypeId,
            periodStart: balance.periodStart,
            periodEnd: balance.periodEnd,
            ...Object.fromEntries(
              BALANCE_FIELDS.map((field) => [field, toUnits(balance[field])]),
            ),
            createdAt: balance.createdAt,
            updatedAt: balance.updatedAt,
          };
          await balance.destroy({ transaction });
          await recordAuditEvent(
            {
              organizationId: organization.id,
              actorUserId,
              targetEmployeeId: String(snapshot.employeeId),
              action: 'LEAVE_BALANCE_RECONCILED',
              entityType: 'LEAVE_BALANCE',
              entityId: String(snapshot.id),
              metadata: {
                batchId,
                reason: 'EMPTY_OVERLAP_REMOVED',
                canonicalPeriodStart: canonical,
                snapshot,
              },
            },
            { transaction, context },
          );
        }),
      );
      results.push({ balanceId, repaired: true });
    } catch (error) {
      results.push({ balanceId, repaired: false, ...errorDetails(error) });
    }
  }

  return {
    batchId,
    repaired: results.filter((result) => result.repaired).length,
    failed: results.filter((result) => !result.repaired).length,
    results,
  };
}

export async function previewBulkLeaveAdjustments(options: {
  organization: OrganizationModel;
  actorUserId: string;
  input: BulkLeaveAdjustmentInput;
  now?: Date;
}) {
  const { organization, actorUserId, input, now } = options;
  const adjustment: LeaveAdjustmentInput = {
    leaveTypeId: input.leaveTypeId,
    amount: input.amount,
    reason: input.reason,
    ...(input.periodStart ? { periodStart: input.periodStart } : {}),
  };

  const items: Array<
    | {
        employeeId: string;
        ok: true;
        preview: Awaited<ReturnType<typeof previewLeaveBalanceAdjustment>>;
      }
    | { employeeId: string; ok: false; message: string; code: string }
  > = [];

  for (const employeeId of input.employeeIds) {
    try {
      const preview = await previewLeaveBalanceAdjustment({
        organization,
        employeeId,
        actorUserId,
        input: adjustment,
        now,
      });
      items.push({ employeeId, ok: true, preview });
    } catch (error) {
      items.push({ employeeId, ok: false, ...errorDetails(error) });
    }
  }

  return {
    summary: {
      requested: input.employeeIds.length,
      previewed: items.filter((item) => item.ok).length,
      failed: items.filter((item) => !item.ok).length,
    },
    items,
  };
}

export async function bulkAdjustLeaveBalances(options: {
  organization: OrganizationModel;
  actorUserId: string;
  input: BulkLeaveAdjustmentConfirmInput;
  context?: AuditContext;
  now?: Date;
}) {
  const { organization, actorUserId, input, context, now } = options;
  const batchId = generateUuid();
  const adjustment: LeaveAdjustmentInput = {
    leaveTypeId: input.leaveTypeId,
    amount: input.amount,
    reason: input.reason,
    ...(input.periodStart ? { periodStart: input.periodStart } : {}),
  };

  const items: Array<
    | {
        employeeId: string;
        ok: true;
        balanceId: string;
        periodStart: string;
        periodEnd: string;
        availableBalance: number;
      }
    | { employeeId: string; ok: false; message: string; code: string }
  > = [];

  for (const employeeId of input.employeeIds) {
    try {
      const balance = await adjustLeaveBalance({
        organization,
        employeeId,
        actorUserId,
        input: adjustment,
        context,
        now,
        batchId,
      });
      items.push({
        employeeId,
        ok: true,
        balanceId: balance.id,
        periodStart: balance.periodStart,
        periodEnd: balance.periodEnd,
        availableBalance: balance.availableBalance,
      });
    } catch (error) {
      items.push({ employeeId, ok: false, ...errorDetails(error) });
    }
  }

  return {
    batchId,
    summary: {
      requested: input.employeeIds.length,
      adjusted: items.filter((item) => item.ok).length,
      failed: items.filter((item) => !item.ok).length,
    },
    items,
  };
}

export async function getLeaveAccrualPreview(options: {
  organization: OrganizationModel;
  query: LeaveAccrualPreviewQuery;
  maxItems?: number;
}) {
  const { organization, query } = options;
  const today = todayInTimezone(organization.timezone);
  const maxItems = options.maxItems ?? 200;

  const [memberships, types] = await Promise.all([
    Membership.findAll({
      where: {
        organizationId: organization.id,
        status: 'ACTIVE',
        ...(query.employeeId ? { userId: query.employeeId } : {}),
      },
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
    }),
    LeaveType.findAll({
      where: {
        organizationId: organization.id,
        isActive: true,
        requiresBalance: true,
        ...(query.leaveTypeId ? { id: query.leaveTypeId } : {}),
      },
      include: [
        {
          model: LeavePolicy,
          as: 'policy',
          required: true,
          where: { isActive: true },
        },
      ],
      order: [['name', 'ASC']],
    }),
  ]);

  const periods = new Map<string, { periodStart: string; periodEnd: string }>();
  for (const type of types) {
    const period = balancePeriodFor(today, type.policy!, organization.timezone);
    periods.set(type.id, period);
  }

  const balances =
    memberships.length === 0 || types.length === 0
      ? []
      : await LeaveBalance.findAll({
          where: {
            organizationId: organization.id,
            employeeId: { [Op.in]: memberships.map((membership) => membership.userId) },
            leaveTypeId: { [Op.in]: types.map((type) => type.id) },
            periodStart: { [Op.in]: [...new Set([...periods.values()].map((p) => p.periodStart))] },
          },
        });
  const balanceByKey = new Map(
    balances.map((balance) => [
      `${balance.employeeId}:${balance.leaveTypeId}:${balance.periodStart}`,
      balance,
    ]),
  );

  const candidateBuckets = new Set<string>();
  for (const type of types) {
    const period = periods.get(type.id)!;
    for (const date of scheduledAccrualDates({
      ...period,
      frequency: type.policy!.accrualFrequency,
      amount: toUnits(type.policy!.accrualAmount),
      accrualDayOfMonth: type.policy!.accrualDayOfMonth,
      effectiveFrom: type.policy!.accrualEffectiveFrom,
    })) {
      if (date >= today) candidateBuckets.add(accrualPeriodStart(date));
    }
  }
  const grantedBuckets = new Set<string>();
  if (candidateBuckets.size > 0 && memberships.length > 0) {
    const entries = await LeaveLedgerEntry.findAll({
      where: {
        organizationId: organization.id,
        employeeId: { [Op.in]: memberships.map((membership) => membership.userId) },
        kind: 'ACCRUAL',
        accrualPeriod: { [Op.in]: [...candidateBuckets] },
      },
      attributes: ['employeeId', 'leaveTypeId', 'accrualPeriod'],
    });
    for (const entry of entries) {
      grantedBuckets.add(
        `${entry.employeeId}:${entry.leaveTypeId}:${entry.accrualPeriod}`,
      );
    }
  }

  const items: Array<{
    employee: { id: string; name: string; email: string };
    leaveType: { id: string; name: string };
    balanceExists: boolean;
    periodStart: string;
    periodEnd: string;
    currentAvailable: number;
    nextAccrualDate: string | null;
    nextAccrualAmount: number;
    projectedAvailable: number | null;
    accrualDayOfMonth: number;
    accrualFrequency: string;
    accruedThisPeriod: number;
  }> = [];

  for (const membership of memberships) {
    for (const type of types) {
      const policy = type.policy!;
      const period = periods.get(type.id)!;
      const balance = balanceByKey.get(
        `${membership.userId}:${type.id}:${period.periodStart}`,
      );
      const joinDate = localDate(membership.createdAt, organization.timezone);
      const scheduled = scheduledAccrualDates({
        ...period,
        frequency: policy.accrualFrequency,
        amount: toUnits(policy.accrualAmount),
        accrualDayOfMonth: policy.accrualDayOfMonth,
        effectiveFrom: policy.accrualEffectiveFrom,
      });
      const nextDate =
        scheduled.find(
          (date) =>
            date >= today &&
            !grantedBuckets.has(
              `${membership.userId}:${type.id}:${accrualPeriodStart(date)}`,
            ),
        ) ?? null;
      const configured = toUnits(policy.accrualAmount);
      const amount =
        nextDate && policy.prorateAccrual
          ? roundUnits(configured * monthlyProrationRatio({ joinDate, trancheDate: nextDate }))
          : configured;
      const currentAvailable = balance ? toUnits(balance.availableBalance) : 0;
      let projected: number | null = null;
      if (nextDate) {
        const max = policy.maxBalance === null ? null : toUnits(policy.maxBalance);
        if (max === null) {
          projected = roundUnits(currentAvailable + amount);
        } else {
          const earned = balance
            ? toUnits(balance.entitledBalance) +
              toUnits(balance.accruedBalance) +
              toUnits(balance.adjustmentBalance) +
              toUnits(balance.carriedForwardBalance) -
              toUnits(balance.approvedConsumed)
            : 0;
          const credit = Math.max(0, Math.min(amount, roundUnits(max - earned)));
          projected = roundUnits(currentAvailable + credit);
        }
      }

      items.push({
        employee: {
          id: membership.userId,
          name: membership.user?.name ?? membership.userId,
          email: membership.user?.email ?? '',
        },
        leaveType: { id: type.id, name: type.name },
        balanceExists: Boolean(balance),
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        currentAvailable,
        nextAccrualDate: nextDate,
        nextAccrualAmount: nextDate ? amount : 0,
        projectedAvailable: projected,
        accrualDayOfMonth: policy.accrualDayOfMonth,
        accrualFrequency: policy.accrualFrequency,
        accruedThisPeriod: balance ? toUnits(balance.accruedBalance) : 0,
      });
    }
  }

  return {
    asOf: today,
    timezone: organization.timezone,
    summary: {
      employees: memberships.length,
      leaveTypes: types.length,
      previews: items.length,
      missingBalances: items.filter((item) => !item.balanceExists).length,
    },
    items: items.slice(0, maxItems),
    truncated: items.length > maxItems,
  };
}

export async function listLeaveLedger(options: {
  organization: OrganizationModel;
  query: LeaveLedgerQuery;
}) {
  const { organization, query } = options;
  const where: Record<string, unknown> = { organizationId: organization.id };
  if (query.employeeId) where.employeeId = query.employeeId;
  if (query.leaveTypeId) where.leaveTypeId = query.leaveTypeId;
  if (query.periodStart) {
    const balanceIds = await LeaveBalance.findAll({
      where: {
        organizationId: organization.id,
        periodStart: query.periodStart,
        ...(query.employeeId ? { employeeId: query.employeeId } : {}),
        ...(query.leaveTypeId ? { leaveTypeId: query.leaveTypeId } : {}),
      },
      attributes: ['id'],
    });
    if (balanceIds.length === 0) {
      return paginate([], 0, query.page, query.limit);
    }
    where.balanceId = { [Op.in]: balanceIds.map((balance) => balance.id) };
  }

  const result = await LeaveLedgerEntry.findAndCountAll({
    where,
    include: [
      { model: User, as: 'employee', required: false, attributes: ['id', 'name', 'email'] },
      { model: LeaveType, as: 'leaveType', required: true, attributes: ['id', 'name'] },
      { model: User, as: 'actor', required: false, attributes: ['id', 'name', 'email'] },
    ],
    order: [
      ['createdAt', 'DESC'],
      ['id', 'DESC'],
    ],
    limit: query.limit,
    offset: (query.page - 1) * query.limit,
    distinct: true,
  });

  return paginate(
    result.rows.map((entry: LeaveLedgerEntryModel) => toLeaveLedgerEntrySummary(entry)),
    result.count,
    query.page,
    query.limit,
  );
}
