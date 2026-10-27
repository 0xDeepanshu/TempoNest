import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import {
  fetchAttendanceLocationStatus,
  ingestAttendanceLocationSamples,
  reportAttendanceLocationStatus,
} from '../api/attendance';
import type { AgentCredentials } from '../api/client';
import {
  ApiError,
  NetworkError,
  isApiErrorCode,
  isSessionExpiredError,
} from '../api/errors';
import type {
  AttendanceLocationPermissionState,
  AttendanceLocationStateSummary,
  AttendanceLocationTrackingStatus,
} from '../api/types';
import { readAgentKey, subscribeToSessionExpired } from '../auth/tokens';
import {
  LOCATION_BATCH_INTERVAL_MS,
  LOCATION_SAMPLE_DISTANCE_METERS,
  LOCATION_SAMPLE_INTERVAL_MS,
  LOCATION_TRACKING_TASK,
  createQueuedLocationSample,
  phaseFromLocationState,
  type OnSiteTrackingPhase,
} from './tracking-core';
import {
  applyLocationUploadResults,
  clearLocationQueue,
  clearTrackingContext,
  enqueueLocationSample,
  ensureLocationQueue,
  readLocationUploadBatch,
  readTrackingContext,
  writeTrackingContext,
  type LocationTrackingContext,
} from './tracking-store';

export interface OnSiteTrackingIdentity {
  organizationId: string;
  userId: string;
  agent: AgentCredentials;
  sessionId: string;
}

export interface OnSiteTrackingSnapshot {
  phase: OnSiteTrackingPhase;
  permission: AttendanceLocationPermissionState;
  backgroundAllowed: boolean;
  reason: string | null;
  message: string | null;
  serverState: AttendanceLocationStateSummary | null;
  updatedAt: number;
}

const IDLE_SNAPSHOT: OnSiteTrackingSnapshot = {
  phase: 'idle',
  permission: 'UNKNOWN',
  backgroundAllowed: false,
  reason: null,
  message: null,
  serverState: null,
  updatedAt: 0,
};

let snapshot: OnSiteTrackingSnapshot = IDLE_SNAPSHOT;
const listeners = new Set<() => void>();

export function subscribeOnSiteTracking(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getOnSiteTrackingSnapshot(): OnSiteTrackingSnapshot {
  return snapshot;
}

function publish(patch: Partial<OnSiteTrackingSnapshot>): void {
  snapshot = { ...snapshot, ...patch, updatedAt: Date.now() };
  for (const listener of listeners) listener();
}

type TrackerMode = 'background' | 'foreground';

interface TrackerRuntime {
  organizationId: string;
  userId: string;
  agent: AgentCredentials;
  sessionId: string;
  mode: TrackerMode | null;
  permission: AttendanceLocationPermissionState;
  backgroundAllowed: boolean;
  foreground: Location.LocationSubscription | null;
  backgroundPrompted: boolean;
  validated: boolean;
  generation: number;
}

let runtime: TrackerRuntime | null = null;
let operationLock: Promise<unknown> = Promise.resolve();
let flushInFlight = false;

function enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = operationLock.then(operation, operation);
  operationLock = result.catch(() => undefined);
  return result;
}

function sameRuntimeIdentity(
  current: TrackerRuntime,
  identity: OnSiteTrackingIdentity,
): boolean {
  return (
    current.organizationId === identity.organizationId &&
    current.userId === identity.userId &&
    current.sessionId === identity.sessionId &&
    current.agent.id === identity.agent.id
  );
}

function makeRuntime(identity: OnSiteTrackingIdentity): TrackerRuntime {
  return {
    organizationId: identity.organizationId,
    userId: identity.userId,
    agent: identity.agent,
    sessionId: identity.sessionId,
    mode: null,
    permission: 'UNKNOWN',
    backgroundAllowed: false,
    foreground: null,
    backgroundPrompted: false,
    validated: false,
    generation: 0,
  };
}

async function ensureRuntime(identity: OnSiteTrackingIdentity): Promise<TrackerRuntime> {
  if (runtime && sameRuntimeIdentity(runtime, identity)) return runtime;

  if (runtime) {
    await stopOsTracking(runtime);
    await clearLocationQueue(runtime.organizationId, runtime.userId).catch(() => undefined);
  }
  await clearTrackingContext().catch(() => undefined);

  runtime = makeRuntime(identity);
  await ensureLocationQueue(
    identity.organizationId,
    identity.userId,
    identity.sessionId,
  ).catch(() => undefined);
  return runtime;
}

