import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CorrectionsView } from "@/components/corrections-view";
import { WorkspaceProvider } from "@/components/workspace";
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

function customRoleSession(
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

function mockApi() {
  mockedApiRequest.mockImplementation(async (path) => {
    if (path.endsWith("/time-sessions")) {
      return {
        data: [],
        meta: { page: 1, limit: 100, total: 0, totalPages: 1 },
        serverTime: "2026-10-25T12:00:00.000Z",
      };
    }
    if (path.endsWith("/members")) {
      return {
        data: [],
        meta: { page: 1, limit: 100, total: 0, totalPages: 1 },
      };
    }
    if (path.endsWith("/attendance/corrections")) {
      return {
        data: [],
        meta: { page: 1, limit: 10, total: 0, totalPages: 1 },
        serverTime: "2026-10-25T12:00:00.000Z",
      };
    }
    throw new Error(`Unexpected request: ${path}`);
  });
}

function renderCorrections(session: SessionData) {
  return render(
    <WorkspaceProvider session={session}>
      <CorrectionsView />
    </WorkspaceProvider>,
  );
}

function requested(pathname: string): boolean {
  return mockedApiRequest.mock.calls.some(([path]) => path === pathname);
}

describe("CorrectionsView permissions", () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
  });

  it("shows only the review queue to a reviewer without self-service access", async () => {
    mockApi();
    renderCorrections(customRoleSession(["correction:review"]));

    expect(await screen.findByText("Pending correction requests")).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "My requests" })).not.toBeInTheDocument();
    expect(screen.queryByText("Request an attendance correction")).not.toBeInTheDocument();
    expect(screen.queryByText("Correction history")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/attendance/corrections",
        expect.objectContaining({
          query: expect.objectContaining({ status: "PENDING" }),
        }),
      );
    });
    expect(requested("/organizations/org-1/time-sessions")).toBe(false);
    expect(requested("/organizations/org-1/members")).toBe(false);
  });

  it("renders the request form and own history for a self-service role", async () => {
    mockApi();
    renderCorrections(customRoleSession(["time:read", "time:write"], { dataScope: "SELF" }));

    expect(await screen.findByText("Request an attendance correction")).toBeInTheDocument();
    expect(await screen.findByText("Correction history")).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "Review queue" })).not.toBeInTheDocument();
    expect(screen.queryByText("Pending correction requests")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(requested("/organizations/org-1/time-sessions")).toBe(true);
      expect(requested("/organizations/org-1/attendance/corrections")).toBe(true);
    });
    expect(requested("/organizations/org-1/members")).toBe(false);
  });

  it("lets submit-only roles request a missing session without reading history", async () => {
    mockApi();
    renderCorrections(customRoleSession(["time:write"], { dataScope: "SELF" }));

    expect(await screen.findByText("Request an attendance correction")).toBeInTheDocument();
    expect(screen.queryByText("Correction history")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Requesting a missing session. Reading stopped sessions requires attendance read access.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Session to correct")).toBeDisabled();

    expect(requested("/organizations/org-1/time-sessions")).toBe(false);
    expect(requested("/organizations/org-1/attendance/corrections")).toBe(false);
  });

  it("exposes both tabs to a reviewer who also has self-service access", async () => {
    mockApi();
    renderCorrections(customRoleSession(["time:read", "correction:review"]));

    const user = userEvent.setup();
    expect(await screen.findByRole("button", { name: "My requests" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review queue" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Review queue" }));

    expect(await screen.findByText("Pending correction requests")).toBeInTheDocument();
    expect(requested("/organizations/org-1/members")).toBe(false);
  });

  it("loads the employee filter only when the reviewer can read the directory", async () => {
    mockApi();
    renderCorrections(customRoleSession(["correction:review", "member:read"]));

    expect(await screen.findByText("Pending correction requests")).toBeInTheDocument();
    expect(screen.getByLabelText("Employee")).toBeInTheDocument();

    await waitFor(() => {
      expect(requested("/organizations/org-1/members")).toBe(true);
    });
  });
});
