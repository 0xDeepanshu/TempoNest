"use client";

import dynamic from "next/dynamic";
import { useMemo, type ReactNode } from "react";
import { apiRequest } from "@/lib/api-client";
import {
  latestLocationSample,
  locationHistoryTimeline,
  locationPermissionLabel,
  locationStatePresentation,
  orderLocationSamples,
} from "@/lib/attendance-location";
import { formatDateTime, formatTime, formatTimeRange } from "@/lib/format";
import type {
  AttendanceLocationHistory,
  AttendanceLocationHistoryResponse,
} from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { MapPinIcon, RefreshIcon } from "./icons";
import { Alert, Badge, Button, ErrorState, LoadingBlock } from "./ui";

const AttendanceLocationHistoryMap = dynamic(
  () =>
    import("./attendance-location-history-map").then(
      (module) => module.AttendanceLocationHistoryMap,
    ),
  {
    ssr: false,
    loading: () => (
      <div
        className="h-64 w-full animate-pulse rounded-lg bg-surface-hover sm:h-72"
        aria-label="Loading location history map"
      />
    ),
  },
);

function HistoryMetric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-line px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
        {label}
      </p>
      <div className="mt-0.5 text-xs font-medium text-ink">{value}</div>
    </div>
  );
}

export function AttendanceLocationHistorySection({
  organizationId,
  checkInId,
  timezone,
}: {
  organizationId: string;
  checkInId: string;
  timezone: string;
}) {
  const history = useApi<AttendanceLocationHistoryResponse>(
    (signal) =>
      apiRequest(
        `/organizations/${organizationId}/attendance/check-ins/${checkInId}/location-history`,
        { signal },
      ),
    [organizationId, checkInId],
    { enabled: Boolean(organizationId) && Boolean(checkInId) },
  );

  const view = useMemo(() => {
    const data = history.data?.data;
    if (!data) return null;
    return {
      data,
      ordered: orderLocationSamples(data.samples),
      latest: latestLocationSample(data.samples),
      state: locationStatePresentation(
        data.locationState.state,
        data.locationState.reason,
        data.locationState.staleAfterSeconds,
      ),
      timeline: locationHistoryTimeline(data),
    };
  }, [history.data]);

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted">
            Location history
          </h3>
          <p className="mt-0.5 text-[11px] text-muted">
            Recorded during this on-site session only · {timezone}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={history.reload}
          disabled={history.loading}
        >
          <RefreshIcon className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      <div className="mt-2">
        {history.error ? (
          <ErrorState message={history.error} onRetry={history.reload} />
        ) : history.loading && !view ? (
          <div className="rounded-lg border border-line">
            <LoadingBlock label="Loading location history" rows={2} />
          </div>
        ) : !view ? null : (
          <HistoryContent
            history={view.data}
            ordered={view.ordered}
            latest={view.latest}
            state={view.state}
            timeline={view.timeline}
            timezone={timezone}
          />
        )}
      </div>
    </section>
  );
}

