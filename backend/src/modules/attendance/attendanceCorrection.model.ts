import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import type { Organization } from '../organizations/organization.model';
import type { User } from '../users/user.model';
import type { TimeSession } from '../timeTracking/timeSession.model';

export const CORRECTION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type CorrectionStatus = (typeof CORRECTION_STATUSES)[number];

export const CORRECTION_REQUEST_TYPES = ['CREATE_SESSION', 'UPDATE_SESSION'] as const;
export type CorrectionRequestType = (typeof CORRECTION_REQUEST_TYPES)[number];

export type RequestedBreak = {
  startedAt: string;
  endedAt: string;
};

export type CorrectionSnapshot = {
  sessionId: string;
  startedAt: string;
  endedAt: string | null;
  status: string;
  source: string;
  breaks: Array<{
    id: string;
    startedAt: string;
    endedAt: string | null;
    status: string;
  }>;
};

export interface AttendanceCorrectionAttributes {
  id: string;
  organizationId: string;
  employeeId: string;
  timeSessionId: string | null;
  requestType: CorrectionRequestType;
  workDate: string;
  requestedStartedAt: Date;
  requestedEndedAt: Date;
  requestedBreaks: RequestedBreak[];
  reason: string;
  status: CorrectionStatus;
  originalSnapshot: CorrectionSnapshot | null;
  appliedSnapshot: CorrectionSnapshot | null;
  resultingSessionId: string | null;
  reviewedByUserId: string | null;
  reviewedAt: Date | null;
  reviewerNote: string | null;
  rejectionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type AttendanceCorrectionCreationAttributes = Optional<
  AttendanceCorrectionAttributes,
  | 'id'
  | 'timeSessionId'
  | 'requestedBreaks'
  | 'status'
  | 'originalSnapshot'
  | 'appliedSnapshot'
  | 'resultingSessionId'
  | 'reviewedByUserId'
  | 'reviewedAt'
  | 'reviewerNote'
  | 'rejectionReason'
  | 'createdAt'
  | 'updatedAt'
>;

/**
 * A pending request is intentionally separate from the attendance rows it
 * targets. Approved corrections are applied to time_sessions/breaks, while the
 * request keeps the submitted values and the original snapshot for review.
 */
export class AttendanceCorrectionRequest
  extends Model<AttendanceCorrectionAttributes, AttendanceCorrectionCreationAttributes>
  implements AttendanceCorrectionAttributes
{
  declare id: string;
  declare organizationId: string;
  declare employeeId: string;
  declare timeSessionId: string | null;
  declare requestType: CorrectionRequestType;
  declare workDate: string;
  declare requestedStartedAt: Date;
  declare requestedEndedAt: Date;
  declare requestedBreaks: RequestedBreak[];
  declare reason: string;
  declare status: CorrectionStatus;
  declare originalSnapshot: CorrectionSnapshot | null;
  declare appliedSnapshot: CorrectionSnapshot | null;
  declare resultingSessionId: string | null;
  declare reviewedByUserId: string | null;
  declare reviewedAt: Date | null;
  declare reviewerNote: string | null;
  declare rejectionReason: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare organization?: Organization;
  declare employee?: User;
  declare reviewer?: User;
  declare timeSession?: TimeSession;
  declare resultingSession?: TimeSession;
}

export function initAttendanceCorrectionRequest(
  sequelize: Sequelize,
): typeof AttendanceCorrectionRequest {
  AttendanceCorrectionRequest.init(
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
      timeSessionId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'time_session_id',
        references: { model: 'time_sessions', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      requestType: {
        type: DataTypes.ENUM(...CORRECTION_REQUEST_TYPES),
        allowNull: false,
        field: 'request_type',
      },
      workDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        field: 'work_date',
      },
      requestedStartedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'requested_started_at',
      },
      requestedEndedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'requested_ended_at',
      },
      requestedBreaks: {
        type: DataTypes.JSON,
        allowNull: false,
        field: 'requested_breaks',
        defaultValue: [],
      },
      reason: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM(...CORRECTION_STATUSES),
        allowNull: false,
        defaultValue: 'PENDING',
      },
      originalSnapshot: {
        type: DataTypes.JSON,
        allowNull: true,
        field: 'original_snapshot',
      },
      appliedSnapshot: {
        type: DataTypes.JSON,
        allowNull: true,
        field: 'applied_snapshot',
      },
      resultingSessionId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'resulting_session_id',
        references: { model: 'time_sessions', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      reviewedByUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'reviewed_by_user_id',
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      reviewedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'reviewed_at',
      },
      reviewerNote: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: 'reviewer_note',
      },
      rejectionReason: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: 'rejection_reason',
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
      modelName: 'AttendanceCorrectionRequest',
      tableName: 'attendance_correction_requests',
      underscored: true,
      timestamps: true,
      indexes: [
        {
          name: 'attendance_corrections_pending_session_unique',
          unique: true,
          fields: ['organization_id', 'employee_id', 'time_session_id'],
          where: { status: 'PENDING' },
        },
        {
          name: 'attendance_corrections_org_status_created_idx',
          fields: ['organization_id', 'status', 'created_at'],
        },
        {
          name: 'attendance_corrections_org_employee_work_date_idx',
          fields: ['organization_id', 'employee_id', 'work_date'],
        },
        { name: 'attendance_corrections_time_session_idx', fields: ['time_session_id'] },
        { name: 'attendance_corrections_resulting_session_idx', fields: ['resulting_session_id'] },
      ],
    },
  );

  return AttendanceCorrectionRequest;
}
