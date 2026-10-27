"use client";

import dynamic from "next/dynamic";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { apiRequest } from "@/lib/api-client";
import { errorMessage } from "@/lib/api-error";
import { privateEvidenceImageUrl } from "@/lib/attendance-evidence";
import { hasPermission } from "@/lib/permissions";
import {
  formatCoordinate,
  googleMapsUrl,
  hasValidCoordinates,
} from "@/lib/attendance-location";
import {
  addDays,
  daysBetween,
  formatDate,
  formatDateRange,
  formatDateTime,
  formatDay,
  formatDuration,
  formatTime,
  formatTimeRange,
  todayInTimeZone,
} from "@/lib/format";
import type {
  AttendanceCheckIn,
  AttendanceCheckInsResponse,
  AttendanceEvidence,
  AttendanceEvidenceAccessResponse,
  AttendanceWorkMode,
  Organization,
} from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { ClockIcon, CloseIcon, MapPinIcon, RefreshIcon } from "./icons";
import { EmployeePicker } from "./employee-picker";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  DetailRow,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Pagination,
  Select,
  StatusBadge,
} from "./ui";
import { NoOrganization, useWorkspace } from "./workspace";
import { AttendanceLocationHistorySection } from "./attendance-location-history";

const AttendanceLocationMap = dynamic(
  () =>
    import("./attendance-location-map").then(
      (module) => module.AttendanceLocationMap,
    ),
  {
    ssr: false,
    loading: () => (
      <div
        className="h-72 w-full animate-pulse rounded-lg bg-surface-hover"
        aria-label="Loading location map"
      />
    ),
  },
);

const WORK_MODE_LABELS: Record<AttendanceWorkMode, string> = {
  WFO: "Work from office",
  WFH: "Work from home",
  ON_SITE: "On site",
};

const WORK_MODE_SHORT_LABELS: Record<AttendanceWorkMode, string> = {
  WFO: "WFO",
  WFH: "WFH",
  ON_SITE: "On site",
};

const ROW_COLUMNS =
  "xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(0,0.9fr)_7rem]";

const PAGE_SIZE = 20;
const DEFAULT_RANGE_DAYS = 30;

type EvidencePreview =
  | { status: "loading" }
  | { status: "ready"; url: string; expiresAt: string }
  | { status: "error"; message: string };

function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function workModeTone(mode: AttendanceWorkMode): "neutral" | "outline" {
  return mode === "WFH" ? "outline" : "neutral";
}

function WorkModeBadge({
  mode,
  short = false,
}: {
  mode: AttendanceWorkMode;
  short?: boolean;
}) {
  return (
    <span title={WORK_MODE_LABELS[mode]} className="inline-flex">
      <Badge tone={workModeTone(mode)}>
        {short ? WORK_MODE_SHORT_LABELS[mode] : WORK_MODE_LABELS[mode]}
      </Badge>
    </span>
  );
}

function attendanceState(checkIn: AttendanceCheckIn): {
  label: string;
  tone: "success" | "warning" | "neutral";
} {
  if (checkIn.session?.status === "ACTIVE") {
    return { label: "Working", tone: "success" };
  }
  if (checkIn.session?.status === "ON_BREAK") {
    return { label: "On break", tone: "warning" };
  }
  if (checkIn.session?.status === "STOPPED") {
    return { label: "Completed", tone: "neutral" };
  }
  return { label: "Unknown", tone: "neutral" };
}

function emailFor(checkIn: AttendanceCheckIn): string {
  return checkIn.employee?.email ?? "";
}

function defaultRange(timezone: string): { from: string; to: string } {
  const to = todayInTimeZone(timezone);
  return { from: addDays(to, -(DEFAULT_RANGE_DAYS - 1)), to };
}

export function AttendanceEvidenceView() {
  const { organization, membership } = useWorkspace();
  if (!organization) return <NoOrganization />;

  // Remounting on an organization or timezone change resets the filters without
  // synchronously setting state from an effect.
  return (
    <AttendanceEvidenceContent
      key={`${organization.id}:${organization.timezone}`}
      organization={organization}
      canViewLocationHistory={hasPermission(
        membership?.role,
        "attendance:location:read",
      )}
    />
  );
}

