import { Op, Transaction } from 'sequelize';
import { LeaveRequest } from '../../database';
import { AppError } from '../../utils/errors';
import {
  calendarMonthEnd,
  calendarMonthStart,
  roundUnits,
  toUnits,
} from './leaveCalendar';
import { ACTIVE_LEAVE_REQUEST_STATUSES } from './leaveRequest.model';
import type { LeavePolicy as LeavePolicyModel } from './leavePolicy.model';
import type { ChargedLeaveDay } from './leaveRequest.model';

export type MonthlyUsage = {
  /** `YYYY-MM` calendar month. */
  month: string;
  /** Units from approved (and cancellation-pending) requests. */
  approved: number;
  /** Units from pending requests. */
  pending: number;
  /** approved + pending, which is what the limit is compared against. */
  total: number;
};

export type MonthlyUsageSummary = MonthlyUsage & {
  limit: number | null;
  enabled: boolean;
  remaining: number | null;
};

/** Groups charged units by calendar month. */
export function unitsByMonth(
  chargedDates: readonly ChargedLeaveDay[],
): Map<string, number> {
  const months = new Map<string, number>();
  for (const day of chargedDates) {
    const month = day.date.slice(0, 7);
    months.set(month, roundUnits((months.get(month) ?? 0) + toUnits(day.units)));
  }
  return months;
}

/**
 * Units already committed in one calendar month. Pending requests count
 * against the limit, approved requests count, rejected and cancelled requests
 * do not (they are filtered by status). Half days are already fractional in
 * `chargedDates`.
 */
export async function monthlyUsageFor(options: {
  organizationId: string;
  employeeId: string;
  leaveTypeId: string;
  month: string;
  excludeRequestId?: string;
  transaction?: Transaction;
}): Promise<MonthlyUsage> {
  const monthStart = `${options.month}-01`;
  const monthEnd = calendarMonthEnd(monthStart);

  const requests = await LeaveRequest.findAll({
    where: {
      organizationId: options.organizationId,
      employeeId: options.employeeId,
      leaveTypeId: options.leaveTypeId,
      status: { [Op.in]: [...ACTIVE_LEAVE_REQUEST_STATUSES] },
      startDate: { [Op.lte]: monthEnd },
      endDate: { [Op.gte]: monthStart },
      ...(options.excludeRequestId ? { id: { [Op.ne]: options.excludeRequestId } } : {}),
    },
    attributes: ['id', 'status', 'chargedDates'],
    transaction: options.transaction,
  });

  let approved = 0;
  let pending = 0;
  for (const request of requests) {
    const days = Array.isArray(request.chargedDates) ? request.chargedDates : [];
    const units = roundUnits(
      days
        .filter((day) => day.date.startsWith(options.month))
        .reduce((sum, day) => sum + toUnits(day.units), 0),
    );
    if (request.status === 'PENDING') pending = roundUnits(pending + units);
    else approved = roundUnits(approved + units);
  }

  return { month: options.month, approved, pending, total: roundUnits(approved + pending) };
}

export function monthlySummary(
  usage: MonthlyUsage,
  policy: LeavePolicyModel,
): MonthlyUsageSummary {
  const enabled = Boolean(policy.monthlyUsageLimitEnabled) && policy.monthlyUsageLimit !== null;
  const limit = policy.monthlyUsageLimit === null ? null : toUnits(policy.monthlyUsageLimit);
  return {
    ...usage,
    enabled,
    limit,
    remaining: enabled && limit !== null ? roundUnits(Math.max(0, limit - usage.total)) : null,
  };
}

/**
 * Enforces the monthly cap for every month a request touches. A request that
 * spans months is evaluated month by month, as required.
 */
export async function assertMonthlyUsage(options: {
  organizationId: string;
  employeeId: string;
  leaveTypeId: string;
  policy: LeavePolicyModel;
  chargedDates: readonly ChargedLeaveDay[];
  excludeRequestId?: string;
  transaction: Transaction;
  leaveUnitLabel?: string;
}): Promise<void> {
  if (!options.policy.monthlyUsageLimitEnabled || options.policy.monthlyUsageLimit === null) {
    return;
  }
  const limit = toUnits(options.policy.monthlyUsageLimit);
  if (limit <= 0) return;

  const requested = unitsByMonth(options.chargedDates);
  for (const [month, requestedUnits] of requested) {
    const usage = await monthlyUsageFor({
      organizationId: options.organizationId,
      employeeId: options.employeeId,
      leaveTypeId: options.leaveTypeId,
      month,
      excludeRequestId: options.excludeRequestId,
      transaction: options.transaction,
    });
    if (usage.total + requestedUnits > limit + 0.001) {
      const label = options.leaveUnitLabel ?? 'credits';
      throw AppError.conflict(
        `This request exceeds the ${limit} ${label} monthly limit for ${month}. ` +
          `${roundUnits(usage.total)} ${label} are already pending or approved, ` +
          `and this request needs ${requestedUnits}.`,
        'LEAVE_MONTHLY_USAGE_LIMIT_EXCEEDED',
      );
    }
  }
}

/** Month bucket for a date, e.g. `2026-11`. */
export function monthOf(dateIso: string): string {
  return dateIso.slice(0, 7);
}

/** Convenience for callers that need the current calendar month bounds. */
export function monthBounds(dateIso: string): { month: string; start: string; end: string } {
  const start = calendarMonthStart(dateIso);
  return { month: monthOf(start), start, end: calendarMonthEnd(start) };
}
