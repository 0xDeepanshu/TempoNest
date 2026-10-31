"use client";

import Link from "next/link";
import { useState } from "react";
import { errorMessage } from "@/lib/api-error";
import { formatDateTime } from "@/lib/format";
import {
  getGovernmentJurisdictions,
  getHolidaySettings,
  updateHolidaySettings,
} from "@/lib/holiday-api";
import { workingDaysLabel } from "@/lib/leave";
import { hasPermission } from "@/lib/permissions";
import type { HolidaySettings, Organization } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { BuildingIcon, CalendarIcon, CheckSquareIcon } from "./icons";
import { GovernmentHolidayImport } from "./government-holiday-import";
import { LeaveTabs } from "./leave-tabs";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Select,
  cn,
} from "./ui";
import { NoOrganization, useWorkspace } from "./workspace";

const WEEKDAYS: Array<{ value: number; label: string; short: string }> = [
  { value: 1, label: "Monday", short: "Mon" },
  { value: 2, label: "Tuesday", short: "Tue" },
  { value: 3, label: "Wednesday", short: "Wed" },
  { value: 4, label: "Thursday", short: "Thu" },
  { value: 5, label: "Friday", short: "Fri" },
  { value: 6, label: "Saturday", short: "Sat" },
  { value: 7, label: "Sunday", short: "Sun" },
];

type SettingsForm = {
  enabled: boolean;
  optionalHolidaysEnabled: boolean;
  allowHalfDayHolidays: boolean;
  defaultCalendarYear: string;
  defaultApplicability: "ORGANIZATION" | "EMPLOYEES";
  workingDays: number[];
  governmentCountry: string;
  governmentRegion: string;
  governmentYear: string;
};

function formFromSettings(settings: HolidaySettings): SettingsForm {
  return {
    enabled: settings.enabled,
    optionalHolidaysEnabled: settings.optionalHolidaysEnabled,
    allowHalfDayHolidays: settings.allowHalfDayHolidays,
    defaultCalendarYear:
      settings.defaultCalendarYear === null ? "" : String(settings.defaultCalendarYear),
    defaultApplicability: settings.defaultApplicability,
    workingDays: [...settings.workingDays].sort((left, right) => left - right),
    governmentCountry: settings.governmentCountry || "IN",
    governmentRegion: settings.governmentRegion ?? "",
    governmentYear: settings.governmentYear === null ? "" : String(settings.governmentYear),
  };
}