function trackingOptions(): Location.LocationTaskOptions {
  return {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: LOCATION_SAMPLE_INTERVAL_MS,
    distanceInterval: LOCATION_SAMPLE_DISTANCE_METERS,
    deferredUpdatesInterval: LOCATION_BATCH_INTERVAL_MS,
    deferredUpdatesDistance: LOCATION_SAMPLE_DISTANCE_METERS,
    activityType: Location.ActivityType.Other,
    // Continuous updates are required for a work session; battery use is
    // bounded by the 45 s / 50 m sampling cadence and balanced accuracy.
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'TempoNest location tracking',
      notificationBody: 'Recording location during your active on-site work session.',
      notificationColor: '#4F46E5',
      killServiceOnDestroy: false,
    },
  };
}

async function stopOsTracking(current: TrackerRuntime): Promise<void> {
  if (current.foreground) {
    current.foreground.remove();
    current.foreground = null;
  }
  if (Platform.OS !== 'web') {
    try {
      if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TRACKING_TASK)) {
        await Location.stopLocationUpdatesAsync(LOCATION_TRACKING_TASK);
      }
    } catch {
      // The OS may have already removed the registration.
    }
  }
}

function contextFor(current: TrackerRuntime): LocationTrackingContext {
  return {
    version: 1,
    organizationId: current.organizationId,
    userId: current.userId,
    agentId: current.agent.id,
    sessionId: current.sessionId,
    startedAt: new Date().toISOString(),
  };
}

async function readPermissionState(): Promise<{
  foreground: 'granted' | 'denied' | 'undetermined' | 'unavailable';
  background: 'granted' | 'denied' | 'undetermined' | 'unavailable';
  foregroundCanAskAgain: boolean;
  backgroundCanAskAgain: boolean;
}> {
  let foreground: Awaited<ReturnType<typeof Location.getForegroundPermissionsAsync>> | null = null;
  try {
    foreground = await Location.getForegroundPermissionsAsync();
  } catch {
    foreground = null;
  }

  let background: Awaited<ReturnType<typeof Location.getBackgroundPermissionsAsync>> | null = null;
  if (Platform.OS !== 'web' && foreground?.status === 'granted') {
    try {
      background = await Location.getBackgroundPermissionsAsync();
    } catch {
      background = null;
    }
  }

  return {
    foreground: foreground?.status ?? 'unavailable',
    background: background?.status ?? 'unavailable',
    foregroundCanAskAgain: foreground?.canAskAgain ?? false,
    backgroundCanAskAgain: background?.canAskAgain ?? false,
  };
}

async function resolvePermission(
  current: TrackerRuntime,
  prompt: boolean,
): Promise<{
  permission: AttendanceLocationPermissionState;
  backgroundGranted: boolean;
}> {
  let state = await readPermissionState();

  if (prompt && state.foreground !== 'granted' && state.foregroundCanAskAgain) {
    try {
      await Location.requestForegroundPermissionsAsync();
    } catch {
      // The prompt result below is authoritative.
    }
    state = await readPermissionState();
  }

  if (state.foreground !== 'granted') {
    return { permission: 'DENIED', backgroundGranted: false };
  }

  if (Platform.OS === 'web') {
    return { permission: 'FOREGROUND_ONLY', backgroundGranted: false };
  }

  let backgroundGranted = state.background === 'granted';
  if (
    prompt &&
    !backgroundGranted &&
    state.backgroundCanAskAgain &&
    !current.backgroundPrompted
  ) {
    current.backgroundPrompted = true;
    try {
      await Location.requestBackgroundPermissionsAsync();
    } catch {
      // Fall back to foreground tracking when the OS cannot prompt.
    }
    state = await readPermissionState();
    backgroundGranted = state.background === 'granted';
  }

  return {
    permission: backgroundGranted ? 'ALWAYS' : 'FOREGROUND_ONLY',
    backgroundGranted,
  };
}

class TrackingPermissionError extends Error {}

class TrackingUnavailableError extends Error {}

interface StartResult {
  mode: TrackerMode;
  permission: AttendanceLocationPermissionState;
  backgroundAllowed: boolean;
}

