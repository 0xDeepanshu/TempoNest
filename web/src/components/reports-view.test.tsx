import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmployeeDetailView } from "@/components/employee-detail-view";
import { ReportsView } from "@/components/reports-view";
import { WorkspaceProvider } from "@/components/workspace";
import { apiRequest } from "@/lib/api-client";
import type { Permission } from "@/lib/permissions";
import type {
  ActivitySummary,
  DailyReport,
  DataScope,
  MemberListItem,
  Organization,
  SessionData,
  SessionReportResponse,
  TrackingStatusResponse,
} from "@/lib/types";

vi.mock("@/lib/api-client", () => ({
  apiRequest: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ employeeId: "employee-1" }),
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

const ada: MemberListItem = {
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

const grace: MemberListItem = {
  id: "membership-3",
  organizationId: "org-1",
  userId: "employee-2",
  role: "MANAGER",
  status: "ACTIVE",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  user: {
    id: "employee-2",
    name: "Grace Hopper",
    email: "grace@example.com",
    status: "ACTIVE",
  },
};

function page<T>(rows: T[]) {
  return {
    data: rows,
    meta: { page: 1, limit: 100, total: rows.length, totalPages: 1 },
  };
}

const sessionReport: SessionReportResponse = {
  data: [
    {
      id: "session-time-1",
      organizationId: "org-1",
      employeeId: "employee-1",
      desktopAgentId: "agent-1",
      startedAt: "2026-09-10T09:00:00.000Z",
      endedAt: "2026-09-10T11:00:00.000Z",
      status: "STOPPED",
      source: "ONLINE",
      lastHeartbeatAt: "2026-09-10T10:59:00.000Z",
      durationSeconds: 7_200,
      heartbeatFresh: false,
      activeBreak: null,
      breaks: [],
      employee: { id: "employee-1", name: "Ada Lovelace", email: "ada@example.com" },
      createdAt: "2026-09-10T09:00:00.000Z",
      updatedAt: "2026-09-10T11:00:00.000Z",
      workingSeconds: 6_600,
      breakSeconds: 600,
    },
  ],
  meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
  from: "2026-09-01",
  to: "2026-09-30",
  timezone: "UTC",
};

const dailyReport: DailyReport = {
  employeeId: "employee-1",
  from: "2026-09-01",
  to: "2026-09-30",
  timezone: "UTC",
  days: [
    {
      date: "2026-09-10",
      employeeId: "employee-1",
      workedSeconds: 6_600,
      breakSeconds: 600,
      sessionCount: 1,
      firstStartedAt: "2026-09-10T09:00:00.000Z",
      lastEndedAt: "2026-09-10T11:00:00.000Z",
    },
  ],
};

const tracking: TrackingStatusResponse = {
  data: [
    {
      employee: ada.user as TrackingStatusResponse["data"][0]["employee"],
      state: "OFFLINE",
      online: false,
      heartbeatStale: null,
      activeSession: null,
      lastHeartbeatAt: null,
      lastSeenAt: null,
      agent: null,
    },
  ],
  meta: { page: 1, limit: 1, total: 1, totalPages: 1 },
  timezone: "UTC",
  heartbeatStaleAfterSeconds: 120,
  serverTime: "2026-10-25T12:00:00.000Z",
};

const activitySummary: ActivitySummary = {
  employeeId: "employee-1",
  from: "2026-09-01",
  to: "2026-09-30",
  timezone: "UTC",
  policy: {
    appTrackingEnabled: true,
    idleDetectionEnabled: true,
    idleThresholdMinutes: 5,
    productivityClassificationEnabled: true,
    activityRetentionDays: 90,
    policyVersion: 1,
    policyUpdatedAt: "2026-10-01T00:00:00.000Z",
  },
  totals: {
    sessionCount: 1,
    trackedSeconds: 7200,
    workingSeconds: 6900,
    breakSeconds: 300,
    idleSeconds: 900,
    activeSeconds: 6000,
    applicationSeconds: 4500,
    unaccountedActiveSeconds: 1500,
    activityCoveragePercent: 75,
    productiveSeconds: 3000,
    neutralSeconds: 1000,
    unproductiveSeconds: 500,
    unclassifiedSeconds: 0,
    productivePercentOfActive: 50,
    unclassifiedPercentOfActive: 0,
    hasActivityData: true,
    hasIdleData: true,
  },
  categories: [],
  applications: [],
  days: [],
  disclaimer: "Application usage is foreground metadata only.",
};

function mockApi() {
  mockedApiRequest.mockImplementation(async (path, options) => {
    const query = (options as { query?: Record<string, unknown> } | undefined)?.query ?? {};
    if (path.endsWith("/members")) {
      if (query.q === "nobody") return page([]);
      return page([ada, grace]);
    }
    if (path.endsWith("/reports/sessions")) return sessionReport;
    if (path.endsWith("/reports/daily")) return { data: dailyReport };
    if (path.endsWith("/reports/tracking-status")) return tracking;
    if (path.endsWith("/reports/activity-summary")) return { data: activitySummary };
    throw new Error(`Unexpected request: ${path}`);
  });
}

function customRoleSession(
  permissions: Permission[],
  options: { userId?: string; dataScope?: DataScope } = {},
): SessionData {
  const userId = options.userId ?? "lead-1";
  return {
    ...session,
    user: {
      ...session.user,
      id: userId,
      name: "Team Lead",
      email: "lead@example.com",
    },
    memberships: [
      {
        ...session.memberships[0],
        userId,
        role: "EMPLOYEE",
        customRoleId: "role-1",
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
      },
    ],
  };
}

function renderReports(
  props: React.ComponentProps<typeof ReportsView> = {},
  activeSession: SessionData = session,
) {
  return render(
    <WorkspaceProvider session={activeSession}>
      <ReportsView {...props} />
    </WorkspaceProvider>,
  );
}

function renderEmployeeDetail(props: React.ComponentProps<typeof EmployeeDetailView> = {}) {
  return render(
    <WorkspaceProvider session={session}>
      <EmployeeDetailView {...props} />
    </WorkspaceProvider>,
  );
}

describe("ReportsView", () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
    window.history.replaceState(null, "", "/");
  });

  it("searches the employee directory and selects a result", async () => {
    mockApi();
    renderReports();

    const user = userEvent.setup();
    const input = screen.getByRole("combobox", { name: "Employee" });
    await user.click(input);

    const options = await screen.findByRole("listbox", { name: "Employees" });
    expect(within(options).getAllByRole("option")).toHaveLength(2);

    await user.type(input, "ada");
    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/members",
        expect.objectContaining({
          query: expect.objectContaining({ q: "ada", status: "ACTIVE", limit: 20 }),
        }),
      );
    });

    const results = await screen.findByRole("listbox", { name: "Employees" });
    await user.click(within(results).getByRole("option", { name: /Ada Lovelace/ }));

    expect(input).toHaveValue("Ada Lovelace");
    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/reports/sessions",
        expect.objectContaining({
          query: expect.objectContaining({ employeeId: "employee-1" }),
        }),
      );
    });
    expect(window.location.search).toContain("employeeId=employee-1");
  });

  it("supports keyboard selection from the employee picker", async () => {
    mockApi();
    renderReports();

    const user = userEvent.setup();
    const input = screen.getByRole("combobox", { name: "Employee" });
    await user.click(input);
    await screen.findByRole("option", { name: /Ada Lovelace/ });
    await user.keyboard("{Enter}");

    expect(input).toHaveValue("Ada Lovelace");
    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/reports/sessions",
        expect.objectContaining({
          query: expect.objectContaining({ employeeId: "employee-1" }),
        }),
      );
    });
  });

  it("restores a deep-linked employee and date range and preserves the context", async () => {
    mockApi();
    renderReports({
      initialEmployeeId: "employee-1",
      initialFrom: "2026-09-01",
      initialTo: "2026-09-30",
    });

    expect(await screen.findByDisplayValue("Ada Lovelace")).toBeInTheDocument();

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/reports/sessions",
        expect.objectContaining({
          query: expect.objectContaining({
            employeeId: "employee-1",
            from: "2026-09-01",
            to: "2026-09-30",
          }),
        }),
      );
    });

    const profileLink = screen.getByRole("link", { name: /Open employee profile/ });
    expect(profileLink).toHaveAttribute(
      "href",
      "/admin/employees/employee-1?from=2026-09-01&to=2026-09-30",
    );
  });

  it("opens the activity tab from a deep link and requests the summary", async () => {
    mockApi();
    renderReports({
      initialEmployeeId: "employee-1",
      initialFrom: "2026-09-01",
      initialTo: "2026-09-30",
      initialTab: "activity",
    });

    expect(await screen.findByText("Data availability")).toBeInTheDocument();
    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/reports/activity-summary",
        expect.objectContaining({
          query: {
            from: "2026-09-01",
            to: "2026-09-30",
            employeeId: "employee-1",
          },
        }),
      );
    });
    expect(
      mockedApiRequest.mock.calls.some(([path]) => path.endsWith("/reports/sessions")),
    ).toBe(false);
  });

  it("hides the activity tab from a report-only role and never requests its summary", async () => {
    mockApi();
    renderReports(
      {
        initialEmployeeId: "employee-1",
        initialFrom: "2026-09-01",
        initialTo: "2026-09-30",
        initialTab: "activity",
      },
      customRoleSession(["report:read"], { dataScope: "ORGANIZATION" }),
    );

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/reports/sessions",
        expect.objectContaining({
          query: expect.objectContaining({ employeeId: "employee-1" }),
        }),
      );
    });

    expect(screen.getByRole("button", { name: "Sessions" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Activity" })).not.toBeInTheDocument();
    expect(
      mockedApiRequest.mock.calls.some(([path]) => path.endsWith("/reports/activity-summary")),
    ).toBe(false);
    expect(
      mockedApiRequest.mock.calls.some(([path]) => path.endsWith("/members")),
    ).toBe(false);
    expect(screen.getByRole("combobox", { name: "Employee" })).toBeDisabled();
    expect(screen.getByText("Directory access required")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Open employee profile/ }),
    ).not.toBeInTheDocument();
  });

  it("lets a self-scoped role read its own activity without directory access", async () => {
    mockApi();
    renderReports(
      {
        initialEmployeeId: "employee-1",
        initialFrom: "2026-09-01",
        initialTo: "2026-09-30",
        initialTab: "activity",
      },
      customRoleSession(["time:read", "report:read"], {
        userId: "employee-1",
        dataScope: "SELF",
      }),
    );

    expect(await screen.findByText("Data availability")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activity" })).toBeInTheDocument();

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/reports/activity-summary",
        expect.objectContaining({
          query: {
            from: "2026-09-01",
            to: "2026-09-30",
            employeeId: "employee-1",
          },
        }),
      );
    });
    expect(
      mockedApiRequest.mock.calls.some(([path]) => path.endsWith("/members")),
    ).toBe(false);
    expect(screen.getByRole("combobox", { name: "Employee" })).toBeDisabled();
  });

  it("shows an employee prompt until someone is selected", () => {
    mockApi();
    renderReports();

    expect(screen.getByText("Select an employee")).toBeInTheDocument();
    expect(screen.queryByText("Session report")).not.toBeInTheDocument();
  });
});

describe("EmployeeDetailView", () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
  });

  it("keeps the profile range when opening reports", async () => {
    mockApi();
    renderEmployeeDetail({ initialFrom: "2026-09-01", initialTo: "2026-09-30" });

    const link = await screen.findByRole("link", { name: /Open reports/ });
    expect(link).toHaveAttribute(
      "href",
      "/admin/reports?employeeId=employee-1&from=2026-09-01&to=2026-09-30",
    );

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/reports/daily",
        expect.objectContaining({
          query: expect.objectContaining({
            employeeId: "employee-1",
            from: "2026-09-01",
            to: "2026-09-30",
          }),
        }),
      );
    });
  });

  it("shows the concise activity summary instead of duplicate report tabs", async () => {
    mockApi();
    renderEmployeeDetail({ initialFrom: "2026-09-01", initialTo: "2026-09-30" });

    expect(
      await screen.findByRole("heading", { name: "Recent activity" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Worked")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Daily totals" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Full report/ })).toHaveAttribute(
      "href",
      "/admin/reports?employeeId=employee-1&from=2026-09-01&to=2026-09-30",
    );
  });
});
