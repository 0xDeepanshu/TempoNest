import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import type { Organization } from '../organizations/organization.model';
import type { User } from '../users/user.model';
import type { DesktopAgent } from '../desktopAgents/desktopAgent.model';
import type { TimeSession } from '../timeTracking/timeSession.model';
import type { AttendanceEvidence } from './attendanceEvidence.model';

export const ATTENDANCE_WORK_MODES = ['WFO', 'WFH', 'ON_SITE'] as const;
export type AttendanceWorkMode = (typeof ATTENDANCE_WORK_MODES)[number];

export interface AttendanceCheckInAttributes {
  id: string;
  organizationId: string;
  employeeId: string;
  desktopAgentId: string;
  timeSessionId: string;
  workMode: AttendanceWorkMode;
  selfieEvidenceId: string | null;
  sitePhotoEvidenceId: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  locationRecordedAt: Date | null;
  checkInRequestId: string;
  createdAt: Date;
  updatedAt: Date;
}

export type AttendanceCheckInCreationAttributes = Optional<
  AttendanceCheckInAttributes,
  | 'id'
  | 'selfieEvidenceId'
  | 'sitePhotoEvidenceId'
  | 'latitude'
  | 'longitude'
  | 'accuracyMeters'
  | 'locationRecordedAt'
  | 'createdAt'
  | 'updatedAt'
>;

export class AttendanceCheckIn
  extends Model<AttendanceCheckInAttributes, AttendanceCheckInCreationAttributes>
  implements AttendanceCheckInAttributes
{
  declare id: string;
  declare organizationId: string;
  declare employeeId: string;
  declare desktopAgentId: string;
  declare timeSessionId: string;
  declare workMode: AttendanceWorkMode;
  declare selfieEvidenceId: string | null;
  declare sitePhotoEvidenceId: string | null;
  declare latitude: number | null;
  declare longitude: number | null;
  declare accuracyMeters: number | null;
  declare locationRecordedAt: Date | null;
  declare checkInRequestId: string;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare organization?: Organization;
  declare employee?: User;
  declare desktopAgent?: DesktopAgent;
  declare timeSession?: TimeSession;
  declare selfieEvidence?: AttendanceEvidence;
  declare sitePhotoEvidence?: AttendanceEvidence;
}

export function initAttendanceCheckIn(sequelize: Sequelize): typeof AttendanceCheckIn {
  AttendanceCheckIn.init(
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
      workMode: {
        type: DataTypes.ENUM(...ATTENDANCE_WORK_MODES),
        allowNull: false,
        field: 'work_mode',
      },
      selfieEvidenceId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'selfie_evidence_id',
        references: { model: 'attendance_evidence', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      sitePhotoEvidenceId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'site_photo_evidence_id',
        references: { model: 'attendance_evidence', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      latitude: {
        type: DataTypes.DOUBLE,
        allowNull: true,
      },
      longitude: {
        type: DataTypes.DOUBLE,
        allowNull: true,
      },
      accuracyMeters: {
        type: DataTypes.DOUBLE,
        allowNull: true,
        field: 'accuracy_meters',
      },
      locationRecordedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'location_recorded_at',
      },
      checkInRequestId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'check_in_request_id',
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
      modelName: 'AttendanceCheckIn',
      tableName: 'attendance_check_ins',
      underscored: true,
      timestamps: true,
      indexes: [
        { name: 'attendance_check_ins_session_unique', unique: true, fields: ['time_session_id'] },
        {
          name: 'attendance_check_ins_request_unique',
          unique: true,
          fields: ['organization_id', 'employee_id', 'check_in_request_id'],
        },
        { name: 'attendance_check_ins_selfie_unique', unique: true, fields: ['selfie_evidence_id'] },
        {
          name: 'attendance_check_ins_site_photo_unique',
          unique: true,
          fields: ['site_photo_evidence_id'],
        },
        {
          name: 'attendance_check_ins_org_employee_created_idx',
          fields: ['organization_id', 'employee_id', 'created_at'],
        },
        {
          name: 'attendance_check_ins_org_mode_created_idx',
          fields: ['organization_id', 'work_mode', 'created_at'],
        },
      ],
    },
  );

  return AttendanceCheckIn;
}
