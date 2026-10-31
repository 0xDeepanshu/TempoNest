"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import {
  dateOnlyInTimeZone,
  daysBetween,
  formatDateRange,
  formatDateTime,
  formatDay,
  formatDuration,
  formatTime,
  formatTimeRange,
  isoForZonedDate,
  startOfMonth,
  todayInTimeZone,
} from "@/lib/format";
import { hasPermission } from "@/lib/permissions";
import type {
  AttendanceSummary,
  AttendanceSummaryPeriod,
  SessionsResponse,
  TimeSession,
} from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { CalendarIcon, ChevronDownIcon, ClockIcon } from "./icons";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Pagination,
  StatCard,
  StatusBadge,
  TableShell,
  Tabs,
  Td,
  Th,
  cn,
} from "./ui";
import { NoOrganization, useWorkspace } from "./workspace";

function breakSecondsFor(session: TimeSession): number {
  return (session.breaks ?? []).reduce(
    (total, brk) => total + Math.max(0, brk.durationSeconds),
    0,
  );
}

function workedSecondsFor(session: TimeSession): number {
  return Math.max(0, session.durationSeconds - breakSecondsFor(session));
}

interface SessionDay {
  date: string;
  sessions: TimeSession[];
  workedSeconds: number;
  breakSeconds: number;
  firstStartedAt: string;
  lastEndedAt: string | null;
  open: boolean;
}

function groupSessionsByDay(sessions: TimeSession[], timeZone: string): SessionDay[] {
  const days = new Map<string, SessionDay>();

  for (const session of sessions) {
    const date = dateOnlyInTimeZone(session.startedAt, timeZone);
    let day = days.get(date);
    if (!day) {
      day = {
        date,
        sessions: [],
        workedSeconds: 0,
        breakSeconds: 0,
        firstStartedAt: session.startedAt,
        lastEndedAt: session.endedAt,
        open: false,
      };
      days.set(date, day);
    }

    day.sessions.push(session);
    day.workedSeconds += workedSecondsFor(session);
    day.breakSeconds += breakSecondsFor(session);
    if (Date.parse(session.startedAt) < Date.parse(day.firstStartedAt)) {
      day.firstStartedAt = session.startedAt;
    }
    if (!session.endedAt) day.open = true;
    const effectiveEnd =
      session.endedAt ??
      new Date(
        Date.parse(session.startedAt) + session.durationSeconds * 1000,
      ).toISOString();
    if (!day.lastEndedAt || Date.parse(effectiveEnd) > Date.parse(day.lastEndedAt)) {
      day.lastEndedAt = effectiveEnd;
    }
  }

  return [...days.values()];
}

