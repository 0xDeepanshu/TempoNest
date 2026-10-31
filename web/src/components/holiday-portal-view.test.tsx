import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HolidayPortalView } from "@/components/holiday-portal-view";
import { WorkspaceProvider } from "@/components/workspace";
import { apiRequest } from "@/lib/api-client";
import { todayInTimeZone } from "@/lib/format";
import type { Holiday, HolidaySettings, Organization, Role, SessionData } from "@/lib/types";

vi.mock("@/lib/api-client", () => ({
  apiRequest: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/holidays",
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

const today = todayInTimeZone("UTC");
const currentYear = Number(today.slice(0, 4));

function sessionFor(role: Role): SessionData {
  return {
    platformRole: null,
    user: {
      id: "employee-1",
      name: "Holiday Employee",
      email: "employee@example.com",
      status: "ACTIVE",
      lastLoginAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    memberships: [
      {
        id: "membership-1",
        organizationId: organization.id,
        userId: "employee-1",
        role,
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
}

function settings(): HolidaySettings {
  return {
    id: "settings-1",
    organizationId: organization.id,
    enabled: true,
    optionalHolidaysEnabled: true,
    allowHalfDayHolidays: true,
    defaultCalendarYear: currentYear,
    defaultApplicability: "ORGANIZATION",
    workingDays: [1, 2, 3, 4, 5],
    governmentCountry: "IN",
    governmentRegion: null,
    governmentYear: null,
    updatedByUserId: null,
    updatedBy: null,
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

function holiday(): Holiday {
  return {
    id: "holiday-1",
    organizationId: organization.id,
    holidayDate: today,
    name: "Company Holiday",
    category: "COMPANY",
    duration: "FULL_DAY",
    description: "A day off for everyone.",
    appliesToAll: true,
    applicableEmployeeIds: [],
    departmentIds: [],
    locationIds: [],
    published: true,
    source: "MANUAL",
    sourceId: null,
    sourceYear: null,
    sourceName: null,
    sourceUrl: null,
    sourceReference: null,
    jurisdictionCountry: null,
    jurisdictionRegion: null,
    importedAt: null,
    createdByUserId: null,
    updatedByUserId: null,
    createdBy: null,
    updatedBy: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

describe("HolidayPortalView", () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
  });

  it("renders an employee's applicable holidays without management actions", async () => {
    mockedApiRequest.mockResolvedValue({
      data: {
        holidays: [holiday()],
        settings: settings(),
        year: currentYear,
        from: `${currentYear}-01-01`,
        to: `${currentYear}-12-31`,
        total: 1,
      },
      serverTime: "2026-10-23T10:00:00.000Z",
    });

    render(
      <WorkspaceProvider session={sessionFor("EMPLOYEE")}>
        <HolidayPortalView />
      </WorkspaceProvider>,
    );

    expect(
      await screen.findByRole("heading", { name: "Holiday calendar" }),
    ).toBeInTheDocument();
    expect((await screen.findAllByText("Company Holiday")).length).toBeGreaterThan(0);
    expect(mockedApiRequest).toHaveBeenCalledWith(
      "/organizations/org-1/holidays",
      expect.objectContaining({
        query: { year: currentYear, mine: true },
      }),
    );
    expect(screen.queryByRole("button", { name: "Add holiday" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit holiday" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete holiday" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Holiday settings" })).not.toBeInTheDocument();
  });
});
