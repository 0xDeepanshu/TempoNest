import type { AuthSession, SignInCredentials } from './auth'
import type { TrackingStatus } from './tracking'

/**
 * The deliberately small API surface exposed to the renderer through the
 * preload script. No Node.js primitives, access tokens, refresh tokens or
 * desktop-agent keys are exposed.
 */
export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
}

/** A backend break mapped to the display-safe shape used by the renderer. */
export interface ServerBreakSnapshot {
  id: string
  startedAt: string
  endedAt: string | null
}

/** The authoritative backend session, or a local optimistic copy while offline. */
export interface ServerSessionSnapshot {
  id: string
  startedAt: string
  endedAt: string | null
  breaks: ServerBreakSnapshot[]
  /** Whether this session currently exists only in the durable offline queue. */
  pendingSync?: boolean
}

export interface TrackingSnapshot {
  status: TrackingStatus
  session: ServerSessionSnapshot | null
  serverTime: string | null
  /**
   * Set when `idle` is inferred from a durable queued stop while the server is
   * unreachable, so the renderer can close the cached session at the time the
   * employee stopped it instead of discarding those minutes.
   */
  pendingStopAt?: string
  /**
   * Every server session overlapping the current local day, including the
   * active session and its breaks. Absent on state events that did not load
   * totals, where the renderer keeps its last reconciled list.
   */
  todaySessions?: ServerSessionSnapshot[]
  /** Set when today's sessions could not be loaded; the totals are unverified. */
  totalsError?: UserFacingError
}

export type TrackingConnectionState = 'online' | 'offline' | 'blocked' | 'unknown'

export interface TrackingRuntimeStatus {
  connection: TrackingConnectionState
  message: string | null
  pendingEvents: number
  serverTime: string | null
}

export type MonitoringPhase =
  | 'IDLE'
  | 'REQUESTED'
  | 'CLAIMING'
  | 'CAPTURING'
  | 'UPLOADING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED'

/**
 * Display-safe monitoring state. It intentionally contains no request token,
 * upload URL, storage key, agent key, or image bytes.
 */
export interface MonitoringStatus {
  policyKnown: boolean
  monitoringEnabled: boolean
  disclosureText: string | null
  acknowledgementRequired: boolean
  acknowledged: boolean
  phase: MonitoringPhase
  activeRequestId: string | null
  lastEventAt: string | null
  message: string | null
}

export interface MonitoringBridge {
  getStatus: () => Promise<MonitoringStatus>
  onStatusChanged: (listener: (status: MonitoringStatus) => void) => () => void
}

export type ForegroundDetectionState = 'supported' | 'unavailable'

/**
 * Display-safe activity tracking state. Contains no tokens, credentials,
 * window titles, URLs, keystrokes or clipboard data.
 */
export interface ActivityTrackingStatus {
  policyKnown: boolean
  appTrackingEnabled: boolean
  idleDetectionEnabled: boolean
  productivityClassificationEnabled: boolean
  idleThresholdMinutes: number | null
  policyVersion: number | null
  foregroundDetection: ForegroundDetectionState
  foregroundDetectionMessage: string | null
  appCollectionActive: boolean
  idleCollectionActive: boolean
  pendingAppEvents: number
  pendingIdleIntervals: number
  lastUploadAt: string | null
  message: string | null
}

export interface ActivityBridge {
  getStatus: () => Promise<ActivityTrackingStatus>
  onStatusChanged: (listener: (status: ActivityTrackingStatus) => void) => () => void
}

export interface UserFacingError {
  code: string
  message: string
}

export interface TrackingOperationResult {
  /** The latest server snapshot, when one is known. */
  snapshot: TrackingSnapshot | null
  /** The session returned by a successful stop, for completed-timer reconciliation. */
  completedSession: ServerSessionSnapshot | null
  /** True when the change was persisted locally and will be sent by `/sync`. */
  queued: boolean
  error: UserFacingError | null
}

export interface AuthBridge {
  restoreSession: () => Promise<AuthSession | null>
  signIn: (credentials: SignInCredentials) => Promise<AuthSession>
  signOut: () => Promise<void>
  onSessionChanged: (listener: (session: AuthSession | null) => void) => () => void
}

export interface TrackingBridge {
  /** Reconcile the local display cache with the authoritative server state. */
  restore: () => Promise<TrackingSnapshot | null>
  start: (sessionId: string, startedAt: string) => Promise<TrackingOperationResult>
  startBreak: (
    sessionId: string,
    breakId: string,
    startedAt: string
  ) => Promise<TrackingOperationResult>
  endBreak: (
    sessionId: string,
    breakId: string,
    endedAt: string
  ) => Promise<TrackingOperationResult>
  stop: (sessionId: string, endedAt: string) => Promise<TrackingOperationResult>
  refreshCurrent: () => Promise<TrackingSnapshot | null>
  getStatus: () => Promise<TrackingRuntimeStatus>
  onStateChanged: (listener: (snapshot: TrackingSnapshot) => void) => () => void
  onStatusChanged: (listener: (status: TrackingRuntimeStatus) => void) => () => void
}

export interface AppBridge {
  platform: string
  versions: {
    electron: string
    chrome: string
    node: string
  }
  getAppInfo: () => Promise<AppInfo>
  auth: AuthBridge
  tracking: TrackingBridge
  monitoring: MonitoringBridge
  activity: ActivityBridge
}
