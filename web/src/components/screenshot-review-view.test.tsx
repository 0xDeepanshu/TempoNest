import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScreenshotReviewView } from "@/components/screenshot-review-view";
import { WorkspaceProvider } from "@/components/workspace";
import { apiRequest } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import type {
  MemberListItem,
  Organization,
  ScreenshotRequestSummary,
  ScreenshotSummary,
  SessionData,
  TimeSession,
  TrackingStatusRow,
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
    accessExpiresAt: "2026-10-23T12:00:00.000Z",
    refreshExpiresAt: "2026-11-23T12:00:00.000Z",
  },
};

const member: MemberListItem = {
  id: "membership-2",
  organizationId: "org-1",
  userId: "employee-1",
  role: "EMPLOYEE",
  status: "ACTIVE",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  user: {
    id: "employee-1",
    name: "Ada Lovelace",
    email: "ada@example.com",
    status: "ACTIVE",
  },
};

const employeeUser = {
  id: "employee-1",
  name: "Ada Lovelace",
  email: "ada@example.com",
  status: "ACTIVE" as const,
  lastLoginAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function activeSession(): TimeSession {
  return {
    id: "session-time-1",
    organizationId: "org-1",
    employeeId: "employee-1",
    desktopAgentId: "agent-1",
    startedAt: "2026-10-24T08:00:00.000Z",
    endedAt: null,
    status: "ACTIVE",
    source: "ONLINE",
    lastHeartbeatAt: "2026-10-24T11:59:00.000Z",
    durationSeconds: 14_340,
    heartbeatFresh: true,
    activeBreak: null,
    createdAt: "2026-10-24T08:00:00.000Z",
    updatedAt: "2026-10-24T11:59:00.000Z",
  };
}

function trackingRow(overrides: Partial<TrackingStatusRow> = {}): TrackingStatusRow {
  return {
    employee: employeeUser,
    state: "WORKING",
    online: true,
    heartbeatStale: false,
    activeSession: activeSession(),
    lastHeartbeatAt: "2026-10-24T11:59:00.000Z",
    lastSeenAt: "2026-10-24T11:59:00.000Z",
    agent: {
      id: "agent-1",
      userId: "employee-1",
      deviceId: "device-1",
      name: "Ada's MacBook",
      platform: "darwin",
      osVersion: "15.0",
      appVersion: "0.1.0",
      status: "ACTIVE",
      online: true,
      lastSeenAt: "2026-10-24T11:59:00.000Z",
      lastConnectedAt: "2026-10-24T08:00:00.000Z",
      lastDisconnectedAt: null,
      revokedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-10-24T11:59:00.000Z",
    },
    ...overrides,
  };
}

function screenshot(id = "shot-1"): ScreenshotSummary {
  return {
    id,
    organizationId: "org-1",
    employeeId: "employee-1",
    timeSessionId: "session-time-1",
    screenshotRequestId: "request-1",
    requestingAdminId: "admin-1",
    capturedAt: "2026-10-24T11:30:00.000Z",
    contentType: "image/jpeg",
    fileSizeBytes: 81_920,
    retentionExpiresAt: "2026-11-23T11:30:00.000Z",
    createdAt: "2026-10-24T11:30:00.000Z",
    updatedAt: "2026-10-24T11:30:00.000Z",
    requestingAdmin: { id: "admin-1", name: "Admin", email: "admin@example.com" },
  };
}

function screenshotRequest(
  overrides: Partial<ScreenshotRequestSummary> = {},
): ScreenshotRequestSummary {
  return {
    id: "request-1",
    organizationId: "org-1",
    employeeId: "employee-1",
    requestingAdminId: "admin-1",
    desktopAgentId: "agent-1",
    timeSessionId: "session-time-1",
    status: "PENDING",
    requestedAt: "2026-10-24T11:29:00.000Z",
    expiresAt: "2026-10-24T11:34:00.000Z",
    acknowledgedAt: null,
    claimedAt: null,
    completedAt: null,
    cancelledAt: null,
    failure: null,
    canCancel: true,
    requestingAdmin: { id: "admin-1", name: "Admin", email: "admin@example.com" },
    desktopAgent: {
      id: "agent-1",
      name: "Ada's MacBook",
      platform: "darwin",
      status: "ACTIVE",
      online: true,
    },
    createdAt: "2026-10-24T11:29:00.000Z",
    updatedAt: "2026-10-24T11:29:00.000Z",
    ...overrides,
  };
}

function page<T>(rows: T[]) {
  return {
    data: rows,
    meta: { page: 1, limit: 10, total: rows.length, totalPages: 1 },
    serverTime: "2026-10-24T12:00:00.000Z",
  };
}

function policy(enabled = true) {
  return {
    data: {
      policy: {
        organizationId: "org-1",
        enabled,
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
      },
    },
    serverTime: "2026-10-24T12:00:00.000Z",
  };
}

function renderView(initialEmployeeId = "employee-1") {
  return render(
    <WorkspaceProvider session={session}>
      <ScreenshotReviewView initialEmployeeId={initialEmployeeId} />
    </WorkspaceProvider>,
  );
}

describe("ScreenshotReviewView", () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
  });

  it("shows a restricted state when the policy excludes the viewer role", async () => {
    mockedApiRequest.mockImplementation(async (path) => {
      if (path.endsWith("/members")) return page([member]);
      if (path.includes("/reports/tracking-status")) return page([trackingRow()]);
      if (path === "/admin/screenshot-policy") return policy();
      if (
        path === "/admin/screenshot-requests" ||
        path === "/admin/screenshots" ||
        path === "/admin/screenshot-audit-events"
      ) {
        throw new ApiError({
          status: 403,
          code: "SCREENSHOT_ROLE_NOT_ALLOWED",
          message: "Your role cannot view screenshots",
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    renderView();

    expect(await screen.findByText("Monitoring access is restricted")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Request screenshot/ })).not.toBeInTheDocument();
  });

  it("disables the request action when the employee is offline", async () => {
    mockedApiRequest.mockImplementation(async (path) => {
      if (path.endsWith("/members")) return page([member]);
      if (path.includes("/reports/tracking-status")) {
        return page([
          trackingRow({
            online: false,
            heartbeatStale: true,
            lastHeartbeatAt: "2026-10-24T10:00:00.000Z",
            agent: null,
          }),
        ]);
      }
      if (path === "/admin/screenshot-policy") return policy(true);
      if (path === "/admin/screenshot-requests") return page([]);
      if (path === "/admin/screenshots") return page([]);
      if (path === "/admin/screenshot-audit-events") return page([]);
      throw new Error(`Unexpected request: ${path}`);
    });

    renderView();

    const button = await screen.findByRole("button", { name: /Request screenshot/ });
    await waitFor(() => expect(button).toBeDisabled());
    expect(
      await screen.findByText("The employee's desktop agent is offline."),
    ).toBeInTheDocument();
    expect(screen.queryByText("The employee needs an active work session")).not.toBeInTheDocument();
  });

  it("opens a short-lived private preview and records the access call", async () => {
    const user = userEvent.setup();
    const shot = screenshot();
    mockedApiRequest.mockImplementation(async (path, options) => {
      if (path.endsWith("/members")) return page([member]);
      if (path.includes("/reports/tracking-status")) return page([trackingRow()]);
      if (path === "/admin/screenshot-policy") return policy(true);
      if (path === "/admin/screenshot-requests") return page([]);
      if (path === "/admin/screenshots") return page([shot]);
      if (path === "/admin/screenshot-audit-events") return page([]);
      if (path === `/admin/screenshots/${shot.id}/access` && options?.method === "POST") {
        return {
          data: {
            screenshot: shot,
            url: "https://private.example.test/short-lived",
            expiresAt: "2099-01-01T00:00:00.000Z",
          },
          serverTime: "2026-10-24T12:00:00.000Z",
        };
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    renderView();

    await user.click(await screen.findByRole("button", { name: /Open screenshot captured/ }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: /Screenshot captured/ })).toHaveAttribute(
      "src",
      "https://private.example.test/short-lived",
    );
    expect(mockedApiRequest).toHaveBeenCalledWith(
      `/admin/screenshots/${shot.id}/access`,
      expect.objectContaining({
        method: "POST",
        headers: { "X-Organization-Id": "org-1" },
      }),
    );
  });

  it("cancels a pending request only through the review action", async () => {
    const user = userEvent.setup();
    mockedApiRequest.mockImplementation(async (path, options) => {
      if (path.endsWith("/members")) return page([member]);
      if (path.includes("/reports/tracking-status")) return page([trackingRow()]);
      if (path === "/admin/screenshot-policy") return policy(true);
      if (path === "/admin/screenshot-requests" && (options?.method ?? "GET") === "GET") {
        return page([screenshotRequest()]);
      }
      if (path === "/admin/screenshot-requests/request-1/cancel" && options?.method === "POST") {
        return { data: { request: screenshotRequest({ status: "CANCELLED" }) } };
      }
      if (path === "/admin/screenshots") return page([]);
      if (path === "/admin/screenshot-audit-events") return page([]);
      throw new Error(`Unexpected request: ${path}`);
    });

    renderView();

    await user.click(await screen.findByRole("button", { name: /^Requests/ }));
    await user.click(await screen.findByRole("button", { name: "Cancel request" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/admin/screenshot-requests/request-1/cancel",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("loads an organization-wide library without an employee filter", async () => {
    mockedApiRequest.mockImplementation(async (path) => {
      if (path.endsWith("/members")) return page([member]);
      if (path === "/admin/screenshot-policy") return policy(true);
      if (path === "/admin/screenshot-requests") return page([]);
      if (path === "/admin/screenshots") return page([]);
      if (path === "/admin/screenshot-audit-events") return page([]);
      throw new Error(`Unexpected request: ${path}`);
    });

    renderView("");

    expect(await screen.findByText("No screenshots captured yet")).toBeInTheDocument();
    expect(screen.queryByText("Request a capture")).not.toBeInTheDocument();
    expect(mockedApiRequest).toHaveBeenCalledWith(
      "/admin/screenshots",
      expect.objectContaining({
        query: { employeeId: undefined, page: 1, limit: 12 },
      }),
    );
    const trackingCalls = mockedApiRequest.mock.calls.filter(([path]) =>
      String(path).includes("/reports/tracking-status"),
    );
    expect(trackingCalls).toHaveLength(0);
  });

  it("loads audited previews only for the selected screenshots", async () => {
    const user = userEvent.setup();
    const first = screenshot("shot-1");
    const second = screenshot("shot-2");
    second.capturedAt = "2026-10-24T11:35:00.000Z";
    mockedApiRequest.mockImplementation(async (path, options) => {
      if (path.endsWith("/members")) return page([member]);
      if (path.includes("/reports/tracking-status")) return page([trackingRow()]);
      if (path === "/admin/screenshot-policy") return policy(true);
      if (path === "/admin/screenshot-requests") return page([]);
      if (path === "/admin/screenshots") return page([first, second]);
      if (path === "/admin/screenshot-audit-events") return page([]);
      if (path.endsWith("/access") && options?.method === "POST") {
        const id = path.split("/")[3];
        return {
          data: {
            screenshot: id === first.id ? first : second,
            url: `https://private.example.test/${id}`,
            expiresAt: "2099-01-01T00:00:00.000Z",
          },
          serverTime: "2026-10-24T12:00:00.000Z",
        };
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    renderView();

    await screen.findByRole("button", { name: /Open screenshot captured.*11:35/ });
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(3);
    await user.click(checkboxes[2]);
    expect((checkboxes[2] as HTMLInputElement).checked).toBe(true);
    await user.click(await screen.findByRole("button", { name: "Load 1 selected" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        `/admin/screenshots/${second.id}/access`,
        expect.objectContaining({
          method: "POST",
          headers: { "X-Organization-Id": "org-1" },
        }),
      );
    });
    expect(mockedApiRequest).not.toHaveBeenCalledWith(
      `/admin/screenshots/${first.id}/access`,
      expect.anything(),
    );
    expect(await screen.findByRole("img", { name: /Screenshot captured/ })).toHaveAttribute(
      "src",
      `https://private.example.test/${second.id}`,
    );
  });
});