async function startTracking(current: TrackerRuntime): Promise<StartResult> {
  const permission = await resolvePermission(current, true);
  if (permission.permission === 'DENIED') {
    throw new TrackingPermissionError('Location permission is not available.');
  }

  if (permission.backgroundGranted && Platform.OS !== 'web') {
    try {
      const taskManagerAvailable = await TaskManager.isAvailableAsync();
      if (taskManagerAvailable) {
        await Location.startLocationUpdatesAsync(LOCATION_TRACKING_TASK, trackingOptions());
        await writeTrackingContext(contextFor(current));
        current.backgroundAllowed = true;
        return {
          mode: 'background',
          permission: 'ALWAYS',
          backgroundAllowed: true,
        };
      }
    } catch {
      // Fall through to a foreground watcher; never claim background tracking
      // when the OS refused to start it.
    }
  }

  // Any registration left from an earlier session must not compete with the
  // foreground watcher.
  await stopBackgroundTask();

  try {
    current.foreground = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: LOCATION_SAMPLE_INTERVAL_MS,
        distanceInterval: LOCATION_SAMPLE_DISTANCE_METERS,
      },
      (position) => {
        void enqueueOperation(() => recordForegroundPosition(current, position));
      },
      () => {
        void enqueueOperation(async () => {
          if (runtime !== current) return;
          await stopOsTracking(current);
          current.mode = null;
          await clearTrackingContext().catch(() => undefined);
          publish({
            phase: 'unavailable',
            message: 'This device stopped providing location updates.',
          });
        });
      },
    );
  } catch {
    throw new TrackingUnavailableError('Location updates could not be started.');
  }

  return {
    mode: 'foreground',
    permission: permission.permission,
    backgroundAllowed: false,
  };
}

async function recordForegroundPosition(
  current: TrackerRuntime,
  position: Location.LocationObject,
): Promise<void> {
  if (runtime !== current || current.mode !== 'foreground') return;

  const sample = createQueuedLocationSample({
    clientSampleId: Crypto.randomUUID(),
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracyMeters: position.coords.accuracy,
    capturedAtMs: position.timestamp || Date.now(),
  });
  if (!sample) return;

  await enqueueLocationSample(
    current.organizationId,
    current.userId,
    current.sessionId,
    sample,
  ).catch(() => undefined);
  await flushInternal(current);
}

function terminalTrackingError(error: unknown): boolean {
  if (isSessionExpiredError(error)) return true;
  if (
    isApiErrorCode(
      error,
      'AGENT_AUTH_REQUIRED',
      'AGENT_CREDENTIALS_INVALID',
      'AGENT_REVOKED',
      'MOBILE_AGENT_REQUIRED',
      'SESSION_NOT_FOUND',
      'SESSION_NOT_ACTIVE',
      'SESSION_STALE',
      'LOCATION_TRACKING_REQUIRES_ON_SITE',
      'WORK_MODE_NOT_ON_SITE',
      'ATTENDANCE_CHECK_IN_NOT_FOUND',
      'PERMISSION_DENIED',
    )
  ) {
    return true;
  }
  // A 4xx that is not throttling means the payload or the session contract is
  // wrong; retrying the same samples forever would drain the battery.
  return (
    error instanceof ApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408 &&
    error.status !== 429
  );
}

async function tearDown(current: TrackerRuntime, clearQueue: boolean): Promise<void> {
  await stopOsTracking(current);
  current.mode = null;
  current.validated = false;
  if (clearQueue) {
    await clearLocationQueue(current.organizationId, current.userId).catch(() => undefined);
  }
  await clearTrackingContext().catch(() => undefined);
}

async function reportTracking(
  identity: OnSiteTrackingIdentity,
  state: AttendanceLocationTrackingStatus,
  reason: string | undefined,
  permission: AttendanceLocationPermissionState,
  backgroundAllowed: boolean,
): Promise<AttendanceLocationStateSummary | null> {
  try {
    const response = await reportAttendanceLocationStatus(
      identity.organizationId,
      identity.agent,
      {
        sessionId: identity.sessionId,
        state,
        ...(reason ? { reason } : {}),
        permission,
        backgroundAllowed,
      },
    );
    return response.data.locationState;
  } catch {
    // Status reports are advisory; sample uploads and the next reconciliation
    // remain the source of truth. A session/agent failure is handled by the
    // next request, which will stop tracking.
    return null;
  }
}

