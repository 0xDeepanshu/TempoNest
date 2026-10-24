"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import {
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
import { CalendarIcon, ClockIcon } from "./icons";
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
  PageHeader,
  Pagination,
  StatCard,
  StatusBadge,
  TableShell,
  Tabs,
  Td,
  Th,
} from "./ui";
import { NoOrganization, useWorkspace } from "./workspace";

function BreakDetails({ session, timezone }: { session: TimeSession; timezone: string }) {
  const breaks = session.breaks ?? [];
  if (breaks.length === 0) return <span className="text-xs text-slate-400">No breaks</span>;
  return (
    <details className="group">
      <summary className="cursor-pointer list-none text-xs font-semibold text-indigo-600">
        {breaks.length} break{breaks.length === 1 ? "" : "s"}
      </summary>
      <ul className="mt-1 space-y-0.5 text-[11px] text-slate-500">
        {breaks.map((brk) => (
          <li key={brk.id}>
            {formatTimeRange(brk.startedAt, brk.endedAt, timezone)}
            {brk.status === "ACTIVE" ? " · active" : ""}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function AttendanceView({ timezone }: { timezone: string }) {
  const { organization, membership } = useWorkspace();
  const organizationId = organization?.id ?? "";
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
        query: { from: range.from, to: range.to, period },
      }),
    [organizationId, range.from, range.to, period],
    { enabled: Boolean(organizationId) },
  );

  const sessions = useApi<SessionsResponse>(
    (signal) =>
      apiRequest(`/organizations/${organizationId}/time-sessions`, {
        signal,
        query: {
          from: isoForZonedDate(range.from, timezone),
          to: isoForZonedDate(range.to, timezone, true),
          page,
          limit: 20,
        },
      }),
    [organizationId, range.from, range.to, timezone, page],
    { enabled: Boolean(organizationId) },
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
  const sessionRows = sessions.data?.data ?? [];
  const canSeeTeam = hasPermission(membership?.role, "report:read");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`${organization?.name ?? "Attendance"} · ${timezone}`}
        title="My attendance"
        description="Daily, weekly, and monthly totals calculated by the backend from server-recorded sessions and breaks."
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
            <Field label="Group by" htmlFor="attendance-period">
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
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            <CalendarIcon className="h-3.5 w-3.5" />
            {formatDateRange(range.from, range.to)}
          </p>
        </CardBody>
        {rangeError ? (
          <div className="px-5 pb-4">
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

      <Card>
        <CardHeader
          title={`${period.charAt(0).toUpperCase() + period.slice(1)} totals`}
          description="Periods are organization-local calendar buckets. Weekly buckets start on Monday."
        />
        {rows.length === 0 && !summary.loading ? (
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
                <Th>Days in range</Th>
                <Th>First start</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.periodStart} className="hover:bg-slate-50/60">
                  <Td className="font-medium text-slate-900">
                    {row.periodStart === row.periodEnd
                      ? formatDay(row.periodStart, { weekday: "short" })
                      : formatDateRange(row.periodStart, row.periodEnd)}
                  </Td>
                  <Td className="font-semibold text-slate-900">
                    {formatDuration(row.workedSeconds)}
                  </Td>
                  <Td>{formatDuration(row.breakSeconds)}</Td>
                  <Td>{row.sessionCount}</Td>
                  <Td>{row.activeDays}</Td>
                  <Td>{row.daysIncluded}</Td>
                  <Td className="text-xs text-slate-500">
                    {row.firstStartedAt ? formatDateTime(row.firstStartedAt, timezone) : "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Session history"
          description="Sessions overlapping the selected range, newest page first."
        />
        {sessions.error ? (
          <div className="p-5">
            <ErrorState message={sessions.error} onRetry={sessions.reload} />
          </div>
        ) : sessionRows.length === 0 && !sessions.loading ? (
          <EmptyState
            title="No sessions found"
            description="Time tracked by the desktop agent will appear here."
            icon={<ClockIcon className="h-5 w-5" />}
          />
        ) : (
          <>
            <TableShell>
              <thead>
                <tr>
                  <Th>Started</Th>
                  <Th>Ended</Th>
                  <Th>Duration</Th>
                  <Th>Breaks</Th>
                  <Th>Source</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {sessionRows.map((session) => (
                  <tr key={session.id} className="hover:bg-slate-50/60">
                    <Td className="font-medium text-slate-900">
                      {formatDateTime(session.startedAt, timezone)}
                    </Td>
                    <Td className="text-xs text-slate-500">
                      {session.endedAt ? formatDateTime(session.endedAt, timezone) : "Open"}
                    </Td>
                    <Td className="font-medium">{formatDuration(session.durationSeconds)}</Td>
                    <Td>
                      <BreakDetails session={session} timezone={timezone} />
                    </Td>
                    <Td className="text-xs">{session.source === "ONLINE" ? "Online" : "Offline"}</Td>
                    <Td>
                      <StatusBadge status={session.status} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
            <Pagination
              page={sessions.data?.meta.page ?? page}
              totalPages={sessions.data?.meta.totalPages ?? 1}
              onPageChange={setPage}
            />
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
