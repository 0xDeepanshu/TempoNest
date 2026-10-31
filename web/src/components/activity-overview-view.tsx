"use client";

import Link from "next/link";
import { useState } from "react";
import { getActivityOverview } from "@/lib/activity-api";
import {
  daysBetween,
  formatDateRange,
  formatDuration,
  formatPercent,
} from "@/lib/format";
import { reportRangeFromUrl } from "@/lib/report-range";
import { useApi } from "@/lib/use-api";
import { ActivityTabs } from "./activity-tabs";
import { ActivityCategoryBadge } from "./activity-ui";
import { EmployeePicker } from "./employee-picker";
import { ArrowRightIcon, CalendarIcon, ChartIcon } from "./icons";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Pagination,
  StatCard,
  TableShell,
  Td,
  Th,
} from "./ui";
import { NoOrganization, useWorkspace } from "./workspace";

const MAX_OVERVIEW_DAYS = 31;

function activityReportUrl(
  employeeId: string,
  range: { from: string; to: string },
): string {
  const params = new URLSearchParams();
  params.set("employeeId", employeeId);
  params.set("from", range.from);
  params.set("to", range.to);
  params.set("tab", "activity");
  return `/admin/reports?${params.toString()}`;
}

function ratio(value: number | null): string {
  return value === null ? "—" : formatPercent(value);
}

