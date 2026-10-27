import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import type { Organization } from '../organizations/organization.model';
import type { User } from '../users/user.model';
import type { DesktopAgent } from '../desktopAgents/desktopAgent.model';
import type { TimeSession } from '../timeTracking/timeSession.model';

export const ATTENDANCE_LOCATION_TRACKING_STATUSES = ['ACTIVE', 'PAUSED', 'STOPPED'] as const;
export type AttendanceLocationTrackingStatus =
  (typeof ATTENDANCE_LOCATION_TRACKING_STATUSES)[number];

export const ATTENDANCE_LOCATION_PERMISSION_STATES = [
  'ALWAYS',
  'FOREGROUND_ONLY',
  'DENIED',
  'UNKNOWN',
] as const;
export type AttendanceLocationPermissionState =
  (typeof ATTENDANCE_LOCATION_PERMISSION_STATES)[number];

/**
 * Last reported state of the device-side tracker for one ON_SITE session.
 * It carries no coordinates; precise samples live in the history table.
 */
export interface AttendanceLocationTrackingAttributes {
  id: string;
  organizationId: string;
  employeeId: string;
  desktopAgentId: string;
  timeSessionId: string;
  status: AttendanceLocationTrackingStatus;
  reason: string | null;
  permission: AttendanceLocationPermissionState;
  backgroundAllowed: boolean;
  lastSampleAt: Date | null;
  lastReportedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type AttendanceLocationTrackingCreationAttributes = Optional<
  AttendanceLocationTrackingAttributes,
  | 'id'
  | 'reason'
  | 'permission'
  | 'backgroundAllowed'
  | 'lastSampleAt'
  | 'createdAt'
  | 'updatedAt'
>;

export class AttendanceLocationTracking
  extends Model<
    AttendanceLocationTrackingAttributes,
    AttendanceLocationTrackingCreationAttributes
  >
  implements AttendanceLocationTrackingAttributes
{
  declare id: string;
  declare organizationId: string;
  declare employeeId: string;
  declare desktopAgentId: string;
  declare timeSessionId: string;
  declare status: AttendanceLocationTrackingStatus;
  declare reason: string | null;
  declare permission: AttendanceLocationPermissionState;
  declare backgroundAllowed: boolean;
  declare lastSampleAt: Date | null;
  declare lastReportedAt: Date;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare organization?: Organization;
  declare employee?: User;
  declare desktopAgent?: DesktopAgent;
  declare timeSession?: TimeSession;
}

export function initAttendanceLocationTracking(
  sequelize: Sequelize,
): typeof AttendanceLocationTracking {
  AttendanceLocationTracking.init(
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
      employeeId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'employee_id',
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      desktopAgentId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'desktop_agent_id',
        references: { model: 'desktop_agents', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      timeSessionId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'time_session_id',
        references: { model: 'time_sessions', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      status: {
        type: DataTypes.ENUM(...ATTENDANCE_LOCATION_TRACKING_STATUSES),
        allowNull: false,
      },
      reason: {
        type: DataTypes.STRING(40),
        allowNull: true,
      },
      permission: {
        type: DataTypes.ENUM(...ATTENDANCE_LOCATION_PERMISSION_STATES),
        allowNull: false,
        defaultValue: 'UNKNOWN',
      },
      backgroundAllowed: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: 'background_allowed',
      },
      lastSampleAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'last_sample_at',
      },
      lastReportedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'last_reported_at',
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
      modelName: 'AttendanceLocationTracking',
      tableName: 'attendance_location_tracking',
      underscored: true,
      timestamps: true,
      indexes: [
        {
          name: 'attendance_location_tracking_session_unique',
          unique: true,
          fields: ['time_session_id'],
        },
        {
          name: 'attendance_location_tracking_org_updated_idx',
          fields: ['organization_id', 'updated_at'],
        },
      ],
    },
  );

  return AttendanceLocationTracking;
}
