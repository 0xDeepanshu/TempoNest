import type {
  AttendanceLocation,
  AttendanceLocationHistory,
  AttendanceLocationPermissionState,
  AttendanceLocationSample,
  AttendanceLocationState,
  BreakSummary,
} from "./types";

export function isValidLatitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -180 && value <= 180;
}

export function hasValidCoordinates(
  location: AttendanceLocation | null | undefined,
): location is AttendanceLocation {
  return Boolean(
    location &&
      isValidLatitude(location.latitude) &&
      isValidLongitude(location.longitude),
  );
}

export function formatCoordinate(value: number): string {
  return value.toFixed(6);
}

/** Opens the captured coordinates in Google Maps; no geocoding is performed. */
export function googleMapsUrl(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}

export function isValidLocationSample(
  sample: AttendanceLocationSample | null | undefined,
): sample is AttendanceLocationSample {
  return Boolean(
    sample &&
      isValidLatitude(sample.latitude) &&
      isValidLongitude(sample.longitude) &&
      Number.isFinite(sample.accuracyMeters) &&
      sample.accuracyMeters >= 0 &&
      Number.isFinite(Date.parse(sample.capturedAt)),
  );
}

/**
 * Drops malformed samples rather than plotting an invented position, then
 * orders the rest chronologically. The server already orders samples, but the
 * map and timeline must not rely on that when data is merged or cached.
 */
export function orderLocationSamples(
  samples: AttendanceLocationSample[],
): AttendanceLocationSample[] {
  return samples
    .filter(isValidLocationSample)
    .sort((a, b) => {
      const delta = Date.parse(a.capturedAt) - Date.parse(b.capturedAt);
      return delta !== 0 ? delta : a.id.localeCompare(b.id);
    });
}

export function latestLocationSample(
  samples: AttendanceLocationSample[],
): AttendanceLocationSample | null {
  const ordered = orderLocationSamples(samples);
  return ordered.length > 0 ? ordered[ordered.length - 1] : null;
}

/** A gap longer than this between samples is never bridged on the map. */
export const LOCATION_GAP_SECONDS = 300;

export interface LocationMapSegment {
  points: Array<[number, number]>;
  startedAt: string;
  endedAt: string;
}

/**
 * Splits samples into contiguous runs so the map draws a line only where
 * consecutive points are close in time. Missing time appears as a visual break.
 */
export function locationMapSegments(
  samples: AttendanceLocationSample[],
  gapSeconds = LOCATION_GAP_SECONDS,
): LocationMapSegment[] {
  const ordered = orderLocationSamples(samples);
  const segments: LocationMapSegment[] = [];

  for (const sample of ordered) {
    const point: [number, number] = [sample.latitude, sample.longitude];
    const current = segments[segments.length - 1];
    if (!current) {
      segments.push({ points: [point], startedAt: sample.capturedAt, endedAt: sample.capturedAt });
      continue;
    }
    const previousTime = Date.parse(current.endedAt);
    if (Date.parse(sample.capturedAt) - previousTime > gapSeconds * 1000) {
      segments.push({ points: [point], startedAt: sample.capturedAt, endedAt: sample.capturedAt });
    } else {
      current.points.push(point);
      current.endedAt = sample.capturedAt;
    }
  }

  return segments;
}

export interface LocationHistoryGap {
  id: string;
  from: string;
  to: string;
  fromSampleId: string;
  toSampleId: string;
  seconds: number;
  kind: "break" | "gap";
}

/**
 * Finds intervals between consecutive samples that exceed the gap threshold.
 * A gap overlapping a recorded break is labelled as a break rather than an
 * unexplained loss of signal.
 */
export function locationHistoryGaps(
  samples: AttendanceLocationSample[],
  breaks: BreakSummary[] = [],
  gapSeconds = LOCATION_GAP_SECONDS,
): LocationHistoryGap[] {
  const ordered = orderLocationSamples(samples);
  const gaps: LocationHistoryGap[] = [];

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = Date.parse(ordered[index - 1].capturedAt);
    const current = Date.parse(ordered[index].capturedAt);
    const seconds = Math.round((current - previous) / 1000);
    if (seconds <= gapSeconds) continue;

    const overlapsBreak = breaks.some((brk) => {
      const breakStart = Date.parse(brk.startedAt);
      const breakEnd = brk.endedAt ? Date.parse(brk.endedAt) : Number.POSITIVE_INFINITY;
      return breakStart <= current && breakEnd >= previous;
    });

    gaps.push({
      id: `gap-${ordered[index - 1].id}-${ordered[index].id}`,
      from: ordered[index - 1].capturedAt,
      to: ordered[index].capturedAt,
      fromSampleId: ordered[index - 1].id,
      toSampleId: ordered[index].id,
      seconds,
      kind: overlapsBreak ? "break" : "gap",
    });
  }

  return gaps;
}

