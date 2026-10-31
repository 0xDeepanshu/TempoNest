import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LeaveTypesView } from "@/components/leave-types-view";
import { WorkspaceProvider } from "@/components/workspace";
import { apiRequest } from "@/lib/api-client";
import type {
  LeavePolicy,
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

const policy: LeavePolicy = {
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
};

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
  policy,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function respond() {
  mockedApiRequest.mockImplementation(async (path, options) => {
    if (path === "/organizations/org-1/leave/types") {
      if (options?.method === "POST") {
        return {
          data: {
            leaveType: {
              ...leaveType,
              id: "type-2",
              name: "Sick Leave",
              description: null,
            },
          },
          serverTime: "2026-10-23T10:00:00.000Z",
        };
      }
      return { data: [leaveType], serverTime: "2026-10-23T10:00:00.000Z" };
    }
    if (
      path === "/organizations/org-1/leave/types/type-1" &&
      options?.method === "PATCH"
    ) {
      return {
        data: { leaveType: { ...leaveType, isActive: false } },
        serverTime: "2026-10-23T10:00:00.000Z",
      };
    }
    if (
      path === "/organizations/org-1/leave/policies/policy-1" &&
      options?.method === "PUT"
    ) {
      return {
        data: { policy: { ...policy, initialEntitlement: 25 } },
        serverTime: "2026-10-23T10:00:00.000Z",
      };
    }
    throw new Error(`Unexpected request: ${path} ${options?.method ?? "GET"}`);
  });
}

function renderView(role: Role = "ADMIN") {
  return render(
    <WorkspaceProvider session={sessionFor(role)}>
      <LeaveTypesView />
    </WorkspaceProvider>,
  );
}

describe("LeaveTypesView", () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
  });

  it("requires leave:manage to administer the catalog", () => {
    renderView("MANAGER");

    expect(
      screen.getByText("Catalog management requires leave:manage"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Create leave type" }),
    ).not.toBeInTheDocument();
    expect(mockedApiRequest).not.toHaveBeenCalled();
  });

  it("shows classification, request rules, and policy summary", async () => {
    respond();
    renderView();

    await screen.findByRole("table");
    const table = screen.getByRole("table");
    expect(within(table).getByText("Casual Leave")).toBeInTheDocument();
    expect(within(table).getByText("Paid")).toBeInTheDocument();
    expect(within(table).getByText("Balance required")).toBeInTheDocument();
    expect(within(table).getByText("Up to 10 consecutive days")).toBeInTheDocument();
    expect(within(table).getByText(/20 days initial/)).toBeInTheDocument();
  });

  it("validates a new leave type before creating it", async () => {
    const user = userEvent.setup();
    respond();
    renderView();

    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Create leave type" }));

    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Create leave type" }),
    );
    expect(
      screen.getByText("The leave type name must be between 2 and 120 characters."),
    ).toBeInTheDocument();
    expect(
      mockedApiRequest.mock.calls.some(
        ([path, options]) =>
          path === "/organizations/org-1/leave/types" && options?.method === "POST",
      ),
    ).toBe(false);

    await user.type(within(dialog).getByLabelText(/^Name/), "Sick Leave");
    await user.click(
      within(dialog).getByRole("button", { name: "Create leave type" }),
    );

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/leave/types",
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({
            name: "Sick Leave",
            requiresBalance: true,
            isPaid: true,
            isActive: true,
          }),
        }),
      );
    });
    expect(
      await screen.findByText(
        "Sick Leave was created with a default policy. Review its policy to set entitlement, accrual, and working days.",
      ),
    ).toBeInTheDocument();
  });

  it("deactivates a leave type after confirmation", async () => {
    const user = userEvent.setup();
    respond();
    renderView();

    await screen.findByRole("table");
    const table = screen.getByRole("table");
    await user.click(within(table).getByRole("button", { name: "Deactivate" }));

    expect(
      screen.getByRole("heading", { name: "Deactivate Casual Leave?" }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Deactivate leave type" }),
    );

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/leave/types/type-1",
        { method: "PATCH", body: { isActive: false } },
      );
    });
    expect(
      await screen.findByText("Casual Leave is now inactive."),
    ).toBeInTheDocument();
  });

  it("saves policy changes for a leave type", async () => {
    const user = userEvent.setup();
    respond();
    renderView();

    await screen.findByRole("table");
    const table = screen.getByRole("table");
    await user.click(within(table).getByRole("button", { name: "Policy" }));

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Casual Leave policy" }),
    ).toBeInTheDocument();

    const initial = within(dialog).getByLabelText(/Initial entitlement/);
    await user.clear(initial);
    await user.type(initial, "25");
    await user.click(within(dialog).getByRole("button", { name: "Save policy" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/leave/policies/policy-1",
        expect.objectContaining({
          method: "PUT",
          body: expect.objectContaining({
            initialEntitlement: 25,
            workingDays: [1, 2, 3, 4, 5],
            isActive: true,
          }),
        }),
      );
    });
    expect(
      await screen.findByText("Casual Leave policy was updated."),
    ).toBeInTheDocument();
  });
});
