"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { formatDateTime, formatDuration } from "@/lib/format";
import { hasPermission } from "@/lib/permissions";
import { screenshotErrorMessage } from "@/lib/screenshot-errors";
import type {
  MemberListItem,
  Paginated,
  ScreenshotAccessResponse,
  ScreenshotAuditEvent,
  ScreenshotAuditResponse,
  ScreenshotPolicyResponse,
  ScreenshotRequestSummary,
  ScreenshotRequestsResponse,
  ScreenshotsResponse,
  ScreenshotSummary,
  TrackingStatusResponse,
} from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { CameraIcon, ShieldIcon } from "./icons";
import { ScreenshotRequestButton } from "./screenshot-request-button";
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

const AUDIT_LABELS: Record<string, string> = {
  SCREENSHOT_POLICY_UPDATED: "Monitoring policy updated",
  SCREENSHOT_POLICY_ACKNOWLEDGED: "Employee acknowledged disclosure",
  SCREENSHOT_REQUEST_CREATED: "Screenshot requested",
  SCREENSHOT_REQUEST_ACKNOWLEDGED: "Agent acknowledged request",
  SCREENSHOT_REQUEST_CLAIMED: "Agent claimed request",
  SCREENSHOT_REQUEST_COMPLETED: "Screenshot uploaded",
  SCREENSHOT_REQUEST_FAILED: "Capture failed",
  SCREENSHOT_REQUEST_CANCELLED: "Request cancelled",
  SCREENSHOT_REQUEST_EXPIRED: "Request expired",
  SCREENSHOT_ACCESS_GRANTED: "Private preview link issued",
  SCREENSHOT_VIEWED: "Screenshot viewed",
  SCREENSHOT_DELETED: "Screenshot deleted",
};

type PreviewState =
  | { status: "idle" }
  | { status: "loading"; screenshot: ScreenshotSummary }
  | { status: "ready"; screenshot: ScreenshotSummary; url: string; expiresAt: string }
  | { status: "error"; screenshot: ScreenshotSummary; message: string };

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function auditDetail(event: ScreenshotAuditEvent): string {
  const values: string[] = [];
  const metadata = event.metadata ?? {};
  for (const key of ["code", "status", "reason", "expiresAt", "retentionExpiresAt"]) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) values.push(value);
  }
  return values.join(" · ") || "—";
}

function isUnauthorizedCode(code: string | null): boolean {
  return (
    code === "SCREENSHOT_ROLE_NOT_ALLOWED" ||
    code === "PERMISSION_DENIED" ||
    code === "FORBIDDEN"
  );
}

