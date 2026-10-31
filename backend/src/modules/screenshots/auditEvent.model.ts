import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import type { Organization } from '../organizations/organization.model';
import type { User } from '../users/user.model';

export const SCREENSHOT_AUDIT_ACTIONS = [
  'SCREENSHOT_POLICY_UPDATED',
  'SCREENSHOT_POLICY_ACKNOWLEDGED',
  'SCREENSHOT_REQUEST_CREATED',
  'SCREENSHOT_REQUEST_ACKNOWLEDGED',
  'SCREENSHOT_REQUEST_CLAIMED',
  'SCREENSHOT_REQUEST_COMPLETED',
  'SCREENSHOT_REQUEST_FAILED',
  'SCREENSHOT_REQUEST_CANCELLED',
  'SCREENSHOT_REQUEST_EXPIRED',
  'SCREENSHOT_ACCESS_GRANTED',
  'SCREENSHOT_VIEWED',
  'SCREENSHOT_DELETED',
  'SCREEN_LIVE_SESSION_STARTED',
  'SCREEN_LIVE_VIEWER_JOINED',
  'SCREEN_LIVE_VIEWER_LEFT',
  'SCREEN_LIVE_SESSION_STOPPED',
  'SCREEN_LIVE_ACCESS_DENIED',
] as const;
export type ScreenshotAuditAction = (typeof SCREENSHOT_AUDIT_ACTIONS)[number];

export const ATTENDANCE_AUDIT_ACTIONS = [
  'ATTENDANCE_CORRECTION_REQUESTED',
  'ATTENDANCE_CORRECTION_APPROVED',
  'ATTENDANCE_CORRECTION_REJECTED',
  'ATTENDANCE_EVIDENCE_CREATED',
  'ATTENDANCE_EVIDENCE_UPLOADED',
  'ATTENDANCE_EVIDENCE_ACCESS_GRANTED',
  'ATTENDANCE_EVIDENCE_VIEWED',
  'ATTENDANCE_CHECKED_IN',
  'ATTENDANCE_LOCATION_HISTORY_VIEWED',
] as const;
export type AttendanceAuditAction = (typeof ATTENDANCE_AUDIT_ACTIONS)[number];

export const ACTIVITY_AUDIT_ACTIONS = [
  'APP_TRACKING_POLICY_UPDATED',
  'APPLICATION_CLASSIFICATION_CREATED',
  'APPLICATION_CLASSIFICATION_UPDATED',
] as const;
export type ActivityAuditAction = (typeof ACTIVITY_AUDIT_ACTIONS)[number];

export const LEAVE_AUDIT_ACTIONS = [
  'LEAVE_TYPE_CREATED',
  'LEAVE_TYPE_UPDATED',
  'LEAVE_POLICY_UPDATED',
  'LEAVE_HOLIDAY_CREATED',
  'LEAVE_HOLIDAY_UPDATED',
  'LEAVE_HOLIDAY_DELETED',
  'LEAVE_HOLIDAY_DUPLICATED',
  'LEAVE_HOLIDAY_SETTINGS_UPDATED',
  'LEAVE_HOLIDAYS_IMPORTED',
  'LEAVE_HOLIDAYS_PUBLICATION_UPDATED',
  'LEAVE_REQUEST_SUBMITTED',
  'LEAVE_REQUEST_APPROVED',
  'LEAVE_REQUEST_REJECTED',
  'LEAVE_REQUEST_CANCELLED',
  'LEAVE_CANCELLATION_REQUESTED',
  'LEAVE_CANCELLATION_REJECTED',
  'LEAVE_BALANCE_ADJUSTED',
  'LEAVE_BALANCE_BACKFILLED',
  'LEAVE_BALANCE_RECONCILED',
] as const;
export type LeaveAuditAction = (typeof LEAVE_AUDIT_ACTIONS)[number];

