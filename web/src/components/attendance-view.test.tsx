import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AttendanceView } from "@/components/attendance-view";
import { WorkspaceProvider } from "@/components/workspace";
import { apiRequest } from "@/lib/api-client";
import type {
  AttendanceSummary,
  BreakSummary,
  Organization,
  SessionData,
  SessionsResponse,
  TimeSession,
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
  timezone: "Asia/Kolkata",
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
    accessExpiresAt: "2026-10-25T12:00:00.000Z",
    refreshExpiresAt: "2026-11-25T12:00:00.000Z",
  },
};

const summary: AttendanceSummary = {
  employeeId: "admin-1",
  period: "monthly",
  from: "2026-10-01",
  to: "2026-10-25",
  timezone: "Asia/Kolkata",
  totals: {
    workedSeconds: 12_600,
    breakSeconds: 1_800,
    sessionCount: 2,
    activeDays: 1,
    firstStartedAt: "2026-10-23T20:00:00.000Z",
    lastEndedAt: "2026-10-24T06:00:00.000Z",
  },
  periods: [
    {
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      workedSeconds: 12_600,
      breakSeconds: 1_800,
      sessionCount: 2,
      activeDays: 1,
      daysIncluded: 25,
      firstStartedAt: "2026-10-23T20:00:00.000Z",
      lastEndedAt: "2026-10-24T06:00:00.000Z",
    },
  ],
};

function breakSummary(overrides: Partial<BreakSummary> = {}): BreakSummary {
  return {
    id: "break-1",
    organizationId: "org-1",
    sessionId: "session-time-1",
    startedAt: "2026-10-23T21:00:00.000Z",
    endedAt: "2026-10-23T21:30:00.000Z",
    status: "ENDED",
    durationSeconds: 1_800,
    createdAt: "2026-10-23T21:00:00.000Z",
    updatedAt: "2026-10-23T21:30:00.000Z",
    ...overrides,
  };
}

function timeSession(overrides: Partial<TimeSession>): TimeSession {
  return {
    id: "session-time-1",
    organizationId: "org-1",
    employeeId: "admin-1",
    desktopAgentId: "agent-1",
    startedAt: "2026-10-23T20:00:00.000Z",
    endedAt: "2026-10-23T22:00:00.000Z",
    status: "STOPPED",
    source: "ONLINE",
    lastHeartbeatAt: "2026-10-23T21:59:00.000Z",
    durationSeconds: 7_200,
    heartbeatFresh: false,
    activeBreak: null,
    breaks: [],
    createdAt: "2026-10-23T20:00:00.000Z",
    updatedAt: "2026-10-23T22:00:00.000Z",
    ...overrides,
  };
}

const sessions: SessionsResponse = {
  data: [
    timeSession({
      id: "session-time-2",
      startedAt: "2026-10-24T04:00:00.000Z",
      endedAt: "2026-10-24T06:00:00.000Z",
      durationSeconds: 7_200,
      lastHeartbeatAt: "2026-10-24T05:59:00.000Z",
    }),
    timeSession({
      id: "session-time-1",
      durationSeconds: 7_200,
      breaks: [breakSummary()],
    }),
    timeSession({
      id: "session-time-3",
      startedAt: "2026-10-24T20:00:00.000Z",
      endedAt: "2026-10-24T21:00:00.000Z",
      durationSeconds: 3_600,
      lastHeartbeatAt: "2026-10-24T20:59:00.000Z",
    }),
  ],
  meta: { page: 1, limit: 20, total: 3, totalPages: 1 },
  serverTime: "2026-10-25T12:00:00.000Z",
};

function mockApi(options: {
  summary?: AttendanceSummary;
  sessions?: SessionsResponse;
  failSummary?: boolean;
} = {}) {
  mockedApiRequest.mockImplementation(async (path) => {
    if (path.endsWith("/attendance/summaries")) {
      if (options.failSummary) throw new Error("Attendance totals are unavailable.");
      return {
        data: options.summary ?? summary,
        serverTime: "2026-10-25T12:00:00.000Z",
      };
    }
    if (path.endsWith("/time-sessions")) {
      return options.sessions ?? sessions;
    }
    throw new Error(`Unexpected request: ${path}`);
  });
}

function renderView() {
  return render(
    <WorkspaceProvider session={session}>
      <AttendanceView timezone={organization.timezone} />
    </WorkspaceProvider>,
  );
}

describe("AttendanceView", () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
  });

  it("scopes the summary and session list to the signed-in employee", async () => {
    mockApi();
    renderView();

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/attendance/summaries",
        expect.objectContaining({
          query: expect.objectContaining({ employeeId: "admin-1" }),
        }),
      );
    });
    expect(mockedApiRequest).toHaveBeenCalledWith(
      "/organizations/org-1/time-sessions",
      expect.objectContaining({
        query: expect.objectContaining({ employeeId: "admin-1", page: 1, limit: 20 }),
      }),
    );
  });

  it("groups sessions by organization-local date and expands a day", async () => {
    mockApi();
    renderView();

    const user = userEvent.setup();
    const day = await screen.findByRole("button", { name: /Oct 24, 2026.*2 sessions/ });
    expect(screen.getByRole("button", { name: /Oct 25, 2026.*1 session/ })).toBeInTheDocument();
    expect(day).toHaveTextContent("3h 30m");

    await user.click(day);

    expect(day).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("1h 30m worked")).toBeInTheDocument();
    expect(screen.getByText("2h 00m worked")).toBeInTheDocument();
    expect(screen.getByText("Break 2:30 AM – 3:00 AM")).toBeInTheDocument();

    await user.click(day);
    expect(day).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("1h 30m worked")).not.toBeInTheDocument();
  });

  it("shows clear empty states for totals and session history", async () => {
    mockApi({
      summary: {
        ...summary,
        totals: {
          workedSeconds: 0,
          breakSeconds: 0,
          sessionCount: 0,
          activeDays: 0,
          firstStartedAt: null,
          lastEndedAt: null,
        },
        periods: [],
      },
      sessions: {
        data: [],
        meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
        serverTime: "2026-10-25T12:00:00.000Z",
      },
    });
    renderView();

    expect(await screen.findByText("No attendance in this range")).toBeInTheDocument();
    expect(screen.getByText("No sessions found")).toBeInTheDocument();
  });

  it("surfaces a summary error without hiding session history", async () => {
    mockApi({ failSummary: true });
    renderView();

    expect(await screen.findByText("Attendance totals are unavailable.")).toBeInTheDocument();
    expect(screen.queryByText("Monthly totals")).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Oct 24, 2026/ })).toBeInTheDocument();
  });
});
