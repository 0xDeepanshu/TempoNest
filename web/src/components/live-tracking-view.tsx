"use client";

import Link from "next/link";
import { useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { formatDateTime, formatDuration, formatTimeRange } from "@/lib/format";
import { hasPermission } from "@/lib/permissions";
import type {
  MemberListItem,
  Paginated,
  ScreenshotPolicyResponse,
  ScreenshotRequestSummary,
  ScreenshotRequestsResponse,
  TrackingStatusResponse,
  TrackingStatusRow,
} from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { CameraIcon, MonitorIcon, PulseIcon, UsersIcon } from "./icons";
import { LiveScreenViewer } from "./live-screen-viewer";
import { ScreenshotRequestButton } from "./screenshot-request-button";
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
  LoadingBlock,
  PageHeader,
  Pagination,
  Select,
  StatCard,
  StatusBadge,
  TableShell,
  Td,
  Th,
  TrackingBadge,
} from "./ui";
import { NoOrganization, useWorkspace } from "./workspace";

function heartbeatLabel(row: TrackingStatusRow, timezone: string): string {
  if (!row.lastHeartbeatAt) return "No heartbeat yet";
  return `Last heartbeat ${formatDateTime(row.lastHeartbeatAt, timezone)}`;
}

export function LiveTrackingView() {
  const { organization, membership } = useWorkspace();
  const organizationId = organization?.id ?? "";
  const timezone = organization?.timezone ?? "UTC";
  const canViewScreenshots = hasPermission(membership, "screenshot:read");
  const canRequestScreenshots = hasPermission(membership, "screenshot:request");
  const canLive = hasPermission(membership, "screenshot:live");
  const canBrowseMembers = hasPermission(membership, "member:read");

  const [employeeId, setEmployeeId] = useState("");
  const [page, setPage] = useState(1);
  const [liveTarget, setLiveTarget] = useState<TrackingStatusRow | null>(null);

  const members = useApi<Paginated<MemberListItem>>(
    (signal) =>
      apiRequest(`/organizations/${organizationId}/members`, {
        signal,
        query: { limit: 100, status: "ACTIVE" },
      }),
    [organizationId],
    { enabled: Boolean(organizationId) && canBrowseMembers },
  );

  const tracking = useApi<TrackingStatusResponse>(
    (signal) =>
      apiRequest(`/organizations/${organizationId}/reports/tracking-status`, {
        signal,
        query: { page, limit: 20, employeeId },
      }),
    [organizationId, employeeId, page],
    { enabled: Boolean(organizationId) },
  );

  const policy = useApi<ScreenshotPolicyResponse>(
    (signal) =>
      apiRequest(`/admin/screenshot-policy`, {
        signal,
        headers: { "X-Organization-Id": organizationId },
      }),
    [organizationId],
    {
      enabled:
        Boolean(organizationId) &&
        (hasPermission(membership, "screenshot:policy") || canLive),
    },
  );

  const pending = useApi<ScreenshotRequestsResponse>(
    (signal) =>
      apiRequest(`/admin/screenshot-requests`, {
        signal,
        query: { status: "PENDING", limit: 100 },
        headers: { "X-Organization-Id": organizationId },
      }),
    [organizationId, 1],
    { enabled: Boolean(organizationId) && canViewScreenshots },
  );

  const claimed = useApi<ScreenshotRequestsResponse>(
    (signal) =>
      apiRequest(`/admin/screenshot-requests`, {
        signal,
        query: { status: "CLAIMED", limit: 100 },
        headers: { "X-Organization-Id": organizationId },
      }),
    [organizationId, 2],
    { enabled: Boolean(organizationId) && canViewScreenshots },
  );

  if (!organization) return <NoOrganization />;

  const rows = tracking.data?.data ?? [];
  const memberByUserId = new Map(
    (members.data?.data ?? []).map((member) => [member.userId, member]),
  );
  const pendingByEmployee = new Map<string, ScreenshotRequestSummary>();
  for (const request of [...(pending.data?.data ?? []), ...(claimed.data?.data ?? [])]) {
    if (!pendingByEmployee.has(request.employeeId)) {
      pendingByEmployee.set(request.employeeId, request);
    }
  }

  const online = rows.filter((row) => row.online).length;
  const working = rows.filter((row) => row.state === "WORKING").length;
  const onBreak = rows.filter((row) => row.state === "ON_BREAK").length;
  const pendingCount = pendingByEmployee.size;
  const policyValue = policy.data?.data.policy;
  const monitoringEnabled = policyValue?.enabled === true;
  const liveRoleAllowed =
    membership !== undefined &&
    policyValue !== undefined &&
    policyValue.requestRoles.includes(membership.role) &&
    policyValue.viewRoles.includes(membership.role);
  const screenshotStateUnavailable = Boolean(pending.error || claimed.error);

  function refreshAll() {
    tracking.reload();
    pending.reload();
    claimed.reload();
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${organization.name} · ${timezone}`}
        title="Live tracking"
        description="Durable online state, active sessions, heartbeat freshness, and pending screenshot requests. Owners and administrators can also start a live screen view for an eligible employee. Online state comes from the last agent heartbeat, not an in-memory viewer connection."
        actions={
          <Button variant="secondary" size="sm" onClick={refreshAll}>
            Refresh status
          </Button>
        }
      />

      <Alert tone="info" title="Visible, explicit monitoring">
        A screenshot request is explicit, one at a time, visible in the employee&apos;s desktop app,
        and requires an active work session with a fresh heartbeat. Live screen viewing is separate:
        an owner or administrator starts it deliberately from the employee&apos;s row, it is limited
        by the monitoring policy and session lifetime, and it is recorded in the audit history.
      </Alert>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Online"
          value={tracking.loading ? "…" : `${online} / ${rows.length}`}
          hint="Agents seen recently"
          accent="emerald"
          icon={<PulseIcon className="h-4 w-4" />}
        />
        <StatCard
          label="Working"
          value={tracking.loading ? "…" : working}
          hint="Active work sessions"
          accent="indigo"
        />
        <StatCard
          label="On break"
          value={tracking.loading ? "…" : onBreak}
          hint="Active break sessions"
          accent="amber"
        />
        <StatCard
          label="Pending captures"
          value={canViewScreenshots && !screenshotStateUnavailable ? pendingCount : "—"}
          hint={
            canViewScreenshots
              ? policy.data
                ? monitoringEnabled
                  ? "Monitoring policy enabled"
                  : "Monitoring policy disabled"
                : "Pending requests"
              : "Not visible for your role"
          }
          accent="rose"
          icon={<CameraIcon className="h-4 w-4" />}
        />
      </div>

      <Card>
        <div
          className={`grid gap-3 p-4 sm:items-end ${
            canBrowseMembers ? "sm:grid-cols-[1fr_auto]" : "sm:grid-cols-[1fr]"
          }`}
        >
          {canBrowseMembers ? (
            <Field label="Employee" htmlFor="live-employee">
              <Select
                id="live-employee"
                value={employeeId}
                onChange={(event) => {
                  setEmployeeId(event.target.value);
                  setPage(1);
                }}
                disabled={members.loading}
              >
                <option value="">All active employees</option>
                {(members.data?.data ?? []).map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.user.name} · {member.role.toLowerCase()}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <p className="text-[11px] text-muted">
            {tracking.data
              ? `${tracking.data.meta.total} employee${tracking.data.meta.total === 1 ? "" : "s"} · heartbeat stale after ${tracking.data.heartbeatStaleAfterSeconds}s`
              : "Loading server tracking state…"}
          </p>
        </div>
        {canBrowseMembers && members.error ? (
          <div className="px-4 pb-4">
            <Alert tone="warning">
              The employee filter could not be loaded. Tracking rows still show the server names.
            </Alert>
          </div>
        ) : null}
      </Card>

      {tracking.error ? (
        <ErrorState message={tracking.error} onRetry={tracking.reload} />
      ) : null}

      {screenshotStateUnavailable ? (
        <Alert tone="warning" title="Pending capture state is restricted">
          Your role can view tracking status, but the current monitoring policy does not permit
          screenshot request visibility. Ask an owner or administrator if you need access.
        </Alert>
      ) : null}

      {canLive && policy.error ? (
        <Alert tone="warning" title="Live view policy could not be loaded">
          Live viewing remains available for authorized roles, but no session can start until the
          monitoring policy loads. {policy.error}
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Employees"
          description="One row per active membership. Offline employees remain visible with their last known heartbeat."
        />
        {tracking.loading && rows.length === 0 ? (
          <LoadingBlock label="Loading tracking status" rows={5} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No employees found"
            description="Tracking status appears after employees join the organization and connect a desktop agent."
            icon={<UsersIcon className="h-5 w-5" />}
          />
        ) : (
          <TableShell>
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>State</Th>
                <Th>Active session</Th>
                <Th>Heartbeat</Th>
                <Th>Desktop agent</Th>
                {canViewScreenshots ? <Th>Screenshot request</Th> : null}
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const member = memberByUserId.get(row.employee.id);
                const request = pendingByEmployee.get(row.employee.id);
                const eligible =
                  row.online &&
                  row.activeSession !== null &&
                  row.heartbeatStale !== true &&
                  row.agent?.status !== "REVOKED";
                const disabledReason = !monitoringEnabled
                  ? "Screen monitoring is disabled by the organization policy."
                  : !row.activeSession
                    ? "The employee needs an active work session in the desktop app."
                    : !row.online
                      ? "The employee's desktop agent is offline."
                      : row.heartbeatStale
                        ? "The session heartbeat is stale. Wait for the next heartbeat."
                        : row.agent?.status === "REVOKED"
                          ? "The employee's desktop agent was revoked."
                          : undefined;

                let liveDisabledReason: string | undefined;
                if (policy.loading && !policyValue) {
                  liveDisabledReason = "Checking the live view policy…";
                } else if (!policyValue) {
                  liveDisabledReason =
                    "The monitoring policy could not be loaded, so live viewing cannot be authorized right now.";
                } else if (!monitoringEnabled) {
                  liveDisabledReason = "Live screen viewing is disabled by the organization policy.";
                } else if (!liveRoleAllowed) {
                  liveDisabledReason =
                    "The monitoring policy does not permit your role to start live viewing.";
                } else if (!row.activeSession) {
                  liveDisabledReason =
                    "Live view requires an active work session in the desktop app.";
                } else if (!row.online) {
                  liveDisabledReason =
                    "Live view requires the employee's desktop agent to be online.";
                } else if (row.heartbeatStale) {
                  liveDisabledReason =
                    "The session heartbeat is stale. Live view will be available after the next heartbeat.";
                } else if (row.agent?.status === "REVOKED") {
                  liveDisabledReason =
                    "Live view is unavailable because the employee's desktop agent was revoked.";
                }

                return (
                  <tr key={row.employee.id} className="hover:bg-surface-muted">
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={row.employee.name} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-ink">
                            {row.employee.name}
                          </p>
                          <p className="truncate text-[11px] text-muted">
                            {row.employee.email}
                          </p>
                          {member ? (
                            <p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted">
                              {member.role}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <TrackingBadge state={row.state} />
                        <Badge tone={row.online ? "success" : "neutral"}>
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${row.online ? "bg-success" : "bg-muted"}`}
                            aria-hidden
                          />
                          {row.online ? "Online" : "Offline"}
                        </Badge>
                      </div>
                    </Td>
                    <Td>
                      {row.activeSession ? (
                        <div>
                          <p className="text-xs font-medium tnum text-ink">
                            {formatTimeRange(
                              row.activeSession.startedAt,
                              row.activeSession.endedAt,
                              timezone,
                            )}
                          </p>
                          <p className="mt-0.5 text-[11px] tnum text-muted">
                            {formatDuration(row.activeSession.durationSeconds)} elapsed
                          </p>
                        </div>
                      ) : (
                        <span className="text-xs text-muted">No active session</span>
                      )}
                    </Td>
                    <Td>
                      <p className="text-xs text-ink-secondary">
                        {heartbeatLabel(row, timezone)}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted">
                        {row.heartbeatStale
                          ? "Stale heartbeat"
                          : row.lastSeenAt
                            ? `Agent seen ${formatDateTime(row.lastSeenAt, timezone)}`
                            : "Agent not seen"}
                      </p>
                    </Td>
                    <Td>
                      {row.agent ? (
                        <div>
                          <p className="text-xs font-medium text-ink">
                            {row.agent.name}
                          </p>
                          <p className="mt-0.5 text-[11px] text-muted">
                            {[row.agent.platform, row.agent.appVersion]
                              .filter(Boolean)
                              .join(" · ") || "Desktop agent"}
                          </p>
                          <Badge
                            tone={row.agent.status === "REVOKED" ? "danger" : "outline"}
                            className="mt-1"
                          >
                            {row.agent.status === "REVOKED" ? "Revoked" : "Active"}
                          </Badge>
                        </div>
                      ) : (
                        <span className="text-xs text-muted">Not registered</span>
                      )}
                    </Td>
                    {canViewScreenshots ? (
                      <Td>
                        {request ? (
                          <div>
                            <StatusBadge status={request.status} />
                            <p className="mt-1 text-[11px] text-muted">
                              {request.status === "CLAIMED"
                                ? "Agent claimed the request"
                                : "Waiting for the agent"}
                            </p>
                            <p className="text-[10px] text-muted">
                              Expires {formatDateTime(request.expiresAt, timezone)}
                            </p>
                          </div>
                        ) : (
                          <span className="text-xs text-muted">None pending</span>
                        )}
                      </Td>
                    ) : null}
                    <Td className="text-right">
                      <div className="flex flex-col items-end gap-2">
                        {canLive ? (
                          <div className="space-y-1">
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              disabled={Boolean(liveDisabledReason)}
                              title={liveDisabledReason}
                              onClick={() => setLiveTarget(row)}
                            >
                              <MonitorIcon className="h-3.5 w-3.5" />
                              View live screen
                            </Button>
                            {liveDisabledReason ? (
                              <p className="max-w-[15rem] text-right text-[11px] leading-5 text-muted">
                                {liveDisabledReason}
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                        {canRequestScreenshots ? (
                          <ScreenshotRequestButton
                            employeeId={row.employee.id}
                            employeeName={row.employee.name}
                            disabled={!eligible || Boolean(request) || !monitoringEnabled}
                            disabledReason={
                              request
                                ? "A screenshot request is already pending. Review it before requesting another."
                                : disabledReason
                            }
                            onRequested={refreshAll}
                          />
                        ) : null}
                        {canViewScreenshots ? (
                          <Link
                            href={`/admin/screenshots?employeeId=${encodeURIComponent(row.employee.id)}`}
                            className="text-xs font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink"
                          >
                            Open review
                          </Link>
                        ) : null}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableShell>
        )}
        <div className="px-4 pb-4">
          <Pagination
            page={tracking.data?.meta.page ?? page}
            totalPages={tracking.data?.meta.totalPages ?? 1}
            onPageChange={setPage}
          />
        </div>
      </Card>

      {liveTarget ? (
        <LiveScreenViewer
          employeeId={liveTarget.employee.id}
          employeeName={liveTarget.employee.name}
          organizationId={organizationId}
          timezone={timezone}
          autoStart
          onClose={() => setLiveTarget(null)}
          onEnded={refreshAll}
        />
      ) : null}
    </div>
  );
}
