"use client";

import { useMemo, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { errorMessage, isApiError } from "@/lib/api-error";
import { nowMs } from "@/lib/clock";
import {
  addDays,
  dateOnlyInTimeZone,
  formatDateTime,
  formatDateTimeInput,
  formatDuration,
  formatTimeRange,
  isoForZonedDate,
  todayInTimeZone,
  zonedDateTimeToUtc,
} from "@/lib/format";
import type {
  AttendanceCorrection,
  SessionsResponse,
  TimeSession,
} from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { PlusIcon, TrashIcon } from "./icons";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  ErrorState,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
} from "./ui";

interface BreakDraft {
  key: number;
  startedAt: string;
  endedAt: string;
}

let breakCounter = 0;

function nextBreakKey(): number {
  breakCounter += 1;
  return breakCounter;
}

function toLocalInput(value: string | null, timezone: string, fallback: string): string {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function splitLocal(value: string): { date: string; time: string } {
  const [date, time = "00:00"] = value.split("T");
  return { date, time };
}

function localMillis(value: string, timezone: string): number {
  if (!value) return Number.NaN;
  const { date, time } = splitLocal(value);
  if (!date) return Number.NaN;
  return zonedDateTimeToUtc(date, time, timezone).getTime();
}

function toIso(value: string, timezone: string): string {
  const millis = localMillis(value, timezone);
  if (Number.isNaN(millis)) return "";
  return new Date(millis).toISOString();
}

function isoTodayStart(today: string, timezone: string): string {
  return isoForZonedDate(today, timezone);
}

/**
 * Pick a standard 09:00–17:00 window that has already finished in the
 * organization's timezone, so the initial values never violate the backend's
 * no-future-timestamps rule.
 */
function defaultCorrectionWindow(
  today: string,
  timezone: string,
): { start: string; end: string } {
  const localNow = formatDateTimeInput(new Date(nowMs()), timezone);
  const currentTime = localNow.slice(11);
  const day = currentTime < "17:00" ? addDays(today, -1) : today;
  return { start: `${day}T09:00`, end: `${day}T17:00` };
}

export function CorrectionForm({
  organizationId,
  timezone,
  onCreated,
  canListSessions = true,
}: {
  organizationId: string;
  timezone: string;
  onCreated: () => void;
  canListSessions?: boolean;
}) {
  const today = useMemo(() => todayInTimeZone(timezone), [timezone]);
  const defaults = useMemo(() => defaultCorrectionWindow(today, timezone), [today, timezone]);
  const defaultStart = defaults.start;
  const defaultEnd = defaults.end;

  const [target, setTarget] = useState<string>("new");
  const [startedAt, setStartedAt] = useState(defaultStart);
  const [endedAt, setEndedAt] = useState(defaultEnd);
  const [breaks, setBreaks] = useState<BreakDraft[]>([]);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const sessions = useApi<SessionsResponse>(
    (signal) =>
      apiRequest(`/organizations/${organizationId}/time-sessions`, {
        signal,
        query: {
          status: "STOPPED",
          from: isoTodayStart(addDays(today, -60), timezone),
          to: isoForZonedDate(today, timezone, true),
          limit: 100,
        },
      }),
    [organizationId, timezone, today],
    { enabled: Boolean(organizationId) && canListSessions },
  );

  const stoppedSessions = sessions.data?.data ?? [];
  const selectedSession = stoppedSessions.find((session) => session.id === target);

  function selectTarget(value: string) {
    setTarget(value);
    setSubmitError(null);
    setSuccess(null);
    setErrors({});

    if (value === "new") {
      setStartedAt(defaultStart);
      setEndedAt(defaultEnd);
      setBreaks([]);
      return;
    }

    const session = stoppedSessions.find((item) => item.id === value);
    if (!session) return;
    const fallbackEnd = toLocalInput(session.endedAt, timezone, defaultEnd);
    setStartedAt(toLocalInput(session.startedAt, timezone, defaultStart));
    setEndedAt(fallbackEnd);
    setBreaks(
      (session.breaks ?? []).map((brk) => ({
        key: nextBreakKey(),
        startedAt: toLocalInput(brk.startedAt, timezone, defaultStart),
        endedAt: toLocalInput(brk.endedAt, timezone, fallbackEnd),
      })),
    );
  }

  function addBreak() {
    const start = selectedSession
      ? toLocalInput(selectedSession.startedAt, timezone, defaultStart)
      : defaultStart;
    setBreaks((items) => [
      ...items,
      { key: nextBreakKey(), startedAt: start, endedAt: start },
    ]);
  }

  function updateBreak(key: number, field: "startedAt" | "endedAt", value: string) {
    setBreaks((items) =>
      items.map((item) => (item.key === key ? { ...item, [field]: value } : item)),
    );
  }

  function removeBreak(key: number) {
    setBreaks((items) => items.filter((item) => item.key !== key));
  }

  function validate(now: number): { errors: Record<string, string>; payload?: Record<string, unknown> } {
    const nextErrors: Record<string, string> = {};
    if (!startedAt) nextErrors.startedAt = "Choose a start time.";
    if (!endedAt) nextErrors.endedAt = "Choose an end time.";
    if (reason.trim().length < 3) nextErrors.reason = "Give a reason with at least 3 characters.";

    const start = startedAt ? localMillis(startedAt, timezone) : Number.NaN;
    const end = endedAt ? localMillis(endedAt, timezone) : Number.NaN;
    if (startedAt && Number.isNaN(start)) nextErrors.startedAt = "Enter a valid start time.";
    if (endedAt && Number.isNaN(end)) nextErrors.endedAt = "Enter a valid end time.";
    if (Number.isFinite(start) && Number.isFinite(end) && end <= start) {
      nextErrors.endedAt = "The end time must be after the start time.";
    }
    if (Number.isFinite(start) && start > now + 60_000) {
      nextErrors.startedAt = "Corrections cannot include future timestamps.";
    }
    if (Number.isFinite(end) && end > now + 60_000) {
      nextErrors.endedAt = "Corrections cannot include future timestamps.";
    }

    const parsedBreaks: Array<{ startedAt: string; endedAt: string }> = [];
    let previousEnd = Number.NEGATIVE_INFINITY;
    const sortedBreaks = [...breaks].sort(
      (a, b) => localMillis(a.startedAt, timezone) - localMillis(b.startedAt, timezone),
    );
    for (const brk of sortedBreaks) {
      const brkStart = localMillis(brk.startedAt, timezone);
      const brkEnd = localMillis(brk.endedAt, timezone);
      if (!brk.startedAt || !brk.endedAt || Number.isNaN(brkStart) || Number.isNaN(brkEnd)) {
        nextErrors[`break-${brk.key}`] = "Choose both break times.";
        continue;
      }
      if (brkEnd <= brkStart) {
        nextErrors[`break-${brk.key}`] = "Break end must be after its start.";
      }
      if (Number.isFinite(start) && brkStart < start) {
        nextErrors[`break-${brk.key}`] = "Break starts before the session.";
      }
      if (Number.isFinite(end) && brkEnd > end) {
        nextErrors[`break-${brk.key}`] = "Break ends after the session.";
      }
      if (brkStart < previousEnd) {
        nextErrors[`break-${brk.key}`] = "Breaks must not overlap.";
      }
      if (brkEnd > now + 60_000) {
        nextErrors[`break-${brk.key}`] = "Breaks cannot include future timestamps.";
      }
      previousEnd = Math.max(previousEnd, brkEnd);
      parsedBreaks.push({
        startedAt: new Date(brkStart).toISOString(),
        endedAt: new Date(brkEnd).toISOString(),
      });
    }

    if (Object.keys(nextErrors).length > 0) return { errors: nextErrors };

    const workDate =
      target !== "new" && selectedSession
        ? dateOnlyInTimeZone(selectedSession.startedAt, timezone)
        : dateOnlyInTimeZone(new Date(start), timezone);

    return {
      errors: {},
      payload: {
        ...(target !== "new" ? { sessionId: target } : {}),
        workDate,
        startedAt: new Date(start).toISOString(),
        endedAt: new Date(end).toISOString(),
        breaks: parsedBreaks,
        reason: reason.trim(),
      },
    };
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitError(null);
    setSuccess(null);
    const validation = validate(nowMs());
    setErrors(validation.errors);
    if (!validation.payload) return;

    setLoading(true);
    try {
      const response = await apiRequest<{ data: { correction: AttendanceCorrection } }>(
        `/organizations/${organizationId}/attendance/corrections`,
        { method: "POST", body: validation.payload },
      );
      setSuccess(
        `Correction request submitted for ${response.data.correction.workDate}. It is now pending review.`,
      );
      setReason("");
      setBreaks([]);
      setTarget("new");
      setStartedAt(defaultStart);
      setEndedAt(defaultEnd);
      onCreated();
    } catch (caught) {
      if (isApiError(caught)) {
        const fieldErrors: Record<string, string> = {};
        for (const detail of caught.details) {
          fieldErrors[detail.path.replace(/^body\./, "")] = detail.message;
        }
        if (Object.keys(fieldErrors).length > 0) setErrors(fieldErrors);
      }
      setSubmitError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  const workDate =
    target !== "new" && selectedSession
      ? dateOnlyInTimeZone(selectedSession.startedAt, timezone)
      : startedAt
        ? dateOnlyInTimeZone(toIso(startedAt, timezone), timezone)
        : today;

  return (
    <Card>
      <CardHeader
        title="Request an attendance correction"
        description="Corrections are reviewed before they change attendance. The backend validates overlap, future timestamps, and break intervals."
      />
      <form onSubmit={submit} className="space-y-5 p-4">
        {submitError ? <Alert tone="danger">{submitError}</Alert> : null}
        {success ? <Alert tone="success">{success}</Alert> : null}

        <Field
          label="Session to correct"
          htmlFor="correction-session"
          hint={
            canListSessions
              ? "Choose a stopped session, or request a missing session."
              : "Requesting a missing session. Reading stopped sessions requires attendance read access."
          }
        >
          <Select
            id="correction-session"
            value={target}
            onChange={(event) => selectTarget(event.target.value)}
            disabled={!canListSessions}
          >
            <option value="new">Missing session — create a new record</option>
            {stoppedSessions.map((session) => (
              <option key={session.id} value={session.id}>
                {formatDayForOption(session, timezone)}
              </option>
            ))}
          </Select>
        </Field>

        {sessions.loading ? (
          <div className="flex items-center gap-2 text-xs text-muted">
            <Spinner className="h-4 w-4" /> Loading recent stopped sessions…
          </div>
        ) : null}
        {sessions.error ? <ErrorState message={sessions.error} onRetry={sessions.reload} /> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Start time"
            htmlFor="correction-start"
            error={errors.startedAt}
            required
          >
            <Input
              id="correction-start"
              type="datetime-local"
              value={startedAt}
              max={toLocalInput(new Date().toISOString(), timezone, defaultStart)}
              onChange={(event) => setStartedAt(event.target.value)}
              required
            />
          </Field>
          <Field label="End time" htmlFor="correction-end" error={errors.endedAt} required>
            <Input
              id="correction-end"
              type="datetime-local"
              value={endedAt}
              max={toLocalInput(new Date().toISOString(), timezone, defaultEnd)}
              onChange={(event) => setEndedAt(event.target.value)}
              required
            />
          </Field>
        </div>

        <div className="rounded-lg border border-line bg-surface-muted px-3 py-2 text-xs text-ink-secondary">
          Affected work date: <strong className="tnum">{workDate}</strong>{" "}
          <span className="text-muted">({timezone})</span>
          {target !== "new" ? (
            <span className="block text-[11px] text-muted">
              For an existing session this is the original session&apos;s organization-local date.
            </span>
          ) : null}
        </div>

        {selectedSession ? (
          <div className="rounded-lg border border-line bg-surface-muted px-3 py-2 text-xs text-ink-secondary">
            Original: {formatDateTime(selectedSession.startedAt, timezone)} –{" "}
            {formatDateTime(selectedSession.endedAt, timezone)} ·{" "}
            <span className="tnum">{formatDuration(selectedSession.durationSeconds)}</span>
          </div>
        ) : null}

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-ink">Breaks</p>
              <p className="text-[11px] text-muted">
                Use full replacement breaks. Leave empty if there were none.
              </p>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={addBreak}>
              <PlusIcon className="h-3.5 w-3.5" />
              Add break
            </Button>
          </div>
          {breaks.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line-strong px-3 py-3 text-center text-xs text-muted">
              No breaks in this correction.
            </p>
          ) : (
            <div className="space-y-2">
              {breaks.map((brk) => (
                <div key={brk.key} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  <Field label="Break start" error={errors[`break-${brk.key}`]}>
                    <Input
                      type="datetime-local"
                      value={brk.startedAt}
                      onChange={(event) =>
                        updateBreak(brk.key, "startedAt", event.target.value)
                      }
                    />
                  </Field>
                  <Field label="Break end">
                    <Input
                      type="datetime-local"
                      value={brk.endedAt}
                      onChange={(event) =>
                        updateBreak(brk.key, "endedAt", event.target.value)
                      }
                    />
                  </Field>
                  <div className="flex items-end pb-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeBreak(brk.key)}
                      aria-label="Remove break"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <Field
          label="Reason"
          htmlFor="correction-reason"
          error={errors.reason}
          hint={`${reason.length}/2000 characters`}
          required
        >
          <Textarea
            id="correction-reason"
            value={reason}
            maxLength={2000}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Explain what happened — for example, the timer was started late after a system update."
            required
          />
        </Field>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" loading={loading}>
            Submit correction
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setReason("");
              setBreaks([]);
              setErrors({});
              setSubmitError(null);
              setSuccess(null);
            }}
          >
            Clear
          </Button>
        </div>
      </form>
    </Card>
  );
}

function formatDayForOption(session: TimeSession, timezone: string): string {
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(session.startedAt));
  return `${date} · ${formatTimeRange(session.startedAt, session.endedAt, timezone)} · ${formatDuration(session.durationSeconds)}`;
}
