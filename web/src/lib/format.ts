const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function formatDuration(totalSeconds: number | null | undefined): string {
  const seconds = Math.max(0, Math.floor(totalSeconds ?? 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0 && minutes === 0) {
    return seconds > 0 ? "<1m" : "0m";
  }
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

export function formatDurationLong(totalSeconds: number | null | undefined): string {
  const seconds = Math.max(0, Math.floor(totalSeconds ?? 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes} min`;
  return `${hours} hr ${minutes} min`;
}

export function formatDate(
  value: string | Date | null | undefined,
  timeZone = "UTC",
  options: Intl.DateTimeFormatOptions = {},
): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
    ...options,
  }).format(date);
}

export function formatDay(
  dateOnly: string | null | undefined,
  options: Intl.DateTimeFormatOptions = {},
): string {
  if (!dateOnly || !DATE_ONLY.test(dateOnly)) return "—";
  return formatDate(`${dateOnly}T00:00:00.000Z`, "UTC", options);
}

export function formatDateTime(
  value: string | Date | null | undefined,
  timeZone = "UTC",
): string {
  return formatDate(value, timeZone, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatTime(
  value: string | Date | null | undefined,
  timeZone = "UTC",
): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatTimeRange(
  start: string | null | undefined,
  end: string | null | undefined,
  timeZone = "UTC",
): string {
  if (!start) return "—";
  return `${formatTime(start, timeZone)} – ${end ? formatTime(end, timeZone) : "now"}`;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const clean = new Date(Math.floor(date.getTime() / 1000) * 1000);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(clean)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function offsetMs(date: Date, timeZone: string): number {
  const parts = zonedParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Converts an organization-local `YYYY-MM-DD` + `HH:mm` wall time to UTC. */
export function zonedDateTimeToUtc(date: string, time: string, timeZone: string): Date {
  const dateMatch = DATE_ONLY.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})(?::(\d{2}))?/.exec(time);
  if (!dateMatch || !timeMatch) return new Date(Number.NaN);

  const [year, month, day] = date.split("-").map(Number);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const second = Number(timeMatch[3] ?? 0);
  const wallUtc = Date.UTC(year, month - 1, day, hour, minute, second);

  let guess = wallUtc;
  for (let index = 0; index < 3; index += 1) {
    const candidate = wallUtc - offsetMs(new Date(guess), timeZone);
    if (candidate === guess) break;
    guess = candidate;
  }
  return new Date(guess);
}

export function isoForZonedDate(date: string, timeZone: string, endOfDay = false): string {
  return zonedDateTimeToUtc(date, endOfDay ? "23:59:59" : "00:00:00", timeZone).toISOString();
}

export function todayInTimeZone(timeZone: string): string {
  const parts = zonedParts(new Date(), timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function dateOnlyInTimeZone(
  value: string | Date,
  timeZone: string,
): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const parts = zonedParts(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function formatDateTimeInput(value: string | Date, timeZone: string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const parts = zonedParts(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

export function addDays(dateOnly: string, days: number): string {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return dateOnly;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function startOfMonth(dateOnly: string): string {
  return `${dateOnly.slice(0, 7)}-01`;
}

export function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.round((end - start) / 86_400_000) + 1;
}

export function formatDateRange(from: string, to: string): string {
  if (from === to) return formatDay(from);
  return `${formatDay(from, { year: undefined })} – ${formatDay(to)}`;
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

export function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function initialsColor(seed: string): string {
  const palette = [
    "bg-surface-hover text-ink-secondary",
    "bg-surface-muted text-ink",
    "border border-line-strong bg-surface text-ink-secondary",
    "bg-surface-hover text-ink",
    "bg-surface-muted text-ink-secondary",
    "border border-line bg-surface-hover text-ink",
  ];
  let hash = 0;
  for (const character of seed) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length];
}

export function isValidTimezone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

export function isDateOnly(value: string): boolean {
  if (!DATE_ONLY.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
