import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LeaveOverviewView } from "@/components/leave-overview-view";
import { WorkspaceProvider } from "@/components/workspace";
import { apiRequest } from "@/lib/api-client";
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

const session: SessionData = {
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
      role: "ADMIN",
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
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const pendingRequest: LeaveRequest = {
  id: "request-1",
  organizationId: organization.id,
  employeeId: "employee-1",
  leaveTypeId: "type-1",
  startDate: "2026-11-02",
  endDate: "2026-11-03",
  startHalfDay: false,
  endHalfDay: false,
  units: 2,
  chargedDates: [],
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
  leaveType: { id: "type-1", name: "Casual Leave", isPaid: true, requiresBalance: true },
  employee: { id: "employee-1", name: "Ada Lovelace", email: "ada@example.com" },
  createdAt: "2026-10-20T09:00:00.000Z",
  updatedAt: "2026-10-20T09:00:00.000Z",
};

const lowBalance: LeaveBalance = {
  id: "balance-1",
  organizationId: organization.id,
  employeeId: "employee-2",
  leaveTypeId: "type-1",
  periodStart: "2026-01-01",
  periodEnd: "2026-12-31",
  entitledBalance: 20,
  accruedBalance: 0,
  adjustmentBalance: 0,
  carriedForwardBalance: 0,
  approvedConsumed: 19,
  pendingReserved: 0,
  availableBalance: 1,
  breakdown: {
    entitled: 20,
    accrued: 0,
    adjustments: 0,
    carriedForward: 0,
    approvedConsumed: 19,
    pendingReserved: 0,
    available: 1,
  },
  leaveType: { id: "type-1", name: "Casual Leave", isPaid: true, requiresBalance: true },
  employee: { id: "employee-2", name: "Grace Hopper", email: "grace@example.com" },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function pageRows<T>(rows: T[], total = rows.length) {
  return {
    data: rows,
    meta: { page: 1, limit: rows.length, total, totalPages: 1 },
    serverTime: "2026-10-23T10:00:00.000Z",
  };
}

describe("LeaveOverviewView", () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
  });

  it("summarizes pending requests, active types, and low balances from the API", async () => {
    mockedApiRequest.mockImplementation(async (path, options) => {
      if (path === "/organizations/org-1/leave/types") {
        return { data: [leaveType], serverTime: "2026-10-23T10:00:00.000Z" };
      }
      if (path === "/organizations/org-1/leave/requests") {
        const status = (options?.query as { status?: string } | undefined)?.status;
        return status === "APPROVED"
          ? pageRows<LeaveRequest>([], 4)
          : pageRows([pendingRequest], 1);
      }
      if (path === "/organizations/org-1/leave/balances") {
        return pageRows([lowBalance]);
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(
      <WorkspaceProvider session={session}>
        <LeaveOverviewView />
      </WorkspaceProvider>,
    );

    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(await screen.findByText("Grace Hopper")).toBeInTheDocument();
    expect(screen.getByText("1 day available")).toBeInTheDocument();
    expect(screen.getByText(/Employees with 2 days or less available/)).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });
});
