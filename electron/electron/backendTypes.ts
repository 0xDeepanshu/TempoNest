/** Exact response shapes used by the Electron main process. */

export interface BackendUser {
  id: string
  name: string
  email: string
  status: string
}

export interface BackendOrganization {
  id: string
  name: string
  slug: string
  status?: string
  timezone?: string
}

export interface BackendMembership {
  id: string
  organizationId: string
  userId: string
  role: 'OWNER' | 'ADMIN' | 'MANAGER' | 'EMPLOYEE'
  status: string
  organization: BackendOrganization
}

export interface BackendAuthPayload {
  user: BackendUser
  memberships: BackendMembership[]
  client: 'browser' | 'desktop'
  accessToken?: string
  refreshToken?: string
  tokenType?: 'Bearer'
  accessTokenExpiresAt: string
  refreshTokenExpiresAt: string
  expiresIn: number
}

export interface BackendAgent {
  id: string
  organizationId: string
  userId: string
  deviceId: string
  name: string
  platform: string | null
  status: 'ACTIVE' | 'REVOKED'
  online: boolean
}

export interface BackendAgentRegistration {
  agent: BackendAgent
  agentKey: string
  rotated: boolean
  notice: string
}

export interface BackendBreak {
  id: string
  sessionId: string
  startedAt: string
  endedAt: string | null
  status?: 'ACTIVE' | 'ENDED'
  durationSeconds?: number
}

export interface BackendTimeSession {
  id: string
  organizationId: string
  employeeId: string
  desktopAgentId: string
  startedAt: string
  endedAt: string | null
  status: 'ACTIVE' | 'ON_BREAK' | 'STOPPED'
  source: 'ONLINE' | 'OFFLINE'
  lastHeartbeatAt: string | null
  heartbeatFresh: boolean
  activeBreak: BackendBreak | null
  breaks?: BackendBreak[]
  createdAt: string
  updatedAt: string
}

export interface BackendSessionEnvelope {
  session: BackendTimeSession
  serverTime: string
}

export interface BackendCurrentEnvelope {
  session: BackendTimeSession | null
  serverTime: string
}

export interface BackendStartEnvelope {
  session: BackendTimeSession
  autoClosedSessionId: string | null
  serverTime: string
}

export interface BackendBreakEnvelope {
  session: BackendTimeSession
  breakId: string
  serverTime: string
}

/** Explicit administrator screenshot command received over the agent socket. */
export interface ScreenshotCommand {
  type: 'screenshot.request'
  requestId: string
  sessionId: string
  requestedAt: string
  expiresAt: string
  maxBytes: number
  allowedContentTypes: string[]
  requiresClaim: boolean
}

export interface PendingScreenshotRequest {
  requestId: string
  sessionId: string
  status: 'PENDING' | 'CLAIMED'
  requestedAt: string
  expiresAt: string
  claimedAt: string | null
  expectedContentType: string | null
  uploadedAt: string | null
}

export interface ScreenshotUploadAuthorization {
  method: 'PUT' | 'POST'
  url: string
  headers?: Record<string, string>
  requiredHeaders?: Record<string, string>
  requiresAgentAuth: boolean
  expiresAt: string
  maxBytes: number
  contentType: string
}

export interface ScreenshotClaimResponse {
  requestId: string
  status: 'CLAIMED'
  claimedAt: string
  expiresAt: string
  upload: ScreenshotUploadAuthorization
}

export interface ScreenshotCompleteResponse {
  screenshot: {
    id: string
    capturedAt: string
    contentType: string
    fileSizeBytes: number
  }
}

export interface ScreenshotPolicyDisclosure {
  enabled: boolean
  retentionDays: number
  disclosure: {
    version: string
    text: string
    acknowledgementRequired: boolean
    acknowledged: boolean
    acknowledgedAt: string | null
  }
  updatedAt: string
}

/** Server -> agent command that opens the dedicated binary live stream. */
export interface ScreenLiveStartCommand {
  type: 'screen.live.start'
  liveSessionId: string
  timeSessionId: string
  expiresAt: string
  maxFps: number
  maxFrameWidth: number
  maxFrameBytes: number
  streamPath: string
}

/** Re-delivered on agent reconnect so capture can resume after a drop. */
export interface PendingScreenLiveSession {
  liveSessionId: string
  timeSessionId: string
  expiresAt: string
  maxFps: number
  maxFrameWidth: number
  maxFrameBytes: number
  streamPath: string
}

export interface ScreenLiveSocketError {
  code?: string
  message?: string
  liveSessionId?: string
}

export type OfflineEventType = 'SESSION_START' | 'BREAK_START' | 'BREAK_END' | 'SESSION_STOP'

export interface OfflineEvent {
  eventId: string
  type: OfflineEventType
  occurredAt: string
  sessionId: string
}

export interface OfflineSyncResult {
  deviceId: string
  serverTime: string
  results: Array<{
    eventId: string
    type: OfflineEventType
    status: 'applied' | 'duplicate' | 'conflict'
    code?: string
    message?: string
    originalStatus?: 'APPLIED' | 'CONFLICT'
    result?: Record<string, unknown>
  }>
}
