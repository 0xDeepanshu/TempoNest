"use client";

import { useState } from "react";
import { getTrackingSettings, updateTrackingSettings } from "@/lib/activity-api";
import { errorMessage } from "@/lib/api-error";
import { formatDateTime } from "@/lib/format";
import { hasPermission } from "@/lib/permissions";
import type { Organization, TrackingSettings } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { InfoIcon, MonitorIcon, ShieldIcon } from "./icons";
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
  cn,
} from "./ui";
import { NoOrganization, useWorkspace } from "./workspace";

type SettingsForm = {
  appTrackingEnabled: boolean;
  idleDetectionEnabled: boolean;
  idleThresholdMinutes: string;
  productivityClassificationEnabled: boolean;
  activityRetentionDays: string;
};

function formFromSettings(settings: TrackingSettings): SettingsForm {
  return {
    appTrackingEnabled: settings.appTrackingEnabled,
    idleDetectionEnabled: settings.idleDetectionEnabled,
    idleThresholdMinutes: String(settings.idleThresholdMinutes),
    productivityClassificationEnabled: settings.productivityClassificationEnabled,
    activityRetentionDays: String(settings.activityRetentionDays),
  };
}

export function ActivitySettingsView({ embedded = false }: { embedded?: boolean } = {}) {
  const { organization, membership } = useWorkspace();
  const organizationId = organization?.id ?? "";
  const canEdit = hasPermission(membership, "activity:policy");
  const [savedSettings, setSavedSettings] = useState<{
    organizationId: string;
    settings: TrackingSettings;
  } | null>(null);
  const settings = useApi(
    (signal) => getTrackingSettings(organizationId, { signal }),
    [organizationId],
    { enabled: Boolean(organizationId) },
  );

  if (!organization) return <NoOrganization />;

  const current =
    (savedSettings?.organizationId === organizationId ? savedSettings.settings : null) ??
    settings.data?.data.settings;

  if (settings.loading && !current) {
    return (
      <div className="space-y-5">
        {embedded ? null : (
          <PageHeader
            eyebrow={organization.name}
            title="App tracking"
            description="Loading app tracking rules."
          />
        )}
        <Card>
          <LoadingBlock label="Loading app tracking rules" rows={4} />
        </Card>
      </div>
    );
  }

  if (settings.error && !current) {
    return (
      <div className="space-y-5">
        {embedded ? null : (
          <PageHeader eyebrow={organization.name} title="App tracking" />
        )}
        <ErrorState message={settings.error} onRetry={settings.reload} />
      </div>
    );
  }

  if (!current) return null;

  return (
    <ActivitySettingsForm
      key={organization.id}
      settings={current}
      organization={organization}
      canEdit={canEdit}
      embedded={embedded}
      onSaved={(next) => setSavedSettings({ organizationId, settings: next })}
    />
  );
}

function ToggleRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition",
        checked ? "border-ink/30 bg-surface-muted" : "border-line bg-surface",
      )}
    >
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 accent-ink"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <span className="block text-sm font-semibold text-ink">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-muted">{description}</span>
      </span>
    </label>
  );
}

