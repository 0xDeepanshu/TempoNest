"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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
import { CameraIcon, CloseIcon, MonitorIcon, RefreshIcon, ShieldIcon } from "./icons";
import { LiveScreenViewer } from "./live-screen-viewer";
import { ScreenshotRequestButton } from "./screenshot-request-button";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingBlock,
  PageHeader,
  Pagination,
  Select,
  StatusBadge,
  TableShell,
  Tabs,
  Td,
  Th,
  TrackingBadge,
  cn,
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

const LIBRARY_PAGE_SIZE = 12;
const REQUEST_PAGE_SIZE = 10;
const AUDIT_PAGE_SIZE = 15;

type ReviewTab = "library" | "requests" | "audit";

type PreviewState =
  | { status: "loading" }
  | { status: "ready"; url: string; expiresAt: string }
  | { status: "error"; message: string };

type DrawerState = { items: ScreenshotSummary[]; index: number };

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
  const canLive = hasPermission(role, "screenshot:live");
  const canManage = hasPermission(role, "screenshot:manage");
  const canConfigurePolicy = hasPermission(role, "screenshot:policy");

  const [employeeId, setEmployeeId] = useState(initialEmployeeId);
  const [tab, setTab] = useState<ReviewTab>("library");
  const [requestPage, setRequestPage] = useState(1);
  const [screenshotPage, setScreenshotPage] = useState(1);
  const [auditPage, setAuditPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [previews, setPreviews] = useState<Record<string, PreviewState>>({});
  const [loadingPreviews, setLoadingPreviews] = useState(false);
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [liveOpen, setLiveOpen] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);

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
        query: {
          employeeId: employeeId || undefined,
          page: requestPage,
          limit: REQUEST_PAGE_SIZE,
        },
        headers: { "X-Organization-Id": organizationId },
      }),
    [organizationId, employeeId, requestPage],
    { enabled: Boolean(organizationId) && canView },
  );

  const screenshots = useApi<ScreenshotsResponse>(
    (signal) =>
      apiRequest("/admin/screenshots", {
        signal,
        query: {
          employeeId: employeeId || undefined,
          page: screenshotPage,
          limit: LIBRARY_PAGE_SIZE,
        },
        headers: { "X-Organization-Id": organizationId },
      }),
    [organizationId, employeeId, screenshotPage],
    { enabled: Boolean(organizationId) && canView },
  );

  const audit = useApi<ScreenshotAuditResponse>(
    (signal) =>
      apiRequest("/admin/screenshot-audit-events", {
        signal,
        query: { employeeId: employeeId || undefined, page: auditPage, limit: AUDIT_PAGE_SIZE },
        headers: { "X-Organization-Id": organizationId },
      }),
    [organizationId, employeeId, auditPage],
    { enabled: Boolean(organizationId) && canView },
  );

  const shots = screenshots.data?.data ?? [];
  const requestRows = requests.data?.data ?? [];
  const auditRows = audit.data?.data ?? [];
  const pageSelected = shots.length > 0 && shots.every((shot) => selectedIds.has(shot.id));
  const pagePartiallySelected = !pageSelected && shots.some((shot) => selectedIds.has(shot.id));

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = pagePartiallySelected;
    }
  }, [pagePartiallySelected]);

  const selectedRow = tracking.data?.data[0] ?? null;
  const selectedMember = (members.data?.data ?? []).find((member) => member.userId === employeeId);
  const policyValue = policy.data?.data.policy;
  const monitoringEnabled = policyValue?.enabled === true;
  const pendingRequest = requestRows.find(
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
      "A screenshot request is already pending for this employee. Wait for it, or cancel it in Requests.";
  else if (!selectedRow) requestDisabledReason = "Tracking status is unavailable for this employee.";
  else if (!selectedRow.activeSession)
    requestDisabledReason = "The employee needs an active work session in the desktop app.";
  else if (!selectedRow.online)
    requestDisabledReason = "The employee's desktop agent is offline.";
  else if (selectedRow.heartbeatStale)
    requestDisabledReason = "The session heartbeat is stale. Try again after the next heartbeat.";
  else if (selectedRow.agent?.status === "REVOKED")
    requestDisabledReason = "The employee's desktop agent was revoked.";

  const liveRoleAllowed =
    role !== undefined &&
    policyValue !== undefined &&
    policyValue.requestRoles.includes(role) &&
    policyValue.viewRoles.includes(role);

  let liveDisabledReason: string | undefined;
  if (!employeeId) liveDisabledReason = "Select an employee first.";
  else if (!canLive) liveDisabledReason = "Your role cannot view live screens.";
  else if (policy.loading && !policyValue) liveDisabledReason = "Checking the live view policy…";
  else if (!policyValue)
    liveDisabledReason =
      "The monitoring policy could not be loaded, so live viewing cannot be authorized right now.";
  else if (!monitoringEnabled)
    liveDisabledReason = "Live screen viewing is disabled by the organization policy.";
  else if (!liveRoleAllowed)
    liveDisabledReason = "The monitoring policy does not permit your role to start live viewing.";
  else if (!selectedRow) liveDisabledReason = "Tracking status is unavailable, so live view cannot start.";
  else if (!selectedRow.activeSession)
    liveDisabledReason = "Live view requires an active work session in the desktop app.";
  else if (!selectedRow.online)
    liveDisabledReason = "Live view requires the employee's desktop agent to be online.";
  else if (selectedRow.heartbeatStale)
    liveDisabledReason = "The session heartbeat is stale. Live view will be available after the next heartbeat.";
  else if (selectedRow.agent?.status === "REVOKED")
    liveDisabledReason = "Live view is unavailable because the employee's desktop agent was revoked.";

  if (!organization) return <NoOrganization />;

  function refreshMonitoring() {
    tracking.reload();
    requests.reload();
    screenshots.reload();
    audit.reload();
  }

  function selectEmployee(nextEmployeeId: string) {
    setEmployeeId(nextEmployeeId);
    setRequestPage(1);
    setScreenshotPage(1);
    setAuditPage(1);
    setSelectedIds(new Set());
    setPreviews({});
    setDrawer(null);
    setLiveOpen(false);
    setActionError(null);
  }

  function changeTab(nextTab: ReviewTab) {
    setTab(nextTab);
    setDrawer(null);
    setActionError(null);
  }

  function changeScreenshotPage(page: number) {
    setScreenshotPage(page);
    setSelectedIds(new Set());
    setPreviews({});
  }

  function toggleSelected(id: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function togglePage(checked: boolean) {
    setSelectedIds(checked ? new Set(shots.map((shot) => shot.id)) : new Set());
  }

  function markPreviewError(id: string, message: string) {
    setPreviews((current) => ({ ...current, [id]: { status: "error", message } }));
  }

  async function loadPreviews() {
    if (loadingPreviews || shots.length === 0) return;
    const targets =
      selectedIds.size > 0 ? shots.filter((shot) => selectedIds.has(shot.id)) : shots;
    if (targets.length === 0) return;
    setLoadingPreviews(true);
    setPreviews((current) => {
      const next = { ...current };
      for (const shot of targets) next[shot.id] = { status: "loading" };
      return next;
    });
    const results = await Promise.allSettled(
      targets.map((shot) =>
        apiRequest<ScreenshotAccessResponse>(`/admin/screenshots/${shot.id}/access`, {
          method: "POST",
          headers: { "X-Organization-Id": organizationId },
          body: {},
        }),
      ),
    );
    setPreviews((current) => {
      const next = { ...current };
      results.forEach((result, index) => {
        const shot = targets[index];
        next[shot.id] =
          result.status === "fulfilled"
            ? {
                status: "ready",
                url: result.value.data.url,
                expiresAt: result.value.data.expiresAt,
              }
            : { status: "error", message: screenshotErrorMessage(result.reason) };
      });
      return next;
    });
    setLoadingPreviews(false);
    audit.reload();
  }

  function openDrawer(items: ScreenshotSummary[], index: number) {
    setActionError(null);
    setDrawer({ items, index });
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
      refreshMonitoring();
    } catch (error) {
      setActionError(screenshotErrorMessage(error));
    } finally {
      setCancellingId(null);
    }
  }

  if (!canView) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow={organization.name} title="Screenshot review" />
        <Alert tone="warning" title="Screenshot review is not available for your role">
          Your role cannot view screenshots. Ask an owner or administrator if you need access.
        </Alert>
      </div>
    );
  }

  if (unauthorized) {
    return (
      <div className="space-y-5">
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

  const libraryEmpty = shots.length === 0;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${organization.name} · ${timezone}`}
        title="Screenshot review"
        description="Review private captures across the organization. Previews load on demand through short-lived, audited links."
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

      <Card>
        <div className="flex flex-col gap-3 border-b border-line p-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Employee" htmlFor="review-employee" className="w-full sm:w-64">
              <Select
                id="review-employee"
                value={employeeId}
                onChange={(event) => selectEmployee(event.target.value)}
                disabled={members.loading && !members.data}
              >
                <option value="">All employees</option>
                {(members.data?.data ?? []).map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.user.name} · {member.role.toLowerCase()}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="pb-2 text-[11px] text-muted">
              {members.error
                ? "The employee list could not be loaded."
                : `${members.data?.meta.total ?? 0} active employee${(members.data?.meta.total ?? 0) === 1 ? "" : "s"} · ${employeeId ? "filtered view" : "organization-wide"}`}
            </p>
          </div>
          <Tabs
            tabs={[
              { value: "library", label: "Library", count: screenshots.data?.meta.total },
              { value: "requests", label: "Requests", count: requests.data?.meta.total },
              { value: "audit", label: "Audit", count: audit.data?.meta.total },
            ]}
            value={tab}
            onChange={changeTab}
          />
        </div>
        <div className="px-3 py-2.5">
          <p className="text-[11px] leading-5 text-muted">
            Captures are explicit and one at a time. Previews are never public URLs; each loaded
            preview and audit entry is issued by the backend.
          </p>
        </div>
        {members.error ? (
          <div className="px-3 pb-2.5">
            <Alert tone="warning">{members.error}</Alert>
          </div>
        ) : null}
      </Card>

      {tab === "library" ? (
        <>
          {employeeId ? (
            <Card>
              <div className="border-b border-line px-3 py-2.5">
                <h2 className="text-[13px] font-semibold text-ink">Request a capture</h2>
                <p className="mt-0.5 text-xs text-muted">
                  Eligibility is evaluated by the backend at request time; this panel mirrors the
                  server tracking state.
                </p>
              </div>
              <div className="space-y-3 p-3">
                {tracking.error ? (
                  <Alert tone="danger" title="Tracking status unavailable">
                    {tracking.error}
                  </Alert>
                ) : tracking.loading && !selectedRow ? (
                  <LoadingBlock label="Loading employee status" rows={2} />
                ) : selectedRow ? (
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <Avatar name={selectedRow.employee.name} size="sm" />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="text-[13px] font-semibold text-ink">
                            {selectedRow.employee.name}
                          </p>
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
                        <p className="mt-1 text-[11px] leading-5 text-muted">
                          {selectedRow.employee.email}
                          {selectedRow.activeSession
                            ? ` · Active session ${formatDuration(selectedRow.activeSession.durationSeconds)} since ${formatDateTime(selectedRow.activeSession.startedAt, timezone)}`
                            : " · No active work session"}
                          {selectedRow.lastHeartbeatAt
                            ? ` · Last heartbeat ${formatDateTime(selectedRow.lastHeartbeatAt, timezone)}`
                            : ""}
                        </p>
                        <p className="text-[11px] text-muted">
                          {selectedRow.agent
                            ? `${selectedRow.agent.name} · ${[selectedRow.agent.platform, selectedRow.agent.appVersion].filter(Boolean).join(" · ")}`
                            : "No desktop agent registered"}
                          {selectedMember
                            ? ` · Member role: ${selectedMember.role.toLowerCase()}`
                            : ""}
                        </p>
                      </div>
                    </div>
                    <div className="shrink-0 space-y-2">
                      <div className="flex flex-wrap items-start gap-2">
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
                          <p className="max-w-xs text-[11px] leading-5 text-muted">
                            Your role can review screenshots but cannot create a request under the
                            current policy.
                          </p>
                        )}
                      </div>
                      {canLive ? (
                        <div className="space-y-2">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={Boolean(liveDisabledReason)}
                            title={liveDisabledReason}
                            onClick={() => setLiveOpen(true)}
                          >
                            <MonitorIcon className="h-3.5 w-3.5" />
                            View live screen
                          </Button>
                          {liveDisabledReason ? (
                            <p className="max-w-xs text-[11px] leading-5 text-muted">
                              {liveDisabledReason}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
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
                    Screenshot requests are blocked. An owner or administrator can enable the
                    policy in{" "}
                    <Link className="font-semibold underline" href="/admin/monitoring">
                      monitoring settings
                    </Link>
                    .
                  </Alert>
                ) : null}

                {actionError ? <Alert tone="danger">{actionError}</Alert> : null}
              </div>
            </Card>
          ) : null}

          <Card>
            <div className="flex flex-col gap-2 border-b border-line px-3 py-2.5 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-2 text-xs text-ink-secondary">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={pageSelected}
                    onChange={(event) => togglePage(event.target.checked)}
                    disabled={libraryEmpty}
                    aria-label="Select all screenshots on this page"
                    className="h-3.5 w-3.5 accent-ink disabled:cursor-not-allowed"
                  />
                  Select page
                </label>
                {selectedIds.size > 0 ? (
                  <>
                    <span className="text-[11px] text-muted">{selectedIds.size} selected</span>
                    <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                      Clear
                    </Button>
                  </>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void loadPreviews()}
                  disabled={loadingPreviews || libraryEmpty}
                  loading={loadingPreviews}
                >
                  {loadingPreviews ? null : <RefreshIcon className="h-3.5 w-3.5" />}
                  {loadingPreviews
                    ? "Loading previews…"
                    : selectedIds.size > 0
                      ? `Load ${selectedIds.size} selected`
                      : "Load previews"}
                </Button>
                <Button variant="ghost" size="sm" onClick={refreshMonitoring}>
                  <RefreshIcon className="h-3.5 w-3.5" />
                  Refresh
                </Button>
              </div>
            </div>

            {screenshots.error ? (
              <div className="p-3">
                <ErrorState message={screenshots.error} onRetry={screenshots.reload} />
              </div>
            ) : screenshots.loading && !screenshots.data ? (
              <div
                className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
                aria-busy="true"
                aria-label="Loading screenshots"
              >
                {Array.from({ length: 6 }).map((_, index) => (
                  <div
                    key={index}
                    className="h-60 animate-pulse rounded-xl border border-line bg-surface-hover"
                  />
                ))}
              </div>
            ) : libraryEmpty ? (
              <EmptyState
                title={
                  employeeId ? "No screenshots for this employee" : "No screenshots captured yet"
                }
                description={
                  employeeId
                    ? "Captures for this employee will appear here after a request is completed by the desktop agent."
                    : "Screenshots appear after an administrator requests a capture and the desktop agent uploads it."
                }
                icon={<CameraIcon className="h-5 w-5" />}
              />
            ) : (
              <>
                <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {shots.map((shot, index) => (
                    <ScreenshotTile
                      key={shot.id}
                      screenshot={shot}
                      preview={previews[shot.id]}
                      selected={selectedIds.has(shot.id)}
                      timezone={timezone}
                      onToggle={(checked) => toggleSelected(shot.id, checked)}
                      onOpen={() => openDrawer(shots, index)}
                      onImageError={() =>
                        markPreviewError(
                          shot.id,
                          "The image could not be loaded. The private link may have expired; load previews again.",
                        )
                      }
                    />
                  ))}
                </div>
                <Pagination
                  page={screenshots.data?.meta.page ?? screenshotPage}
                  totalPages={screenshots.data?.meta.totalPages ?? 1}
                  onPageChange={changeScreenshotPage}
                />
              </>
            )}
          </Card>
        </>
      ) : tab === "requests" ? (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-3 py-2.5">
            <div>
              <h2 className="text-[13px] font-semibold text-ink">Screenshot requests</h2>
              <p className="mt-0.5 text-xs text-muted">
                One active request per employee. Failures and expirations are kept for review.
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={refreshMonitoring}>
              <RefreshIcon className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>

          {actionError ? (
            <div className="p-3">
              <Alert tone="danger">{actionError}</Alert>
            </div>
          ) : null}

          {requests.error ? (
            <div className="p-3">
              <ErrorState message={requests.error} onRetry={requests.reload} />
            </div>
          ) : requests.loading && !requests.data ? (
            <LoadingBlock label="Loading screenshot requests" rows={4} />
          ) : requestRows.length === 0 ? (
            <EmptyState
              title="No screenshot requests"
              description={
                employeeId
                  ? "Requests for this employee will appear here with delivery, claim, capture, and failure state."
                  : "Requests across the organization will appear here with delivery, claim, capture, and failure state."
              }
              icon={<CameraIcon className="h-5 w-5" />}
            />
          ) : (
            <>
              <TableShell>
                <thead>
                  <tr>
                    <Th>Requested</Th>
                    <Th>Employee</Th>
                    <Th>Status</Th>
                    <Th>Requested by</Th>
                    <Th>Timeline</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {requestRows.map((request) => (
                    <tr key={request.id}>
                      <Td>
                        <p className="text-xs font-medium text-ink-secondary">
                          {formatDateTime(request.requestedAt, timezone)}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted">
                          Expires {formatDateTime(request.expiresAt, timezone)}
                        </p>
                      </Td>
                      <Td>
                        <p className="text-xs text-ink-secondary">
                          {request.employee?.name ?? "—"}
                        </p>
                        {request.employee ? (
                          <p className="mt-0.5 text-[11px] text-muted">{request.employee.email}</p>
                        ) : null}
                      </Td>
                      <Td>
                        <StatusBadge status={request.status} />
                        {request.failure ? (
                          <p className="mt-1 max-w-xs text-[11px] leading-5 text-danger">
                            {request.failure.code}
                            {request.failure.message ? ` · ${request.failure.message}` : ""}
                          </p>
                        ) : null}
                      </Td>
                      <Td>
                        <p className="text-xs text-ink-secondary">
                          {request.requestingAdmin?.name ?? "Unknown administrator"}
                        </p>
                        {request.desktopAgent ? (
                          <p className="mt-0.5 text-[11px] text-muted">
                            {request.desktopAgent.name} ·{" "}
                            {request.desktopAgent.online ? "online" : "offline"}
                          </p>
                        ) : null}
                      </Td>
                      <Td>
                        <div className="space-y-0.5 text-[11px] text-muted">
                          <p>
                            Acknowledged:{" "}
                            {request.acknowledgedAt
                              ? formatDateTime(request.acknowledgedAt, timezone)
                              : "—"}
                          </p>
                          <p>
                            Claimed:{" "}
                            {request.claimedAt ? formatDateTime(request.claimedAt, timezone) : "—"}
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
                              onClick={() =>
                                openDrawer([request.screenshot as ScreenshotSummary], 0)
                              }
                            >
                              View image
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
              <Pagination
                page={requests.data?.meta.page ?? requestPage}
                totalPages={requests.data?.meta.totalPages ?? 1}
                onPageChange={setRequestPage}
              />
            </>
          )}
        </Card>
      ) : (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-3 py-2.5">
            <div>
              <h2 className="text-[13px] font-semibold text-ink">Audit history</h2>
              <p className="mt-0.5 text-xs text-muted">
                Policy changes, requests, delivery, capture, failures, cancellations, and access
                are recorded. Agent credentials and storage keys are never returned.
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={audit.reload}>
              <RefreshIcon className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>

          {audit.error ? (
            <div className="p-3">
              <ErrorState message={audit.error} onRetry={audit.reload} />
            </div>
          ) : audit.loading && !audit.data ? (
            <LoadingBlock label="Loading audit history" rows={4} />
          ) : auditRows.length === 0 ? (
            <EmptyState
              title="No monitoring audit events"
              description={
                employeeId
                  ? "Monitoring actions for this employee will appear here."
                  : "Monitoring actions across the organization will appear here."
              }
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
                  {auditRows.map((event) => (
                    <tr key={event.id}>
                      <Td>
                        <p className="text-xs text-ink-secondary">
                          {formatDateTime(event.createdAt, timezone)}
                        </p>
                      </Td>
                      <Td>
                        <p className="text-xs font-medium text-ink-secondary">
                          {AUDIT_LABELS[event.action] ?? event.action}
                        </p>
                        <p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted">
                          {event.action}
                        </p>
                      </Td>
                      <Td>
                        <p className="text-xs text-ink-secondary">
                          {event.actor?.name ?? event.targetEmployee?.name ?? "System"}
                        </p>
                        {event.actor && event.targetEmployee ? (
                          <p className="mt-0.5 text-[11px] text-muted">
                            Target: {event.targetEmployee.name}
                          </p>
                        ) : null}
                      </Td>
                      <Td>
                        <p className="max-w-md text-[11px] leading-5 text-muted">
                          {auditDetail(event)}
                        </p>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
              <Pagination
                page={audit.data?.meta.page ?? auditPage}
                totalPages={audit.data?.meta.totalPages ?? 1}
                onPageChange={setAuditPage}
              />
            </>
          )}
        </Card>
      )}

      {liveOpen && selectedRow ? (
        <LiveScreenViewer
          employeeId={selectedRow.employee.id}
          employeeName={selectedRow.employee.name}
          organizationId={organizationId}
          timezone={timezone}
          onClose={() => setLiveOpen(false)}
          onEnded={refreshMonitoring}
        />
      ) : null}

      {drawer ? (
        <ScreenshotDrawer
          items={drawer.items}
          index={drawer.index}
          organizationId={organizationId}
          timezone={timezone}
          onIndexChange={(index) =>
            setDrawer((current) => (current ? { ...current, index } : current))
          }
          onClose={() => setDrawer(null)}
          onAccessed={audit.reload}
        />
      ) : null}
    </div>
  );
}

function ScreenshotTile({
  screenshot,
  preview,
  selected,
  timezone,
  onToggle,
  onOpen,
  onImageError,
}: {
  screenshot: ScreenshotSummary;
  preview: PreviewState | undefined;
  selected: boolean;
  timezone: string;
  onToggle: (checked: boolean) => void;
  onOpen: () => void;
  onImageError: () => void;
}) {
  const capturedLabel = formatDateTime(screenshot.capturedAt, timezone);
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border bg-surface transition-colors",
        selected ? "border-ink ring-1 ring-ink" : "border-line hover:border-line-strong",
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-line px-2.5 py-2">
        <label className="flex min-w-0 items-center gap-2">
          <input
            type="checkbox"
            checked={selected}
            onChange={(event) => onToggle(event.target.checked)}
            aria-label={`Select screenshot captured ${capturedLabel}`}
            className="h-3.5 w-3.5 accent-ink"
          />
          <span className="truncate text-[11px] font-medium text-ink-secondary">
            {screenshot.employee?.name ?? "Unknown employee"}
          </span>
        </label>
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted">
          {formatBytes(screenshot.fileSizeBytes)}
        </span>
      </div>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open screenshot captured ${capturedLabel}`}
        className="block w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink"
      >
        <div className="relative flex aspect-[16/10] items-center justify-center bg-surface-muted">
          {preview?.status === "ready" ? (
            // Signed URLs are short-lived and scoped; they are never cached or reused.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview.url}
              alt={`Screenshot captured ${capturedLabel}`}
              className="h-full w-full object-cover"
              onError={onImageError}
            />
          ) : preview?.status === "loading" ? (
            <span className="text-[11px] text-muted" aria-busy="true">
              Loading preview…
            </span>
          ) : preview?.status === "error" ? (
            <span
              className="max-w-[85%] text-center text-[11px] leading-4 text-muted"
              title={preview.message}
            >
              Preview unavailable
            </span>
          ) : (
            <span className="flex flex-col items-center gap-1 text-[11px] text-muted">
              <CameraIcon className="h-5 w-5" />
              Preview not loaded
            </span>
          )}
        </div>
        <div className="space-y-0.5 px-2.5 py-2">
          <p className="text-[11px] font-medium text-ink">{capturedLabel}</p>
          <p className="truncate text-[11px] text-muted">
            {screenshot.employee?.email ?? screenshot.contentType}
          </p>
          <p className="text-[10px] text-muted">
            {screenshot.contentType} · Retention until{" "}
            {formatDateTime(screenshot.retentionExpiresAt, timezone)}
          </p>
        </div>
      </button>
    </div>
  );
}