function AttendanceEvidenceContent({
  organization,
  canViewLocationHistory,
}: {
  organization: Organization;
  canViewLocationHistory: boolean;
}) {
  const organizationId = organization.id;
  const timezone = organization.timezone;
  const initialRange = defaultRange(timezone);

  const [employeeId, setEmployeeId] = useState("");
  const [workMode, setWorkMode] = useState<"" | AttendanceWorkMode>("");
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AttendanceCheckIn | null>(null);

  const rangeInvalid = Boolean(from && to && from > to);
  const rangeTooLong = Boolean(
    from && to && !rangeInvalid && daysBetween(from, to) > 366,
  );
  const filtersValid = !rangeInvalid && !rangeTooLong;

  const checkIns = useApi<AttendanceCheckInsResponse>(
    (signal) =>
      apiRequest(`/organizations/${organizationId}/attendance/check-ins`, {
        signal,
        query: {
          page,
          limit: PAGE_SIZE,
          employeeId: employeeId || undefined,
          workMode: workMode || undefined,
          from: from || undefined,
          to: to || undefined,
        },
      }),
    [organizationId, page, employeeId, workMode, from, to],
    { enabled: Boolean(organizationId) && filtersValid },
  );

  const closeDialog = useCallback(() => setSelected(null), []);

  function resetFilters() {
    const range = defaultRange(timezone);
    setEmployeeId("");
    setWorkMode("");
    setFrom(range.from);
    setTo(range.to);
    setPage(1);
    setSelected(null);
  }

  const rows = checkIns.data?.data ?? [];
  const rangeLabel =
    from && to
      ? formatDateRange(from, to)
      : from
        ? `From ${formatDay(from)}`
        : to
          ? `Through ${formatDay(to)}`
          : "All dates";

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${organization.name} · ${timezone}`}
        title="Attendance evidence"
        description="Review mobile check-ins by employee, time, attendance status, work mode, evidence availability, and location status. Filters apply immediately; open a check-in for private photos and secondary metadata."
      />

      <Alert tone="info" title="Private evidence and approximate location">
        Photos are released only through short-lived, audited links; storage paths are never
        exposed. GPS coordinates come from the employee&apos;s device at check-in and are
        approximate, so they do not independently prove physical presence. WFO check-ins never
        collect location, WFH collects neither photos nor location, and ON_SITE collects a selfie
        and location. ON_SITE sessions can also record a location history while work is active;
        it pauses on breaks and stops at checkout, and is shown only to roles with the
        attendance:location:read permission. Site photos are optional and are shown only for
        older check-ins that include one.
      </Alert>

      <Card>
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] xl:items-end">
          <Field label="Employee" htmlFor="attendance-employee">
            <EmployeePicker
              id="attendance-employee"
              organizationId={organizationId}
              value={employeeId}
              onChange={(nextEmployeeId) => {
                setEmployeeId(nextEmployeeId);
                setPage(1);
              }}
              placeholder="All employees"
            />
          </Field>
          <Field label="Work mode" htmlFor="attendance-mode">
            <Select
              id="attendance-mode"
              value={workMode}
              onChange={(event) => {
                setWorkMode(event.target.value as "" | AttendanceWorkMode);
                setPage(1);
              }}
            >
              <option value="">All modes</option>
              <option value="WFO">Work from office (WFO)</option>
              <option value="WFH">Work from home (WFH)</option>
              <option value="ON_SITE">On site</option>
            </Select>
          </Field>
          <Field label="From" htmlFor="attendance-from">
            <Input
              id="attendance-from"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(event) => {
                setFrom(event.target.value);
                setPage(1);
              }}
            />
          </Field>
          <Field label="To" htmlFor="attendance-to">
            <Input
              id="attendance-to"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(event) => {
                setTo(event.target.value);
                setPage(1);
              }}
            />
          </Field>
          <Button variant="ghost" size="sm" onClick={resetFilters}>
            Reset
          </Button>
        </div>
      </Card>

      {rangeInvalid ? (
        <Alert tone="danger" title="Invalid date range">
          The start date must be on or before the end date.
        </Alert>
      ) : rangeTooLong ? (
        <Alert tone="danger" title="Date range too large">
          Select a range of 366 days or fewer.
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Check-ins"
          description={
            checkIns.data
              ? `${checkIns.data.meta.total} check-in${checkIns.data.meta.total === 1 ? "" : "s"} · ${rangeLabel} · ${timezone}`
              : `${rangeLabel} · ${timezone}`
          }
          actions={
            <Button
              variant="ghost"
              size="sm"
              onClick={checkIns.reload}
              disabled={!filtersValid}
            >
              <RefreshIcon className="h-3.5 w-3.5" />
              Refresh
            </Button>
          }
        />

        {!filtersValid ? null : checkIns.error ? (
          <div className="p-4">
            <ErrorState message={checkIns.error} onRetry={checkIns.reload} />
          </div>
        ) : checkIns.loading && !checkIns.data ? (
          <LoadingBlock label="Loading attendance check-ins" rows={5} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No attendance check-ins found"
            description="Try widening the date range or clearing the employee and work-mode filters."
            icon={<ClockIcon className="h-5 w-5" />}
            action={
              <Button variant="secondary" size="sm" onClick={resetFilters}>
                Reset filters
              </Button>
            }
          />
        ) : (
          <>
            <div
              aria-hidden="true"
              className={`hidden border-b border-line bg-surface-muted px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted sm:px-5 xl:grid xl:items-center xl:gap-x-4 ${ROW_COLUMNS}`}
            >
              <span>Employee</span>
              <span>Check-in</span>
              <span>Status</span>
              <span>Evidence</span>
              <span>Location</span>
              <span className="text-right">Action</span>
            </div>
            <ul className="divide-y divide-line">
              {rows.map((checkIn) => {
                const state = attendanceState(checkIn);
                const selfieRequired = checkIn.workMode !== "WFH";
                const location = checkIn.location;
                const validLocation = hasValidCoordinates(location);
                const employeeName = checkIn.employee?.name ?? "Unknown employee";

                return (
                  <li
                    key={checkIn.id}
                    className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 transition-colors hover:bg-surface-muted sm:px-5 xl:min-h-14 xl:gap-x-4 xl:gap-y-0 xl:py-2.5 ${ROW_COLUMNS}`}
                  >
                    <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-2.5 xl:col-start-auto xl:row-start-auto">
                      <Avatar name={employeeName} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-ink">
                          {employeeName}
                        </p>
                        <p className="truncate text-[11px] text-muted">
                          {emailFor(checkIn) || "—"}
                        </p>
                      </div>
                    </div>

                    <div className="col-start-1 row-start-2 min-w-0 xl:col-start-auto xl:row-start-auto">
                      <p className="truncate text-xs font-medium tnum text-ink">
                        {formatDate(checkIn.createdAt, timezone)}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] tnum text-muted">
                        {formatTime(checkIn.createdAt, timezone)}
                      </p>
                    </div>

                    <div className="col-start-1 row-start-3 flex flex-wrap items-center gap-1.5 xl:col-start-auto xl:row-start-auto">
                      <Badge tone={state.tone}>{state.label}</Badge>
                      <WorkModeBadge mode={checkIn.workMode} short />
                    </div>

                    <div className="col-start-2 row-start-3 flex flex-col items-end gap-0.5 text-right xl:col-start-auto xl:row-start-auto xl:items-start xl:text-left">
                      <EvidenceAvailability
                        label="Selfie"
                        evidence={checkIn.selfie}
                        required={selfieRequired}
                      />
                      <EvidenceAvailability
                        label="Site photo"
                        evidence={checkIn.sitePhoto}
                        required={false}
                      />
                    </div>

                    <div className="col-start-2 row-start-2 justify-self-end xl:col-start-auto xl:row-start-auto xl:justify-self-start">
                      {checkIn.workMode !== "ON_SITE" ? (
                        <Badge tone="neutral">Not collected</Badge>
                      ) : validLocation && location ? (
                        <Badge tone="outline">
                          Recorded ±{location.accuracyMeters.toFixed(1)} m
                        </Badge>
                      ) : (
                        <Badge tone="warning">Not recorded</Badge>
                      )}
                    </div>

                    <div className="col-start-2 row-start-1 justify-self-end xl:col-start-auto xl:row-start-auto">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="whitespace-nowrap"
                        aria-label={`View attendance details for ${employeeName} at ${formatDateTime(checkIn.createdAt, timezone)}`}
                        onClick={() => setSelected(checkIn)}
                      >
                        View details
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="px-4 py-3">
              <Pagination
                page={checkIns.data?.meta.page ?? page}
                totalPages={checkIns.data?.meta.totalPages ?? 1}
                onPageChange={setPage}
              />
            </div>
          </>
        )}
      </Card>

      {selected ? (
        <AttendanceDetailDialog
          checkIn={selected}
          organizationId={organizationId}
          timezone={timezone}
          canViewLocationHistory={canViewLocationHistory}
          onClose={closeDialog}
        />
      ) : null}
    </div>
  );
}

