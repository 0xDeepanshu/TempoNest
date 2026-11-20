import { Op, Transaction } from 'sequelize';
import {
  LeaveCreditTranche,
  LeaveLedgerEntry,
  LeaveRequestCreditAllocation,
} from '../../database';
import { addMonthsClamped, roundUnits, toUnits } from './leaveCalendar';
import { balanceAvailable } from './leaveBalanceMath';
import type { LeaveBalance as LeaveBalanceModel } from './leaveBalance.model';
import type { LeaveCreditTranche as LeaveCreditTrancheModel } from './leaveCreditTranche.model';
import type { LeaveRequestCreditAllocation as LeaveRequestCreditAllocationModel } from './leaveRequestCreditAllocation.model';
import type {
  CreditExpiryReason,
  LeavePolicy as LeavePolicyModel,
} from './leavePolicy.model';
import type { LeaveRequest as LeaveRequestModel } from './leaveRequest.model';

/**
 * Credit tranches are a projection of the append-only ledger: one row per
 * granted credit. They never override the aggregate balance; they exist so a
 * request can reserve and consume the *same* credits (earliest expiry first)
 * and so an expiring credit can be identified precisely.
 */

export type CreditSourceKind = 'INITIAL_ENTITLEMENT' | 'ACCRUAL' | 'CARRY_FORWARD' | 'ADJUSTMENT' | 'LEGACY';

export type CreditExpiry = {
  expiresAt: string | null;
  expiryReason: CreditExpiryReason;
};

/** Credits stay usable through their expiry date; they expire the following day. */
export function isTrancheExpired(tranche: { expiresAt: string | null }, today: string): boolean {
  return tranche.expiresAt !== null && tranche.expiresAt < today;
}

function remainingOf(tranche: LeaveCreditTrancheModel): number {
  return roundUnits(
    toUnits(tranche.allocated) -
      toUnits(tranche.consumed) -
      toUnits(tranche.reserved) -
      toUnits(tranche.expired),
  );
}

/**
 * Carry-forward is active when the explicit toggle is on, or when a legacy
 * policy still has a positive allowance (pre-migration rows were backfilled,
 * but tests and old backups may not have been).
 */
export function carryForwardEnabled(policy: LeavePolicyModel): boolean {
  return Boolean(policy.carryForwardEnabled) || toUnits(policy.carryForwardAllowance) > 0;
}

/**
 * Expiry policy for a newly granted credit. A policy only sets an expiry when
 * carry-forward is enabled with a duration; legacy policies keep `NULL`, so
 * their credits never expire and behaviour is unchanged.
 */
export function creditExpiryFor(
  policy: LeavePolicyModel,
  sourceKind: CreditSourceKind,
  allocatedOn: string,
): CreditExpiry {
  if (!carryForwardEnabled(policy)) return { expiresAt: null, expiryReason: 'NONE' };
  const months = policy.carryForwardExpiryMonths;
  if (months === null || months === undefined || Number(months) <= 0) {
    return { expiresAt: null, expiryReason: 'NONE' };
  }

  let expiryReason: CreditExpiryReason;
  if (sourceKind === 'CARRY_FORWARD') expiryReason = 'CARRY_FORWARD';
  else if (policy.accrualFrequency === 'MONTHLY') expiryReason = 'MONTHLY_RESET';
  else expiryReason = 'ANNUAL_RESET';

  return {
    expiresAt: addMonthsClamped(allocatedOn, Number(months)),
    expiryReason,
  };
}

/** Creates the tranche for one ledger credit. Safe to call twice for one ledger row. */
export async function recordCreditTranche(options: {
  balance: LeaveBalanceModel;
  sourceKind: CreditSourceKind;
  ledgerEntryId: string | null;
  amount: number;
  periodAllocated: string;
  expiry?: CreditExpiry;
  metadata?: Record<string, unknown> | null;
  transaction: Transaction;
}): Promise<LeaveCreditTrancheModel | null> {
  const amount = roundUnits(options.amount);
  if (amount <= 0) return null;

  if (options.ledgerEntryId) {
    const existing = await LeaveCreditTranche.findOne({
      where: { sourceLedgerEntryId: options.ledgerEntryId },
      transaction: options.transaction,
    });
    if (existing) return existing;
  }

  return LeaveCreditTranche.create(
    {
      organizationId: options.balance.organizationId,
      employeeId: options.balance.employeeId,
      leaveTypeId: options.balance.leaveTypeId,
      balanceId: options.balance.id,
      sourceKind: options.sourceKind,
      sourceLedgerEntryId: options.ledgerEntryId,
      periodAllocated: options.periodAllocated,
      allocated: amount,
      expiresAt: options.expiry?.expiresAt ?? null,
      expiryReason: options.expiry?.expiryReason ?? 'NONE',
      metadata: options.metadata ?? null,
    },
    { transaction: options.transaction },
  );
}

