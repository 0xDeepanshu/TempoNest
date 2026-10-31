import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LeaveHolidaysView } from "@/components/leave-holidays-view";
import { WorkspaceProvider } from "@/components/workspace";
import { apiRequest } from "@/lib/api-client";
import { todayInTimeZone } from "@/lib/format";
import type {
  Holiday,
  HolidaySettings,
  Organization,
  Role,
  SessionData,
} from "@/lib/types";

vi.mock("@/lib/api-client", () => ({
  apiRequest: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/leave/holidays",
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
      id: "admin-1",
      name: "Admin User",
      email: "admin@example.com",
      status: "ACTIVE",
      lastLoginAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    memberships: [
      {
        id: "membership-1",
        organizationId: organization.id,
        userId: "admin-1",
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

function settings(overrides: Partial<HolidaySettings> = {}): HolidaySettings {
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
    ...overrides,
  };
}

function holiday(overrides: Partial<Holiday> = {}): Holiday {
  return {
    id: "holiday-1",
    organizationId: organization.id,
    holidayDate: today,
    name: "New Year's Day",
    category: "PUBLIC",
    duration: "FULL_DAY",
    description: "Public holiday",
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
    ...overrides,
  };
}

function calendarResponse(rows: Holiday[], overrides: Partial<HolidaySettings> = {}) {
  return {
    data: {
      holidays: rows,
      settings: settings(overrides),
      year: currentYear,
      from: `${currentYear}-01-01`,
      to: `${currentYear}-12-31`,
      total: rows.length,
    },
    serverTime: "2026-10-23T10:00:00.000Z",
  };
}

function respond(rows: Holiday[]) {
  mockedApiRequest.mockImplementation(async (path, options) => {
    if (path === "/organizations/org-1/holidays" && !options?.method) {
      return calendarResponse(rows);
    }
    if (path === "/organizations/org-1/holidays" && options?.method === "POST") {
      const body = options.body as { holidayDate: string; name: string };
      return {
        data: {
          holiday: holiday({
            id: "holiday-2",
            holidayDate: body.holidayDate,
            name: body.name,
            category: "COMPANY",
            description: null,
          }),
        },
        serverTime: "2026-10-23T10:00:00.000Z",
      };
    }
    if (
      path === "/organizations/org-1/holidays/holiday-1" &&
      options?.method === "DELETE"
    ) {
      return undefined;
    }
    if (path === "/organizations/org-1/holidays/employees") {
      return {
        data: [
          {
            id: "employee-1",
            name: "Holiday Employee",
            email: "employee@example.com",
            role: "EMPLOYEE",
          },
        ],
        serverTime: "2026-10-23T10:00:00.000Z",
      };
    }
    if (path === "/organizations/org-1/holidays/publication" && options?.method === "POST") {
      const body = options.body as { holidayIds: string[]; published: boolean };
      return {
        data: {
          published: body.published,
          changed: body.holidayIds.length,
          holidays: rows
            .filter((row) => body.holidayIds.includes(row.id))
            .map((row) => ({ ...row, published: body.published })),
        },
        serverTime: "2026-10-23T10:00:00.000Z",
      };
    }
    throw new Error(`Unexpected request: ${path} ${options?.method ?? "GET"}`);
  });
}

function renderView(role: Role = "ADMIN") {
  return render(
    <WorkspaceProvider session={sessionFor(role)}>
      <LeaveHolidaysView />
    </WorkspaceProvider>,
  );
}

describe("LeaveHolidaysView", () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
  });

  it("shows a read-only calendar to managers without holiday management permissions", async () => {
    respond([]);
    renderView("MANAGER");

    expect(await screen.findByText("Company holidays")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add holiday" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Holiday settings" })).not.toBeInTheDocument();
  });

  it("validates and creates a holiday with category and applicability", async () => {
    const user = userEvent.setup();
    respond([]);
    renderView();

    await screen.findByText("Company holidays");
    await user.click(screen.getByRole("button", { name: "Add holiday" }));

    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Create holiday" }));
    expect(screen.getByText("Holiday name is required.")).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/^Holiday name/), "Labour Day");
    fireEvent.change(within(dialog).getByLabelText(/^Date/), {
      target: { value: `${currentYear + 1}-05-01` },
    });
    fireEvent.change(within(dialog).getByLabelText(/^Category/), {
      target: { value: "COMPANY" },
    });
    await user.click(within(dialog).getByRole("button", { name: "Create holiday" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/holidays",
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({
            name: "Labour Day",
            holidayDate: `${currentYear + 1}-05-01`,
            category: "COMPANY",
            duration: "FULL_DAY",
            appliesToAll: true,
            applicableEmployeeIds: [],
          }),
        }),
      );
    });
  });

  it("deletes a holiday after confirmation", async () => {
    const user = userEvent.setup();
    respond([holiday()]);
    renderView();

    await screen.findAllByText("New Year's Day");
    await user.click(screen.getByRole("button", { name: "Delete holiday" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Delete holiday" })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Delete holiday" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/holidays/holiday-1",
        expect.objectContaining({ method: "DELETE" }),
      );
    });
  });

  it("filters government, company, and optional holidays and shows jurisdiction", async () => {
    const user = userEvent.setup();
    respond([
      holiday({
        id: "gov-1",
        name: "Republic Day",
        category: "NATIONAL",
        source: "GOVERNMENT",
        sourceId: "in-national-2026-gaz-01",
        sourceYear: 2026,
        sourceName: "DoPT central government holidays 2026",
        jurisdictionCountry: "IN",
        jurisdictionRegion: "NATIONAL",
      }),
      holiday({
        id: "company-1",
        name: "Founders Day",
        category: "COMPANY",
      }),
      holiday({
        id: "optional-1",
        name: "Restricted Day",
        category: "RESTRICTED",
        source: "GOVERNMENT",
        sourceId: "in-national-2026-rh-01",
        jurisdictionCountry: "IN",
        jurisdictionRegion: "NATIONAL",
      }),
    ]);
    renderView();

    await screen.findByText("Company holidays");
    await user.click(screen.getByRole("button", { name: "List" }));

    expect(await screen.findByText("Republic Day")).toBeInTheDocument();
    expect(screen.getByText("Founders Day")).toBeInTheDocument();
    expect(screen.getAllByText("National · India").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: /^Government/ }));
    expect(screen.getByText("Republic Day")).toBeInTheDocument();
    expect(screen.queryByText("Founders Day")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Company/ }));
    expect(screen.getByText("Founders Day")).toBeInTheDocument();
    expect(screen.queryByText("Republic Day")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Optional/ }));
    expect(screen.getByText("Restricted Day")).toBeInTheDocument();
    expect(screen.queryByText("Republic Day")).not.toBeInTheDocument();
  });

  it("publishes an imported draft after confirmation", async () => {
    const user = userEvent.setup();
    respond([
      holiday({
        id: "gov-1",
        name: "Republic Day",
        category: "NATIONAL",
        source: "GOVERNMENT",
        published: false,
        sourceId: "in-national-2026-gaz-01",
        jurisdictionCountry: "IN",
        jurisdictionRegion: "NATIONAL",
      }),
    ]);
    renderView();

    await screen.findByText("Company holidays");
    await user.click(screen.getByRole("button", { name: "List" }));

    expect(await screen.findByText("Draft")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Publish" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Publish holiday" })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Publish holiday" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/holidays/publication",
        expect.objectContaining({
          method: "POST",
          body: { holidayIds: ["gov-1"], published: true, confirmHistorical: false },
        }),
      );
    });
  });
});
