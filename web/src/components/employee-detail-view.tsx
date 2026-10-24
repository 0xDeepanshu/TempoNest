"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import {
  addDays,
  formatDate,
  formatDateRange,
  formatDateTime,
  formatDay,
  formatDuration,
  formatTimeRange,
  todayInTimeZone,
} from "@/lib/format";
import type {
  DailyReport,
  MemberListItem,
  Paginated,
  SessionReportResponse,
  TrackingStatusResponse,
} from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { ArrowRightIcon, CalendarIcon, ClockIcon } from "./icons";
import { CorrectionHistory } from "./correction-history";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DetailRow,
  EmptyState,
  ErrorState,
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

async function findMember(
  organizationId: string,
  userId: string,
  signal: AbortSignal,
): Promise<MemberListItem | null> {
  let page = 1;
  let totalPages = 1;
  do {
    const result = await apiRequest<Paginated<MemberListItem>>(
      `/organizations/${organizationId}/members`,
      { signal, query: { page, limit: 100 } },
    );
    const found = result.data.find((member) => member.userId === userId);
    if (found) return found;
    totalPages = result.meta.totalPages;
    page += 1;
  } while (page <= totalPages && page <= 10);
  return null;
}

type DetailTab = "sessions" | "daily" | "corrections";

export function EmployeeDetailView() {
  const params = useParams<{ employeeId: string }>();
  const employeeId = params.employeeId;
  const { organization } = useWorkspace();
  const organizationId = organization?.id ?? "";
  const timezone = organization?.timezone ?? "UTC";
  const today = useMemo(() => todayInTimeZone(timezone), [timezone]);
  const from = addDays(today, -29);
  const dailyFrom = addDays(today, -13);
  const [tab, setTab] = useState<DetailTab>("sessions");

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
    { enabled: Boolean(organizationId && employeeId) },
  );

  const sessions = useApi<SessionReportResponse>(
    (signal) =>
      apiRequest(`/organizations/${organizationId}/reports/sessions`, {
        signal,
        query: { employeeId, from, to: today, limit: 50 },
      }),
    [organizationId, employeeId, from, today],
    { enabled: Boolean(organizationId && employeeId) },
  );

  const daily = useApi<{ data: DailyReport }>(
    (signal) =>
      apiRequest(`/organizations/${organizationId}/reports/daily`, {
        signal,
        query: { employeeId, from: dailyFrom, to: today },
      }),
    [organizationId, employeeId, dailyFrom, today],
    { enabled: Boolean(organizationId && employeeId) },
  );

  if (!organization) return <NoOrganization />;

  if (member.loading && !member.data) {
    return (
      <div className="space-y-4">
        <div className="h-24 animate-pulse rounded-2xl bg-white" />
        <div className="h-40 animate-pulse rounded-2xl bg-white" />
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
  const trackingRow = tracking.data?.data[0];
  const sessionRows = sessions.data?.data ?? [];
  const dailyRows = daily.data?.data.days ?? [];
  const totalWorked = dailyRows.reduce((sum, row) => sum + row.workedSeconds, 0);
  const totalBreaks = dailyRows.reduce((sum, row) => sum + row.breakSeconds, 0);
  const activeDays = dailyRows.filter((row) => row.sessionCount > 0).length;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/employees"
          className="mb-3 inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800"
        >
          <ArrowRightIcon className="h-3 w-3 rotate-180" />
          Back to people
        </Link>
        <PageHeader
          eyebrow={`${organization.name} · employee profile`}
          title={employee.user.name}
          description={`${employee.user.email} · ${employee.role.toLowerCase()} · joined ${formatDate(employee.createdAt)}`}
          actions={
            <>
              <Link href={`/admin/reports?employeeId=${employee.userId}`}>
                <Button variant="secondary">Open reports</Button>
              </Link>
              <Link href="/admin/corrections">
                <Button>Review corrections</Button>
              </Link>
            </>
          }
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.65fr_1.35fr]">
        <Card>
          <CardBody>
            <div className="flex items-center gap-3">
              <Avatar name={employee.user.name} size="lg" />
              <div className="min-w-0">
                <p className="truncate text-base font-bold text-slate-900">{employee.user.name}</p>
                <p className="truncate text-xs text-slate-500">{employee.user.email}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <RoleBadge role={employee.role} />
                  <MembershipStatusBadge status={employee.status} />
                </div>
              </div>
            </div>
            <dl className="mt-4 divide-y divide-slate-100">
              <DetailRow
                label="Account"
                value={<StatusBadge status={employee.user.status} />}
              />
              <DetailRow
                label="Joined"
                value={formatDateTime(employee.createdAt, timezone)}
              />
              <DetailRow label="Membership" value={employee.id.slice(0, 8)} />
              <DetailRow label="User ID" value={<span className="font-mono text-[10px]">{employee.userId}</span>} />
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
            {tracking.error ? (
              <ErrorState message={tracking.error} onRetry={tracking.reload} />
            ) : trackingRow ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-slate-400">State</p>
                  <div className="mt-1">
                    <StatusBadge status={trackingRow.state} />
                  </div>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Agent</p>
                  <p className="mt-1 text-sm font-medium text-slate-800">
                    {trackingRow.agent?.name ?? "No active agent"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Active session</p>
                  <p className="mt-1 text-sm font-medium text-slate-800">
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
                  <p className="text-xs text-slate-400">Last heartbeat</p>
                  <p className="mt-1 text-sm font-medium text-slate-800">
                    {formatDateTime(trackingRow.lastHeartbeatAt, timezone)}
                  </p>
                </div>
                {trackingRow.activeSession ? (
                  <div>
                    <p className="text-xs text-slate-400">Open session duration</p>
                    <p className="mt-1 text-sm font-medium text-slate-800">
                      {formatDuration(trackingRow.activeSession.durationSeconds)}
                    </p>
                  </div>
                ) : null}
                <div>
                  <p className="text-xs text-slate-400">Agent last seen</p>
                  <p className="mt-1 text-sm font-medium text-slate-800">
                    {formatDateTime(trackingRow.lastSeenAt, timezone)}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">No tracking row returned.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Last 14 days"
          value={daily.loading ? "…" : formatDuration(totalWorked)}
          hint={`${activeDays} active days`}
          accent="indigo"
          icon={<CalendarIcon className="h-4 w-4" />}
        />
        <StatCard
          label="Break time"
          value={daily.loading ? "…" : formatDuration(totalBreaks)}
          hint="Merged breaks in range"
          accent="amber"
        />
        <StatCard
          label="Sessions"
          value={sessions.loading ? "…" : (sessions.data?.meta.total ?? 0)}
          hint="Last 30 days"
          accent="sky"
          icon={<ClockIcon className="h-4 w-4" />}
        />
        <StatCard
          label="Membership role"
          value={employee.role.charAt(0) + employee.role.slice(1).toLowerCase()}
          hint={employee.status === "ACTIVE" ? "Active membership" : employee.status.toLowerCase()}
          accent="emerald"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "sessions", label: "Sessions", count: sessionRows.length },
            { value: "daily", label: "Daily totals", count: dailyRows.length },
            { value: "corrections", label: "Corrections" },
          ]}
        />
        <p className="text-xs text-slate-500">
          {formatDateRange(from, today)} · {timezone}
        </p>
      </div>

      {tab === "sessions" ? (
        <Card>
          <CardHeader
            title="Session history"
            description="Last 30 days, including break and working-time calculations."
          />
          {sessions.error ? (
            <div className="p-5">
              <ErrorState message={sessions.error} onRetry={sessions.reload} />
            </div>
          ) : sessionRows.length === 0 && !sessions.loading ? (
            <EmptyState
              title="No sessions in the last 30 days"
              description="Server-recorded sessions will appear here."
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
          )}
        </Card>
      ) : null}

      {tab === "daily" ? (
        <Card>
          <CardHeader title="Daily totals" description={`${dailyFrom} to ${today} · ${timezone}`} />
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
                    <Td className="font-medium text-slate-900">{formatDay(row.date)}</Td>
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
      ) : null}

      {tab === "corrections" ? (
        <CorrectionHistory
          organizationId={organization.id}
          timezone={timezone}
          showEmployee={false}
          employeeId={employee.userId}
        />
      ) : null}
    </div>
  );
}
