"use client";

import { useState } from "react";
import { errorMessage } from "@/lib/api-error";
import { formatDay } from "@/lib/format";
import {
  getGovernmentJurisdictions,
  importGovernmentHolidays,
  previewGovernmentHolidays,
} from "@/lib/holiday-api";
import { GOVERNMENT_HOLIDAY_CATEGORY_LABELS, holidayCategoryLabel } from "@/lib/holidays";
import type {
  GovernmentImportResult,
  GovernmentPreviewStatus,
} from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { Modal } from "./modal";
import {
  Alert,
  Badge,
  Button,
  Field,
  LoadingBlock,
  Select,
  TableShell,
  Td,
  Th,
  cn,
} from "./ui";

const STATUS_META: Record<
  GovernmentPreviewStatus,
  { label: string; tone: "success" | "neutral" | "warning" }
> = {
  AVAILABLE: { label: "New", tone: "success" },
  IMPORTED: { label: "Imported", tone: "neutral" },
  DUPLICATE_NAME: { label: "Already exists", tone: "warning" },
};

export function GovernmentHolidayImport({
  organizationId,
  initialCountry,
  initialRegion,
  initialYear,
  onClose,
  onImported,
}: {
  organizationId: string;
  initialCountry: string;
  initialRegion: string;
  initialYear: number;
  onClose: () => void;
  onImported: () => void;
}) {
  const [country, setCountry] = useState(initialCountry || "IN");
  const [region, setRegion] = useState(initialRegion || "NATIONAL");
  const [year, setYear] = useState(initialYear);
  const [selection, setSelection] = useState<{ key: string; ids: string[] }>({
    key: "",
    ids: [],
  });
  const [confirmedKey, setConfirmedKey] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [result, setResult] = useState<GovernmentImportResult | null>(null);

  const jurisdictions = useApi(
    (signal) => getGovernmentJurisdictions(organizationId, { signal }),
    [organizationId],
  );

  const countries = jurisdictions.data?.data.countries ?? [];
  const activeCountry = countries.find((entry) => entry.code === country) ?? countries[0];
  const regions = activeCountry?.regions ?? [];
  const activeRegion = regions.find((entry) => entry.code === region) ?? regions[0];
  const years = activeRegion?.years ?? [];
  const activeYear = years.find((entry) => entry.year === year) ?? years[0];
  const previewCountry = activeCountry?.code ?? "";
  const previewRegion = activeRegion?.code ?? "";
  const previewYear = activeYear?.year ?? year;

  const preview = useApi(
    (signal) =>
      previewGovernmentHolidays(
        organizationId,
        { country: previewCountry, region: previewRegion, year: previewYear },
        { signal },
      ),
    [organizationId, previewCountry, previewRegion, previewYear],
    {
      enabled: Boolean(
        activeCountry && activeRegion && years.length > 0 && Number.isInteger(previewYear),
      ),
    },
  );

  const previewData = preview.data?.data;
  const previewKey = previewData
    ? `${previewData.country}:${previewData.region}:${previewData.year}`
    : "";

  const availableEntries =
    previewData?.entries.filter((entry) => entry.status === "AVAILABLE") ?? [];
  const defaultSelection = availableEntries.map((entry) => entry.sourceId);
  const selected = selection.key === previewKey ? selection.ids : defaultSelection;
  const confirmed = previewKey !== "" && confirmedKey === previewKey;
  const selectedSet = new Set(selected);
  const allSelected =
    availableEntries.length > 0 &&
    availableEntries.every((entry) => selectedSet.has(entry.sourceId));

  function changeCountry(next: string) {
    setCountry(next);
    setResult(null);
    setImportError(null);
  }

  function changeRegion(next: string) {
    setRegion(next);
    setResult(null);
    setImportError(null);
  }

  function changeYear(next: number) {
    setYear(next);
    setResult(null);
    setImportError(null);
  }

  function toggleEntry(sourceId: string) {
    setSelection({
      key: previewKey,
      ids: selected.includes(sourceId)
        ? selected.filter((value) => value !== sourceId)
        : [...selected, sourceId],
    });
  }

  function toggleAll() {
    setSelection({ key: previewKey, ids: allSelected ? [] : defaultSelection });
  }

  async function submit() {
    if (!previewData?.available || selected.length === 0 || !confirmed) return;
    setImporting(true);
    setImportError(null);
    try {
      const response = await importGovernmentHolidays(organizationId, {
        country: previewData.country,
        region: previewData.region,
        year: previewData.year,
        sourceIds: selected,
      });
      setResult(response.data);
      setSelection({ key: "", ids: [] });
      setConfirmedKey("");
      onImported();
    } catch (error) {
      setImportError(errorMessage(error));
    } finally {
      setImporting(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Import government holidays"
      description="Review verified government holidays before adding them to the organization calendar. Imports stay drafts until you publish them."
      size="lg"
      dismissible={!importing}
      footer={
        result ? (
          <Button onClick={onClose}>Close</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={importing}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              loading={importing}
              disabled={!previewData?.available || selected.length === 0 || !confirmed}
            >
              {selected.length === 1
                ? "Import 1 holiday"
                : `Import ${selected.length} holidays`}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        {result ? (
          <ImportResult result={result} />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Country" htmlFor="government-country">
                <Select
                  id="government-country"
                  value={activeCountry?.code ?? country}
                  disabled={jurisdictions.loading || countries.length === 0}
                  onChange={(event) => changeCountry(event.target.value)}
                >
                  {countries.map((entry) => (
                    <option key={entry.code} value={entry.code}>
                      {entry.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="State or region" htmlFor="government-region">
                <Select
                  id="government-region"
                  value={activeRegion?.code ?? ""}
                  disabled={regions.length === 0}
                  onChange={(event) => changeRegion(event.target.value)}
                >
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
                  years.length > 0
                    ? `Verified years: ${years.map((entry) => entry.year).join(", ")}`
                    : "No verified notification is in the catalog for this selection."
                }
              >
                <Select
                  id="government-year"
                  value={activeYear?.year ?? year}
                  disabled={years.length === 0}
                  onChange={(event) => changeYear(Number(event.target.value))}
                >
                  {years.map((entry) => (
                    <option key={entry.year} value={entry.year}>
                      {entry.year}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            {jurisdictions.error ? (
              <Alert tone="danger" title="Could not load the government catalog">
                {jurisdictions.error}
              </Alert>
            ) : null}

            {jurisdictions.loading ? (
              <LoadingBlock label="Loading government holiday sources" rows={3} />
            ) : years.length === 0 ? (
              <Alert tone="warning" title="No verified government data available">
                TempoNest only imports holidays from verified official notifications. Nothing is shown for
                this jurisdiction, so no dates are guessed.
              </Alert>
            ) : preview.error ? (
              <Alert tone="danger" title="Could not load the holiday preview">
                {preview.error}
              </Alert>
            ) : preview.loading ? (
              <LoadingBlock label="Loading the verified holiday list" rows={4} />
            ) : !previewData ? (
              <Alert tone="info">Choose a jurisdiction and year to preview the verified holiday list.</Alert>
            ) : !previewData.available ? (
              <Alert tone="warning" title="Verified data is not available">
                {previewData.message ?? "No verified government notification is available for this year."}
              </Alert>
            ) : (
              <>
                {previewData.source ? (
                  <div className="rounded-lg border border-line bg-surface-muted p-3">
                    <p className="text-xs font-semibold text-ink">{previewData.source.name}</p>
                    <p className="mt-1 text-[11px] leading-5 text-muted">
                      {previewData.source.issuer} · {previewData.source.reference}
                    </p>
                    <p className="mt-1 text-[11px] leading-5 text-muted">
                      Retrieved {previewData.source.retrievedOn}.{" "}
                      <a
                        href={previewData.source.url}
                        target="_blank"
                        rel="noreferrer"
                        className="underline underline-offset-2"
                      >
                        Open the official notification
                      </a>
                    </p>
                    <p className="mt-1 text-[11px] leading-5 text-muted">
                      {previewData.source.verification}
                    </p>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-muted">
                    {previewData.counts.total} listed · {previewData.counts.available} new ·{" "}
                    {previewData.counts.imported} already imported · {previewData.counts.duplicates} already
                    on the calendar
                  </p>
                  <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-ink-secondary">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      disabled={availableEntries.length === 0}
                      className="h-3.5 w-3.5 rounded border-line-strong"
                    />
                    Select all new
                  </label>
                </div>

                {availableEntries.length === 0 ? (
                  <Alert tone="info" title="Everything is already on the calendar">
                    Every holiday in this list is already imported or matches an existing organization
                    holiday. No duplicates will be created.
                  </Alert>
                ) : (
                  <TableShell className="min-w-[520px]">
                    <thead>
                      <tr>
                        <Th className="w-8">
                          <span className="sr-only">Select</span>
                        </Th>
                        <Th>Date</Th>
                        <Th>Holiday</Th>
                        <Th>Category</Th>
                        <Th>Status</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewData.entries.map((entry) => {
                        const selectable = entry.status === "AVAILABLE";
                        const checked = selectedSet.has(entry.sourceId);
                        return (
                          <tr key={entry.sourceId} className={cn(!selectable && "opacity-60")}>
                            <Td>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={!selectable}
                                onChange={() => toggleEntry(entry.sourceId)}
                                aria-label={`Select ${entry.name}`}
                                className="h-3.5 w-3.5 rounded border-line-strong"
                              />
                            </Td>
                            <Td className="whitespace-nowrap text-xs">
                              {formatDay(entry.holidayDate, {
                                weekday: "short",
                                month: "short",
                                day: "numeric",
                              })}
                            </Td>
                            <Td>
                              <p className="text-xs font-medium text-ink">{entry.name}</p>
                              {entry.notes ? (
                                <p className="mt-0.5 text-[11px] text-muted">{entry.notes}</p>
                              ) : null}
                            </Td>
                            <Td>
                              <span className="text-xs">
                                {GOVERNMENT_HOLIDAY_CATEGORY_LABELS[entry.category]}
                              </span>
                            </Td>
                            <Td>
                              <Badge tone={STATUS_META[entry.status].tone}>
                                {STATUS_META[entry.status].label}
                              </Badge>
                            </Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </TableShell>
                )}

                <Alert tone="info" title="Imports do not affect attendance or leave yet">
                  Imported holidays are saved as drafts. Publish them from the holiday calendar to make them
                  apply to attendance and leave.
                </Alert>

                <label className="flex items-start gap-2 text-xs text-ink-secondary">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) =>
                      setConfirmedKey(event.target.checked ? previewKey : "")
                    }
                    className="mt-0.5 h-3.5 w-3.5 rounded border-line-strong"
                  />
                  <span>
                    I reviewed this list and confirm these holidays should be added to the organization
                    calendar as drafts. Existing company holidays will not be overwritten.
                  </span>
                </label>

                {importError ? <Alert tone="danger">{importError}</Alert> : null}
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function ImportResult({ result }: { result: GovernmentImportResult }) {
  return (
    <div className="space-y-3">
      <Alert tone="success" title="Government holidays imported">
        {result.imported.length === 0
          ? "No new holidays were added because every selection already existed on the calendar."
          : `${result.imported.length} holiday${result.imported.length === 1 ? "" : "s"} added as drafts for ${result.region}, ${result.year}. Publish them from the calendar when ready.`}
      </Alert>
      {result.imported.length > 0 ? (
        <div className="rounded-lg border border-line">
          {result.imported.map((holiday) => (
            <div
              key={holiday.id}
              className="flex items-center justify-between gap-3 border-b border-line px-3 py-2 last:border-0"
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-ink">{holiday.name}</p>
                <p className="text-[11px] text-muted">
                  {formatDay(holiday.holidayDate, { weekday: "short", month: "short", day: "numeric" })} ·{" "}
                  {holidayCategoryLabel(holiday.category)}
                </p>
              </div>
              <Badge tone="warning">Draft</Badge>
            </div>
          ))}
        </div>
      ) : null}
      {result.skipped.length > 0 ? (
        <div>
          <p className="text-xs font-semibold text-ink-secondary">Skipped</p>
          <ul className="mt-1 space-y-1 text-[11px] text-muted">
            {result.skipped.map((entry) => (
              <li key={entry.sourceId}>
                {entry.name} —{" "}
                {entry.reason === "ALREADY_IMPORTED"
                  ? "already imported"
                  : "a holiday with this name already exists on this date"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-[11px] leading-5 text-muted">
        Source: {result.source.name} · {result.source.reference}
      </p>
    </div>
  );
}