export const ROLE_AUDIT_ACTIONS = [
  'CUSTOM_ROLE_CREATED',
  'CUSTOM_ROLE_UPDATED',
  'CUSTOM_ROLE_DELETED',
  'CUSTOM_ROLE_ASSIGNED',
  'CUSTOM_ROLE_UNASSIGNED',
  'MANAGER_ROLE_UPDATED',
  'MANAGER_ROLE_RESET',
] as const;
export type RoleAuditAction = (typeof ROLE_AUDIT_ACTIONS)[number];

export const ONBOARDING_AUDIT_ACTIONS = [
  'INVITATION_CREATED',
  'INVITATION_RESENT',
  'INVITATION_REVOKED',
  'INVITATION_ACCEPTED',
] as const;
export type OnboardingAuditAction = (typeof ONBOARDING_AUDIT_ACTIONS)[number];

export const AUDIT_ACTIONS = [
  ...SCREENSHOT_AUDIT_ACTIONS,
  ...ATTENDANCE_AUDIT_ACTIONS,
  ...LEAVE_AUDIT_ACTIONS,
  ...ACTIVITY_AUDIT_ACTIONS,
  ...ROLE_AUDIT_ACTIONS,
  ...ONBOARDING_AUDIT_ACTIONS,
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * Append-only organization audit trail. Screenshot rows intentionally outlive
 * screenshot metadata according to policy; attendance-correction rows retain
 * the reviewed request and session snapshots independently of the live rows.
 */
export interface AuditEventAttributes {
  id: string;
  organizationId: string;
  actorUserId: string | null;
  targetEmployeeId: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string | null;
  screenshotRequestId: string | null;
  screenshotId: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type AuditEventCreationAttributes = Optional<
  AuditEventAttributes,
  | 'id'
  | 'actorUserId'
  | 'targetEmployeeId'
  | 'entityType'
  | 'entityId'
  | 'screenshotRequestId'
  | 'screenshotId'
  | 'metadata'
  | 'ipAddress'
  | 'userAgent'
  | 'createdAt'
  | 'updatedAt'
>;

export class AuditEvent
  extends Model<AuditEventAttributes, AuditEventCreationAttributes>
  implements AuditEventAttributes
{
  declare id: string;
  declare organizationId: string;
  declare actorUserId: string | null;
  declare targetEmployeeId: string | null;
  declare action: AuditAction;
  declare entityType: string;
  declare entityId: string | null;
  declare screenshotRequestId: string | null;
  declare screenshotId: string | null;
  declare metadata: Record<string, unknown>;
  declare ipAddress: string | null;
  declare userAgent: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare organization?: Organization;
  declare actor?: User;
  declare targetEmployee?: User;
}

export function initAuditEvent(sequelize: Sequelize): typeof AuditEvent {
  AuditEvent.init(
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: () => generateUuid(),
      },
      organizationId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'organization_id',
        references: { model: 'organizations', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      actorUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'actor_user_id',
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      targetEmployeeId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'target_employee_id',
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      action: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      entityType: {
        type: DataTypes.STRING(40),
        allowNull: false,
        field: 'entity_type',
        defaultValue: 'SCREENSHOT_REQUEST',
      },
      entityId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'entity_id',
      },
      screenshotRequestId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'screenshot_request_id',
        references: { model: 'screenshot_requests', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      screenshotId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'screenshot_id',
        references: { model: 'screenshots', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      metadata: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: {},
      },
      ipAddress: {
        type: DataTypes.STRING(64),
        allowNull: true,
        field: 'ip_address',
      },
      userAgent: {
        type: DataTypes.STRING(512),
        allowNull: true,
        field: 'user_agent',
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: 'AuditEvent',
      tableName: 'audit_events',
      underscored: true,
      timestamps: true,
      indexes: [
        { name: 'audit_events_org_created_idx', fields: ['organization_id', 'created_at'] },
        { name: 'audit_events_org_action_idx', fields: ['organization_id', 'action'] },
        { name: 'audit_events_request_idx', fields: ['screenshot_request_id'] },
        { name: 'audit_events_screenshot_idx', fields: ['screenshot_id'] },
      ],
    },
  );

  return AuditEvent;
}
