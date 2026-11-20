"use client";

import { useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { errorMessage } from "@/lib/api-error";
import { formatDateTime } from "@/lib/format";
import { hasPermission } from "@/lib/permissions";
import type {
  EmployeeMonitoringPolicy,
  EmployeeMonitoringPolicyResponse,
  MembershipSummary,
} from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { ConfirmDialog } from "./confirm-dialog";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Select } from "./ui";

const CAPTURE_INTERVALS = [5, 10, 15, 20, 30, 45, 60] as const;
const NEVER = "never";

/**
 * Per-employee screen monitoring controls.
 *
 * This is deliberately independent of roles and of the Administration access
 * card: a member can be an administrator and still have monitoring disabled.
 * The backend enforces the combination (organization policy AND employee
 * policy); this card only reflects and requests changes.
 *
 * General monitoring (`enabled`) covers manual screenshot requests and live
 * screen viewing. Automatic periodic capture is a separate opt-in switch and
 * is represented as "Never" until an interval is chosen.
 */
export function ScreenMonitoringPolicyCard({
  organizationId,
  employeeId,
  actor,
  employeeName,
  timezone,
}: {
  organizationId: string;
  employeeId: string;
  actor: MembershipSummary;
  employeeName: string;
  timezone: string;
}) {
  const policy = useApi<EmployeeMonitoringPolicyResponse>(
    (signal) =>
      apiRequest(`/admin/employees/${employeeId}/monitoring-policy`, {
        signal,
        headers: { "X-Organization-Id": organizationId },
      }),
    [organizationId, employeeId],
    { enabled: Boolean(organizationId && employeeId) },
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The selected interval is shown optimistically while the PATCH is in
  // flight; `null` means "use the server value".
  const [intervalDraft, setIntervalDraft] = useState<number | null>(null);

  const value: EmployeeMonitoringPolicy | undefined = policy.data?.data.policy;
  const enabled = value?.enabled ?? false;
  const scheduledEnabled = value?.scheduledCaptureEnabled ?? false;
  const scheduledActive = scheduledEnabled && (value?.effectiveEnabled ?? false);
  const intervalMinutes = intervalDraft ?? value?.captureIntervalMinutes ?? 30;
  const canChange = hasPermission(actor, "screenshot:monitoring");

  async function applyChange(
    body: { enabled?: boolean; scheduledCaptureEnabled?: boolean; captureIntervalMinutes?: number },
    message: string,
  ): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/admin/employees/${employeeId}/monitoring-policy`, {
        method: "PATCH",
        headers: { "X-Organization-Id": organizationId },
        body,
      });
      setConfirmOpen(false);
      setNotice(message);
      policy.reload();
      return true;
    } catch (caught) {
      setError(errorMessage(caught));
      setConfirmOpen(false);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function toggleMonitoring() {
    if (enabled) {
      // The backend also turns the schedule off when general monitoring is
      // disabled, so the heading keeps both switches consistent.
      void applyChange({ enabled: false }, "Screen monitoring disabled for this employee.");
    } else {
      void applyChange({ enabled: true }, "Screen monitoring enabled for this employee.");
    }
  }

  function changeSchedule(next: string) {
    setError(null);
    setNotice(null);
    if (next === NEVER) {
      setIntervalDraft(null);
      void applyChange(
        { scheduledCaptureEnabled: false },
        "Scheduled screenshots turned off for this employee.",
      );
      return;
    }
    const minutes = Number(next);
    setIntervalDraft(minutes);
    void applyChange(
      { scheduledCaptureEnabled: true, captureIntervalMinutes: minutes },
      `Scheduled screenshots enabled every ${minutes} minutes.`,
    ).then((saved) => {
      if (!saved) setIntervalDraft(null);
    });
  }

  return (
    <Card>
      <CardHeader
        title="Screen monitoring"
        description="Control whether administrators can view this employee's live screen and request screenshots."
        actions={
          value ? (
            <Badge tone={enabled ? "success" : "neutral"}>
              {enabled ? "Enabled" : "Disabled"}
            </Badge>
          ) : null
        }
      />
      <CardBody>
        {policy.loading && !value ? (
          <p className="text-[13px] text-muted">Loading the employee monitoring policy…</p>
        ) : policy.error && !value ? (
          <Alert tone="danger" title="Monitoring policy unavailable">
            {policy.error}
          </Alert>
        ) : value ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-ink">
                  {enabled
                    ? "Monitoring is enabled for this employee."
                    : "Monitoring is disabled for this employee."}
                </p>
                <p className="mt-0.5 text-xs leading-5 text-muted">
                  {!value.organizationEnabled
                    ? "Organization-wide screenshot monitoring is off, so access stays disabled regardless of this setting."
                    : enabled
                      ? "Authorized administrators can request screenshots and view the live screen. Automatic periodic capture is configured separately below."
                      : "Live screen access and screenshot requests are blocked. Existing screenshots and audit records are kept."}
                </p>
              </div>
              {canChange ? (
                <Button
                  variant={enabled ? "secondary" : "primary"}
                  onClick={() => {
                    setError(null);
                    setConfirmOpen(true);
                  }}
                  disabled={busy}
                >
                  {enabled ? "Disable monitoring" : "Enable monitoring"}
                </Button>
              ) : (
                <p className="text-xs text-muted">
                  You cannot change this setting.
                </p>
              )}
            </div>

            <div className="mt-4 border-t border-line pt-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-ink">
                    Scheduled screenshots
                  </p>
                  <p className="mt-0.5 text-xs leading-5 text-muted">
                    {!enabled
                      ? "Enable monitoring before scheduling automatic screenshots."
                      : scheduledActive
                        ? `Captured automatically every ${intervalMinutes} minutes during eligible work sessions.`
                        : scheduledEnabled
                          ? "Scheduled capture is configured but inactive while organization-wide monitoring is off."
                          : "Never — no automatic screenshots are captured. Manual requests and live viewing still work while monitoring is enabled."}
                  </p>
                </div>
                <Badge tone={scheduledActive ? "success" : "neutral"}>
                  {scheduledActive
                    ? `Every ${intervalMinutes} min`
                    : scheduledEnabled
                      ? "Paused"
                      : "Never"}
                </Badge>
              </div>

              <div className="mt-3 flex flex-wrap items-end gap-4">
                <label className="flex flex-col gap-1 text-xs text-muted">
                  <span className="font-medium text-ink">Automatic capture</span>
                  <Select
                    value={scheduledEnabled ? String(intervalMinutes) : NEVER}
                    onChange={(event) => changeSchedule(event.target.value)}
                    disabled={!canChange || busy || !enabled}
                    aria-label="Scheduled screenshot capture interval"
                  >
                    <option value={NEVER}>Never</option>
                    {CAPTURE_INTERVALS.map((minutes) => (
                      <option key={minutes} value={minutes}>
                        Every {minutes} minutes
                      </option>
                    ))}
                  </Select>
                </label>
                <p className="pb-1 text-xs leading-5 text-muted">
                  {enabled
                    ? "Choosing an interval schedules the next capture from now. Selecting Never leaves manual capture and live viewing unaffected."
                    : "Scheduled capture requires monitoring to be enabled."}
                </p>
              </div>

              {scheduledActive ? (
                <Alert tone="warning" title="Automatic screenshots use extra resources" className="mt-3">
                  Each scheduled capture stores a screenshot object and database records, so frequent
                  intervals increase storage and database load. Captures follow this organization&apos;s
                  retention and disclosure settings.
                </Alert>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
                <span>
                  Effective monitoring:{" "}
                  <span className="font-medium text-ink">
                    {value.effectiveEnabled ? "On" : "Off"}
                  </span>
                </span>
                <span>
                  Last capture:{" "}
                  <span className="font-medium text-ink">
                    {value.lastCaptureAt
                      ? formatDateTime(value.lastCaptureAt, timezone)
                      : "None yet"}
                  </span>
                </span>
                <span>
                  Next scheduled capture:{" "}
                  <span className="font-medium text-ink">
                    {scheduledActive && value.nextCaptureAt
                      ? formatDateTime(value.nextCaptureAt, timezone)
                      : "Never"}
                  </span>
                </span>
                <span>
                  Last updated:{" "}
                  {value.updatedAt ? formatDateTime(value.updatedAt, timezone) : "Never"}
                </span>
                {value.updatedBy ? (
                  <span>
                    Updated by:{" "}
                    <span className="font-medium text-ink">{value.updatedBy.name}</span>
                  </span>
                ) : null}
              </div>
            </div>

            {notice ? (
              <p className="mt-3 text-xs font-medium text-success" role="status">
                {notice}
              </p>
            ) : null}
            {error ? (
              <div className="mt-3">
                <Alert tone="danger">{error}</Alert>
              </div>
            ) : null}
          </>
        ) : null}
      </CardBody>

      <ConfirmDialog
        open={confirmOpen}
        title={enabled ? "Disable screen monitoring?" : "Enable screen monitoring?"}
        description={employeeName}
        confirmLabel={enabled ? "Disable monitoring" : "Enable monitoring"}
        tone={enabled ? "danger" : "primary"}
        busy={busy}
        error={error}
        onConfirm={toggleMonitoring}
        onClose={() => {
          if (!busy) setConfirmOpen(false);
        }}
      >
        <p className="text-[13px] leading-6 text-ink-secondary">
          {enabled
            ? "Live screen sessions for this employee will be terminated and pending screenshot requests cancelled. Scheduled capture will also be turned off. Existing screenshots and audit records are not deleted."
            : "Authorized administrators will be able to request screenshots and view the live screen when the organization policy is enabled. Automatic periodic capture stays off until you choose an interval."}
        </p>
        <p className="text-xs leading-5 text-muted">
          This change is recorded in the organization audit trail.
        </p>
      </ConfirmDialog>
    </Card>
  );
}