export type LocationTimelineKind =
  | "CHECK_IN"
  | "BREAK_START"
  | "BREAK_END"
  | "CHECK_OUT"
  | "GAP";

export interface LocationTimelineEvent {
  id: string;
  kind: LocationTimelineKind;
  at: string;
  title: string;
  detail: string | null;
}

/**
 * Builds the ordered session markers shown below the map. Only times present
 * in the returned records are used; nothing is inferred from sampling cadence.
 */
export function locationHistoryTimeline(
  history: Pick<AttendanceLocationHistory, "checkIn" | "session" | "samples">,
  gapSeconds = LOCATION_GAP_SECONDS,
): LocationTimelineEvent[] {
  const events: LocationTimelineEvent[] = [];
  const { checkIn, session, samples } = history;

  events.push({
    id: `check-in-${checkIn.id}`,
    kind: "CHECK_IN",
    at: checkIn.createdAt,
    title: "On-site check-in",
    detail: checkIn.location
      ? `Check-in location ± ${checkIn.location.accuracyMeters.toFixed(1)} m`
      : "No check-in coordinates recorded",
  });

  for (const [index, brk] of (session?.breaks ?? []).entries()) {
    events.push({
      id: `break-start-${brk.id || index}`,
      kind: "BREAK_START",
      at: brk.startedAt,
      title: `Break ${index + 1} started`,
      detail: "Location tracking paused",
    });
    if (brk.endedAt) {
      events.push({
        id: `break-end-${brk.id || index}`,
        kind: "BREAK_END",
        at: brk.endedAt,
        title: `Break ${index + 1} ended`,
        detail: "Location tracking resumed",
      });
    }
  }

  if (session?.endedAt) {
    events.push({
      id: `check-out-${session.id}`,
      kind: "CHECK_OUT",
      at: session.endedAt,
      title: "Checked out",
      detail: "Location tracking stopped",
    });
  }

  for (const gap of locationHistoryGaps(samples, session?.breaks ?? [], gapSeconds)) {
    const minutes = Math.max(1, Math.round(gap.seconds / 60));
    events.push({
      id: gap.id,
      kind: "GAP",
      at: gap.to,
      title: gap.kind === "break" ? "Break gap" : "Location gap",
      detail:
        gap.kind === "break"
          ? `No samples for ${minutes} min while on break`
          : `No samples for ${minutes} min`,
    });
  }

  return events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** Points used to frame the map, including the check-in coordinate when valid. */
export function locationHistoryMapPoints(
  samples: AttendanceLocationSample[],
  checkInLocation: AttendanceLocation | null,
): Array<[number, number]> {
  const points = orderLocationSamples(samples).map(
    (sample): [number, number] => [sample.latitude, sample.longitude],
  );
  if (hasValidCoordinates(checkInLocation)) {
    points.push([checkInLocation.latitude, checkInLocation.longitude]);
  }
  return points;
}

export type LocationStateTone = "success" | "warning" | "neutral" | "danger";

export function locationStatePresentation(
  state: AttendanceLocationState,
  reason: string | null | undefined,
  staleAfterSeconds?: number,
): { label: string; tone: LocationStateTone; detail: string } {
  switch (state) {
    case "ACTIVE":
      return {
        label: "Tracking active",
        tone: "success",
        detail:
          "The device reports location samples during this active on-site session. Background updates still depend on the operating system.",
      };
    case "PAUSED":
      return {
        label: "Paused for break",
        tone: "warning",
        detail:
          "Tracking pauses while the employee is on a break and resumes when work resumes.",
      };
    case "PERMISSION_UNAVAILABLE":
      return {
        label: "Permission unavailable",
        tone: "warning",
        detail:
          "Location permission was denied or revoked, so the device cannot record samples.",
      };
    case "STALE":
      return {
        label: "No recent updates",
        tone: "warning",
        detail: `No sample or status report arrived within ${
          staleAfterSeconds ? `${staleAfterSeconds} seconds` : "the expected interval"
        }; the last known state may be outdated.`,
      };
    case "STOPPED":
      if (reason === "SESSION_ENDED") {
        return {
          label: "Stopped at checkout",
          tone: "neutral",
          detail: "Tracking ends when the attendance session is checked out.",
        };
      }
      if (reason === "NOT_STARTED") {
        return {
          label: "Not started",
          tone: "neutral",
          detail: "No location samples or tracking reports were recorded for this session.",
        };
      }
      return {
        label: "Tracking stopped",
        tone: "neutral",
        detail: "The device is not currently reporting location samples.",
      };
  }
}

export function locationPermissionLabel(
  permission: AttendanceLocationPermissionState,
  backgroundAllowed: boolean,
): string {
  if (permission === "DENIED") return "Permission denied";
  if (permission === "FOREGROUND_ONLY") return "Foreground only";
  if (permission === "ALWAYS") {
    return backgroundAllowed ? "Background allowed" : "While app is open";
  }
  return "Permission unknown";
}
