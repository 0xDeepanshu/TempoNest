"use client";

import Link from "next/link";
import { useState } from "react";
import { apiRequest } from "@/lib/api-client";
import {
  daysBetween,
  formatDateRange,
  formatDateTime,
  formatDay,
  formatDuration,
  formatPercent,
} from "@/lib/format";
import { reportRangeFromUrl } from "@/lib/report-range";
import type {
  ApplicationUsageResponse,
  DailyReport,
  SessionReportResponse,
} from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { EmployeePicker } from "./employee-picker";
import { ArrowRightIcon, CalendarIcon, ChartIcon, ClockIcon } from "./icons";
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
  StatCard,
  StatusBadge,
  TableShell,
  Tabs,
  Td,
  Th,
} from "./ui";
import { NoOrganization, useWorkspace } from "./workspace";

type ReportTab = "sessions" | "daily" | "applications";

const REPORT_TABS: ReportTab[] = ["sessions", "daily", "applications"];

function reportUrl(
  employeeId: string,
  range: { from: string; to: string },
  tab: ReportTab,
): string {
  const params = new URLSearchParams();
  if (employeeId) params.set("employeeId", employeeId);
  params.set("from", range.from);
  params.set("to", range.to);
  if (tab !== "sessions") params.set("tab", tab);
  return `/admin/reports?${params.toString()}`;
}

export function ReportsView({
  initialEmployeeId = "",
  initialFrom = "",
  initialTo = "",
  initialTab = "sessions",
}: {
  initialEmployeeId?: string;
  initialFrom?: string;
  initialTo?: string;
  initialTab?: string;
}) {
  const { organization } = useWorkspace();
  const organizationId = organization?.id ?? "";
  const timezone = organization?.timezone ?? "UTC";
  const initialRange = reportRangeFromUrl(initialFrom, initialTo, timezone);
  const startingTab: ReportTab = REPORT_TABS.includes(initialTab as ReportTab)
    ? (initialTab as ReportTab)
    : "sessions";

  const [employeeId, setEmployeeId] = useState(initialEmployeeId);
  const [draftFrom, setDraftFrom] = useState(initialRange.from);
  const [draftTo, setDraftTo] = useState(initialRange.to);
  const [range, setRange] = useState(initialRange);
  const [tab, setTab] = useState<ReportTab>(startingTab);
  const [page, setPage] = useState(1);
  const [rangeError, setRangeError] = useState<string | null>(null);

  function rememberUrl(nextEmployeeId: string, nextRange: typeof range, nextTab: ReportTab) {
    window.history.replaceState(
      null,
      "",
      reportUrl(nextEmployeeId, nextRange, nextTab),
    );
  }

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
    const nextRange = { from: draftFrom, to: draftTo };
    setRange(nextRange);
    setPage(1);
    rememberUrl(employeeId, nextRange, tab);
  }

  function selectEmployee(nextEmployeeId: string) {
    setEmployeeId(nextEmployeeId);
    setPage(1);
    rememberUrl(nextEmployeeId, range, tab);
  }

  function selectTab(nextTab: ReportTab) {
    setTab(nextTab);
    setPage(1);
    rememberUrl(employeeId, range, nextTab);
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
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${organization.name} · ${timezone}`}
        title="Reports"
        description="Date-filtered, per-employee analysis of sessions, working time, breaks, and foreground application metadata. Use People for the directory and profile context."
        actions={
          employeeId ? (
            <Link href={`/admin/employees/${employeeId}?from=${range.from}&to=${range.to}`}>
              <Button variant="secondary">
                Open employee profile
                <ArrowRightIcon className="h-3.5 w-3.5" />
              </Button>
            </Link>
          ) : undefined
        }
      />

      <Card>
        <CardHeader
          title="Report filters"
          description="Search the directory for one employee, then choose an organization-local date range."
        />
        <form
          onSubmit={applyRange}
          className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end"
        >
          <Field label="Employee" htmlFor="report-employee">
            <EmployeePicker
              id="report-employee"
              organizationId={organizationId}
              value={employeeId}
              onChange={selectEmployee}
              disabled={!organizationId}
            />
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
          <div className="px-4 pb-4">
            <Alert tone="danger">{rangeError}</Alert>
          </div>
        ) : null}
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={tab}
          onChange={selectTab}
          tabs={[
            { value: "sessions", label: "Sessions" },
            { value: "daily", label: "Daily totals" },
            { value: "applications", label: "Applications" },
          ]}
        />
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <CalendarIcon className="h-3.5 w-3.5" />
          {formatDateRange(range.from, range.to)} · {days} days · {timezone}
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
            description="Reports are per person. Search the directory above to choose an employee and see their date-range analysis."
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
              <div className="p-4">
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
                      <tr key={session.id} className="hover:bg-surface-muted">
                        <Td className="font-medium text-ink">
                          {session.employee?.name ?? "Employee"}
                        </Td>
                        <Td className="text-xs text-ink-secondary">
                          {formatDateTime(session.startedAt, timezone)} –{" "}
                          {session.endedAt ? formatDateTime(session.endedAt, timezone) : "open"}
                        </Td>
                        <Td className="font-medium tnum">{formatDuration(session.workingSeconds)}</Td>
                        <Td className="tnum">{formatDuration(session.breakSeconds)}</Td>
                        <Td>
                          <Badge tone={session.source === "ONLINE" ? "outline" : "neutral"}>
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
              <div className="p-4">
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
                    <tr key={row.date} className="hover:bg-surface-muted">
                      <Td className="font-medium text-ink">{formatDay(row.date, { weekday: "short" })}</Td>
                      <Td className="tnum">{formatDuration(row.workedSeconds)}</Td>
                      <Td className="tnum">{formatDuration(row.breakSeconds)}</Td>
                      <Td className="tnum">{row.sessionCount}</Td>
                      <Td className="text-xs text-muted">
                        {formatDateTime(row.firstStartedAt, timezone)}
                      </Td>
                      <Td className="text-xs text-muted">
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
          <CardBody className="grid gap-4 border-b border-line sm:grid-cols-2">
            <div>
              <p className="text-xs text-muted">Tracked working time</p>
              <p className="mt-1 text-lg font-semibold tnum text-ink">
                {formatDuration(applications.data?.trackedWorkingSeconds)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted">Application time</p>
              <p className="mt-1 text-lg font-semibold tnum text-ink">
                {formatDuration(applications.data?.totalApplicationSeconds)}
              </p>
            </div>
          </CardBody>
          {applications.error ? (
            <div className="p-4">
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
                    <tr key={`${row.applicationIdentifier}-${row.applicationName}`} className="hover:bg-surface-muted">
                      <Td>
                        <div className="flex items-center gap-2.5">
                          <Avatar name={row.applicationName} size="sm" />
                          <div>
                            <p className="font-medium text-ink">{row.applicationName}</p>
                            <p className="font-mono text-[10px] text-muted">
                              {row.applicationIdentifier}
                            </p>
                          </div>
                        </div>
                      </Td>
                      <Td className="font-medium tnum">{formatDuration(row.totalSeconds)}</Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-hover">
                            <div
                              className="h-full rounded-full bg-ink"
                              style={{ width: `${Math.min(100, row.percentageOfTrackedTime)}%` }}
                            />
                          </div>
                          <span className="text-xs tnum text-muted">
                            {formatPercent(row.percentageOfTrackedTime)}
                          </span>
                        </div>
                      </Td>
                      <Td className="tnum">{row.eventCount}</Td>
                      <Td className="tnum">{row.sessionCount}</Td>
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
