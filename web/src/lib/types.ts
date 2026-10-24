export type Role = "OWNER" | "ADMIN" | "MANAGER" | "EMPLOYEE";

export type MembershipStatus = "ACTIVE" | "SUSPENDED" | "REMOVED";
export type OrganizationStatus = "ACTIVE" | "SUSPENDED";
export type UserStatus = "ACTIVE" | "DISABLED";

export type SessionStatus = "ACTIVE" | "ON_BREAK" | "STOPPED";
export type SessionSource = "ONLINE" | "OFFLINE";
export type TrackingState = "WORKING" | "ON_BREAK" | "ONLINE" | "OFFLINE";
export type CorrectionStatus = "PENDING" | "APPROVED" | "REJECTED";
export type CorrectionRequestType = "CREATE_SESSION" | "UPDATE_SESSION";
export type ScreenshotRequestStatus =
  | "PENDING"
  | "CLAIMED"
  | "COMPLETED"
  | "FAILED"
  | "EXPIRED"
  | "CANCELLED";

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  status: UserStatus;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  status: OrganizationStatus;
  timezone: string;
  createdAt: string;
  updatedAt: string;
}

export interface MembershipSummary {
  id: string;
  organizationId: string;
  userId: string;
  role: Role;
  status: MembershipStatus;
  createdAt: string;
  updatedAt: string;
  organization?: Organization;
  user?: Pick<PublicUser, "id" | "name" | "email" | "status">;
}

export interface SessionInfo {
  id: string;
  transport: "cookie" | "bearer";
  accessExpiresAt: string;
  refreshExpiresAt: string;
}

export interface SessionData {
  user: PublicUser;
  memberships: MembershipSummary[];
  session: SessionInfo;
}

