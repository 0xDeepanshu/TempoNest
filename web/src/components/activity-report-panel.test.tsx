import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityReportPanel } from "@/components/activity-report-panel";
import { apiRequest } from "@/lib/api-client";
import type {
  ActivityDayTotals,
  ActivityPolicySnapshot,
  ActivitySummary,
  ActivityTotals,
} from "@/lib/types";

vi.mock("@/lib/api-client", () => ({
  apiRequest: vi.fn(),
}));

const mockedApiRequest = vi.mocked(apiRequest);

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

function day(date: string, overrides: Partial<ActivityTotals> = {}): ActivityDayTotals {
  return { date, ...totals(overrides) };
}

function summary(overrides: Partial<ActivitySummary> = {}): ActivitySummary {
  return {
    employeeId: "employee-1",
    from: "2026-09-01",
    to: "2026-09-07",
    timezone: "UTC",
    policy: policy(),
    totals: totals(),
    categories: [
      { category: "PRODUCTIVE", seconds: 3000, percentOfActiveTime: 50 },
      { category: "NEUTRAL", seconds: 1000, percentOfActiveTime: 16.7 },
      { category: "UNPRODUCTIVE", seconds: 500, percentOfActiveTime: 8.3 },
      { category: "UNCLASSIFIED", seconds: 0, percentOfActiveTime: 0 },
    ],
    applications: [
      {
        applicationIdentifier: "code",
        applicationName: "Visual Studio Code",
        category: "PRODUCTIVE",
        classified: true,
        totalSeconds: 3000,
        percentageOfActiveTime: 50,
        eventCount: 4,
        sessionCount: 1,
      },
    ],
    days: [
      day("2026-09-01"),
      day("2026-09-02", {
        sessionCount: 0,
        trackedSeconds: 0,
        workingSeconds: 0,
        breakSeconds: 0,
        idleSeconds: 0,
        activeSeconds: 0,
        applicationSeconds: 0,
        unaccountedActiveSeconds: 0,
        activityCoveragePercent: 0,
        productiveSeconds: 0,
        neutralSeconds: 0,
        unproductiveSeconds: 0,
        unclassifiedSeconds: 0,
        productivePercentOfActive: null,
        unclassifiedPercentOfActive: null,
        hasActivityData: false,
        hasIdleData: false,
      }),
    ],
    disclaimer:
      "Application usage is foreground metadata only. It is not a definitive measure or proof of productivity and must not be used as an employee performance score.",
    ...overrides,
  };
}

function mockSummary(data: ActivitySummary = summary()) {
  mockedApiRequest.mockImplementation(async (path) => {
    if (path === "/organizations/org-1/reports/activity-summary") return { data };
    throw new Error(`Unexpected request: ${path}`);
  });
}

function renderPanel() {
  return render(
    <ActivityReportPanel
      organizationId="org-1"
      employeeId="employee-1"
      from="2026-09-01"
      to="2026-09-07"
      timezone="UTC"
    />,
  );
}

describe("ActivityReportPanel", () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
  });

  it("renders server totals, category time, applications, and availability", async () => {
    mockSummary();
    renderPanel();

    expect(await screen.findByText("Data availability")).toBeInTheDocument();
    expect(screen.getByText("Activity data available")).toBeInTheDocument();
    expect(screen.getByText("Idle data available")).toBeInTheDocument();
    expect(screen.getByText("Unaccounted active")).toBeInTheDocument();
    expect(screen.getByText("Visual Studio Code")).toBeInTheDocument();
    expect(screen.getAllByText("Productive").length).toBeGreaterThan(0);
    expect(screen.getByText(/Policy v1/)).toBeInTheDocument();
    expect(
      screen.getByText(/Application usage is foreground metadata only/),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/reports/activity-summary",
        expect.objectContaining({
          query: {
            from: "2026-09-01",
            to: "2026-09-07",
            employeeId: "employee-1",
          },
        }),
      );
    });
  });

  it("distinguishes an empty activity window from idleness", async () => {
    mockSummary(
      summary({
        totals: totals({
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
        }),
        categories: [
          { category: "PRODUCTIVE", seconds: 0, percentOfActiveTime: 0 },
          { category: "NEUTRAL", seconds: 0, percentOfActiveTime: 0 },
          { category: "UNPRODUCTIVE", seconds: 0, percentOfActiveTime: 0 },
          { category: "UNCLASSIFIED", seconds: 0, percentOfActiveTime: 0 },
        ],
        applications: [],
      }),
    );
    renderPanel();

    expect(
      await screen.findByText("No application activity recorded"),
    ).toBeInTheDocument();
    expect(screen.getByText("No application activity")).toBeInTheDocument();
    expect(screen.getByText("No activity data")).toBeInTheDocument();
    expect(screen.getAllByText("No data").length).toBeGreaterThan(0);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("explains disabled tracking and idle detection", async () => {
    mockSummary(
      summary({
        policy: policy({
          appTrackingEnabled: false,
          idleDetectionEnabled: false,
        }),
        totals: totals({
          idleSeconds: 0,
          hasIdleData: false,
          hasActivityData: false,
          applicationSeconds: 0,
          productivePercentOfActive: null,
          unclassifiedPercentOfActive: null,
        }),
        applications: [],
      }),
    );
    renderPanel();

    expect(await screen.findByText("Application tracking is disabled")).toBeInTheDocument();
    expect(screen.getAllByText("Idle detection is disabled").length).toBeGreaterThan(0);
    expect(screen.getByText("Idle detection disabled")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("shows unavailable ratios when classification is disabled", async () => {
    mockSummary(
      summary({
        policy: policy({ productivityClassificationEnabled: false }),
        totals: totals({
          productivePercentOfActive: null,
          unclassifiedPercentOfActive: null,
        }),
      }),
    );
    renderPanel();

    expect(
      await screen.findByText("Productivity classification is disabled"),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("Unavailable without classification or activity data").length,
    ).toBe(2);
  });

  it("shows a retryable error", async () => {
    mockedApiRequest
      .mockRejectedValueOnce(new Error("Activity unavailable"))
      .mockResolvedValueOnce({ data: summary() });
    renderPanel();

    expect(await screen.findByRole("alert")).toHaveTextContent("Activity unavailable");
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Data availability")).toBeInTheDocument();
  });
});
