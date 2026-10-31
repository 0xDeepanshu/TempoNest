import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HolidaySettingsView } from "@/components/holiday-settings-view";
import { WorkspaceProvider } from "@/components/workspace";
import { apiRequest } from "@/lib/api-client";
import type { HolidaySettings, Organization, Role, SessionData } from "@/lib/types";

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
    defaultCalendarYear: 2026,
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

function renderSettings(role: Role = "OWNER") {
  return render(
    <WorkspaceProvider session={sessionFor(role)}>
      <HolidaySettingsView />
    </WorkspaceProvider>,
  );
}

describe("HolidaySettingsView", () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
  });

  it("loads and saves holiday controls, defaults, and working days", async () => {
    const user = userEvent.setup();
    mockedApiRequest.mockImplementation(async (path, options) => {
      if (
        path === "/organizations/org-1/holidays/settings" &&
        (options?.method ?? "GET") === "GET"
      ) {
        return { data: { settings: settings() }, serverTime: "2026-10-30T12:00:00.000Z" };
      }
      if (
        path === "/organizations/org-1/holidays/settings" &&
        options?.method === "PUT"
      ) {
        return {
          data: {
            settings: settings({
              optionalHolidaysEnabled: false,
              defaultCalendarYear: 2027,
              workingDays: [1, 2, 3, 4, 5, 6, 7],
              updatedByUserId: "admin-1",
              updatedBy: {
                id: "admin-1",
                name: "Admin User",
                email: "admin@example.com",
              },
            }),
          },
          serverTime: "2026-10-30T12:00:00.000Z",
        };
      }
      throw new Error(`Unexpected request: ${path} ${options?.method ?? "GET"}`);
    });

    renderSettings();

    expect(await screen.findByText("Calendar controls")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /Allow optional holidays/ }));
    const year = screen.getByLabelText(/Default calendar year/);
    await user.clear(year);
    await user.type(year, "2027");
    await user.click(screen.getByRole("checkbox", { name: "Saturday" }));
    await user.click(screen.getByRole("checkbox", { name: "Sunday" }));

    await user.click(screen.getByRole("button", { name: "Save holiday settings" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/holidays/settings",
        expect.objectContaining({
          method: "PUT",
          body: {
            enabled: true,
            optionalHolidaysEnabled: false,
            allowHalfDayHolidays: true,
            defaultCalendarYear: 2027,
            defaultApplicability: "ORGANIZATION",
            workingDays: [1, 2, 3, 4, 5, 6, 7],
            governmentCountry: "IN",
            governmentRegion: null,
            governmentYear: null,
          },
        }),
      );
    });
    expect(await screen.findByText("Holiday settings saved.")).toBeInTheDocument();
    expect(await screen.findByText(/Updated by Admin User/)).toBeInTheDocument();
  });

  it("shows a read-only state when the role cannot manage holiday settings", async () => {
    mockedApiRequest.mockResolvedValue({
      data: { settings: settings() },
      serverTime: "2026-10-30T12:00:00.000Z",
    });

    renderSettings("MANAGER");

    expect(await screen.findByText("Read-only view")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save holiday settings" }),
    ).toBeDisabled();
  });
});