/**
 * Legacy balances predate tranche accounting (or an owner adjustment changed
 * the aggregate). Top the projection up with a single LEGACY tranche so future
 * reservations can always be allocated without inventing credits.
 */
export async function reconcileCreditTranches(
  balance: LeaveBalanceModel,
  transaction: Transaction,
): Promise<void> {
  const tranches = await LeaveCreditTranche.findAll({
    where: { balanceId: balance.id },
    transaction,
  });
  const projected = roundUnits(
    tranches.reduce((sum, tranche) => sum + Math.max(0, remainingOf(tranche)), 0),
  );
  const expected = balanceAvailable(balance);
  if (expected <= projected + 0.001) return;

  await recordCreditTranche({
    balance,
    sourceKind: 'LEGACY',
    ledgerEntryId: null,
    amount: roundUnits(expected - projected),
    periodAllocated: balance.periodStart,
    metadata: { reconciled: true, projectedBefore: projected, expected },
    transaction,
  });
}

function compareTranches(
  a: LeaveCreditTrancheModel,
  b: LeaveCreditTrancheModel,
  order: LeavePolicyModel['carryForwardOrder'],
): number {
  if (order === 'CARRY_FORWARD_FIRST') {
    const aCarry = a.sourceKind === 'CARRY_FORWARD' ? 0 : 1;
    const bCarry = b.sourceKind === 'CARRY_FORWARD' ? 0 : 1;
    if (aCarry !== bCarry) return aCarry - bCarry;
  }
  if (order === 'NEW_FIRST') {
    if (a.periodAllocated !== b.periodAllocated) {
      return a.periodAllocated < b.periodAllocated ? 1 : -1;
    }
    return a.createdAt.getTime() - b.createdAt.getTime() > 0 ? -1 : 1;
  }
  // EXPIRY_FIRST (default): soonest expiry wins, then oldest allocation.
  const aExpiry = a.expiresAt ?? '9999-12-31';
  const bExpiry = b.expiresAt ?? '9999-12-31';
  if (aExpiry !== bExpiry) return aExpiry < bExpiry ? -1 : 1;
  if (a.periodAllocated !== b.periodAllocated) {
    return a.periodAllocated < b.periodAllocated ? -1 : 1;
  }
  return a.createdAt.getTime() - b.createdAt.getTime();
}

/**
 * Reserves `units` for a request, earliest-expiry first (or the configured
 * order), writing one allocation row per tranche used. Must run inside the
 * caller's transaction while the balance row is locked.
 */
export async function allocateRequestCredits(options: {
  balance: LeaveBalanceModel;
  request: LeaveRequestModel;
  units: number;
  policy: LeavePolicyModel;
  today: string;
  transaction: Transaction;
}): Promise<void> {
  const { balance, request, policy, today, transaction } = options;
  let remaining = roundUnits(options.units);
  if (remaining <= 0) return;

  const existing = await LeaveRequestCreditAllocation.count({
    where: { requestId: request.id },
    transaction,
  });
  if (existing > 0) return;

  const tranches = await LeaveCreditTranche.findAll({
    where: { balanceId: balance.id },
    transaction,
    lock: Transaction.LOCK.UPDATE,
  });

  const usable = tranches
    .filter((tranche) => remainingOf(tranche) > 0 && !isTrancheExpired(tranche, today))
    .sort((a, b) => compareTranches(a, b, policy.carryForwardOrder));

  for (const tranche of usable) {
    if (remaining <= 0) break;
    const take = Math.min(remainingOf(tranche), remaining);
    if (take <= 0) continue;
    tranche.reserved = roundUnits(toUnits(tranche.reserved) + take);
    await tranche.save({ transaction });
    await LeaveRequestCreditAllocation.create(
      {
        organizationId: balance.organizationId,
        requestId: request.id,
        trancheId: tranche.id,
        reservedUnits: take,
      },
      { transaction },
    );
    remaining = roundUnits(remaining - take);
  }

  if (remaining > 0) {
    // Defensive top-up for legacy projections; keeps reservations exact even
    // when older balances were created before tranche accounting existed.
    const legacy = await recordCreditTranche({
      balance,
      sourceKind: 'LEGACY',
      ledgerEntryId: null,
      amount: remaining,
      periodAllocated: balance.periodStart,
      metadata: { allocatedDuringReservation: true },
      transaction,
    });
    if (legacy) {
      legacy.reserved = roundUnits(toUnits(legacy.reserved) + remaining);
      await legacy.save({ transaction });
      await LeaveRequestCreditAllocation.create(
        {
          organizationId: balance.organizationId,
          requestId: request.id,
          trancheId: legacy.id,
          reservedUnits: remaining,
        },
        { transaction },
      );
    }
  }
}

