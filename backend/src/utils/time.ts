export type Interval = { start: Date; end: Date };

export function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export function secondsBetween(start: Date, end: Date): number {
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000));
}

export function clampInterval(interval: Interval, min: Date, max: Date): Interval | null {
  const start = new Date(Math.max(interval.start.getTime(), min.getTime()));
  const end = new Date(Math.min(interval.end.getTime(), max.getTime()));
  return end.getTime() > start.getTime() ? { start, end } : null;
}

export function intersectIntervals(left: Interval, right: Interval): Interval | null {
  const start = new Date(Math.max(left.start.getTime(), right.start.getTime()));
  const end = new Date(Math.min(left.end.getTime(), right.end.getTime()));
  return end.getTime() > start.getTime() ? { start, end } : null;
}

export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals
    .filter((interval) => interval.end.getTime() > interval.start.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (!last || interval.start.getTime() > last.end.getTime()) {
      merged.push({ start: interval.start, end: interval.end });
    } else if (interval.end.getTime() > last.end.getTime()) {
      last.end = interval.end;
    }
  }
  return merged;
}

/** Return the parts of `base` not covered by any interval in `cuts`. */
export function subtractIntervals(base: Interval, cuts: Interval[]): Interval[] {
  const relevant = cuts
    .map((cut) => intersectIntervals(base, cut))
    .filter((cut): cut is Interval => cut !== null)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const result: Interval[] = [];
  let cursor = base.start;

  for (const cut of relevant) {
    if (cut.start.getTime() > cursor.getTime()) {
      result.push({ start: cursor, end: cut.start });
    }
    if (cut.end.getTime() > cursor.getTime()) cursor = cut.end;
  }

  if (cursor.getTime() < base.end.getTime()) {
    result.push({ start: cursor, end: base.end });
  }
  return result;
}

export function totalSeconds(intervals: Interval[]): number {
  return intervals.reduce((sum, interval) => sum + secondsBetween(interval.start, interval.end), 0);
}