function ScreenshotDrawer({
  items,
  index,
  organizationId,
  timezone,
  onIndexChange,
  onClose,
  onAccessed,
}: {
  items: ScreenshotSummary[];
  index: number;
  organizationId: string;
  timezone: string;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onAccessed: () => void;
}) {
  const screenshot = items[index];
  const panelRef = useRef<HTMLDivElement>(null);

  const canPrevious = index > 0;
  const canNext = index < items.length - 1;

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.body.style.overflow = bodyOverflow;
      previous?.focus();
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowLeft" && canPrevious) {
        event.preventDefault();
        onIndexChange(index - 1);
        return;
      }
      if (event.key === "ArrowRight" && canNext) {
        event.preventDefault();
        onIndexChange(index + 1);
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [canNext, canPrevious, index, onClose, onIndexChange]);

  const capturedLabel = formatDateTime(screenshot.capturedAt, timezone);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-overlay" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="screenshot-drawer-title"
        className="relative flex h-full w-full max-w-3xl flex-col border-l border-line bg-surface shadow-xl focus:outline-none"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 id="screenshot-drawer-title" className="text-[13px] font-semibold text-ink">
              Screenshot preview
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              {screenshot.employee?.name ? `${screenshot.employee.name} · ` : ""}
              {capturedLabel}
              {items.length > 1 ? ` · ${index + 1} of ${items.length}` : ""}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onIndexChange(index - 1)}
              disabled={!canPrevious}
            >
              Previous
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onIndexChange(index + 1)}
              disabled={!canNext}
            >
              Next
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              aria-label="Close screenshot preview"
            >
              <CloseIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <ScreenshotPreview
            key={screenshot.id}
            screenshot={screenshot}
            organizationId={organizationId}
            timezone={timezone}
            onAccessed={onAccessed}
          />

          <div className="space-y-4 p-4">
            <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
              <div>
                <dt className="text-muted">Employee</dt>
                <dd className="font-medium text-ink-secondary">
                  {screenshot.employee?.name ?? "—"}
                  {screenshot.employee ? (
                    <span className="block text-[11px] font-normal text-muted">
                      {screenshot.employee.email}
                    </span>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Requested by</dt>
                <dd className="font-medium text-ink-secondary">
                  {screenshot.requestingAdmin?.name ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Captured</dt>
                <dd className="font-medium text-ink-secondary">{capturedLabel}</dd>
              </div>
              <div>
                <dt className="text-muted">File</dt>
                <dd className="font-medium text-ink-secondary">
                  {formatBytes(screenshot.fileSizeBytes)} · {screenshot.contentType}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Work session</dt>
                <dd className="font-medium text-ink-secondary">
                  {screenshot.timeSessionId ? screenshot.timeSessionId.slice(0, 8) : "Not linked"}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Retention</dt>
                <dd className="font-medium text-ink-secondary">
                  Until {formatDateTime(screenshot.retentionExpiresAt, timezone)}
                </dd>
              </div>
            </dl>
            <p className="text-[11px] leading-5 text-muted">
              Previews are issued on demand through short-lived links. Each access is recorded in
              the audit history.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScreenshotPreview({
  screenshot,
  organizationId,
  timezone,
  onAccessed,
}: {
  screenshot: ScreenshotSummary;
  organizationId: string;
  timezone: string;
  onAccessed: () => void;
}) {
  const [preview, setPreview] = useState<PreviewState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const onAccessedRef = useRef(onAccessed);
  const capturedLabel = formatDateTime(screenshot.capturedAt, timezone);

  useEffect(() => {
    onAccessedRef.current = onAccessed;
  }, [onAccessed]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    apiRequest<ScreenshotAccessResponse>(`/admin/screenshots/${screenshot.id}/access`, {
      method: "POST",
      headers: { "X-Organization-Id": organizationId },
      body: {},
      signal: controller.signal,
    })
      .then((response) => {
        if (!active) return;
        setPreview({
          status: "ready",
          url: response.data.url,
          expiresAt: response.data.expiresAt,
        });
        onAccessedRef.current();
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return;
        setPreview({ status: "error", message: screenshotErrorMessage(error) });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [screenshot.id, organizationId, reloadKey]);

  useEffect(() => {
    if (preview.status !== "ready") return;
    const remaining = Date.parse(preview.expiresAt) - Date.now();
    const expire = () =>
      setPreview((current) =>
        current.status === "ready"
          ? {
              status: "error",
              message:
                "The private preview link expired. Load the preview again for a fresh short-lived link.",
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

  return (
    <>
      <div className="bg-media">
        {preview.status === "loading" ? (
          <div
            className="flex h-[40vh] items-center justify-center text-xs text-media-foreground"
            aria-busy="true"
          >
            Loading private preview…
          </div>
        ) : preview.status === "error" ? (
          <div className="flex h-[40vh] flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="max-w-md text-[11px] leading-5 text-media-danger">{preview.message}</p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setPreview({ status: "loading" });
                setReloadKey((value) => value + 1);
              }}
            >
              Load preview again
            </Button>
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview.url}
            alt={`Screenshot captured ${capturedLabel}`}
            className="mx-auto max-h-[60vh] w-auto object-contain"
            onError={() =>
              setPreview({
                status: "error",
                message:
                  "The image could not be loaded. The private link may have expired; load the preview again.",
              })
            }
          />
        )}
      </div>
      <p className="border-b border-line px-4 py-2 text-[11px] text-muted">
        {preview.status === "ready"
          ? `This link expires ${formatDateTime(preview.expiresAt, timezone)}. Loading the preview is recorded in the audit history.`
          : "Previews are issued on demand and are never stored as durable URLs in the browser."}
      </p>
    </>
  );
}
