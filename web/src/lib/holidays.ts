import type {
  GovernmentHolidayCategory,
  Holiday,
  HolidayCategory,
  HolidaySource,
} from "./types";

export const HOLIDAY_FILTERS = ["ALL", "GOVERNMENT", "COMPANY", "OPTIONAL"] as const;
export type HolidayFilter = (typeof HOLIDAY_FILTERS)[number];

export const HOLIDAY_FILTER_LABELS: Record<HolidayFilter, string> = {
  ALL: "All",
  GOVERNMENT: "Government",
  COMPANY: "Company",
  OPTIONAL: "Optional",
};

export const HOLIDAY_CATEGORY_LABELS: Record<HolidayCategory, string> = {
  PUBLIC: "Public holiday",
  COMPANY: "Company holiday",
  OPTIONAL: "Optional holiday",
  NATIONAL: "National public holiday",
  STATE: "State public holiday",
  GAZETTED: "Gazetted holiday",
  RESTRICTED: "Restricted holiday",
};

export const GOVERNMENT_HOLIDAY_CATEGORY_LABELS: Record<GovernmentHolidayCategory, string> = {
  NATIONAL: "National public holiday",
  STATE: "State public holiday",
  GAZETTED: "Gazetted holiday",
  RESTRICTED: "Restricted holiday",
};

export const HOLIDAY_SOURCE_LABELS: Record<HolidaySource, string> = {
  MANUAL: "Company calendar",
  GOVERNMENT: "Government notification",
};

const GOVERNMENT_CATEGORIES: readonly HolidayCategory[] = [
  "NATIONAL",
  "STATE",
  "GAZETTED",
  "RESTRICTED",
];

const COUNTRY_NAMES: Record<string, string> = {
  IN: "India",
};

const REGION_NAMES: Record<string, string> = {
  "IN:NATIONAL": "National",
  "IN:UTTARAKHAND": "Uttarakhand",
};

export function holidayCategoryLabel(category: HolidayCategory): string {
  return HOLIDAY_CATEGORY_LABELS[category] ?? category;
}

export function holidaySourceLabel(source: HolidaySource): string {
  return HOLIDAY_SOURCE_LABELS[source] ?? source;
}

/** Imported or government-classified rows, never a locally created company holiday. */
export function isGovernmentHoliday(holiday: Pick<Holiday, "source" | "category">): boolean {
  return holiday.source === "GOVERNMENT" || GOVERNMENT_CATEGORIES.includes(holiday.category);
}

/** Optional and restricted holidays never reduce a leave charge. */
export function isNonWorkingHoliday(holiday: Pick<Holiday, "category">): boolean {
  return holiday.category === "OPTIONAL" || holiday.category === "RESTRICTED";
}

export function holidayFilterLabel(filter: HolidayFilter): string {
  return HOLIDAY_FILTER_LABELS[filter] ?? filter;
}

export function matchesHolidayFilter(
  holiday: Pick<Holiday, "source" | "category">,
  filter: HolidayFilter,
): boolean {
  switch (filter) {
    case "GOVERNMENT":
      return isGovernmentHoliday(holiday);
    case "COMPANY":
      return !isGovernmentHoliday(holiday) && !isNonWorkingHoliday(holiday);
    case "OPTIONAL":
      return isNonWorkingHoliday(holiday);
    case "ALL":
    default:
      return true;
  }
}

export function governmentJurisdictionLabel(
  country: string | null | undefined,
  region: string | null | undefined,
): string | null {
  if (!country) return null;
  const countryName = COUNTRY_NAMES[country] ?? country;
  if (!region) return countryName;
  const regionName = REGION_NAMES[`${country}:${region}`] ?? region;
  if (region === "NATIONAL") return `National · ${countryName}`;
  return `${regionName} · ${countryName}`;
}

export function holidayJurisdiction(
  holiday: Pick<
    Holiday,
    "source" | "category" | "jurisdictionCountry" | "jurisdictionRegion"
  >,
): string | null {
  if (!isGovernmentHoliday(holiday)) return null;
  return governmentJurisdictionLabel(
    holiday.jurisdictionCountry,
    holiday.jurisdictionRegion,
  );
}

export function isDraftHoliday(holiday: Pick<Holiday, "published">): boolean {
  return holiday.published === false;
}
