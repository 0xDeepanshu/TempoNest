import type {
  AttendanceLocationSampleResult,
  AttendanceLocationState,
  AttendanceWorkMode,
} from '../api/types';
import type { BadgeTone } from '../components/status-badge';

export const LOCATION_TRACKING_TASK = 'temponest-on-site-location-tracking';

/** Starting cadence: about every 45 seconds or every 50 meters. */
export const LOCATION_SAMPLE_INTERVAL_MS = 45_000;
export const LOCATION_SAMPLE_DISTANCE_METERS = 50;
export const LOCATION_BATCH_INTERVAL_MS = 60_000;

export const LOCATION_QUEUE_MAX_SAMPLES = 500;
export const LOCATION_UPLOAD_BATCH_SIZE = 50;
export const LOCATION_MAX_ACCURACY_METERS = 500;
export const LOCATION_FUTURE_SKEW_MS = 60_000;
export const LOCATION_MAX_FIX_AGE_MS = 10 * 60_000;

export interface QueuedLocationSample {
  clientSampleId: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  capturedAt: string;
  source: 'DEVICE';
}

export interface LocationQueue {
  sessionId: string;
  samples: QueuedLocationSample[];
}

export function createQueuedLocationSample(input: {
  clientSampleId: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  capturedAtMs: number;
  nowMs?: number;
}): QueuedLocationSample | null {
  const nowMs = input.nowMs ?? Date.now();
  const { latitude, longitude, accuracyMeters, capturedAtMs } = input;

  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  if (
    accuracyMeters === null ||
    !Number.isFinite(accuracyMeters) ||
    accuracyMeters <= 0 ||
    accuracyMeters > LOCATION_MAX_ACCURACY_METERS
  ) {
    return null;
  }
  if (!Number.isFinite(capturedAtMs)) return null;
  if (capturedAtMs > nowMs + LOCATION_FUTURE_SKEW_MS) return null;
  if (capturedAtMs < nowMs - LOCATION_MAX_FIX_AGE_MS) return null;

  return {
    clientSampleId: input.clientSampleId,
    latitude,
    longitude,
    accuracyMeters,
    capturedAt: new Date(capturedAtMs).toISOString(),
    source: 'DEVICE',
  };
}

export function appendLocationSample(
  queue: LocationQueue,
  sample: QueuedLocationSample,
  maxSamples = LOCATION_QUEUE_MAX_SAMPLES,
): LocationQueue {
  if (queue.samples.some((entry) => entry.clientSampleId === sample.clientSampleId)) {
    return queue;
  }

  const samples = [...queue.samples, sample];
  return {
    sessionId: queue.sessionId,
    samples:
      samples.length > maxSamples ? samples.slice(samples.length - maxSamples) : samples,
  };
}

export function locationUploadBatch(
  queue: LocationQueue,
  batchSize = LOCATION_UPLOAD_BATCH_SIZE,
): QueuedLocationSample[] {
  return queue.samples.slice(0, batchSize);
}

/**
 * Drops every sample the server answered for. Rejected samples are permanent
 * client-side problems (accuracy, break, clock skew), so retrying them would
 * only waste battery.
 */
export function removeUploadedLocationSamples(
  queue: LocationQueue,
  results: AttendanceLocationSampleResult[],
): LocationQueue {
  if (results.length === 0) return queue;
  const answered = new Set(results.map((result) => result.clientSampleId));
  const samples = queue.samples.filter((sample) => !answered.has(sample.clientSampleId));
  return samples.length === queue.samples.length ? queue : { ...queue, samples };
}

export function shouldTrackOnSite(options: {
  workMode: AttendanceWorkMode | null | undefined;
  sessionStatus: string | null | undefined;
  ownsSession: boolean;
}): boolean {
  return (
    options.ownsSession &&
    options.workMode === 'ON_SITE' &&
    options.sessionStatus === 'ACTIVE'
  );
}

export type OnSiteTrackingPhase =
  | 'idle'
  | 'starting'
  | 'active-background'
  | 'active-foreground'
  | 'paused'
  | 'permission-denied'
  | 'stale'
  | 'stopped'
  | 'unavailable'
  | 'error';

export interface TrackingPhasePresentation {
  label: string;
  tone: BadgeTone;
  detail: string | null;
}

const PHASE_PRESENTATION: Record<OnSiteTrackingPhase, TrackingPhasePresentation> = {
  idle: {
    label: 'Not tracking',
    tone: 'neutral',
    detail: null,
  },
  starting: {
    label: 'Starting',
    tone: 'primary',
    detail: 'Confirming this session with TempoNest before collecting location.',
  },
  'active-background': {
    label: 'On',
    tone: 'success',
    detail: 'Location is recorded in the background until you check out.',
  },
  'active-foreground': {
    label: 'App open only',
    tone: 'warning',
    detail:
      'Location is recorded only while TempoNest is open. Allow background location in device settings for continuous tracking.',
  },
  paused: {
    label: 'Paused',
    tone: 'warning',
    detail: 'Location tracking pauses while you are on a break.',
  },
  'permission-denied': {
    label: 'Blocked',
    tone: 'danger',
    detail:
      'Location permission is not available. Allow it in device settings so this on-site session can be tracked.',
  },
  stale: {
    label: 'No recent fix',
    tone: 'warning',
    detail:
      'TempoNest has not received a location recently. Keep the app open or check device location settings.',
  },
  stopped: {
    label: 'Stopped',
    tone: 'neutral',
    detail: null,
  },
  unavailable: {
    label: 'Unavailable',
    tone: 'danger',
    detail:
      'This device cannot provide location updates right now. Check device location services and permissions.',
  },
  error: {
    label: 'Needs attention',
    tone: 'warning',
    detail: 'Location tracking could not be updated. Pull to refresh and try again.',
  },
};

export function trackingPhasePresentation(
  phase: OnSiteTrackingPhase,
): TrackingPhasePresentation {
  return PHASE_PRESENTATION[phase];
}

export function phaseFromLocationState(
  state: AttendanceLocationState,
  backgroundAllowed: boolean,
): OnSiteTrackingPhase {
  switch (state) {
    case 'ACTIVE':
      return backgroundAllowed ? 'active-background' : 'active-foreground';
    case 'PAUSED':
      return 'paused';
    case 'PERMISSION_UNAVAILABLE':
      return 'permission-denied';
    case 'STALE':
      return 'stale';
    case 'STOPPED':
    default:
      return 'stopped';
  }
}
