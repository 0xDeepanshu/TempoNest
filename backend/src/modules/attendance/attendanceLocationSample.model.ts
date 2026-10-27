import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import type { Organization } from '../organizations/organization.model';
import type { User } from '../users/user.model';
import type { DesktopAgent } from '../desktopAgents/desktopAgent.model';
import type { TimeSession } from '../timeTracking/timeSession.model';

export const ATTENDANCE_LOCATION_SOURCES = ['DEVICE', 'UNKNOWN'] as const;
export type AttendanceLocationSource = (typeof ATTENDANCE_LOCATION_SOURCES)[number];

/**
 * A single precise location sample captured during an active ON_SITE session.
 * Samples are append-only and never exposed outside the organization.
 */
export interface AttendanceLocationSampleAttributes {
  id: string;
  organizationId: string;
  employeeId: string;
  desktopAgentId: string;
  timeSessionId: string;
  clientSampleId: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  capturedAt: Date;
  receivedAt: Date;
  source: AttendanceLocationSource;
  createdAt: Date;
  updatedAt: Date;
}

export type AttendanceLocationSampleCreationAttributes = Optional<
  AttendanceLocationSampleAttributes,
  'id' | 'source' | 'receivedAt' | 'createdAt' | 'updatedAt'
>;

export class AttendanceLocationSample
  extends Model<
    AttendanceLocationSampleAttributes,
    AttendanceLocationSampleCreationAttributes
  >
  implements AttendanceLocationSampleAttributes
{
  declare id: string;
  declare organizationId: string;
  declare employeeId: string;
  declare desktopAgentId: string;
  declare timeSessionId: string;
  declare clientSampleId: string;
  declare latitude: number;
  declare longitude: number;
  declare accuracyMeters: number;
  declare capturedAt: Date;
  declare receivedAt: Date;
  declare source: AttendanceLocationSource;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare organization?: Organization;
  declare employee?: User;
  declare desktopAgent?: DesktopAgent;
  declare timeSession?: TimeSession;
}

export function initAttendanceLocationSample(
  sequelize: Sequelize,
): typeof AttendanceLocationSample {
  AttendanceLocationSample.init(
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
      clientSampleId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'client_sample_id',
      },
      latitude: {
        type: DataTypes.DOUBLE,
        allowNull: false,
      },
      longitude: {
        type: DataTypes.DOUBLE,
        allowNull: false,
      },
      accuracyMeters: {
        type: DataTypes.DOUBLE,
        allowNull: false,
        field: 'accuracy_meters',
      },
      capturedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'captured_at',
      },
      receivedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'received_at',
      },
      source: {
        type: DataTypes.STRING(16),
        allowNull: false,
        defaultValue: 'UNKNOWN',
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
      modelName: 'AttendanceLocationSample',
      tableName: 'attendance_location_samples',
      underscored: true,
      timestamps: true,
      indexes: [
        {
          name: 'attendance_location_samples_client_unique',
          unique: true,
          fields: ['time_session_id', 'client_sample_id'],
        },
        {
          name: 'attendance_location_samples_session_time_idx',
          fields: ['organization_id', 'time_session_id', 'captured_at'],
        },
        {
          name: 'attendance_location_samples_org_time_idx',
          fields: ['organization_id', 'captured_at'],
        },
      ],
    },
  );

  return AttendanceLocationSample;
}
