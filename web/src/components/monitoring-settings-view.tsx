"use client";

import { useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { screenshotErrorMessage } from "@/lib/screenshot-errors";
import type {
  Organization,
  Role,
  ScreenshotPolicy,
  ScreenshotPolicyResponse,
} from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { ShieldIcon } from "./icons";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Textarea,
  cn,
} from "./ui";
import { NoOrganization, useWorkspace } from "./workspace";

const ROLES: Role[] = ["OWNER", "ADMIN", "MANAGER", "EMPLOYEE"];

type PolicyForm = {
  enabled: boolean;
  requestRoles: Role[];
  viewRoles: Role[];
  requestCooldownSeconds: string;
  retentionDays: string;
  auditRetentionDays: string;
  employeeAcknowledgementRequired: boolean;
  disclosureVersion: string;
  disclosureText: string;
};

function formFromPolicy(policy: ScreenshotPolicy): PolicyForm {
  return {
    enabled: policy.enabled,
    requestRoles: [...policy.requestRoles],
    viewRoles: [...policy.viewRoles],
    requestCooldownSeconds: String(policy.requestCooldownSeconds),
    retentionDays: String(policy.retentionDays),
    auditRetentionDays: String(policy.auditRetentionDays),
    employeeAcknowledgementRequired: policy.employeeAcknowledgementRequired,
    disclosureVersion: policy.disclosureVersion,
    disclosureText: policy.disclosureText,
  };
}

function toggleRole(roles: Role[], role: Role): Role[] {
  return roles.includes(role) ? roles.filter((item) => item !== role) : [...roles, role];
}