export function ScreenshotReviewView({ initialEmployeeId = "" }: { initialEmployeeId?: string }) {
  const { organization, membership } = useWorkspace();
  const organizationId = organization?.id ?? "";
  const timezone = organization?.timezone ?? "UTC";
  const role = membership?.role;
  const canView = hasPermission(role, "screenshot:read");
  const canRequest = hasPermission(role, "screenshot:request");
  const canManage = hasPermission(role, "screenshot:manage");
  const canConfigurePolicy = hasPermission(role, "screenshot:policy");

  const [employeeId, setEmployeeId] = useState(initialEmployeeId);
  const [requestPage, setRequestPage] = useState(1);
  const [screenshotPage, setScreenshotPage] = useState(1);
  const [auditPage, setAuditPage] = useState(1);
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const members = useApi<Paginated<MemberListItem>>(
    (signal) =>
      apiRequest(`/organizations/${organizationId}/members`, {
        signal,
        query: { limit: 100, status: "ACTIVE" },
      }),
    [organizationId],
    { enabled: Boolean(organizationId) },
  );

  const tracking = useApi<TrackingStatusResponse>(
    (signal) =>
      apiRequest(`/organizations/${organizationId}/reports/tracking-status`, {
        signal,
        query: { employeeId, limit: 1 },
      }),
    [organizationId, employeeId],
    { enabled: Boolean(organizationId) && Boolean(employeeId) },
  );

  const policy = useApi<ScreenshotPolicyResponse>(
    (signal) =>
      apiRequest("/admin/screenshot-policy", {
        signal,
        headers: { "X-Organization-Id": organizationId },
      }),
    [organizationId],
    { enabled: Boolean(organizationId) && canConfigurePolicy },
  );

  const requests = useApi<ScreenshotRequestsResponse>(
    (signal) =>
      apiRequest("/admin/screenshot-requests", {
        signal,
        query: { employeeId, page: requestPage, limit: 10 },
        headers: { "X-Organization-Id": organizationId },
      }),
    [organizationId, employeeId, requestPage],
    { enabled: Boolean(organizationId) && Boolean(employeeId) && canView },
  );

  const screenshots = useApi<ScreenshotsResponse>(
    (signal) =>
      apiRequest("/admin/screenshots", {
        signal,
        query: { employeeId, page: screenshotPage, limit: 10 },
        headers: { "X-Organization-Id": organizationId },
      }),
    [organizationId, employeeId, screenshotPage],
    { enabled: Boolean(organizationId) && Boolean(employeeId) && canView },
  );

  const audit = useApi<ScreenshotAuditResponse>(
    (signal) =>
      apiRequest("/admin/screenshot-audit-events", {
        signal,
        query: { employeeId, page: auditPage, limit: 10 },
        headers: { "X-Organization-Id": organizationId },
      }),
    [organizationId, employeeId, auditPage],
    { enabled: Boolean(organizationId) && Boolean(employeeId) && canView },
  );

  useEffect(() => {
    if (preview.status !== "ready") return;
    const remaining = Date.parse(preview.expiresAt) - Date.now();
    const expire = () =>
      setPreview((current) =>
        current.status === "ready"
          ? {
              status: "error",
              screenshot: current.screenshot,
              message:
                "The private preview link expired. Open the screenshot again for a fresh short-lived link.",
            }
          : current,
      );
    if (!Number.isFinite(remaining) || remaining <= 0) {
      expire();
      return;
    }
    const timer = setTimeout(expire, Math.min(remaining, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [preview]);

  if (!organization) return <NoOrganization />;

  function selectEmployee(nextEmployeeId: string) {
    setEmployeeId(nextEmployeeId);
    setRequestPage(1);
    setScreenshotPage(1);
    setAuditPage(1);
    setPreview({ status: "idle" });
    setActionError(null);
  }

  const selectedMember = (members.data?.data ?? []).find((member) => member.userId === employeeId);
  const selectedRow = tracking.data?.data[0] ?? null;
  const policyValue = policy.data?.data.policy;
  const monitoringEnabled = policyValue?.enabled === true;
  const pendingRequest = (requests.data?.data ?? []).find(
    (request) => request.status === "PENDING" || request.status === "CLAIMED",
  );
  const unauthorized = [requests.errorCode, screenshots.errorCode, audit.errorCode].some(
    isUnauthorizedCode,
  );

  const eligible =
    selectedRow !== null &&
    selectedRow.online &&
    selectedRow.heartbeatStale !== true &&
    selectedRow.activeSession !== null &&
    selectedRow.agent?.status !== "REVOKED";

  let requestDisabledReason: string | undefined;
  if (!employeeId) requestDisabledReason = "Select an employee first.";
  else if (!canRequest) requestDisabledReason = "Your role cannot request screenshots.";
  else if (policy.loading && !policyValue)
    requestDisabledReason = "Checking the monitoring policy…";
  else if (!policyValue)
    requestDisabledReason =
      "The monitoring policy could not be loaded, so a request cannot be authorized right now.";
  else if (!monitoringEnabled)
    requestDisabledReason = "Screen monitoring is disabled by the organization policy.";
  else if (pendingRequest)
    requestDisabledReason =
      "A screenshot request is already pending for this employee. Wait for it, or cancel it below.";
  else if (!selectedRow) requestDisabledReason = "Tracking status is unavailable for this employee.";
  else if (!selectedRow.activeSession)
    requestDisabledReason = "The employee needs an active work session in the desktop app.";
  else if (!selectedRow.online)
    requestDisabledReason = "The employee's desktop agent is offline.";
  else if (selectedRow.heartbeatStale)
    requestDisabledReason = "The session heartbeat is stale. Try again after the next heartbeat.";
  else if (selectedRow.agent?.status === "REVOKED")
    requestDisabledReason = "The employee's desktop agent was revoked.";

  function refreshMonitoring() {
    tracking.reload();
    requests.reload();
    screenshots.reload();
    audit.reload();
  }

  async function openPreview(screenshot: ScreenshotSummary) {
    setActionError(null);
    setPreview({ status: "loading", screenshot });
    try {
      const response = await apiRequest<ScreenshotAccessResponse>(
        `/admin/screenshots/${screenshot.id}/access`,
        {
          method: "POST",
          headers: { "X-Organization-Id": organizationId },
          body: {},
        },
      );
      setPreview({
        status: "ready",
        screenshot: response.data.screenshot,
        url: response.data.url,
        expiresAt: response.data.expiresAt,
      });
      audit.reload();
    } catch (error) {
      setPreview({
        status: "error",
        screenshot,
        message: screenshotErrorMessage(error),
      });
    }
  }

  async function cancelRequest(request: ScreenshotRequestSummary) {
    if (cancellingId) return;
    setCancellingId(request.id);
    setActionError(null);
    try {
      await apiRequest(`/admin/screenshot-requests/${request.id}/cancel`, {
        method: "POST",
        headers: { "X-Organization-Id": organizationId },
        body: {},
      });
      setPreview({ status: "idle" });
      refreshMonitoring();
    } catch (error) {
      setActionError(screenshotErrorMessage(error));
    } finally {
      setCancellingId(null);
    }
  }

  if (!canView) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow={organization.name} title="Screenshot review" />
        <Alert tone="warning" title="Screenshot review is not available for your role">
          Your role cannot view screenshots. Ask an owner or administrator if you need access.
        </Alert>
      </div>
    );
  }

  if (unauthorized) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow={organization.name}
          title="Screenshot review"
          description="Private screenshots and their audit trail are restricted by the organization monitoring policy."
        />
        <Alert tone="warning" title="Monitoring access is restricted">
          Your role has the relevant permission, but the current organization policy does not list
          your role as a permitted screenshot reviewer. Ask an owner or administrator to update the
          monitoring policy if you need access. No screenshot data was loaded.
        </Alert>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/live-tracking">
            <Button variant="secondary" size="sm">
              Back to live tracking
            </Button>
          </Link>
          {canConfigurePolicy ? (
            <Link href="/admin/monitoring">
              <Button variant="secondary" size="sm">
                Open monitoring settings
              </Button>
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`${organization.name} · ${timezone}`}
        title="Screenshot review"
        description="Request a single disclosed capture, review private images with short-lived links, and inspect every monitoring action. Images are never exposed as long-lived public URLs."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/live-tracking">
              <Button variant="secondary" size="sm">
                Live tracking
              </Button>
            </Link>
            {canConfigurePolicy ? (
              <Link href="/admin/monitoring">
                <Button variant="ghost" size="sm">
                  Monitoring settings
                </Button>
              </Link>
            ) : null}
          </div>
        }
      />

      <Alert tone="info" title="Explicit, one-at-a-time capture">
        A request is delivered over the agent socket only while the employee has an eligible active
        session. The desktop app shows the capture while it happens. This page does not stream a
        screen, and there is no periodic capture.
      </Alert>

      <Card>
        <div className="grid gap-3 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <Field label="Employee" htmlFor="review-employee">
            <Select
              id="review-employee"
              value={employeeId}
              onChange={(event) => selectEmployee(event.target.value)}
              disabled={members.loading && !members.data}
            >
              <option value="">Select an employee…</option>
              {(members.data?.data ?? []).map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.user.name} · {member.role.toLowerCase()}
                </option>
              ))}
            </Select>
          </Field>
          <p className="text-[11px] text-slate-500">
            {members.error
              ? "The employee list could not be loaded."
              : `${members.data?.meta.total ?? 0} active employee${(members.data?.meta.total ?? 0) === 1 ? "" : "s"} available`}
          </p>
        </div>
        {members.error ? (
          <div className="px-5 pb-4">
            <Alert tone="warning">{members.error}</Alert>
          </div>
        ) : null}
      </Card>

      {!employeeId ? (
        <Card>
          <EmptyState
            title="Select an employee"
            description="Choose an employee to see their online state, request eligibility, screenshots, and audit history."
            icon={<CameraIcon className="h-5 w-5" />}
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Agent"
              value={
                tracking.loading && !selectedRow ? "…" : selectedRow?.online ? "Online" : "Offline"
              }
              hint={
                selectedRow?.online
                  ? "Recent agent heartbeat"
                  : "Request delivery waits for reconnection"
              }
              accent={selectedRow?.online ? "emerald" : "slate"}
              icon={<CameraIcon className="h-4 w-4" />}
            />
            <StatCard
              label="Work session"
              value={
                selectedRow
                  ? selectedRow.activeSession
                    ? formatDuration(selectedRow.activeSession.durationSeconds)
                    : "None"
                  : "—"
              }
              hint={
                selectedRow?.activeSession
                  ? "Active session elapsed time"
                  : "An active session is required"
              }
              accent="indigo"
            />
            <StatCard
              label="Pending request"
              value={pendingRequest ? pendingRequest.status.toLowerCase() : "None"}
              hint={
                pendingRequest
                  ? `Requested ${formatDateTime(pendingRequest.requestedAt, timezone)}`
                  : "No capture in progress"
              }
              accent={pendingRequest ? "amber" : "slate"}
            />
            <StatCard
              label="Monitoring policy"
              value={policy.loading && !policyValue ? "…" : monitoringEnabled ? "Enabled" : "Disabled"}
              hint={
                canConfigurePolicy
                  ? `Retention ${policyValue?.retentionDays ?? "—"} days`
                  : "Contact an administrator to change it"
              }
              accent={monitoringEnabled ? "rose" : "slate"}
              icon={<ShieldIcon className="h-4 w-4" />}
            />
          </div>

          <Card>
            <CardHeader
              title="Request eligibility"
              description="Eligibility is evaluated by the backend at request time; this panel mirrors the server tracking state."
            />
            <CardBody className="space-y-4">
              {tracking.error ? (
                <Alert tone="danger" title="Tracking status unavailable">
                  {tracking.error}
                </Alert>
              ) : tracking.loading && !selectedRow ? (
                <LoadingBlock label="Loading employee status" rows={2} />
              ) : selectedRow ? (
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex items-start gap-3">
                    <Avatar name={selectedRow.employee.name} size="sm" />
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {selectedRow.employee.name}
                      </p>
                      <p className="text-xs text-slate-500">{selectedRow.employee.email}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <TrackingBadge state={selectedRow.state} />
                        <Badge tone={selectedRow.online ? "success" : "neutral"}>
                          {selectedRow.online ? "Online" : "Offline"}
                        </Badge>
                        {selectedRow.heartbeatStale ? (
                          <Badge tone="warning">Stale heartbeat</Badge>
                        ) : null}
                        {selectedRow.agent?.status === "REVOKED" ? (
                          <Badge tone="danger">Agent revoked</Badge>
                        ) : null}
                      </div>
                      <p className="mt-2 text-[11px] text-slate-500">
                        {selectedRow.activeSession
                          ? `Active session since ${formatDateTime(selectedRow.activeSession.startedAt, timezone)}`
                          : "No active work session"}
                        {selectedRow.lastHeartbeatAt
                          ? ` · Last heartbeat ${formatDateTime(selectedRow.lastHeartbeatAt, timezone)}`
                          : ""}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {selectedRow.agent
                          ? `${selectedRow.agent.name} · ${[selectedRow.agent.platform, selectedRow.agent.appVersion].filter(Boolean).join(" · ")}`
                          : "No desktop agent registered"}
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 space-y-2">
                    {canRequest ? (
                      <ScreenshotRequestButton
                        employeeId={employeeId}
                        employeeName={selectedRow.employee.name}
                        disabled={
                          !eligible || Boolean(pendingRequest) || Boolean(requestDisabledReason)
                        }
                        disabledReason={requestDisabledReason}
                        onRequested={refreshMonitoring}
                      />
                    ) : (
                      <Alert tone="info">
                        Your role can review screenshots but cannot create a request under the
                        current policy.
                      </Alert>
                    )}
                    <p className="text-[11px] text-slate-500">
                      {selectedMember
                        ? `Member role: ${selectedMember.role.toLowerCase()}`
                        : "Active membership"}
                    </p>
                  </div>
                </div>
              ) : (
                <Alert tone="info">
                  No tracking row is available for this employee yet. They may not have joined an
                  active session or connected a desktop agent.
                </Alert>
              )}

              {!monitoringEnabled && canConfigurePolicy && !policy.loading ? (
                <Alert tone="warning" title="Monitoring is disabled">
                  Screenshot requests are blocked. An owner or administrator can enable the policy
                  in{" "}
                  <Link className="font-semibold underline" href="/admin/monitoring">
                    monitoring settings
                  </Link>
                  .
                </Alert>
              ) : null}

              {actionError ? <Alert tone="danger">{actionError}</Alert> : null}
            </CardBody>
          </Card>

          {preview.status !== "idle" ? (
            <Card>
              <CardHeader
                title="Private screenshot preview"
                description={
                  preview.status === "ready"
                    ? `Short-lived link expires ${formatDateTime(preview.expiresAt, timezone)}. Opening or refreshing it is audited.`
                    : "Previews are issued on demand and never stored in the browser as durable URLs."
                }
                actions={
                  <Button variant="ghost" size="sm" onClick={() => setPreview({ status: "idle" })}>
                    Close preview
                  </Button>
                }
              />
              <CardBody>
                {preview.status === "loading" ? (
                  <LoadingBlock label="Issuing a private preview link" rows={4} />
                ) : preview.status === "error" ? (
                  <Alert tone="danger" title="Preview unavailable">
                    {preview.message}
                  </Alert>
                ) : preview.status === "ready" ? (
                  <div className="space-y-3">
                    <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-950">
                      {/* Signed URLs are short-lived and scoped; they are never cached or reused. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={preview.url}
                        alt={`Screenshot captured ${formatDateTime(preview.screenshot.capturedAt, timezone)}`}
                        className="mx-auto max-h-[32rem] w-auto object-contain"
                        onError={() =>
                          setPreview({
                            status: "error",
                            screenshot: preview.screenshot,
                            message:
                              "The image could not be loaded. The private link may have expired; request a fresh preview.",
                          })
                        }
                      />
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Captured {formatDateTime(preview.screenshot.capturedAt, timezone)} ·{" "}
                      {formatBytes(preview.screenshot.fileSizeBytes)} ·{" "}
                      {preview.screenshot.contentType}
                    </p>
                  </div>
                ) : null}
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader
              title="Requests"
              description="One active request per employee. Failures and expirations are kept for review."
              actions={
                <Button variant="ghost" size="sm" onClick={refreshMonitoring}>
                  Refresh
                </Button>
              }
            />
            {requests.error ? (
              <div className="px-5 pb-4">
                <ErrorState message={requests.error} onRetry={requests.reload} />
              </div>
            ) : requests.loading && !requests.data ? (
              <LoadingBlock label="Loading screenshot requests" rows={4} />
            ) : (requests.data?.data.length ?? 0) === 0 ? (
              <EmptyState
                title="No screenshot requests"
                description="Requests for this employee will appear here with delivery, claim, capture, and failure state."
                icon={<CameraIcon className="h-5 w-5" />}
              />
            ) : (
              <>
                <TableShell>
                  <thead>
                    <tr>
                      <Th>Requested</Th>
                      <Th>Status</Th>
                      <Th>Requested by</Th>
                      <Th>Timeline</Th>
                      <Th className="text-right">Actions</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {(requests.data?.data ?? []).map((request) => (
                      <tr key={request.id}>
                        <Td>
                          <p className="text-xs font-medium text-slate-800">
                            {formatDateTime(request.requestedAt, timezone)}
                          </p>
                          <p className="mt-0.5 text-[11px] text-slate-500">
                            Expires {formatDateTime(request.expiresAt, timezone)}
                          </p>
                        </Td>
                        <Td>
                          <StatusBadge status={request.status} />
                          {request.failure ? (
                            <p className="mt-1 max-w-xs text-[11px] leading-5 text-rose-700">
                              {request.failure.code}
                              {request.failure.message ? ` · ${request.failure.message}` : ""}
                            </p>
                          ) : null}
                        </Td>
                        <Td>
                          <p className="text-xs text-slate-700">
                            {request.requestingAdmin?.name ?? "Unknown administrator"}
                          </p>
                          {request.desktopAgent ? (
                            <p className="mt-0.5 text-[11px] text-slate-500">
                              {request.desktopAgent.name} ·{" "}
                              {request.desktopAgent.online ? "online" : "offline"}
                            </p>
                          ) : null}
                        </Td>
                        <Td>
                          <div className="space-y-0.5 text-[11px] text-slate-500">
                            <p>
                              Acknowledged:{" "}
                              {request.acknowledgedAt
                                ? formatDateTime(request.acknowledgedAt, timezone)
                                : "—"}
                            </p>
                            <p>
                              Claimed:{" "}
                              {request.claimedAt
                                ? formatDateTime(request.claimedAt, timezone)
                                : "—"}
                            </p>
                            <p>
                              Completed:{" "}
                              {request.completedAt
                                ? formatDateTime(request.completedAt, timezone)
                                : "—"}
                            </p>
                          </div>
                        </Td>
                        <Td className="text-right">
                          <div className="flex flex-col items-end gap-1.5">
                            {request.screenshot ? (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => void openPreview(request.screenshot as ScreenshotSummary)}
                                disabled={preview.status === "loading"}
                              >
                                Open image
                              </Button>
                            ) : null}
                            {canManage && request.canCancel ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void cancelRequest(request)}
                                disabled={cancellingId === request.id}
                              >
                                {cancellingId === request.id ? "Cancelling…" : "Cancel request"}
                              </Button>
                            ) : null}
                          </div>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </TableShell>
                <div className="px-5 pb-4">
                  <Pagination
                    page={requests.data?.meta.page ?? requestPage}
                    totalPages={requests.data?.meta.totalPages ?? 1}
                    onPageChange={setRequestPage}
                  />
                </div>
              </>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Captured screenshots"
              description="Private images are listed with capture and retention metadata. Opening one issues a new short-lived access link and audit event."
            />
            {screenshots.error ? (
              <div className="px-5 pb-4">
                <ErrorState message={screenshots.error} onRetry={screenshots.reload} />
              </div>
            ) : screenshots.loading && !screenshots.data ? (
              <LoadingBlock label="Loading screenshots" rows={4} />
            ) : (screenshots.data?.data.length ?? 0) === 0 ? (
              <EmptyState
                title="No captured screenshots"
                description="Only successfully uploaded screenshots appear here. Failed or expired requests remain visible in the request history above."
                icon={<CameraIcon className="h-5 w-5" />}
              />
            ) : (
              <>
                <TableShell>
                  <thead>
                    <tr>
                      <Th>Captured</Th>
                      <Th>Requested by</Th>
                      <Th>File</Th>
                      <Th>Retention</Th>
                      <Th className="text-right">Preview</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {(screenshots.data?.data ?? []).map((shot) => (
                      <tr key={shot.id}>
                        <Td>
                          <p className="text-xs font-medium text-slate-800">
                            {formatDateTime(shot.capturedAt, timezone)}
                          </p>
                          {shot.timeSessionId ? (
                            <p className="mt-0.5 text-[11px] text-slate-500">
                              Session {shot.timeSessionId.slice(0, 8)}
                            </p>
                          ) : null}
                        </Td>
                        <Td>
                          <p className="text-xs text-slate-700">
                            {shot.requestingAdmin?.name ?? "—"}
                          </p>
                        </Td>
                        <Td>
                          <p className="text-xs text-slate-700">{formatBytes(shot.fileSizeBytes)}</p>
                          <p className="mt-0.5 text-[11px] text-slate-500">{shot.contentType}</p>
                        </Td>
                        <Td>
                          <p className="text-xs text-slate-700">
                            Until {formatDateTime(shot.retentionExpiresAt, timezone)}
                          </p>
                        </Td>
                        <Td className="text-right">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => void openPreview(shot)}
                            disabled={
                              preview.status === "loading" && preview.screenshot.id === shot.id
                            }
                          >
                            {preview.status === "loading" && preview.screenshot.id === shot.id
                              ? "Opening…"
                              : "Open private preview"}
                          </Button>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </TableShell>
                <div className="px-5 pb-4">
                  <Pagination
                    page={screenshots.data?.meta.page ?? screenshotPage}
                    totalPages={screenshots.data?.meta.totalPages ?? 1}
                    onPageChange={setScreenshotPage}
                  />
                </div>
              </>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Audit history"
              description="Policy changes, requests, delivery, capture, failures, cancellations, and access are recorded. Agent credentials and storage keys are never returned."
            />
            {audit.error ? (
              <div className="px-5 pb-4">
                <ErrorState message={audit.error} onRetry={audit.reload} />
              </div>
            ) : audit.loading && !audit.data ? (
              <LoadingBlock label="Loading audit history" rows={4} />
            ) : (audit.data?.data.length ?? 0) === 0 ? (
              <EmptyState
                title="No monitoring audit events"
                description="Monitoring actions for this employee will appear here."
                icon={<ShieldIcon className="h-5 w-5" />}
              />
            ) : (
              <>
                <TableShell>
                  <thead>
                    <tr>
                      <Th>When</Th>
                      <Th>Action</Th>
                      <Th>Actor</Th>
                      <Th>Detail</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {(audit.data?.data ?? []).map((event) => (
                      <tr key={event.id}>
                        <Td>
                          <p className="text-xs text-slate-700">
                            {formatDateTime(event.createdAt, timezone)}
                          </p>
                        </Td>
                        <Td>
                          <p className="text-xs font-medium text-slate-800">
                            {AUDIT_LABELS[event.action] ?? event.action}
                          </p>
                          <p className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                            {event.action}
                          </p>
                        </Td>
                        <Td>
                          <p className="text-xs text-slate-700">
                            {event.actor?.name ?? event.targetEmployee?.name ?? "System"}
                          </p>
                          {event.actor && event.targetEmployee ? (
                            <p className="mt-0.5 text-[11px] text-slate-500">
                              Target: {event.targetEmployee.name}
                            </p>
                          ) : null}
                        </Td>
                        <Td>
                          <p className="max-w-md text-[11px] leading-5 text-slate-500">
                            {auditDetail(event)}
                          </p>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </TableShell>
                <div className="px-5 pb-4">
                  <Pagination
                    page={audit.data?.meta.page ?? auditPage}
                    totalPages={audit.data?.meta.totalPages ?? 1}
                    onPageChange={setAuditPage}
                  />
                </div>
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
