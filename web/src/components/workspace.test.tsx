import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionGate, WorkspaceProvider, useWorkspace } from "@/components/workspace";
import { apiRequest } from "@/lib/api-client";
import type { Permission } from "@/lib/permissions";
import type { DataScope, Organization, SessionData } from "@/lib/types";

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

function sessionWith(
  permissions: Permission[],
  options: { userId?: string; dataScope?: DataScope } = {},
): SessionData {
  const userId = options.userId ?? "lead-1";
  return {
    platformRole: null,
    user: {
      id: userId,
      name: "Team Lead",
      email: "lead@example.com",
      status: "ACTIVE",
      lastLoginAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    memberships: [
      {
        id: "membership-1",
        organizationId: "org-1",
        userId,
        role: "EMPLOYEE",
        customRoleId: "role-1",
        status: "ACTIVE",
        permissions,
        dataScope: options.dataScope ?? "ORGANIZATION",
        customRole: {
          id: "role-1",
          name: "team lead",
          description: null,
          permissions,
          dataScope: options.dataScope ?? "ORGANIZATION",
          onboardingEligible: false,
        },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        organization,
      },
    ],
    session: {
      id: "session-1",
      transport: "cookie",
      accessExpiresAt: "2026-10-25T12:00:00.000Z",
      refreshExpiresAt: "2026-11-25T12:00:00.000Z",
    },
  };
}

function PermissionsProbe() {
  const { membership } = useWorkspace();
  return <p data-testid="permissions">{membership?.permissions?.join(",") ?? "none"}</p>;
}

describe("PermissionGate", () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
  });

  it("renders the access-denied screen instead of a protected page", () => {
    render(
      <WorkspaceProvider session={sessionWith(["report:read"])}>
        <PermissionGate permission="member:read">
          <p>Directory contents</p>
        </PermissionGate>
      </WorkspaceProvider>,
    );

    expect(screen.getByText("You do not have access")).toBeInTheDocument();
    expect(screen.getByText(/does not include/)).toHaveTextContent("member:read");
    expect(screen.queryByText("Directory contents")).not.toBeInTheDocument();
  });

  it("renders the page when the effective permissions allow it", () => {
    render(
      <WorkspaceProvider session={sessionWith(["member:read"])}>
        <PermissionGate permission="member:read">
          <p>Directory contents</p>
        </PermissionGate>
      </WorkspaceProvider>,
    );

    expect(screen.getByText("Directory contents")).toBeInTheDocument();
    expect(screen.queryByText("You do not have access")).not.toBeInTheDocument();
  });
});

describe("WorkspaceProvider permission refresh", () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
  });

  it("replaces effective permissions after a role change", async () => {
    mockedApiRequest.mockResolvedValue({
      data: sessionWith(["time:read"]),
    });
    render(
      <WorkspaceProvider session={sessionWith(["time:read", "report:read"])}>
        <PermissionsProbe />
      </WorkspaceProvider>,
    );

    expect(screen.getByTestId("permissions")).toHaveTextContent("time:read,report:read");

    await act(async () => {
      window.dispatchEvent(new Event("tn:permissions-changed"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("permissions").textContent).toBe("time:read");
    });
    expect(mockedApiRequest).toHaveBeenCalledWith("/auth/me");
  });

  it("keeps the last known permissions when the refresh fails", async () => {
    mockedApiRequest.mockRejectedValue(new Error("offline"));
    render(
      <WorkspaceProvider session={sessionWith(["time:read"])}>
        <PermissionsProbe />
      </WorkspaceProvider>,
    );

    await act(async () => {
      window.dispatchEvent(new Event("tn:permission-denied"));
    });

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith("/auth/me");
    });
    expect(screen.getByTestId("permissions")).toHaveTextContent("time:read");
  });
});
