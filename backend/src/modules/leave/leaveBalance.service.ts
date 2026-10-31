import { Op, Transaction, UniqueConstraintError } from 'sequelize';
import {
  LeaveBalance,
  LeaveHoliday,
  LeaveLedgerEntry,
  LeavePolicy,
  LeaveRequest,
  LeaveType,
  Membership,
  User,
  sequelize,
} from '../../database';
import { AppError } from '../../utils/errors';
import { toLeaveBalanceSummary } from './leave.mapper';
import {
  accrualPeriodStart,
  accrualTrancheDates,
  balancePeriodFor,
  localDate,
  monthlyProrationRatio,
  roundUnits,
  todayInTimezone,
  toUnits,
} from './leaveCalendar';
import { recordAuditEvent, type AuditContext } from '../screenshots/audit.service';
import type { Organization as OrganizationModel } from '../organizations/organization.model';
import type { LeaveBalance as LeaveBalanceModel } from './leaveBalance.model';
import type { LeaveLedgerEntry as LeaveLedgerEntryModel } from './leaveLedgerEntry.model';
import type { LeavePolicy as LeavePolicyModel } from './leavePolicy.model';
import type { LeaveRequest as LeaveRequestModel } from './leaveRequest.model';
import { ACTIVE_LEAVE_REQUEST_STATUSES } from './leaveRequest.model';
import type { LeaveType as LeaveTypeModel } from './leaveType.model';
import type {
  LeaveAdjustmentInput,
  LeaveBalanceDetailQuery,
  LeaveBalanceListQuery,
} from './leave.schemas';

