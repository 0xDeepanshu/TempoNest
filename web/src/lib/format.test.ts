import { describe, expect, it } from "vitest";
import {
  addDays,
  dateOnlyInTimeZone,
  daysBetween,
  formatDateTimeInput,
  formatDuration,
  formatPercent,
  getInitials,
  isDateOnly,
  isValidTimezone,
  isoForZonedDate,
  zonedDateTimeToUtc,
} from "@/lib/format";

describe("duration formatting", () => {
  it("formats hours, minutes, and sub-minute values", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(30)).toBe("<1m");
    expect(formatDuration(90)).toBe("1m");
    expect(formatDuration(3_600)).toBe("1h 00m");
    expect(formatDuration(5_430)).toBe("1h 30m");
    expect(formatDuration(null)).toBe("0m");
    expect(formatDuration(-10)).toBe("0m");
  });

  it("formats percentages with sensible precision", () => {
    expect(formatPercent(12.345)).toBe("12%");
    expect(formatPercent(4.26)).toBe("4.3%");
    expect(formatPercent(Number.NaN)).toBe("0%");
  });
});

describe("date-only helpers", () => {
  it("adds days across month boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("counts inclusive day ranges", () => {
    expect(daysBetween("2026-01-01", "2026-01-01")).toBe(1);
    expect(daysBetween("2026-01-01", "2026-01-07")).toBe(7);
    expect(daysBetween("2026-02-27", "2026-03-01")).toBe(3);
    expect(daysBetween("not-a-date", "2026-01-01")).toBe(0);
  });

  it("validates date-only strings", () => {
    expect(isDateOnly("2026-10-23")).toBe(true);
    expect(isDateOnly("2026-02-30")).toBe(false);
    expect(isDateOnly("2026-10-23T00:00:00Z")).toBe(false);
  });
});

describe("timezone conversion", () => {
  it("converts organization-local wall time to UTC across DST", () => {
    expect(zonedDateTimeToUtc("2026-01-15", "09:00", "America/New_York").toISOString()).toBe(
      "2026-01-15T14:00:00.000Z",
    );
    expect(zonedDateTimeToUtc("2026-07-15", "09:00", "America/New_York").toISOString()).toBe(
      "2026-07-15T13:00:00.000Z",
    );
  });

  it("round-trips local date formatting", () => {
    const utc = zonedDateTimeToUtc("2026-10-23", "17:30", "Europe/Berlin");
    expect(utc.toISOString()).toBe("2026-10-23T15:30:00.000Z");
    expect(formatDateTimeInput(utc, "Europe/Berlin")).toBe("2026-10-23T17:30");
    expect(dateOnlyInTimeZone(utc, "Europe/Berlin")).toBe("2026-10-23");
  });

  it("builds day boundaries in the requested timezone", () => {
    expect(isoForZonedDate("2026-10-23", "Europe/Berlin")).toBe("2026-10-22T22:00:00.000Z");
    expect(isoForZonedDate("2026-10-23", "Europe/Berlin", true)).toBe(
      "2026-10-23T21:59:59.000Z",
    );
  });

  it("rejects invalid timezone and malformed date inputs", () => {
    expect(isValidTimezone("Europe/Berlin")).toBe(true);
    expect(isValidTimezone("Not/AZone")).toBe(false);
    expect(Number.isNaN(zonedDateTimeToUtc("not-a-date", "09:00", "Europe/Berlin").getTime())).toBe(
      true,
    );
    expect(Number.isNaN(zonedDateTimeToUtc("2026-10-23", "not-a-time", "Europe/Berlin").getTime())).toBe(
      true,
    );
  });
});

describe("display helpers", () => {
  it("derives initials", () => {
    expect(getInitials("Ada Lovelace")).toBe("AL");
    expect(getInitials("  Grace   Brewster Murray Hopper ")).toBe("GB");
    expect(getInitials("Prince")).toBe("P");
  });
});
