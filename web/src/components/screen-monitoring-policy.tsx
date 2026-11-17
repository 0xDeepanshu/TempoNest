"use client";

import { useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { errorMessage } from "@/lib/api-error";
import { formatDateTime } from "@/lib/format";
import type {
  EmployeeMonitoringPolicy,
  EmployeeMonitoringPolicyResponse,
  MembershipSummary,
} from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { ConfirmDialog } from "./confirm-dialog";
import { Alert, Badge, Button, Card, CardBody, CardHeader } from "./ui";

/**
 * Per-employee screen monitoring switch.
 *
 * This is deliberately independent of roles and of the Administration access
 * card: a member can be an administrator and still have monitoring disabled.
 * The backend enforces the combination (organization policy AND employee
 * policy); this card only reflects and requests changes.
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

  const value: EmployeeMonitoringPolicy | undefined = policy.data?.data.policy;
  const enabled = value?.enabled ?? false;
  const canChange = actor.role === "OWNER";

  async function applyChange() {
    if (!value) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/admin/employees/${employeeId}/monitoring-policy`, {
        method: "PATCH",
        headers: { "X-Organization-Id": organizationId },
        body: { enabled: !enabled },
      });
      setConfirmOpen(false);
      setNotice(
        enabled
          ? "Screen monitoring disabled for this employee."
          : "Screen monitoring enabled for this employee.",
      );
      policy.reload();
    } catch (caught) {
      setError(errorMessage(caught));
      setConfirmOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Screen Monitoring Policy"
        description="Control whether authorized administrators can access this employee's live screen and screenshots."
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
                      ? "Authorized administrators can request screenshots and view the live screen when the employee is eligible."
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
                  Only an organization owner can change this policy.
                </p>
              )}
            </div>

            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
              <span>
                Effective monitoring:{" "}
                <span className="font-medium text-ink">
                  {value.effectiveEnabled ? "On" : "Off"}
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
        onConfirm={() => void applyChange()}
        onClose={() => {
          if (!busy) setConfirmOpen(false);
        }}
      >
        <p className="text-[13px] leading-6 text-ink-secondary">
          {enabled
            ? "Live screen sessions for this employee will be terminated and pending screenshot requests cancelled. Existing screenshots and audit records are not deleted."
            : "Authorized administrators will be able to request screenshots and view the live screen when the employee meets the eligibility rules and the organization policy is enabled."}
        </p>
        <p className="text-xs leading-5 text-muted">
          This change is recorded in the organization audit trail.
        </p>
      </ConfirmDialog>
    </Card>
  );
}
