import type { AuthSession, SignInCredentials } from '@/types/auth'
import type {
  ActivityTrackingStatus,
  TrackingOperationResult,
  TrackingRuntimeStatus,
  TrackingSnapshot
} from '@/types/electron'
import type {
  ActivityEvent,
  ActivityEventInput,
  ApiBreak,
  ApiTimeSession,
  DateRange,
  ScreenshotMetadata,
  ScreenshotUploadRequest,
  ScreenshotUploadTicket,
  SyncFlushResult,
  SyncRecord,
  SyncStatus
} from '@/types/api'

/**
 * Auth adapters may cache a session in memory. Production implementations must
 * keep credentials and tokens out of localStorage and use an OS-protected
 * store. The Electron adapter delegates to the main process over allowlisted IPC.
 */
export interface AuthService {
  restoreSession(): Promise<AuthSession | null>
  signIn(credentials: SignInCredentials): Promise<AuthSession>
  signOut(): Promise<void>
  /** Fired when the main process invalidates or restores a session. */
  onSessionChanged?(listener: (session: AuthSession | null) => void): () => void
}

/**
 * Renderer-facing tracking adapter. Server authority, credentials, offline
 * queues and heartbeats live in the Electron main process.
 */
export interface DesktopTrackingService {
  restore(): Promise<TrackingSnapshot | null>
  start(sessionId: string, startedAt: string): Promise<TrackingOperationResult>
  startBreak(
    sessionId: string,
    breakId: string,
    startedAt: string
  ): Promise<TrackingOperationResult>
  endBreak(sessionId: string, breakId: string, endedAt: string): Promise<TrackingOperationResult>
  stop(sessionId: string, endedAt: string): Promise<TrackingOperationResult>
  refreshCurrent(): Promise<TrackingSnapshot | null>
  getStatus(): Promise<TrackingRuntimeStatus>
  onStateChanged(listener: (snapshot: TrackingSnapshot) => void): () => void
  onStatusChanged(listener: (status: TrackingRuntimeStatus) => void): () => void
}

/**
 * Read-only, display-safe view of the organization's activity policy and the
 * local collector state. Collection itself never starts from the renderer.
 */
export interface DesktopActivityService {
  getStatus(): Promise<ActivityTrackingStatus>
  onStatusChanged(listener: (status: ActivityTrackingStatus) => void): () => void
}

/**
 * Server-derived identity only. Do not add organizationId, employeeId or role
 * parameters that a caller could spoof.
 */
export interface TimeTrackingService {
  listSessions(range: DateRange): Promise<ApiTimeSession[]>
  startSession(startedAt: string): Promise<ApiTimeSession>
  endSession(sessionId: string, endedAt: string): Promise<ApiTimeSession>
  startBreak(sessionId: string, startedAt: string): Promise<ApiBreak>
  endBreak(sessionId: string, breakId: string, endedAt: string): Promise<ApiBreak>
}

export interface ActivityCollectionService {
  recordEvents(events: ActivityEventInput[]): Promise<void>
  listEvents(range: DateRange): Promise<ActivityEvent[]>
}

/**
 * Intentionally has no capture method yet. Real capture must be gated by a
 * disclosed organization policy and a visible employee-facing indicator.
 */
export interface ScreenshotService {
  listScreenshots(range: DateRange): Promise<ScreenshotMetadata[]>
  requestUpload(request: ScreenshotUploadRequest): Promise<ScreenshotUploadTicket>
}

export interface SyncService {
  getStatus(): Promise<SyncStatus>
  queue(records: SyncRecord[]): Promise<void>
  flush(): Promise<SyncFlushResult>
}