export type LeaveTypeWithPolicy = {
  type: LeaveTypeModel;
  policy: LeavePolicyModel;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retries a whole transaction when a concurrent worker wins a unique-key race.
 * PostgreSQL aborts the transaction on a constraint violation, so retrying just
 * the insert is not enough; the caller must start a fresh transaction.
 */
export async function withTransactionRetry<T>(
  run: () => Promise<T>,
  attempts = 4,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (!(error instanceof UniqueConstraintError) || attempt === attempts) throw error;
      await sleep(25 * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Transaction retry failed');
}

export async function ensureActiveEmployee(
  organizationId: string,
  employeeId: string,
) {
  const membership = await Membership.findOne({
    where: { organizationId, userId: employeeId },
    include: [{ model: User, as: 'user', required: true }],
  });
  if (!membership) {
    throw AppError.notFound('Employee is not a member of this organization', 'EMPLOYEE_NOT_FOUND');
  }
  if (membership.status !== 'ACTIVE' || membership.user?.status !== 'ACTIVE') {
    throw AppError.forbidden('This employee is not active', 'EMPLOYEE_INACTIVE');
  }
  return membership;
}

export async function loadLeaveTypeWithPolicy(
  organizationId: string,
  leaveTypeId: string,
  options: { transaction?: Transaction } = {},
): Promise<LeaveTypeWithPolicy> {
  const type = await LeaveType.findOne({
    where: { id: leaveTypeId, organizationId },
    include: [{ model: LeavePolicy, as: 'policy', required: false }],
    transaction: options.transaction,
  });
  if (!type) {
    throw AppError.notFound('Leave type not found', 'LEAVE_TYPE_NOT_FOUND');
  }

  let policy = type.policy;
  if (!policy) {
    policy = await LeavePolicy.create(
      {
        organizationId,
        leaveTypeId: type.id,
      },
      { transaction: options.transaction },
    );
  }

  return { type, policy };
}

export async function holidayDates(
  organizationId: string,
  from: string,
  to: string,
  options: { transaction?: Transaction } = {},
): Promise<Set<string>> {
  const rows = await LeaveHoliday.findAll({
    where: {
      organizationId,
      holidayDate: { [Op.between]: [from, to] },
    },
    attributes: ['holidayDate'],
    transaction: options.transaction,
  });
  return new Set(rows.map((row) => row.holidayDate));
}

function addUnits(current: unknown, delta: number): number {
  return roundUnits(toUnits(current) + delta);
}

function capForAutomaticCredit(
  balance: LeaveBalanceModel,
  amount: number,
  maxBalance: number | null,
): number {
  if (maxBalance === null) return amount;
  const earned =
    toUnits(balance.entitledBalance) +
    toUnits(balance.accruedBalance) +
    toUnits(balance.adjustmentBalance) +
    toUnits(balance.carriedForwardBalance) -
    toUnits(balance.approvedConsumed);
  const remaining = roundUnits(maxBalance - earned);
  return Math.max(0, Math.min(amount, remaining));
}

export function availableOf(balance: LeaveBalanceModel): number {
  return roundUnits(
    toUnits(balance.entitledBalance) +
      toUnits(balance.accruedBalance) +
      toUnits(balance.adjustmentBalance) +
      toUnits(balance.carriedForwardBalance) -
      toUnits(balance.approvedConsumed) -
      toUnits(balance.pendingReserved),
  );
}

function applyCredit(
  balance: LeaveBalanceModel,
  bucket: 'entitled' | 'accrued' | 'carriedForward' | 'adjustment',
  amount: number,
): void {
  if (bucket === 'entitled') balance.entitledBalance = addUnits(balance.entitledBalance, amount);
  if (bucket === 'accrued') balance.accruedBalance = addUnits(balance.accruedBalance, amount);
  if (bucket === 'carriedForward') {
    balance.carriedForwardBalance = addUnits(balance.carriedForwardBalance, amount);
  }
  if (bucket === 'adjustment') {
    balance.adjustmentBalance = addUnits(balance.adjustmentBalance, amount);
  }
  balance.availableBalance = addUnits(balance.availableBalance, amount);
}

type LedgerDeltas = {
  entitledDelta?: number;
  accruedDelta?: number;
  adjustmentDelta?: number;
  carriedForwardDelta?: number;
  reservedDelta?: number;
  consumedDelta?: number;
  availableDelta?: number;
};

export async function appendLedger(
  balance: LeaveBalanceModel,
  input: {
    kind: LeaveLedgerEntryModel['kind'];
    deltas: LedgerDeltas;
    reason?: string | null;
    idempotencyKey?: string | null;
    accrualPeriod?: string | null;
    actorUserId?: string | null;
    leaveRequestId?: string | null;
    metadata?: Record<string, unknown> | null;
  },
  transaction: Transaction,
): Promise<LeaveLedgerEntryModel> {
  return LeaveLedgerEntry.create(
    {
      organizationId: balance.organizationId,
      balanceId: balance.id,
      employeeId: balance.employeeId,
      leaveTypeId: balance.leaveTypeId,
      leaveRequestId: input.leaveRequestId ?? null,
      kind: input.kind,
      accrualPeriod: input.accrualPeriod ?? null,
      entitledDelta: roundUnits(input.deltas.entitledDelta ?? 0),
      accruedDelta: roundUnits(input.deltas.accruedDelta ?? 0),
      adjustmentDelta: roundUnits(input.deltas.adjustmentDelta ?? 0),
      carriedForwardDelta: roundUnits(input.deltas.carriedForwardDelta ?? 0),
      reservedDelta: roundUnits(input.deltas.reservedDelta ?? 0),
      consumedDelta: roundUnits(input.deltas.consumedDelta ?? 0),
      availableDelta: roundUnits(input.deltas.availableDelta ?? 0),
      balanceAfter: availableOf(balance),
      reason: input.reason ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      actorUserId: input.actorUserId ?? null,
      metadata: input.metadata ?? null,
    },
    { transaction },
  );
}

async function findOrCreateLockedBalance(options: {
  organizationId: string;
  employeeId: string;
  leaveTypeId: string;
  periodStart: string;
  periodEnd: string;
  transaction: Transaction;
}): Promise<{ balance: LeaveBalanceModel; created: boolean }> {
  const [, created] = await LeaveBalance.findOrCreate({
    where: {
      organizationId: options.organizationId,
      employeeId: options.employeeId,
      leaveTypeId: options.leaveTypeId,
      periodStart: options.periodStart,
    },
    defaults: {
      organizationId: options.organizationId,
      employeeId: options.employeeId,
      leaveTypeId: options.leaveTypeId,
      periodStart: options.periodStart,
      periodEnd: options.periodEnd,
    },
    transaction: options.transaction,
  });

  const balance = await LeaveBalance.findOne({
    where: {
      organizationId: options.organizationId,
      employeeId: options.employeeId,
      leaveTypeId: options.leaveTypeId,
      periodStart: options.periodStart,
    },
    transaction: options.transaction,
    lock: Transaction.LOCK.UPDATE,
  });
  if (!balance) {
    throw AppError.conflict('Leave balance is unavailable', 'LEAVE_BALANCE_NOT_FOUND');
  }
  return { balance, created };
}

/**
 * Lazily materializes a balance period: initial entitlement, carry-forward,
 * and every accrual tranche whose effective date has passed. Each automatic
 * credit carries an idempotency key so repeated reads and retries cannot
 * double-credit. The caller must hold the balance row lock (this function does).
 */
export async function ensureBalance(options: {
  organization: OrganizationModel;
  employeeId: string;
  type: LeaveTypeModel;
  policy: LeavePolicyModel;
  periodStart: string;
  periodEnd: string;
  transaction: Transaction;
  now?: Date;
}): Promise<LeaveBalanceModel> {
  const { organization, employeeId, type, policy, periodStart, periodEnd, transaction } = options;
  const now = options.now ?? new Date();
  const today = localDate(now, organization.timezone);

  const { balance, created } = await findOrCreateLockedBalance({
    organizationId: organization.id,
    employeeId,
    leaveTypeId: type.id,
    periodStart,
    periodEnd,
    transaction,
  });

  const needsJoinDate =
    policy.prorateInitialEntitlement ||
    (policy.accrualFrequency !== 'NONE' &&
      policy.prorateAccrual &&
      toUnits(policy.accrualAmount) > 0);
  let joinDate: string | null = null;
  if (needsJoinDate) {
    const membership = await Membership.findOne({
      where: { organizationId: organization.id, userId: employeeId },
      attributes: ['createdAt'],
      transaction,
    });
    if (membership) joinDate = localDate(membership.createdAt, organization.timezone);
  }

  const keys = new Set<string>();
  const initialKey = `initial:${periodStart}`;
  const carryKey = `carry:${periodStart}`;
  const accrualTranches: Array<{
    key: string;
    accrualPeriod: string;
    trancheDate: string;
  }> = [];
  const existing = await LeaveLedgerEntry.findAll({
    where: { balanceId: balance.id, idempotencyKey: { [Op.in]: [initialKey, carryKey] } },
    attributes: ['idempotencyKey'],
    transaction,
  });
  for (const entry of existing) {
    if (entry.idempotencyKey) keys.add(entry.idempotencyKey);
  }

  let changed = created;

  if (!keys.has(initialKey) && toUnits(policy.initialEntitlement) > 0) {
    let entitlement = toUnits(policy.initialEntitlement);
    if (policy.prorateInitialEntitlement && joinDate) {
      const start = localDate(periodStart, organization.timezone);
      const end = localDate(periodEnd, organization.timezone);
      const startDateTime = Date.parse(`${start}T00:00:00Z`);
      const endDateTime = Date.parse(`${end}T00:00:00Z`);
      const joinDateTime = Date.parse(`${joinDate}T00:00:00Z`);
      if (joinDateTime > endDateTime) {
        entitlement = 0;
      } else if (joinDateTime > startDateTime) {
        const totalDays = Math.round((endDateTime - startDateTime) / 86_400_000) + 1;
        const remainingDays = Math.round((endDateTime - joinDateTime) / 86_400_000) + 1;
        entitlement = roundUnits((entitlement * remainingDays) / totalDays);
      }
    }

    const credit = capForAutomaticCredit(balance, entitlement, policy.maxBalance);
    applyCredit(balance, 'entitled', credit);
    await appendLedger(
      balance,
      {
        kind: 'INITIAL_ENTITLEMENT',
        deltas: { entitledDelta: credit, availableDelta: credit },
        reason: 'Initial entitlement for balance period',
        idempotencyKey: initialKey,
        metadata: { configured: entitlement, credited: credit, periodStart },
      },
      transaction,
    );
    changed = true;
  }

  if (!keys.has(carryKey) && toUnits(policy.carryForwardAllowance) > 0) {
    const previous = await LeaveBalance.findOne({
      where: {
        organizationId: organization.id,
        employeeId,
        leaveTypeId: type.id,
        periodEnd: { [Op.lt]: periodStart },
      },
      order: [['periodEnd', 'DESC']],
      transaction,
      lock: Transaction.LOCK.UPDATE,
    });
    const carry = previous
      ? Math.min(toUnits(previous.availableBalance), toUnits(policy.carryForwardAllowance))
      : 0;
    const credit = capForAutomaticCredit(balance, carry, policy.maxBalance);
    applyCredit(balance, 'carriedForward', credit);
    await appendLedger(
      balance,
      {
        kind: 'CARRY_FORWARD',
        deltas: { carriedForwardDelta: credit, availableDelta: credit },
        reason: 'Carry-forward from previous balance period',
        idempotencyKey: carryKey,
        metadata: {
          previousBalanceId: previous?.id ?? null,
          previousAvailable: previous ? toUnits(previous.availableBalance) : 0,
          allowance: toUnits(policy.carryForwardAllowance),
          credited: credit,
        },
      },
      transaction,
    );
    changed = true;
  }

  if (policy.accrualFrequency !== 'NONE' && toUnits(policy.accrualAmount) > 0) {
    const tranches = accrualTrancheDates({
      periodStart,
      periodEnd,
      today,
      frequency: policy.accrualFrequency,
      amount: toUnits(policy.accrualAmount),
      accrualDayOfMonth: policy.accrualDayOfMonth,
      effectiveFrom: policy.accrualEffectiveFrom ?? periodStart,
    });
    for (const trancheDate of tranches) {
      const accrualPeriod = accrualPeriodStart(trancheDate);
      accrualTranches.push({
        key: `accrual:${accrualPeriod}`,
        accrualPeriod,
        trancheDate,
      });
    }
  }

  if (accrualTranches.length > 0) {
    const existingAccruals = await LeaveLedgerEntry.findAll({
      where: {
        organizationId: organization.id,
        employeeId,
        leaveTypeId: type.id,
        kind: 'ACCRUAL',
        [Op.or]: [
          {
            accrualPeriod: {
              [Op.in]: accrualTranches.map((item) => item.accrualPeriod),
            },
          },
          { idempotencyKey: { [Op.in]: accrualTranches.map((item) => item.key) } },
        ],
      },
      attributes: ['idempotencyKey', 'accrualPeriod'],
      transaction,
    });
    const grantedPeriods = new Set<string>();
    for (const entry of existingAccruals) {
      if (entry.idempotencyKey) keys.add(entry.idempotencyKey);
      if (entry.accrualPeriod) grantedPeriods.add(entry.accrualPeriod);
    }

    for (const tranche of accrualTranches) {
      if (keys.has(tranche.key) || grantedPeriods.has(tranche.accrualPeriod)) continue;
      const configured = toUnits(policy.accrualAmount);
      const prorated =
        policy.prorateAccrual && joinDate
          ? roundUnits(
              configured *
                monthlyProrationRatio({ joinDate, trancheDate: tranche.trancheDate }),
            )
          : configured;
      const credit = capForAutomaticCredit(balance, prorated, policy.maxBalance);
      if (credit !== 0) applyCredit(balance, 'accrued', credit);
      await appendLedger(
        balance,
        {
          kind: 'ACCRUAL',
          deltas: { accruedDelta: credit, availableDelta: credit },
          reason: 'Scheduled accrual',
          idempotencyKey: tranche.key,
          accrualPeriod: tranche.accrualPeriod,
          metadata: {
            trancheDate: tranche.trancheDate,
            frequency: policy.accrualFrequency,
            accrualDayOfMonth: policy.accrualDayOfMonth,
            effectiveFrom: policy.accrualEffectiveFrom,
            configured,
            prorated,
            credited: credit,
            prorateAccrual: policy.prorateAccrual,
            joinDate,
          },
        },
        transaction,
      );
      keys.add(tranche.key);
      grantedPeriods.add(tranche.accrualPeriod);
      changed = true;
    }
  }

  if (changed) {
    balance.availableBalance = availableOf(balance);
    await balance.save({ transaction });
  }

  return balance;
}

export async function ensureBalanceForDate(options: {
  organization: OrganizationModel;
  employeeId: string;
  type: LeaveTypeModel;
  policy: LeavePolicyModel;
  dateIso: string;
  transaction: Transaction;
  now?: Date;
}): Promise<{ balance: LeaveBalanceModel; periodStart: string; periodEnd: string }> {
  const period = balancePeriodFor(options.dateIso, options.policy, options.organization.timezone);
  const balance = await ensureBalance({
    organization: options.organization,
    employeeId: options.employeeId,
    type: options.type,
    policy: options.policy,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    transaction: options.transaction,
    now: options.now,
  });
  return { balance, ...period };
}

async function loadLedger(balanceIds: string[]): Promise<Map<string, LeaveLedgerEntryModel[]>> {
  if (balanceIds.length === 0) return new Map();
  const entries = await LeaveLedgerEntry.findAll({
    where: { balanceId: { [Op.in]: balanceIds } },
    order: [
      ['createdAt', 'DESC'],
      ['id', 'DESC'],
    ],
  });
  const grouped = new Map<string, LeaveLedgerEntryModel[]>();
  for (const entry of entries) {
    const list = grouped.get(entry.balanceId) ?? [];
    if (list.length < 20) list.push(entry);
    grouped.set(entry.balanceId, list);
  }
  return grouped;
}

const balanceIncludes = [
  {
    model: LeaveType,
    as: 'leaveType',
    required: true,
    attributes: ['id', 'name', 'isPaid', 'requiresBalance'],
  },
  {
    model: User,
    as: 'employee',
    required: false,
    attributes: ['id', 'name', 'email'],
  },
];

async function summariesForBalances(balances: LeaveBalanceModel[]) {
  const ledger = await loadLedger(balances.map((balance) => balance.id));
  return balances.map((balance) => {
    balance.ledgerEntries = ledger.get(balance.id) ?? [];
    return toLeaveBalanceSummary(balance);
  });
}

export async function currentBalanceTypes(
  organizationId: string,
  leaveTypeId?: string,
): Promise<LeaveTypeWithPolicy[]> {
  const types = await LeaveType.findAll({
    where: {
      organizationId,
      isActive: true,
      requiresBalance: true,
      ...(leaveTypeId ? { id: leaveTypeId } : {}),
    },
    include: [{ model: LeavePolicy, as: 'policy', required: true }],
    order: [['name', 'ASC']],
  });
  return types.map((type) => ({ type, policy: type.policy! }));
}

export async function getEmployeeLeaveBalances(options: {
  organization: OrganizationModel;
  employeeId: string;
  query: LeaveBalanceDetailQuery;
}) {
  const { organization, employeeId, query } = options;
  await ensureActiveEmployee(organization.id, employeeId);
  const types = await currentBalanceTypes(organization.id, query.leaveTypeId);
  const today = todayInTimezone(organization.timezone);

  const anchors = new Set<string>([query.periodStart ?? today]);
  if (!query.periodStart) {
    // Active requests can sit in a future balance period; surface those too so
    // the employee can see what their request has reserved.
    const activeRequests: LeaveRequestModel[] = await LeaveRequest.findAll({
      where: {
        organizationId: organization.id,
        employeeId,
        status: { [Op.in]: [...ACTIVE_LEAVE_REQUEST_STATUSES] },
        balancePeriodStart: { [Op.ne]: null },
        ...(query.leaveTypeId ? { leaveTypeId: query.leaveTypeId } : {}),
      },
      attributes: ['leaveTypeId', 'balancePeriodStart'],
    });
    for (const request of activeRequests) {
      if (request.balancePeriodStart) anchors.add(request.balancePeriodStart);
    }
  }

  const periods = new Map<
    string,
    { type: LeaveTypeModel; policy: LeavePolicyModel; periodStart: string; periodEnd: string }
  >();
  for (const { type, policy } of types) {
    for (const anchor of anchors) {
      const period = balancePeriodFor(anchor, policy, organization.timezone);
      periods.set(`${type.id}:${period.periodStart}`, { type, policy, ...period });
    }
  }

  // Reads may target historical or future periods (ledger replay, reserved
  // requests). Only the current canonical period is materialized here so a
  // read never mints a retroactive balance or entitlement.
  const materialize = [...periods.values()].filter(
    (entry) =>
      entry.periodStart ===
      balancePeriodFor(today, entry.policy, organization.timezone).periodStart,
  );

  if (materialize.length > 0) {
    await withTransactionRetry(() =>
      sequelize.transaction(async (transaction) => {
        for (const entry of materialize) {
          await ensureBalance({
            organization,
            employeeId,
            type: entry.type,
            policy: entry.policy,
            periodStart: entry.periodStart,
            periodEnd: entry.periodEnd,
            transaction,
          });
        }
      }),
    );
  }

  const periodStarts = [...new Set([...periods.values()].map((entry) => entry.periodStart))];
  if (periodStarts.length === 0) {
    return { employeeId, timezone: organization.timezone, balances: [] };
  }

  const result = (
    await LeaveBalance.findAll({
      where: {
        organizationId: organization.id,
        employeeId,
        periodStart: { [Op.in]: periodStarts },
      },
      include: balanceIncludes,
      order: [
        ['periodStart', 'ASC'],
        ['createdAt', 'ASC'],
      ],
    })
  ).filter((balance) => periods.has(`${balance.leaveTypeId}:${balance.periodStart}`));

  return {
    employeeId,
    timezone: organization.timezone,
    balances: await summariesForBalances(result),
  };
}

export async function listOrganizationLeaveBalances(options: {
  organization: OrganizationModel;
  query: LeaveBalanceListQuery;
}) {
  const { organization, query } = options;
  const types = await currentBalanceTypes(organization.id, query.leaveTypeId);

  const memberships = await Membership.findAll({
    where: {
      organizationId: organization.id,
      status: 'ACTIVE',
      ...(query.employeeId ? { userId: query.employeeId } : {}),
    },
    include: [{ model: User, as: 'user', required: true, where: { status: 'ACTIVE' } }],
    order: [['createdAt', 'ASC']],
  });

  const anchorDate = query.periodStart ?? todayInTimezone(organization.timezone);

  // Resolve exactly one canonical balance period per employee/type for the
  // selected date. Legacy rows from an earlier policy period may still overlap
  // it; they stay in the database for audit but are not presented as current.
  const canonical = new Map<
    string,
    {
      employeeId: string;
      type: LeaveTypeModel;
      policy: LeavePolicyModel;
      periodStart: string;
      periodEnd: string;
    }
  >();
  for (const membership of memberships) {
    for (const { type, policy } of types) {
      const period = balancePeriodFor(anchorDate, policy, organization.timezone);
      canonical.set(`${membership.userId}:${type.id}:${period.periodStart}`, {
        employeeId: membership.userId,
        type,
        policy,
        ...period,
      });
    }
  }

  const today = todayInTimezone(organization.timezone);

  // Only the current canonical period may be created by a read. Historical or
  // future periods are returned from existing rows (audit history stays
  // readable) but never receive a new balance or entitlement.
  const materialize = [...canonical.values()].filter(
    (entry) =>
      entry.periodStart ===
      balancePeriodFor(today, entry.policy, organization.timezone).periodStart,
  );

  if (materialize.length > 0) {
    await withTransactionRetry(() =>
      sequelize.transaction(async (transaction) => {
        for (const entry of materialize) {
          await ensureBalance({
            organization,
            employeeId: entry.employeeId,
            type: entry.type,
            policy: entry.policy,
            periodStart: entry.periodStart,
            periodEnd: entry.periodEnd,
            transaction,
          });
        }
      }),
    );
  }

  const employeeIds = memberships.map((membership) => membership.userId);
  const typeIds = types.map(({ type }) => type.id);
  const periodStarts = [...new Set([...canonical.values()].map((entry) => entry.periodStart))];
  const where: Record<string | symbol, unknown> = {
    organizationId: organization.id,
    periodStart: { [Op.in]: periodStarts },
  };
  if (employeeIds.length > 0) where.employeeId = { [Op.in]: employeeIds };
  if (typeIds.length > 0) where.leaveTypeId = { [Op.in]: typeIds };

  const balances =
    periodStarts.length === 0
      ? []
      : (
          await LeaveBalance.findAll({
            where,
            include: balanceIncludes,
            order: [
              ['employeeId', 'ASC'],
              ['leaveTypeId', 'ASC'],
            ],
          })
        ).filter((balance) =>
          canonical.has(`${balance.employeeId}:${balance.leaveTypeId}:${balance.periodStart}`),
        );

  const total = balances.length;
  const offset = (query.page - 1) * query.limit;
  const pageRows = balances.slice(offset, offset + query.limit);

  return {
    data: await summariesForBalances(pageRows),
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
    },
  };
}

type AdjustmentOutcome = {
  balance: LeaveBalanceModel;
  balanceId: string;
  typeName: string;
  amount: number;
  availableBefore: number;
  availableAfter: number;
  adjustmentBefore: number;
  adjustmentAfter: number;
  periodStart: string;
  periodEnd: string;
  createdBalance: boolean;
};

async function applyAdjustmentInTransaction(options: {
  organization: OrganizationModel;
  employeeId: string;
  actorUserId: string;
  input: LeaveAdjustmentInput;
  context?: AuditContext;
  transaction: Transaction;
  now?: Date;
  audit: boolean;
  batchId?: string | null;
}): Promise<AdjustmentOutcome> {
  const { organization, employeeId, actorUserId, input, context, transaction, audit } = options;
  const now = options.now ?? new Date();

  const { type, policy } = await loadLeaveTypeWithPolicy(organization.id, input.leaveTypeId, {
    transaction,
  });
  if (!type.requiresBalance) {
    throw AppError.unprocessable(
      'This leave type does not use a balance',
      'LEAVE_BALANCE_NOT_APPLICABLE',
    );
  }
  if (!policy.isActive) {
    throw AppError.conflict('The leave policy is inactive', 'LEAVE_POLICY_INACTIVE');
  }

  const anchor = input.periodStart ?? localDate(now, organization.timezone);
  const period = balancePeriodFor(anchor, policy, organization.timezone);
  if (input.periodStart && period.periodStart !== input.periodStart) {
    throw AppError.unprocessable(
      'periodStart must be the first day of a balance period',
      'LEAVE_ADJUSTMENT_PERIOD_INVALID',
    );
  }
  const currentPeriod = balancePeriodFor(
    localDate(now, organization.timezone),
    policy,
    organization.timezone,
  );

  let balance = await LeaveBalance.findOne({
    where: {
      organizationId: organization.id,
      employeeId,
      leaveTypeId: type.id,
      periodStart: period.periodStart,
    },
    transaction,
    lock: Transaction.LOCK.UPDATE,
  });
  const createdBalance = !balance;

  if (!balance) {
    // Never materialize a past period just to adjust it: that would also grant
    // retroactive automatic credits. Periods that do not exist yet must be
    // initialized explicitly through the audited backfill flow.
    if (period.periodStart !== currentPeriod.periodStart) {
      throw AppError.conflict(
        'No balance exists for that period. Run the balance initialization preview first.',
        'LEAVE_BALANCE_NOT_FOUND',
      );
    }
    balance = await ensureBalance({
      organization,
      employeeId,
      type,
      policy,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      transaction,
      now,
    });
  }

  const amount = roundUnits(input.amount);
  if (amount > 0 && policy.maxBalance !== null) {
    const allowed = capForAutomaticCredit(balance, amount, toUnits(policy.maxBalance));
    if (allowed < amount) {
      throw AppError.conflict(
        'The adjustment would exceed the maximum balance for this leave type',
        'LEAVE_BALANCE_CAP_EXCEEDED',
      );
    }
  }

  const availableBefore = availableOf(balance);
  const nextAvailable = roundUnits(availableBefore + amount);
  if (amount < 0 && !type.allowNegativeBalance && nextAvailable < 0) {
    throw AppError.conflict(
      'The adjustment would make the available balance negative',
      'LEAVE_BALANCE_NEGATIVE_NOT_ALLOWED',
    );
  }

  const adjustmentBefore = toUnits(balance.adjustmentBalance);
  applyCredit(balance, 'adjustment', amount);
  balance.availableBalance = availableOf(balance);
  await balance.save({ transaction });

  await appendLedger(
    balance,
    {
      kind: 'ADJUSTMENT',
      deltas: { adjustmentDelta: amount, availableDelta: amount },
      reason: input.reason,
      actorUserId,
      metadata: {
        previousAdjustmentBalance: adjustmentBefore,
        leaveTypeName: type.name,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        ...(options.batchId ? { batchId: options.batchId } : {}),
      },
    },
    transaction,
  );

  if (audit) {
    await recordAuditEvent(
      {
        organizationId: organization.id,
        actorUserId,
        targetEmployeeId: employeeId,
        action: 'LEAVE_BALANCE_ADJUSTED',
        entityType: 'LEAVE_BALANCE',
        entityId: balance.id,
        metadata: {
          leaveTypeId: type.id,
          leaveTypeName: type.name,
          amount,
          reason: input.reason,
          availableBalance: toUnits(balance.availableBalance),
          periodStart: balance.periodStart,
          periodEnd: balance.periodEnd,
          ...(options.batchId ? { batchId: options.batchId, bulk: true } : {}),
        },
      },
      { transaction, context },
    );
  }

  return {
    balance,
    balanceId: balance.id,
    typeName: type.name,
    amount,
    availableBefore,
    availableAfter: toUnits(balance.availableBalance),
    adjustmentBefore,
    adjustmentAfter: toUnits(balance.adjustmentBalance),
    periodStart: balance.periodStart,
    periodEnd: balance.periodEnd,
    createdBalance,
  };
}

class PreviewRollback<T> extends Error {
  constructor(readonly value: T) {
    super('preview rollback');
    this.name = 'PreviewRollback';
  }
}

async function inRolledBackTransaction<T>(
  run: (transaction: Transaction) => Promise<T>,
): Promise<T> {
  try {
    await sequelize.transaction(async (transaction) => {
      const value = await run(transaction);
      throw new PreviewRollback(value);
    });
  } catch (error) {
    if (error instanceof PreviewRollback) return error.value as T;
    throw error;
  }
  throw AppError.internal('Preview transaction did not complete', 'PREVIEW_FAILED');
}

export async function previewLeaveBalanceAdjustment(options: {
  organization: OrganizationModel;
  employeeId: string;
  actorUserId: string;
  input: LeaveAdjustmentInput;
  now?: Date;
}): Promise<{
  employeeId: string;
  leaveTypeId: string;
  leaveTypeName: string;
  periodStart: string;
  periodEnd: string;
  amount: number;
  availableBefore: number;
  availableAfter: number;
  adjustmentBefore: number;
  adjustmentAfter: number;
  balanceExists: boolean;
}> {
  await ensureActiveEmployee(options.organization.id, options.employeeId);
  const outcome = await withTransactionRetry(() =>
    inRolledBackTransaction((transaction) =>
      applyAdjustmentInTransaction({
        organization: options.organization,
        employeeId: options.employeeId,
        actorUserId: options.actorUserId,
        input: options.input,
        transaction,
        now: options.now,
        audit: false,
      }),
    ),
  );

  return {
    employeeId: options.employeeId,
    leaveTypeId: options.input.leaveTypeId,
    leaveTypeName: outcome.typeName,
    periodStart: outcome.periodStart,
    periodEnd: outcome.periodEnd,
    amount: outcome.amount,
    availableBefore: outcome.availableBefore,
    availableAfter: outcome.availableAfter,
    adjustmentBefore: outcome.adjustmentBefore,
    adjustmentAfter: outcome.adjustmentAfter,
    balanceExists: !outcome.createdBalance,
  };
}

export async function adjustLeaveBalance(options: {
  organization: OrganizationModel;
  employeeId: string;
  actorUserId: string;
  input: LeaveAdjustmentInput;
  context?: AuditContext;
  now?: Date;
  batchId?: string | null;
}) {
  const { organization, employeeId, actorUserId, input, context } = options;
  await ensureActiveEmployee(organization.id, employeeId);

  const outcome = await withTransactionRetry(() =>
    sequelize.transaction((transaction) =>
      applyAdjustmentInTransaction({
        organization,
        employeeId,
        actorUserId,
        input,
        context,
        transaction,
        now: options.now,
        audit: true,
        batchId: options.batchId,
      }),
    ),
  );

  const balance = await LeaveBalance.findByPk(outcome.balanceId, { include: balanceIncludes });
  if (!balance) {
    throw AppError.notFound('Leave balance not found', 'LEAVE_BALANCE_NOT_FOUND');
  }
  return toLeaveBalanceSummary(balance);
}

export async function getLeaveBalanceByEmployeeId(options: {
  organization: OrganizationModel;
  employeeId: string;
  query: LeaveBalanceDetailQuery;
}) {
  return getEmployeeLeaveBalances(options);
}
