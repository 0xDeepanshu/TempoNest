"use client";

import Link from "next/link";
import { useMemo } from "react";
import { apiRequest } from "@/lib/api-client";
import {
  addDays,
  formatDateTime,
  formatDuration,
  formatTime,
  formatTimeRange,
  isoForZonedDate,
  todayInTimeZone,
} from "@/lib/format";
import type {
  AttendanceSummary,
  CorrectionsListResponse,
  CurrentSessionResponse,
  SessionReportResponse,
  SessionsResponse,
  TrackingStatusResponse,
  TimeSession,
} from "@/lib/types";
import { useApi } from "@/lib/use-api";
import {
  ArrowRightIcon,
  CalendarIcon,
  ChartIcon,
  CheckSquareIcon,
  ClockIcon,
  UsersIcon,
} from "./icons";
import { MonitoringDisclosure } from "./monitoring-disclosure";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CorrectionStatusBadge,
  EmptyState,
  ErrorState,
  PageHeader,
  StatCard,
  StatusBadge,
  TableShell,
  Td,
  Th,
} from "./ui";
import { useWorkspace } from "./workspace";

function currentStateText(
  session: TimeSession | null,
  timezone: string,
): {
  label: string;
  tone: "success" | "warning" | "neutral";
  detail: string;
} {
  if (!session) {
    return {
      label: "Not tracking",
      tone: "neutral",
      detail: "No open time session. Start tracking from the TempoNest desktop agent.",
    };
  }
  if (session.status === "ON_BREAK") {
    return {
      label: "On break",
      tone: "warning",
      detail: `Break started ${formatTime(session.activeBreak?.startedAt, timezone)}.`,
    };
  }
  if (session.status === "ACTIVE" && session.heartbeatFresh) {
    return {
      label: "Working",
      tone: "success",
      detail: `Session started ${formatTime(session.startedAt, timezone)} and the desktop agent heartbeat is fresh.`,
    };
  }
  return {
    label: "Session open · stale",
    tone: "warning",
    detail:
      "The session is still open but its heartbeat is stale. It may be closed automatically the next time the desktop agent starts tracking.",
  };
}