type FlushOutcome = 'idle' | 'pending' | 'stopped';

async function flushInternal(current: TrackerRuntime): Promise<FlushOutcome> {
  if (flushInFlight) return 'pending';
  flushInFlight = true;

  try {
    for (let batch = 0; batch < 4; batch += 1) {
      const samples = await readLocationUploadBatch(
        current.organizationId,
        current.userId,
        current.sessionId,
      );
      if (samples.length === 0) return 'idle';

      try {
        const response = await ingestAttendanceLocationSamples(
          current.organizationId,
          current.agent,
          { sessionId: current.sessionId, samples },
        );
        await applyLocationUploadResults(
          current.organizationId,
          current.userId,
          current.sessionId,
          response.data.results,
        );
      } catch (error) {
        if (terminalTrackingError(error)) {
          const ended = isSessionExpiredError(error);
          await tearDown(current, true);
          if (runtime === current) runtime = null;
          publish({
            phase: ended ? 'stopped' : 'error',
            permission: ended ? 'UNKNOWN' : current.permission,
            backgroundAllowed: false,
            message: ended
              ? null
              : 'Location samples are no longer accepted for this session.',
          });
          return 'stopped';
        }

        if (error instanceof NetworkError || error instanceof ApiError) {
          return 'pending';
        }
        return 'pending';
      }
    }

    const remaining = await readLocationUploadBatch(
      current.organizationId,
      current.userId,
      current.sessionId,
    );
    return remaining.length > 0 ? 'pending' : 'idle';
  } finally {
    flushInFlight = false;
  }
}

export function reconcileOnSiteTracking(identity: OnSiteTrackingIdentity): Promise<void> {
  return enqueueOperation(async () => {
    const current = await ensureRuntime(identity);
    const generation = (current.generation += 1);

    if (current.mode === null) {
      publish({
        phase: 'starting',
        permission: current.permission,
        backgroundAllowed: false,
        reason: null,
        message: null,
      });
    }

    let status;
    try {
      const response = await fetchAttendanceLocationStatus(
        identity.organizationId,
        identity.agent,
      );
      status = response.data;
    } catch (error) {
      if (generation !== current.generation || runtime !== current) return;

      if (terminalTrackingError(error)) {
        const ended = isSessionExpiredError(error);
        await tearDown(current, true);
        if (runtime === current) runtime = null;
        publish({
          phase: ended ? 'stopped' : 'error',
          permission: ended ? 'UNKNOWN' : current.permission,
          backgroundAllowed: false,
          message: ended
            ? null
            : 'Location tracking could not be confirmed with TempoNest.',
        });
        return;
      }

      if (current.mode === null) {
        publish({
          phase: 'error',
          message:
            'TempoNest could not confirm this session. Tracking will start after the next successful refresh.',
        });
      }
      return;
    }

    if (generation !== current.generation || runtime !== current) return;

    if (!status.shouldTrack) {
      const paused = status.reason === 'BREAK';
      await tearDown(current, !paused);
      current.permission = status.locationState.permission;
      publish({
        phase: phaseFromLocationState(status.locationState.state, false),
        permission: status.locationState.permission,
        backgroundAllowed: false,
        reason: status.reason,
        serverState: status.locationState,
        message: null,
      });
      return;
    }

    if (current.mode !== null) {
      const permissionState = await readPermissionState();

      if (permissionState.foreground !== 'granted') {
        await tearDown(current, false);
        const serverState = await reportTracking(
          identity,
          'STOPPED',
          'PERMISSION_DENIED',
          'DENIED',
          false,
        );
        publish({
          phase: 'permission-denied',
          permission: 'DENIED',
          backgroundAllowed: false,
          reason: 'PERMISSION_DENIED',
          serverState,
          message: null,
        });
        return;
      }

      if (current.mode === 'background' && permissionState.background !== 'granted') {
        // Background permission was revoked while the session was running.
        await stopOsTracking(current);
        current.mode = null;
        current.backgroundAllowed = false;
        publish({
          phase: 'starting',
          permission: 'FOREGROUND_ONLY',
          backgroundAllowed: false,
          reason: 'BACKGROUND_UNAVAILABLE',
          message: null,
        });
      } else {
        await flushInternal(current);
        if (generation !== current.generation || runtime !== current) return;
        publish({
          phase:
            current.mode === 'background' ? 'active-background' : 'active-foreground',
          permission: current.permission,
          backgroundAllowed: current.backgroundAllowed,
          reason: null,
          serverState: status.locationState,
          message: null,
        });
        return;
      }
    }

    try {
      const started = await startTracking(current);
      if (generation !== current.generation || runtime !== current) {
        await stopOsTracking(current);
        return;
      }

      current.mode = started.mode;
      current.permission = started.permission;
      current.backgroundAllowed = started.backgroundAllowed;
      current.validated = true;

      const serverState = await reportTracking(
        identity,
        'ACTIVE',
        started.backgroundAllowed ? undefined : 'BACKGROUND_UNAVAILABLE',
        started.permission,
        started.backgroundAllowed,
      );

      publish({
        phase:
          started.mode === 'background' ? 'active-background' : 'active-foreground',
        permission: started.permission,
        backgroundAllowed: started.backgroundAllowed,
        reason: started.backgroundAllowed ? null : 'BACKGROUND_UNAVAILABLE',
        serverState: serverState ?? status.locationState,
        message: null,
      });

      await flushInternal(current);
    } catch (error) {
      if (generation !== current.generation || runtime !== current) return;

      current.mode = null;
      current.validated = false;
      if (error instanceof TrackingPermissionError) {
        const serverState = await reportTracking(
          identity,
          'STOPPED',
          'PERMISSION_DENIED',
          'DENIED',
          false,
        );
        publish({
          phase: 'permission-denied',
          permission: 'DENIED',
          backgroundAllowed: false,
          reason: 'PERMISSION_DENIED',
          serverState,
          message: null,
        });
        return;
      }

      if (error instanceof TrackingUnavailableError) {
        const serverState = await reportTracking(
          identity,
          'STOPPED',
          'OS_RESTRICTED',
          current.permission,
          false,
        );
        publish({
          phase: 'unavailable',
          permission: current.permission,
          backgroundAllowed: false,
          reason: 'OS_RESTRICTED',
          serverState,
          message: null,
        });
        return;
      }

      publish({
        phase: 'error',
        message: 'Location tracking could not be started. Pull to refresh and try again.',
      });
    }
  });
}