function SessionDayRow({ day, timezone }: { day: SessionDay; timezone: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const count = day.sessions.length;

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-left transition-colors hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ink"
      >
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-ink">
            {formatDay(day.date, { weekday: "short", month: "short", day: "numeric" })}
          </p>
          <p className="mt-0.5 text-[11px] text-muted">
            {count} session{count === 1 ? "" : "s"} ·{" "}
            {formatTimeRange(
              day.firstStartedAt,
              day.open ? null : day.lastEndedAt,
              timezone,
            )}
          </p>
        </div>
        <div className="flex items-center gap-5">
          <div className="text-right">
            <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
              Worked
            </p>
            <p className="text-xs font-semibold tnum text-ink">
              {formatDuration(day.workedSeconds)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
              Breaks
            </p>
            <p className="text-xs font-semibold tnum text-ink">
              {formatDuration(day.breakSeconds)}
            </p>
          </div>
          <ChevronDownIcon
            className={cn(
              "h-4 w-4 text-muted transition-transform",
              open && "rotate-180",
            )}
          />
        </div>
      </button>

      {open ? (
        <div id={panelId} className="border-t border-line bg-surface-muted/50 px-4 py-3">
          <ul className="space-y-2">
            {day.sessions.map((session) => {
              const breaks = session.breaks ?? [];
              const breakSeconds = breakSecondsFor(session);
              return (
                <li
                  key={session.id}
                  className="rounded-lg border border-line bg-surface px-3 py-2.5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-medium text-ink">
                        {formatTimeRange(session.startedAt, session.endedAt, timezone)}
                      </p>
                      <StatusBadge status={session.status} />
                    </div>
                    <p className="text-xs font-semibold tnum text-ink">
                      {formatDuration(workedSecondsFor(session))} worked
                    </p>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
                    <span>{formatDuration(session.durationSeconds)} elapsed</span>
                    <span>
                      {formatDuration(breakSeconds)} break
                      {breaks.length === 1 ? "" : "s"}
                    </span>
                    <span>
                      {session.source === "ONLINE" ? "Online" : "Offline"} agent
                    </span>
                  </div>
                  {breaks.length > 0 ? (
                    <ul className="mt-2 space-y-0.5 border-t border-line pt-2 text-[11px] text-muted">
                      {breaks.map((brk) => (
                        <li key={brk.id}>
                          Break {formatTimeRange(brk.startedAt, brk.endedAt, timezone)}
                          {brk.status === "ACTIVE" ? " · active" : ""}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </li>
  );
}

export function AttendanceView({ timezone }: { timezone: string }) {
  const { organization, membership, user } = useWorkspace();
  const organizationId = organization?.id ?? "";
  // My attendance is always scoped to the signed-in employee. Non-employee roles
  // must send the employee ID explicitly or the summary endpoint rejects the
  // request; the session list would otherwise fall back to the whole organization.
  const employeeId = user.id;
  const today = useMemo(() => todayInTimeZone(timezone), [timezone]);

  const [period, setPeriod] = useState<AttendanceSummaryPeriod>("monthly");
  const [draftFrom, setDraftFrom] = useState(() => startOfMonth(today));
  const [draftTo, setDraftTo] = useState(today);
  const [range, setRange] = useState(() => ({ from: startOfMonth(today), to: today }));
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const summary = useApi<{ data: AttendanceSummary; serverTime: string }>(
    (signal) =>
      apiRequest(`/organizations/${organizationId}/attendance/summaries`, {
        signal,
        query: { from: range.from, to: range.to, period, employeeId },
      }),
    [organizationId, employeeId, range.from, range.to, period],
    { enabled: Boolean(organizationId && employeeId) },
  );

  const sessions = useApi<SessionsResponse>(
    (signal) =>
      apiRequest(`/organizations/${organizationId}/time-sessions`, {
        signal,
        query: {
          employeeId,
          from: isoForZonedDate(range.from, timezone),
          to: isoForZonedDate(range.to, timezone, true),
          page,
          limit: 20,
        },
      }),
    [organizationId, employeeId, range.from, range.to, timezone, page],
    { enabled: Boolean(organizationId && employeeId) },
  );

  function applyRange() {
    setRangeError(null);
    if (!draftFrom || !draftTo) {
      setRangeError("Choose both a start and end date.");
      return;
    }
    if (draftTo < draftFrom) {
      setRangeError("The end date must be on or after the start date.");
      return;
    }
    if (daysBetween(draftFrom, draftTo) > 366) {
      setRangeError("Attendance ranges cannot exceed 366 days.");
      return;
    }
    setRange({ from: draftFrom, to: draftTo });
    setPage(1);
  }

  function resetRange() {
    setDraftFrom(startOfMonth(today));
    setDraftTo(today);
    setRange({ from: startOfMonth(today), to: today });
    setPage(1);
    setRangeError(null);
  }

  const summaryData = summary.data?.data;
  const totals = summaryData?.totals;
  const rows = summaryData?.periods ?? [];
  const sessionDays = useMemo(
    () => groupSessionsByDay(sessions.data?.data ?? [], timezone),
    [sessions.data, timezone],
  );
  const canSeeTeam = hasPermission(membership, "report:read");

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${organization?.name ?? "Attendance"} · ${timezone}`}
        title="My attendance"
        description="Your own server-recorded sessions and break totals. Periods use the organization-local calendar; weekly buckets start on Monday."
        actions={
          canSeeTeam ? (
            <Link href="/admin/reports">
              <Button variant="secondary">Team reports</Button>
            </Link>
          ) : undefined
        }
      />

      <Card>
        <CardBody className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="From" htmlFor="attendance-from">
              <Input
                id="attendance-from"
                type="date"
                value={draftFrom}
                max={draftTo || undefined}
                onChange={(event) => setDraftFrom(event.target.value)}
              />
            </Field>
            <Field label="To" htmlFor="attendance-to">
              <Input
                id="attendance-to"
                type="date"
                value={draftTo}
                min={draftFrom || undefined}
                onChange={(event) => setDraftTo(event.target.value)}
              />
            </Field>
            <Field label="Group totals by" htmlFor="attendance-period">
              <Tabs
                value={period}
                onChange={(value) => setPeriod(value)}
                tabs={[
                  { value: "daily", label: "Daily" },
                  { value: "weekly", label: "Weekly" },
                  { value: "monthly", label: "Monthly" },
                ]}
                className="h-10"
              />
            </Field>
            <div className="flex items-end gap-2">
              <Button onClick={applyRange}>Apply</Button>
              <Button variant="ghost" onClick={resetRange}>
                This month
              </Button>
            </div>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <CalendarIcon className="h-3.5 w-3.5" />
            {formatDateRange(range.from, range.to)}
          </p>
        </CardBody>
        {rangeError ? (
          <div className="px-4 pb-4">
            <Alert tone="danger">{rangeError}</Alert>
          </div>
        ) : null}
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Worked"
          value={summary.loading ? "…" : formatDuration(totals?.workedSeconds)}
          hint={`${totals?.activeDays ?? 0} active days`}
          accent="indigo"
          icon={<ClockIcon className="h-4 w-4" />}
        />
        <StatCard
          label="Breaks"
          value={summary.loading ? "…" : formatDuration(totals?.breakSeconds)}
          hint="Merged break time inside the range"
          accent="amber"
        />
        <StatCard
          label="Sessions"
          value={summary.loading ? "…" : (totals?.sessionCount ?? 0)}
          hint="Distinct sessions, not double-counted"
          accent="sky"
        />
        <StatCard
          label="First start"
          value={
            summary.loading
              ? "…"
              : totals?.firstStartedAt
                ? formatTime(totals.firstStartedAt, timezone)
                : "—"
          }
          hint={
            totals?.lastEndedAt
              ? `Last ended ${formatDateTime(totals.lastEndedAt, timezone)}`
              : "No sessions in this range"
          }
          accent="emerald"
        />
      </div>

      {summary.error ? <ErrorState message={summary.error} onRetry={summary.reload} /> : null}

      {!summary.error ? (
        <Card>
          <CardHeader
            title={`${period.charAt(0).toUpperCase() + period.slice(1)} totals`}
            description="Totals are calculated from sessions clipped to the selected organization-local dates."
          />
          {summary.loading && !summary.data ? (
            <LoadingBlock label="Loading attendance totals" rows={3} />
          ) : rows.length === 0 ? (
            <EmptyState
              title="No attendance in this range"
              description="Adjust the dates or record time from the desktop agent."
              icon={<ClockIcon className="h-5 w-5" />}
            />
          ) : (
            <TableShell>
              <thead>
                <tr>
                  <Th>Period</Th>
                  <Th>Worked</Th>
                  <Th>Breaks</Th>
                  <Th>Sessions</Th>
                  <Th>Active days</Th>
                  <Th>First start</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.periodStart} className="hover:bg-surface-muted">
                    <Td className="font-medium text-ink">
                      {row.periodStart === row.periodEnd
                        ? formatDay(row.periodStart, { weekday: "short" })
                        : formatDateRange(row.periodStart, row.periodEnd)}
                    </Td>
                    <Td className="font-medium tnum text-ink">
                      {formatDuration(row.workedSeconds)}
                    </Td>
                    <Td className="tnum">{formatDuration(row.breakSeconds)}</Td>
                    <Td className="tnum">{row.sessionCount}</Td>
                    <Td className="tnum">{row.activeDays}</Td>
                    <Td className="text-xs text-muted">
                      {row.firstStartedAt ? formatDateTime(row.firstStartedAt, timezone) : "—"}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          )}
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Session history"
          description="Grouped by the organization-local date each session started. Expand a day to inspect individual sessions, their status, and break details. Day subtotals cover the sessions on this page."
        />
        {sessions.error ? (
          <div className="p-4">
            <ErrorState message={sessions.error} onRetry={sessions.reload} />
          </div>
        ) : sessions.loading && !sessions.data ? (
          <LoadingBlock label="Loading session history" rows={4} />
        ) : sessionDays.length === 0 ? (
          <EmptyState
            title="No sessions found"
            description="Time tracked by the desktop agent will appear here. Adjust the dates if you expect older sessions."
            icon={<ClockIcon className="h-5 w-5" />}
          />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {sessionDays.map((day) => (
                <SessionDayRow key={day.date} day={day} timezone={timezone} />
              ))}
            </ul>
            <div className="px-4 py-3">
              <Pagination
                page={sessions.data?.meta.page ?? page}
                totalPages={sessions.data?.meta.totalPages ?? 1}
                onPageChange={setPage}
              />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

export function AttendancePageView() {
  const { organization } = useWorkspace();
  if (!organization) return <NoOrganization />;
  return <AttendanceView timezone={organization.timezone} />;
}
