import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MembersPanel } from "@/components/organization-view";
import { WorkspaceProvider } from "@/components/workspace";
import { apiRequest } from "@/lib/api-client";
import type {
  MemberListItem,
  MembershipSummary,
  Organization,
  RoleSummary,
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

const actor: MembershipSummary = {
  id: "membership-1",
  organizationId: organization.id,
  userId: "admin-1",
  role: "OWNER",
  customRoleId: null,
  status: "ACTIVE",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  organization,
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
  memberships: [actor],
  session: {
    id: "session-1",
    transport: "cookie",
    accessExpiresAt: "2026-10-23T12:00:00.000Z",
    refreshExpiresAt: "2026-11-23T12:00:00.000Z",
  },
};

const customRole: RoleSummary = {
  id: "role-1",
  key: "role-1",
  name: "Support lead",
  description: "Delegated time and leave access.",
  builtIn: false,
  customizable: false,
  customized: false,
  permissions: ["time:read", "leave:read"],
  permissionCount: 2,
  dataScope: "SELF",
  onboardingEligible: true,
  assignedUserCount: 0,
  createdAt: "2026-02-01T00:00:00.000Z",
  updatedAt: "2026-02-01T00:00:00.000Z",
};

const employeeMember: MemberListItem = {
  id: "membership-2",
  organizationId: organization.id,
  userId: "user-2",
  role: "MANAGER",
  customRoleId: null,
  status: "ACTIVE",
  permissions: ["time:read", "time:write", "agent:read", "leave:read", "leave:write", "organization:read"],
  dataScope: "SELF",
  createdAt: "2026-02-02T00:00:00.000Z",
  updatedAt: "2026-02-02T00:00:00.000Z",
  user: {
    id: "user-2",
    name: "Sam Lee",
    email: "sam@example.com",
    status: "ACTIVE",
  },
};

function respond() {
  mockedApiRequest.mockImplementation(async (path, options) => {
    if (path === "/organizations/org-1/roles") {
      return {
        data: [
          {
            id: "EMPLOYEE",
            key: "EMPLOYEE",
            name: "Employee",
            description: "Personal self-service.",
            builtIn: true,
            customizable: false,
            customized: false,
            permissions: ["time:read"],
            permissionCount: 1,
            dataScope: "SELF",
            onboardingEligible: false,
            assignedUserCount: 1,
            createdAt: null,
            updatedAt: null,
          },
          customRole,
        ],
      };
    }
    if (path === "/organizations/org-1/members" && options?.method === undefined) {
      return {
        data: [employeeMember],
        meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
      };
    }
    if (
      path === "/organizations/org-1/members/membership-2" &&
      options?.method === "PATCH"
    ) {
      return {
        data: {
          membership: { id: "membership-2", role: "EMPLOYEE", customRoleId: "role-1" },
        },
      };
    }
    throw new Error(`Unexpected request: ${path} ${options?.method ?? "GET"}`);
  });
}

function renderPanel() {
  return render(
    <WorkspaceProvider session={session}>
      <MembersPanel
        organizationId={organization.id}
        actor={actor}
        actorUserId={actor.userId}
        timezone={organization.timezone}
      />
    </WorkspaceProvider>,
  );
}

describe("MembersPanel custom role assignment", () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
  });

  it("lists custom roles alongside built-in roles", async () => {
    respond();
    renderPanel();

    const select = await screen.findByLabelText("Role for Sam Lee");
    expect(within(select).getByRole("option", { name: "Support lead" })).toHaveValue(
      "custom:role-1",
    );
    expect(within(select).getByRole("option", { name: "Manager" })).toHaveValue("MANAGER");
  });

  it("assigns a custom role through the existing member flow", async () => {
    const user = userEvent.setup();
    respond();
    renderPanel();

    await user.selectOptions(
      await screen.findByLabelText("Role for Sam Lee"),
      "custom:role-1",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/members/membership-2",
        { method: "PATCH", body: { customRoleId: "role-1" } },
      );
    });
  });

  it("sends only the built-in role when a built-in option is selected", async () => {
    const user = userEvent.setup();
    respond();
    renderPanel();

    const select = await screen.findByLabelText("Role for Sam Lee");
    await user.selectOptions(select, "custom:role-1");
    await user.selectOptions(select, "EMPLOYEE");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/members/membership-2",
        { method: "PATCH", body: { role: "EMPLOYEE" } },
      );
    });
  });
});
