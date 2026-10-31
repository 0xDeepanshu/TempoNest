"use client";

import { getActivitySummary } from "@/lib/activity-api";
import {
  formatDateRange,
  formatDateTime,
  formatDay,
  formatDuration,
  formatPercent,
} from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { ActivityAvailability, ActivityCategoryBadge } from "./activity-ui";
import { ChartIcon, ClockIcon } from "./icons";
import {
  Alert,
  Avatar,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingBlock,
  StatCard,
  TableShell,
  Td,
  Th,
} from "./ui";

function ratio(value: number | null): string {
  return value === null ? "—" : formatPercent(value);
}

export function ActivityReportPanel({
  organizationId,
  employeeId,
  from,
  to,
  timezone,
}: {
  organizationId: string;
  employeeId: string;
  from: string;
  to: string;
  timezone: string;
}) {
  const summary = useApi(
    (signal) =>
      getActivitySummary(
        organizationId,
        { employeeId, from, to },
        { signal },
      ),
    [organizationId, employeeId, from, to],
    { enabled: Boolean(organizationId && employeeId) },
  );

  if (summary.error) {
    return (
      <Card>
        <div className="p-4">
          <ErrorState message={summary.error} onRetry={summary.reload} />
        </div>
      </Card>
    );
  }

  if (summary.loading && !summary.data) {
    return (
      <Card>
        <LoadingBlock label="Loading activity summary" rows={6} />
      </Card>
    );
  }

  const data = summary.data?.data;
  if (!data) return null;

  const { policy, totals } = data;

  return (
    <div className="space-y-4">
      {!policy.appTrackingEnabled ? (
        <Alert tone="warning" title="Application tracking is disabled">
          This organization is not collecting new foreground application activity. This report
          can only show data collected before tracking was disabled. Missing activity is not
          evidence that the employee was idle or unproductive.
        </Alert>
      ) : null}

      {!policy.productivityClassificationEnabled ? (
        <Alert tone="info" title="Productivity classification is disabled">
          Every application is reported as Unclassified and productivity ratios are unavailable.
          Existing classifications are retained and apply again when the feature is re-enabled.
        </Alert>
      ) : null}

      {!totals.hasActivityData ? (
        <Alert tone="info" title="No application activity recorded">
          Tracked, working, break, and active time still come from desktop sessions. No
          foreground application metadata was recorded for this range, so coverage and category
          ratios are not meaningful. Missing application data does not mean the employee was idle
          or unproductive.
        </Alert>
      ) : null}

      {!policy.idleDetectionEnabled ? (
        <Alert tone="info" title="Idle detection is disabled">
          Idle time is not reported for this organization, so active time includes all non-break
          working time. The absence of idle intervals is not proof of continuous activity.
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Tracked time"
          value={formatDuration(totals.trackedSeconds)}
          hint="Session time clipped to the range"
          accent="slate"
          icon={<ClockIcon className="h-4 w-4" />}
        />
        <StatCard
          label="Working time"
          value={formatDuration(totals.workingSeconds)}
          hint="Tracked time minus breaks"
          accent="indigo"
        />
        <StatCard
          label="Break time"
          value={formatDuration(totals.breakSeconds)}
          accent="amber"
        />
        <StatCard
          label="Active time"
          value={formatDuration(totals.activeSeconds)}
          hint="Working time minus accepted idle intervals"
          accent="emerald"
        />
        <StatCard
          label="Idle time"
          value={
            policy.idleDetectionEnabled ? formatDuration(totals.idleSeconds) : "—"
          }
          hint={
            policy.idleDetectionEnabled
              ? totals.hasIdleData
                ? "Operating-system idle intervals"
                : "No idle intervals were recorded"
              : "Idle detection is disabled"
          }
          accent="sky"
        />
        <StatCard
          label="Application time"
          value={formatDuration(totals.applicationSeconds)}
          hint="Foreground activity clipped to active time"
          accent="indigo"
        />
        <StatCard
          label="Unaccounted active"
          value={formatDuration(totals.unaccountedActiveSeconds)}
          hint="Active time without foreground application data"
          accent="amber"
        />
        <StatCard
          label="Activity coverage"
          value={
            totals.activeSeconds > 0
              ? formatPercent(totals.activityCoveragePercent)
              : "—"
          }
          hint="Application time ÷ active time"
          accent="sky"
        />
        <StatCard
          label="Productive % of active"
          value={ratio(totals.productivePercentOfActive)}
          hint={
            totals.productivePercentOfActive === null
              ? "Unavailable without classification or activity data"
              : "Descriptive ratio, not a performance score"
          }
          accent="emerald"
        />
        <StatCard
          label="Unclassified % of active"
          value={ratio(totals.unclassifiedPercentOfActive)}
          hint={
            totals.unclassifiedPercentOfActive === null
              ? "Unavailable without classification or activity data"
              : "Share of active time in unknown applications"
          }
          accent="slate"
        />
      </div>

      <Card>
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-ink">Data availability</p>
            <p className="mt-0.5 text-[11px] text-muted">
              {formatDateRange(data.from, data.to)} · {data.timezone}
            </p>
          </div>
          <ActivityAvailability
            hasActivityData={totals.hasActivityData}
            hasIdleData={totals.hasIdleData}
            idleDetectionEnabled={policy.idleDetectionEnabled}
          />
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Time by category"
            description="Category seconds are server-computed from application time clipped to active time."
          />
          <TableShell>
            <thead>
              <tr>
                <Th>Category</Th>
                <Th>Time</Th>
                <Th>% of active time</Th>
              </tr>
            </thead>
            <tbody>
              {data.categories.map((category) => (
                <tr key={category.category} className="hover:bg-surface-muted">
                  <Td>
                    <ActivityCategoryBadge category={category.category} />
                  </Td>
                  <Td className="tnum">{formatDuration(category.seconds)}</Td>
                  <Td className="tnum">{formatPercent(category.percentOfActiveTime)}</Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </Card>

        <Card>
          <CardHeader
            title="Applications"
            description="Foreground application metadata only, grouped by the current classification catalog."
          />
          {data.applications.length === 0 ? (
            <EmptyState
              title="No application activity"
              description={
                policy.appTrackingEnabled
                  ? "No foreground application metadata was recorded for this employee in the selected range."
                  : "Application tracking is disabled, so no new activity is being collected."
              }
              icon={<ChartIcon className="h-5 w-5" />}
            />
          ) : (
            <TableShell>
              <thead>
                <tr>
                  <Th>Application</Th>
                  <Th>Category</Th>
                  <Th>Time</Th>
                  <Th>% of active</Th>
                  <Th>Events</Th>
                  <Th>Sessions</Th>
                </tr>
              </thead>
              <tbody>
                {data.applications.map((application) => (
                  <tr
                    key={application.applicationIdentifier}
                    className="hover:bg-surface-muted"
                  >
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={application.applicationName} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-ink">
                            {application.applicationName}
                          </p>
                          <p className="truncate font-mono text-[10px] text-muted">
                            {application.applicationIdentifier}
                          </p>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <ActivityCategoryBadge category={application.category} />
                    </Td>
                    <Td className="tnum">{formatDuration(application.totalSeconds)}</Td>
                    <Td className="tnum">
                      {formatPercent(application.percentageOfActiveTime)}
                    </Td>
                    <Td className="tnum">{application.eventCount}</Td>
                    <Td className="tnum">{application.sessionCount}</Td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Daily activity"
          description="One row per organization-local calendar day. Days without application data are labelled instead of treated as idle."
        />
        <TableShell>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Tracked</Th>
              <Th>Working</Th>
              <Th>Break</Th>
              <Th>Idle</Th>
              <Th>Active</Th>
              <Th>Application</Th>
              <Th>Coverage</Th>
              <Th>Productive %</Th>
              <Th>Data</Th>
            </tr>
          </thead>
          <tbody>
            {data.days.map((day) => (
              <tr key={day.date} className="hover:bg-surface-muted">
                <Td className="whitespace-nowrap font-medium text-ink">
                  {formatDay(day.date, { weekday: "short" })}
                </Td>
                <Td className="tnum">{formatDuration(day.trackedSeconds)}</Td>
                <Td className="tnum">{formatDuration(day.workingSeconds)}</Td>
                <Td className="tnum">{formatDuration(day.breakSeconds)}</Td>
                <Td className="tnum">
                  {policy.idleDetectionEnabled ? formatDuration(day.idleSeconds) : "—"}
                </Td>
                <Td className="tnum">{formatDuration(day.activeSeconds)}</Td>
                <Td className="tnum">{formatDuration(day.applicationSeconds)}</Td>
                <Td className="tnum">
                  {!day.hasActivityData
                    ? "—"
                    : formatPercent(day.activityCoveragePercent)}
                </Td>
                <Td className="tnum">{ratio(day.productivePercentOfActive)}</Td>
                <Td>
                  <Badge tone={day.hasActivityData ? "success" : "neutral"}>
                    {day.hasActivityData ? "Activity" : "No data"}
                  </Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      </Card>

      <div className="space-y-2">
        <Alert tone="info">{data.disclaimer}</Alert>
        <p className="text-[11px] text-muted">
          Policy v{policy.policyVersion} · idle threshold {policy.idleThresholdMinutes} min ·
          retention {policy.activityRetentionDays} days · updated{" "}
          {formatDateTime(policy.policyUpdatedAt, timezone)}
        </p>
      </div>
    </div>
  );
}