export interface LoginData {
  user: PublicUser;
  memberships: MembershipSummary[];
  client: "browser" | "desktop";
  csrfToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  expiresIn: number;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface BreakSummary {
  id: string;
  organizationId: string;
  sessionId: string;
  startedAt: string;
  endedAt: string | null;
  status: "ACTIVE" | "ENDED";
  durationSeconds: number;
  createdAt: string;
  updatedAt: string;
}

export interface TimeSession {
  id: string;
  organizationId: string;
  employeeId: string;
  desktopAgentId: string | null;
  startedAt: string;
  endedAt: string | null;
  status: SessionStatus;
  source: SessionSource;
  lastHeartbeatAt: string | null;
  durationSeconds: number;
  heartbeatFresh: boolean;
  activeBreak: BreakSummary | null;
  breaks?: BreakSummary[];
  desktopAgent?: {
    id: string;
    name: string;
    platform: string;
    status: "ACTIVE" | "REVOKED";
  };
  employee?: {
    id: string;
    name: string;
    email: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface SessionReportRow extends TimeSession {
  breakSeconds: number;
  workingSeconds: number;
}

export interface CurrentSessionResponse {
  data: {
    session: TimeSession | null;
    serverTime: string;
  };
}

export interface SessionsResponse extends Paginated<TimeSession> {
  serverTime: string;
}

export interface AttendancePeriod {
  periodStart: string;
  periodEnd: string;
  workedSeconds: number;
  breakSeconds: number;
  sessionCount: number;
  activeDays: number;
  daysIncluded: number;
  firstStartedAt: string | null;
  lastEndedAt: string | null;
}

export interface AttendanceSummary {
  employeeId: string;
  period: AttendanceSummaryPeriod;
  from: string;
  to: string;
  timezone: string;
  totals: {
    workedSeconds: number;
    breakSeconds: number;
    sessionCount: number;
    activeDays: number;
    firstStartedAt: string | null;
    lastEndedAt: string | null;
  };
  periods: AttendancePeriod[];
}

export type AttendanceSummaryPeriod = "daily" | "weekly" | "monthly";

export interface CorrectionBreak {
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
}

export interface CorrectionOriginal {
  sessionId: string;
  startedAt: string;
  endedAt: string | null;
  breaks: { startedAt: string; endedAt: string | null }[];
}

export interface AttendanceCorrection {
  id: string;
  organizationId: string;
  employeeId: string;
  timeSessionId: string | null;
  requestType: CorrectionRequestType;
  workDate: string;
  requestedStartedAt: string;
  requestedEndedAt: string;
  requestedBreaks: CorrectionBreak[];
  requestedBreakSeconds: number;
  reason: string;
  status: CorrectionStatus;
  original: CorrectionOriginal | null;
  applied: CorrectionOriginal | null;
  resultingSessionId: string | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  reviewerNote: string | null;
  rejectionReason: string | null;
  employee?: { id: string; name: string; email: string };
  reviewer?: { id: string; name: string; email: string };
  createdAt: string;
  updatedAt: string;
}

export interface CorrectionsListResponse extends Paginated<AttendanceCorrection> {
  serverTime: string;
}

export interface TrackingStatusRow {
  employee: PublicUser;
  state: TrackingState;
  online: boolean;
  heartbeatStale: boolean | null;
  activeSession: TimeSession | null;
  lastHeartbeatAt: string | null;
  lastSeenAt: string | null;
  agent: {
    id: string;
    userId: string;
    deviceId: string;
    name: string;
    platform: string;
    osVersion: string | null;
    appVersion: string | null;
    status: "ACTIVE" | "REVOKED";
    online: boolean;
    lastSeenAt: string | null;
    lastConnectedAt: string | null;
    lastDisconnectedAt: string | null;
    revokedAt: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
}

export interface TrackingStatusResponse extends Paginated<TrackingStatusRow> {
  timezone: string;
  heartbeatStaleAfterSeconds: number;
  serverTime: string;
}

export interface DailyReport {
  employeeId: string;
  from: string;
  to: string;
  timezone: string;
  days: {
    date: string;
    employeeId: string;
    workedSeconds: number;
    breakSeconds: number;
    sessionCount: number;
    firstStartedAt: string | null;
    lastEndedAt: string | null;
  }[];
}

export interface SessionReportResponse extends Paginated<SessionReportRow> {
  from: string;
  to: string;
  timezone: string;
}

export interface ApplicationUsageRow {
  applicationIdentifier: string;
  applicationName: string;
  totalSeconds: number;
  percentageOfTrackedTime: number;
  eventCount: number;
  sessionCount: number;
}

export interface ApplicationUsageResponse extends Paginated<ApplicationUsageRow> {
  employeeId: string;
  from: string;
  to: string;
  timezone: string;
  trackedWorkingSeconds: number;
  totalApplicationSeconds: number;
  disclaimer: string;
}

export interface ApplicationTimelineRow {
  activityId: string;
  sessionId: string;
  applicationIdentifier: string;
  applicationName: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
}

export interface ApplicationTimelineResponse extends Paginated<ApplicationTimelineRow> {
  employeeId: string;
  from: string;
  to: string;
  timezone: string;
  disclaimer: string;
}

export interface OrganizationDetails {
  organization: Organization;
  membership: {
    id: string;
    role: Role;
    status: MembershipStatus;
  };
  memberCount: number;
}

export interface ScreenshotUserSummary {
  id: string;
  name: string;
  email: string;
}

export interface ScreenshotSummary {
  id: string;
  organizationId: string;
  employeeId: string;
  timeSessionId: string | null;
  screenshotRequestId: string;
  requestingAdminId: string | null;
  capturedAt: string;
  contentType: string;
  fileSizeBytes: number;
  retentionExpiresAt: string;
  createdAt: string;
  updatedAt: string;
  employee?: ScreenshotUserSummary;
  requestingAdmin?: ScreenshotUserSummary;
}

export interface ScreenshotRequestSummary {
  id: string;
  organizationId: string;
  employeeId: string;
  requestingAdminId: string | null;
  desktopAgentId: string | null;
  timeSessionId: string | null;
  status: ScreenshotRequestStatus;
  requestedAt: string;
  expiresAt: string;
  acknowledgedAt: string | null;
  claimedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  failure: { code: string; message: string | null } | null;
  canCancel: boolean;
  employee?: ScreenshotUserSummary;
  requestingAdmin?: ScreenshotUserSummary;
  desktopAgent?: {
    id: string;
    name: string;
    platform: string;
    status: "ACTIVE" | "REVOKED";
    online: boolean;
  };
  screenshot?: ScreenshotSummary;
  createdAt: string;
  updatedAt: string;
}

export interface ScreenshotRequestsResponse extends Paginated<ScreenshotRequestSummary> {
  serverTime: string;
}

export interface ScreenshotsResponse extends Paginated<ScreenshotSummary> {
  serverTime: string;
}

export interface ScreenshotRequestCreateResponse {
  data: {
    request: ScreenshotRequestSummary;
    replayed: boolean;
    agentOnline: boolean;
    delivered: boolean;
  };
  serverTime: string;
}

export interface ScreenshotAccessResponse {
  data: {
    screenshot: ScreenshotSummary;
    url: string;
    expiresAt: string;
  };
  serverTime: string;
}

export interface ScreenshotPolicy {
  organizationId: string;
  enabled: boolean;
  requestRoles: Role[];
  viewRoles: Role[];
  requestCooldownSeconds: number;
  retentionDays: number;
  auditRetentionDays: number;
  employeeAcknowledgementRequired: boolean;
  disclosureVersion: string;
  disclosureText: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScreenshotPolicyResponse {
  data: { policy: ScreenshotPolicy };
  serverTime: string;
}

export interface ScreenshotPolicyDisclosure {
  enabled: boolean;
  retentionDays: number;
  disclosure: {
    version: string;
    text: string;
    acknowledgementRequired: boolean;
    acknowledged: boolean;
    acknowledgedAt: string | null;
  };
  updatedAt: string;
}

export interface ScreenshotPolicyDisclosureResponse {
  data: { policy: ScreenshotPolicyDisclosure };
  serverTime: string;
}

export interface ScreenshotAuditEvent {
  id: string;
  action: string;
  actorUserId: string | null;
  actor?: ScreenshotUserSummary;
  targetEmployeeId: string | null;
  targetEmployee?: ScreenshotUserSummary;
  entityType: string;
  entityId: string | null;
  screenshotRequestId: string | null;
  screenshotId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ScreenshotAuditResponse extends Paginated<ScreenshotAuditEvent> {
  serverTime: string;
}

export interface MemberListItem extends MembershipSummary {
  user: Pick<PublicUser, "id" | "name" | "email" | "status">;
}

export interface Invitation {
  id: string;
  organizationId: string;
  email: string;
  role: Role;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  invitedBy: { id: string; name: string; email: string };
}

export interface ApiErrorDetail {
  path: string;
  message: string;
  code?: string;
}