export function pauseOnSiteTracking(identity: OnSiteTrackingIdentity): Promise<void> {
  return enqueueOperation(async () => {
    const current = runtime;
    if (!current || !sameRuntimeIdentity(current, identity)) return;

    const permission =
      current.permission === 'UNKNOWN'
        ? (await readPermissionState()).foreground === 'granted'
          ? 'FOREGROUND_ONLY'
          : 'DENIED'
        : current.permission;
    const wasBackground = current.mode === 'background';

    await tearDown(current, false);
    await flushInternal(current);

    if (runtime !== current) return;

    const serverState = await reportTracking(
      identity,
      'PAUSED',
      'BREAK',
      permission,
      wasBackground,
    );

    publish({
      phase: 'paused',
      permission,
      backgroundAllowed: false,
      reason: 'BREAK',
      serverState,
      message: null,
    });
  });
}

export function stopOnSiteTracking(
  options: { report?: boolean } = {},
): Promise<void> {
  return enqueueOperation(async () => {
    const current = runtime;
    if (!current) {
      await clearTrackingContext().catch(() => undefined);
      if (snapshot.phase !== 'idle') {
        publish({
          ...IDLE_SNAPSHOT,
          updatedAt: Date.now(),
        });
      }
      return;
    }

    const identity: OnSiteTrackingIdentity = {
      organizationId: current.organizationId,
      userId: current.userId,
      agent: current.agent,
      sessionId: current.sessionId,
    };

    await stopOsTracking(current);
    current.mode = null;
    current.validated = false;

    if (options.report) {
      await reportTracking(identity, 'STOPPED', 'SESSION_ENDED', current.permission, false);
    }

    await clearLocationQueue(current.organizationId, current.userId).catch(() => undefined);
    await clearTrackingContext().catch(() => undefined);
    runtime = null;

    publish({
      phase: 'idle',
      permission: 'UNKNOWN',
      backgroundAllowed: false,
      reason: null,
      message: null,
      serverState: null,
    });
  });
}

export function flushOnSiteTrackingQueue(
  identity: OnSiteTrackingIdentity,
): Promise<void> {
  return enqueueOperation(async () => {
    const current = runtime;
    if (!current || !sameRuntimeIdentity(current, identity)) return;
    await flushInternal(current);
  });
}

