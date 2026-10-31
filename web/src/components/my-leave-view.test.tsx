import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MyLeaveView } from "@/components/my-leave-view";
import { WorkspaceProvider } from "@/components/workspace";
import { apiRequest } from "@/lib/api-client";
import { addDays, todayInTimeZone } from "@/lib/format";
import type {
  LeaveBalance,
  LeaveHoliday,
  LeaveRequest,
  LeaveType,
  Organization,
  SessionData,
} from "@/lib/types";

vi.mock("@/lib/api-client", () => ({
  apiRequest: vi.fn(),
}));

const mockedApiRequest = vi.mocked(apiRequest);

const SERVER_TIME = "2026-10-23T10:00:00.000Z";

const organization: Organization = {
  id: "org-1",
  name: "TempoNest",
  slug: "temponest",
  status: "ACTIVE",
  timezone: "UTC",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function sessionFor(role: SessionData["memberships"][number]["role"]): SessionData {
  return {
    platformRole: null,
    user: {
      id: "employee-1",
      name: "Ada Lovelace",
      email: "ada@example.com",
      status: "ACTIVE",
      lastLoginAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    memberships: [
      {
        id: "membership-1",
        organizationId: organization.id,
        userId: "employee-1",
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

function makeType(overrides: Partial<LeaveType> = {}): LeaveType {
  return {
    id: "type-1",
    organizationId: organization.id,
    name: "Casual Leave",
    description: "Personal time off",
    isActive: true,
    isPaid: true,
    requiresBalance: true,
    allowNegativeBalance: false,
    maxConsecutiveDays: 10,
    minNoticeDays: 0,
    requiresDocumentation: false,
    allowApprovedCancellation: true,
    cancellationRequiresApproval: false,
    policy: {
      id: "policy-1",
      organizationId: organization.id,
      leaveTypeId: "type-1",
      initialEntitlement: 20,
      accrualFrequency: "NONE",
      accrualAmount: 0,
      accrualDayOfMonth: 1,
      accrualEffectiveFrom: null,
      prorateAccrual: false,
      balancePeriodStartMonth: 1,
      balancePeriodStartDay: 1,
      carryForwardAllowance: 0,
      maxBalance: null,
      prorateInitialEntitlement: false,
      workingDays: [1, 2, 3, 4, 5],
      isActive: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const leaveType = makeType();

function currentPeriod() {
  const year = Number(todayInTimeZone("UTC").slice(0, 4));
  return { periodStart: `${year}-01-01`, periodEnd: `${year + 1}-12-31` };
}

function makeBalance(overrides: Partial<LeaveBalance> = {}): LeaveBalance {
  const period = currentPeriod();
  return {
    id: "balance-1",
    organizationId: organization.id,
    employeeId: "employee-1",
    leaveTypeId: "type-1",
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    entitledBalance: 20,
    accruedBalance: 0,
    adjustmentBalance: 2,
    carriedForwardBalance: 0,
    approvedConsumed: 0,
    pendingReserved: 5,
    availableBalance: 17,
    breakdown: {
      entitled: 20,
      accrued: 0,
      adjustments: 2,
      carriedForward: 0,
      approvedConsumed: 0,
      pendingReserved: 5,
      available: 17,
    },
    leaveType: {
      id: "type-1",
      name: "Casual Leave",
      isPaid: true,
      requiresBalance: true,
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const balance = makeBalance();

function makeRequest(overrides: Partial<LeaveRequest> = {}): LeaveRequest {
  const period = currentPeriod();
  const startDate = overrides.startDate ?? upcomingMonday();
  const endDate = overrides.endDate ?? addDays(startDate, 4);
  return {
    id: "request-1",
    organizationId: organization.id,
    employeeId: "employee-1",
    leaveTypeId: "type-1",
    startDate,
    endDate,
    startHalfDay: false,
    endHalfDay: false,
    units: 5,
    chargedDates: [],
    balancePeriodStart: period.periodStart,
    reason: "Family trip.",
    documentationReference: null,
    status: "PENDING",
    idempotencyKey: null,
    submittedAt: "2026-10-20T09:00:00.000Z",
    reviewedAt: null,
    reviewedByUserId: null,
    reviewerNote: null,
    rejectionReason: null,
    cancellationRequestedAt: null,
    cancelledAt: null,
    cancelledByUserId: null,
    cancellationReason: null,
    leaveType: {
      id: "type-1",
      name: "Casual Leave",
      isPaid: true,
      requiresBalance: true,
    },
    createdAt: "2026-10-20T09:00:00.000Z",
    updatedAt: "2026-10-20T09:00:00.000Z",
    ...overrides,
  };
}

function upcomingMonday(): string {
  let date = addDays(todayInTimeZone("UTC"), 7);
  while (new Date(`${date}T00:00:00.000Z`).getUTCDay() !== 1) {
    date = addDays(date, 1);
  }
  return date;
}

function page(rows: LeaveRequest[]) {
  return {
    data: rows,
    meta: { page: 1, limit: 10, total: rows.length, totalPages: 1 },
    serverTime: SERVER_TIME,
  };
}

function mockApi(options: {
  types?: LeaveType[];
  balances?: LeaveBalance[];
  requests?: LeaveRequest[];
  holidays?: LeaveHoliday[];
  onPost?: (body: Record<string, unknown>) => LeaveRequest;
  onCancel?: (requestId: string, body: Record<string, unknown>) => LeaveRequest;
}) {
  mockedApiRequest.mockImplementation(async (path, init) => {
    if (path === "/organizations/org-1/leave/types") {
      return { data: options.types ?? [leaveType], serverTime: SERVER_TIME };
    }
    if (path === "/organizations/org-1/leave/balances/me") {
      return {
        data: {
          employeeId: "employee-1",
          timezone: "UTC",
          balances: options.balances ?? [balance],
        },
        serverTime: SERVER_TIME,
      };
    }
    if (path === "/organizations/org-1/holidays") {
      return {
        data: {
          holidays: (options.holidays ?? []).map((holiday) => ({
            id: holiday.id,
            organizationId: holiday.organizationId,
            holidayDate: holiday.holidayDate,
            name: holiday.name,
            category: "PUBLIC",
            duration: "FULL_DAY",
            description: null,
            appliesToAll: true,
            applicableEmployeeIds: [],
            departmentIds: [],
            locationIds: [],
            createdByUserId: null,
            updatedByUserId: null,
            createdBy: null,
            updatedBy: null,
            createdAt: holiday.createdAt,
            updatedAt: holiday.updatedAt,
          })),
          settings: {
            id: "settings-1",
            organizationId: "org-1",
            enabled: true,
            optionalHolidaysEnabled: true,
            allowHalfDayHolidays: true,
            defaultCalendarYear: null,
            defaultApplicability: "ORGANIZATION",
            workingDays: [1, 2, 3, 4, 5],
            updatedByUserId: null,
            updatedBy: null,
            updatedAt: SERVER_TIME,
          },
          year: 2026,
          from: "2026-01-01",
          to: "2026-12-31",
          total: options.holidays?.length ?? 0,
        },
        serverTime: SERVER_TIME,
      };
    }
    if (path === "/organizations/org-1/leave/requests" && init?.method === "POST") {
      const body = init.body as Record<string, unknown>;
      const created = options.onPost?.(body) ?? makeRequest();
      return { data: { request: created }, serverTime: SERVER_TIME };
    }
    if (path === "/organizations/org-1/leave/requests") {
      return page(options.requests ?? []);
    }
    if (
      path.startsWith("/organizations/org-1/leave/requests/") &&
      path.endsWith("/cancel") &&
      init?.method === "POST"
    ) {
      const requestId = path.split("/").at(-2) ?? "request-1";
      const body = (init.body ?? {}) as Record<string, unknown>;
      const updated =
        options.onCancel?.(requestId, body) ??
        makeRequest({ id: requestId, status: "CANCELLED" });
      return { data: { request: updated }, serverTime: SERVER_TIME };
    }
    throw new Error(`Unexpected request: ${path} ${init?.method ?? "GET"}`);
  });
}

function renderView() {
  return render(
    <WorkspaceProvider session={sessionFor("EMPLOYEE")}>
      <MyLeaveView />
    </WorkspaceProvider>,
  );
}

async function openApply() {
  const user = userEvent.setup();
  renderView();
  const buttons = await screen.findAllByRole("button", { name: "Apply for leave" });
  await user.click(buttons[0]);
  return { user, dialog: screen.getByRole("dialog") };
}

function fillApplyForm(
  dialog: HTMLElement,
  dates: { startDate: string; endDate: string },
  remark = "Family trip.",
) {
  fireEvent.change(within(dialog).getByLabelText(/Start date/), {
    target: { value: dates.startDate },
  });
  fireEvent.change(within(dialog).getByLabelText(/End date/), {
    target: { value: dates.endDate },
  });
  fireEvent.change(within(dialog).getByLabelText(/Remarks/), {
    target: { value: remark },
  });
}

function submitApplyForm(dialog: HTMLElement) {
  const form = dialog.querySelector("form");
  expect(form).not.toBeNull();
  fireEvent.submit(form!);
}

function postCalls() {
  return mockedApiRequest.mock.calls.filter(
    ([path, init]) =>
      path === "/organizations/org-1/leave/requests" && init?.method === "POST",
  );
}

describe("MyLeaveView", () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
  });

  it("shows balance breakdowns and reviewer feedback for the employee's own requests", async () => {
    const user = userEvent.setup();
    mockApi({
      requests: [
        makeRequest({
          status: "REJECTED",
          reviewerNote: "No coverage that week.",
          rejectionReason: "Team is short-staffed.",
          reviewer: {
            id: "admin-1",
            name: "Admin User",
            email: "admin@example.com",
          },
        }),
      ],
    });

    renderView();

    expect(await screen.findByText("Available balances")).toBeInTheDocument();
    expect(screen.getByText("Entitled")).toBeInTheDocument();
    expect(screen.getByText("Accrued")).toBeInTheDocument();
    expect(screen.getAllByText("17 days").length).toBeGreaterThan(0);
    expect(screen.getByText("+2")).toBeInTheDocument();

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Rejected")).toBeInTheDocument();

    await user.click(within(table).getByRole("button", { name: "Details" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("No coverage that week.")).toBeInTheDocument();
    expect(within(dialog).getByText("Team is short-staffed.")).toBeInTheDocument();
    expect(within(dialog).getByText("Admin User")).toBeInTheDocument();

    expect(mockedApiRequest).toHaveBeenCalledWith(
      "/organizations/org-1/leave/requests",
      expect.objectContaining({
        query: expect.objectContaining({ employeeId: "employee-1", page: 1, limit: 10 }),
      }),
    );
  });

  it("blocks applying when the available balance is zero", async () => {
    mockApi({ balances: [makeBalance({ availableBalance: 0 })] });

    const { dialog } = await openApply();
    const startDate = upcomingMonday();
    fillApplyForm(dialog, { startDate, endDate: addDays(startDate, 4) });
    await within(dialog).findByText("5 days");
    submitApplyForm(dialog);

    expect(
      within(dialog).getAllByText(/No Casual Leave balance is available for this period/).length,
    ).toBeGreaterThan(0);
    expect(postCalls()).toHaveLength(0);
  });

  it("blocks applying when the estimate exceeds the available balance", async () => {
    mockApi({ balances: [makeBalance({ availableBalance: 2 })] });

    const { dialog } = await openApply();
    const startDate = upcomingMonday();
    fillApplyForm(dialog, { startDate, endDate: addDays(startDate, 4) });
    await within(dialog).findByText("5 days");
    submitApplyForm(dialog);

    expect(
      (
        await within(dialog).findAllByText(
          "This request is estimated at 5 days, but only 2 days is available for this period.",
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(postCalls()).toHaveLength(0);
  });

  it("submits a request with an idempotency key and refreshes the list", async () => {
    const startDate = upcomingMonday();
    const endDate = addDays(startDate, 4);
    mockApi({
      requests: [],
      onPost: (body) =>
        makeRequest({
          startDate: String(body.startDate),
          endDate: String(body.endDate),
          reason: String(body.reason),
        }),
    });

    const { dialog } = await openApply();
    fillApplyForm(dialog, { startDate, endDate }, "Family trip.");
    await within(dialog).findByText("5 days");
    submitApplyForm(dialog);

    await waitFor(() => expect(postCalls()).toHaveLength(1));
    expect(postCalls()[0]?.[1]).toEqual(
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Idempotency-Key": expect.any(String) }),
        body: {
          leaveTypeId: "type-1",
          startDate,
          endDate,
          startHalfDay: false,
          endHalfDay: false,
          reason: "Family trip.",
        },
      }),
    );
    expect(
      await screen.findByText("Leave request submitted and is pending review."),
    ).toBeInTheDocument();

    await waitFor(() => {
      const balanceReads = mockedApiRequest.mock.calls.filter(
        ([path]) => path === "/organizations/org-1/leave/balances/me",
      );
      const requestReads = mockedApiRequest.mock.calls.filter(
        ([path, init]) =>
          path === "/organizations/org-1/leave/requests" && init?.method !== "POST",
      );
      expect(balanceReads.length).toBeGreaterThan(1);
      expect(requestReads.length).toBeGreaterThan(1);
    });
  });

  it("cancels a pending request with an optional reason", async () => {
    const user = userEvent.setup();
    mockApi({
      requests: [makeRequest({ status: "PENDING" })],
      onCancel: (requestId) => makeRequest({ id: requestId, status: "CANCELLED" }),
    });

    renderView();
    const table = await screen.findByRole("table");
    await user.click(within(table).getByRole("button", { name: "Details" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel leave" }),
    );

    const confirm = await screen.findByRole("heading", {
      name: "Cancel this leave request?",
    });
    expect(confirm).toBeInTheDocument();
    await user.type(screen.getByLabelText("Reason (optional)"), "Plans changed.");
    await user.click(screen.getByRole("button", { name: "Cancel leave" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/leave/requests/request-1/cancel",
        { method: "POST", body: { reason: "Plans changed." } },
      );
    });
    expect(await screen.findByText("Leave request cancelled.")).toBeInTheDocument();
  });

  it("requests reviewer approval for an approved cancellation when required", async () => {
    const user = userEvent.setup();
    mockApi({
      types: [makeType({ cancellationRequiresApproval: true })],
      requests: [makeRequest({ status: "APPROVED" })],
      onCancel: (requestId) =>
        makeRequest({ id: requestId, status: "CANCELLATION_REQUESTED" }),
    });

    renderView();
    const table = await screen.findByRole("table");
    await user.click(within(table).getByRole("button", { name: "Details" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Request cancellation",
      }),
    );

    expect(
      await screen.findByRole("heading", { name: "Request cancellation?" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Request cancellation" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/leave/requests/request-1/cancel",
        { method: "POST", body: {} },
      );
    });
    expect(
      await screen.findByText("Cancellation request submitted for review."),
    ).toBeInTheDocument();
  });

  it("does not offer cancellation for approved leave when the type forbids it", async () => {
    const user = userEvent.setup();
    mockApi({
      types: [makeType({ allowApprovedCancellation: false })],
      requests: [makeRequest({ status: "APPROVED" })],
    });

    renderView();
    const table = await screen.findByRole("table");
    await user.click(within(table).getByRole("button", { name: "Details" }));
    const dialog = await screen.findByRole("dialog");

    expect(
      within(dialog).getByText("This leave type does not allow cancellation after approval."),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Cancel leave" }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Request cancellation" }),
    ).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no requests", async () => {
    mockApi({ requests: [] });
    renderView();
    expect(await screen.findByText("No leave requests yet")).toBeInTheDocument();
  });

  it("shows loading states while data is pending", async () => {
    let resolveRequests: ((value: ReturnType<typeof page>) => void) | undefined;
    mockedApiRequest.mockImplementation((path) => {
      if (path === "/organizations/org-1/leave/types") {
        return Promise.resolve({ data: [leaveType], serverTime: SERVER_TIME });
      }
      if (path === "/organizations/org-1/leave/balances/me") {
        return Promise.resolve({
          data: { employeeId: "employee-1", timezone: "UTC", balances: [balance] },
          serverTime: SERVER_TIME,
        });
      }
      if (path === "/organizations/org-1/leave/requests") {
        return new Promise((resolve) => {
          resolveRequests = resolve;
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    renderView();
    expect(screen.getByLabelText("Loading leave requests")).toBeInTheDocument();

    await waitFor(() => expect(resolveRequests).toBeDefined());
    resolveRequests?.(page([makeRequest()]));
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });
});
