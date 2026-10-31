import { describe, expect, it } from "vitest";
import {
  governmentJurisdictionLabel,
  holidayCategoryLabel,
  holidayFilterLabel,
  holidayJurisdiction,
  holidaySourceLabel,
  isDraftHoliday,
  isGovernmentHoliday,
  isNonWorkingHoliday,
  matchesHolidayFilter,
} from "./holidays";

const government = { source: "GOVERNMENT", category: "GAZETTED" } as const;
const company = { source: "MANUAL", category: "COMPANY" } as const;
const publicHoliday = { source: "MANUAL", category: "PUBLIC" } as const;
const optional = { source: "MANUAL", category: "OPTIONAL" } as const;
const restricted = { source: "GOVERNMENT", category: "RESTRICTED" } as const;

describe("holiday helpers", () => {
  it("separates imported government holidays from company holidays", () => {
    expect(isGovernmentHoliday(government)).toBe(true);
    expect(isGovernmentHoliday(restricted)).toBe(true);
    expect(isGovernmentHoliday(company)).toBe(false);
    expect(isGovernmentHoliday(publicHoliday)).toBe(false);
  });

  it("filters holidays by government, company, and optional groups", () => {
    expect(matchesHolidayFilter(government, "GOVERNMENT")).toBe(true);
    expect(matchesHolidayFilter(government, "COMPANY")).toBe(false);
    expect(matchesHolidayFilter(government, "OPTIONAL")).toBe(false);

    expect(matchesHolidayFilter(company, "COMPANY")).toBe(true);
    expect(matchesHolidayFilter(publicHoliday, "COMPANY")).toBe(true);
    expect(matchesHolidayFilter(company, "GOVERNMENT")).toBe(false);

    expect(matchesHolidayFilter(optional, "OPTIONAL")).toBe(true);
    expect(matchesHolidayFilter(restricted, "OPTIONAL")).toBe(true);
    expect(matchesHolidayFilter(restricted, "GOVERNMENT")).toBe(true);
    expect(matchesHolidayFilter(company, "OPTIONAL")).toBe(false);

    for (const holiday of [government, company, optional, restricted]) {
      expect(matchesHolidayFilter(holiday, "ALL")).toBe(true);
    }
  });

  it("labels categories, sources, and filter groups", () => {
    expect(holidayCategoryLabel("NATIONAL")).toBe("National public holiday");
    expect(holidayCategoryLabel("STATE")).toBe("State public holiday");
    expect(holidayCategoryLabel("GAZETTED")).toBe("Gazetted holiday");
    expect(holidayCategoryLabel("RESTRICTED")).toBe("Restricted holiday");
    expect(holidayCategoryLabel("COMPANY")).toBe("Company holiday");
    expect(holidayFilterLabel("GOVERNMENT")).toBe("Government");
    expect(holidaySourceLabel("GOVERNMENT")).toBe("Government notification");
    expect(holidaySourceLabel("MANUAL")).toBe("Company calendar");
  });

  it("labels government jurisdictions only for government holidays", () => {
    expect(governmentJurisdictionLabel("IN", "NATIONAL")).toBe("National · India");
    expect(governmentJurisdictionLabel("IN", "UTTARAKHAND")).toBe("Uttarakhand · India");
    expect(governmentJurisdictionLabel("IN", null)).toBe("India");
    expect(governmentJurisdictionLabel(null, null)).toBeNull();

    expect(
      holidayJurisdiction({
        source: "GOVERNMENT",
        category: "STATE",
        jurisdictionCountry: "IN",
        jurisdictionRegion: "UTTARAKHAND",
      }),
    ).toBe("Uttarakhand · India");
    expect(
      holidayJurisdiction({
        source: "MANUAL",
        category: "COMPANY",
        jurisdictionCountry: null,
        jurisdictionRegion: null,
      }),
    ).toBeNull();
  });

  it("treats optional and restricted holidays as informational", () => {
    expect(isNonWorkingHoliday(optional)).toBe(true);
    expect(isNonWorkingHoliday(restricted)).toBe(true);
    expect(isNonWorkingHoliday(publicHoliday)).toBe(false);
    expect(isNonWorkingHoliday(company)).toBe(false);
  });

  it("detects unpublished drafts", () => {
    expect(isDraftHoliday({ published: false })).toBe(true);
    expect(isDraftHoliday({ published: true })).toBe(false);
  });
});
