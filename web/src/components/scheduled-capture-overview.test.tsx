import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScheduledCaptureOverviewView } from "@/components/scheduled-capture-overview";
import { WorkspaceProvider } from "@/components/workspace";
import { apiRequest } from "@/lib/api-client";
import type {
  Organization,
  ScheduledCaptureOverviewResponse,
  SessionData,
} from "@/lib/types";

vi.mock("@/lib/api-client", () => ({
  apiRequest: vi.fn(),
}));

const mockedApiRequest = vi.mocked(apiRequest);

const organization: Organization = {
  id: "org-1",
  name: "WorkZen",
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
    accessExpiresAt: "2026-10-23T12:00:00.000Z",
    refreshExpiresAt: "2026-11-23T12:00:00.000Z",
  },
};

function overview(
  employees: ScheduledCaptureOverviewResponse["data"]["employees"],
): ScheduledCaptureOverviewResponse {
  return {
    data: { employees },
    serverTime: "2026-11-19T12:00:00.000Z",
  };
}

function renderView(employees: Parameters<typeof overview>[0]) {
  mockedApiRequest.mockResolvedValue(overview(employees));
  render(
    <WorkspaceProvider session={session}>
      <ScheduledCaptureOverviewView />
    </WorkspaceProvider>,
  );
}

describe("ScheduledCaptureOverviewView", () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
  });

  it("lists every employee with the scheduled capture state and interval", async () => {
    renderView([
      {
        employeeId: "user-2",
        name: "Grace Hopper",
        email: "grace@example.com",
        scheduledCaptureEnabled: false,
        scheduledCaptureActive: false,
        captureIntervalMinutes: 30,
        nextCaptureAt: null,
        lastCaptureAt: "2026-11-18T09:00:00.000Z",
      },
      {
        employeeId: "user-3",
        name: "Ada Lovelace",
        email: "ada@example.com",
        scheduledCaptureEnabled: true,
        scheduledCaptureActive: true,
        captureIntervalMinutes: 15,
        nextCaptureAt: "2026-11-19T12:15:00.000Z",
        lastCaptureAt: "2026-11-19T12:00:00.000Z",
      },
    ]);

    expect(await screen.findByText("Grace Hopper")).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    // Active employees are listed first.
    const names = screen.getAllByText(/^(Ada Lovelace|Grace Hopper)$/);
    expect(names[0]).toHaveTextContent("Ada Lovelace");

    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getAllByText("Never").length).toBeGreaterThan(0);
    expect(screen.getByText("Every 15 min")).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 employees take screenshots automatically/i)).toBeInTheDocument();
    expect(
      screen.getByText(/scheduled screenshots consume additional storage and database resources/i),
    ).toBeInTheDocument();
  });

  it("marks a configured schedule as paused while the organization policy is off", async () => {
    renderView([
      {
        employeeId: "user-3",
        name: "Ada Lovelace",
        email: "ada@example.com",
        scheduledCaptureEnabled: true,
        scheduledCaptureActive: false,
        captureIntervalMinutes: 10,
        nextCaptureAt: null,
        lastCaptureAt: null,
      },
    ]);

    expect(await screen.findByText("Paused")).toBeInTheDocument();
    expect(screen.getByText("Every 10 min")).toBeInTheDocument();
    expect(screen.getByText(/0 of 1 employees take screenshots automatically/i)).toBeInTheDocument();
  });
});