function contextIdentity(context: LocationTrackingContext, key: string): OnSiteTrackingIdentity {
  return {
    organizationId: context.organizationId,
    userId: context.userId,
    agent: { id: context.agentId, key },
    sessionId: context.sessionId,
  };
}

async function adoptBackgroundRuntime(
  identity: OnSiteTrackingIdentity,
): Promise<TrackerRuntime> {
  if (runtime && sameRuntimeIdentity(runtime, identity)) {
    if (runtime.foreground) {
      runtime.foreground.remove();
      runtime.foreground = null;
    }
    runtime.mode = 'background';
    runtime.permission = 'ALWAYS';
    runtime.backgroundAllowed = true;
    return runtime;
  }

  if (runtime) {
    await stopOsTracking(runtime);
    await clearLocationQueue(runtime.organizationId, runtime.userId).catch(() => undefined);
  }

  runtime = makeRuntime(identity);
  runtime.mode = 'background';
  runtime.permission = 'ALWAYS';
  runtime.backgroundAllowed = true;
  await ensureLocationQueue(
    identity.organizationId,
    identity.userId,
    identity.sessionId,
  ).catch(() => undefined);
  return runtime;
}

/**
 * Entry point for the TaskManager location task. The task can run in a fresh
 * JavaScript context after the app was killed, so it reads the persisted
 * session context and revalidates it against the backend before accepting any
 * sample.
 */
export async function processBackgroundLocationUpdates(
  locations: Location.LocationObject[],
): Promise<void> {
  const context = await readTrackingContext().catch(() => null);
  if (!context) {
    await stopBackgroundTask();
    return;
  }

  let key: string | null = null;
  try {
    key = await readAgentKey(context.organizationId, context.userId);
  } catch {
    key = null;
  }
  if (!key) {
    await stopBackgroundTask();
    return;
  }

  const identity = contextIdentity(context, key);

  return enqueueOperation(async () => {
    const current = await adoptBackgroundRuntime(identity);

    if (!current.validated) {
      let status;
      try {
        const response = await fetchAttendanceLocationStatus(
          identity.organizationId,
          identity.agent,
        );
        status = response.data;
      } catch (error) {
        if (terminalTrackingError(error)) {
          await tearDown(current, true);
          if (runtime === current) runtime = null;
        }
        // Without a successful reconciliation no sample is uploaded; the next
        // task invocation retries instead of trusting persisted state.
        return;
      }

      if (!status.shouldTrack) {
        const paused = status.reason === 'BREAK';
        await tearDown(current, !paused);
        if (!paused && runtime === current) runtime = null;
        publish({
          phase: phaseFromLocationState(status.locationState.state, false),
          permission: status.locationState.permission,
          backgroundAllowed: false,
          reason: status.reason,
          serverState: status.locationState,
          message: null,
        });
        return;
      }

      current.validated = true;
      await reportTracking(identity, 'ACTIVE', undefined, 'ALWAYS', true);
    }

    for (const location of locations) {
      const sample = createQueuedLocationSample({
        clientSampleId: Crypto.randomUUID(),
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracyMeters: location.coords.accuracy,
        capturedAtMs: location.timestamp || Date.now(),
      });
      if (!sample) continue;
      await enqueueLocationSample(
        identity.organizationId,
        identity.userId,
        identity.sessionId,
        sample,
      ).catch(() => undefined);
    }

    await flushInternal(current);

    if (runtime === current) {
      publish({
        phase: 'active-background',
        permission: 'ALWAYS',
        backgroundAllowed: true,
        reason: null,
        message: null,
      });
    }
  });
}

async function stopBackgroundTask(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TRACKING_TASK)) {
      await Location.stopLocationUpdatesAsync(LOCATION_TRACKING_TASK);
    }
  } catch {
    // Nothing left to stop.
  }
  await clearTrackingContext().catch(() => undefined);
}

/**
 * Clears tracking when the signed-in session ends outside the UI (refresh
 * failure or server revocation). Sign-out also calls `stopOnSiteTracking`
 * before clearing credentials so the last status report can still authenticate.
 */
let lifecycleRegistered = false;

export function registerTrackingLifecycle(): void {
  if (lifecycleRegistered) return;
  lifecycleRegistered = true;
  subscribeToSessionExpired(() => {
    void stopOnSiteTracking();
  });
}
