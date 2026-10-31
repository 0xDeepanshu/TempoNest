import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GovernmentHolidayImport } from "@/components/government-holiday-import";
import { apiRequest } from "@/lib/api-client";
import type { Holiday } from "@/lib/types";

vi.mock("@/lib/api-client", () => ({
  apiRequest: vi.fn(),
}));

const mockedApiRequest = vi.mocked(apiRequest);

const source = {
  name: "Central Government holidays 2026",
  issuer: "Department of Personnel and Training",
  reference: "F.No.12/2/2023-JCA dated 3 July 2025",
  url: "https://example.gov.in/holidays-2026.pdf",
  retrievedOn: "2026-10-30",
  verification: "Dates transcribed from the official notification.",
};

function importedHoliday(): Holiday {
  return {
    id: "holiday-1",
    organizationId: "org-1",
    holidayDate: "2026-01-26",
    name: "Republic Day",
    category: "NATIONAL",
    duration: "FULL_DAY",
    description: null,
    appliesToAll: true,
    applicableEmployeeIds: [],
    departmentIds: [],
    locationIds: [],
    published: false,
    source: "GOVERNMENT",
    sourceId: "in-national-2026-gaz-01",
    sourceYear: 2026,
    sourceName: source.name,
    sourceUrl: source.url,
    sourceReference: source.reference,
    jurisdictionCountry: "IN",
    jurisdictionRegion: "NATIONAL",
    importedAt: "2026-10-30T10:00:00.000Z",
    createdByUserId: "admin-1",
    updatedByUserId: "admin-1",
    createdBy: null,
    updatedBy: null,
    createdAt: "2026-10-30T10:00:00.000Z",
    updatedAt: "2026-10-30T10:00:00.000Z",
  };
}

function mockCatalog(years: number[]) {
  mockedApiRequest.mockImplementation(async (path, options) => {
    if (path.endsWith("/holidays/government/jurisdictions")) {
      return {
        data: {
          countries: [
            {
              code: "IN",
              name: "India",
              regions: [
                {
                  code: "NATIONAL",
                  name: "National",
                  years: years.map((year) => ({ year, holidayCount: 3, source })),
                },
              ],
            },
          ],
        },
        serverTime: "2026-10-30T10:00:00.000Z",
      };
    }
    if (path.endsWith("/holidays/government/preview")) {
      return {
        data: {
          country: "IN",
          countryName: "India",
          region: "NATIONAL",
          regionName: "National",
          year: 2026,
          availableYears: years,
          available: true,
          source,
          entries: [
            {
              sourceId: "in-national-2026-gaz-01",
              name: "Republic Day",
              holidayDate: "2026-01-26",
              category: "NATIONAL",
              status: "AVAILABLE",
            },
            {
              sourceId: "in-national-2026-gaz-02",
              name: "Holi",
              holidayDate: "2026-03-04",
              category: "GAZETTED",
              status: "IMPORTED",
            },
            {
              sourceId: "in-national-2026-gaz-03",
              name: "Diwali",
              holidayDate: "2026-11-08",
              category: "GAZETTED",
              status: "DUPLICATE_NAME",
            },
          ],
          counts: { total: 3, available: 1, imported: 1, duplicates: 1 },
          message: null,
        },
        serverTime: "2026-10-30T10:00:00.000Z",
      };
    }
    if (path.endsWith("/holidays/government/import") && options?.method === "POST") {
      return {
        data: {
          country: "IN",
          region: "NATIONAL",
          year: 2026,
          source,
          imported: [importedHoliday()],
          skipped: [],
          published: false,
        },
        serverTime: "2026-10-30T10:00:00.000Z",
      };
    }
    throw new Error(`Unexpected request: ${path} ${options?.method ?? "GET"}`);
  });
}

function renderImport(onImported = vi.fn()) {
  render(
    <GovernmentHolidayImport
      organizationId="org-1"
      initialCountry="IN"
      initialRegion="NATIONAL"
      initialYear={2026}
      onClose={vi.fn()}
      onImported={onImported}
    />,
  );
  return onImported;
}

describe("GovernmentHolidayImport", () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
  });

  it("previews verified holidays, preselects new entries, and imports after confirmation", async () => {
    const user = userEvent.setup();
    mockCatalog([2026]);
    const onImported = renderImport();

    expect(await screen.findByText("Republic Day")).toBeInTheDocument();
    expect(screen.getByText("Holi")).toBeInTheDocument();
    expect(screen.getByText("Diwali")).toBeInTheDocument();
    expect(screen.getByText(/1 listed|3 listed/)).toBeInTheDocument();

    const importButton = screen.getByRole("button", { name: "Import 1 holiday" });
    expect(importButton).toBeDisabled();

    await user.click(
      screen.getByRole("checkbox", { name: /I reviewed this list/ }),
    );
    expect(importButton).toBeEnabled();
    await user.click(importButton);

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/holidays/government/import",
        expect.objectContaining({
          method: "POST",
          body: {
            country: "IN",
            region: "NATIONAL",
            year: 2026,
            sourceIds: ["in-national-2026-gaz-01"],
          },
        }),
      );
    });

    expect(await screen.findByText("Government holidays imported")).toBeInTheDocument();
    expect(screen.getByText(/added as drafts/)).toBeInTheDocument();
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it("does not offer an import when no verified year exists", async () => {
    mockCatalog([]);
    renderImport();

    expect(
      await screen.findByText("No verified government data available"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import 0 holidays" })).toBeDisabled();
    expect(
      mockedApiRequest.mock.calls.some(([path]) =>
        String(path).includes("/government/preview"),
      ),
    ).toBe(false);
  });
});
