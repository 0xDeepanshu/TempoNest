import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LeaveRequestsView } from "@/components/leave-requests-view";
import { WorkspaceProvider } from "@/components/workspace";
import { apiRequest } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import type {
  LeaveBalance,
  LeaveRequest,
  LeaveType,
  Organization,
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

function sessionFor(role: SessionData["memberships"][number]["role"]): SessionData {
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

const leaveType: LeaveType = {
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
};

function request(overrides: Partial<LeaveRequest> = {}): LeaveRequest {
  return {
    id: "request-1",
    organizationId: organization.id,
    employeeId: "employee-1",
    leaveTypeId: "type-1",
    startDate: "2026-11-02",
    endDate: "2026-11-06",
    startHalfDay: false,
    endHalfDay: false,
    units: 5,
    chargedDates: [
      { date: "2026-11-02", units: 1 },
      { date: "2026-11-03", units: 1 },
      { date: "2026-11-04", units: 1 },
      { date: "2026-11-05", units: 1 },
      { date: "2026-11-06", units: 1 },
    ],
    balancePeriodStart: "2026-01-01",
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
    employee: {
      id: "employee-1",
      name: "Ada Lovelace",
      email: "ada@example.com",
    },
    createdAt: "2026-10-20T09:00:00.000Z",
    updatedAt: "2026-10-20T09:00:00.000Z",
    ...overrides,
  };
}

const balance: LeaveBalance = {
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
  approvedConsumed: 0,
  pendingReserved: 5,
  availableBalance: 15,
  breakdown: {
    entitled: 20,
    accrued: 0,
    adjustments: 0,
    carriedForward: 0,
    approvedConsumed: 0,
    pendingReserved: 5,
    available: 15,
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
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function page(rows: LeaveRequest[]) {
  return {
    data: rows,
    meta: { page: 1, limit: 20, total: rows.length, totalPages: 1 },
    serverTime: "2026-10-23T10:00:00.000Z",
  };
}

function respond(rows: LeaveRequest[]) {
  mockedApiRequest.mockImplementation(async (path, options) => {
    if (path === "/organizations/org-1/leave/types") {
      return { data: [leaveType], serverTime: "2026-10-23T10:00:00.000Z" };
    }
    if (path === "/organizations/org-1/leave/requests") {
      return page(rows);
    }
    if (path === "/organizations/org-1/leave/requests/request-1") {
      return { data: { request: rows[0] }, serverTime: "2026-10-23T10:00:00.000Z" };
    }
    if (path === "/organizations/org-1/leave/requests/request-1/approve") {
      return {
        data: { request: { ...rows[0], status: "APPROVED" } },
        serverTime: "2026-10-23T10:00:00.000Z",
      };
    }
    if (path === "/organizations/org-1/leave/requests/request-1/reject") {
      return {
        data: { request: { ...rows[0], status: "REJECTED" } },
        serverTime: "2026-10-23T10:00:00.000Z",
      };
    }
    if (path === "/organizations/org-1/leave/balances/employee-1") {
      return {
        data: { employeeId: "employee-1", timezone: "UTC", balances: [balance] },
        serverTime: "2026-10-23T10:00:00.000Z",
      };
    }
    throw new Error(`Unexpected request: ${path} ${options?.method ?? "GET"}`);
  });
}

function renderView(role: "ADMIN" | "MANAGER" = "ADMIN") {
  return render(
    <WorkspaceProvider session={sessionFor(role)}>
      <LeaveRequestsView />
    </WorkspaceProvider>,
  );
}

describe("LeaveRequestsView", () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
  });

  it("applies status and date filters to the request list", async () => {
    const user = userEvent.setup();
    respond([request()]);
    renderView();

    await screen.findByRole("table");

    await user.selectOptions(screen.getByLabelText("Status"), "PENDING");
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2026-10-01" },
    });
    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: "2026-10-31" },
    });
    await user.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/leave/requests",
        expect.objectContaining({
          query: expect.objectContaining({
            page: 1,
            limit: 20,
            status: "PENDING",
            from: "2026-10-01",
            to: "2026-10-31",
          }),
        }),
      );
    });
  });

  it("rejects an invalid date range without requesting again", async () => {
    respond([request()]);
    renderView();
    await screen.findByRole("table");

    const requestCalls = () =>
      mockedApiRequest.mock.calls.filter(
        ([path]) => path === "/organizations/org-1/leave/requests",
      ).length;
    const before = requestCalls();

    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2026-11-10" },
    });
    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: "2026-11-01" },
    });
    // Native date-input constraint validation blocks a real click, so submit
    // the form directly to exercise the component's own range check.
    fireEvent.submit(screen.getByRole("button", { name: "Apply" }).closest("form")!);

    expect(
      screen.getByText("The end of the date range must be on or after the start."),
    ).toBeInTheDocument();
    expect(requestCalls()).toBe(before);
  });

  it("approves a request with an optional reviewer note", async () => {
    const user = userEvent.setup();
    respond([request()]);
    renderView();

    await screen.findByRole("table");
    await user.click(within(screen.getByRole("table")).getByRole("button", { name: "Review" }));
    await screen.findByRole("heading", { name: "Leave request" });

    await user.click(screen.getByRole("button", { name: "Approve" }));
    await user.type(screen.getByLabelText("Reviewer note"), "Coverage arranged.");
    await user.click(screen.getByRole("button", { name: "Approve request" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/leave/requests/request-1/approve",
        { method: "POST", body: { note: "Coverage arranged." } },
      );
    });
    expect(await screen.findByText("Leave request approved.")).toBeInTheDocument();
  });

  it("requires a rejection reason before submitting", async () => {
    const user = userEvent.setup();
    respond([request()]);
    renderView();

    await screen.findByRole("table");
    await user.click(within(screen.getByRole("table")).getByRole("button", { name: "Review" }));
    await screen.findByRole("heading", { name: "Leave request" });
    await user.click(screen.getByRole("button", { name: "Reject" }));

    await user.type(screen.getByLabelText(/Reason/), "no");
    await user.click(screen.getByRole("button", { name: "Reject request" }));

    expect(
      screen.getByText("Enter a reason with at least 3 characters."),
    ).toBeInTheDocument();
    expect(
      mockedApiRequest.mock.calls.some(
        ([path]) => path === "/organizations/org-1/leave/requests/request-1/reject",
      ),
    ).toBe(false);

    await user.clear(screen.getByLabelText(/Reason/));
    await user.type(screen.getByLabelText(/Reason/), "Staffing conflict.");
    await user.click(screen.getByRole("button", { name: "Reject request" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/leave/requests/request-1/reject",
        { method: "POST", body: { reason: "Staffing conflict." } },
      );
    });
    expect(await screen.findByText("Leave request rejected.")).toBeInTheDocument();
  });

  it("blocks self-approval and self-rejection", async () => {
    respond([request({ employeeId: "admin-1" })]);
    renderView();

    await screen.findByRole("table");
    await userEventClickReview();

    expect(
      await screen.findByText(
        "You cannot approve or reject your own leave request. Another administrator must review it.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
  });

  it("shows an empty state when no requests exist", async () => {
    respond([]);
    renderView();

    expect(await screen.findByText("No leave requests yet")).toBeInTheDocument();
  });

  it("shows the loading state while requests are pending", async () => {
    let resolveRequests: ((value: ReturnType<typeof page>) => void) | undefined;
    mockedApiRequest.mockImplementation((path) => {
      if (path === "/organizations/org-1/leave/types") {
        return Promise.resolve({
          data: [leaveType],
          serverTime: "2026-10-23T10:00:00.000Z",
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
    resolveRequests?.(page([request()]));
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("surfaces a request list error with retry", async () => {
    mockedApiRequest.mockImplementation(async (path) => {
      if (path === "/organizations/org-1/leave/types") {
        return { data: [leaveType], serverTime: "2026-10-23T10:00:00.000Z" };
      }
      throw new ApiError({
        status: 403,
        code: "PERMISSION_DENIED",
        message: "Reviewer access is required.",
      });
    });

    renderView();
    expect(await screen.findByText("Reviewer access is required.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retry/ })).toBeInTheDocument();
  });
});

async function userEventClickReview() {
  const user = userEvent.setup();
  await user.click(within(screen.getByRole("table")).getByRole("button", { name: "Review" }));
  await screen.findByRole("heading", { name: "Leave request" });
}