function ActivitySettingsForm({
  settings,
  organization,
  canEdit,
  embedded = false,
  onSaved,
}: {
  settings: TrackingSettings;
  organization: Organization;
  canEdit: boolean;
  embedded?: boolean;
  onSaved: (settings: TrackingSettings) => void;
}) {
  const [form, setForm] = useState<SettingsForm>(() => formFromSettings(settings));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function validate(next: SettingsForm): string | null {
    const threshold = Number(next.idleThresholdMinutes);
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > 120) {
      return "Idle time must be between 1 and 120 minutes.";
    }
    const retention = Number(next.activityRetentionDays);
    if (!Number.isInteger(retention) || retention < 7 || retention > 3650) {
      return "Activity history must be kept between 7 and 3650 days.";
    }
    return null;
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving || !canEdit) return;
    setFormError(null);
    setSaved(false);
    const validation = validate(form);
    if (validation) {
      setFormError(validation);
      return;
    }

    setSaving(true);
    try {
      const response = await updateTrackingSettings(organization.id, {
        appTrackingEnabled: form.appTrackingEnabled,
        idleDetectionEnabled: form.idleDetectionEnabled,
        idleThresholdMinutes: Number(form.idleThresholdMinutes),
        productivityClassificationEnabled: form.productivityClassificationEnabled,
        activityRetentionDays: Number(form.activityRetentionDays),
      });
      setForm(formFromSettings(response.data.settings));
      setSaved(true);
      onSaved(response.data.settings);
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  const statusBadge = (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1 text-[11px] font-medium text-ink-secondary">
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          form.appTrackingEnabled ? "bg-success" : "bg-muted",
        )}
        aria-hidden
      />
      <MonitorIcon className="h-3.5 w-3.5" />
      {form.appTrackingEnabled ? "App tracking on" : "App tracking off"}
    </span>
  );

  return (
    <div className="space-y-5">
      {embedded ? (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-ink">App tracking</h2>
            <p className="mt-0.5 max-w-3xl text-[13px] leading-5 text-muted">
              What the desktop agent records, when someone counts as idle, and how long the data
              is kept.
            </p>
          </div>
          {statusBadge}
        </div>
      ) : (
        <PageHeader
          eyebrow={`${organization.name} · ${organization.timezone}`}
          title="App tracking"
          description="What the desktop agent records, when someone counts as idle, and how long the data is kept."
          actions={statusBadge}
        />
      )}

      <Alert tone={form.appTrackingEnabled ? "info" : "warning"} title="App names and time only">
        The desktop agent records which app is in front and for how long, plus idle time once the
        threshold is reached. It never records keystrokes, clipboard contents, screenshots, browser
        history, full window titles, or mouse content.
      </Alert>

      {!canEdit ? (
        <Alert tone="warning" title="Read-only view">
          You can see these rules but cannot change them. Ask an owner or administrator.
        </Alert>
      ) : null}

      <form onSubmit={save} noValidate className="space-y-5">
        <fieldset disabled={!canEdit || saving} className="space-y-5">
          <Card>
            <CardHeader
              title="What the agent records"
              description="These rules apply to everyone in the organization. There are no per-person overrides."
              actions={
                <span className="text-[11px] text-muted">
                  Version {settings.policyVersion}
                </span>
              }
            />
            <CardBody className="space-y-5">
              <ToggleRow
                title="Record app activity"
                description="When on, agents report which apps are used and for how long. When off, agents send nothing new."
                checked={form.appTrackingEnabled}
                onChange={(appTrackingEnabled) => setForm({ ...form, appTrackingEnabled })}
              />
              <ToggleRow
                title="Detect idle time"
                description="When on, agents report time without input so idle and active time can be told apart."
                checked={form.idleDetectionEnabled}
                onChange={(idleDetectionEnabled) =>
                  setForm({ ...form, idleDetectionEnabled })
                }
              />
              <ToggleRow
                title="Sort apps into categories"
                description="When on, reports group app time using your categories. Unknown apps stay Unclassified, never Unproductive."
                checked={form.productivityClassificationEnabled}
                onChange={(productivityClassificationEnabled) =>
                  setForm({ ...form, productivityClassificationEnabled })
                }
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Idle after (minutes)"
                  htmlFor="activity-idle-threshold"
                  hint="How long without input before time counts as idle. Allowed range: 1–120. Used when idle detection is on."
                >
                  <Input
                    id="activity-idle-threshold"
                    type="number"
                    min={1}
                    max={120}
                    step={1}
                    value={form.idleThresholdMinutes}
                    onChange={(event) =>
                      setForm({ ...form, idleThresholdMinutes: event.target.value })
                    }
                  />
                </Field>
                <Field
                  label="Keep activity for (days)"
                  htmlFor="activity-retention"
                  hint="Older app activity and idle time are deleted. Allowed range: 7–3650. Categories are never deleted."
                >
                  <Input
                    id="activity-retention"
                    type="number"
                    min={7}
                    max={3650}
                    step={1}
                    value={form.activityRetentionDays}
                    onChange={(event) =>
                      setForm({ ...form, activityRetentionDays: event.target.value })
                    }
                  />
                </Field>
              </div>

              <div className="rounded-lg border border-line bg-surface-muted p-4">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                  <ShieldIcon className="h-3.5 w-3.5" />
                  Turning a feature off never deletes history
                </p>
                <p className="mt-1 text-xs leading-5 text-muted">
                  Turning off app tracking, idle detection, or categories only stops new data for
                  that feature. Past data stays available for the retention period. Missing data
                  after a feature is off is not proof that someone was idle or unproductive.
                </p>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="What is recorded"
              description="Only what the reports and idle time need."
            />
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Recorded
                </p>
                <ul className="mt-2 space-y-1.5 text-xs leading-5 text-ink-secondary">
                  <li>Which app is in front, and its name</li>
                  <li>Platform and how long it was in front</li>
                  <li>Idle time after the threshold</li>
                </ul>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Never recorded
                </p>
                <ul className="mt-2 space-y-1.5 text-xs leading-5 text-ink-secondary">
                  <li>Keystrokes or mouse content</li>
                  <li>Clipboard data or screenshots</li>
                  <li>Browser history or page contents</li>
                  <li>Full window titles</li>
                </ul>
              </div>
            </CardBody>
          </Card>
        </fieldset>

        {formError ? (
          <Alert tone="danger" title="Not saved">
            {formError}
          </Alert>
        ) : null}
        {saved ? (
          <Alert tone="success" title="App tracking rules saved">
            Version {settings.policyVersion} applies to new activity immediately. Past data is
            unchanged.
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-[11px] text-muted">
            <InfoIcon className="h-3.5 w-3.5" />
            Last updated {formatDateTime(settings.policyUpdatedAt, organization.timezone)} · keeps{" "}
            {settings.activityRetentionDays} days
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setForm(formFromSettings(settings));
                setFormError(null);
                setSaved(false);
              }}
              disabled={saving || !canEdit}
            >
              Reset
            </Button>
            <Button type="submit" disabled={saving || !canEdit}>
              {saving ? "Saving…" : "Save app tracking rules"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
