import { addDays, daysBetween, isDateOnly, todayInTimeZone } from "./format";

/** Reads a `from`/`to` deep link, falling back to a recent window when invalid. */
export function reportRangeFromUrl(
  from: string,
  to: string,
  timezone: string,
  fallbackDays = 7,
  maxDays = 366,
): { from: string; to: string } {
  const today = todayInTimeZone(timezone);
  const fallback = { from: addDays(today, -(fallbackDays - 1)), to: today };
  if (!isDateOnly(from) || !isDateOnly(to)) return fallback;
  if (from > to || daysBetween(from, to) > maxDays) return fallback;
  return { from, to };
}