function RoleChecks({
  label,
  description,
  selected,
  onChange,
}: {
  label: string;
  description: string;
  selected: Role[];
  onChange: (roles: Role[]) => void;
}) {
  return (
    <fieldset>
      <legend className="text-xs font-semibold text-ink">{label}</legend>
      <p className="mt-0.5 text-[11px] leading-5 text-muted">{description}</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {ROLES.map((role) => (
          <label
            key={role}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition",
              selected.includes(role)
                ? "border-ink bg-surface-hover text-ink"
                : "border-line bg-surface text-ink-secondary hover:bg-surface-muted",
            )}
          >
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-ink"
              checked={selected.includes(role)}
              onChange={() => onChange(toggleRole(selected, role))}
            />
            {role.charAt(0) + role.slice(1).toLowerCase()}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function MonitoringSettingsView() {
  const { organization } = useWorkspace();
  const organizationId = organization?.id ?? "";
  const [savedPolicy, setSavedPolicy] = useState<{
    organizationId: string;
    policy: ScreenshotPolicy;
  } | null>(null);
  const policy = useApi<ScreenshotPolicyResponse>(
    (signal) =>
      apiRequest(`/admin/screenshot-policy`, {
        signal,
        headers: { "X-Organization-Id": organizationId },
      }),
    [organizationId],
    { enabled: Boolean(organizationId) },
  );

  if (!organization) return <NoOrganization />;

  const current =
    (savedPolicy?.organizationId === organizationId ? savedPolicy.policy : null) ??
    policy.data?.data.policy;

  if (policy.loading && !current) {
    return (
      <div className="space-y-5">
        <PageHeader
          eyebrow={organization.name}
          title="Monitoring settings"
          description="Loading the organization screenshot policy."
        />
        <Card>
          <LoadingBlock label="Loading monitoring policy" rows={4} />
        </Card>
      </div>
    );
  }

  if (policy.error && !current) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow={organization.name} title="Monitoring settings" />
        <ErrorState message={policy.error} onRetry={policy.reload} />
      </div>
    );
  }

  if (!current) return null;

  return (
    <MonitoringSettingsForm
      key={organization.id}
      policy={current}
      organization={organization}
      onSaved={(next) => setSavedPolicy({ organizationId, policy: next })}
    />
  );
}

function MonitoringSettingsForm({
  policy,
  organization,
  onSaved,
}: {
  policy: ScreenshotPolicy;
  organization: Organization;
  onSaved: (policy: ScreenshotPolicy) => void;
}) {
  const organizationId = organization.id;
  const [form, setForm] = useState<PolicyForm>(() => formFromPolicy(policy));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function validate(next: PolicyForm): string | null {
    const requestRoles = next.requestRoles;
    const viewRoles = next.viewRoles;
    if (requestRoles.length === 0) return "At least one role must be allowed to request screenshots.";
    if (viewRoles.length === 0) return "At least one role must be allowed to view screenshots.";
    if (requestRoles.some((role) => !viewRoles.includes(role))) {
      return "Every role allowed to request screenshots must also be allowed to view them.";
    }
    if (!next.disclosureVersion.trim()) return "A disclosure version is required.";
    if (!next.disclosureText.trim()) return "Disclosure text is required.";
    const cooldown = Number(next.requestCooldownSeconds);
    if (!Number.isInteger(cooldown) || cooldown < 0 || cooldown > 3600) {
      return "Request cooldown must be a whole number between 0 and 3600 seconds.";
    }
    const retention = Number(next.retentionDays);
    if (!Number.isInteger(retention) || retention < 1 || retention > 3650) {
      return "Screenshot retention must be between 1 and 3650 days.";
    }
    const auditRetention = Number(next.auditRetentionDays);
    if (!Number.isInteger(auditRetention) || auditRetention < 1 || auditRetention > 3650) {
      return "Audit retention must be between 1 and 3650 days.";
    }
    return null;
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!form || saving) return;
    setFormError(null);
    setSaved(false);
    const validation = validate(form);
    if (validation) {
      setFormError(validation);
      return;
    }

    setSaving(true);
    try {
      const response = await apiRequest<ScreenshotPolicyResponse>("/admin/screenshot-policy", {
        method: "PATCH",
        headers: { "X-Organization-Id": organizationId },
        body: {
          enabled: form.enabled,
          requestRoles: form.requestRoles,
          viewRoles: form.viewRoles,
          requestCooldownSeconds: Number(form.requestCooldownSeconds),
          retentionDays: Number(form.retentionDays),
          auditRetentionDays: Number(form.auditRetentionDays),
          employeeAcknowledgementRequired: form.employeeAcknowledgementRequired,
          disclosureVersion: form.disclosureVersion.trim(),
          disclosureText: form.disclosureText.trim(),
        },
      });
      setForm(formFromPolicy(response.data.policy));
      setSaved(true);
      onSaved(response.data.policy);
    } catch (error) {
      setFormError(screenshotErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  const enabled = form.enabled;
  const roleGap =
    form.requestRoles.some((role) => !form.viewRoles.includes(role)) ||
    form.requestRoles.length === 0 ||
    form.viewRoles.length === 0;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${organization.name} · ${organization.timezone}`}
        title="Monitoring settings"
        description="Control whether administrators may request an individual employee screenshot. Screenshots are disabled by default and are never captured on a timer or from application usage alone."
        actions={
          <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1 text-[11px] font-medium text-ink-secondary">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                enabled ? "bg-success" : "bg-muted",
              )}
              aria-hidden
            />
            <ShieldIcon className="h-3.5 w-3.5" />
            {enabled ? "Monitoring enabled" : "Monitoring disabled"}
          </span>
        }
      />

      <Alert tone={enabled ? "warning" : "info"} title="Explicit, visible capture only">
        {enabled
          ? "Enabling this policy allows authorized roles to request one screenshot at a time while an employee has an eligible active session. Employees see a disclosure in the desktop app, and access is audited. Existing screenshots remain private until retention cleanup."
          : "No screenshot request can be created while monitoring is disabled. Existing screenshots are retained according to the retention period and remain accessible only to permitted roles."}
      </Alert>

      <form onSubmit={save} className="space-y-5">
        <Card>
          <CardHeader
            title="Policy controls"
            description="Route permissions are necessary but not sufficient: a role must also appear in these lists."
          />
          <CardBody className="space-y-5">
            <label
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition",
                form.enabled
                  ? "border-ink/30 bg-surface-muted"
                  : "border-line bg-surface",
              )}
            >
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-ink"
                checked={form.enabled}
                onChange={(event) =>
                  setForm({ ...form, enabled: event.target.checked })
                }
              />
              <span>
                <span className="block text-sm font-semibold text-ink">
                  Allow administrator-requested screenshots
                </span>
                <span className="mt-1 block text-xs leading-5 text-muted">
                  When off, request creation, claim, upload, and access are blocked. Turning this on
                  does not create periodic capture or screen streaming.
                </span>
              </span>
            </label>

            <div className="grid gap-6 lg:grid-cols-2">
              <RoleChecks
                label="Roles allowed to request"
                description="The role must also have screenshot:request. OWNER and ADMIN have it by default."
                selected={form.requestRoles}
                onChange={(requestRoles) => setForm({ ...form, requestRoles })}
              />
              <RoleChecks
                label="Roles allowed to review"
                description="The role must also have screenshot:read. Managers have read permission but are excluded by the default policy."
                selected={form.viewRoles}
                onChange={(viewRoles) => setForm({ ...form, viewRoles })}
              />
            </div>

            {roleGap ? (
              <Alert tone="danger">
                Every role allowed to request must also be allowed to review, and both lists need at
                least one role.
              </Alert>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                label="Request cooldown (seconds)"
                htmlFor="monitor-cooldown"
                hint="Minimum gap between requests from the same administrator."
              >
                <Input
                  id="monitor-cooldown"
                  type="number"
                  min={0}
                  max={3600}
                  step={1}
                  value={form.requestCooldownSeconds}
                  onChange={(event) =>
                    setForm({ ...form, requestCooldownSeconds: event.target.value })
                  }
                />
              </Field>
              <Field
                label="Screenshot retention (days)"
                htmlFor="monitor-retention"
                hint="Private images are deleted after this period."
              >
                <Input
                  id="monitor-retention"
                  type="number"
                  min={1}
                  max={3650}
                  step={1}
                  value={form.retentionDays}
                  onChange={(event) =>
                    setForm({ ...form, retentionDays: event.target.value })
                  }
                />
              </Field>
              <Field
                label="Audit retention (days)"
                htmlFor="monitor-audit-retention"
                hint="Audit rows outlive the image so access remains reviewable."
              >
                <Input
                  id="monitor-audit-retention"
                  type="number"
                  min={1}
                  max={3650}
                  step={1}
                  value={form.auditRetentionDays}
                  onChange={(event) =>
                    setForm({ ...form, auditRetentionDays: event.target.value })
                  }
                />
              </Field>
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-surface p-4">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-ink"
                checked={form.employeeAcknowledgementRequired}
                onChange={(event) =>
                  setForm({
                    ...form,
                    employeeAcknowledgementRequired: event.target.checked,
                  })
                }
              />
              <span>
                <span className="block text-sm font-semibold text-ink">
                  Require employee acknowledgement
                </span>
                <span className="mt-1 block text-xs leading-5 text-muted">
                  Employees must acknowledge the current disclosure version in the web portal before
                  an administrator can request their screenshot.
                </span>
              </span>
            </label>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Employee disclosure"
            description="Shown in the web portal and desktop app. Update the version whenever the meaning of the policy changes."
          />
          <CardBody className="space-y-4">
            <Field label="Disclosure version" htmlFor="monitor-version" hint="Example: 2026-10-01">
              <Input
                id="monitor-version"
                value={form.disclosureVersion}
                maxLength={64}
                onChange={(event) =>
                  setForm({ ...form, disclosureVersion: event.target.value })
                }
              />
            </Field>
            <Field
              label="Disclosure text"
              htmlFor="monitor-disclosure"
              hint="Be specific about who can request a capture, when, and how it is stored."
            >
              <Textarea
                id="monitor-disclosure"
                value={form.disclosureText}
                maxLength={8000}
                rows={7}
                onChange={(event) =>
                  setForm({ ...form, disclosureText: event.target.value })
                }
              />
            </Field>
            <div className="rounded-lg border border-line bg-surface-muted p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                Employee preview · v{form.disclosureVersion || "—"}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-ink-secondary">
                {form.disclosureText || "No disclosure text has been entered."}
              </p>
            </div>
          </CardBody>
        </Card>

        {formError ? <Alert tone="danger" title="Settings not saved">{formError}</Alert> : null}
        {saved ? (
          <Alert tone="success" title="Monitoring settings saved">
            The updated policy applies to new requests immediately. Every change is recorded in the
            screenshot audit history.
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] text-muted">
            {policy.updatedAt
              ? `Policy last updated ${new Date(policy.updatedAt).toLocaleString()}.`
              : "This organization uses the default policy."}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setForm(formFromPolicy(policy));
                setFormError(null);
                setSaved(false);
              }}
              disabled={saving}
            >
              Reset
            </Button>
            <Button type="submit" disabled={saving || roleGap}>
              {saving ? "Saving…" : "Save monitoring settings"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
