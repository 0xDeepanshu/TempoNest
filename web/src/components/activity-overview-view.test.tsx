import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityOverviewView } from "@/components/activity-overview-view";
import { WorkspaceProvider } from "@/components/workspace";
import { apiRequest } from "@/lib/api-client";
import type {
  ActivityOverviewResponse,
  ActivityPolicySnapshot,
  ActivityTotals,
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
    accessExpiresAt: "2026-10-24T12:00:00.000Z",
    refreshExpiresAt: "2026-11-24T12:00:00.000Z",
  },
};

function totals(overrides: Partial<ActivityTotals> = {}): ActivityTotals {
  return {
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
    ...overrides,
  };
}

function policy(overrides: Partial<ActivityPolicySnapshot> = {}): ActivityPolicySnapshot {
  return {
    appTrackingEnabled: true,
    idleDetectionEnabled: true,
    idleThresholdMinutes: 5,
    productivityClassificationEnabled: true,
    activityRetentionDays: 90,
    policyVersion: 1,
    policyUpdatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

function overview(overrides: Partial<ActivityOverviewResponse> = {}): ActivityOverviewResponse {
  const row = {
    employee: {
      id: "employee-1",
      name: "Ada Lovelace",
      email: "ada@example.com",
      status: "ACTIVE" as const,
      lastLoginAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    ...totals(),
    topApplications: [
      {
        applicationIdentifier: "code",
        applicationName: "Visual Studio Code",
        category: "PRODUCTIVE" as const,
        totalSeconds: 3000,
      },
    ],
  };

  return {
    data: [row],
    meta: { page: 1, limit: 20, total: 1, totalPages: 2 },
    from: "2026-10-24",
    to: "2026-10-30",
    timezone: "UTC",
    policy: policy(),
    totals: {
      trackedSeconds: 7200,
      workingSeconds: 6900,
      breakSeconds: 300,
      idleSeconds: 900,
      activeSeconds: 6000,
      applicationSeconds: 4500,
      productiveSeconds: 3000,
      neutralSeconds: 1000,
      unproductiveSeconds: 500,
      unclassifiedSeconds: 0,
      activityCoveragePercent: 75,
      productivePercentOfActive: 50,
      unclassifiedPercentOfActive: 0,
    },
    disclaimer:
      "Application usage is foreground metadata only. It is not a definitive measure or proof of productivity.",
    ...overrides,
  };
}

function mockOverview(response: ActivityOverviewResponse = overview()) {
  mockedApiRequest.mockImplementation(async (path) => {
    if (path === "/organizations/org-1/reports/activity-overview") return response;
    throw new Error(`Unexpected request: ${path}`);
  });
}

function renderOverview() {
  return render(
    <WorkspaceProvider session={session}>
      <ActivityOverviewView />
    </WorkspaceProvider>,
  );
}

describe("ActivityOverviewView", () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
    window.history.replaceState(null, "", "/admin/activity/team");
  });

  it("renders employee activity rows with report links and exact server ratios", async () => {
    mockOverview();
    renderOverview();
    const user = userEvent.setup();

    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("Visual Studio Code")).toBeInTheDocument();
    expect(screen.getAllByText("75%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("50%").length).toBeGreaterThan(0);

    const link = screen.getByRole("link", { name: /Open report/ });
    expect(link).toHaveAttribute(
      "href",
      expect.stringContaining("employeeId=employee-1"),
    );
    expect(link).toHaveAttribute("href", expect.stringContaining("tab=activity"));

    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/reports/activity-overview",
        expect.objectContaining({
          query: expect.objectContaining({ page: 2 }),
        }),
      );
    });
  });

  it("does not present missing activity as idleness or unproductivity", async () => {
    const response = overview({
      policy: policy({
        appTrackingEnabled: false,
        productivityClassificationEnabled: false,
      }),
      data: [
        {
          employee: {
            id: "employee-1",
            name: "Ada Lovelace",
            email: "ada@example.com",
            status: "ACTIVE",
            lastLoginAt: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          ...totals({
            applicationSeconds: 0,
            unaccountedActiveSeconds: 6000,
            activityCoveragePercent: 0,
            productiveSeconds: 0,
            neutralSeconds: 0,
            unproductiveSeconds: 0,
            unclassifiedSeconds: 0,
            productivePercentOfActive: null,
            unclassifiedPercentOfActive: null,
            hasActivityData: false,
            hasIdleData: false,
            idleSeconds: 0,
          }),
          topApplications: [],
        },
      ],
      totals: {
        trackedSeconds: 7200,
        workingSeconds: 6900,
        breakSeconds: 300,
        idleSeconds: 0,
        activeSeconds: 6900,
        applicationSeconds: 0,
        productiveSeconds: 0,
        neutralSeconds: 0,
        unproductiveSeconds: 0,
        unclassifiedSeconds: 0,
        activityCoveragePercent: 0,
        productivePercentOfActive: null,
        unclassifiedPercentOfActive: null,
      },
    });
    mockOverview(response);
    renderOverview();

    expect(
      await screen.findByText("Application tracking is disabled"),
    ).toBeInTheDocument();
    expect(screen.getByText("Productivity classification is disabled")).toBeInTheDocument();
    expect(screen.getByText("No activity data")).toBeInTheDocument();
    expect(screen.getByText("None recorded")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("rejects overview ranges longer than 31 days", async () => {
    mockOverview();
    renderOverview();

    await screen.findByText("Ada Lovelace");
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-31" } });
    await userEvent.setup().click(screen.getByRole("button", { name: "Apply" }));

    expect(
      await screen.findByText("Activity overviews are limited to 31 days."),
    ).toBeInTheDocument();
    expect(
      mockedApiRequest.mock.calls.some(([, options]) => {
        const query = (options as { query?: { from?: string } } | undefined)?.query;
        return query?.from === "2026-09-01";
      }),
    ).toBe(false);
  });

  it("shows a retryable error", async () => {
    mockedApiRequest
      .mockRejectedValueOnce(new Error("Overview unavailable"))
      .mockResolvedValueOnce(overview());
    renderOverview();

    expect(await screen.findByRole("alert")).toHaveTextContent("Overview unavailable");
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
  });
});