function SessionTable({
  sessions,
  timezone,
  emptyTitle,
}: {
  sessions: TimeSession[];
  timezone: string;
  emptyTitle: string;
}) {
  if (sessions.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        description="Sessions recorded by the desktop agent will appear here."
        icon={<ClockIcon className="h-5 w-5" />}
      />
    );
  }

  return (
    <TableShell>
      <thead>
        <tr>
          <Th>Started</Th>
          <Th>Duration</Th>
          <Th>Breaks</Th>
          <Th>Source</Th>
          <Th>Status</Th>
        </tr>
      </thead>
      <tbody>
        {sessions.map((session) => (
          <tr key={session.id} className="hover:bg-slate-50/60">
            <Td>
              <div className="font-medium text-slate-900">{formatDateTime(session.startedAt, timezone)}</div>
              <div className="text-xs text-slate-500">
                {formatTimeRange(session.startedAt, session.endedAt, timezone)}
              </div>
            </Td>
            <Td className="font-medium">{formatDuration(session.durationSeconds)}</Td>
            <Td>{session.breaks?.length ? `${session.breaks.length} recorded` : "—"}</Td>
            <Td>
              <Badge tone={session.source === "ONLINE" ? "indigo" : "neutral"}>
                {session.source === "ONLINE" ? "Online" : "Offline"}
              </Badge>
            </Td>
            <Td>
              <StatusBadge status={session.status} />
            </Td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

export function PersonalDashboard() {
  const { organization, membership, user } = useWorkspace();
  const timezone = organization?.timezone ?? "UTC";
  const organizationId = organization?.id ?? "";
  const today = useMemo(() => todayInTimeZone(timezone), [timezone]);
  const weekStart = useMemo(() => addDays(today, -6), [today]);

  const current = useApi<CurrentSessionResponse>(
    (signal) =>
      apiRequest(`/organizations/${organizationId}/time-sessions/current`, { signal }),
    [organizationId],
    { enabled: Boolean(organizationId) },
  );

  const todaySummary = useApi<{ data: AttendanceSummary; serverTime: string }>(
    (signal) =>
      apiRequest(`/organizations/${organizationId}/attendance/summaries`, {
        signal,
        query: { from: today, to: today, period: "daily" },
      }),
    [organizationId, today],
    { enabled: Boolean(organizationId) },
  );

  const weekSummary = useApi<{ data: AttendanceSummary; serverTime: string }>(
    (signal) =>
      apiRequest(`/organizations/${organizationId}/attendance/summaries`, {
        signal,
        query: { from: weekStart, to: today, period: "weekly" },
      }),
    [organizationId, weekStart, today],
    { enabled: Boolean(organizationId) },
  );

  const sessions = useApi<SessionsResponse>(
    (signal) =>
      apiRequest(`/organizations/${organizationId}/time-sessions`, {
        signal,
        query: {
          from: isoForZonedDate(weekStart, timezone),
          to: isoForZonedDate(today, timezone, true),
          limit: 8,
        },
      }),
    [organizationId, weekStart, today, timezone],
    { enabled: Boolean(organizationId) },
  );

  const pending = useApi<CorrectionsListResponse>(
    (signal) =>
      apiRequest(`/organizations/${organizationId}/attendance/corrections`, {
        signal,
        query: { status: "PENDING", limit: 5 },
      }),
    [organizationId],
    { enabled: Boolean(organizationId) },
  );

  const session = current.data?.data.session ?? null;
  const state = currentStateText(session, timezone);
  const todayTotals = todaySummary.data?.data.totals;
  const weekTotals = weekSummary.data?.data.totals;
  const recentSessions = sessions.data?.data ?? [];
  const pendingCorrections = pending.data?.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`${organization?.name ?? "Workspace"} · ${membership?.role.toLowerCase()}`}
        title={`Good to see you, ${user.name.split(" ")[0]}`}
        description="Your server-recorded attendance, live tracking state, and correction requests."
        actions={
          <>
            <Link href="/attendance">
              <Button variant="secondary">View attendance</Button>
            </Link>
            <Link href="/corrections">
              <Button>
                Request correction
                <ArrowRightIcon className="h-4 w-4" />
              </Button>
            </Link>
          </>
        }
      />

      <MonitoringDisclosure />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Today"
          value={todaySummary.loading ? "…" : formatDuration(todayTotals?.workedSeconds)}
          hint={`${formatDuration(todayTotals?.breakSeconds)} breaks · ${todayTotals?.sessionCount ?? 0} sessions`}
          accent="indigo"
          icon={<ClockIcon className="h-4 w-4" />}
        />
        <StatCard
          label="Last 7 days"
          value={weekSummary.loading ? "…" : formatDuration(weekTotals?.workedSeconds)}
          hint={`${weekTotals?.activeDays ?? 0} active days`}
          accent="emerald"
          icon={<CalendarIcon className="h-4 w-4" />}
        />
        <StatCard
          label="Status"
          value={state.label}
          hint={
            session
              ? `${formatDuration(session.durationSeconds)} so far today`
              : "Controlled by the desktop agent"
          }
          accent={state.tone === "success" ? "emerald" : state.tone === "warning" ? "amber" : "slate"}
          icon={<span className="block h-2.5 w-2.5 rounded-full bg-current" />}
        />
        <StatCard
          label="Pending corrections"
          value={pending.loading ? "…" : pendingCorrections.length}
          hint="Requests awaiting a reviewer"
          accent="sky"
          icon={<CheckSquareIcon className="h-4 w-4" />}
        />
      </div>

      {current.error ? <ErrorState message={current.error} onRetry={current.reload} /> : null}

      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
        <Card>
          <CardHeader
            title="Current session"
            description="Read-only live state from the backend. Starting or stopping time is an agent action."
            actions={<StatusBadge status={session?.status ?? "OFFLINE"} />}
          />
          <CardBody>
            <div className="flex flex-wrap items-start gap-4">
              <span
                className={[
                  "mt-1 h-3 w-3 shrink-0 rounded-full",
                  state.tone === "success"
                    ? "bg-emerald-500 ring-4 ring-emerald-100"
                    : state.tone === "warning"
                      ? "bg-amber-500 ring-4 ring-amber-100"
                      : "bg-slate-300 ring-4 ring-slate-100",
                ].join(" ")}
              />
              <div className="min-w-0 flex-1">
                <p className="text-lg font-bold text-slate-900">{state.label}</p>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">{state.detail}</p>
                {session ? (
                  <dl className="mt-4 grid gap-x-8 gap-y-2 text-xs sm:grid-cols-2">
                    <div>
                      <dt className="text-slate-400">Started</dt>
                      <dd className="font-medium text-slate-700">
                        {formatDateTime(session.startedAt, timezone)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-400">Recorded duration</dt>
                      <dd className="font-medium text-slate-700">
                        {formatDuration(session.durationSeconds)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-400">Desktop agent</dt>
                      <dd className="font-medium text-slate-700">
                        {session.desktopAgent?.name ?? "Offline session"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-400">Last heartbeat</dt>
                      <dd className="font-medium text-slate-700">
                        {formatDateTime(session.lastHeartbeatAt, timezone)}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
                    Open the TempoNest desktop app and press start. The web portal deliberately
                    cannot create agent-authenticated sessions.
                  </p>
                )}
                {session?.activeBreak ? (
                  <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Break active since {formatTime(session.activeBreak.startedAt, timezone)} ·{" "}
                    {formatDuration(session.activeBreak.durationSeconds)}
                  </div>
                ) : null}
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Corrections"
            actions={
              <Link href="/corrections" className="text-xs font-semibold text-indigo-600">
                Open
              </Link>
            }
          />
          <CardBody className="space-y-3">
            {pending.error ? <ErrorState message={pending.error} onRetry={pending.reload} /> : null}
            {pending.loading ? (
              <div className="space-y-2">
                <div className="h-14 animate-pulse rounded-lg bg-slate-100" />
                <div className="h-14 animate-pulse rounded-lg bg-slate-100" />
              </div>
            ) : pendingCorrections.length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-sm font-medium text-slate-700">No pending requests</p>
                <p className="mt-1 text-xs text-slate-500">
                  If a session needs fixing, request a correction.
                </p>
                <Link href="/corrections" className="mt-3 inline-block">
                  <Button size="sm" variant="subtle">
                    New correction
                  </Button>
                </Link>
              </div>
            ) : (
              pendingCorrections.map((correction) => (
                <Link
                  key={correction.id}
                  href="/corrections"
                  className="block rounded-xl border border-slate-200 px-3 py-2.5 transition hover:border-indigo-200 hover:bg-indigo-50/40"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-800">
                      {correction.workDate}
                    </span>
                    <CorrectionStatusBadge status={correction.status} />
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-slate-500">
                    {correction.reason}
                  </p>
                </Link>
              ))
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Recent sessions"
          description={`Last 7 days · ${organization?.name ?? ""}`}
          actions={
            <Link href="/attendance" className="text-xs font-semibold text-indigo-600">
              All history
            </Link>
          }
        />
        {sessions.error ? (
          <div className="p-5">
            <ErrorState message={sessions.error} onRetry={sessions.reload} />
          </div>
        ) : sessions.loading && recentSessions.length === 0 ? (
          <div className="space-y-2 p-5">
            <div className="h-10 animate-pulse rounded bg-slate-100" />
            <div className="h-10 animate-pulse rounded bg-slate-100" />
          </div>
        ) : (
          <SessionTable
            sessions={recentSessions}
            timezone={timezone}
            emptyTitle="No sessions in the last 7 days"
          />
        )}
      </Card>
    </div>
  );
}

export function TeamDashboard() {
  const { organization } = useWorkspace();
  const timezone = organization?.timezone ?? "UTC";
  const organizationId = organization?.id ?? "";
  const today = useMemo(() => todayInTimeZone(timezone), [timezone]);

  const details = useApi<{ data: { memberCount: number } }>(
    (signal) => apiRequest(`/organizations/${organizationId}`, { signal }),
    [organizationId],
    { enabled: Boolean(organizationId) },
  );

  const tracking = useApi<TrackingStatusResponse>(
    (signal) =>
      apiRequest(`/organizations/${organizationId}/reports/tracking-status`, {
        signal,
        query: { limit: 100 },
      }),
    [organizationId],
    { enabled: Boolean(organizationId) },
  );

  const todaySessions = useApi<SessionReportResponse>(
    (signal) =>
      apiRequest(`/organizations/${organizationId}/reports/sessions`, {
        signal,
        query: { from: today, to: today, limit: 100 },
      }),
    [organizationId, today],
    { enabled: Boolean(organizationId) },
  );

  const pending = useApi<CorrectionsListResponse>(
    (signal) =>
      apiRequest(`/organizations/${organizationId}/attendance/corrections`, {
        signal,
        query: { status: "PENDING", limit: 5 },
      }),
    [organizationId],
    { enabled: Boolean(organizationId) },
  );

  const rows = tracking.data?.data ?? [];
  const counts = rows.reduce(
    (accumulator, row) => {
      accumulator[row.state] += 1;
      return accumulator;
    },
    { WORKING: 0, ON_BREAK: 0, ONLINE: 0, OFFLINE: 0 },
  );
  const sessions = todaySessions.data?.data ?? [];
  const worked = sessions.reduce((sum, session) => sum + session.workingSeconds, 0);
  const pendingCorrections = pending.data?.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`${organization?.name ?? "Team"} · team overview`}
        title="Team overview"
        description="Live durable tracking state and today's recorded work. Session times are server-authoritative."
        actions={
          <>
            <Link href="/admin/reports">
              <Button variant="secondary">Open reports</Button>
            </Link>
            <Link href="/admin/corrections">
              <Button>
                Review corrections
                <ArrowRightIcon className="h-4 w-4" />
              </Button>
            </Link>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Working now"
          value={tracking.loading ? "…" : counts.WORKING}
          hint={`${counts.ON_BREAK} on break · ${counts.ONLINE} online`}
          accent="emerald"
          icon={<UsersIcon className="h-4 w-4" />}
        />
        <StatCard
          label="Team members"
          value={details.loading ? "…" : (details.data?.data.memberCount ?? "—")}
          hint="Active memberships"
          accent="indigo"
          icon={<UsersIcon className="h-4 w-4" />}
        />
        <StatCard
          label="Worked today"
          value={todaySessions.loading ? "…" : formatDuration(worked)}
          hint={`${sessions.length} sessions recorded`}
          accent="sky"
          icon={<ChartIcon className="h-4 w-4" />}
        />
        <StatCard
          label="Pending reviews"
          value={pending.loading ? "…" : pendingCorrections.length}
          hint="Attendance corrections"
          accent="amber"
          icon={<CheckSquareIcon className="h-4 w-4" />}
        />
      </div>

      {tracking.error ? <ErrorState message={tracking.error} onRetry={tracking.reload} /> : null}

      <div className="grid gap-6 xl:grid-cols-[1.45fr_0.55fr]">
        <Card>
          <CardHeader
            title="Live tracking"
            description={`Freshness threshold: ${tracking.data?.heartbeatStaleAfterSeconds ?? 120}s · ${timezone}`}
            actions={
              <Link href="/admin/reports" className="text-xs font-semibold text-indigo-600">
                Team reports
              </Link>
            }
          />
          {rows.length === 0 && !tracking.loading ? (
            <EmptyState
              title="No active members"
              description="Invite people to the organization to see tracking state."
              icon={<UsersIcon className="h-5 w-5" />}
            />
          ) : (
            <TableShell>
              <thead>
                <tr>
                  <Th>Employee</Th>
                  <Th>State</Th>
                  <Th>Current session</Th>
                  <Th>Last heartbeat</Th>
                  <Th>Agent</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.employee.id} className="hover:bg-slate-50/60">
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={row.employee.name} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900">{row.employee.name}</p>
                          <p className="truncate text-xs text-slate-500">{row.employee.email}</p>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <StatusBadge status={row.state} />
                    </Td>
                    <Td className="text-xs">
                      {row.activeSession
                        ? `${formatTimeRange(row.activeSession.startedAt, row.activeSession.endedAt, timezone)} · ${formatDuration(row.activeSession.durationSeconds)}`
                        : "—"}
                    </Td>
                    <Td className="text-xs text-slate-500">
                      {formatDateTime(row.lastHeartbeatAt, timezone)}
                    </Td>
                    <Td className="text-xs">{row.agent?.name ?? "No active agent"}</Td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Awaiting review"
            description="Oldest requests first"
            actions={
              <Link href="/admin/corrections" className="text-xs font-semibold text-indigo-600">
                Review
              </Link>
            }
          />
          <CardBody className="space-y-3">
            {pendingCorrections.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-sm font-medium text-slate-700">Nothing pending</p>
                <p className="mt-1 text-xs text-slate-500">Correction requests will appear here.</p>
              </div>
            ) : (
              pendingCorrections.map((correction) => (
                <div
                  key={correction.id}
                  className="rounded-xl border border-slate-200 px-3 py-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold text-slate-800">
                      {correction.employee?.name ?? "Employee"}
                    </span>
                    <CorrectionStatusBadge status={correction.status} />
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-500">{correction.workDate}</p>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-slate-500">
                    {correction.reason}
                  </p>
                </div>
              ))
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Today's sessions"
          description={`${today} · ${timezone}`}
          actions={
            <Link href="/admin/reports" className="text-xs font-semibold text-indigo-600">
              Full report
            </Link>
          }
        />
        {todaySessions.error ? (
          <div className="p-5">
            <ErrorState message={todaySessions.error} onRetry={todaySessions.reload} />
          </div>
        ) : sessions.length === 0 && !todaySessions.loading ? (
          <EmptyState
            title="No sessions today"
            description="Sessions appear when employees track time with the desktop agent."
            icon={<ClockIcon className="h-5 w-5" />}
          />
        ) : (
          <TableShell>
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>Interval</Th>
                <Th>Working</Th>
                <Th>Breaks</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={session.id} className="hover:bg-slate-50/60">
                  <Td className="font-medium text-slate-900">
                    {session.employee?.name ?? "Employee"}
                  </Td>
                  <Td className="text-xs text-slate-600">
                    {formatTimeRange(session.startedAt, session.endedAt, timezone)}
                  </Td>
                  <Td className="font-medium">{formatDuration(session.workingSeconds)}</Td>
                  <Td>{formatDuration(session.breakSeconds)}</Td>
                  <Td>
                    <StatusBadge status={session.status} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Card>
    </div>
  );
}

export function DashboardView() {
  const { membership } = useWorkspace();
  const isTeamView =
    membership &&
    (membership.role === "OWNER" ||
      membership.role === "ADMIN" ||
      membership.role === "MANAGER");
  return isTeamView ? <TeamDashboard /> : <PersonalDashboard />;
}

export function DashboardLoading() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {[0, 1, 2, 3].map((item) => (
        <div key={item} className="h-32 animate-pulse rounded-2xl bg-white" />
      ))}
    </div>
  );
}

