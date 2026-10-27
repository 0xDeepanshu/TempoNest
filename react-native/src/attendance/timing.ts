export interface BreakTiming {
  startedAt: string;
  endedAt: string | null;
}

export interface SessionTiming {
  startedAt: string;
  endedAt: string | null;
  breaks?: BreakTiming[];
  activeBreak?: BreakTiming | null;
}

export interface WorkTime {
  elapsedSeconds: number;
  breakSeconds: number;
  workedSeconds: number;
  isOnBreak: boolean;
}

/** Mirrors the backend heartbeat staleness window. */
export const HEARTBEAT_STALE_MS = 120_000;

const EMPTY_WORK_TIME: WorkTime = {
  elapsedSeconds: 0,
  breakSeconds: 0,
  workedSeconds: 0,
  isOnBreak: false,
};

function toMillis(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Work time is derived only from server timestamps. The local clock supplies
 * the ticking "now", adjusted by the server offset captured with each sync.
 */
export function computeWorkTime(session: SessionTiming, serverNowMs: number): WorkTime {
  const startedAt = toMillis(session.startedAt);
  if (startedAt === null) return EMPTY_WORK_TIME;

  const endedAt = toMillis(session.endedAt) ?? serverNowMs;
  const end = Math.max(startedAt, endedAt);

  const breaks = session.breaks ?? (session.activeBreak ? [session.activeBreak] : []);
  let breakMs = 0;
  let hasOpenBreak = false;

  for (const brk of breaks) {
    const breakStart = toMillis(brk.startedAt);
    if (breakStart === null) continue;

    const isOpen = brk.endedAt === null;
    const breakEnd = toMillis(brk.endedAt) ?? end;

    if (isOpen && breakEnd >= startedAt && breakStart <= end) {
      hasOpenBreak = true;
    }

    const clippedStart = Math.max(startedAt, breakStart);
    const clippedEnd = Math.min(end, breakEnd);
    if (clippedEnd > clippedStart) breakMs += clippedEnd - clippedStart;
  }

  const totalMs = end - startedAt;
  const elapsedSeconds = Math.max(0, Math.floor(totalMs / 1000));
  const breakSeconds = Math.max(0, Math.min(elapsedSeconds, Math.floor(breakMs / 1000)));

  return {
    elapsedSeconds,
    breakSeconds,
    workedSeconds: Math.max(0, elapsedSeconds - breakSeconds),
    isOnBreak: session.activeBreak?.endedAt === null || hasOpenBreak,
  };
}

/** Difference between the server clock and this device's clock. */
export function serverClockOffset(serverTime: string, receivedAtMs: number): number {
  const parsed = Date.parse(serverTime);
  if (Number.isNaN(parsed)) return 0;
  return parsed - receivedAtMs;
}

export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatDurationWords(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  return `${minutes}m`;
}

export function formatClockTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
