import { describe, expect, it } from "vitest";
import {
  estimateLeaveUnits,
  findLeaveBalanceForDate,
  leaveDurationLabel,
} from "@/lib/leave";
import type { LeaveBalance } from "@/lib/types";

const MONDAY_TO_FRIDAY = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"] as const;

function balance(overrides: Partial<LeaveBalance> = {}): LeaveBalance {
  return {
    id: "balance-1",
    organizationId: "org-1",
    employeeId: "employee-1",
    leaveTypeId: "type-1",
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    entitledBalance: 20,
    accruedBalance: 0,
    adjustmentBalance: 0,
    carriedForwardBalance: 0,
    approvedConsumed: 0,
    pendingReserved: 0,
    availableBalance: 20,
    breakdown: {
      entitled: 20,
      accrued: 0,
      adjustments: 0,
      carriedForward: 0,
      approvedConsumed: 0,
      pendingReserved: 0,
      available: 20,
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("estimateLeaveUnits", () => {
  it("counts working days for a full-week request", () => {
    expect(
      estimateLeaveUnits({
        startDate: MONDAY_TO_FRIDAY[0],
        endDate: MONDAY_TO_FRIDAY[4],
        workingDays: [1, 2, 3, 4, 5],
      }),
    ).toBe(5);
  });

  it("excludes organization holidays", () => {
    expect(
      estimateLeaveUnits({
        startDate: MONDAY_TO_FRIDAY[0],
        endDate: MONDAY_TO_FRIDAY[4],
        workingDays: [1, 2, 3, 4, 5],
        holidays: ["2026-11-04"],
      }),
    ).toBe(4);
  });

  it("charges only the working half of a half-day holiday", () => {
    expect(
      estimateLeaveUnits({
        startDate: MONDAY_TO_FRIDAY[0],
        endDate: MONDAY_TO_FRIDAY[4],
        workingDays: [1, 2, 3, 4, 5],
        holidayUnits: new Map([["2026-11-04", 0.5]]),
      }),
    ).toBe(4.5);
  });

  it("keeps a half-day request on a half-day holiday at half a day", () => {
    expect(
      estimateLeaveUnits({
        startDate: "2026-11-04",
        endDate: "2026-11-04",
        startHalfDay: true,
        workingDays: [1, 2, 3, 4, 5],
        holidayUnits: { "2026-11-04": 0.5 },
      }),
    ).toBe(0.5);
  });

  it("charges half days on the first and last day", () => {
    expect(
      estimateLeaveUnits({
        startDate: MONDAY_TO_FRIDAY[0],
        endDate: MONDAY_TO_FRIDAY[4],
        startHalfDay: true,
        endHalfDay: true,
        workingDays: [1, 2, 3, 4, 5],
      }),
    ).toBe(4);
  });

  it("returns zero when the range has no chargeable working days", () => {
    expect(
      estimateLeaveUnits({
        startDate: "2026-11-07",
        endDate: "2026-11-08",
        workingDays: [1, 2, 3, 4, 5],
      }),
    ).toBe(0);
  });

  it("rejects a half day on a non-chargeable day", () => {
    expect(
      estimateLeaveUnits({
        startDate: "2026-11-07",
        endDate: "2026-11-07",
        startHalfDay: true,
        workingDays: [1, 2, 3, 4, 5],
      }),
    ).toBeNull();
  });

  it("rejects invalid or reversed date ranges", () => {
    expect(
      estimateLeaveUnits({
        startDate: "2026-11-06",
        endDate: "2026-11-02",
        workingDays: [1, 2, 3, 4, 5],
      }),
    ).toBeNull();
    expect(
      estimateLeaveUnits({
        startDate: "not-a-date",
        endDate: "2026-11-02",
        workingDays: [1, 2, 3, 4, 5],
      }),
    ).toBeNull();
  });
});

describe("findLeaveBalanceForDate", () => {
  it("matches the balance period that contains the requested date", () => {
    const balances = [
      balance({ id: "old", periodStart: "2025-01-01", periodEnd: "2025-12-31" }),
      balance({ id: "current", periodStart: "2026-01-01", periodEnd: "2026-12-31" }),
    ];
    expect(findLeaveBalanceForDate(balances, "type-1", "2026-11-02")?.id).toBe("current");
    expect(findLeaveBalanceForDate(balances, "type-2", "2026-11-02")).toBeUndefined();
    expect(findLeaveBalanceForDate(balances, "type-1", null)).toBeUndefined();
  });
});

describe("leaveDurationLabel", () => {
  it("describes full-day and half-day requests", () => {
    expect(leaveDurationLabel(false, false, "2026-11-02", "2026-11-06")).toBe("Full days");
    expect(leaveDurationLabel(true, false, "2026-11-02", "2026-11-02")).toBe("Half day");
    expect(leaveDurationLabel(true, false, "2026-11-02", "2026-11-06")).toBe(
      "Half day at start",
    );
    expect(leaveDurationLabel(false, true, "2026-11-02", "2026-11-06")).toBe(
      "Half day at end",
    );
    expect(leaveDurationLabel(true, true, "2026-11-02", "2026-11-06")).toBe(
      "Half day at start and end",
    );
  });
});
