import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import type { Organization } from '../organizations/organization.model';
import type { User } from '../users/user.model';
import type { DesktopAgent } from '../desktopAgents/desktopAgent.model';
import type { TimeSession } from '../timeTracking/timeSession.model';

export const ATTENDANCE_EVIDENCE_KINDS = ['SELFIE', 'SITE_PHOTO'] as const;
export type AttendanceEvidenceKind = (typeof ATTENDANCE_EVIDENCE_KINDS)[number];

export const ATTENDANCE_EVIDENCE_STATUSES = ['PENDING', 'UPLOADED', 'ATTACHED'] as const;
export type AttendanceEvidenceStatus = (typeof ATTENDANCE_EVIDENCE_STATUSES)[number];

/**
 * Private attendance photo metadata. The binary lives only in object storage;
 * storage keys and upload tokens are never returned by read APIs.
 */
export interface AttendanceEvidenceAttributes {
  id: string;
  organizationId: string;
  employeeId: string;
  desktopAgentId: string;
  kind: AttendanceEvidenceKind;
  status: AttendanceEvidenceStatus;
  storageKey: string;
  contentType: string;
  fileSizeBytes: number | null;
  uploadTokenHash: string | null;
  uploadExpiresAt: Date | null;
  uploadedAt: Date | null;
  capturedAt: Date | null;
  expiresAt: Date;
  attachedSessionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type AttendanceEvidenceCreationAttributes = Optional<
  AttendanceEvidenceAttributes,
  | 'id'
  | 'status'
  | 'fileSizeBytes'
  | 'uploadTokenHash'
  | 'uploadExpiresAt'
  | 'uploadedAt'
  | 'capturedAt'
  | 'attachedSessionId'
  | 'createdAt'
  | 'updatedAt'
>;

export class AttendanceEvidence
  extends Model<AttendanceEvidenceAttributes, AttendanceEvidenceCreationAttributes>
  implements AttendanceEvidenceAttributes
{
  declare id: string;
  declare organizationId: string;
  declare employeeId: string;
  declare desktopAgentId: string;
  declare kind: AttendanceEvidenceKind;
  declare status: AttendanceEvidenceStatus;
  declare storageKey: string;
  declare contentType: string;
  declare fileSizeBytes: number | null;
  declare uploadTokenHash: string | null;
  declare uploadExpiresAt: Date | null;
  declare uploadedAt: Date | null;
  declare capturedAt: Date | null;
  declare expiresAt: Date;
  declare attachedSessionId: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare organization?: Organization;
  declare employee?: User;
  declare desktopAgent?: DesktopAgent;
  declare attachedSession?: TimeSession;
}

export function initAttendanceEvidence(sequelize: Sequelize): typeof AttendanceEvidence {
  AttendanceEvidence.init(
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
      kind: {
        type: DataTypes.ENUM(...ATTENDANCE_EVIDENCE_KINDS),
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM(...ATTENDANCE_EVIDENCE_STATUSES),
        allowNull: false,
        defaultValue: 'PENDING',
      },
      storageKey: {
        type: DataTypes.STRING(512),
        allowNull: false,
        field: 'storage_key',
      },
      contentType: {
        type: DataTypes.STRING(64),
        allowNull: false,
        field: 'content_type',
      },
      fileSizeBytes: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'file_size_bytes',
      },
      uploadTokenHash: {
        type: DataTypes.STRING(64),
        allowNull: true,
        field: 'upload_token_hash',
      },
      uploadExpiresAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'upload_expires_at',
      },
      uploadedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'uploaded_at',
      },
      capturedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'captured_at',
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'expires_at',
      },
      attachedSessionId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'attached_session_id',
        references: { model: 'time_sessions', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
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
      modelName: 'AttendanceEvidence',
      tableName: 'attendance_evidence',
      underscored: true,
      timestamps: true,
      indexes: [
        { name: 'attendance_evidence_storage_key_unique', unique: true, fields: ['storage_key'] },
        { name: 'attendance_evidence_org_employee_created_idx', fields: ['organization_id', 'employee_id', 'created_at'] },
        { name: 'attendance_evidence_agent_idx', fields: ['desktop_agent_id'] },
        { name: 'attendance_evidence_status_expires_idx', fields: ['status', 'expires_at'] },
        { name: 'attendance_evidence_attached_session_idx', fields: ['attached_session_id'] },
      ],
    },
  );

  return AttendanceEvidence;
}