function EvidenceAvailability({
  label,
  evidence,
  required,
}: {
  label: string;
  evidence: AttendanceEvidence | null;
  required: boolean;
}) {
  // Existing evidence is always reported, including optional historical site
  // photos on records created before the requirement changed.
  if (evidence) {
    if (evidence.status === "ATTACHED" || evidence.status === "UPLOADED") {
      return <p className="text-[11px] font-medium text-success">{label} available</p>;
    }
    return <p className="text-[11px] font-medium text-warning">{label} not uploaded</p>;
  }
  if (!required) {
    return <p className="text-[11px] text-muted">{label} not required</p>;
  }
  return <p className="text-[11px] font-medium text-warning">{label} not recorded</p>;
}

function breakSecondsFor(session: AttendanceCheckIn["session"]): number {
  return (session?.breaks ?? []).reduce(
    (total, brk) => total + Math.max(0, brk.durationSeconds),
    0,
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted">
        {title}
      </h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function SummaryCell({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-line px-3 py-2">
      <dt className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
        {label}
      </dt>
      <dd className="mt-0.5 text-xs font-medium text-ink">{value}</dd>
    </div>
  );
}

function AttendanceDetailDialog({
  checkIn,
  organizationId,
  timezone,
  canViewLocationHistory,
  onClose,
}: {
  checkIn: AttendanceCheckIn;
  organizationId: string;
  timezone: string;
  canViewLocationHistory: boolean;
  onClose: () => void;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
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
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

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

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [onClose]);

  const employeeName = checkIn.employee?.name ?? "Employee";
  const state = attendanceState(checkIn);
  const location = checkIn.location;
  const validLocation = hasValidCoordinates(location);
  const selfieRequired = checkIn.workMode !== "WFH";
  const session = checkIn.session;
  const breaks = session?.breaks ?? [];
  const breakSeconds = breakSecondsFor(session);
  const workedSeconds = session
    ? Math.max(0, session.durationSeconds - breakSeconds)
    : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex h-full min-h-0 w-full flex-col border-l border-line bg-surface shadow-xl sm:max-w-2xl lg:max-w-3xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-4 py-4 sm:px-5">
          <div className="flex min-w-0 items-start gap-3">
            <Avatar name={employeeName} size="lg" />
            <div className="min-w-0">
              <h2 id={titleId} className="truncate text-base font-semibold text-ink">
                {employeeName}
              </h2>
              <p className="truncate text-xs text-muted">
                {checkIn.employee?.email ?? "—"}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <WorkModeBadge mode={checkIn.workMode} />
                <Badge tone={state.tone}>{state.label}</Badge>
                {session ? <StatusBadge status={session.status} /> : null}
              </div>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-muted transition hover:bg-surface-hover hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            aria-label="Close attendance details"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="space-y-6 px-4 py-4 sm:px-5">
            <DetailSection title="Attendance summary">
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <SummaryCell
                  label="Check-in"
                  value={formatDateTime(checkIn.createdAt, timezone)}
                />
                <SummaryCell
                  label="Attendance"
                  value={<Badge tone={state.tone}>{state.label}</Badge>}
                />
                <SummaryCell
                  label="Session"
                  value={
                    session
                      ? formatTimeRange(session.startedAt, session.endedAt, timezone)
                      : "Unavailable"
                  }
                />
                <SummaryCell
                  label="Elapsed"
                  value={session ? formatDuration(session.durationSeconds) : "—"}
                />
                <SummaryCell
                  label="Worked"
                  value={session ? formatDuration(workedSeconds) : "—"}
                />
                <SummaryCell
                  label="Breaks"
                  value={
                    session
                      ? breaks.length === 0
                        ? "None"
                        : `${breaks.length} · ${formatDuration(breakSeconds)}`
                      : "—"
                  }
                />
              </dl>

              {breaks.length > 0 ? (
                <div className="mt-3 rounded-lg border border-line bg-surface-muted px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Break detail
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {breaks.map((brk, index) => (
                      <li
                        key={brk.id || `${brk.startedAt}-${index}`}
                        className="flex flex-wrap items-center justify-between gap-2 text-[11px]"
                      >
                        <span className="text-ink-secondary">
                          Break {index + 1} ·{" "}
                          {formatTimeRange(brk.startedAt, brk.endedAt, timezone)}
                        </span>
                        <span className="tnum text-muted">
                          {formatDuration(brk.durationSeconds)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <p className="mt-2 text-[11px] leading-5 text-muted">
                Worked time excludes recorded breaks. Elapsed time is wall-clock time since the
                session started.
              </p>
            </DetailSection>

            <DetailSection title="Private evidence">
              <div className="grid gap-3 md:grid-cols-2">
                <EvidencePhotoPanel
                  title="Selfie"
                  description="Captured by the employee at check-in."
                  evidence={checkIn.selfie}
                  required={selfieRequired}
                  organizationId={organizationId}
                  timezone={timezone}
                  employeeName={employeeName}
                />
                <EvidencePhotoPanel
                  title="Site photo"
                  description="Optional photo from older check-ins. New check-ins capture only a selfie and location."
                  evidence={checkIn.sitePhoto}
                  required={false}
                  organizationId={organizationId}
                  timezone={timezone}
                  employeeName={employeeName}
                />
              </div>
            </DetailSection>

            <DetailSection title="Captured location">
              {checkIn.workMode !== "ON_SITE" ? (
                <Alert tone="info" title="Location not collected">
                  {checkIn.workMode === "WFO"
                    ? "WFO check-ins record selfie evidence only. No GPS location is collected or displayed."
                    : "WFH check-ins do not require a selfie, site photo, or GPS location."}
                </Alert>
              ) : !location ? (
                <Alert tone="warning" title="No location recorded">
                  This ON_SITE check-in has no saved coordinates. No map can be shown, and no
                  location is inferred.
                </Alert>
              ) : !validLocation ? (
                <Alert tone="warning" title="Location is incomplete">
                  The saved location does not contain valid latitude and longitude values. No map
                  can be shown, and no location is inferred.
                </Alert>
              ) : (
                <>
                  <AttendanceLocationMap
                    location={location}
                    label={`Map of the coordinates recorded for ${employeeName}'s ON_SITE check-in`}
                  />
                  <dl className="mt-3 divide-y divide-line">
                    <DetailRow
                      label="Latitude"
                      value={
                        <span className="font-mono">
                          {formatCoordinate(location.latitude)}
                        </span>
                      }
                    />
                    <DetailRow
                      label="Longitude"
                      value={
                        <span className="font-mono">
                          {formatCoordinate(location.longitude)}
                        </span>
                      }
                    />
                    <DetailRow
                      label="Accuracy"
                      value={`± ${location.accuracyMeters.toFixed(1)} meters`}
                    />
                    <DetailRow
                      label="Recorded at"
                      value={formatDateTime(location.recordedAt, timezone)}
                    />
                  </dl>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <a
                      href={googleMapsUrl(location.latitude, location.longitude)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-xs font-medium text-ink transition hover:bg-surface-muted"
                    >
                      <MapPinIcon className="h-3.5 w-3.5" />
                      Open in Google Maps
                    </a>
                    <p className="text-[11px] text-muted">
                      Base map tiles load from OpenStreetMap. Coordinates are shown exactly as
                      recorded; no address lookup is performed.
                    </p>
                  </div>
                </>
              )}
              {checkIn.workMode === "ON_SITE" && validLocation ? (
                <p className="mt-3 text-[11px] leading-5 text-muted">
                  GPS accuracy is approximate. A recorded coordinate does not by itself prove that
                  the employee was physically present at the site.
                </p>
              ) : null}
            </DetailSection>

            {checkIn.workMode === "ON_SITE" && canViewLocationHistory ? (
              <AttendanceLocationHistorySection
                organizationId={organizationId}
                checkInId={checkIn.id}
                timezone={timezone}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function EvidencePhotoPanel({
  title,
  description,
  evidence,
  required,
  organizationId,
  timezone,
  employeeName,
}: {
  title: string;
  description: string;
  evidence: AttendanceEvidence | null;
  required: boolean;
  organizationId: string;
  timezone: string;
  employeeName: string;
}) {
  const [preview, setPreview] = useState<EvidencePreview | null>(
    evidence ? { status: "loading" } : null,
  );
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!evidence) return;

    let active = true;
    const controller = new AbortController();
    apiRequest<AttendanceEvidenceAccessResponse>(
      `/organizations/${organizationId}/attendance/evidence/${evidence.id}/access`,
      { method: "POST", body: {}, signal: controller.signal },
    )
      .then((response) => {
        if (!active) return;
        setPreview({
          status: "ready",
          url: privateEvidenceImageUrl(response.data.url),
          expiresAt: response.data.expiresAt,
        });
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return;
        setPreview({ status: "error", message: errorMessage(error) });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [evidence, organizationId, reloadKey]);

  useEffect(() => {
    if (preview?.status !== "ready") return;
    const remaining = Date.parse(preview.expiresAt) - Date.now();
    const delay =
      Number.isFinite(remaining) && remaining > 0
        ? Math.min(remaining, 2_147_483_647)
        : 0;
    const timer = setTimeout(() => {
      setPreview({
        status: "error",
        message:
          "The private photo link expired. Load the photo again for a fresh short-lived link.",
      });
    }, delay);
    return () => clearTimeout(timer);
  }, [preview]);

  return (
    <div className="flex flex-col rounded-lg border border-line p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-ink">{title}</p>
          <p className="mt-0.5 text-[11px] leading-4 text-muted">{description}</p>
        </div>
        {required ? (
          <Badge tone="outline">Required</Badge>
        ) : evidence ? (
          <Badge tone="neutral">Recorded</Badge>
        ) : (
          <Badge tone="neutral">Not required</Badge>
        )}
      </div>

      {!evidence && !required ? (
        <p className="mt-3 rounded-md bg-surface-muted px-3 py-2 text-[11px] text-muted">
          This check-in does not include a {title.toLowerCase()}.
        </p>
      ) : !evidence ? (
        <p className="mt-3 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] text-warning">
          No {title.toLowerCase()} is recorded for this check-in. No placeholder image is shown.
        </p>
      ) : (
        <div className="mt-3 flex flex-1 flex-col gap-2">
          <div className="aspect-[4/3] overflow-hidden rounded-lg border border-line bg-media">
            {preview === null || preview.status === "loading" ? (
              <div
                className="flex h-full items-center justify-center text-xs text-media-foreground"
                aria-busy="true"
              >
                Loading private photo…
              </div>
            ) : preview.status === "error" ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
                <p className="text-[11px] leading-5 text-media-danger">
                  {preview.message}
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setPreview({ status: "loading" });
                    setReloadKey((value) => value + 1);
                  }}
                >
                  Load photo again
                </Button>
              </div>
            ) : (
              // Signed URLs are short-lived and scoped; they are never cached or reused.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview.url}
                alt={`${title} recorded for ${employeeName}`}
                className="h-full w-full object-contain"
                onError={() =>
                  setPreview({
                    status: "error",
                    message:
                      "The image could not be loaded. The private link may have expired; load it again.",
                  })
                }
              />
            )}
          </div>
          <p className="text-[11px] text-muted">
            {evidence.capturedAt
              ? `Captured ${formatDateTime(evidence.capturedAt, timezone)}`
              : evidence.uploadedAt
                ? `Uploaded ${formatDateTime(evidence.uploadedAt, timezone)}`
                : "Capture time not recorded"}
            {" · "}
            {formatBytes(evidence.fileSizeBytes)} · {evidence.contentType}
          </p>
          {preview?.status === "ready" ? (
            <p className="text-[11px] text-muted">
              Short-lived link expires {formatDateTime(preview.expiresAt, timezone)}. Each access
              is audited.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