function HistoryContent({
  history,
  ordered,
  latest,
  state,
  timeline,
  timezone,
}: {
  history: AttendanceLocationHistory;
  ordered: ReturnType<typeof orderLocationSamples>;
  latest: ReturnType<typeof latestLocationSample>;
  state: ReturnType<typeof locationStatePresentation>;
  timeline: ReturnType<typeof locationHistoryTimeline>;
  timezone: string;
}) {
  const recent = ordered.slice(-10).reverse();
  const session = history.session;
  const noSamples = ordered.length === 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={state.tone}>{state.label}</Badge>
        <Badge tone="outline">
          {locationPermissionLabel(
            history.locationState.permission,
            history.locationState.backgroundAllowed,
          )}
        </Badge>
        {history.truncated ? (
          <Badge tone="warning">Latest {ordered.length} of {history.totalSamples}</Badge>
        ) : (
          <Badge tone="neutral">
            {history.totalSamples} sample{history.totalSamples === 1 ? "" : "s"}
          </Badge>
        )}
      </div>

      <p className="text-[11px] leading-5 text-muted">{state.detail}</p>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <HistoryMetric
          label="Latest location"
          value={
            latest ? (
              formatDateTime(latest.capturedAt, timezone)
            ) : (
              <span className="text-muted">No samples</span>
            )
          }
        />
        <HistoryMetric
          label="Latest accuracy"
          value={
            latest ? `± ${latest.accuracyMeters.toFixed(1)} m` : "—"
          }
        />
        <HistoryMetric
          label="Last report"
          value={
            history.locationState.lastReportedAt
              ? formatDateTime(history.locationState.lastReportedAt, timezone)
              : "Never"
          }
        />
        <HistoryMetric
          label="Session"
          value={
            session
              ? formatTimeRange(session.startedAt, session.endedAt, timezone)
              : "Unavailable"
          }
        />
        <HistoryMetric
          label="Check-in"
          value={
            history.checkIn.location
              ? `± ${history.checkIn.location.accuracyMeters.toFixed(1)} m at ${formatTime(
                  history.checkIn.location.recordedAt,
                  timezone,
                )}`
              : "No coordinates"
          }
        />
        <HistoryMetric
          label="Sampling"
          value="Adaptive, about every 45 s or 50 m"
        />
      </dl>

      {noSamples ? (
        <Alert tone="warning" title="No location samples recorded">
          {history.locationState.state === "PERMISSION_UNAVAILABLE"
            ? "Location permission was denied or revoked, so the device could not record samples for this session. No position is inferred."
            : history.locationState.state === "PAUSED"
              ? "No samples were recorded because the session was on a break. Tracking excludes break time."
              : "The backend has no location samples for this session. No position is inferred from other records."}
        </Alert>
      ) : null}

      {ordered.length > 0 || history.checkIn.location ? (
        <AttendanceLocationHistoryMap
          samples={history.samples}
          checkInLocation={history.checkIn.location}
          breaks={history.session?.breaks ?? []}
          timezone={timezone}
          label={`Map of recorded location points for this ON_SITE attendance session`}
        />
      ) : null}

      {timeline.length > 0 ? (
        <div className="rounded-lg border border-line px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
            Session timeline
          </p>
          <ol className="mt-1.5 space-y-1.5">
            {timeline.map((event) => (
              <li key={event.id} className="flex items-start gap-2 text-[11px]">
                <span
                  aria-hidden="true"
                  className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                    event.kind === "GAP" ? "bg-warning" : "bg-ink"
                  }`}
                />
                <div className="min-w-0">
                  <p className="font-medium text-ink">
                    {event.title}
                    <span className="font-normal text-muted">
                      {" · "}
                      {formatTime(event.at, timezone)}
                    </span>
                  </p>
                  {event.detail ? (
                    <p className="text-muted">{event.detail}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {recent.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-line">
          <p className="border-b border-line bg-surface-muted px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
            Recent points · newest first
          </p>
          <ol className="max-h-44 divide-y divide-line overflow-y-auto">
            {recent.map((item) => {
              const index = ordered.indexOf(item) + 1;
              return (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-3 px-3 py-1.5 text-[11px]"
                >
                  <span className="min-w-0 truncate text-ink-secondary">
                    <span className="tnum text-muted">#{index}</span>{" "}
                    {formatDateTime(item.capturedAt, timezone)}
                  </span>
                  <span className="tnum shrink-0 text-muted">
                    ± {item.accuracyMeters.toFixed(1)} m
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}

      <p className="flex items-start gap-1.5 text-[11px] leading-5 text-muted">
        <MapPinIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Base map tiles load from OpenStreetMap; viewing the map shares the view area with
        OpenStreetMap. No address lookup is performed. Precise points are deleted automatically
        after {history.retention.days} days (current cutoff{" "}
        {formatDateTime(history.retention.cutoff, timezone)}). Access to another employee&apos;s
        history is audited.
      </p>
    </div>
  );
}