export function HolidaySettingsView() {
  const { organization, membership } = useWorkspace();
  const organizationId = organization?.id ?? "";
  const canEdit = hasPermission(membership, "holiday:settings:manage");
  const [savedSettings, setSavedSettings] = useState<{
    organizationId: string;
    settings: HolidaySettings;
  } | null>(null);
  const settings = useApi(
    (signal) => getHolidaySettings(organizationId, { signal }),
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
          title="Holiday settings"
          description="Loading the organization holiday configuration."
        />
        <LeaveTabs current="holiday-settings" />
        <Card>
          <LoadingBlock label="Loading holiday settings" rows={4} />
        </Card>
      </div>
    );
  }

  if (settings.error && !current) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow={organization.name} title="Holiday settings" />
        <LeaveTabs current="holiday-settings" />
        <ErrorState message={settings.error} onRetry={settings.reload} />
      </div>
    );
  }

  if (!current) return null;

  return (
    <HolidaySettingsForm
      key={organization.id}
      organization={organization}
      settings={current}
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

function HolidaySettingsForm({
  organization,
  settings,
  canEdit,
  onSaved,
}: {
  organization: Organization;
  settings: HolidaySettings;
  canEdit: boolean;
  onSaved: (settings: HolidaySettings) => void;
}) {
  const [form, setForm] = useState<SettingsForm>(() => formFromSettings(settings));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importNotice, setImportNotice] = useState(false);

  const jurisdictions = useApi(
    (signal) => getGovernmentJurisdictions(organization.id, { signal }),
    [organization.id],
  );
  const countries = jurisdictions.data?.data.countries ?? [];
  const activeCountry = countries.find((entry) => entry.code === form.governmentCountry);
  const regions = activeCountry?.regions ?? [];
  const activeRegion = regions.find((entry) => entry.code === form.governmentRegion);
  const governmentYears = activeRegion?.years ?? [];
  const selectedGovernmentYear = governmentYears.find(
    (entry) => String(entry.year) === form.governmentYear,
  );

  function toggleWorkingDay(day: number) {
    setForm((current) => {
      const has = current.workingDays.includes(day);
      const workingDays = has
        ? current.workingDays.filter((value) => value !== day)
        : [...current.workingDays, day].sort((left, right) => left - right);
      return { ...current, workingDays };
    });
  }

  function validate(next: SettingsForm): string | null {
    if (next.workingDays.length === 0) {
      return "Select at least one working day.";
    }
    if (next.defaultCalendarYear.trim()) {
      const year = Number(next.defaultCalendarYear);
      if (!Number.isInteger(year) || year < 1900 || year > 2200) {
        return "Default calendar year must be a whole number between 1900 and 2200.";
      }
    }
    if (next.governmentYear.trim()) {
      const year = Number(next.governmentYear);
      if (!Number.isInteger(year) || year < 1900 || year > 2200) {
        return "Government calendar year must be a whole number between 1900 and 2200.";
      }
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
      const response = await updateHolidaySettings(organization.id, {
        enabled: form.enabled,
        optionalHolidaysEnabled: form.optionalHolidaysEnabled,
        allowHalfDayHolidays: form.allowHalfDayHolidays,
        defaultCalendarYear: form.defaultCalendarYear.trim()
          ? Number(form.defaultCalendarYear)
          : null,
        defaultApplicability: form.defaultApplicability,
        workingDays: [...form.workingDays].sort((left, right) => left - right),
        governmentCountry: form.governmentCountry || "IN",
        governmentRegion: form.governmentRegion || null,
        governmentYear: form.governmentYear.trim() ? Number(form.governmentYear) : null,
      });
      setForm(formFromSettings(response.data.settings));
      setSaved(true);
      setImportNotice(false);
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
        title="Holiday settings"
        description="Control how the organization holiday calendar behaves. These settings are shared by the admin calendar, employee portal, leave estimation, and attendance classification."
        actions={
          <Link
            href="/admin/leave/holidays"
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-xs font-medium text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink"
          >
            <CalendarIcon className="h-3.5 w-3.5" />
            Back to calendar
          </Link>
        }
      />

      <LeaveTabs current="holiday-settings" />

      {!canEdit ? (
        <Alert tone="warning" title="Read-only view">
          Your role can view holiday settings but cannot change them. Organization owners,
          administrators, and custom roles with holiday:settings:manage can edit this page.
        </Alert>
      ) : null}

      <Alert tone="info" title="Leave policies stay authoritative">
        Working days here describe the organization calendar used for holiday display and
        attendance classification. Each leave type continues to charge leave using its own
        policy working days, so existing leave policies are not changed.
      </Alert>

      <form onSubmit={save} noValidate className="space-y-5">
        <fieldset disabled={!canEdit || saving} className="space-y-5">
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
          {saved ? <Alert tone="success">Holiday settings saved.</Alert> : null}
          {importNotice ? (
            <Alert tone="success" title="Government holidays imported">
              The selected holidays were added to the calendar as drafts. Publish them from the{" "}
              <Link
                href="/admin/leave/holidays"
                className="font-medium underline underline-offset-2"
              >
                holiday calendar
              </Link>{" "}
              when they should affect attendance and leave.
            </Alert>
          ) : null}

          <Card>
            <CardHeader
              title="Calendar controls"
              description="Choose which holiday features are available and what new holidays default to."
            />
            <CardBody className="space-y-5">
              <div className="grid gap-3 lg:grid-cols-3">
                <ToggleRow
                  title="Enable holiday management"
                  description="When off, existing holidays remain visible but new holidays cannot be created, edited, duplicated, or deleted."
                  checked={form.enabled}
                  onChange={(enabled) => setForm({ ...form, enabled })}
                />
                <ToggleRow
                  title="Allow optional holidays"
                  description="Optional holidays appear on calendars as informational dates. They are not charged as leave and do not make a day a holiday for attendance."
                  checked={form.optionalHolidaysEnabled}
                  onChange={(optionalHolidaysEnabled) =>
                    setForm({ ...form, optionalHolidaysEnabled })
                  }
                />
                <ToggleRow
                  title="Allow half-day holidays"
                  description="Half-day holidays charge only the working half when an employee takes leave across that date."
                  checked={form.allowHalfDayHolidays}
                  onChange={(allowHalfDayHolidays) =>
                    setForm({ ...form, allowHalfDayHolidays })
                  }
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Default calendar year"
                  htmlFor="holiday-default-year"
                  hint="Optional. Leave blank to open the current year first."
                >
                  <Input
                    id="holiday-default-year"
                    type="number"
                    min={1900}
                    max={2200}
                    inputMode="numeric"
                    value={form.defaultCalendarYear}
                    onChange={(event) =>
                      setForm({ ...form, defaultCalendarYear: event.target.value })
                    }
                    placeholder="2026"
                  />
                </Field>
                <Field
                  label="Default applicability"
                  htmlFor="holiday-default-applicability"
                  hint="Used as the initial selection when adding a holiday."
                >
                  <Select
                    id="holiday-default-applicability"
                    value={form.defaultApplicability}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        defaultApplicability: event.target.value as SettingsForm["defaultApplicability"],
                      })
                    }
                  >
                    <option value="ORGANIZATION">Entire organization</option>
                    <option value="EMPLOYEES">Selected employees</option>
                  </Select>
                </Field>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Government holidays"
              description="Choose the jurisdiction used for verified government holiday imports. Imported dates come from official notifications and stay drafts until published."
              actions={
                canEdit ? (
                  <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
                    <BuildingIcon className="h-3.5 w-3.5" />
                    Import holidays
                  </Button>
                ) : undefined
              }
            />
            <CardBody className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field
                  label="Country"
                  htmlFor="government-country"
                  hint="Countries are added when a verified official source is available."
                >
                  <Select
                    id="government-country"
                    value={form.governmentCountry}
                    disabled={jurisdictions.loading || countries.length === 0}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        governmentCountry: event.target.value,
                        governmentRegion: "",
                        governmentYear: "",
                      })
                    }
                  >
                    {countries.length === 0 && form.governmentCountry ? (
                      <option value={form.governmentCountry}>{form.governmentCountry}</option>
                    ) : null}
                    {countries.map((entry) => (
                      <option key={entry.code} value={entry.code}>
                        {entry.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label="State or region"
                  htmlFor="government-region"
                  hint="National covers central government holidays."
                >
                  <Select
                    id="government-region"
                    value={form.governmentRegion}
                    disabled={regions.length === 0}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        governmentRegion: event.target.value,
                        governmentYear: "",
                      })
                    }
                  >
                    <option value="">Not configured</option>
                    {regions.map((entry) => (
                      <option key={entry.code} value={entry.code}>
                        {entry.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label="Calendar year"
                  htmlFor="government-year"
                  hint={
                    governmentYears.length > 0
                      ? `Verified years: ${governmentYears.map((entry) => entry.year).join(", ")}`
                      : "No verified notification for this jurisdiction yet."
                  }
                >
                  <Select
                    id="government-year"
                    value={form.governmentYear}
                    disabled={governmentYears.length === 0}
                    onChange={(event) =>
                      setForm({ ...form, governmentYear: event.target.value })
                    }
                  >
                    <option value="">Not configured</option>
                    {governmentYears.map((entry) => (
                      <option key={entry.year} value={entry.year}>
                        {entry.year}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              {jurisdictions.error ? (
                <Alert tone="danger">{jurisdictions.error}</Alert>
              ) : selectedGovernmentYear ? (
                <p className="text-xs leading-5 text-muted">
                  Verified source:{" "}
                  <span className="font-medium text-ink-secondary">
                    {selectedGovernmentYear.source.name}
                  </span>{" "}
                  — {selectedGovernmentYear.source.reference}. Retrieved{" "}
                  {selectedGovernmentYear.source.retrievedOn}.
                </p>
              ) : (
                <p className="text-xs leading-5 text-muted">
                  No verified government notification is attached to the selected year yet. TempoNest
                  does not invent holiday dates.
                </p>
              )}

              <Alert tone="info" title="Imports do not change attendance or leave until published">
                Imported holidays are saved as drafts. Review and publish the dates that should apply
                to employees from the holiday calendar.
              </Alert>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Weekly working days"
              description="Used to classify weekly offs in the holiday calendar and attendance day status."
              actions={
                <Badge tone="outline">{workingDaysLabel(form.workingDays)}</Badge>
              }
            />
            <CardBody className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                {WEEKDAYS.map((day) => {
                  const checked = form.workingDays.includes(day.value);
                  return (
                    <label
                      key={day.value}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition",
                        checked
                          ? "border-ink/30 bg-surface-muted text-ink"
                          : "border-line bg-surface text-muted hover:bg-surface-hover",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleWorkingDay(day.value)}
                        className="h-4 w-4 accent-ink"
                        aria-label={day.label}
                      />
                      <span className="font-medium">{day.short}</span>
                    </label>
                  );
                })}
              </div>
              <p className="flex items-start gap-2 text-xs leading-5 text-muted">
                <CheckSquareIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Weekends and other unselected days are treated as weekly offs. Holidays can still
                be added on non-working days for informational purposes.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Last change"
              description={
                settings.updatedBy
                  ? `Updated by ${settings.updatedBy.name} on ${formatDateTime(settings.updatedAt, organization.timezone)}`
                  : "No holiday settings changes have been recorded yet."
              }
            />
          </Card>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" loading={saving} disabled={!canEdit}>
              Save holiday settings
            </Button>
            <span className="text-xs text-muted">
              Changes are audited and apply to future holiday and attendance calculations.
            </span>
          </div>
        </fieldset>
      </form>

      {importOpen ? (
        <GovernmentHolidayImport
          organizationId={organization.id}
          initialCountry={form.governmentCountry || "IN"}
          initialRegion={form.governmentRegion || regions[0]?.code || "NATIONAL"}
          initialYear={
            form.governmentYear.trim()
              ? Number(form.governmentYear)
              : governmentYears[0]?.year ?? new Date().getFullYear()
          }
          onClose={() => setImportOpen(false)}
          onImported={() => setImportNotice(true)}
        />
      ) : null}
    </div>
  );
}
