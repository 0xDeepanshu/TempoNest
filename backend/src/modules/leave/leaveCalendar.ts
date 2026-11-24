import { DateTime, IANAZone } from 'luxon';
import { AppError } from '../../utils/errors';
import type { AccrualFrequency, ResetPeriod } from './leavePolicy.model';
import type { ChargedLeaveDay } from './leaveRequest.model';

export const HALF_DAY_UNITS = 0.5;

export function leaveZone(timezone: string): string {
  return IANAZone.isValidZone(timezone) ? timezone : 'UTC';
}

export function roundUnits(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function toUnits(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? roundUnits(parsed) : 0;
}

export function todayInTimezone(timezone: string): string {
  return DateTime.now().setZone(leaveZone(timezone)).toISODate()!;
}

export function localDate(value: Date | string, timezone: string): string {
  const zone = leaveZone(timezone);
  if (value instanceof Date) return DateTime.fromJSDate(value, { zone }).toISODate()!;
  return DateTime.fromISO(value, { zone }).toISODate()!;
}

export type BalancePeriod = { periodStart: string; periodEnd: string };

export type PolicyPeriodConfig = {
  balancePeriodStartMonth: number;
  balancePeriodStartDay: number;
  /** Reset mode. Missing means the legacy annual month/day reset (CUSTOM). */
  resetPeriod?: ResetPeriod;
  /**
   * Joining date used by JOINING_ANNIVERSARY resets. When absent the policy's
   * configured month/day is used instead, which keeps historical reads safe.
   */
  anchorDate?: string | null;
};

/** Builds the calendar config for a policy, optionally with an employee anchor. */
export function policyPeriodConfig(
  policy: {
    balancePeriodStartMonth: number;
    balancePeriodStartDay: number;
    resetPeriod?: ResetPeriod;
  },
  anchorDate?: string | null,
): PolicyPeriodConfig {
  return {
    balancePeriodStartMonth: policy.balancePeriodStartMonth,
    balancePeriodStartDay: policy.balancePeriodStartDay,
    resetPeriod: policy.resetPeriod ?? 'CUSTOM',
    anchorDate: anchorDate ?? null,
  };
}

/**
 * Sentinel period used by `resetPeriod = NEVER`. It is intentionally wide so
 * every date resolves to the same row; no annual reset is ever produced.
 */
export const OPEN_ENDED_PERIOD: BalancePeriod = {
  periodStart: '1970-01-01',
  periodEnd: '9999-12-31',
};

function clampedPeriodStart(year: number, config: PolicyPeriodConfig, timezone: string): DateTime {
  const zone = leaveZone(timezone);
  const month = config.balancePeriodStartMonth;
  const maxDay = DateTime.fromObject({ year, month: 1 }, { zone }).daysInMonth ?? 28;
  const day = Math.min(Math.max(1, config.balancePeriodStartDay), maxDay);
  return DateTime.fromObject({ year, month, day }, { zone }).startOf('day');
}

/** Calendar balance period containing `dateIso`, using the org timezone. */
export function balancePeriodFor(
  dateIso: string,
  config: PolicyPeriodConfig,
  timezone: string,
): BalancePeriod {
  const zone = leaveZone(timezone);
  const date = DateTime.fromISO(dateIso, { zone }).startOf('day');
  if (!date.isValid) {
    throw AppError.unprocessable('Invalid calendar date', 'LEAVE_REQUEST_INVALID_DATES');
  }

  const mode = config.resetPeriod ?? 'CUSTOM';
  if (mode === 'NEVER') return { ...OPEN_ENDED_PERIOD };

  let anchor = config;
  if (mode === 'CALENDAR_YEAR') {
    anchor = { ...config, balancePeriodStartMonth: 1, balancePeriodStartDay: 1 };
  } else if (mode === 'JOINING_ANNIVERSARY' && config.anchorDate) {
    const joined = DateTime.fromISO(config.anchorDate, { zone }).startOf('day');
    if (joined.isValid) {
      anchor = {
        ...config,
        balancePeriodStartMonth: joined.month,
        balancePeriodStartDay: joined.day,
      };
    }
  }

  let start = clampedPeriodStart(date.year, anchor, zone);
  if (start > date) start = clampedPeriodStart(date.year - 1, anchor, zone);
  const next = clampedPeriodStart(start.year + 1, anchor, zone);

  return {
    periodStart: start.toISODate()!,
    periodEnd: next.minus({ days: 1 }).toISODate()!,
  };
}

export function periodAfter(periodStart: string, config: PolicyPeriodConfig, timezone: string): string {
  if ((config.resetPeriod ?? 'CUSTOM') === 'NEVER') return OPEN_ENDED_PERIOD.periodStart;
  return clampedPeriodStart(
    DateTime.fromISO(periodStart, { zone: leaveZone(timezone) }).year + 1,
    config,
    timezone,
  ).toISODate()!;
}

/** Adds calendar months, clamping the day to the target month (31 Jan + 1 = 28/29 Feb). */
export function addMonthsClamped(dateIso: string, months: number): string {
  return DateTime.fromISO(dateIso, { zone: 'utc' }).plus({ months }).toISODate()!;
}

/** Subtracts calendar months from a date. */
export function subtractMonthsClamped(dateIso: string, months: number): string {
  return DateTime.fromISO(dateIso, { zone: 'utc' }).minus({ months }).toISODate()!;
}

/** Later of two ISO dates. */
export function laterDate(a: string, b: string): string {
  return a >= b ? a : b;
}

/** First day of the calendar month containing `dateIso`. */
export function calendarMonthStart(dateIso: string): string {
  return DateTime.fromISO(dateIso, { zone: 'utc' }).startOf('month').toISODate()!;
}

/** Last day of the calendar month containing `dateIso`. */
export function calendarMonthEnd(dateIso: string): string {
  return DateTime.fromISO(dateIso, { zone: 'utc' }).endOf('month').toISODate()!;
}

export type WorkingDayInput = {
  startDate: string;
  endDate: string;
  startHalfDay: boolean;
  endHalfDay: boolean;
  workingDays: number[];
  /** Full-day holiday dates. Kept for compatibility with existing callers. */
  holidays: ReadonlySet<string>;
  /**
   * Holiday units per date (0.5 for a half-day holiday, 1 for a full day).
   * When supplied this supersedes `holidays` and lets leave charge only the
   * working portion of a half-day holiday.
   */
  holidayUnits?: ReadonlyMap<string, number>;
};

/**
 * Charge whole working days, excluding non-working weekdays and organization
 * holidays. Half-day flags subtract half a unit from the corresponding
 * boundary date and are only valid when that date is actually chargeable.
 */
export function calculateLeaveUnits(input: WorkingDayInput): {
  units: number;
  chargedDates: ChargedLeaveDay[];
} {
  const start = DateTime.fromISO(input.startDate, { zone: 'utc' }).startOf('day');
  const end = DateTime.fromISO(input.endDate, { zone: 'utc' }).startOf('day');
  if (!start.isValid || !end.isValid || end < start) {
    throw AppError.unprocessable(
      'startDate must be on or before endDate',
      'LEAVE_REQUEST_INVALID_DATES',
    );
  }

  if (
    start.toISODate() === end.toISODate() &&
    input.startHalfDay &&
    input.endHalfDay
  ) {
    throw AppError.unprocessable(
      'A single-day request cannot be half-day at both ends',
      'LEAVE_REQUEST_INVALID_HALF_DAY',
    );
  }

  const charged: ChargedLeaveDay[] = [];
  const workingDays = new Set(input.workingDays);
  const holidayUnits =
    input.holidayUnits ??
    new Map([...input.holidays].map((date) => [date, 1] as const));
  let cursor = start;
  while (cursor <= end) {
    const date = cursor.toISODate()!;
    const holidayFraction = Math.min(1, Math.max(0, holidayUnits.get(date) ?? 0));
    const chargeableUnits = roundUnits(1 - holidayFraction);
    if (workingDays.has(cursor.weekday) && chargeableUnits > 0) {
      charged.push({ date, units: chargeableUnits });
    }
    cursor = cursor.plus({ days: 1 });
  }

  if (charged.length === 0) {
    throw AppError.unprocessable(
      'The selected range contains no chargeable working days',
      'LEAVE_NO_WORKING_DAYS',
    );
  }

  const startIso = start.toISODate()!;
  const endIso = end.toISODate()!;

  if (input.startHalfDay) {
    const first = charged.find((day) => day.date === startIso);
    if (!first) {
      throw AppError.unprocessable(
        'The start date is not a chargeable working day',
        'LEAVE_REQUEST_INVALID_HALF_DAY',
      );
    }
    // A half-day holiday already charges only its working half. Do not reduce
    // it again, otherwise the working portion would disappear.
    if (first.units >= 1) first.units = HALF_DAY_UNITS;
  }

  if (input.endHalfDay) {
    const last = charged.find((day) => day.date === endIso);
    if (!last) {
      throw AppError.unprocessable(
        'The end date is not a chargeable working day',
        'LEAVE_REQUEST_INVALID_HALF_DAY',
      );
    }
    if (last.units >= 1) last.units = roundUnits(last.units - HALF_DAY_UNITS);
  }

  const units = roundUnits(charged.reduce((sum, day) => sum + day.units, 0));
  if (units <= 0) {
    throw AppError.unprocessable(
      'The selected half-day combination charges no leave',
      'LEAVE_REQUEST_INVALID_HALF_DAY',
    );
  }

  return { units, chargedDates: charged };
}

export function calendarDays(startDate: string, endDate: string): number {
  const start = DateTime.fromISO(startDate, { zone: 'utc' }).startOf('day');
  const end = DateTime.fromISO(endDate, { zone: 'utc' }).startOf('day');
  return Math.round(end.diff(start, 'days').days) + 1;
}

/**
 * All scheduled accrual tranches inside a balance period, respecting the
 * configured accrual day and the accrual effective date. Dates are calendar
 * dates in UTC to stay stable across timezones; callers compare them with the
 * organization-local "today" string.
 */
export function scheduledAccrualDates(options: {
  periodStart: string;
  periodEnd: string;
  frequency: AccrualFrequency;
  amount: number;
  accrualDayOfMonth?: number;
  effectiveFrom?: string | null;
}): string[] {
  const {
    periodStart,
    periodEnd,
    frequency,
    amount,
    accrualDayOfMonth = 1,
    effectiveFrom = null,
  } = options;
  if (frequency === 'NONE' || amount <= 0) return [];

  const stepMonths = frequency === 'MONTHLY' ? 1 : frequency === 'QUARTERLY' ? 3 : 12;
  const start = DateTime.fromISO(periodStart, { zone: 'utc' }).startOf('day');
  const end = DateTime.fromISO(periodEnd, { zone: 'utc' }).endOf('day');
  const effective = effectiveFrom
    ? DateTime.fromISO(effectiveFrom, { zone: 'utc' }).startOf('day')
    : null;
  const day = Math.min(Math.max(1, accrualDayOfMonth), 31);

  const tranches: string[] = [];
  for (let months = 0; months <= 24; months += stepMonths) {
    const month = start.startOf('month').plus({ months });
    const maxDay = month.daysInMonth ?? 28;
    let tranche = DateTime.fromObject(
      { year: month.year, month: month.month, day: Math.min(day, maxDay) },
      { zone: 'utc' },
    ).startOf('day');

    // A period that starts after the configured accrual day credits its first
    // tranche on the period start instead of reaching back before the period.
    if (months === 0 && tranche < start) tranche = start;
    if (tranche > end) break;
    if (!effective || tranche >= effective) tranches.push(tranche.toISODate()!);
  }
  return tranches;
}

/**
 * Scheduled accrual tranches that have become effective by `today`. Tranche
 * dates double as ledger idempotency keys, so lazy accrual can run on every
 * read without double-crediting.
 */
export function accrualTrancheDates(options: {
  periodStart: string;
  periodEnd: string;
  today: string;
  frequency: AccrualFrequency;
  amount: number;
  accrualDayOfMonth?: number;
  effectiveFrom?: string | null;
}): string[] {
  return scheduledAccrualDates(options).filter((date) => date <= options.today);
}

/**
 * Stable month bucket for an accrual tranche. Accrual day changes must not
 * grant the same month twice, so the ledger uniqueness key is the month start
 * rather than the configured credit date.
 */
export function accrualPeriodStart(trancheDate: string): string {
  return DateTime.fromISO(trancheDate, { zone: 'utc' })
    .startOf('month')
    .toISODate()!;
}

/**
 * Prorates one monthly accrual tranche for an employee who joined the
 * organization during the tranche month. The ratio is the remaining calendar
 * days in that month divided by the number of days in the month.
 */
export function monthlyProrationRatio(options: {
  joinDate: string;
  trancheDate: string;
}): number {
  const tranche = DateTime.fromISO(options.trancheDate, { zone: 'utc' }).startOf('month');
  const monthStart = tranche.toISODate()!;
  const monthEnd = tranche.endOf('month').toISODate()!;
  if (options.joinDate <= monthStart) return 1;
  if (options.joinDate > monthEnd) return 0;

  const daysInMonth = tranche.daysInMonth ?? 28;
  const join = DateTime.fromISO(options.joinDate, { zone: 'utc' }).startOf('day');
  const monthEndDay = tranche.endOf('month').startOf('day');
  const remainingDays = Math.round(monthEndDay.diff(join, 'days').days) + 1;
  return Math.max(0, Math.min(1, remainingDays / daysInMonth));
}

export function prorationRatio(options: {
  joinDate: string;
  periodStart: string;
  periodEnd: string;
}): number {
  const { joinDate, periodStart, periodEnd } = options;
  if (joinDate <= periodStart) return 1;

  const start = DateTime.fromISO(periodStart, { zone: 'utc' });
  const end = DateTime.fromISO(periodEnd, { zone: 'utc' });
  const join = DateTime.fromISO(joinDate, { zone: 'utc' });
  if (join > end) return 0;

  const totalDays = Math.round(end.diff(start, 'days').days) + 1;
  const remainingDays = Math.round(end.diff(join, 'days').days) + 1;
  return Math.max(0, Math.min(1, remainingDays / totalDays));
}
