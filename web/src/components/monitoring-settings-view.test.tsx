import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MonitoringSettingsView } from "@/components/monitoring-settings-view";
import { WorkspaceProvider } from "@/components/workspace";
import { apiRequest } from "@/lib/api-client";
import type { Organization, ScreenshotPolicy, SessionData } from "@/lib/types";

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
  user: {
    id: "admin-1",
    name: "Admin",
    email: "admin@example.com",
    status: "ACTIVE",
    lastLoginAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  memberships: [
    {
      id: "membership-1",
      organizationId: "org-1",
      userId: "admin-1",
      role: "OWNER",
      status: "ACTIVE",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      organization,
    },
  ],
  session: {
    id: "session-1",
    transport: "cookie",
    accessExpiresAt: "2026-10-24T12:00:00.000Z",
    refreshExpiresAt: "2026-11-24T12:00:00.000Z",
  },
};

function policy(overrides: Partial<ScreenshotPolicy> = {}): ScreenshotPolicy {
  return {
    organizationId: "org-1",
    enabled: false,
    requestRoles: ["OWNER", "ADMIN"],
    viewRoles: ["OWNER", "ADMIN"],
    requestCooldownSeconds: 30,
    retentionDays: 30,
    auditRetentionDays: 365,
    employeeAcknowledgementRequired: true,
    disclosureVersion: "2026-10-01",
    disclosureText: "Screenshots are captured only after an explicit administrator request.",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("MonitoringSettingsView", () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
  });

  it("saves an explicitly enabled policy with its disclosure", async () => {
    const user = userEvent.setup();
    mockedApiRequest.mockImplementation(async (path, options) => {
      if (path === "/admin/screenshot-policy" && (options?.method ?? "GET") === "GET") {
        return { data: { policy: policy() }, serverTime: "2026-10-24T12:00:00.000Z" };
      }
      if (path === "/admin/screenshot-policy" && options?.method === "PATCH") {
        return {
          data: { policy: policy({ enabled: true }) },
          serverTime: "2026-10-24T12:00:00.000Z",
        };
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(
      <WorkspaceProvider session={session}>
        <MonitoringSettingsView />
      </WorkspaceProvider>,
    );

    await user.click(
      await screen.findByRole("checkbox", {
        name: /Allow administrator-requested screenshots/,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Save monitoring settings" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/admin/screenshot-policy",
        expect.objectContaining({
          method: "PATCH",
          headers: { "X-Organization-Id": "org-1" },
          body: expect.objectContaining({
            enabled: true,
            requestRoles: ["OWNER", "ADMIN"],
            viewRoles: ["OWNER", "ADMIN"],
            employeeAcknowledgementRequired: true,
            disclosureVersion: "2026-10-01",
            disclosureText:
              "Screenshots are captured only after an explicit administrator request.",
          }),
        }),
      );
    });
    expect(await screen.findByText("Monitoring settings saved")).toBeInTheDocument();
  });

  it("blocks saving when a requesting role cannot also review", async () => {
    const user = userEvent.setup();
    mockedApiRequest.mockImplementation(async (path) => {
      if (path === "/admin/screenshot-policy") {
        return { data: { policy: policy() }, serverTime: "2026-10-24T12:00:00.000Z" };
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(
      <WorkspaceProvider session={session}>
        <MonitoringSettingsView />
      </WorkspaceProvider>,
    );

    const managerRole = await screen.findAllByRole("checkbox", { name: /Manager/ });
    await user.click(managerRole[0]!);

    expect(
      await screen.findByText(
        "Every role allowed to request must also be allowed to review, and both lists need at least one role.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save monitoring settings" })).toBeDisabled();
    expect(
      mockedApiRequest.mock.calls.some(([, options]) => options?.method === "PATCH"),
    ).toBe(false);
  });
});
