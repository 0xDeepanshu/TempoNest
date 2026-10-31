import type { Sequelize } from 'sequelize';
import { initOrganization } from '../modules/organizations/organization.model';
import { initUser } from '../modules/users/user.model';
import { initMembership } from '../modules/memberships/membership.model';
import { initCustomRole } from '../modules/roles/customRole.model';
import { initManagerRoleOverride } from '../modules/roles/managerRoleOverride.model';
import { initInvitation } from '../modules/invitations/invitation.model';
import { initSession } from '../modules/auth/session.model';
import { initDesktopAgent } from '../modules/desktopAgents/desktopAgent.model';
import { initTimeSession } from '../modules/timeTracking/timeSession.model';
import { initBreak } from '../modules/timeTracking/break.model';
import { initAgentSyncEvent } from '../modules/timeTracking/offlineEvent.model';
import { initApplicationActivity } from '../modules/activity/applicationActivity.model';
import { initOrganizationTrackingSettings } from '../modules/activity/trackingSettings.model';
import { initApplicationClassification } from '../modules/activity/applicationClassification.model';
import { initActivityIdleInterval } from '../modules/activity/idleInterval.model';
import { initScreenshotPolicy } from '../modules/screenshots/screenshotPolicy.model';
import { initScreenshotPolicyAcknowledgement } from '../modules/screenshots/screenshotPolicyAcknowledgement.model';
import { initScreenshotRequest } from '../modules/screenshots/screenshotRequest.model';
import { initScreenshot } from '../modules/screenshots/screenshot.model';
import { initAuditEvent } from '../modules/screenshots/auditEvent.model';
import { initScreenLiveSession } from '../modules/screenshots/screenLiveSession.model';
import { initScreenLiveViewer } from '../modules/screenshots/screenLiveViewer.model';
import { initPlatformAuditEvent } from '../modules/platform/platformAuditEvent.model';
import { initAttendanceCorrectionRequest } from '../modules/attendance/attendanceCorrection.model';
import { initAttendanceEvidence } from '../modules/attendance/attendanceEvidence.model';
import { initAttendanceCheckIn } from '../modules/attendance/attendanceCheckIn.model';
import { initAttendanceLocationSample } from '../modules/attendance/attendanceLocationSample.model';
import { initAttendanceLocationTracking } from '../modules/attendance/attendanceLocationTracking.model';
import { initLeaveType } from '../modules/leave/leaveType.model';
import { initLeavePolicy } from '../modules/leave/leavePolicy.model';
import { initLeaveHoliday } from '../modules/leave/leaveHoliday.model';
import { initOrganizationHolidaySettings } from '../modules/leave/holidaySettings.model';
import { initLeaveBalance } from '../modules/leave/leaveBalance.model';
import { initLeaveRequest } from '../modules/leave/leaveRequest.model';
import { initLeaveLedgerEntry } from '../modules/leave/leaveLedgerEntry.model';
import { initPasswordResetToken } from '../modules/auth/passwordResetToken.model';

