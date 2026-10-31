import { formatDay, isDateOnly, todayInTimeZone } from "./format";
import type {
  LeaveAccrualFrequency,
  LeaveBalance,
  LeaveLedgerEntryKind,
  LeaveRequestStatus,
} from "./types";

/** Low balance is a display threshold only; the API owns the real amounts. */
export const LOW_BALANCE_THRESHOLD = 2;

const WEEKDAYS: Record<number, string> = {
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
  7: "Sun",
};

const STATUS_LABELS: Record<LeaveRequestStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
  CANCELLATION_REQUESTED: "Cancellation requested",
};

const ACCRUAL_LABELS: Record<LeaveAccrualFrequency, string> = {
  NONE: "No accrual",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  ANNUAL: "Annual",
};

const LEDGER_LABELS: Record<LeaveLedgerEntryKind, string> = {
  INITIAL_ENTITLEMENT: "Initial entitlement",
  ACCRUAL: "Accrual",
  CARRY_FORWARD: "Carry forward",
  ADJUSTMENT: "Balance adjustment",
  RESERVATION: "Pending request reserved",
  RESERVATION_RELEASE: "Reservation released",
  CONSUMPTION: "Leave approved",
  CONSUMPTION_RESTORE: "Approved leave restored",
};

function unitValue(value: number): string {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function formatLeaveUnits(value: number, withLabel = true): string {
  const serialized = unitValue(value);
  if (!withLabel) return serialized;
  return `${serialized} ${serialized === "1" || serialized === "-1" ? "day" : "days"}`;
}

export function formatSignedLeaveUnits(value: number): string {
  const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${prefix}${unitValue(Math.abs(value))}`;
}

export function leaveStatusLabel(status: LeaveRequestStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export function accrualFrequencyLabel(frequency: LeaveAccrualFrequency): string {
  return ACCRUAL_LABELS[frequency] ?? frequency;
}

export function ledgerKindLabel(kind: LeaveLedgerEntryKind): string {
  return LEDGER_LABELS[kind] ?? kind;
}

export function workingDaysLabel(days: number[]): string {
  return [...days]
    .sort((left, right) => left - right)
    .map((day) => WEEKDAYS[day] ?? String(day))
    .join(", ");
}

export function balancePeriodLabel(periodStart: string, periodEnd: string): string {
  return `${formatDay(periodStart, { year: undefined })} – ${formatDay(periodEnd)}`;
}

export function isLowBalance(balance: LeaveBalance): boolean {
  return balance.availableBalance <= LOW_BALANCE_THRESHOLD;
}

export function isZeroBalance(balance: LeaveBalance): boolean {
  return balance.availableBalance <= 0;
}

export function isCurrentBalancePeriod(
  periodStart: string,
  periodEnd: string,
  timeZone: string,
): boolean {
  const today = todayInTimeZone(timeZone);
  return periodStart <= today && today <= periodEnd;
}

export function isOwnLeaveRequest(
  request: { employeeId: string },
  currentUserId: string | undefined,
): boolean {
  return Boolean(currentUserId && request.employeeId === currentUserId);
}

export function findLeaveBalanceForDate(
  balances: readonly LeaveBalance[],
  leaveTypeId: string,
  date: string | null | undefined,
): LeaveBalance | undefined {
  if (!date) return undefined;
  return balances.find(
    (balance) =>
      balance.leaveTypeId === leaveTypeId &&
      balance.periodStart <= date &&
      date <= balance.periodEnd,
  );
}

/**
 * Advisory preview used to block obviously unaffordable requests before they
 * reach the API. The backend recalculates units, charged dates, and balances
 * from its own policy and holiday data.
 */
export function estimateLeaveUnits(options: {
  startDate: string;
  endDate: string;
  startHalfDay?: boolean;
  endHalfDay?: boolean;
  workingDays: readonly number[];
  holidays?: readonly string[];
  /** Holiday units per date (0.5 for a half-day holiday, 1 for a full day). */
  holidayUnits?: ReadonlyMap<string, number> | Readonly<Record<string, number>>;
}): number | null {
  const { startDate, endDate, startHalfDay, endHalfDay } = options;
  if (!isDateOnly(startDate) || !isDateOnly(endDate) || endDate < startDate) {
    return null;
  }
  if (startDate === endDate && startHalfDay && endHalfDay) return null;

  const workingDays = new Set(options.workingDays);
  if (workingDays.size === 0) return null;
  const holidays = new Set(options.holidays ?? []);
  const holidayUnits =
    options.holidayUnits instanceof Map
      ? options.holidayUnits
      : new Map(
          Object.entries(options.holidayUnits ?? {}).map(([date, units]) => [
            date,
            Number(units),
          ]),
        );
  const charged = new Map<string, number>();

  const end = new Date(`${endDate}T00:00:00.000Z`);
  for (
    let cursor = new Date(`${startDate}T00:00:00.000Z`);
    cursor <= end;
    cursor = new Date(cursor.getTime() + 86_400_000)
  ) {
    const date = cursor.toISOString().slice(0, 10);
    const weekday = cursor.getUTCDay() === 0 ? 7 : cursor.getUTCDay();
    const fraction = options.holidayUnits
      ? Math.min(1, Math.max(0, holidayUnits.get(date) ?? 0))
      : holidays.has(date)
        ? 1
        : 0;
    const chargeable = Math.round((1 - fraction) * 100) / 100;
    if (workingDays.has(weekday) && chargeable > 0) {
      charged.set(date, chargeable);
    }
  }

  if (startHalfDay) {
    if (!charged.has(startDate)) return null;
    charged.set(startDate, Math.min(charged.get(startDate) ?? 0.5, 0.5));
  }
  if (endHalfDay) {
    if (!charged.has(endDate)) return null;
    charged.set(endDate, Math.min(charged.get(endDate) ?? 0.5, 0.5));
  }
  if (charged.size === 0) return 0;

  const units = [...charged.values()].reduce((sum, value) => sum + value, 0);
  return Math.round((units + Number.EPSILON) * 100) / 100;
}

export function leaveDurationLabel(
  startHalfDay: boolean,
  endHalfDay: boolean,
  startDate: string,
  endDate: string,
): string {
  if (!startHalfDay && !endHalfDay) return "Full days";
  if (startDate === endDate) return "Half day";
  if (startHalfDay && endHalfDay) return "Half day at start and end";
  return startHalfDay ? "Half day at start" : "Half day at end";
}
