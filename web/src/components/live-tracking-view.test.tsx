import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LiveTrackingView } from "@/components/live-tracking-view";
import { WorkspaceProvider } from "@/components/workspace";
import { apiRequest } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import type {
  MemberListItem,
  Organization,
  Role,
  ScreenshotRequestSummary,
  SessionData,
  TimeSession,
  TrackingStatusRow,
} from "@/lib/types";

vi.mock("@/lib/api-client", () => ({
  apiRequest: vi.fn(),
}));

vi.mock("@/components/live-screen-viewer", () => ({
  LiveScreenViewer: (props: {
    employeeName: string;
    autoStart?: boolean;
    onClose: () => void;
  }) => (
    <div role="dialog" aria-label="Live screen viewer">
      <p>{`${props.employeeName} · ${props.autoStart ? "auto" : "manual"}`}</p>
      <button type="button" onClick={props.onClose}>
        Close viewer
      </button>
    </div>
  ),
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
    accessExpiresAt: "2026-10-24T12:00:00.000Z",
    refreshExpiresAt: "2026-11-24T12:00:00.000Z",
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

function pendingRequest(): ScreenshotRequestSummary {
  return {
    id: "request-1",
    organizationId: "org-1",
    employeeId: "employee-1",
    requestingAdminId: "admin-1",
    desktopAgentId: "agent-1",
    timeSessionId: "session-time-1",
    status: "PENDING",
    requestedAt: "2026-10-24T11:59:30.000Z",
    expiresAt: "2026-10-24T12:04:30.000Z",
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
    createdAt: "2026-10-24T11:59:30.000Z",
    updatedAt: "2026-10-24T11:59:30.000Z",
  };
}

function page<T>(rows: T[], totalPages = 1) {
  return {
    data: rows,
    meta: { page: 1, limit: 20, total: rows.length, totalPages },
    serverTime: "2026-10-24T12:00:00.000Z",
    timezone: "UTC",
    heartbeatStaleAfterSeconds: 120,
  };
}

function policy(enabled: boolean) {
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

function mockLiveTracking(options: {
  row: TrackingStatusRow;
  enabled: boolean;
  request?: ScreenshotRequestSummary;
  policyError?: unknown;
}) {
  mockedApiRequest.mockImplementation(async (path, requestOptions) => {
    if (path.endsWith("/members")) {
      return { data: [member], meta: { page: 1, limit: 100, total: 1, totalPages: 1 } };
    }
    if (path.includes("/reports/tracking-status")) return page([options.row]);
    if (path === "/admin/screenshot-policy") {
      if (options.policyError) throw options.policyError;
      return policy(options.enabled);
    }
    if (path === "/admin/screenshot-requests") {
      return page(
        requestOptions?.query?.status === "PENDING" && options.request ? [options.request] : [],
      );
    }
    throw new Error(`Unexpected request: ${path}`);
  });
}

function sessionForRole(role: Role): SessionData {
  return {
    ...session,
    memberships: [{ ...session.memberships[0], role }],
  };
}

function renderView(viewSession: SessionData = session) {
  return render(
    <WorkspaceProvider session={viewSession}>
      <LiveTrackingView />
    </WorkspaceProvider>,
  );
}

describe("LiveTrackingView", () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
  });

  it("shows pending requests and prevents a duplicate request", async () => {
    mockLiveTracking({ row: trackingRow(), enabled: true, request: pendingRequest() });
    renderView();

    expect(await screen.findByText("Pending")).toBeInTheDocument();
    expect(await screen.findByText("Waiting for the agent")).toBeInTheDocument();
    const button = await screen.findByRole("button", { name: /Request screenshot/ });
    await waitFor(() => expect(button).toBeDisabled());
    expect(
      await screen.findByText(
        "A screenshot request is already pending. Review it before requesting another.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps offline employees visible and refuses a capture request", async () => {
    mockLiveTracking({
      row: trackingRow({
        online: false,
        heartbeatStale: true,
        activeSession: null,
        agent: null,
        state: "OFFLINE",
      }),
      enabled: true,
    });
    renderView();

    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getAllByText("Offline").length).toBeGreaterThan(0);
    const button = await screen.findByRole("button", { name: /Request screenshot/ });
    await waitFor(() => expect(button).toBeDisabled());
    expect(
      await screen.findByText(
        "The employee needs an active work session in the desktop app.",
      ),
    ).toBeInTheDocument();
  });

  it("explains that monitoring is disabled before any request can be sent", async () => {
    mockLiveTracking({ row: trackingRow(), enabled: false });
    renderView();

    const button = await screen.findByRole("button", { name: /Request screenshot/ });
    await waitFor(() => expect(button).toBeDisabled());
    expect(
      await screen.findByText("Screen monitoring is disabled by the organization policy."),
    ).toBeInTheDocument();
    expect(screen.getByText("Monitoring policy disabled")).toBeInTheDocument();
  });

  it("shows View live screen to owners and opens the viewer ready to start", async () => {
    mockLiveTracking({ row: trackingRow(), enabled: true });
    renderView();
    const user = userEvent.setup();

    const button = await screen.findByRole("button", { name: /View live screen/ });
    await waitFor(() => expect(button).toBeEnabled());

    await user.click(button);

    const dialog = await screen.findByRole("dialog", { name: "Live screen viewer" });
    expect(within(dialog).getByText("Ada Lovelace · auto")).toBeInTheDocument();
  });

  it("does not offer live viewing to roles without screenshot:live", async () => {
    mockLiveTracking({ row: trackingRow(), enabled: true });
    renderView(sessionForRole("MANAGER"));

    expect(await screen.findByRole("link", { name: "Open review" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /View live screen/ })).not.toBeInTheDocument();
  });

  it("keeps the live action visible but explains when the agent is offline", async () => {
    mockLiveTracking({ row: trackingRow({ online: false }), enabled: true });
    renderView();

    const button = await screen.findByRole("button", { name: /View live screen/ });
    await waitFor(() => expect(button).toBeDisabled());
    expect(
      screen.getByText("Live view requires the employee's desktop agent to be online."),
    ).toBeInTheDocument();
  });

  it("explains when live viewing is disabled by policy", async () => {
    mockLiveTracking({ row: trackingRow(), enabled: false });
    renderView();

    const button = await screen.findByRole("button", { name: /View live screen/ });
    await waitFor(() => expect(button).toBeDisabled());
    expect(
      screen.getByText("Live screen viewing is disabled by the organization policy."),
    ).toBeInTheDocument();
  });

  it("keeps the live action visible and reports a policy load failure", async () => {
    mockLiveTracking({
      row: trackingRow(),
      enabled: true,
      policyError: new ApiError({
        status: 500,
        code: "INTERNAL_ERROR",
        message: "The monitoring policy is temporarily unavailable.",
      }),
    });
    renderView();

    const button = await screen.findByRole("button", { name: /View live screen/ });
    await waitFor(() => expect(button).toBeDisabled());
    expect(await screen.findByText("Live view policy could not be loaded")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The monitoring policy could not be loaded, so live viewing cannot be authorized right now.",
      ),
    ).toBeInTheDocument();
  });
});
