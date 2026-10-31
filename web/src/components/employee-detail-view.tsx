"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import {
  formatDateRange,
  formatDateTime,
  formatDuration,
  formatTimeRange,
} from "@/lib/format";
import { findMember } from "@/lib/members";
import { hasPermission, isSelfScoped } from "@/lib/permissions";
import { reportRangeFromUrl } from "@/lib/report-range";
import type {
  DailyReport,
  MemberListItem,
  SessionReportResponse,
  TrackingStatusResponse,
} from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { ArrowRightIcon, CalendarIcon, ClockIcon } from "./icons";
import { CorrectionHistory } from "./correction-history";
import {
  Alert,
  Avatar,
  Button,
  Card,
  CardBody,
  CardHeader,
  DetailRow,
  EmptyState,
  ErrorState,
  LoadingBlock,
  MembershipStatusBadge,
  PageHeader,
  RoleBadge,
  StatCard,
  StatusBadge,
  TableShell,
  Tabs,
  Td,
  Th,
} from "./ui";
import { NoOrganization, useWorkspace } from "./workspace";

type DetailTab = "activity" | "corrections";

export function EmployeeDetailView({
  initialFrom = "",
  initialTo = "",
}: {
  initialFrom?: string;
  initialTo?: string;
}) {
  const params = useParams<{ employeeId: string }>();
  const employeeId = params.employeeId;
  const { organization, membership, user } = useWorkspace();
  const organizationId = organization?.id ?? "";
  const timezone = organization?.timezone ?? "UTC";
  const canViewReports = hasPermission(membership, "report:read");
  const canReviewTeam =
    hasPermission(membership, "correction:review") &&
    !isSelfScoped(membership, membership?.dataScope);
  const range = useMemo(
    () => reportRangeFromUrl(initialFrom, initialTo, timezone, 30, 92),
    [initialFrom, initialTo, timezone],
  );
  const [tab, setTab] = useState<DetailTab>("activity");

  const member = useApi<MemberListItem | null>(
    (signal) => findMember(organizationId, employeeId, signal),
    [organizationId, employeeId],
    { enabled: Boolean(organizationId && employeeId) },
  );

  const tracking = useApi<TrackingStatusResponse>(
    (signal) =>
      apiRequest(`/organizations/${organizationId}/reports/tracking-status`, {
        signal,
        query: { employeeId, limit: 1 },
      }),
    [organizationId, employeeId],
    { enabled: Boolean(organizationId && employeeId) && canViewReports },
  );

  const sessions = useApi<SessionReportResponse>(
    (signal) =>
      apiRequest(`/organizations/${organizationId}/reports/sessions`, {
        signal,
        query: { employeeId, from: range.from, to: range.to, limit: 8 },
      }),
    [organizationId, employeeId, range.from, range.to],
    { enabled: Boolean(organizationId && employeeId) && canViewReports },
  );

  const daily = useApi<{ data: DailyReport }>(
    (signal) =>
      apiRequest(`/organizations/${organizationId}/reports/daily`, {
        signal,
        query: { employeeId, from: range.from, to: range.to },
      }),
    [organizationId, employeeId, range.from, range.to],
    { enabled: Boolean(organizationId && employeeId) && canViewReports },
  );

  if (!organization) return <NoOrganization />;

  if (member.loading && !member.data) {
    return (
      <div className="space-y-4">
        <div className="h-24 animate-pulse rounded-xl border border-line bg-surface" />
        <div className="h-40 animate-pulse rounded-xl border border-line bg-surface" />
      </div>
    );
  }

  if (member.error) {
    return <ErrorState message={member.error} onRetry={member.reload} />;
  }

  if (!member.data) {
    return (
      <div className="space-y-4">
        <ErrorState message="This employee is not a member of the selected organization." />
        <Link href="/admin/employees">
          <Button variant="secondary">Back to people</Button>
        </Link>
      </div>
    );
  }

  const employee = member.data;
  const canViewCorrections =
    canReviewTeam ||
    (employee.userId === user.id && hasPermission(membership, "time:read"));
  const activeTab: DetailTab | null =
    tab === "activity" && !canViewReports
      ? canViewCorrections
        ? "corrections"
        : null
      : tab === "corrections" && !canViewCorrections
        ? canViewReports
          ? "activity"
          : null
        : tab;
  const tabs = [
    ...(canViewReports ? [{ value: "activity" as const, label: "Recent activity" }] : []),
    ...(canViewCorrections ? [{ value: "corrections" as const, label: "Corrections" }] : []),
  ];
  const trackingRow = tracking.data?.data[0];
  const sessionRows = sessions.data?.data ?? [];
  const dailyRows = daily.data?.data.days ?? [];
  const totalWorked = dailyRows.reduce((sum, row) => sum + row.workedSeconds, 0);
  const totalBreaks = dailyRows.reduce((sum, row) => sum + row.breakSeconds, 0);
  const totalSessions = dailyRows.reduce((sum, row) => sum + row.sessionCount, 0);
  const activeDays = dailyRows.filter((row) => row.sessionCount > 0).length;
  const reportsHref = `/admin/reports?employeeId=${employee.userId}&from=${range.from}&to=${range.to}`;

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/admin/employees"
          className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-muted transition-colors hover:text-ink"
        >
          <ArrowRightIcon className="h-3 w-3 rotate-180" />
          Back to people
        </Link>
        <PageHeader
          eyebrow={`${organization.name} · employee profile`}
          title={employee.user.name}
          description={`${employee.user.email} · ${employee.role.toLowerCase()} · joined ${formatDateTime(employee.createdAt, timezone)}`}
          actions={
            canViewReports ? (
              <Link href={reportsHref}>
                <Button>
                  Open reports
                  <ArrowRightIcon className="h-3.5 w-3.5" />
                </Button>
              </Link>
            ) : undefined
          }
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.65fr_1.35fr]">
        <Card>
          <CardBody>
            <div className="flex items-center gap-3">
              <Avatar name={employee.user.name} size="lg" />
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-ink">{employee.user.name}</p>
                <p className="truncate text-xs text-muted">{employee.user.email}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <RoleBadge role={employee.role} customRoleName={employee.customRole?.name} />
                  <MembershipStatusBadge status={employee.status} />
                </div>
              </div>
            </div>
            <dl className="mt-4 divide-y divide-line border-t border-line">
              <DetailRow
                label="Account"
                value={<StatusBadge status={employee.user.status} />}
              />
              <DetailRow
                label="Membership"
                value={<MembershipStatusBadge status={employee.status} />}
              />
              <DetailRow
                label="Joined"
                value={formatDateTime(employee.createdAt, timezone)}
              />
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Current tracking state"
            description="Durable state from sessions and agent presence, not an in-memory socket."
            actions={trackingRow ? <StatusBadge status={trackingRow.state} /> : null}
          />
          <CardBody>
            {!canViewReports ? (
              <Alert tone="info" title="Tracking state restricted">
                Viewing an employee&apos;s live tracking state requires report access.
              </Alert>
            ) : tracking.error ? (
              <ErrorState message={tracking.error} onRetry={tracking.reload} />
            ) : trackingRow ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-muted">State</p>
                  <div className="mt-1">
                    <StatusBadge status={trackingRow.state} />
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted">Agent</p>
                  <p className="mt-1 text-[13px] font-medium text-ink">
                    {trackingRow.agent?.name ?? "No active agent"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted">Active session</p>
                  <p className="mt-1 text-[13px] font-medium text-ink">
                    {trackingRow.activeSession
                      ? formatTimeRange(
                          trackingRow.activeSession.startedAt,
                          trackingRow.activeSession.endedAt,
                          timezone,
                        )
                      : "None"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted">Last heartbeat</p>
                  <p className="mt-1 text-[13px] font-medium text-ink">
                    {formatDateTime(trackingRow.lastHeartbeatAt, timezone)}
                  </p>
                </div>
                {trackingRow.activeSession ? (
                  <div>
                    <p className="text-xs text-muted">Open session duration</p>
                    <p className="mt-1 text-[13px] font-medium tnum text-ink">
                      {formatDuration(trackingRow.activeSession.durationSeconds)}
                    </p>
                  </div>
                ) : null}
                <div>
                  <p className="text-xs text-muted">Agent last seen</p>
                  <p className="mt-1 text-[13px] font-medium text-ink">
                    {formatDateTime(trackingRow.lastSeenAt, timezone)}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-[13px] text-muted">No tracking row returned.</p>
            )}
          </CardBody>
        </Card>
      </div>

      {!canViewReports ? (
        <Alert tone="info" title="Attendance metrics restricted">
          Worked hours, breaks, and session totals require report access. The profile and
          membership details remain available.
        </Alert>
      ) : (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Worked"
          value={daily.loading ? "…" : formatDuration(totalWorked)}
          hint={formatDateRange(range.from, range.to)}
          accent="indigo"
          icon={<CalendarIcon className="h-4 w-4" />}
        />
        <StatCard
          label="Breaks"
          value={daily.loading ? "…" : formatDuration(totalBreaks)}
          hint="Merged breaks in range"
          accent="amber"
        />
        <StatCard
          label="Sessions"
          value={daily.loading ? "…" : totalSessions}
          hint="Sessions in range"
          accent="sky"
          icon={<ClockIcon className="h-4 w-4" />}
        />
        <StatCard
          label="Active days"
          value={daily.loading ? "…" : activeDays}
          hint={dailyRows.length > 0 ? `${dailyRows.length} days included` : "No activity in range"}
          accent="emerald"
        />
      </div>
      )}

      {canViewReports && daily.error ? (
        <ErrorState message={daily.error} onRetry={daily.reload} />
      ) : null}

      {tabs.length > 0 ? (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={activeTab ?? "activity"}
          onChange={setTab}
          tabs={
            canViewReports
              ? tabs.map((item) =>
                  item.value === "activity"
                    ? { ...item, count: sessionRows.length }
                    : item,
                )
              : tabs
          }
        />
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <CalendarIcon className="h-3.5 w-3.5" />
          {formatDateRange(range.from, range.to)} · {timezone}
        </p>
      </div>
      ) : null}

      {activeTab === "activity" ? (
        <Card>
          <CardHeader
            title="Recent activity"
            description="The latest sessions in this range. Open reports for full session, daily, and application analysis."
            actions={
              <Link
                href={reportsHref}
                className="inline-flex items-center gap-1 text-xs font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink"
              >
                Full report
                <ArrowRightIcon className="h-3 w-3" />
              </Link>
            }
          />
          {sessions.error ? (
            <div className="p-4">
              <ErrorState message={sessions.error} onRetry={sessions.reload} />
            </div>
          ) : sessions.loading && !sessions.data ? (
            <LoadingBlock label="Loading recent sessions" rows={4} />
          ) : sessionRows.length === 0 ? (
            <EmptyState
              title="No sessions in this range"
              description="The desktop agent has not recorded sessions for this employee in the selected dates."
              icon={<ClockIcon className="h-5 w-5" />}
            />
          ) : (
            <TableShell>
              <thead>
                <tr>
                  <Th>Started</Th>
                  <Th>Ended</Th>
                  <Th>Working</Th>
                  <Th>Breaks</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {sessionRows.map((session) => (
                  <tr key={session.id} className="hover:bg-surface-muted">
                    <Td className="font-medium text-ink">
                      {formatDateTime(session.startedAt, timezone)}
                    </Td>
                    <Td className="text-xs text-muted">
                      {session.endedAt ? formatDateTime(session.endedAt, timezone) : "Open"}
                    </Td>
                    <Td className="font-medium tnum">{formatDuration(session.workingSeconds)}</Td>
                    <Td className="tnum">{formatDuration(session.breakSeconds)}</Td>
                    <Td>
                      <StatusBadge status={session.status} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          )}
        </Card>
      ) : null}

      {activeTab === "corrections" ? (
        <CorrectionHistory
          organizationId={organization.id}
          timezone={timezone}
          showEmployee={false}
          employeeId={employee.userId}
          enabled={canViewCorrections}
        />
      ) : null}
    </div>
  );
}