async function loadLockedAllocations(
  requestId: string,
  transaction: Transaction,
): Promise<Array<{ allocation: LeaveRequestCreditAllocationModel; tranche: LeaveCreditTrancheModel }>> {
  const allocations = await LeaveRequestCreditAllocation.findAll({
    where: { requestId },
    transaction,
    lock: Transaction.LOCK.UPDATE,
  });
  if (allocations.length === 0) return [];

  const tranches = await LeaveCreditTranche.findAll({
    where: { id: { [Op.in]: allocations.map((allocation) => allocation.trancheId) } },
    transaction,
    lock: Transaction.LOCK.UPDATE,
  });
  const byId = new Map(tranches.map((tranche) => [tranche.id, tranche]));

  return allocations
    .map((allocation) => ({ allocation, tranche: byId.get(allocation.trancheId) }))
    .filter(
      (row): row is { allocation: LeaveRequestCreditAllocationModel; tranche: LeaveCreditTrancheModel } =>
        Boolean(row.tranche),
    );
}

export type AllocationRelease = { released: number; expired: number };

/**
 * Releases a pending reservation. Credits whose tranche already expired are
 * not resurrected: they move straight to expired so availability stays correct.
 */
export async function releaseRequestCredits(options: {
  requestId: string;
  today: string;
  transaction: Transaction;
}): Promise<AllocationRelease> {
  let released = 0;
  let expired = 0;
  const rows = await loadLockedAllocations(options.requestId, options.transaction);

  for (const { allocation, tranche } of rows) {
    const units = roundUnits(toUnits(allocation.reservedUnits));
    if (units <= 0) continue;

    tranche.reserved = roundUnits(Math.max(0, toUnits(tranche.reserved) - units));
    if (isTrancheExpired(tranche, options.today)) {
      tranche.expired = roundUnits(toUnits(tranche.expired) + units);
      expired = roundUnits(expired + units);
    }
    await tranche.save({ transaction: options.transaction });

    allocation.reservedUnits = 0;
    allocation.restoredUnits = roundUnits(toUnits(allocation.restoredUnits) + units);
    await allocation.save({ transaction: options.transaction });
    released = roundUnits(released + units);
  }

  return { released, expired };
}

export type AllocationConsumption = { consumed: number; expiredOnRestore: number };

/** Moves reserved units to consumed, on the same tranches that were reserved. */
export async function consumeRequestCredits(options: {
  requestId: string;
  transaction: Transaction;
}): Promise<AllocationConsumption> {
  let consumed = 0;
  const rows = await loadLockedAllocations(options.requestId, options.transaction);

  for (const { allocation, tranche } of rows) {
    const units = roundUnits(toUnits(allocation.reservedUnits));
    if (units <= 0) continue;

    tranche.reserved = roundUnits(Math.max(0, toUnits(tranche.reserved) - units));
    tranche.consumed = roundUnits(toUnits(tranche.consumed) + units);
    await tranche.save({ transaction: options.transaction });

    allocation.reservedUnits = 0;
    allocation.consumedUnits = roundUnits(toUnits(allocation.consumedUnits) + units);
    await allocation.save({ transaction: options.transaction });
    consumed = roundUnits(consumed + units);
  }

  return { consumed, expiredOnRestore: 0 };
}

/**
 * Restores consumed units on cancellation. If the underlying credit has
 * already expired the units are marked expired instead of becoming available.
 */
