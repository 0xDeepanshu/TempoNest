import type { Permission } from "./permissions";

export type Role = "OWNER" | "ADMIN" | "MANAGER" | "EMPLOYEE";

export type DataScope = "SELF" | "ORGANIZATION";

export interface CustomRoleSummary {
  id: string;
  name: string;
  description: string | null;
  permissions: readonly Permission[];
  dataScope: DataScope;
  onboardingEligible: boolean;
}

export interface RoleSummary {
  id: string;
  key: string;
  name: string;
  description: string | null;
  builtIn: boolean;
  /** Built-in roles the organization may override (currently MANAGER only). */
  customizable: boolean;
  /** True when this organization has an override for a customizable built-in role. */
  customized: boolean;
  permissions: readonly Permission[];
  permissionCount: number;
  dataScope: DataScope;
  onboardingEligible: boolean;
  assignedUserCount: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface PermissionCatalogEntry {
  id: Permission;
  group: string;
  label: string;
  description: string;
  grantableToCustomRole: boolean;
  grantableToManager: boolean;
}

export interface PermissionCatalogGroup {
  key: string;
  label: string;
  permissions: Permission[];
}

export interface PermissionCatalog {
  permissions: PermissionCatalogEntry[];
  groups: PermissionCatalogGroup[];
  grantable: Permission[];
  grantableManager: Permission[];
  protected: Permission[];
  dataScopes: Array<{ value: DataScope; label: string; description: string }>;
  dataScopeNote: string;
}

export interface RoleListResponse {
  data: RoleSummary[];
}

export interface RoleResponse {
  data: { role: RoleSummary };
}

export interface PermissionCatalogResponse {
  data: PermissionCatalog;
}

export type RoleUsersResponse = Paginated<MemberListItem>;

export type MembershipStatus = "ACTIVE" | "SUSPENDED" | "REMOVED";
export type OrganizationStatus = "ACTIVE" | "SUSPENDED";
export type UserStatus = "ACTIVE" | "DISABLED";
export type PlatformRole = "SUPERADMIN";
export type PlatformOrganizationStatus = OrganizationStatus | "DELETED";

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
  customRoleId?: string | null;
  status: MembershipStatus;
  permissions?: readonly Permission[];
  dataScope?: DataScope;
  customRole?: CustomRoleSummary;
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
  platformRole: PlatformRole | null;
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

export type AttendanceWorkMode = "WFO" | "WFH" | "ON_SITE";
export type AttendanceEvidenceKind = "SELFIE" | "SITE_PHOTO";
export type AttendanceEvidenceStatus = "PENDING" | "UPLOADED" | "ATTACHED";

export interface AttendanceEvidence {
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

export interface AttendanceCheckIn {
  id: string;
  organizationId: string;
  employeeId: string;
  desktopAgentId: string;
  sessionId: string;
  workMode: AttendanceWorkMode;
  checkInRequestId: string;
  location: AttendanceLocation | null;
  selfie: AttendanceEvidence | null;
  sitePhoto: AttendanceEvidence | null;
  employee: { id: string; name: string; email: string } | null;
  session: TimeSession | null;
  createdAt: string;
  updatedAt: string;
}

export interface AttendanceCheckInsResponse extends Paginated<AttendanceCheckIn> {
  timezone: string;
  serverTime: string;
}

export interface AttendanceEvidenceAccessResponse {
  data: {
    evidence: AttendanceEvidence;
    url: string;
    expiresAt: string;
  };
  serverTime: string;
}

export type AttendanceLocationTrackingStatus = "ACTIVE" | "PAUSED" | "STOPPED";

export type AttendanceLocationPermissionState =
  | "ALWAYS"
  | "FOREGROUND_ONLY"
  | "DENIED"
  | "UNKNOWN";

export type AttendanceLocationState =
  | "ACTIVE"
  | "PAUSED"
  | "STOPPED"
  | "PERMISSION_UNAVAILABLE"
  | "STALE";

export type AttendanceLocationSampleSource = "DEVICE" | "UNKNOWN";

export interface AttendanceLocationSample {
  id: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  capturedAt: string;
  receivedAt: string;
  source: AttendanceLocationSampleSource;
}

export interface AttendanceLocationTracking {
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

export interface AttendanceLocationHistory {
  checkIn: {
    id: string;
    employeeId: string;
    sessionId: string;
    workMode: AttendanceWorkMode;
    createdAt: string;
    location: AttendanceLocation | null;
  };
  employee: { id: string; name: string; email: string } | null;
  session: TimeSession | null;
  tracking: AttendanceLocationTracking | null;
  locationState: AttendanceLocationStateSummary;
  samples: AttendanceLocationSample[];
  totalSamples: number;
  truncated: boolean;
  retention: { days: number; cutoff: string };
}

export interface AttendanceLocationHistoryResponse {
  data: AttendanceLocationHistory;
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

export type ScreenLiveSessionStatus = "ACTIVE" | "ENDED";

export type ScreenLiveTerminationReason =
  | "VIEWER_STOPPED"
  | "ALL_VIEWERS_LEFT"
  | "AGENT_DISCONNECTED"
  | "AGENT_FAILED"
  | "EXPIRED"
  | "POLICY_DISABLED"
  | "SESSION_ENDED"
  | "ORGANIZATION_SUSPENDED"
  | "AGENT_REVOKED"
  | "SERVER_SHUTDOWN";

export interface ScreenLiveSessionSummary {
  id: string;
  organizationId: string;
  employeeId: string;
  desktopAgentId: string;
  timeSessionId: string;
  startedByUserId: string;
  status: ScreenLiveSessionStatus;
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
  terminationReason: ScreenLiveTerminationReason | null;
  employee?: ScreenshotUserSummary;
  startedBy?: ScreenshotUserSummary;
  desktopAgent?: {
    id: string;
    name: string;
    platform: string | null;
  };
  createdAt: string;
  updatedAt: string;
}

export interface ScreenLiveViewerSummary {
  id: string;
  screenLiveSessionId: string;
  userId: string;
  joinedAt: string | null;
  leftAt: string | null;
  lastSeenAt: string | null;
  disconnectedReason: string | null;
  user?: ScreenshotUserSummary;
}

export interface ScreenLiveStartResponse {
  data: {
    session: ScreenLiveSessionSummary;
    delivery: { agentOnline: boolean; delivered: boolean; note: string };
    reused: boolean;
  };
  serverTime: string;
}

export interface ScreenLiveTicketResponse {
  data: {
    ticket: string;
    expiresAt: string;
    websocketPath: string;
    session: ScreenLiveSessionSummary;
    viewer: ScreenLiveViewerSummary;
  };
  serverTime: string;
}

export interface ScreenLiveStopResponse {
  data: { session: ScreenLiveSessionSummary; stopped: boolean };
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
  name: string | null;
  email: string;
  role: Role;
  customRoleId: string | null;
  customRole?: { id: string; name: string } | null;
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

export interface PlatformOverview {
  total: number;
  active: number;
  suspended: number;
  deleted: number;
}

export interface PlatformOrganization {
  id: string;
  name: string;
  slug: string;
  status: PlatformOrganizationStatus;
  timezone: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  memberCount: number;
  activeMemberCount: number;
}

export const PLATFORM_AUDIT_ACTIONS = [
  "ORGANIZATION_RENAMED",
  "ORGANIZATION_SUSPENDED",
  "ORGANIZATION_REACTIVATED",
  "ORGANIZATION_SOFT_DELETED",
] as const;

export type PlatformAuditAction = (typeof PLATFORM_AUDIT_ACTIONS)[number];

export interface PlatformAuditEvent {
  id: string;
  action: PlatformAuditAction;
  actor: { id: string; name: string | null; email: string | null } | null;
  organization: { id: string | null; name: string };
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export const LEAVE_REQUEST_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
  "CANCELLATION_REQUESTED",
] as const;

export type LeaveRequestStatus = (typeof LEAVE_REQUEST_STATUSES)[number];

export const LEAVE_ACCRUAL_FREQUENCIES = ["NONE", "MONTHLY", "QUARTERLY", "ANNUAL"] as const;

export type LeaveAccrualFrequency = (typeof LEAVE_ACCRUAL_FREQUENCIES)[number];

export const LEAVE_LEDGER_ENTRY_KINDS = [
  "INITIAL_ENTITLEMENT",
  "ACCRUAL",
  "CARRY_FORWARD",
  "ADJUSTMENT",
  "RESERVATION",
  "RESERVATION_RELEASE",
  "CONSUMPTION",
  "CONSUMPTION_RESTORE",
] as const;

export type LeaveLedgerEntryKind = (typeof LEAVE_LEDGER_ENTRY_KINDS)[number];

export interface LeavePolicy {
  id: string;
  organizationId: string;
  leaveTypeId: string;
  initialEntitlement: number;
  accrualFrequency: LeaveAccrualFrequency;
  accrualAmount: number;
  accrualDayOfMonth: number;
  accrualEffectiveFrom: string | null;
  prorateAccrual: boolean;
  balancePeriodStartMonth: number;
  balancePeriodStartDay: number;
  carryForwardAllowance: number;
  maxBalance: number | null;
  prorateInitialEntitlement: boolean;
  workingDays: number[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  leaveType?: {
    id: string;
    name: string;
    isActive: boolean;
    requiresBalance: boolean;
  };
}

export interface LeaveType {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  isPaid: boolean;
  requiresBalance: boolean;
  allowNegativeBalance: boolean;
  maxConsecutiveDays: number | null;
  minNoticeDays: number;
  requiresDocumentation: boolean;
  allowApprovedCancellation: boolean;
  cancellationRequiresApproval: boolean;
  policy?: LeavePolicy;
  createdAt: string;
  updatedAt: string;
}

export const HOLIDAY_CATEGORIES = [
  "PUBLIC",
  "COMPANY",
  "OPTIONAL",
  "NATIONAL",
  "STATE",
  "GAZETTED",
  "RESTRICTED",
] as const;
export type HolidayCategory = (typeof HOLIDAY_CATEGORIES)[number];

export const GOVERNMENT_HOLIDAY_CATEGORIES = [
  "NATIONAL",
  "STATE",
  "GAZETTED",
  "RESTRICTED",
] as const;
export type GovernmentHolidayCategory = (typeof GOVERNMENT_HOLIDAY_CATEGORIES)[number];

export type HolidaySource = "MANUAL" | "GOVERNMENT";

export const HOLIDAY_DURATIONS = ["FULL_DAY", "FIRST_HALF", "SECOND_HALF"] as const;
export type HolidayDuration = (typeof HOLIDAY_DURATIONS)[number];

export interface LeaveHoliday {
  id: string;
  organizationId: string;
  holidayDate: string;
  name: string;
  category: HolidayCategory;
  duration: HolidayDuration;
  description: string | null;
  appliesToAll: boolean;
  applicableEmployeeIds: string[];
  departmentIds: string[];
  locationIds: string[];
  published: boolean;
  source: HolidaySource;
  sourceId: string | null;
  sourceYear: number | null;
  sourceName: string | null;
  sourceUrl: string | null;
  sourceReference: string | null;
  jurisdictionCountry: string | null;
  jurisdictionRegion: string | null;
  importedAt: string | null;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdBy: { id: string; name: string; email: string } | null;
  updatedBy: { id: string; name: string; email: string } | null;
  createdAt: string;
  updatedAt: string;
}

export type Holiday = LeaveHoliday;

export interface HolidaySettings {
  id: string;
  organizationId: string;
  enabled: boolean;
  optionalHolidaysEnabled: boolean;
  allowHalfDayHolidays: boolean;
  defaultCalendarYear: number | null;
  defaultApplicability: "ORGANIZATION" | "EMPLOYEES";
  workingDays: number[];
  governmentCountry: string;
  governmentRegion: string | null;
  governmentYear: number | null;
  updatedByUserId: string | null;
  updatedBy: { id: string; name: string; email: string } | null;
  updatedAt: string;
}

export interface HolidayCalendarResponse {
  data: {
    holidays: Holiday[];
    settings: HolidaySettings;
    year: number;
    from: string;
    to: string;
    total: number;
  };
  serverTime: string;
}

export interface HolidayResponse {
  data: { holiday: Holiday; serverTime: string };
}

export interface HolidaySettingsResponse {
  data: { settings: HolidaySettings; serverTime: string };
}

export interface HolidayEmployee {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface HolidayEmployeesResponse {
  data: HolidayEmployee[];
  serverTime: string;
}

export interface GovernmentHolidaySourceInfo {
  name: string;
  issuer: string;
  reference: string;
  url: string;
  retrievedOn: string;
  verification: string;
}

export interface GovernmentJurisdictionYear {
  year: number;
  holidayCount: number;
  source: GovernmentHolidaySourceInfo;
}

export interface GovernmentJurisdictionRegion {
  code: string;
  name: string;
  years: GovernmentJurisdictionYear[];
}

export interface GovernmentCountry {
  code: string;
  name: string;
  regions: GovernmentJurisdictionRegion[];
}

export interface GovernmentJurisdictionsResponse {
  data: { countries: GovernmentCountry[] };
  serverTime: string;
}

export type GovernmentPreviewStatus = "AVAILABLE" | "IMPORTED" | "DUPLICATE_NAME";

export interface GovernmentPreviewEntry {
  sourceId: string;
  name: string;
  holidayDate: string;
  category: GovernmentHolidayCategory;
  notes?: string;
  status: GovernmentPreviewStatus;
  existingHolidayId?: string;
  existingCategory?: HolidayCategory;
}

export interface GovernmentPreview {
  country: string;
  countryName: string;
  region: string;
  regionName: string;
  year: number;
  availableYears: number[];
  available: boolean;
  source: GovernmentHolidaySourceInfo | null;
  entries: GovernmentPreviewEntry[];
  counts: { total: number; available: number; imported: number; duplicates: number };
  message: string | null;
}

export interface GovernmentPreviewResponse {
  data: GovernmentPreview;
  serverTime: string;
}

export interface GovernmentImportResult {
  country: string;
  region: string;
  year: number;
  source: GovernmentHolidaySourceInfo;
  imported: Holiday[];
  skipped: Array<{
    sourceId: string;
    name: string;
    reason: "ALREADY_IMPORTED" | "DUPLICATE_NAME";
  }>;
  published: false;
}

export interface GovernmentImportResponse {
  data: GovernmentImportResult;
  serverTime: string;
}

export interface HolidayPublicationResponse {
  data: { published: boolean; changed: number; holidays: Holiday[] };
  serverTime: string;
}

export interface LeaveChargedDay {
  date: string;
  units: number;
}

export interface LeaveRequest {
  id: string;
  organizationId: string;
  employeeId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  startHalfDay: boolean;
  endHalfDay: boolean;
  units: number;
  chargedDates: LeaveChargedDay[];
  balancePeriodStart: string | null;
  reason: string;
  documentationReference: string | null;
  status: LeaveRequestStatus;
  idempotencyKey: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  reviewedByUserId: string | null;
  reviewerNote: string | null;
  rejectionReason: string | null;
  cancellationRequestedAt: string | null;
  cancelledAt: string | null;
  cancelledByUserId: string | null;
  cancellationReason: string | null;
  leaveType?: {
    id: string;
    name: string;
    isPaid: boolean;
    requiresBalance: boolean;
  };
  employee?: ScreenshotUserSummary;
  reviewer?: ScreenshotUserSummary;
  cancelledBy?: ScreenshotUserSummary;
  createdAt: string;
  updatedAt: string;
}

export interface LeaveLedgerEntry {
  id: string;
  balanceId: string;
  leaveRequestId: string | null;
  kind: LeaveLedgerEntryKind;
  accrualPeriod: string | null;
  entitledDelta: number;
  accruedDelta: number;
  adjustmentDelta: number;
  carriedForwardDelta: number;
  reservedDelta: number;
  consumedDelta: number;
  availableDelta: number;
  balanceAfter: number;
  reason: string | null;
  actorUserId: string | null;
  metadata: Record<string, unknown> | null;
  employee?: ScreenshotUserSummary;
  leaveType?: { id: string; name: string };
  actor?: ScreenshotUserSummary;
  createdAt: string;
  updatedAt: string;
}

export interface LeaveBalance {
  id: string;
  organizationId: string;
  employeeId: string;
  leaveTypeId: string;
  periodStart: string;
  periodEnd: string;
  entitledBalance: number;
  accruedBalance: number;
  adjustmentBalance: number;
  carriedForwardBalance: number;
  approvedConsumed: number;
  pendingReserved: number;
  availableBalance: number;
  breakdown: {
    entitled: number;
    accrued: number;
    adjustments: number;
    carriedForward: number;
    approvedConsumed: number;
    pendingReserved: number;
    available: number;
  };
  leaveType?: {
    id: string;
    name: string;
    isPaid: boolean;
    requiresBalance: boolean;
  };
  employee?: ScreenshotUserSummary;
  ledger?: LeaveLedgerEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface LeaveTypesResponse {
  data: LeaveType[];
  serverTime: string;
}

export interface LeavePoliciesResponse {
  data: LeavePolicy[];
  serverTime: string;
}

export interface LeaveHolidaysResponse {
  data: LeaveHoliday[];
  serverTime: string;
}

export interface LeaveBalancesResponse extends Paginated<LeaveBalance> {
  serverTime: string;
}

export interface LeaveEmployeeBalancesResponse {
  data: {
    employeeId: string;
    timezone: string;
    balances: LeaveBalance[];
  };
  serverTime: string;
}

export interface LeaveRequestsResponse extends Paginated<LeaveRequest> {
  serverTime: string;
}

export interface LeaveRequestResponse {
  data: { request: LeaveRequest };
  serverTime: string;
}

export interface LeaveTypeResponse {
  data: { leaveType: LeaveType };
  serverTime: string;
}

export interface LeavePolicyResponse {
  data: { policy: LeavePolicy };
  serverTime: string;
}

export interface LeaveHolidayResponse {
  data: { holiday: LeaveHoliday };
  serverTime: string;
}

export interface LeaveBalanceResponse {
  data: { balance: LeaveBalance };
  serverTime: string;
}

export interface LeavePolicySnapshot {
  initialEntitlement: number;
  accrualFrequency: LeaveAccrualFrequency;
  accrualAmount: number;
  accrualDayOfMonth: number;
  accrualEffectiveFrom: string | null;
  prorateAccrual: boolean;
  balancePeriodStartMonth: number;
  balancePeriodStartDay: number;
  carryForwardAllowance: number;
  maxBalance: number | null;
  prorateInitialEntitlement: boolean;
  isActive: boolean;
}

export interface LeaveAdjustmentPreview {
  employeeId: string;
  leaveTypeId: string;
  leaveTypeName: string;
  periodStart: string;
  periodEnd: string;
  amount: number;
  availableBefore: number;
  availableAfter: number;
  adjustmentBefore: number;
  adjustmentAfter: number;
  balanceExists: boolean;
}

export interface LeaveAdjustmentPreviewResponse {
  data: LeaveAdjustmentPreview;
  serverTime: string;
}

export interface LeaveBulkAdjustmentPreviewItemSuccess {
  employeeId: string;
  ok: true;
  preview: LeaveAdjustmentPreview;
}

export interface LeaveBulkAdjustmentFailure {
  employeeId: string;
  ok: false;
  message: string;
  code: string;
}

export type LeaveBulkAdjustmentPreviewItem =
  | LeaveBulkAdjustmentPreviewItemSuccess
  | LeaveBulkAdjustmentFailure;

export interface LeaveBulkAdjustmentPreview {
  summary: { requested: number; previewed: number; failed: number };
  items: LeaveBulkAdjustmentPreviewItem[];
}

export interface LeaveBulkAdjustmentPreviewResponse {
  data: LeaveBulkAdjustmentPreview;
  serverTime: string;
}

export interface LeaveBulkAdjustmentSuccess {
  employeeId: string;
  ok: true;
  balanceId: string;
  periodStart: string;
  periodEnd: string;
  availableBalance: number;
}

export type LeaveBulkAdjustmentItem = LeaveBulkAdjustmentSuccess | LeaveBulkAdjustmentFailure;

export interface LeaveBulkAdjustmentResult {
  batchId: string;
  summary: { requested: number; adjusted: number; failed: number };
  items: LeaveBulkAdjustmentItem[];
}

export interface LeaveBulkAdjustmentResultResponse {
  data: LeaveBulkAdjustmentResult;
  serverTime: string;
}

export interface LeaveBackfillItem {
  employee: ScreenshotUserSummary;
  leaveType: { id: string; name: string };
  periodStart: string;
  periodEnd: string;
  balanceExists: boolean;
}

export interface LeaveBackfillPreview {
  asOf: string;
  timezone: string;
  summary: {
    employees: number;
    leaveTypes: number;
    candidates: number;
    missing: number;
    existing: number;
    unconfiguredTypes: number;
  };
  types: Array<{
    id: string;
    name: string;
    periodStart: string;
    periodEnd: string;
    policy: LeavePolicySnapshot;
  }>;
  unconfiguredTypes: Array<{ id: string; name: string; reason: string }>;
  items: LeaveBackfillItem[];
  truncated: boolean;
}

export interface LeaveBackfillPreviewResponse {
  data: LeaveBackfillPreview;
  serverTime: string;
}

export interface LeaveBackfillEmployeeResult {
  employeeId: string;
  employeeName: string;
  employeeEmail: string;
  initialized: Array<{
    leaveTypeId: string;
    leaveTypeName: string;
    balanceId: string;
    availableBalance: number;
  }>;
  alreadyPresent: Array<{ leaveTypeId: string; leaveTypeName: string; balanceId: string }>;
  failed: Array<{ leaveTypeId: string; leaveTypeName: string; message: string; code: string }>;
}

export interface LeaveBackfillResult {
  batchId: string;
  asOf: string;
  timezone: string;
  summary: {
    employees: number;
    initialized: number;
    alreadyPresent: number;
    failed: number;
    unconfiguredTypes: number;
  };
  employees: LeaveBackfillEmployeeResult[];
  unconfiguredTypes: Array<{ id: string; name: string; reason: string }>;
}

export interface LeaveBackfillResultResponse {
  data: LeaveBackfillResult;
  serverTime: string;
}

export interface LeaveReconciliationBalance {
  id: string;
  periodStart: string;
  periodEnd: string;
  canonical: boolean;
  zero: boolean;
  ledgerEntries: number;
  requests: number;
  safeToRemove: boolean;
  entitledBalance: number;
  accruedBalance: number;
  adjustmentBalance: number;
  carriedForwardBalance: number;
  approvedConsumed: number;
  pendingReserved: number;
  availableBalance: number;
}

export interface LeaveReconciliationGroup {
  employeeId: string;
  employeeName: string;
  employeeEmail: string;
  employeeActive: boolean;
  leaveTypeId: string;
  leaveTypeName: string;
  policy: LeavePolicySnapshot | null;
  canonicalPeriodStart: string | null;
  issues: string[];
  balances: LeaveReconciliationBalance[];
}

export interface LeaveReconciliationReport {
  generatedAt: string;
  asOf: string;
  timezone: string;
  summary: {
    balancesScanned: number;
    groupsScanned: number;
    groupsNeedingAttention: number;
    overlappingGroups: number;
    currentMissingGroups: number;
    inactiveEmployeeGroups: number;
    unconfiguredTypes: number;
    unkeyedAccrualEntries: number;
    safeToRemoveBalances: number;
    manualReviewBalances: number;
  };
  unconfiguredTypes: Array<{ id: string; name: string; reason: string }>;
  groups: LeaveReconciliationGroup[];
}

export interface LeaveReconciliationResponse {
  data: LeaveReconciliationReport;
  serverTime: string;
}

export interface LeaveReconciliationRepairResult {
  batchId: string;
  repaired: number;
  failed: number;
  results: Array<{ balanceId: string; repaired: boolean; message?: string; code?: string }>;
}

export interface LeaveReconciliationRepairResponse {
  data: LeaveReconciliationRepairResult;
  serverTime: string;
}

export interface LeaveAccrualPreviewItem {
  employee: ScreenshotUserSummary;
  leaveType: { id: string; name: string };
  balanceExists: boolean;
  periodStart: string;
  periodEnd: string;
  currentAvailable: number;
  nextAccrualDate: string | null;
  nextAccrualAmount: number;
  projectedAvailable: number | null;
  accrualDayOfMonth: number;
  accrualFrequency: LeaveAccrualFrequency;
  accruedThisPeriod: number;
}

export interface LeaveAccrualPreviewReport {
  asOf: string;
  timezone: string;
  summary: {
    employees: number;
    leaveTypes: number;
    previews: number;
    missingBalances: number;
  };
  items: LeaveAccrualPreviewItem[];
  truncated: boolean;
}

export interface LeaveAccrualPreviewResponse {
  data: LeaveAccrualPreviewReport;
  serverTime: string;
}

export interface LeaveLedgerResponse extends Paginated<LeaveLedgerEntry> {
  serverTime: string;
}

export const ACTIVITY_CATEGORIES = [
  "PRODUCTIVE",
  "NEUTRAL",
  "UNPRODUCTIVE",
  "UNCLASSIFIED",
] as const;

export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];

export interface TrackingSettings {
  organizationId: string;
  appTrackingEnabled: boolean;
  idleDetectionEnabled: boolean;
  idleThresholdMinutes: number;
  productivityClassificationEnabled: boolean;
  activityRetentionDays: number;
  policyVersion: number;
  policyUpdatedAt: string;
  updatedAt: string;
}

export interface TrackingSettingsResponse {
  data: { settings: TrackingSettings };
  serverTime: string;
}

export interface ActivityPolicySnapshot {
  appTrackingEnabled: boolean;
  idleDetectionEnabled: boolean;
  idleThresholdMinutes: number;
  productivityClassificationEnabled: boolean;
  activityRetentionDays: number;
  policyVersion: number;
  policyUpdatedAt: string;
}

export interface ActivityTotals {
  sessionCount: number;
  trackedSeconds: number;
  workingSeconds: number;
  breakSeconds: number;
  idleSeconds: number;
  activeSeconds: number;
  applicationSeconds: number;
  unaccountedActiveSeconds: number;
  activityCoveragePercent: number;
  productiveSeconds: number;
  neutralSeconds: number;
  unproductiveSeconds: number;
  unclassifiedSeconds: number;
  productivePercentOfActive: number | null;
  unclassifiedPercentOfActive: number | null;
  hasActivityData: boolean;
  hasIdleData: boolean;
}

export interface ActivityDayTotals extends ActivityTotals {
  date: string;
}

export interface ActivityCategoryTotal {
  category: ActivityCategory;
  seconds: number;
  percentOfActiveTime: number;
}

export interface ActivityApplicationUsage {
  applicationIdentifier: string;
  applicationName: string;
  category: ActivityCategory;
  classified: boolean;
  totalSeconds: number;
  percentageOfActiveTime: number;
  eventCount: number;
  sessionCount: number;
}

export interface ActivitySummary {
  employeeId: string;
  from: string;
  to: string;
  timezone: string;
  policy: ActivityPolicySnapshot;
  totals: ActivityTotals;
  categories: ActivityCategoryTotal[];
  applications: ActivityApplicationUsage[];
  days: ActivityDayTotals[];
  disclaimer: string;
}

export interface ActivitySummaryResponse {
  data: ActivitySummary;
}

export interface ActivityOverviewRow extends ActivityTotals {
  employee: PublicUser;
  topApplications: Array<{
    applicationIdentifier: string;
    applicationName: string;
    category: ActivityCategory;
    totalSeconds: number;
  }>;
}

export interface ActivityOverviewAggregate {
  trackedSeconds: number;
  workingSeconds: number;
  breakSeconds: number;
  idleSeconds: number;
  activeSeconds: number;
  applicationSeconds: number;
  productiveSeconds: number;
  neutralSeconds: number;
  unproductiveSeconds: number;
  unclassifiedSeconds: number;
  activityCoveragePercent: number;
  productivePercentOfActive: number | null;
  unclassifiedPercentOfActive: number | null;
}

export interface ActivityOverviewResponse extends Paginated<ActivityOverviewRow> {
  from: string;
  to: string;
  timezone: string;
  policy: ActivityPolicySnapshot;
  totals: ActivityOverviewAggregate;
  disclaimer: string;
}

export interface ApplicationClassificationRow {
  classificationId: string | null;
  applicationIdentifier: string;
  applicationName: string;
  category: ActivityCategory;
  classified: boolean;
  classifiedByUserId: string | null;
  notes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ApplicationClassificationsResponse
  extends Paginated<ApplicationClassificationRow> {
  summary: { total: number; classified: number; unclassified: number };
}

export interface ApplicationClassificationRecord {
  id: string;
  organizationId: string;
  applicationIdentifier: string;
  applicationName: string;
  category: ActivityCategory;
  classified: boolean;
  classifiedByUserId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationClassificationResponse {
  data: { classification: ApplicationClassificationRecord };
  serverTime: string;
}
