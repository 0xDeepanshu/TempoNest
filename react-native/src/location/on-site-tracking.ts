import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { PermissionsAndroid, Platform } from 'react-native';

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
  ReportAttendanceLocationStatusResponse,
  TimeSessionSummary,
} from '../api/types';
import { readAgentKey, subscribeToSessionExpired } from '../auth/tokens';
import {
  LOCATION_BATCH_INTERVAL_MS,
  LOCATION_MONITOR_INTERVAL_MS,
  LOCATION_RESUME_FIX_TIMEOUT_MS,
  LOCATION_SAMPLE_DISTANCE_METERS,
  LOCATION_SAMPLE_INTERVAL_MS,
  LOCATION_TRACKING_TASK,
  classifyTrackingRestart,
  createQueuedLocationSample,
  isLocationPauseReason,
  phaseFromLocationState,
  type LocationPauseReason,
  type OnSiteTrackingPhase,
} from './tracking-core';
import {
  openAppPermissionSettings,
  openLocationServicesSettings,
} from './location-recovery';
import {
  applyLocationUploadResults,
  clearLocationQueue,
  clearPendingLocationReport,
  clearTrackingContext,
  enqueueLocationSample,
  ensureLocationQueue,
  readLocationUploadBatch,
  readPendingLocationReport,
  readTrackingContext,
  writePendingLocationReport,
  writeTrackingContext,
  type LocationTrackingContext,
  type PendingLocationReport,
} from './tracking-store';

export interface OnSiteTrackingIdentity {
  organizationId: string;
  userId: string;
  agent: AgentCredentials;
  sessionId: string;
  /** Applies a server-normalized session so the timer pauses immediately. */
  applySession?: (session: TimeSessionSummary, serverTime: string) => void;
  /** Freezes the local timer before the pause report round-trip completes. */
  applyLocationPause?: (sessionId: string, pausedAt: string) => void;
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
  notificationPrompted: boolean;
  validated: boolean;
  generation: number;
  /** Why the server paused the timer, including manual breaks. */
  pauseReason: string | null;
  /** True after a process/service interruption; only an explicit resume clears it. */
  recoveryRequired: boolean;
  monitorTimer: ReturnType<typeof setInterval> | null;
  applySession?: OnSiteTrackingIdentity['applySession'];
  applyLocationPause?: OnSiteTrackingIdentity['applyLocationPause'];
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
    notificationPrompted: false,
    validated: false,
    generation: 0,
    pauseReason: null,
    recoveryRequired: false,
    monitorTimer: null,
    applySession: identity.applySession,
    applyLocationPause: identity.applyLocationPause,
  };
}