export async function restoreRequestCredits(options: {
  requestId: string;
  today: string;
  transaction: Transaction;
}): Promise<AllocationConsumption> {
  let consumed = 0;
  let expiredOnRestore = 0;
  const rows = await loadLockedAllocations(options.requestId, options.transaction);

  for (const { allocation, tranche } of rows) {
    const units = roundUnits(toUnits(allocation.consumedUnits));
    if (units <= 0) continue;

    tranche.consumed = roundUnits(Math.max(0, toUnits(tranche.consumed) - units));
    if (isTrancheExpired(tranche, options.today)) {
      tranche.expired = roundUnits(toUnits(tranche.expired) + units);
      expiredOnRestore = roundUnits(expiredOnRestore + units);
    }
    await tranche.save({ transaction: options.transaction });

    allocation.consumedUnits = 0;
    allocation.restoredUnits = roundUnits(toUnits(allocation.restoredUnits) + units);
    await allocation.save({ transaction: options.transaction });
    consumed = roundUnits(consumed + units);
  }

  return { consumed, expiredOnRestore };
}

export type TrancheExpiryOutcome = { expired: number; entries: number };

/**
 * Expires the unreserved remainder of tranches whose expiry date has passed.
 * The total is capped by the aggregate available balance so a projection drift
 * can never push availability below zero.
 */
export async function expireCreditTranches(options: {
  balance: LeaveBalanceModel;
  today: string;
  transaction: Transaction;
  reason?: string;
}): Promise<TrancheExpiryOutcome> {
  const tranches = await LeaveCreditTranche.findAll({
    where: { balanceId: options.balance.id, expiresAt: { [Op.ne]: null } },
    transaction: options.transaction,
    lock: Transaction.LOCK.UPDATE,
  });

  let room = Math.max(0, balanceAvailable(options.balance));
  let totalExpired = 0;
  let entries = 0;

  for (const tranche of tranches.sort((a, b) => compareTranches(a, b, 'EXPIRY_FIRST'))) {
    if (room <= 0) break;
    if (!isTrancheExpired(tranche, options.today)) continue;
    const remaining = remainingOf(tranche);
    if (remaining <= 0) continue;

    const amount = roundUnits(Math.min(remaining, room));
    tranche.expired = roundUnits(toUnits(tranche.expired) + amount);
    await tranche.save({ transaction: options.transaction });

    const balance = options.balance;
    balance.expiredBalance = roundUnits(toUnits(balance.expiredBalance) + amount);
    balance.availableBalance = balanceAvailable(balance);
    await balance.save({ transaction: options.transaction });

    await LeaveLedgerEntry.create(
      {
        organizationId: balance.organizationId,
        balanceId: balance.id,
        employeeId: balance.employeeId,
        leaveTypeId: balance.leaveTypeId,
        kind: 'EXPIRY',
        expiredDelta: amount,
        availableDelta: -amount,
        balanceAfter: balanceAvailable(balance),
        reason: options.reason ?? 'Credit expired',
        metadata: {
          trancheId: tranche.id,
          expiresAt: tranche.expiresAt,
          expiryReason: tranche.expiryReason,
          expiredUnits: amount,
        },
      },
      { transaction: options.transaction },
    );

    room = roundUnits(room - amount);
    totalExpired = roundUnits(totalExpired + amount);
    entries += 1;
  }

  return { expired: totalExpired, entries };
}

/** Remaining units per tranche for a balance, used by employee-facing summaries. */
export async function trancheSnapshot(balanceId: string): Promise<
  Array<{
    sourceKind: CreditSourceKind;
    periodAllocated: string;
    allocated: number;
    consumed: number;
    reserved: number;
    expired: number;
    remaining: number;
    expiresAt: string | null;
    expiryReason: CreditExpiryReason;
  }>
> {
  const tranches = await LeaveCreditTranche.findAll({
    where: { balanceId },
    order: [
      ['expiresAt', 'ASC'],
      ['periodAllocated', 'ASC'],
      ['createdAt', 'ASC'],
    ],
  });
  return tranches
    .map((tranche) => ({
      sourceKind: tranche.sourceKind as CreditSourceKind,
      periodAllocated: tranche.periodAllocated,
      allocated: toUnits(tranche.allocated),
      consumed: toUnits(tranche.consumed),
      reserved: toUnits(tranche.reserved),
      expired: toUnits(tranche.expired),
      remaining: Math.max(0, remainingOf(tranche)),
      expiresAt: tranche.expiresAt,
      expiryReason: tranche.expiryReason,
    }))
    .filter((tranche) => tranche.allocated > 0);
}
