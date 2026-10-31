"use client";

import { useState } from "react";
import { getTrackingSettings, updateTrackingSettings } from "@/lib/activity-api";
import { errorMessage } from "@/lib/api-error";
import { formatDateTime } from "@/lib/format";
import { hasPermission } from "@/lib/permissions";
import type { Organization, TrackingSettings } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { ActivityTabs } from "./activity-tabs";
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

export function ActivitySettingsView() {
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
        <PageHeader
          eyebrow={organization.name}
          title="App tracking"
          description="Loading the organization application tracking policy."
        />
        <ActivityTabs current="settings" />
        <Card>
          <LoadingBlock label="Loading tracking settings" rows={4} />
        </Card>
      </div>
    );
  }

  if (settings.error && !current) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow={organization.name} title="App tracking" />
        <ActivityTabs current="settings" />
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
  onSaved,
}: {
  settings: TrackingSettings;
  organization: Organization;
  canEdit: boolean;
  onSaved: (settings: TrackingSettings) => void;
}) {
  const [form, setForm] = useState<SettingsForm>(() => formFromSettings(settings));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function validate(next: SettingsForm): string | null {
    const threshold = Number(next.idleThresholdMinutes);
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > 120) {
      return "Idle threshold must be a whole number between 1 and 120 minutes.";
    }
    const retention = Number(next.activityRetentionDays);
    if (!Number.isInteger(retention) || retention < 7 || retention > 3650) {
      return "Activity retention must be a whole number between 7 and 3650 days.";
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

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${organization.name} · ${organization.timezone}`}
        title="App tracking"
        description="Control foreground application metadata, operating-system idle detection, and productivity classification for desktop agents in this organization."
        actions={
          <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1 text-[11px] font-medium text-ink-secondary">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                form.appTrackingEnabled ? "bg-success" : "bg-muted",
              )}
              aria-hidden
            />
            <MonitorIcon className="h-3.5 w-3.5" />
            {form.appTrackingEnabled ? "App tracking enabled" : "App tracking disabled"}
          </span>
        }
      />

      <ActivityTabs current="settings" />

      <Alert tone={form.appTrackingEnabled ? "info" : "warning"} title="Foreground metadata only">
        The desktop agent records which application is in the foreground and for how long, plus
        operating-system idle intervals once the threshold is reached. It does not collect
        keystrokes, clipboard contents, screenshots, browser URL history, full window titles, or
        pointer content.
      </Alert>

      {!canEdit ? (
        <Alert tone="warning" title="Read-only view">
          Your role can view the tracking policy but cannot change it. Organization owners and
          administrators can edit these settings.
        </Alert>
      ) : null}

      <form onSubmit={save} noValidate className="space-y-5">
        <fieldset disabled={!canEdit || saving} className="space-y-5">
          <Card>
            <CardHeader
              title="Collection controls"
              description="These settings apply to every desktop agent in the organization. Employee-level overrides are not supported."
              actions={
                <span className="text-[11px] text-muted">
                  Policy v{settings.policyVersion}
                </span>
              }
            />
            <CardBody className="space-y-5">
              <ToggleRow
                title="Allow application tracking"
                description="When on, agents report foreground application identifiers, names, and observed intervals. When off, agents stop sending new application events."
                checked={form.appTrackingEnabled}
                onChange={(appTrackingEnabled) => setForm({ ...form, appTrackingEnabled })}
              />
              <ToggleRow
                title="Detect idle time"
                description="When on, agents report operating-system inactivity intervals so idle time can be separated from active time. When off, agents stop sending new idle intervals."
                checked={form.idleDetectionEnabled}
                onChange={(idleDetectionEnabled) =>
                  setForm({ ...form, idleDetectionEnabled })
                }
              />
              <ToggleRow
                title="Classify applications by productivity"
                description="When on, reports group application time using the organization's current classification catalog. Unknown applications count as Unclassified, never Unproductive."
                checked={form.productivityClassificationEnabled}
                onChange={(productivityClassificationEnabled) =>
                  setForm({ ...form, productivityClassificationEnabled })
                }
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Idle threshold (minutes)"
                  htmlFor="activity-idle-threshold"
                  hint="Minimum OS inactivity before an interval counts as idle. Allowed range: 1–120. Used when idle detection is on."
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
                  label="Raw activity retention (days)"
                  htmlFor="activity-retention"
                  hint="Activity events and idle intervals older than this are deleted. Allowed range: 7–3650. Classifications are not deleted."
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
                  Disabling a feature never deletes historical data
                </p>
                <p className="mt-1 text-xs leading-5 text-muted">
                  Turning off application tracking, idle detection, or classification only stops
                  new collection for that feature. Existing activity, idle intervals, and
                  classifications remain available according to the retention period. Missing
                  data after a feature is disabled is not evidence that an employee was idle or
                  unproductive.
                </p>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="What the desktop agent does and does not collect"
              description="Collected data is limited to what report categories and idle time require."
            />
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Collected
                </p>
                <ul className="mt-2 space-y-1.5 text-xs leading-5 text-ink-secondary">
                  <li>Foreground application identifier and display name</li>
                  <li>Platform label and observed foreground interval</li>
                  <li>Operating-system idle intervals after the threshold</li>
                </ul>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Not collected
                </p>
                <ul className="mt-2 space-y-1.5 text-xs leading-5 text-ink-secondary">
                  <li>Keystrokes or pointer content</li>
                  <li>Clipboard data or screenshots</li>
                  <li>Browser URL history or page contents</li>
                  <li>Full window titles</li>
                </ul>
              </div>
            </CardBody>
          </Card>
        </fieldset>

        {formError ? (
          <Alert tone="danger" title="Settings not saved">
            {formError}
          </Alert>
        ) : null}
        {saved ? (
          <Alert tone="success" title="Tracking settings saved">
            Policy v{settings.policyVersion} applies to new agent activity immediately. Historical
            data is unchanged.
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-[11px] text-muted">
            <InfoIcon className="h-3.5 w-3.5" />
            Policy last updated {formatDateTime(settings.policyUpdatedAt, organization.timezone)} ·
            retention {settings.activityRetentionDays} days
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
              {saving ? "Saving…" : "Save tracking settings"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