async function ensureRuntime(identity: OnSiteTrackingIdentity): Promise<TrackerRuntime> {
  if (runtime && sameRuntimeIdentity(runtime, identity)) {
    runtime.applySession = identity.applySession ?? runtime.applySession;
    runtime.applyLocationPause =
      identity.applyLocationPause ?? runtime.applyLocationPause;
    return runtime;
  }

  if (runtime) {
    stopMonitor(runtime);
    await stopOsTracking(runtime);
    await clearLocationQueue(runtime.organizationId, runtime.userId).catch(() => undefined);
    await clearPendingLocationReport(runtime.organizationId, runtime.userId).catch(
      () => undefined,
    );
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

function identityFor(current: TrackerRuntime): OnSiteTrackingIdentity {
  return {
    organizationId: current.organizationId,
    userId: current.userId,
    agent: current.agent,
    sessionId: current.sessionId,
    applySession: current.applySession,
    applyLocationPause: current.applyLocationPause,
  };
}

function stopMonitor(current: TrackerRuntime): void {
  if (current.monitorTimer) clearInterval(current.monitorTimer);
  current.monitorTimer = null;
}

/**
 * Runs while the app process is alive. It distinguishes a manual break (do
 * nothing) from a location pause (wait for recovery and keep retrying an
 * undelivered pause report) and checks permissions/services from the OS rather
 * than from a cached flag.
 */
function ensureMonitor(current: TrackerRuntime): void {
  if (current.monitorTimer) return;
  current.monitorTimer = setInterval(() => {
    void enqueueOperation(() => monitorTracking(current)).catch(() => undefined);
  }, LOCATION_MONITOR_INTERVAL_MS);
}

/** Starts the interval and checks once immediately (runs after the caller's lock). */
function kickMonitor(current: TrackerRuntime): void {
  ensureMonitor(current);
  void enqueueOperation(() => monitorTracking(current)).catch(() => undefined);
}

async function locationServicesEnabled(): Promise<boolean> {
  if (Platform.OS === 'web') return true;
  try {
    return await Location.hasServicesEnabledAsync();
  } catch {
    return false;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Location request timed out')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** The foreground service still runs without this; only its notification hides. */
async function ensureNotificationPermission(current: TrackerRuntime): Promise<void> {
  if (Platform.OS !== 'android' || current.notificationPrompted) return;
  if (Number(Platform.Version) < 33) return;
  current.notificationPrompted = true;
  try {
    const granted = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
    if (!granted) {
      await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    }
  } catch {
    // Tracking does not depend on the notification permission.
  }
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
      notificationTitle: 'WorkZen location tracking',
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

class TrackingUnavailableError extends Error {
  constructor(
    message: string,
    readonly reason: 'LOCATION_DISABLED' | 'LOCATION_UNAVAILABLE' = 'LOCATION_UNAVAILABLE',
  ) {
    super(message);
  }
}

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

  if (!(await locationServicesEnabled())) {
    throw new TrackingUnavailableError('Location services are turned off.', 'LOCATION_DISABLED');
  }

  if (permission.backgroundGranted && Platform.OS !== 'web') {
    try {
      const taskManagerAvailable = await TaskManager.isAvailableAsync();
      if (taskManagerAvailable) {
        await ensureNotificationPermission(current);
        await Location.startLocationUpdatesAsync(LOCATION_TRACKING_TASK, trackingOptions());
        await writeTrackingContext(contextFor(current));
        current.backgroundAllowed = true;
        ensureMonitor(current);
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
        void enqueueOperation(() => pauseForLocation(current, 'LOCATION_UNAVAILABLE'));
      },
    );
  } catch {
    throw new TrackingUnavailableError('Location updates could not be started.');
  }

  // Persist the session even without a foreground service: if the process is
  // killed, the next launch can tell that collection stopped unverified.
  await writeTrackingContext(contextFor(current));
  ensureMonitor(current);
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

async function tearDown(
  current: TrackerRuntime,
  clearQueue: boolean,
  options: { keepMonitor?: boolean } = {},
): Promise<void> {
  await stopOsTracking(current);
  current.mode = null;
  current.validated = false;
  if (!options.keepMonitor) stopMonitor(current);
  if (clearQueue) {
    await clearLocationQueue(current.organizationId, current.userId).catch(() => undefined);
    await clearPendingLocationReport(current.organizationId, current.userId).catch(
      () => undefined,
    );
  }
  await clearTrackingContext().catch(() => undefined);
}

function reportErrorIsRetryable(error: unknown): boolean {
  if (error instanceof NetworkError) return true;
  return (
    error instanceof ApiError &&
    (error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500)
  );
}

async function reportTracking(
  identity: OnSiteTrackingIdentity,
  state: AttendanceLocationTrackingStatus,
  reason: string | undefined,
  permission: AttendanceLocationPermissionState,
  backgroundAllowed: boolean,
  options: { persistOnFailure?: boolean } = {},
): Promise<ReportAttendanceLocationStatusResponse['data'] | null> {
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
    // Applying the normalized session here pauses the local timer immediately
    // instead of waiting for the next refresh.
    identity.applySession?.(response.data.session, response.serverTime);
    return response.data;
  } catch (error) {
    if (options.persistOnFailure && reportErrorIsRetryable(error)) {
      const pending: PendingLocationReport = {
        version: 1,
        sessionId: identity.sessionId,
        state,
        reason: reason ?? null,
        permission,
        backgroundAllowed,
        queuedAt: new Date().toISOString(),
      };
      await writePendingLocationReport(
        identity.organizationId,
        identity.userId,
        pending,
      ).catch(() => undefined);
    }
    // Status reports are advisory; sample uploads and the next reconciliation
    // remain the source of truth. A session/agent failure is handled by the
    // next request, which will stop tracking.
    return null;
  }
}

async function syncPendingReport(identity: OnSiteTrackingIdentity): Promise<boolean> {
  const pending = await readPendingLocationReport(identity.organizationId, identity.userId);
  if (!pending) return true;
  if (pending.sessionId !== identity.sessionId) {
    await clearPendingLocationReport(identity.organizationId, identity.userId).catch(
      () => undefined,
    );
    return true;
  }

  const data = await reportTracking(
    identity,
    pending.state,
    pending.reason ?? undefined,
    pending.permission,
    pending.backgroundAllowed,
    { persistOnFailure: true },
  );
  if (!data) return false;
  await clearPendingLocationReport(identity.organizationId, identity.userId).catch(
    () => undefined,
  );
  return true;
}

const PAUSE_PHASE: Record<LocationPauseReason, OnSiteTrackingPhase> = {
  LOCATION_DISABLED: 'location-disabled',
  LOCATION_UNAVAILABLE: 'location-unavailable',
  PERMISSION_DENIED: 'permission-denied',
};

/**
 * Stops collection and records a pause the server can enforce. The reason is
 * persisted by the server on the tracking row and the timer moves to the
 * existing ON_BREAK state; this is not a second timer system.
 */
async function pauseForLocation(
  current: TrackerRuntime,
  reason: LocationPauseReason,
): Promise<void> {
  if (runtime !== current) return;

  const permission = reason === 'PERMISSION_DENIED' ? 'DENIED' : current.permission;
  // Freeze the actual elapsed-time calculation now. The server pause is
  // backdated to the last verified sample once the report is delivered.
  current.applyLocationPause?.(current.sessionId, new Date().toISOString());
  current.pauseReason = reason;
  current.recoveryRequired = false;
  current.permission = permission;
  current.backgroundAllowed = false;

  await tearDown(current, false, { keepMonitor: true });
  await flushInternal(current).catch(() => undefined);
  if (runtime !== current) return;
  ensureMonitor(current);

  const data = await reportTracking(
    identityFor(current),
    'PAUSED',
    reason,
    permission,
    false,
    { persistOnFailure: true },
  );
  if (runtime !== current) return;

  publish({
    phase: PAUSE_PHASE[reason],
    permission,
    backgroundAllowed: false,
    reason,
    serverState: data?.locationState ?? snapshot.serverState,
    message: null,
  });
}

/**
 * Periodically verifies permission and services from the OS. Cached report
 * values are never treated as proof that tracking still works.
 */
async function monitorTracking(current: TrackerRuntime): Promise<void> {
  if (runtime !== current) return;

  const pauseDelivered = await syncPendingReport(identityFor(current)).catch(() => false);
  if (runtime !== current) return;

  if (current.pauseReason) {
    if (!isLocationPauseReason(current.pauseReason)) return;
    // An interrupted tracking session stays in recovery until the employee
    // explicitly checks and resumes; the monitor must not downgrade it.
    if (current.recoveryRequired) return;

    const permissionState = await readPermissionState();
    if (runtime !== current) return;

    if (permissionState.foreground !== 'granted') {
      if (snapshot.phase !== 'permission-denied') {
        publish({
          phase: 'permission-denied',
          permission: 'DENIED',
          backgroundAllowed: false,
          reason: 'PERMISSION_DENIED',
          message: null,
        });
      }
      return;
    }

    if (!(await locationServicesEnabled())) {
      if (snapshot.phase !== 'location-disabled') {
        publish({
          phase: 'location-disabled',
          permission: current.permission,
          backgroundAllowed: false,
          reason: 'LOCATION_DISABLED',
          message: null,
        });
      }
      return;
    }

    // Do not announce readiness while the pause itself is still queued: the
    // timer would look resumable before the server recorded the pause.
    if (!pauseDelivered) return;

    if (snapshot.phase !== 'location-restored') {
      publish({
        phase: 'location-restored',
        permission:
          permissionState.background === 'granted' ? 'ALWAYS' : 'FOREGROUND_ONLY',
        backgroundAllowed: false,
        reason: current.pauseReason,
        message: null,
      });
    }
    return;
  }

  if (current.mode === null) return;

  const permissionState = await readPermissionState();
  if (runtime !== current) return;

  if (permissionState.foreground !== 'granted') {
    await pauseForLocation(current, 'PERMISSION_DENIED');
    return;
  }

  if (!(await locationServicesEnabled())) {
    await pauseForLocation(current, 'LOCATION_DISABLED');
    return;
  }

  if (current.mode === 'background' && Platform.OS !== 'web') {
    // The OS can drop the foreground-service registration without telling the
    // app. Verify it instead of trusting the in-memory mode.
    let running = false;
    try {
      running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TRACKING_TASK);
    } catch {
      running = false;
    }
    if (!running) {
      current.mode = null;
      current.backgroundAllowed = false;
      try {
        const started = await startTracking(current);
        current.mode = started.mode;
        current.permission = started.permission;
        current.backgroundAllowed = started.backgroundAllowed;
        const data = await reportTracking(
          identityFor(current),
          'ACTIVE',
          started.backgroundAllowed ? undefined : 'BACKGROUND_UNAVAILABLE',
          started.permission,
          started.backgroundAllowed,
          { persistOnFailure: true },
        );
        publish({
          phase:
            started.mode === 'background' ? 'active-background' : 'active-foreground',
          permission: started.permission,
          backgroundAllowed: started.backgroundAllowed,
          reason: started.backgroundAllowed ? null : 'BACKGROUND_UNAVAILABLE',
          serverState: data?.locationState ?? snapshot.serverState,
          message: null,
        });
      } catch (error) {
        const reason =
          error instanceof TrackingUnavailableError ? error.reason : 'LOCATION_UNAVAILABLE';
        await pauseForLocation(current, reason);
      }
      return;
    }
  }

  if (current.mode === 'background' && permissionState.background !== 'granted') {
    // Continuous background tracking is no longer permitted. Fall back to the
    // foreground watcher instead of pretending the session is fully tracked.
    current.backgroundPrompted = true;
    await stopOsTracking(current);
    current.mode = null;
    try {
      const started = await startTracking(current);
      current.mode = started.mode;
      current.permission = started.permission;
      current.backgroundAllowed = started.backgroundAllowed;
      await reportTracking(
        identityFor(current),
        'ACTIVE',
        'BACKGROUND_UNAVAILABLE',
        started.permission,
        started.backgroundAllowed,
        { persistOnFailure: true },
      );
      publish({
        phase: 'active-foreground',
        permission: started.permission,
        backgroundAllowed: false,
        reason: 'BACKGROUND_UNAVAILABLE',
        message: null,
      });
    } catch (error) {
      const reason =
        error instanceof TrackingUnavailableError ? error.reason : 'LOCATION_UNAVAILABLE';
      await pauseForLocation(current, reason);
    }
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

async function hasRunningBackgroundTask(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    return await Location.hasStartedLocationUpdatesAsync(LOCATION_TRACKING_TASK);
  } catch {
    return false;
  }
}

interface PersistedTrackingState {
  interrupted: boolean;
  survivingBackground: boolean;
}

/**
 * Distinguishes a live tracker from one that stopped while the JavaScript
 * process was gone. The persisted context is written for both tracker modes,
 * so its presence plus a missing foreground service is the restart evidence;
 * an in-memory runtime is never treated as an interruption.
 */
async function readPersistedTrackingState(
  identity: OnSiteTrackingIdentity,
): Promise<PersistedTrackingState> {
  const context = await readTrackingContext().catch(() => null);
  const state = classifyTrackingRestart({
    hasInMemoryRuntime: Boolean(runtime && sameRuntimeIdentity(runtime, identity)),
    context,
    sessionId: identity.sessionId,
    agentId: identity.agent.id,
    backgroundRunning: context ? await hasRunningBackgroundTask() : false,
  });

  return {
    interrupted: state === 'interrupted',
    survivingBackground: state === 'surviving-background',
  };
}

/**
 * Uploads the samples that were genuinely captured, then records one pause so
 * the unverified interval is excluded. The session stays paused until the
 * employee verifies location and explicitly resumes.
 */
async function recoverInterruptedTracking(
  current: TrackerRuntime,
  identity: OnSiteTrackingIdentity,
): Promise<void> {
  const permissionState = await readPermissionState().catch(() => null);
  const permission: AttendanceLocationPermissionState = !permissionState
    ? 'UNKNOWN'
    : permissionState.foreground !== 'granted'
      ? 'DENIED'
      : permissionState.background === 'granted'
        ? 'ALWAYS'
        : 'FOREGROUND_ONLY';

  // Verified fixes are uploaded before the pause so the backend can anchor the
  // break to the last accepted sample instead of counting the interruption.
  await flushInternal(current).catch(() => undefined);
  if (runtime !== current) return;

  current.applyLocationPause?.(current.sessionId, new Date().toISOString());
  current.pauseReason = 'LOCATION_UNAVAILABLE';
  current.recoveryRequired = true;
  current.permission = permission;
  current.backgroundAllowed = false;
  await stopOsTracking(current);
  stopMonitor(current);
  await clearTrackingContext().catch(() => undefined);

  const data = await reportTracking(
    identityFor(current),
    'PAUSED',
    'LOCATION_UNAVAILABLE',
    permission,
    false,
    { persistOnFailure: true },
  );
  if (runtime !== current) return;

  publish({
    phase: 'interrupted',
    permission,
    backgroundAllowed: false,
    reason: 'LOCATION_UNAVAILABLE',
    serverState: data?.locationState ?? null,
    message: null,
  });
}

export function reconcileOnSiteTracking(identity: OnSiteTrackingIdentity): Promise<void> {
  return enqueueOperation(async () => {
    const persisted = await readPersistedTrackingState(identity);
    const current = persisted.survivingBackground
      ? await adoptBackgroundRuntime(identity)
      : await ensureRuntime(identity);
    const generation = (current.generation += 1);
    await syncPendingReport(identity).catch(() => undefined);

    if (persisted.interrupted) {
      await recoverInterruptedTracking(current, identity);
      return;
    }

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
            : 'Location tracking could not be confirmed with WorkZen.',
        });
        return;
      }

      if (current.mode === null && !current.recoveryRequired) {
        publish({
          phase: 'error',
          message:
            'WorkZen could not confirm this session. Tracking will start after the next successful refresh.',
        });
      }
      return;
    }

    if (generation !== current.generation || runtime !== current) return;

    if (!status.shouldTrack) {
      const locationPause = Boolean(status.reason && isLocationPauseReason(status.reason));
      const paused = status.reason === 'BREAK' || locationPause;
      await tearDown(current, !paused, { keepMonitor: locationPause });
      current.pauseReason = paused ? status.reason : null;
      current.permission = status.locationState.permission;
      if (locationPause) kickMonitor(current);
      publish({
        phase: current.recoveryRequired
          ? 'interrupted'
          : phaseFromLocationState(status.locationState.state, false, status.reason),
        permission: status.locationState.permission,
        backgroundAllowed: false,
        reason: status.reason,
        serverState: status.locationState,
        message: null,
      });
      return;
    }

    if (current.recoveryRequired) {
      // The server still believes the session is active, but the interruption
      // was not cleared. Never restart collection implicitly; the employee
      // must verify location and press Resume.
      await tearDown(current, false);
      current.mode = null;
      publish({
        phase: 'interrupted',
        permission: status.locationState.permission,
        backgroundAllowed: false,
        reason: 'LOCATION_UNAVAILABLE',
        serverState: status.locationState,
        message: null,
      });
      return;
    }

    if (!(await locationServicesEnabled())) {
      if (generation !== current.generation || runtime !== current) return;
      await pauseForLocation(current, 'LOCATION_DISABLED');
      return;
    }

    if (current.mode !== null) {
      const permissionState = await readPermissionState();

      if (permissionState.foreground !== 'granted') {
        current.pauseReason = 'PERMISSION_DENIED';
        current.permission = 'DENIED';
        await tearDown(current, false, { keepMonitor: true });
        ensureMonitor(current);
        const data = await reportTracking(
          identity,
          'PAUSED',
          'PERMISSION_DENIED',
          'DENIED',
          false,
          { persistOnFailure: true },
        );
        publish({
          phase: 'permission-denied',
          permission: 'DENIED',
          backgroundAllowed: false,
          reason: 'PERMISSION_DENIED',
          serverState: data?.locationState ?? status.locationState,
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
      current.pauseReason = null;

      const data = await reportTracking(
        identity,
        'ACTIVE',
        started.backgroundAllowed ? undefined : 'BACKGROUND_UNAVAILABLE',
        started.permission,
        started.backgroundAllowed,
        { persistOnFailure: true },
      );

      publish({
        phase:
          started.mode === 'background' ? 'active-background' : 'active-foreground',
        permission: started.permission,
        backgroundAllowed: started.backgroundAllowed,
        reason: started.backgroundAllowed ? null : 'BACKGROUND_UNAVAILABLE',
        serverState: data?.locationState ?? status.locationState,
        message: null,
      });

      await flushInternal(current);
    } catch (error) {
      if (generation !== current.generation || runtime !== current) return;

      current.mode = null;
      current.validated = false;
      if (error instanceof TrackingPermissionError) {
        await pauseForLocation(current, 'PERMISSION_DENIED');
        return;
      }

      if (error instanceof TrackingUnavailableError) {
        await pauseForLocation(current, error.reason);
        return;
      }

      // Tracking could not start for an unknown reason. Never leave the timer
      // running without location; the employee resumes explicitly afterwards.
      await pauseForLocation(current, 'LOCATION_UNAVAILABLE');
    }
  });
}

/**
 * Used when the client already sees a paused session, including after an app
 * restart. The server stays authoritative for why the timer paused; this never
 * resumes it.
 */
async function syncPausedStatus(identity: OnSiteTrackingIdentity): Promise<void> {
  let response: Awaited<ReturnType<typeof fetchAttendanceLocationStatus>>;
  try {
    response = await fetchAttendanceLocationStatus(identity.organizationId, identity.agent);
  } catch {
    return;
  }

  const status = response.data;
  const current = await ensureRuntime(identity);
  if (status.shouldTrack) {
    // The pause ended elsewhere (for example on the web); the next reconcile
    // starts tracking instead of resuming from a stale local view.
    return;
  }

  if (status.session) identity.applySession?.(status.session, response.serverTime);

  const locationPause = Boolean(status.reason && isLocationPauseReason(status.reason));
  const paused = status.reason === 'BREAK' || locationPause;

  current.pauseReason = paused ? status.reason : null;
  current.permission = status.locationState.permission;
  current.backgroundAllowed = false;
  await tearDown(current, !paused, { keepMonitor: locationPause });
  if (locationPause) kickMonitor(current);

  publish({
    phase: phaseFromLocationState(status.locationState.state, false, status.reason),
    permission: status.locationState.permission,
    backgroundAllowed: false,
    reason: status.reason,
    serverState: status.locationState,
    message: null,
  });
}

export function pauseOnSiteTracking(identity: OnSiteTrackingIdentity): Promise<void> {
  return enqueueOperation(async () => {
    const current = runtime;
    if (!current || !sameRuntimeIdentity(current, identity)) {
      await syncPausedStatus(identity);
      return;
    }

    if (current.recoveryRequired) {
      // A service/process interruption is only cleared by an explicit resume.
      current.applySession = identity.applySession ?? current.applySession;
      current.applyLocationPause =
        identity.applyLocationPause ?? current.applyLocationPause;
      return;
    }

    if (current.pauseReason && isLocationPauseReason(current.pauseReason)) {
      // Already paused for a location reason. Keep monitoring so the employee
      // can be told when location returns, and never relabel the pause as a
      // manual break.
      current.applySession = identity.applySession ?? current.applySession;
      current.applyLocationPause =
        identity.applyLocationPause ?? current.applyLocationPause;
      await tearDown(current, false, { keepMonitor: true });
      ensureMonitor(current);
      return;
    }

    if (current.pauseReason === 'BREAK' && current.mode === null) return;

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

    current.pauseReason = 'BREAK';
    const data = await reportTracking(
      identity,
      'PAUSED',
      'BREAK',
      permission,
      wasBackground,
      { persistOnFailure: true },
    );

    publish({
      phase: 'paused',
      permission,
      backgroundAllowed: false,
      reason: 'BREAK',
      serverState: data?.locationState ?? null,
      message: null,
    });
  });
}

export type LocationResumeResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'PERMISSION_DENIED' | 'LOCATION_DISABLED' | 'LOCATION_UNAVAILABLE' | 'NETWORK';
      message: string;
    };

/**
 * Preflight for the employee's explicit resume. It verifies the OS state and
 * sends one fresh fix; the server only lifts the pause after receiving that
 * fix, so a stale local belief can never resume the timer.
 */
export function resumeOnSiteTracking(
  identity: OnSiteTrackingIdentity,
): Promise<LocationResumeResult> {
  return enqueueOperation(async () => {
    const current = await ensureRuntime(identity);

    // Deliver a queued pause before the fresh fix advances the last sample.
    // Otherwise the server would anchor the pause to this new fix and count
    // the unverified gap as work.
    const pauseDelivered = await syncPendingReport(identity).catch(() => false);
    if (!pauseDelivered) {
      return {
        ok: false,
        reason: 'NETWORK',
        message:
          'The pause has not reached WorkZen yet. The timer stays paused; try again when you have a connection.',
      };
    }
    if (runtime !== current) {
      return {
        ok: false,
        reason: 'NETWORK',
        message: 'This session changed. Try again.',
      };
    }

    const permissionState = await readPermissionState();
    if (permissionState.foreground !== 'granted') {
      await pauseForLocation(current, 'PERMISSION_DENIED');
      return {
        ok: false,
        reason: 'PERMISSION_DENIED',
        message:
          'Location permission is not available. Allow location for WorkZen, then try again.',
      };
    }

    if (!(await locationServicesEnabled())) {
      await pauseForLocation(current, 'LOCATION_DISABLED');
      return {
        ok: false,
        reason: 'LOCATION_DISABLED',
        message: 'Location services are turned off. Enable them, then try again.',
      };
    }

    let position: Location.LocationObject;
    try {
      position = await withTimeout(
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        LOCATION_RESUME_FIX_TIMEOUT_MS,
      );
    } catch {
      await pauseForLocation(current, 'LOCATION_UNAVAILABLE');
      return {
        ok: false,
        reason: 'LOCATION_UNAVAILABLE',
        message:
          'A current location fix is not available yet. Move near a window or outdoors, then try again.',
      };
    }

    const sample = createQueuedLocationSample({
      clientSampleId: Crypto.randomUUID(),
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracyMeters: position.coords.accuracy,
      capturedAtMs: position.timestamp || Date.now(),
    });
    if (!sample) {
      return {
        ok: false,
        reason: 'LOCATION_UNAVAILABLE',
        message: 'The location reading was not accurate enough. Move to a clearer spot and try again.',
      };
    }

    try {
      const response = await ingestAttendanceLocationSamples(
        identity.organizationId,
        identity.agent,
        { sessionId: identity.sessionId, samples: [sample] },
      );
      const result = response.data.results[0];
      if (!result || result.status === 'REJECTED') {
        return {
          ok: false,
          reason: 'LOCATION_UNAVAILABLE',
          message: 'WorkZen could not record this location. Try again in a moment.',
        };
      }
    } catch (error) {
      if (terminalTrackingError(error)) {
        const ended = isSessionExpiredError(error);
        await tearDown(current, true);
        if (runtime === current) runtime = null;
        publish({
          phase: ended ? 'stopped' : 'error',
          permission: ended ? 'UNKNOWN' : current.permission,
          backgroundAllowed: false,
          reason: null,
          message: ended ? null : 'This session can no longer be resumed.',
        });
        return {
          ok: false,
          reason: 'NETWORK',
          message: ended
            ? 'This session has already ended.'
            : 'This session can no longer be resumed.',
        };
      }
      return {
        ok: false,
        reason: 'NETWORK',
        message:
          'The location update did not reach WorkZen. The timer stays paused; try again when you have a connection.',
      };
    }

    current.recoveryRequired = false;
    publish({
      phase: 'location-restored',
      permission:
        permissionState.background === 'granted' ? 'ALWAYS' : 'FOREGROUND_ONLY',
      backgroundAllowed: false,
      reason: current.pauseReason,
      message: null,
    });
    return { ok: true };
  });
}

/**
 * "Enable Location" action. It prompts the OS when the permission can still be
 * requested, and otherwise deep-links to the screen that can actually change
 * the setting. It never resumes the timer.
 */
export function requestOnSiteLocationAccess(
  identity: OnSiteTrackingIdentity,
): Promise<void> {
  return enqueueOperation(async () => {
    await ensureRuntime(identity);
    const state = await readPermissionState();

    if (state.foreground !== 'granted') {
      if (state.foregroundCanAskAgain) {
        await Location.requestForegroundPermissionsAsync().catch(() => undefined);
        return;
      }
      await openAppPermissionSettings();
      return;
    }

    if (!(await locationServicesEnabled())) {
      await openLocationServicesSettings();
    }
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
    stopMonitor(current);
    current.mode = null;
    current.validated = false;

    if (options.report) {
      await reportTracking(identity, 'STOPPED', 'SESSION_ENDED', current.permission, false);
    }

    await clearLocationQueue(current.organizationId, current.userId).catch(() => undefined);
    await clearPendingLocationReport(current.organizationId, current.userId).catch(
      () => undefined,
    );
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
    await syncPendingReport(identity).catch(() => undefined);
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
        const locationPause = Boolean(status.reason && isLocationPauseReason(status.reason));
        const paused = status.reason === 'BREAK' || locationPause;
        await tearDown(current, !paused);
        current.pauseReason = paused ? status.reason : null;
        if (!paused && runtime === current) runtime = null;
        publish({
          phase: phaseFromLocationState(status.locationState.state, false, status.reason),
          permission: status.locationState.permission,
          backgroundAllowed: false,
          reason: status.reason,
          serverState: status.locationState,
          message: null,
        });
        return;
      }

      current.validated = true;
      current.pauseReason = null;
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

    if (runtime === current && !current.pauseReason) {
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