export function ActivityOverviewView({
  initialEmployeeId = "",
  initialFrom = "",
  initialTo = "",
}: {
  initialEmployeeId?: string;
  initialFrom?: string;
  initialTo?: string;
}) {
  const { organization } = useWorkspace();
  const organizationId = organization?.id ?? "";
  const timezone = organization?.timezone ?? "UTC";
  const initialRange = reportRangeFromUrl(
    initialFrom,
    initialTo,
    timezone,
    7,
    MAX_OVERVIEW_DAYS,
  );

  const [employeeId, setEmployeeId] = useState(initialEmployeeId);
  const [draftFrom, setDraftFrom] = useState(initialRange.from);
  const [draftTo, setDraftTo] = useState(initialRange.to);
  const [range, setRange] = useState(initialRange);
  const [page, setPage] = useState(1);
  const [rangeError, setRangeError] = useState<string | null>(null);

  const overview = useApi(
    (signal) =>
      getActivityOverview(
        organizationId,
        {
          from: range.from,
          to: range.to,
          employeeId: employeeId || undefined,
          page,
          limit: 20,
        },
        { signal },
      ),
    [organizationId, range.from, range.to, employeeId, page],
    { enabled: Boolean(organizationId) },
  );

  if (!organization) return <NoOrganization />;

  function rememberUrl(nextEmployeeId: string, nextRange: { from: string; to: string }) {
    const params = new URLSearchParams();
    params.set("from", nextRange.from);
    params.set("to", nextRange.to);
    if (nextEmployeeId) params.set("employeeId", nextEmployeeId);
    window.history.replaceState(null, "", `/admin/activity/team?${params.toString()}`);
  }

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
    if (daysBetween(draftFrom, draftTo) > MAX_OVERVIEW_DAYS) {
      setRangeError(`Activity overviews are limited to ${MAX_OVERVIEW_DAYS} days.`);
      return;
    }
    const nextRange = { from: draftFrom, to: draftTo };
    setRange(nextRange);
    setPage(1);
    rememberUrl(employeeId, nextRange);
  }

  function selectEmployee(nextEmployeeId: string) {
    setEmployeeId(nextEmployeeId);
    setPage(1);
    rememberUrl(nextEmployeeId, range);
  }

  const rows = overview.data?.data ?? [];
  const totals = overview.data?.totals;
  const policy = overview.data?.policy;
  const days = daysBetween(range.from, range.to);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${organization.name} · ${timezone}`}
        title="Team activity overview"
        description="Employee-level foreground application activity for one date range. Application usage is descriptive metadata, not proof of productivity or idleness."
      />

      <ActivityTabs current="team" />

      <Card>
        <CardHeader
          title="Overview filters"
          description={`Choose an organization-local date range of up to ${MAX_OVERVIEW_DAYS} days. Optionally narrow the overview to one employee.`}
        />
        <form
          onSubmit={applyRange}
          className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end"
        >
          <Field label="Employee (optional)" htmlFor="overview-employee">
            <EmployeePicker
              id="overview-employee"
              organizationId={organizationId}
              value={employeeId}
              onChange={selectEmployee}
              disabled={!organizationId}
            />
          </Field>
          <Field label="From" htmlFor="overview-from">
            <Input
              id="overview-from"
              type="date"
              value={draftFrom}
              max={draftTo || undefined}
              onChange={(event) => setDraftFrom(event.target.value)}
            />
          </Field>
          <Field label="To" htmlFor="overview-to">
            <Input
              id="overview-to"
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
        <div className="flex items-center gap-1.5 border-t border-line px-4 py-2.5 text-xs text-muted">
          <CalendarIcon className="h-3.5 w-3.5" />
          {formatDateRange(range.from, range.to)} · {days} days · {timezone}
        </div>
      </Card>

      {policy && !policy.appTrackingEnabled ? (
        <Alert tone="warning" title="Application tracking is disabled">
          The organization is not collecting new foreground application activity. Results may
          only include data collected before tracking was disabled. Missing activity data is not
          evidence that an employee was idle or unproductive.
        </Alert>
      ) : null}

      {policy && !policy.productivityClassificationEnabled ? (
        <Alert tone="info" title="Productivity classification is disabled">
          Applications are reported as Unclassified and productivity ratios are unavailable.
          Existing classifications are retained and apply again when the feature is re-enabled.
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active time"
          value={overview.loading ? "…" : formatDuration(totals?.activeSeconds)}
          hint="Working time minus accepted idle intervals"
          accent="emerald"
        />
        <StatCard
          label="Application time"
          value={overview.loading ? "…" : formatDuration(totals?.applicationSeconds)}
          hint="Foreground activity clipped to active time"
          accent="indigo"
        />
        <StatCard
          label="Activity coverage"
          value={
            overview.loading
              ? "…"
              : totals && totals.activeSeconds > 0
                ? formatPercent(totals.activityCoveragePercent)
                : "—"
          }
          hint="Application time ÷ active time"
          accent="sky"
        />
        <StatCard
          label="Productive % of active"
          value={overview.loading ? "…" : ratio(totals?.productivePercentOfActive ?? null)}
          hint="Descriptive ratio, not a performance score"
          accent="amber"
        />
      </div>

      <Card>
        <CardHeader
          title="Employee activity"
          description="One row per active member. Totals are computed per employee by the backend and never overlap."
        />
        {overview.error ? (
          <div className="p-4">
            <ErrorState message={overview.error} onRetry={overview.reload} />
          </div>
        ) : overview.loading && !overview.data ? (
          <LoadingBlock label="Loading team activity" rows={5} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No employees to show"
            description="No active members match this filter, or the selected employee is not in this organization."
            icon={<ChartIcon className="h-5 w-5" />}
          />
        ) : (
          <>
            <TableShell>
              <thead>
                <tr>
                  <Th>Employee</Th>
                  <Th>Tracked</Th>
                  <Th>Active</Th>
                  <Th>Idle</Th>
                  <Th>Application time</Th>
                  <Th>Coverage</Th>
                  <Th>Productive %</Th>
                  <Th>Unclassified %</Th>
                  <Th>Top applications</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.employee.id} className="hover:bg-surface-muted">
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={row.employee.name} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-ink">{row.employee.name}</p>
                          <p className="truncate text-[11px] text-muted">{row.employee.email}</p>
                        </div>
                      </div>
                    </Td>
                    <Td className="tnum">{formatDuration(row.trackedSeconds)}</Td>
                    <Td className="tnum">{formatDuration(row.activeSeconds)}</Td>
                    <Td className="tnum">
                      {policy && !policy.idleDetectionEnabled ? (
                        <span title="Idle detection is disabled for this organization.">—</span>
                      ) : (
                        <>
                          {formatDuration(row.idleSeconds)}
                          {!row.hasIdleData ? (
                            <span className="block text-[10px] text-muted">No intervals</span>
                          ) : null}
                        </>
                      )}
                    </Td>
                    <Td className="tnum">{formatDuration(row.applicationSeconds)}</Td>
                    <Td>
                      {!row.hasActivityData ? (
                        <Badge tone="neutral">No activity data</Badge>
                      ) : (
                        <span className="tnum">{formatPercent(row.activityCoveragePercent)}</span>
                      )}
                    </Td>
                    <Td className="tnum">
                      <span
                        title={
                          row.productivePercentOfActive === null
                            ? "Unavailable when classification is disabled or no activity data exists."
                            : undefined
                        }
                      >
                        {ratio(row.productivePercentOfActive)}
                      </span>
                    </Td>
                    <Td className="tnum">{ratio(row.unclassifiedPercentOfActive)}</Td>
                    <Td>
                      {row.topApplications.length === 0 ? (
                        <span className="text-xs text-muted">None recorded</span>
                      ) : (
                        <ul className="space-y-1">
                          {row.topApplications.map((application) => (
                            <li
                              key={application.applicationIdentifier}
                              className="flex items-center justify-between gap-2 text-[11px]"
                            >
                              <span className="truncate text-ink-secondary">
                                {application.applicationName}
                              </span>
                              <span className="flex shrink-0 items-center gap-1.5">
                                <ActivityCategoryBadge category={application.category} />
                                <span className="tnum text-muted">
                                  {formatDuration(application.totalSeconds)}
                                </span>
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </Td>
                    <Td>
                      <Link href={activityReportUrl(row.employee.id, range)}>
                        <Button variant="secondary" size="sm">
                          Open report
                          <ArrowRightIcon className="h-3 w-3" />
                        </Button>
                      </Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
            <Pagination
              page={overview.data?.meta.page ?? page}
              totalPages={overview.data?.meta.totalPages ?? 1}
              onPageChange={setPage}
            />
          </>
        )}
      </Card>

      {overview.data?.disclaimer ? (
        <Alert tone="info">{overview.data.disclaimer}</Alert>
      ) : null}
    </div>
  );
}
