"use client";

import { useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { screenshotErrorMessage } from "@/lib/screenshot-errors";
import type {
  ScreenshotPolicyDisclosure,
  ScreenshotPolicyDisclosureResponse,
} from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { ShieldIcon } from "./icons";
import { Alert, Button, Card, CardBody, CardHeader, LoadingBlock, cn } from "./ui";
import { useWorkspace } from "./workspace";

export function MonitoringDisclosure() {
  const { organization } = useWorkspace();
  const organizationId = organization?.id ?? "";

  const policy = useApi<ScreenshotPolicyDisclosureResponse>(
    (signal) =>
      apiRequest("/screenshot-policy", {
        signal,
        headers: { "X-Organization-Id": organizationId },
      }),
    [organizationId],
    { enabled: Boolean(organizationId) },
  );

  const [acknowledgedKey, setAcknowledgedKey] = useState<string | null>(null);
  const [confirmedKey, setConfirmedKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value: ScreenshotPolicyDisclosure | undefined = policy.data?.data.policy;
  if (!organization || !value) {
    if (policy.loading) {
      return (
        <Card>
          <LoadingBlock label="Checking monitoring disclosure" rows={2} />
        </Card>
      );
    }
    return null;
  }

  const disclosureKey = `${organization.id}:${value.disclosure.version}`;
  const acknowledged = value.disclosure.acknowledged || acknowledgedKey === disclosureKey;
  const confirmed = confirmedKey === disclosureKey;
  const acknowledgmentRequired = value.disclosure.acknowledgementRequired;

  if (!value.enabled) {
    return (
      <Card>
        <CardBody className="flex items-start gap-3">
          <ShieldIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
          <div>
            <p className="text-sm font-semibold text-ink">Screen monitoring is disabled</p>
            <p className="mt-1 text-xs leading-5 text-muted">
              This organization&apos;s policy does not permit screenshot requests. No screen capture
              can be requested for you.
            </p>
          </div>
        </CardBody>
      </Card>
    );
  }

  async function acknowledge() {
    if (!confirmed || saving || acknowledged) return;
    setSaving(true);
    setError(null);
    try {
      await apiRequest<ScreenshotPolicyDisclosureResponse>("/screenshot-policy/acknowledge", {
        method: "POST",
        headers: { "X-Organization-Id": organizationId },
        body: {},
      });
      setAcknowledgedKey(disclosureKey);
      policy.reload();
    } catch (caught) {
      setError(screenshotErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Screen monitoring disclosure"
        description={`Organization policy · version ${value.disclosure.version}`}
        actions={
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium",
              acknowledged
                ? "border-line bg-surface-muted text-ink-secondary"
                : "border-warning/30 bg-warning/5 text-warning",
            )}
          >
            <ShieldIcon className="h-3.5 w-3.5" />
            {acknowledged ? "Acknowledged" : acknowledgmentRequired ? "Action required" : "Enabled"}
          </span>
        }
      />
      <CardBody className="space-y-4">
        <p className="whitespace-pre-wrap text-xs leading-6 text-ink-secondary">
          {value.disclosure.text}
        </p>
        <p className="text-[11px] leading-5 text-muted">
          Screenshots are captured only after an explicit administrator request while you have an
          active work session. Capture is visible in the desktop app, happens one request at a time,
          and is stored privately for {value.retentionDays} days. There is no periodic or hidden
          capture.
        </p>

        {acknowledgmentRequired && !acknowledged ? (
          <div className="space-y-3 rounded-lg border border-line bg-surface-muted p-4">
            <label className="flex cursor-pointer items-start gap-3 text-xs leading-5 text-ink-secondary">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-ink"
                checked={confirmed}
                onChange={(event) =>
                  setConfirmedKey(event.target.checked ? disclosureKey : null)
                }
              />
              <span>
                I have read this monitoring disclosure and understand that an authorized
                administrator may request an individual screenshot while I am in an active session.
              </span>
            </label>
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <Button
              type="button"
              size="sm"
              onClick={() => void acknowledge()}
              disabled={!confirmed || saving}
            >
              {saving ? "Recording acknowledgement…" : "Acknowledge disclosure"}
            </Button>
          </div>
        ) : acknowledged ? (
          <p className="text-[11px] text-success">
            {value.disclosure.acknowledgedAt
              ? `Acknowledged ${new Date(value.disclosure.acknowledgedAt).toLocaleString()}.`
              : "Your acknowledgement has been recorded."}
          </p>
        ) : (
          <p className="text-[11px] text-muted">
            Acknowledgement is not required by the current policy. The disclosure still applies.
          </p>
        )}

        {policy.error ? (
          <Alert tone="warning">
            The latest disclosure could not be refreshed. The policy shown may be out of date.
          </Alert>
        ) : null}
      </CardBody>
    </Card>
  );
}
