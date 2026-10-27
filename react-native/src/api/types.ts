export type MembershipRole = 'OWNER' | 'ADMIN' | 'MANAGER' | 'EMPLOYEE';
export type MembershipStatus = 'ACTIVE' | 'SUSPENDED' | 'REMOVED';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  status: string;
  timezone?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Membership {
  id: string;
  organizationId: string;
  userId: string;
  role: MembershipRole;
  status: MembershipStatus;
  createdAt: string;
  updatedAt: string;
  organization?: Organization;
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSessionPayload {
  user: PublicUser;
  memberships: Membership[];
  client: 'browser' | 'desktop' | 'mobile';
  csrfToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  expiresIn: number;
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
}

export interface CurrentUserPayload {
  user: PublicUser;
  memberships: Membership[];
  session: {
    id: string;
    transport: 'cookie' | 'bearer';
    accessExpiresAt: string;
    refreshExpiresAt: string;
  };
}

export interface DesktopAgentSummary {
  id: string;
  organizationId: string;
  userId: string;
  deviceId: string;
  name: string;
  platform: string | null;
  osVersion: string | null;
  appVersion: string | null;
  clientType: 'ELECTRON' | 'MOBILE';
  status: 'ACTIVE' | 'REVOKED';
  online: boolean;
  lastSeenAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RegisterAgentPayload {
  agent: DesktopAgentSummary;
  agentKey: string;
  rotated: boolean;
  notice: string;
}

export type TimeSessionStatus = 'ACTIVE' | 'ON_BREAK' | 'STOPPED';
export type TimeSessionSource = 'ONLINE' | 'OFFLINE';

export interface BreakSummary {
  id: string;
  organizationId: string;
  sessionId: string;
  startedAt: string;
  endedAt: string | null;
  status: 'ACTIVE' | 'ENDED';
  durationSeconds: number;
  createdAt: string;
  updatedAt: string;
}

export interface TimeSessionSummary {
  id: string;
  organizationId: string;
  employeeId: string;
  desktopAgentId: string | null;
  startedAt: string;
  endedAt: string | null;
  status: TimeSessionStatus;
  source: TimeSessionSource;
  lastHeartbeatAt: string;
  durationSeconds: number;
  heartbeatFresh: boolean;
  activeBreak: BreakSummary | null;
  breaks?: BreakSummary[];
  desktopAgent?: {
    id: string;
    name: string;
    platform: string | null;
    status: 'ACTIVE' | 'REVOKED';
  };
  employee?: {
    id: string;
    name: string;
    email: string;
  };
  createdAt: string;
  updatedAt: string;
}

export type AttendanceWorkMode = 'WFO' | 'WFH' | 'ON_SITE';
export type AttendanceEvidenceKind = 'SELFIE' | 'SITE_PHOTO';
export type AttendanceEvidenceStatus = 'PENDING' | 'UPLOADED' | 'ATTACHED';

export interface AttendanceEvidenceSummary {
  id: string;
  organizationId: string;
  employeeId: string;
  desktopAgentId: string;
  kind: AttendanceEvidenceKind;
  status: AttendanceEvidenceStatus;
  contentType: string;
  fileSizeBytes: number | null;
  capturedAt: string | null;
  uploadedAt: string | null;
  expiresAt: string;
  attachedSessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AttendanceLocation {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  recordedAt: string;
}

export interface AttendanceCheckInSummary {
  id: string;
  organizationId: string;
  employeeId: string;
  desktopAgentId: string;
  sessionId: string;
  workMode: AttendanceWorkMode;
  checkInRequestId: string;
  location: AttendanceLocation | null;
  selfie: AttendanceEvidenceSummary | null;
  sitePhoto: AttendanceEvidenceSummary | null;
  createdAt: string;
  updatedAt: string;
}

export interface CurrentAttendancePayload {
  checkIn: AttendanceCheckInSummary | null;
  session: TimeSessionSummary | null;
}

export interface AttendanceUploadTarget {
  method: string;
  url: string;
  headers: Record<string, string>;
  requiredHeaders: Record<string, string>;
  requiresAgentAuth: boolean;
  expiresAt: string;
  maxBytes: number;
  contentType: string;
}

export interface CreateEvidenceResponse {
  data: {
    evidence: AttendanceEvidenceSummary;
    upload: AttendanceUploadTarget;
  };
  serverTime: string;
}

export interface UploadEvidenceResponse {
  data: { evidence: AttendanceEvidenceSummary };
  serverTime: string;
}

export interface CheckInResponse {
  data: {
    checkIn: AttendanceCheckInSummary;
    session: TimeSessionSummary;
    autoClosedSessionId: string | null;
    replayed: boolean;
  };
  serverTime: string;
}

export interface BreakActionResponse {
  data: {
    session: TimeSessionSummary;
    breakId: string;
    serverTime: string;
  };
}

export interface CheckoutResponse {
  data: {
    session: TimeSessionSummary;
    serverTime: string;
  };
}

export type AttendanceLocationTrackingStatus = 'ACTIVE' | 'PAUSED' | 'STOPPED';
export type AttendanceLocationPermissionState =
  | 'ALWAYS'
  | 'FOREGROUND_ONLY'
  | 'DENIED'
  | 'UNKNOWN';
export type AttendanceLocationState =
  | 'ACTIVE'
  | 'PAUSED'
  | 'STOPPED'
  | 'PERMISSION_UNAVAILABLE'
  | 'STALE';
export type AttendanceLocationSampleSource = 'DEVICE' | 'UNKNOWN';

export interface AttendanceLocationTrackingSummary {
  status: AttendanceLocationTrackingStatus;
  reason: string | null;
  permission: AttendanceLocationPermissionState;
  backgroundAllowed: boolean;
  lastSampleAt: string | null;
  lastReportedAt: string;
  updatedAt: string;
}

export interface AttendanceLocationStateSummary {
  state: AttendanceLocationState;
  reason: string | null;
  permission: AttendanceLocationPermissionState;
  backgroundAllowed: boolean;
  lastSampleAt: string | null;
  lastReportedAt: string | null;
  staleAfterSeconds: number;
}

export interface AttendanceLocationStatusResponse {
  data: {
    shouldTrack: boolean;
    reason: string | null;
    workMode: AttendanceWorkMode | null;
    checkIn: {
      id: string;
      workMode: AttendanceWorkMode;
      createdAt: string;
    } | null;
    session: TimeSessionSummary | null;
    tracking: AttendanceLocationTrackingSummary | null;
    locationState: AttendanceLocationStateSummary;
  };
  serverTime: string;
}

export interface AttendanceLocationStatusInput {
  sessionId: string;
  state: AttendanceLocationTrackingStatus;
  reason?: string;
  permission: AttendanceLocationPermissionState;
  backgroundAllowed: boolean;
}

export interface ReportAttendanceLocationStatusResponse {
  data: {
    tracking: AttendanceLocationTrackingSummary;
    session: TimeSessionSummary;
    locationState: AttendanceLocationStateSummary;
  };
  serverTime: string;
}

export interface AttendanceLocationSampleInput {
  clientSampleId: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  capturedAt: string;
  source?: AttendanceLocationSampleSource;
}

export interface AttendanceLocationSamplesInput {
  sessionId: string;
  samples: AttendanceLocationSampleInput[];
}

export interface AttendanceLocationSampleResult {
  clientSampleId: string;
  status: 'ACCEPTED' | 'DUPLICATE' | 'REJECTED';
  code?: string;
}

export interface IngestAttendanceLocationSamplesResponse {
  data: {
    sessionId: string;
    accepted: number;
    duplicates: number;
    rejected: number;
    results: AttendanceLocationSampleResult[];
    session: TimeSessionSummary;
  };
  serverTime: string;
}

export interface CreateAttendanceEvidenceInput {
  kind: AttendanceEvidenceKind;
  contentType: 'image/jpeg' | 'image/png';
  capturedAt?: string;
}

export interface AttendanceCheckInInput {
  checkInRequestId: string;
  workMode: AttendanceWorkMode;
  selfieEvidenceId?: string;
  sitePhotoEvidenceId?: string;
  location?: AttendanceLocation;
}

export interface ServerEnvelope<T> {
  data: T;
  serverTime?: string;
}

export interface CurrentAttendanceResponse {
  data: CurrentAttendancePayload;
  serverTime: string;
}

export interface HeartbeatResponse {
  data: {
    session: TimeSessionSummary;
    agentLastSeenAt: string;
    serverTime: string;
  };
}

export interface ApiErrorDetail {
  path?: string;
  message?: string;
  code?: string;
}

export interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: ApiErrorDetail[];
  };
  requestId?: string;
}