export function initModels(sequelize: Sequelize) {
  const Organization = initOrganization(sequelize);
  const User = initUser(sequelize);
  const Membership = initMembership(sequelize);
  const CustomRole = initCustomRole(sequelize);
  const ManagerRoleOverride = initManagerRoleOverride(sequelize);
  const Invitation = initInvitation(sequelize);
  const Session = initSession(sequelize);
  const DesktopAgent = initDesktopAgent(sequelize);
  const TimeSession = initTimeSession(sequelize);
  const Break = initBreak(sequelize);
  const ApplicationActivity = initApplicationActivity(sequelize);
  const OrganizationTrackingSettings = initOrganizationTrackingSettings(sequelize);
  const ApplicationClassification = initApplicationClassification(sequelize);
  const ActivityIdleInterval = initActivityIdleInterval(sequelize);
  const AgentSyncEvent = initAgentSyncEvent(sequelize);
  const ScreenshotPolicy = initScreenshotPolicy(sequelize);
  const ScreenshotPolicyAcknowledgement = initScreenshotPolicyAcknowledgement(sequelize);
  const ScreenshotRequest = initScreenshotRequest(sequelize);
  const Screenshot = initScreenshot(sequelize);
  const AuditEvent = initAuditEvent(sequelize);
  const ScreenLiveSession = initScreenLiveSession(sequelize);
  const ScreenLiveViewer = initScreenLiveViewer(sequelize);
  const PlatformAuditEvent = initPlatformAuditEvent(sequelize);
  const AttendanceCorrectionRequest = initAttendanceCorrectionRequest(sequelize);
  const AttendanceEvidence = initAttendanceEvidence(sequelize);
  const AttendanceCheckIn = initAttendanceCheckIn(sequelize);
  const AttendanceLocationSample = initAttendanceLocationSample(sequelize);
  const AttendanceLocationTracking = initAttendanceLocationTracking(sequelize);
  const LeaveType = initLeaveType(sequelize);
  const LeavePolicy = initLeavePolicy(sequelize);
  const LeaveHoliday = initLeaveHoliday(sequelize);
  const OrganizationHolidaySettings = initOrganizationHolidaySettings(sequelize);
  const LeaveBalance = initLeaveBalance(sequelize);
  const LeaveRequest = initLeaveRequest(sequelize);
  const LeaveLedgerEntry = initLeaveLedgerEntry(sequelize);
  const PasswordResetToken = initPasswordResetToken(sequelize);

  Organization.hasMany(Membership, {
    foreignKey: 'organizationId',
    as: 'memberships',
    onDelete: 'CASCADE',
  });
  Organization.hasMany(Invitation, {
    foreignKey: 'organizationId',
    as: 'invitations',
    onDelete: 'CASCADE',
  });
  Organization.hasMany(CustomRole, {
    foreignKey: 'organizationId',
    as: 'customRoles',
    onDelete: 'CASCADE',
  });
  Organization.hasOne(ManagerRoleOverride, {
    foreignKey: 'organizationId',
    as: 'managerRoleOverride',
    onDelete: 'CASCADE',
  });
  Organization.hasMany(DesktopAgent, {
    foreignKey: 'organizationId',
    as: 'desktopAgents',
    onDelete: 'CASCADE',
  });
  Organization.hasMany(TimeSession, {
    foreignKey: 'organizationId',
    as: 'timeSessions',
    onDelete: 'CASCADE',
  });
  Organization.hasMany(Break, {
    foreignKey: 'organizationId',
    as: 'breaks',
    onDelete: 'CASCADE',
  });
  Organization.hasMany(ApplicationActivity, {
    foreignKey: 'organizationId',
    as: 'applicationActivities',
    onDelete: 'CASCADE',
  });
  Organization.hasOne(OrganizationTrackingSettings, {
    foreignKey: 'organizationId',
    as: 'trackingSettings',
    onDelete: 'CASCADE',
  });
  Organization.hasMany(ApplicationClassification, {
    foreignKey: 'organizationId',
    as: 'applicationClassifications',
    onDelete: 'CASCADE',
  });
  Organization.hasMany(ActivityIdleInterval, {
    foreignKey: 'organizationId',
    as: 'activityIdleIntervals',
    onDelete: 'CASCADE',
  });
  Organization.hasOne(ScreenshotPolicy, {
    foreignKey: 'organizationId',
    as: 'screenshotPolicy',
    onDelete: 'CASCADE',
  });
  Organization.hasMany(ScreenshotPolicyAcknowledgement, {
    foreignKey: 'organizationId',
    as: 'screenshotPolicyAcknowledgements',
    onDelete: 'CASCADE',
  });
  Organization.hasMany(ScreenshotRequest, {
    foreignKey: 'organizationId',
    as: 'screenshotRequests',
    onDelete: 'CASCADE',
  });
  Organization.hasMany(Screenshot, {
    foreignKey: 'organizationId',
    as: 'screenshots',
    onDelete: 'CASCADE',
  });
  Organization.hasMany(AuditEvent, {
    foreignKey: 'organizationId',
    as: 'auditEvents',
    onDelete: 'CASCADE',
  });
  Organization.hasMany(ScreenLiveSession, {
    foreignKey: 'organizationId',
    as: 'screenLiveSessions',
    onDelete: 'CASCADE',
  });
  Organization.hasMany(ScreenLiveViewer, {
    foreignKey: 'organizationId',
    as: 'screenLiveViewers',
    onDelete: 'CASCADE',
  });
  Organization.hasMany(PlatformAuditEvent, {
    foreignKey: 'targetOrganizationId',
    as: 'platformAuditEvents',
    onDelete: 'SET NULL',
  });
  Organization.hasMany(AttendanceCorrectionRequest, {
    foreignKey: 'organizationId',
    as: 'attendanceCorrectionRequests',
    onDelete: 'CASCADE',
  });
  Organization.hasMany(AttendanceEvidence, {
    foreignKey: 'organizationId',
    as: 'attendanceEvidence',
    onDelete: 'CASCADE',
  });
  Organization.hasMany(AttendanceCheckIn, {
    foreignKey: 'organizationId',
    as: 'attendanceCheckIns',
    onDelete: 'CASCADE',
  });

  User.hasMany(Membership, {
    foreignKey: 'userId',
    as: 'memberships',
    onDelete: 'CASCADE',
  });
  User.hasMany(Session, {
    foreignKey: 'userId',
    as: 'sessions',
    onDelete: 'CASCADE',
  });
  User.hasMany(PasswordResetToken, {
    foreignKey: 'userId',
    as: 'passwordResetTokens',
    onDelete: 'CASCADE',
  });
  User.hasMany(CustomRole, {
    foreignKey: 'createdByUserId',
    as: 'createdCustomRoles',
    onDelete: 'SET NULL',
  });
  User.hasMany(DesktopAgent, {
    foreignKey: 'userId',
    as: 'desktopAgents',
    onDelete: 'CASCADE',
  });
  User.hasMany(TimeSession, {
    foreignKey: 'employeeId',
    as: 'timeSessions',
    onDelete: 'CASCADE',
  });
  User.hasMany(ApplicationActivity, {
    foreignKey: 'employeeId',
    as: 'applicationActivities',
    onDelete: 'CASCADE',
  });
  User.hasMany(ApplicationClassification, {
    foreignKey: 'classifiedByUserId',
    as: 'applicationClassifications',
    onDelete: 'SET NULL',
  });
  User.hasMany(ActivityIdleInterval, {
    foreignKey: 'employeeId',
    as: 'activityIdleIntervals',
    onDelete: 'CASCADE',
  });
  User.hasMany(ScreenshotRequest, {
    foreignKey: 'employeeId',
    as: 'screenshotRequests',
    onDelete: 'CASCADE',
  });
  User.hasMany(ScreenshotRequest, {
    foreignKey: 'requestingAdminId',
    as: 'requestedScreenshotRequests',
    onDelete: 'SET NULL',
  });
  User.hasMany(Screenshot, {
    foreignKey: 'employeeId',
    as: 'screenshots',
    onDelete: 'CASCADE',
  });
  User.hasMany(ScreenshotPolicyAcknowledgement, {
    foreignKey: 'employeeId',
    as: 'screenshotPolicyAcknowledgements',
    onDelete: 'CASCADE',
  });
  User.hasMany(AuditEvent, {
    foreignKey: 'actorUserId',
    as: 'screenshotAuditActions',
    onDelete: 'SET NULL',
  });
  User.hasMany(ScreenLiveSession, {
    foreignKey: 'employeeId',
    as: 'screenLiveSessions',
    onDelete: 'CASCADE',
  });
  User.hasMany(ScreenLiveSession, {
    foreignKey: 'startedByUserId',
    as: 'startedScreenLiveSessions',
    onDelete: 'CASCADE',
  });
  User.hasMany(ScreenLiveViewer, {
    foreignKey: 'userId',
    as: 'screenLiveViewers',
    onDelete: 'CASCADE',
  });
  User.hasMany(PlatformAuditEvent, {
    foreignKey: 'actorUserId',
    as: 'platformAuditActions',
    onDelete: 'SET NULL',
  });
  User.hasMany(AttendanceCorrectionRequest, {
    foreignKey: 'employeeId',
    as: 'attendanceCorrectionRequests',
    onDelete: 'CASCADE',
  });
  User.hasMany(AttendanceCorrectionRequest, {
    foreignKey: 'reviewedByUserId',
    as: 'reviewedAttendanceCorrectionRequests',
    onDelete: 'SET NULL',
  });
  User.hasMany(AttendanceEvidence, {
    foreignKey: 'employeeId',
    as: 'attendanceEvidence',
    onDelete: 'CASCADE',
  });
  User.hasMany(AttendanceCheckIn, {
    foreignKey: 'employeeId',
    as: 'attendanceCheckIns',
    onDelete: 'CASCADE',
  });

  Membership.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization',
    onDelete: 'CASCADE',
  });
  Membership.belongsTo(User, {
    foreignKey: 'userId',
    as: 'user',
    onDelete: 'CASCADE',
  });
  Membership.belongsTo(CustomRole, {
    foreignKey: 'customRoleId',
    as: 'customRole',
    onDelete: 'SET NULL',
  });
  CustomRole.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization',
    onDelete: 'CASCADE',
  });
  CustomRole.belongsTo(User, {
    foreignKey: 'createdByUserId',
    as: 'createdBy',
    onDelete: 'SET NULL',
  });
  CustomRole.hasMany(Membership, {
    foreignKey: 'customRoleId',
    as: 'memberships',
    onDelete: 'SET NULL',
  });
  ManagerRoleOverride.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization',
    onDelete: 'CASCADE',
  });
  ManagerRoleOverride.belongsTo(User, {
    foreignKey: 'updatedByUserId',
    as: 'updatedBy',
    onDelete: 'SET NULL',
  });

  Invitation.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization',
    onDelete: 'CASCADE',
  });
  Invitation.belongsTo(User, {
    foreignKey: 'inviterId',
    as: 'inviter',
    onDelete: 'SET NULL',
  });
  Invitation.belongsTo(User, {
    foreignKey: 'acceptedByUserId',
    as: 'acceptedByUser',
    onDelete: 'SET NULL',
  });
  Invitation.belongsTo(CustomRole, {
    foreignKey: 'customRoleId',
    as: 'customRole',
    onDelete: 'SET NULL',
  });

  Session.belongsTo(User, {
    foreignKey: 'userId',
    as: 'user',
    onDelete: 'CASCADE',
  });

  DesktopAgent.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization',
    onDelete: 'CASCADE',
  });
  DesktopAgent.belongsTo(User, {
    foreignKey: 'userId',
    as: 'user',
    onDelete: 'CASCADE',
  });
  DesktopAgent.hasMany(TimeSession, {
    foreignKey: 'desktopAgentId',
    as: 'timeSessions',
    onDelete: 'SET NULL',
  });
  DesktopAgent.hasMany(ApplicationActivity, {
    foreignKey: 'desktopAgentId',
    as: 'applicationActivities',
    onDelete: 'SET NULL',
  });
  DesktopAgent.hasMany(ActivityIdleInterval, {
    foreignKey: 'desktopAgentId',
    as: 'activityIdleIntervals',
    onDelete: 'SET NULL',
  });
  DesktopAgent.hasMany(AgentSyncEvent, {
    foreignKey: 'desktopAgentId',
    as: 'syncEvents',
    onDelete: 'CASCADE',
  });
  DesktopAgent.hasMany(AttendanceEvidence, {
    foreignKey: 'desktopAgentId',
    as: 'attendanceEvidence',
    onDelete: 'CASCADE',
  });
  DesktopAgent.hasMany(AttendanceCheckIn, {
    foreignKey: 'desktopAgentId',
    as: 'attendanceCheckIns',
    onDelete: 'CASCADE',
  });
  DesktopAgent.hasMany(ScreenLiveSession, {
    foreignKey: 'desktopAgentId',
    as: 'screenLiveSessions',
    onDelete: 'CASCADE',
  });

  TimeSession.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization',
    onDelete: 'CASCADE',
  });
  TimeSession.belongsTo(User, {
    foreignKey: 'employeeId',
    as: 'employee',
    onDelete: 'CASCADE',
  });
  TimeSession.belongsTo(DesktopAgent, {
    foreignKey: 'desktopAgentId',
    as: 'desktopAgent',
    onDelete: 'SET NULL',
  });
  TimeSession.hasMany(Break, {
    foreignKey: 'timeSessionId',
    as: 'breaks',
    onDelete: 'CASCADE',
  });
  TimeSession.hasMany(ApplicationActivity, {
    foreignKey: 'timeSessionId',
    as: 'applicationActivities',
    onDelete: 'CASCADE',
  });
  TimeSession.hasMany(ActivityIdleInterval, {
    foreignKey: 'timeSessionId',
    as: 'activityIdleIntervals',
    onDelete: 'CASCADE',
  });
  TimeSession.hasMany(AttendanceCorrectionRequest, {
    foreignKey: 'timeSessionId',
    as: 'attendanceCorrections',
    onDelete: 'SET NULL',
  });
  TimeSession.hasMany(AttendanceCorrectionRequest, {
    foreignKey: 'resultingSessionId',
    as: 'resultingAttendanceCorrections',
    onDelete: 'SET NULL',
  });
  TimeSession.hasOne(AttendanceCheckIn, {
    foreignKey: 'timeSessionId',
    as: 'attendanceCheckIn',
    onDelete: 'CASCADE',
  });
  TimeSession.hasMany(AttendanceEvidence, {
    foreignKey: 'attachedSessionId',
    as: 'attendanceEvidence',
    onDelete: 'SET NULL',
  });
  TimeSession.hasMany(ScreenLiveSession, {
    foreignKey: 'timeSessionId',
    as: 'screenLiveSessions',
    onDelete: 'CASCADE',
  });

  Break.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization',
    onDelete: 'CASCADE',
  });
  Break.belongsTo(TimeSession, {
    foreignKey: 'timeSessionId',
    as: 'timeSession',
    onDelete: 'CASCADE',
  });

  ApplicationActivity.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization',
    onDelete: 'CASCADE',
  });
  ApplicationActivity.belongsTo(User, {
    foreignKey: 'employeeId',
    as: 'employee',
    onDelete: 'CASCADE',
  });
  ApplicationActivity.belongsTo(TimeSession, {
    foreignKey: 'timeSessionId',
    as: 'timeSession',
    onDelete: 'CASCADE',
  });
  ApplicationActivity.belongsTo(DesktopAgent, {
    foreignKey: 'desktopAgentId',
    as: 'desktopAgent',
    onDelete: 'SET NULL',
  });

  OrganizationTrackingSettings.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization',
    onDelete: 'CASCADE',
  });

  ApplicationClassification.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization',
    onDelete: 'CASCADE',
  });
  ApplicationClassification.belongsTo(User, {
    foreignKey: 'classifiedByUserId',
    as: 'classifiedBy',
    onDelete: 'SET NULL',
  });

  ActivityIdleInterval.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization',
    onDelete: 'CASCADE',
  });
  ActivityIdleInterval.belongsTo(User, {
    foreignKey: 'employeeId',
    as: 'employee',
    onDelete: 'CASCADE',
  });
  ActivityIdleInterval.belongsTo(TimeSession, {
    foreignKey: 'timeSessionId',
    as: 'timeSession',
    onDelete: 'CASCADE',
  });
  ActivityIdleInterval.belongsTo(DesktopAgent, {
    foreignKey: 'desktopAgentId',
    as: 'desktopAgent',
    onDelete: 'SET NULL',
  });

  AgentSyncEvent.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization',
    onDelete: 'CASCADE',
  });
  AgentSyncEvent.belongsTo(User, {
    foreignKey: 'employeeId',
    as: 'employee',
    onDelete: 'CASCADE',
  });
  AgentSyncEvent.belongsTo(DesktopAgent, {
    foreignKey: 'desktopAgentId',
    as: 'desktopAgent',
    onDelete: 'CASCADE',
  });

  ScreenshotPolicy.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization',
    onDelete: 'CASCADE',
  });

  ScreenshotPolicyAcknowledgement.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization',
    onDelete: 'CASCADE',
  });
  ScreenshotPolicyAcknowledgement.belongsTo(User, {
    foreignKey: 'employeeId',
    as: 'employee',
    onDelete: 'CASCADE',
  });

  ScreenshotRequest.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization',
    onDelete: 'CASCADE',
  });
  ScreenshotRequest.belongsTo(User, {
    foreignKey: 'employeeId',
    as: 'employee',
    onDelete: 'CASCADE',
  });
  ScreenshotRequest.belongsTo(User, {
    foreignKey: 'requestingAdminId',
    as: 'requestingAdmin',
    onDelete: 'SET NULL',
  });
  ScreenshotRequest.belongsTo(DesktopAgent, {
    foreignKey: 'desktopAgentId',
    as: 'desktopAgent',
    onDelete: 'SET NULL',
  });
  ScreenshotRequest.belongsTo(TimeSession, {
    foreignKey: 'timeSessionId',
    as: 'timeSession',
    onDelete: 'SET NULL',
  });
  ScreenshotRequest.hasOne(Screenshot, {
    foreignKey: 'screenshotRequestId',
    as: 'screenshot',
    onDelete: 'CASCADE',
  });

  Screenshot.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization',
    onDelete: 'CASCADE',
  });
  Screenshot.belongsTo(User, {
    foreignKey: 'employeeId',
    as: 'employee',
    onDelete: 'CASCADE',
  });
  Screenshot.belongsTo(User, {
    foreignKey: 'requestingAdminId',
    as: 'requestingAdmin',
    onDelete: 'SET NULL',
  });
  Screenshot.belongsTo(TimeSession, {
    foreignKey: 'timeSessionId',
    as: 'timeSession',
    onDelete: 'SET NULL',
  });
  Screenshot.belongsTo(ScreenshotRequest, {
    foreignKey: 'screenshotRequestId',
    as: 'request',
    onDelete: 'CASCADE',
  });

  AuditEvent.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization',
    onDelete: 'CASCADE',
  });
  AuditEvent.belongsTo(User, {
    foreignKey: 'actorUserId',
    as: 'actor',
    onDelete: 'SET NULL',
  });
  AuditEvent.belongsTo(User, {
    foreignKey: 'targetEmployeeId',
    as: 'targetEmployee',
    onDelete: 'SET NULL',
  });
  AuditEvent.belongsTo(ScreenshotRequest, {
    foreignKey: 'screenshotRequestId',
    as: 'screenshotRequest',
    onDelete: 'SET NULL',
  });
  AuditEvent.belongsTo(Screenshot, {
    foreignKey: 'screenshotId',
    as: 'screenshot',
    onDelete: 'SET NULL',
  });

  ScreenLiveSession.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization',
    onDelete: 'CASCADE',
  });
  ScreenLiveSession.belongsTo(User, {
    foreignKey: 'employeeId',
    as: 'employee',
    onDelete: 'CASCADE',
  });
  ScreenLiveSession.belongsTo(User, {
    foreignKey: 'startedByUserId',
    as: 'startedBy',
    onDelete: 'CASCADE',
  });
  ScreenLiveSession.belongsTo(DesktopAgent, {
    foreignKey: 'desktopAgentId',
    as: 'desktopAgent',
    onDelete: 'CASCADE',
  });
  ScreenLiveSession.belongsTo(TimeSession, {
    foreignKey: 'timeSessionId',
    as: 'timeSession',
    onDelete: 'CASCADE',
  });
  ScreenLiveSession.hasMany(ScreenLiveViewer, {
    foreignKey: 'screenLiveSessionId',
    as: 'viewers',
    onDelete: 'CASCADE',
  });

  ScreenLiveViewer.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization',
    onDelete: 'CASCADE',
  });
  ScreenLiveViewer.belongsTo(ScreenLiveSession, {
    foreignKey: 'screenLiveSessionId',
    as: 'session',
    onDelete: 'CASCADE',
  });
  ScreenLiveViewer.belongsTo(User, {
    foreignKey: 'userId',
    as: 'user',
    onDelete: 'CASCADE',
  });

  PlatformAuditEvent.belongsTo(Organization, {
    foreignKey: 'targetOrganizationId',
    as: 'targetOrganization',
    onDelete: 'SET NULL',
  });
  PlatformAuditEvent.belongsTo(User, {
    foreignKey: 'actorUserId',
    as: 'actor',
    onDelete: 'SET NULL',
  });

  AttendanceCorrectionRequest.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization',
    onDelete: 'CASCADE',
  });
  AttendanceCorrectionRequest.belongsTo(User, {
    foreignKey: 'employeeId',
    as: 'employee',
    onDelete: 'CASCADE',
  });
  AttendanceCorrectionRequest.belongsTo(User, {
    foreignKey: 'reviewedByUserId',
    as: 'reviewer',
    onDelete: 'SET NULL',
  });
  AttendanceCorrectionRequest.belongsTo(TimeSession, {
    foreignKey: 'timeSessionId',
    as: 'timeSession',
    onDelete: 'SET NULL',
  });
  AttendanceCorrectionRequest.belongsTo(TimeSession, {
    foreignKey: 'resultingSessionId',
    as: 'resultingSession',
    onDelete: 'SET NULL',
  });

  AttendanceEvidence.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization',
    onDelete: 'CASCADE',
  });
  AttendanceEvidence.belongsTo(User, {
    foreignKey: 'employeeId',
    as: 'employee',
    onDelete: 'CASCADE',
  });
  AttendanceEvidence.belongsTo(DesktopAgent, {
    foreignKey: 'desktopAgentId',
    as: 'desktopAgent',
    onDelete: 'CASCADE',
  });
  AttendanceEvidence.belongsTo(TimeSession, {
    foreignKey: 'attachedSessionId',
    as: 'attachedSession',
    onDelete: 'SET NULL',
  });

  AttendanceCheckIn.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization',
    onDelete: 'CASCADE',
  });
  AttendanceCheckIn.belongsTo(User, {
    foreignKey: 'employeeId',
    as: 'employee',
    onDelete: 'CASCADE',
  });
  AttendanceCheckIn.belongsTo(DesktopAgent, {
    foreignKey: 'desktopAgentId',
    as: 'desktopAgent',
    onDelete: 'CASCADE',
  });
  AttendanceCheckIn.belongsTo(TimeSession, {
    foreignKey: 'timeSessionId',
    as: 'timeSession',
    onDelete: 'CASCADE',
  });
  AttendanceCheckIn.belongsTo(AttendanceEvidence, {
    foreignKey: 'selfieEvidenceId',
    as: 'selfieEvidence',
    onDelete: 'SET NULL',
  });
  AttendanceCheckIn.belongsTo(AttendanceEvidence, {
    foreignKey: 'sitePhotoEvidenceId',
    as: 'sitePhotoEvidence',
    onDelete: 'SET NULL',
  });

  Organization.hasMany(AttendanceLocationSample, {
    foreignKey: 'organizationId',
    as: 'attendanceLocationSamples',
    onDelete: 'CASCADE',
  });
  Organization.hasMany(AttendanceLocationTracking, {
    foreignKey: 'organizationId',
    as: 'attendanceLocationTracking',
    onDelete: 'CASCADE',
  });
  User.hasMany(AttendanceLocationSample, {
    foreignKey: 'employeeId',
    as: 'attendanceLocationSamples',
    onDelete: 'CASCADE',
  });
  User.hasMany(AttendanceLocationTracking, {
    foreignKey: 'employeeId',
    as: 'attendanceLocationTracking',
    onDelete: 'CASCADE',
  });
  DesktopAgent.hasMany(AttendanceLocationSample, {
    foreignKey: 'desktopAgentId',
    as: 'attendanceLocationSamples',
    onDelete: 'CASCADE',
  });
  DesktopAgent.hasMany(AttendanceLocationTracking, {
    foreignKey: 'desktopAgentId',
    as: 'attendanceLocationTracking',
    onDelete: 'CASCADE',
  });
  TimeSession.hasMany(AttendanceLocationSample, {
    foreignKey: 'timeSessionId',
    as: 'attendanceLocationSamples',
    onDelete: 'CASCADE',
  });
  TimeSession.hasOne(AttendanceLocationTracking, {
    foreignKey: 'timeSessionId',
    as: 'attendanceLocationTracking',
    onDelete: 'CASCADE',
  });

  AttendanceLocationSample.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization',
    onDelete: 'CASCADE',
  });
  AttendanceLocationSample.belongsTo(User, {
    foreignKey: 'employeeId',
    as: 'employee',
    onDelete: 'CASCADE',
  });
  AttendanceLocationSample.belongsTo(DesktopAgent, {
    foreignKey: 'desktopAgentId',
    as: 'desktopAgent',
    onDelete: 'CASCADE',
  });
  AttendanceLocationSample.belongsTo(TimeSession, {
    foreignKey: 'timeSessionId',
    as: 'timeSession',
    onDelete: 'CASCADE',
  });

  AttendanceLocationTracking.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization',
    onDelete: 'CASCADE',
  });
  AttendanceLocationTracking.belongsTo(User, {
    foreignKey: 'employeeId',
    as: 'employee',
    onDelete: 'CASCADE',
  });
  AttendanceLocationTracking.belongsTo(DesktopAgent, {
    foreignKey: 'desktopAgentId',
    as: 'desktopAgent',
    onDelete: 'CASCADE',
  });
  AttendanceLocationTracking.belongsTo(TimeSession, {
    foreignKey: 'timeSessionId',
    as: 'timeSession',
    onDelete: 'CASCADE',
  });

  Organization.hasMany(LeaveType, {
    foreignKey: 'organizationId',
    as: 'leaveTypes',
    onDelete: 'CASCADE',
  });
  Organization.hasMany(LeavePolicy, {
    foreignKey: 'organizationId',
    as: 'leavePolicies',
    onDelete: 'CASCADE',
  });
  Organization.hasMany(LeaveHoliday, {
    foreignKey: 'organizationId',
    as: 'leaveHolidays',
    onDelete: 'CASCADE',
  });
  Organization.hasOne(OrganizationHolidaySettings, {
    foreignKey: 'organizationId',
    as: 'holidaySettings',
    onDelete: 'CASCADE',
  });
  Organization.hasMany(LeaveBalance, {
    foreignKey: 'organizationId',
    as: 'leaveBalances',
    onDelete: 'CASCADE',
  });
  Organization.hasMany(LeaveRequest, {
    foreignKey: 'organizationId',
    as: 'leaveRequests',
    onDelete: 'CASCADE',
  });
  Organization.hasMany(LeaveLedgerEntry, {
    foreignKey: 'organizationId',
    as: 'leaveLedgerEntries',
    onDelete: 'CASCADE',
  });

  User.hasMany(LeaveBalance, {
    foreignKey: 'employeeId',
    as: 'leaveBalances',
    onDelete: 'CASCADE',
  });
  User.hasMany(LeaveRequest, {
    foreignKey: 'employeeId',
    as: 'leaveRequests',
    onDelete: 'CASCADE',
  });
  User.hasMany(LeaveRequest, {
    foreignKey: 'reviewedByUserId',
    as: 'reviewedLeaveRequests',
    onDelete: 'SET NULL',
  });
  User.hasMany(LeaveRequest, {
    foreignKey: 'cancelledByUserId',
    as: 'cancelledLeaveRequests',
    onDelete: 'SET NULL',
  });
  User.hasMany(LeaveLedgerEntry, {
    foreignKey: 'employeeId',
    as: 'leaveLedgerEntries',
    onDelete: 'CASCADE',
  });
  User.hasMany(LeaveLedgerEntry, {
    foreignKey: 'actorUserId',
    as: 'leaveBalanceActions',
    onDelete: 'SET NULL',
  });

  LeaveType.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization',
    onDelete: 'CASCADE',
  });
  LeaveType.hasOne(LeavePolicy, {
    foreignKey: 'leaveTypeId',
    as: 'policy',
    onDelete: 'CASCADE',
  });
  LeaveType.hasMany(LeaveBalance, {
    foreignKey: 'leaveTypeId',
    as: 'balances',
    onDelete: 'CASCADE',
  });
  LeaveType.hasMany(LeaveRequest, {
    foreignKey: 'leaveTypeId',
    as: 'requests',
    onDelete: 'CASCADE',
  });
  LeaveType.hasMany(LeaveLedgerEntry, {
    foreignKey: 'leaveTypeId',
    as: 'ledgerEntries',
    onDelete: 'CASCADE',
  });

  LeavePolicy.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization',
    onDelete: 'CASCADE',
  });
  LeavePolicy.belongsTo(LeaveType, {
    foreignKey: 'leaveTypeId',
    as: 'leaveType',
    onDelete: 'CASCADE',
  });

  LeaveHoliday.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization',
    onDelete: 'CASCADE',
  });
  LeaveHoliday.belongsTo(User, {
    foreignKey: 'createdByUserId',
    as: 'createdBy',
    onDelete: 'SET NULL',
  });
  LeaveHoliday.belongsTo(User, {
    foreignKey: 'updatedByUserId',
    as: 'updatedBy',
    onDelete: 'SET NULL',
  });

  OrganizationHolidaySettings.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization',
    onDelete: 'CASCADE',
  });
  OrganizationHolidaySettings.belongsTo(User, {
    foreignKey: 'updatedByUserId',
    as: 'updatedBy',
    onDelete: 'SET NULL',
  });

  LeaveBalance.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization',
    onDelete: 'CASCADE',
  });
  LeaveBalance.belongsTo(User, {
    foreignKey: 'employeeId',
    as: 'employee',
    onDelete: 'CASCADE',
  });
  LeaveBalance.belongsTo(LeaveType, {
    foreignKey: 'leaveTypeId',
    as: 'leaveType',
    onDelete: 'CASCADE',
  });
  LeaveBalance.hasMany(LeaveLedgerEntry, {
    foreignKey: 'balanceId',
    as: 'ledgerEntries',
    onDelete: 'CASCADE',
  });

  LeaveRequest.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization',
    onDelete: 'CASCADE',
  });
  LeaveRequest.belongsTo(User, {
    foreignKey: 'employeeId',
    as: 'employee',
    onDelete: 'CASCADE',
  });
  LeaveRequest.belongsTo(User, {
    foreignKey: 'reviewedByUserId',
    as: 'reviewer',
    onDelete: 'SET NULL',
  });
  LeaveRequest.belongsTo(User, {
    foreignKey: 'cancelledByUserId',
    as: 'cancelledBy',
    onDelete: 'SET NULL',
  });
  LeaveRequest.belongsTo(LeaveType, {
    foreignKey: 'leaveTypeId',
    as: 'leaveType',
    onDelete: 'CASCADE',
  });
  LeaveRequest.hasMany(LeaveLedgerEntry, {
    foreignKey: 'leaveRequestId',
    as: 'ledgerEntries',
    onDelete: 'SET NULL',
  });

  LeaveLedgerEntry.belongsTo(Organization, {
    foreignKey: 'organizationId',
    as: 'organization',
    onDelete: 'CASCADE',
  });
  LeaveLedgerEntry.belongsTo(LeaveBalance, {
    foreignKey: 'balanceId',
    as: 'balance',
    onDelete: 'CASCADE',
  });
  LeaveLedgerEntry.belongsTo(User, {
    foreignKey: 'employeeId',
    as: 'employee',
    onDelete: 'CASCADE',
  });
  LeaveLedgerEntry.belongsTo(LeaveType, {
    foreignKey: 'leaveTypeId',
    as: 'leaveType',
    onDelete: 'CASCADE',
  });
  LeaveLedgerEntry.belongsTo(LeaveRequest, {
    foreignKey: 'leaveRequestId',
    as: 'leaveRequest',
    onDelete: 'SET NULL',
  });
  LeaveLedgerEntry.belongsTo(User, {
    foreignKey: 'actorUserId',
    as: 'actor',
    onDelete: 'SET NULL',
  });

  PasswordResetToken.belongsTo(User, {
    foreignKey: 'userId',
    as: 'user',
    onDelete: 'CASCADE',
  });

  return {
    Organization,
    User,
    Membership,
    CustomRole,
    ManagerRoleOverride,
    Invitation,
    Session,
    DesktopAgent,
    TimeSession,
    Break,
    ApplicationActivity,
    OrganizationTrackingSettings,
    ApplicationClassification,
    ActivityIdleInterval,
    AgentSyncEvent,
    ScreenshotPolicy,
    ScreenshotPolicyAcknowledgement,
    ScreenshotRequest,
    Screenshot,
    AuditEvent,
    ScreenLiveSession,
    ScreenLiveViewer,
    PlatformAuditEvent,
    AttendanceCorrectionRequest,
    AttendanceEvidence,
    AttendanceCheckIn,
    AttendanceLocationSample,
    AttendanceLocationTracking,
    LeaveType,
    LeavePolicy,
    LeaveHoliday,
    OrganizationHolidaySettings,
    LeaveBalance,
    LeaveRequest,
    LeaveLedgerEntry,
    PasswordResetToken,
  };
}

export type Models = ReturnType<typeof initModels>;
