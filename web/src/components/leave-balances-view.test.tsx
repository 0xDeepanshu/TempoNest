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
  LeaveCreditAssignmentPreview,
  LeaveCreditAssignmentResult,
  LeaveLedgerEntry,
  LeaveLedgerResponse,
  LeaveOverview,
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
  name: "WorkZen",
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
  allowHalfDay: true,
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
    assignedBalance: 20,
    breakdown: {
      assigned: 20,
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

function overview(overrides: Partial<LeaveOverview> = {}): LeaveOverview {
  return {
    timezone: "UTC",
    anchorDate: "2026-10-27",
    leaveTypes: 1,
    activeEmployees: 3,
    employeesWithBalances: 1,
    totalCreditsAssigned: 20,
    approvedConsumed: 2,
    pendingReserved: 1,
    availableCredits: 17,
    pendingApplications: 1,
    pendingCancellations: 0,
    accrualConfigured: false,
    ...overrides,
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

const creditPreview: LeaveCreditAssignmentPreview = {
  mode: "ADD",
  scope: "SELECTED",
  leaveType: { id: "type-1", name: "Casual Leave" },
  periodStart: "2026-01-01",
  periodEnd: "2026-12-31",
  summary: { selected: 1, previewed: 1, unchanged: 0, failed: 0 },
  items: [
    {
      employeeId: "employee-1",
      employeeName: "Ada Lovelace",
      ok: true,
      leaveTypeId: "type-1",
      leaveTypeName: "Casual Leave",
      mode: "ADD",
      amount: 5,
      unchanged: false,
      assignedBefore: 20,
      assignedAfter: 25,
      used: 2,
      pending: 1,
      availableBefore: 17,
      availableAfter: 22,
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
    },
  ],
};

const creditResult: LeaveCreditAssignmentResult = {
  batchId: "batch-credits-1",
  mode: "ADD",
  scope: "SELECTED",
  leaveType: { id: "type-1", name: "Casual Leave" },
  summary: { requested: 1, applied: 1, unchanged: 0, failed: 0 },
  items: [
    {
      employeeId: "employee-1",
      employeeName: "Ada Lovelace",
      ok: true,
      leaveTypeId: "type-1",
      leaveTypeName: "Casual Leave",
      mode: "ADD",
      amount: 5,
      unchanged: false,
      assignedBefore: 20,
      assignedAfter: 25,
      used: 2,
      pending: 1,
      availableBefore: 17,
      availableAfter: 22,
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
    },
  ],
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
  overview?: LeaveOverview;
  ledger?: LeaveLedgerResponse;
  accrual?: LeaveAccrualPreviewReport;
  creditPreview?: LeaveCreditAssignmentPreview;
  creditResult?: LeaveCreditAssignmentResult;
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
    if (path === "/organizations/org-1/leave/overview") {
      return {
        data: options.overview ?? overview(),
        serverTime: "2026-10-23T10:00:00.000Z",
      };
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
    if (path === "/organizations/org-1/leave/credits/preview") {
      return {
        data: options.creditPreview ?? creditPreview,
        serverTime: "2026-10-23T10:00:00.000Z",
      };
    }
    if (
      path === "/organizations/org-1/leave/credits" &&
      requestOptions.method === "POST"
    ) {
      return {
        data: options.creditResult ?? creditResult,
        serverTime: "2026-10-23T10:00:00.000Z",
      };
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
  await within(dialog).findByText("How this balance is calculated");
  return dialog;
}

async function addEmployee(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
) {
  const picker = within(dialog).getByLabelText("Employees");
  await user.click(picker);
  await user.type(picker, "Ada");
  const option = await within(dialog).findByRole("option", { name: /Ada Lovelace/ });
  await user.click(option);
}

function byParagraph(text: string) {
  return (_content: string, element: Element | null) =>
    element?.tagName === "P" && element.textContent === text;
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

  it("shows overview figures, simplified balances, and credit history", async () => {
    respond();
    renderView();

    expect(await screen.findByText("Active employees")).toBeInTheDocument();
    expect(screen.getByText("Employees with credits")).toBeInTheDocument();
    expect(screen.getByText("Credits assigned")).toBeInTheDocument();
    expect(screen.getByText("Pending applications")).toBeInTheDocument();

    for (const header of ["Assigned", "Used", "Pending", "Available"]) {
      expect(screen.getAllByText(header).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText("Ada Lovelace").length).toBeGreaterThan(0);
    expect(await screen.findByText("Credit history")).toBeInTheDocument();
    expect(screen.getAllByText("Starting credits").length).toBeGreaterThan(0);
  });

  it("assigns credits to selected employees after an explicit preview", async () => {
    const user = userEvent.setup();
    respond();
    renderView();

    await user.click(await screen.findByRole("button", { name: "Assign leave credits" }));
    const dialog = await screen.findByRole("dialog");

    await addEmployee(user, dialog);
    await user.type(within(dialog).getByLabelText(/^Credits to add/), "5");
    await user.type(within(dialog).getByLabelText(/^Reason/), "Annual allocation");

    const confirmButton = within(dialog).getByRole("button", {
      name: "Confirm and assign",
    });
    expect(confirmButton).toBeDisabled();
    expect(
      mockedApiRequest.mock.calls.some(
        ([path]) => path === "/organizations/org-1/leave/credits",
      ),
    ).toBe(false);

    await user.click(within(dialog).getByRole("button", { name: "Preview changes" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/leave/credits/preview",
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({
            leaveTypeId: "type-1",
            mode: "ADD",
            credits: 5,
            employeeIds: ["employee-1"],
            reason: "Annual allocation",
          }),
        }),
      );
    });
    expect(await within(dialog).findByText("20 days → 25 days")).toBeInTheDocument();
    expect(confirmButton).toBeEnabled();

    await user.click(confirmButton);

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/leave/credits",
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({
            leaveTypeId: "type-1",
            mode: "ADD",
            credits: 5,
            employeeIds: ["employee-1"],
            confirm: true,
          }),
        }),
      );
    });
    expect(
      await within(dialog).findByText(/1 of 1 employees received credits/),
    ).toBeInTheDocument();
  });

  it("sets the balance for every active employee", async () => {
    const user = userEvent.setup();
    respond();
    renderView();

    await user.click(await screen.findByRole("button", { name: "Assign leave credits" }));
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("radio", { name: /All active employees/ }));
    await user.click(within(dialog).getByRole("radio", { name: /Set balance/ }));
    expect(within(dialog).queryByLabelText("Employees")).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/^New assigned total/), {
      target: { value: "18" },
    });
    await user.type(within(dialog).getByLabelText(/^Reason/), "Standard annual grant");

    await user.click(within(dialog).getByRole("button", { name: "Preview changes" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/leave/credits/preview",
        expect.objectContaining({
          body: expect.objectContaining({
            mode: "SET",
            credits: 18,
            allActive: true,
            reason: "Standard annual grant",
          }),
        }),
      );
    });
    const previewBody = mockedApiRequest.mock.calls.find(
      ([path]) => path === "/organizations/org-1/leave/credits/preview",
    )?.[1]?.body as Record<string, unknown>;
    expect(previewBody).not.toHaveProperty("employeeIds");
    expect(previewBody).toHaveProperty("allActive", true);
  });

  it("reports employees that could not receive credits without hiding the rest", async () => {
    const user = userEvent.setup();
    respond({
      creditResult: {
        ...creditResult,
        summary: { requested: 2, applied: 1, unchanged: 0, failed: 1 },
        items: [
          ...creditResult.items,
          {
            employeeId: "employee-2",
            employeeName: "Grace Hopper",
            ok: false,
            message: "This leave type is not active.",
            code: "LEAVE_TYPE_INACTIVE",
          },
        ],
      },
    });
    renderView();

    await user.click(await screen.findByRole("button", { name: "Assign leave credits" }));
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("radio", { name: /All active employees/ }));
    await user.type(within(dialog).getByLabelText(/^Credits to add/), "5");
    await user.type(within(dialog).getByLabelText(/^Reason/), "Annual allocation");
    await user.click(within(dialog).getByRole("button", { name: "Preview changes" }));
    await within(dialog).findByText("20 days → 25 days");
    await user.click(within(dialog).getByRole("button", { name: "Confirm and assign" }));

    expect(
      await within(dialog).findByText(/1 of 2 employees received credits/),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/1 could not be updated/)).toBeInTheDocument();
    expect(within(dialog).getByText("This leave type is not active.")).toBeInTheDocument();
    expect(within(dialog).getByText("LEAVE_TYPE_INACTIVE")).toBeInTheDocument();
    expect(within(dialog).getByText("Grace Hopper")).toBeInTheDocument();
  });

  it("explains an employee balance with assigned, used, pending, and available", async () => {
    const user = userEvent.setup();
    respond();
    renderView();
    const dialog = await openBalance(user);

    expect(within(dialog).getByText("Credit sources")).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        byParagraph("20 days assigned − 2 days used − 1 day pending = 17 days available"),
      ),
    ).toBeInTheDocument();
    expect((await within(dialog).findAllByText("Starting credits")).length).toBeGreaterThan(0);
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

  it("adds credits to one employee from the balance detail", async () => {
    const user = userEvent.setup();
    respond();
    renderView();
    const dialog = await openBalance(user);

    await user.click(within(dialog).getByRole("button", { name: "Assign credits" }));
    await user.type(within(dialog).getByLabelText(/^Credits to add/), "3");
    await user.type(within(dialog).getByLabelText(/^Reason/), "Compensation for holiday work");

    await user.click(within(dialog).getByRole("button", { name: "Preview changes" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/leave/credits/preview",
        expect.objectContaining({
          body: expect.objectContaining({
            leaveTypeId: "type-1",
            mode: "ADD",
            credits: 3,
            employeeIds: ["employee-1"],
            effectiveDate: "2026-01-01",
            reason: "Compensation for holiday work",
          }),
        }),
      );
    });
    expect(await within(dialog).findByText("20 days → 25 days")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Confirm and save" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/leave/credits",
        expect.objectContaining({
          body: expect.objectContaining({
            employeeIds: ["employee-1"],
            confirm: true,
          }),
        }),
      );
    });
    expect(
      await within(dialog).findByText(
        "Credits updated. The change is recorded in the balance history.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps scheduled accrual preview in advanced maintenance when configured", async () => {
    const user = userEvent.setup();
    respond({ overview: overview({ accrualConfigured: true }) });
    renderView();

    await user.click(await screen.findByText("Advanced maintenance"));

    expect((await screen.findAllByText("Next accrual")).length).toBeGreaterThan(0);
    expect(screen.getByText("Nov 1, 2026")).toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(screen.getByText("19 days")).toBeInTheDocument();

    const writes = mockedApiRequest.mock.calls.filter(
      ([, options]) => options?.method === "POST",
    );
    expect(writes).toHaveLength(0);
  });

  it("previews and confirms a bulk adjustment from advanced maintenance", async () => {
    const user = userEvent.setup();
    respond();
    renderView();

    await user.click(await screen.findByText("Advanced maintenance"));
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

    await user.click(await screen.findByText("Advanced maintenance"));
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

    await user.click(await screen.findByText("Advanced maintenance"));
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
