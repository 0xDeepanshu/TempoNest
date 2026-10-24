/**
 * Server-facing records for the planned Express + PostgreSQL API.
 *
 * Authorization is deliberately absent from request parameters below. The
 * server must derive the employee and organization from the authenticated
 * session and check tenant access for every request.
 */

export type IsoTimestamp = string

export interface DateRange {
  from: IsoTimestamp
  to: IsoTimestamp
}

export interface ApiBreak {
  id: string
  sessionId: string
  startedAt: IsoTimestamp
  endedAt: IsoTimestamp | null
}

export interface ApiTimeSession {
  id: string
  employeeId: string
  /** Returned by the server for display; never trusted as an access grant. */
  organizationId: string
  startedAt: IsoTimestamp
  endedAt: IsoTimestamp | null
  breaks: ApiBreak[]
}

export type ActivityEventKind = 'application_focus' | 'idle_period'

export interface ActivityEvent {
  id: string
  employeeId: string
  sessionId: string
  kind: ActivityEventKind
  applicationName: string | null
  startedAt: IsoTimestamp
  endedAt: IsoTimestamp
}

export type ActivityEventInput = Omit<ActivityEvent, 'id'>

export type ScreenshotUploadState = 'pending' | 'uploaded' | 'failed' | 'deleted'

export interface ScreenshotMetadata {
  id: string
  employeeId: string
  sessionId: string
  capturedAt: IsoTimestamp
  width: number
  height: number
  mimeType: string
  fileSizeBytes: number
  retentionExpiresAt: IsoTimestamp
  uploadState: ScreenshotUploadState
  uploadedAt: IsoTimestamp | null
}

export interface ScreenshotUploadRequest {
  sessionId: string
  capturedAt: IsoTimestamp
  width: number
  height: number
  mimeType: string
  fileSizeBytes: number
}

export interface ScreenshotUploadTicket {
  screenshotId: string
  /** `null` while capture/upload is intentionally disabled in this phase. */
  uploadUrl: string | null
  expiresAt: IsoTimestamp | null
  mode: 'local-only' | 'direct-upload'
}

export type SyncState = 'local_only' | 'syncing' | 'synced' | 'error'

export interface SyncStatus {
  state: SyncState
  lastSyncedAt: IsoTimestamp | null
  pendingRecords: number
  detail: string | null
}

export type SyncRecordType = 'time_session' | 'activity_event' | 'screenshot_metadata'

export interface SyncRecord {
  id: string
  type: SyncRecordType
  queuedAt: IsoTimestamp
}

export interface SyncFlushResult {
  uploaded: number
  remaining: number
  syncedAt: IsoTimestamp | null
}
