"use client";

import { useState } from "react";
import { apiRequest } from "@/lib/api-client";
import {
  addDays,
  daysBetween,
  formatDateRange,
  formatDateTime,
  formatDay,
  formatDuration,
  formatPercent,
  todayInTimeZone,
} from "@/lib/format";
import type {
  ApplicationUsageResponse,
  DailyReport,
  MemberListItem,
  Paginated,
  SessionReportResponse,
} from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { CalendarIcon, ChartIcon, ClockIcon } from "./icons";
import {
  Alert,
  Avatar,
  Badge,
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
  Select,
  StatCard,
  StatusBadge,
  TableShell,
  Tabs,
  Td,
  Th,
} from "./ui";
import { NoOrganization, useWorkspace } from "./workspace";

type ReportTab = "sessions" | "daily" | "applications";

export function ReportsView({ initialEmployeeId = "" }: { initialEmployeeId?: string }) {
  const { organization } = useWorkspace();
  const organizationId = organization?.id ?? "";
  const timezone = organization?.timezone ?? "UTC";
  const today = todayInTimeZone(timezone);

  const [employeeId, setEmployeeId] = useState(initialEmployeeId);
  const [draftFrom, setDraftFrom] = useState(addDays(today, -6));
  const [draftTo, setDraftTo] = useState(today);
  const [range, setRange] = useState({ from: addDays(today, -6), to: today });
  const [tab, setTab] = useState<ReportTab>("sessions");
  const [page, setPage] = useState(1);
  const [rangeError, setRangeError] = useState<string | null>(null);

  const members = useApi<Paginated<MemberListItem>>(
    (signal) =>
      apiRequest(`/organizations/${organizationId}/members`, {
        signal,
        query: { limit: 100, status: "ACTIVE" },
      }),
    [organizationId],
    { enabled: Boolean(organizationId) },
  );

  const selectedMember = (members.data?.data ?? []).find(
    (member) => member.userId === employeeId,
  );

  const days = daysBetween(range.from, range.to);
  const tabTooLong =
    (tab === "daily" && days > 92) || (tab === "applications" && days > 31);
  const enabled = Boolean(organizationId && employeeId) && !tabTooLong;

  const sessions = useApi<SessionReportResponse>(
    (signal) =>
      apiRequest(`/organizations/${organizationId}/reports/sessions`, {
        signal,
        query: { employeeId, from: range.from, to: range.to, page, limit: 20 },
      }),
    [organizationId, employeeId, range.from, range.to, page],
    { enabled: enabled && tab === "sessions" },
  );

  const daily = useApi<{ data: DailyReport }>(
    (signal) =>
      apiRequest(`/organizations/${organizationId}/reports/daily`, {
        signal,
        query: { employeeId, from: range.from, to: range.to },
      }),
    [organizationId, employeeId, range.from, range.to],
    { enabled: enabled && tab === "daily" },
  );

  const applications = useApi<ApplicationUsageResponse>(
    (signal) =>
      apiRequest(`/organizations/${organizationId}/reports/application-usage`, {
        signal,
        query: { employeeId, from: range.from, to: range.to, page, limit: 20 },
      }),
    [organizationId, employeeId, range.from, range.to, page],
    { enabled: enabled && tab === "applications" },
  );

  if (!organization) return <NoOrganization />;

  function applyRange(event: React.FormEvent) {
    event.preventDefault();
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
      setRangeError("Report ranges cannot exceed 366 days.");
      return;
    }
    setRange({ from: draftFrom, to: draftTo });
    setPage(1);
  }

  const sessionRows = sessions.data?.data ?? [];
  const dailyData = daily.data?.data;
  const dailyRows = dailyData?.days ?? [];
  const appRows = applications.data?.data ?? [];
  const dailyTotals = dailyRows.reduce(
    (accumulator, row) => {
      accumulator.worked += row.workedSeconds;
      accumulator.breaks += row.breakSeconds;
      accumulator.sessions += row.sessionCount;
      if (row.sessionCount > 0) accumulator.activeDays += 1;
      return accumulator;
    },
    { worked: 0, breaks: 0, sessions: 0, activeDays: 0 },
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`${organization.name} · ${timezone}`}
        title="Reports"
        description="Server-calculated sessions, daily totals, and foreground application metadata. Report dates are organization-local."
      />

      <Card>
        <form onSubmit={applyRange} className="grid gap-3 p-5 lg:grid-cols-[1.4fr_1fr_1fr_auto] lg:items-end">
          <Field label="Employee" htmlFor="report-employee">
            <Select
              id="report-employee"
              value={employeeId}
              onChange={(event) => {
                setEmployeeId(event.target.value);
                setPage(1);
              }}
              disabled={members.loading}
            >
              <option value="">Select an employee</option>
              {(members.data?.data ?? []).map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.user.name} · {member.role.toLowerCase()}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="From" htmlFor="report-from">
            <Input
              id="report-from"
              type="date"
              value={draftFrom}
              max={draftTo || undefined}
              onChange={(event) => setDraftFrom(event.target.value)}
            />
          </Field>
          <Field label="To" htmlFor="report-to">
            <Input
              id="report-to"
              type="date"
              value={draftTo}
              min={draftFrom || undefined}
              onChange={(event) => setDraftTo(event.target.value)}
            />
          </Field>
          <Button type="submit">Apply</Button>
        </form>
        {rangeError ? (
          <div className="px-5 pb-4">
            <Alert tone="danger">{rangeError}</Alert>
          </div>
        ) : null}
        {members.error ? (
          <div className="px-5 pb-4">
            <ErrorState message={members.error} onRetry={members.reload} />
          </div>
        ) : null}
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={tab}
          onChange={(value) => {
            setTab(value);
            setPage(1);
          }}
          tabs={[
            { value: "sessions", label: "Sessions" },
            { value: "daily", label: "Daily totals" },
            { value: "applications", label: "Applications" },
          ]}
        />
        <p className="flex items-center gap-1.5 text-xs text-slate-500">
          <CalendarIcon className="h-3.5 w-3.5" />
          {formatDateRange(range.from, range.to)} · {days} days · {selectedMember?.user.name ?? "—"}
        </p>
      </div>

      {tabTooLong ? (
        <Alert tone="warning" title="Range too large for this report">
          {tab === "daily"
            ? "Daily reports are limited to 92 days. Narrow the date range to continue."
            : "Application usage reports are limited to 31 days. Narrow the date range to continue."}
        </Alert>
      ) : null}

      {!employeeId ? (
        <Card>
          <EmptyState
            title="Select an employee"
            description="Reports require an explicit employee because daily and application reports are per person."
            icon={<ChartIcon className="h-5 w-5" />}
          />
        </Card>
      ) : null}

      {tab === "sessions" && employeeId ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Sessions"
              value={sessions.loading ? "…" : (sessions.data?.meta.total ?? 0)}
              hint={formatDateRange(range.from, range.to)}
              accent="indigo"
              icon={<ClockIcon className="h-4 w-4" />}
            />
            <StatCard
              label="Tracked time"
              value={sessions.loading ? "…" : formatDuration(sessionRows.reduce((sum, row) => sum + row.workingSeconds, 0))}
              hint="Current page"
              accent="emerald"
            />
            <StatCard
              label="Break time"
              value={sessions.loading ? "…" : formatDuration(sessionRows.reduce((sum, row) => sum + row.breakSeconds, 0))}
              hint="Current page"
              accent="amber"
            />
          </div>
          <Card>
            <CardHeader title="Session report" description="Sessions overlapping the range with working time net of breaks." />
            {sessions.error ? (
              <div className="p-5">
                <ErrorState message={sessions.error} onRetry={sessions.reload} />
              </div>
            ) : sessionRows.length === 0 && !sessions.loading ? (
              <EmptyState
                title="No sessions"
                description="No sessions overlap the selected range."
                icon={<ClockIcon className="h-5 w-5" />}
              />
            ) : (
              <>
                <TableShell>
                  <thead>
                    <tr>
                      <Th>Employee</Th>
                      <Th>Interval</Th>
                      <Th>Working</Th>
                      <Th>Breaks</Th>
                      <Th>Source</Th>
                      <Th>Status</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessionRows.map((session) => (
                      <tr key={session.id} className="hover:bg-slate-50/60">
                        <Td className="font-medium text-slate-900">
                          {session.employee?.name ?? selectedMember?.user.name ?? "Employee"}
                        </Td>
                        <Td className="text-xs text-slate-600">
                          {formatDateTime(session.startedAt, timezone)} –{" "}
                          {session.endedAt ? formatDateTime(session.endedAt, timezone) : "open"}
                        </Td>
                        <Td className="font-medium">{formatDuration(session.workingSeconds)}</Td>
                        <Td>{formatDuration(session.breakSeconds)}</Td>
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
                <Pagination
                  page={sessions.data?.meta.page ?? page}
                  totalPages={sessions.data?.meta.totalPages ?? 1}
                  onPageChange={setPage}
                />
              </>
            )}
          </Card>
        </>
      ) : null}

      {tab === "daily" && employeeId && !tabTooLong ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Worked" value={daily.loading ? "…" : formatDuration(dailyTotals.worked)} accent="indigo" />
            <StatCard label="Breaks" value={daily.loading ? "…" : formatDuration(dailyTotals.breaks)} accent="amber" />
            <StatCard label="Sessions" value={daily.loading ? "…" : dailyTotals.sessions} accent="sky" />
            <StatCard label="Active days" value={daily.loading ? "…" : dailyTotals.activeDays} accent="emerald" />
          </div>
          <Card>
            <CardHeader title="Daily report" description="One row per organization-local calendar day, including zero-activity days." />
            {daily.error ? (
              <div className="p-5">
                <ErrorState message={daily.error} onRetry={daily.reload} />
              </div>
            ) : (
              <TableShell>
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Worked</Th>
                    <Th>Breaks</Th>
                    <Th>Sessions</Th>
                    <Th>First start</Th>
                    <Th>Last end</Th>
                  </tr>
                </thead>
                <tbody>
                  {dailyRows.map((row) => (
                    <tr key={row.date} className="hover:bg-slate-50/60">
                      <Td className="font-medium text-slate-900">{formatDay(row.date, { weekday: "short" })}</Td>
                      <Td>{formatDuration(row.workedSeconds)}</Td>
                      <Td>{formatDuration(row.breakSeconds)}</Td>
                      <Td>{row.sessionCount}</Td>
                      <Td className="text-xs text-slate-500">
                        {formatDateTime(row.firstStartedAt, timezone)}
                      </Td>
                      <Td className="text-xs text-slate-500">
                        {formatDateTime(row.lastEndedAt, timezone)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            )}
          </Card>
        </>
      ) : null}

      {tab === "applications" && employeeId && !tabTooLong ? (
        <Card>
          <CardHeader
            title="Application usage"
            description={applications.data?.disclaimer ?? "Foreground application metadata only."}
          />
          <CardBody className="grid gap-4 border-b border-slate-100 sm:grid-cols-2">
            <div>
              <p className="text-xs text-slate-400">Tracked working time</p>
              <p className="mt-1 text-lg font-bold text-slate-900">
                {formatDuration(applications.data?.trackedWorkingSeconds)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Application time</p>
              <p className="mt-1 text-lg font-bold text-slate-900">
                {formatDuration(applications.data?.totalApplicationSeconds)}
              </p>
            </div>
          </CardBody>
          {applications.error ? (
            <div className="p-5">
              <ErrorState message={applications.error} onRetry={applications.reload} />
            </div>
          ) : appRows.length === 0 && !applications.loading ? (
            <EmptyState
              title="No application metadata"
              description="The desktop agent has not reported foreground application activity in this range."
              icon={<ChartIcon className="h-5 w-5" />}
            />
          ) : (
            <>
              <TableShell>
                <thead>
                  <tr>
                    <Th>Application</Th>
                    <Th>Time</Th>
                    <Th>Share of tracked time</Th>
                    <Th>Events</Th>
                    <Th>Sessions</Th>
                  </tr>
                </thead>
                <tbody>
                  {appRows.map((row) => (
                    <tr key={`${row.applicationIdentifier}-${row.applicationName}`} className="hover:bg-slate-50/60">
                      <Td>
                        <div className="flex items-center gap-2.5">
                          <Avatar name={row.applicationName} size="sm" />
                          <div>
                            <p className="font-medium text-slate-900">{row.applicationName}</p>
                            <p className="font-mono text-[10px] text-slate-400">
                              {row.applicationIdentifier}
                            </p>
                          </div>
                        </div>
                      </Td>
                      <Td className="font-medium">{formatDuration(row.totalSeconds)}</Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full rounded-full bg-indigo-500"
                              style={{ width: `${Math.min(100, row.percentageOfTrackedTime)}%` }}
                            />
                          </div>
                          <span className="text-xs text-slate-500">
                            {formatPercent(row.percentageOfTrackedTime)}
                          </span>
                        </div>
                      </Td>
                      <Td>{row.eventCount}</Td>
                      <Td>{row.sessionCount}</Td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
              <Pagination
                page={applications.data?.meta.page ?? page}
                totalPages={applications.data?.meta.totalPages ?? 1}
                onPageChange={setPage}
              />
            </>
          )}
        </Card>
      ) : null}
    </div>
  );
}
