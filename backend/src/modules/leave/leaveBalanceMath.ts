import { toUnits } from './leaveCalendar';
import type { LeaveBalance as LeaveBalanceModel } from './leaveBalance.model';

/**
 * Single definition of the aggregate balance formula. Expired credits reduce
 * availability exactly like consumed or reserved credits, which keeps the
 * pre-existing ledger sums valid after the expiry feature was added.
 */
export function balanceAvailable(balance: LeaveBalanceModel): number {
  const total =
    toUnits(balance.entitledBalance) +
    toUnits(balance.accruedBalance) +
    toUnits(balance.adjustmentBalance) +
    toUnits(balance.carriedForwardBalance) -
    toUnits(balance.expiredBalance) -
    toUnits(balance.approvedConsumed) -
    toUnits(balance.pendingReserved);
  return Math.round((total + Number.EPSILON) * 100) / 100;
}

/** Credits the organization has granted in this period, before any usage. */
export function balanceAssigned(balance: LeaveBalanceModel): number {
  const total =
    toUnits(balance.entitledBalance) +
    toUnits(balance.accruedBalance) +
    toUnits(balance.adjustmentBalance) +
    toUnits(balance.carriedForwardBalance);
  return Math.round((total + Number.EPSILON) * 100) / 100;
}
