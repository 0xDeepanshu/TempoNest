import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LeaveBalancesView } from "@/components/leave-balances-view";
import { WorkspaceProvider } from "@/components/workspace";
import { apiRequest } from "@/lib/api-client";
import type {
  LeaveAccrualPreviewReport,
  LeaveBackfillPreview,
  LeaveBackfillResult,
  LeaveBalance,
  LeaveBulkAdjustmentPreview,
  LeaveBulkAdjustmentResult,
  LeaveLedgerEntry,
  LeaveLedgerResponse,
  LeavePolicySnapshot,
  LeaveReconciliationReport,
  LeaveReconciliationRepairResult,
  LeaveType,
  Organization,
  Role,
  SessionData,
} from "@/lib/types";

vi.mock("@/lib/api-client", () => ({
  apiRequest: vi.fn(),
}));

const mockedApiRequest = vi.mocked(apiRequest);

const organization: Organization = {
  id: "org-1",
  name: "TempoNest",
  slug: "temponest",
  status: "ACTIVE",
  timezone: "UTC",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function sessionFor(role: Role): SessionData {
  return {
    platformRole: null,
    user: {
      id: "admin-1",
      name: "Admin User",
      email: "admin@example.com",
      status: "ACTIVE",
      lastLoginAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    memberships: [
      {
        id: "membership-1",
        organizationId: organization.id,
        userId: "admin-1",
        role,
        status: "ACTIVE",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        organization,
      },
    ],
    session: {
      id: "session-1",
      transport: "cookie",
      accessExpiresAt: "2026-10-23T12:00:00.000Z",
      refreshExpiresAt: "2026-11-23T12:00:00.000Z",
    },
  };
}

const policySnapshot: LeavePolicySnapshot = {
  initialEntitlement: 20,
  accrualFrequency: "MONTHLY",
  accrualAmount: 2,
  accrualDayOfMonth: 1,
  accrualEffectiveFrom: "2026-01-01",
  prorateAccrual: true,
  balancePeriodStartMonth: 1,
  balancePeriodStartDay: 1,
  carryForwardAllowance: 0,
  maxBalance: null,
  prorateInitialEntitlement: false,
  isActive: true,
};

const leaveType: LeaveType = {
  id: "type-1",
  organizationId: organization.id,
  name: "Casual Leave",
  description: null,
  isActive: true,
  isPaid: true,
  requiresBalance: true,
  allowNegativeBalance: false,
  maxConsecutiveDays: null,
  minNoticeDays: 0,
  requiresDocumentation: false,
  allowApprovedCancellation: true,
  cancellationRequiresApproval: false,
  policy: {
    id: "policy-1",
    organizationId: organization.id,
    leaveTypeId: "type-1",
    ...policySnapshot,
    workingDays: [1, 2, 3, 4, 5],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const ledgerEntry: LeaveLedgerEntry = {
  id: "ledger-1",
  balanceId: "balance-1",
  leaveRequestId: null,
  kind: "INITIAL_ENTITLEMENT",
  accrualPeriod: null,
  entitledDelta: 20,
  accruedDelta: 0,
  adjustmentDelta: 0,
  carriedForwardDelta: 0,
  reservedDelta: 0,
  consumedDelta: 0,
  availableDelta: 20,
  balanceAfter: 20,
  reason: "Initial entitlement for balance period",
  actorUserId: null,
  metadata: null,
  actor: { id: "admin-1", name: "Admin User", email: "admin@example.com" },
  createdAt: "2026-01-01T00:00:01.000Z",
  updatedAt: "2026-01-01T00:00:01.000Z",
};

function balance(overrides: Partial<LeaveBalance> = {}): LeaveBalance {
  return {
    id: "balance-1",
    organizationId: organization.id,
    employeeId: "employee-1",
    leaveTypeId: "type-1",
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    entitledBalance: 20,
    accruedBalance: 0,
    adjustmentBalance: 0,
    carriedForwardBalance: 0,
    approvedConsumed: 2,
    pendingReserved: 1,
    availableBalance: 17,
    breakdown: {
      entitled: 20,
      accrued: 0,
      adjustments: 0,
      carriedForward: 0,
      approvedConsumed: 2,
      pendingReserved: 1,
      available: 17,
    },
    leaveType: {
      id: "type-1",
      name: "Casual Leave",
      isPaid: true,
      requiresBalance: true,
    },
    employee: {
      id: "employee-1",
      name: "Ada Lovelace",
      email: "ada@example.com",
    },
    ledger: [ledgerEntry],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const member = {
  id: "membership-employee-1",
  organizationId: organization.id,
  userId: "employee-1",
  role: "EMPLOYEE" as const,
  status: "ACTIVE" as const,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  user: {
    id: "employee-1",
    name: "Ada Lovelace",
    email: "ada@example.com",
    status: "ACTIVE" as const,
  },
};

function page(rows: LeaveBalance[]) {
  return {
    data: rows,
    meta: { page: 1, limit: 20, total: rows.length, totalPages: 1 },
    serverTime: "2026-10-23T10:00:00.000Z",
  };
}

const accrualPreview: LeaveAccrualPreviewReport = {
  asOf: "2026-10-27",
  timezone: "UTC",
  summary: { employees: 1, leaveTypes: 1, previews: 1, missingBalances: 0 },
  items: [
    {
      employee: { id: "employee-1", name: "Ada Lovelace", email: "ada@example.com" },
      leaveType: { id: "type-1", name: "Casual Leave" },
      balanceExists: true,
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      currentAvailable: 17,
      nextAccrualDate: "2026-11-01",
      nextAccrualAmount: 2,
      projectedAvailable: 19,
      accrualDayOfMonth: 1,
      accrualFrequency: "MONTHLY",
      accruedThisPeriod: 0,
    },
  ],
  truncated: false,
};

const bulkPreview: LeaveBulkAdjustmentPreview = {
  summary: { requested: 1, previewed: 1, failed: 0 },
  items: [
    {
      employeeId: "employee-1",
      ok: true,
      preview: {
        employeeId: "employee-1",
        leaveTypeId: "type-1",
        leaveTypeName: "Casual Leave",
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
        amount: 2,
        availableBefore: 17,
        availableAfter: 19,
        adjustmentBefore: 0,
        adjustmentAfter: 2,
        balanceExists: true,
      },
    },
  ],
};

const bulkResult: LeaveBulkAdjustmentResult = {
  batchId: "batch-bulk-1",
  summary: { requested: 1, adjusted: 1, failed: 0 },
  items: [
    {
      employeeId: "employee-1",
      ok: true,
      balanceId: "balance-1",
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      availableBalance: 19,
    },
  ],
};

const backfillPreview: LeaveBackfillPreview = {
  asOf: "2026-10-27",
  timezone: "UTC",
  summary: {
    employees: 1,
    leaveTypes: 1,
    candidates: 1,
    missing: 1,
    existing: 0,
    unconfiguredTypes: 0,
  },
  types: [
    {
      id: "type-1",
      name: "Casual Leave",
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      policy: policySnapshot,
    },
  ],
  unconfiguredTypes: [],
  items: [
    {
      employee: { id: "employee-1", name: "Ada Lovelace", email: "ada@example.com" },
      leaveType: { id: "type-1", name: "Casual Leave" },
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      balanceExists: false,
    },
  ],
  truncated: false,
};

const backfillResult: LeaveBackfillResult = {
  batchId: "batch-backfill-1",
  asOf: "2026-10-27",
  timezone: "UTC",
  summary: {
    employees: 1,
    initialized: 1,
    alreadyPresent: 0,
    failed: 0,
    unconfiguredTypes: 0,
  },
  employees: [
    {
      employeeId: "employee-1",
      employeeName: "Ada Lovelace",
      employeeEmail: "ada@example.com",
      initialized: [
        {
          leaveTypeId: "type-1",
          leaveTypeName: "Casual Leave",
          balanceId: "balance-1",
          availableBalance: 20,
        },
      ],
      alreadyPresent: [],
      failed: [],
    },
  ],
  unconfiguredTypes: [],
};

const reconciliationReport: LeaveReconciliationReport = {
  generatedAt: "2026-10-27T10:00:00.000Z",
  asOf: "2026-10-27",
  timezone: "UTC",
  summary: {
    balancesScanned: 2,
    groupsScanned: 1,
    groupsNeedingAttention: 1,
    overlappingGroups: 1,
    currentMissingGroups: 0,
    inactiveEmployeeGroups: 0,
    unconfiguredTypes: 0,
    unkeyedAccrualEntries: 0,
    safeToRemoveBalances: 1,
    manualReviewBalances: 1,
  },
  unconfiguredTypes: [],
  groups: [
    {
      employeeId: "employee-1",
      employeeName: "Ada Lovelace",
      employeeEmail: "ada@example.com",
      employeeActive: true,
      leaveTypeId: "type-1",
      leaveTypeName: "Casual Leave",
      policy: policySnapshot,
      canonicalPeriodStart: "2026-01-01",
      issues: ["OVERLAPPING_PERIODS"],
      balances: [
        {
          id: "balance-1",
          periodStart: "2026-01-01",
          periodEnd: "2026-12-31",
          canonical: true,
          zero: false,
          ledgerEntries: 1,
          requests: 0,
          safeToRemove: false,
          entitledBalance: 20,
          accruedBalance: 0,
          adjustmentBalance: 0,
          carriedForwardBalance: 0,
          approvedConsumed: 2,
          pendingReserved: 1,
          availableBalance: 17,
        },
        {
          id: "balance-legacy",
          periodStart: "2025-01-01",
          periodEnd: "2025-12-31",
          canonical: false,
          zero: true,
          ledgerEntries: 0,
          requests: 0,
          safeToRemove: true,
          entitledBalance: 0,
          accruedBalance: 0,
          adjustmentBalance: 0,
          carriedForwardBalance: 0,
          approvedConsumed: 0,
          pendingReserved: 0,
          availableBalance: 0,
        },
      ],
    },
  ],
};

const repairResult: LeaveReconciliationRepairResult = {
  batchId: "batch-repair-1",
  repaired: 1,
  failed: 0,
  results: [{ balanceId: "balance-legacy", repaired: true }],
};

type MockOptions = {
  balances?: LeaveBalance[];
  ledger?: LeaveLedgerResponse;
  accrual?: LeaveAccrualPreviewReport;
  bulkPreview?: LeaveBulkAdjustmentPreview;
  bulkResult?: LeaveBulkAdjustmentResult;
  backfill?: LeaveBackfillPreview;
  backfillResult?: LeaveBackfillResult;
  reconciliation?: LeaveReconciliationReport;
  repair?: LeaveReconciliationRepairResult;
};

function respond(options: MockOptions = {}) {
  const rows = options.balances ?? [balance()];
  mockedApiRequest.mockImplementation(async (path, requestOptions = {}) => {
    if (path === "/organizations/org-1/members") {
      return {
        data: [member],
        meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
        serverTime: "2026-10-23T10:00:00.000Z",
      };
    }
    if (path === "/organizations/org-1/leave/types") {
      return { data: [leaveType], serverTime: "2026-10-23T10:00:00.000Z" };
    }
    if (path === "/organizations/org-1/leave/balances") {
      return page(rows);
    }
    if (path === "/organizations/org-1/leave/balances/ledger") {
      return (
        options.ledger ?? {
          data: [ledgerEntry],
          meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
          serverTime: "2026-10-23T10:00:00.000Z",
        }
      );
    }
    if (path === "/organizations/org-1/leave/balances/accrual-preview") {
      return {
        data: options.accrual ?? accrualPreview,
        serverTime: "2026-10-23T10:00:00.000Z",
      };
    }
    if (path === "/organizations/org-1/leave/balances/backfill/preview") {
      return {
        data: options.backfill ?? backfillPreview,
        serverTime: "2026-10-23T10:00:00.000Z",
      };
    }
    if (
      path === "/organizations/org-1/leave/balances/backfill" &&
      requestOptions.method === "POST"
    ) {
      return {
        data: options.backfillResult ?? backfillResult,
        serverTime: "2026-10-23T10:00:00.000Z",
      };
    }
    if (path === "/organizations/org-1/leave/balances/reconciliation") {
      return {
        data: options.reconciliation ?? reconciliationReport,
        serverTime: "2026-10-23T10:00:00.000Z",
      };
    }
    if (
      path === "/organizations/org-1/leave/balances/reconciliation/repair" &&
      requestOptions.method === "POST"
    ) {
      return {
        data: options.repair ?? repairResult,
        serverTime: "2026-10-23T10:00:00.000Z",
      };
    }
    if (path === "/organizations/org-1/leave/balances/bulk-adjustments/preview") {
      return {
        data: options.bulkPreview ?? bulkPreview,
        serverTime: "2026-10-23T10:00:00.000Z",
      };
    }
    if (
      path === "/organizations/org-1/leave/balances/bulk-adjustments" &&
      requestOptions.method === "POST"
    ) {
      return {
        data: options.bulkResult ?? bulkResult,
        serverTime: "2026-10-23T10:00:00.000Z",
      };
    }
    if (path === "/organizations/org-1/leave/balances/employee-1/adjustments/preview") {
      const body = requestOptions.body as {
        leaveTypeId: string;
        amount: number;
        periodStart?: string;
      };
      const periodStart = body.periodStart ?? "2026-01-01";
      const historical = rows[0]!;
      return {
        data: {
          employeeId: "employee-1",
          leaveTypeId: body.leaveTypeId,
          leaveTypeName: "Casual Leave",
          periodStart,
          periodEnd:
            historical.periodStart === periodStart
              ? historical.periodEnd
              : "2025-12-31",
          amount: body.amount,
          availableBefore: 17,
          availableAfter: 17 + body.amount,
          adjustmentBefore: 0,
          adjustmentAfter: body.amount,
          balanceExists: true,
        },
        serverTime: "2026-10-23T10:00:00.000Z",
      };
    }
    if (
      path === "/organizations/org-1/leave/balances/employee-1/adjustments" &&
      requestOptions.method === "POST"
    ) {
      const body = requestOptions.body as { amount: number };
      return {
        data: {
          balance: balance({
            adjustmentBalance: body.amount,
            availableBalance: 17 + body.amount,
          }),
        },
        serverTime: "2026-10-23T10:00:00.000Z",
      };
    }
    if (path === "/organizations/org-1/leave/balances/employee-1") {
      return {
        data: { employeeId: "employee-1", timezone: "UTC", balances: rows },
        serverTime: "2026-10-23T10:00:00.000Z",
      };
    }
    throw new Error(`Unexpected request: ${path} ${requestOptions.method ?? "GET"}`);
  });
}

function renderView(role: Role = "ADMIN") {
  return render(
    <WorkspaceProvider session={sessionFor(role)}>
      <LeaveBalancesView />
    </WorkspaceProvider>,
  );
}

async function openBalance(user: ReturnType<typeof userEvent.setup>) {
  const viewButtons = await screen.findAllByRole("button", { name: "View" });
  await user.click(viewButtons[0]!);
  const dialog = await screen.findByRole("dialog");
  await within(dialog).findByText("Balance breakdown");
  return dialog;
}

describe("LeaveBalancesView", () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
  });

  it("requires leave:manage to inspect organization balances", () => {
    renderView("MANAGER");

    expect(
      screen.getByText("Balance management requires leave:manage"),
    ).toBeInTheDocument();
    expect(mockedApiRequest).not.toHaveBeenCalled();
  });

  it("previews and then confirms a period-aware adjustment", async () => {
    const user = userEvent.setup();
    respond();
    renderView();
    const dialog = await openBalance(user);

    await user.click(within(dialog).getByRole("button", { name: "Adjust this period" }));
    fireEvent.change(within(dialog).getByLabelText(/Amount \(days\)/), {
      target: { value: "-3" },
    });
    await user.type(
      within(dialog).getByLabelText(/^Reason/),
      "Correction agreed with employee",
    );

    expect(
      within(dialog).getByRole("button", { name: "Confirm adjustment" }),
    ).toBeDisabled();

    await user.click(
      within(dialog).getByRole("button", { name: "Preview adjustment" }),
    );

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/leave/balances/employee-1/adjustments/preview",
        {
          method: "POST",
          body: {
            leaveTypeId: "type-1",
            amount: -3,
            reason: "Correction agreed with employee",
            periodStart: "2026-01-01",
          },
        },
      );
    });
    expect(await within(dialog).findByText("17 days → 14 days")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Confirm adjustment" }),
    ).toBeEnabled();

    await user.click(
      within(dialog).getByRole("button", { name: "Confirm adjustment" }),
    );

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/leave/balances/employee-1/adjustments",
        {
          method: "POST",
          body: {
            leaveTypeId: "type-1",
            amount: -3,
            reason: "Correction agreed with employee",
            periodStart: "2026-01-01",
          },
        },
      );
    });
    expect(
      await within(dialog).findByText(/Balance adjustment recorded/),
    ).toBeInTheDocument();

    await waitFor(() => {
      const listCalls = mockedApiRequest.mock.calls.filter(
        ([path]) => path === "/organizations/org-1/leave/balances",
      );
      expect(listCalls.length).toBeGreaterThan(1);
    });
  });

  it("allows adjusting an existing historical period through the same preview flow", async () => {
    const user = userEvent.setup();
    respond({
      balances: [balance({ periodStart: "2025-01-01", periodEnd: "2025-12-31" })],
    });
    renderView();
    const dialog = await openBalance(user);

    expect(within(dialog).getByText("Not the current period")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Adjust this period" }));
    fireEvent.change(within(dialog).getByLabelText(/Amount \(days\)/), {
      target: { value: "5" },
    });
    await user.type(within(dialog).getByLabelText(/^Reason/), "Historic correction");
    await user.click(
      within(dialog).getByRole("button", { name: "Preview adjustment" }),
    );

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/leave/balances/employee-1/adjustments/preview",
        {
          method: "POST",
          body: {
            leaveTypeId: "type-1",
            amount: 5,
            reason: "Historic correction",
            periodStart: "2025-01-01",
          },
        },
      );
    });
  });

  it("shows frozen figures and ledger history with the actor", async () => {
    const user = userEvent.setup();
    respond();
    renderView();
    const dialog = await openBalance(user);

    expect(within(dialog).getAllByText("17 days").length).toBeGreaterThan(0);
    expect(within(dialog).getByText("Pending approval")).toBeInTheDocument();
    expect(within(dialog).getByText("Initial entitlement")).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Initial entitlement for balance period/),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/Admin User/)).toBeInTheDocument();

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/leave/balances/ledger",
        {
          signal: expect.any(AbortSignal),
          query: {
            page: 1,
            limit: 20,
            employeeId: "employee-1",
            leaveTypeId: "type-1",
            periodStart: "2026-01-01",
          },
        },
      );
    });
  });

  it("shows the next scheduled accrual and projected impact without writes", async () => {
    respond();
    renderView();

    expect(await screen.findByText("Next accrual")).toBeInTheDocument();
    expect(await screen.findByText("Nov 1, 2026")).toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(screen.getByText("19 days")).toBeInTheDocument();

    const writes = mockedApiRequest.mock.calls.filter(
      ([, options]) => options?.method === "POST",
    );
    expect(writes).toHaveLength(0);
  });

  it("previews and confirms a bulk adjustment with per-employee results", async () => {
    const user = userEvent.setup();
    respond();
    renderView();

    await user.click(await screen.findByRole("button", { name: "Bulk adjust" }));
    const dialog = await screen.findByRole("dialog");

    const picker = within(dialog).getByLabelText("Employees");
    await user.click(picker);
    await user.type(picker, "Ada");
    const option = await within(dialog).findByRole("option", { name: /Ada Lovelace/ });
    await user.click(option);

    await user.selectOptions(within(dialog).getByLabelText("Leave type"), "type-1");
    await user.type(within(dialog).getByLabelText(/Amount \(days\)/), "2");
    await user.type(within(dialog).getByLabelText(/^Reason/), "Quarterly bonus");

    const confirmButton = within(dialog).getByRole("button", {
      name: "Confirm adjustments",
    });
    expect(confirmButton).toBeDisabled();

    await user.click(
      within(dialog).getByRole("button", { name: "Preview adjustments" }),
    );

    expect(
      await within(dialog).findByText(/Nothing has been written yet\./),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("17 days → 19 days")).toBeInTheDocument();
    expect(confirmButton).toBeEnabled();

    await user.click(confirmButton);

    expect(
      await within(dialog).findByText(/1 of 1 employees adjusted\./),
    ).toBeInTheDocument();
    expect(within(dialog).getAllByText("Ada Lovelace").length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/leave/balances/bulk-adjustments",
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({
            employeeIds: ["employee-1"],
            leaveTypeId: "type-1",
            amount: 2,
            reason: "Quarterly bonus",
            confirm: true,
          }),
        }),
      );
    });
  });

  it("requires an explicit confirmation before initializing balances", async () => {
    const user = userEvent.setup();
    respond();
    renderView();

    await user.click(await screen.findByRole("button", { name: "Preview backfill" }));
    const dialog = await screen.findByRole("dialog");

    expect(await within(dialog).findByText("Will initialize")).toBeInTheDocument();
    const applyButton = within(dialog).getByRole("button", {
      name: "Initialize 1 balance",
    });
    expect(applyButton).toBeDisabled();

    expect(
      mockedApiRequest.mock.calls.some(
        ([path, options]) =>
          path === "/organizations/org-1/leave/balances/backfill" &&
          options?.method === "POST",
      ),
    ).toBe(false);

    await user.click(
      within(dialog).getByRole("checkbox", { name: /I understand this creates/ }),
    );
    expect(applyButton).toBeEnabled();
    await user.click(applyButton);

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/leave/balances/backfill",
        {
          method: "POST",
          body: { confirm: true },
        },
      );
    });
    const resultAlert = await within(dialog).findByRole("status");
    expect(resultAlert).toHaveTextContent("1 initialized");
  });

  it("only removes selected empty duplicate rows during reconciliation", async () => {
    const user = userEvent.setup();
    respond();
    renderView();

    await user.click(await screen.findByRole("button", { name: "Scan balances" }));
    const dialog = await screen.findByRole("dialog");

    expect(await within(dialog).findByText("Overlapping periods")).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: /Select all safe to remove/ }),
    );

    const removeButton = within(dialog).getByRole("button", {
      name: "Remove 1 selected row",
    });
    expect(removeButton).toBeDisabled();

    await user.click(
      within(dialog).getByRole("checkbox", {
        name: /I understand only the selected/,
      }),
    );
    expect(removeButton).toBeEnabled();
    await user.click(removeButton);

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/leave/balances/reconciliation/repair",
        {
          method: "POST",
          body: { balanceIds: ["balance-legacy"], confirm: true },
        },
      );
    });
    expect(await within(dialog).findByText(/1 removed/)).toBeInTheDocument();
  });
});
