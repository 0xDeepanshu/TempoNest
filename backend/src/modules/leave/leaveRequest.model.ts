import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import type { Organization } from '../organizations/organization.model';
import type { User } from '../users/user.model';
import type { LeaveType } from './leaveType.model';

export const LEAVE_REQUEST_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
  'CANCELLATION_REQUESTED',
] as const;
export type LeaveRequestStatus = (typeof LEAVE_REQUEST_STATUSES)[number];

/** Statuses that reserve or consume balance and block overlapping requests. */
export const ACTIVE_LEAVE_REQUEST_STATUSES: readonly LeaveRequestStatus[] = [
  'PENDING',
  'APPROVED',
  'CANCELLATION_REQUESTED',
];

export type ChargedLeaveDay = {
  date: string;
  units: number;
};

export interface LeaveRequestAttributes {
  id: string;
  organizationId: string;
  employeeId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  startHalfDay: boolean;
  endHalfDay: boolean;
  units: number;
  chargedDates: ChargedLeaveDay[];
  balancePeriodStart: string | null;
  reason: string;
  documentationReference: string | null;
  status: LeaveRequestStatus;
  idempotencyKey: string | null;
  submittedAt: Date;
  reviewedAt: Date | null;
  reviewedByUserId: string | null;
  reviewerNote: string | null;
  rejectionReason: string | null;
  cancellationRequestedAt: Date | null;
  cancelledAt: Date | null;
  cancelledByUserId: string | null;
  cancellationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type LeaveRequestCreationAttributes = Optional<
  LeaveRequestAttributes,
  | 'id'
  | 'startHalfDay'
  | 'endHalfDay'
  | 'chargedDates'
  | 'balancePeriodStart'
  | 'documentationReference'
  | 'status'
  | 'idempotencyKey'
  | 'submittedAt'
  | 'reviewedAt'
  | 'reviewedByUserId'
  | 'reviewerNote'
  | 'rejectionReason'
  | 'cancellationRequestedAt'
  | 'cancelledAt'
  | 'cancelledByUserId'
  | 'cancellationReason'
  | 'createdAt'
  | 'updatedAt'
>;

export class LeaveRequest
  extends Model<LeaveRequestAttributes, LeaveRequestCreationAttributes>
  implements LeaveRequestAttributes
{
  declare id: string;
  declare organizationId: string;
  declare employeeId: string;
  declare leaveTypeId: string;
  declare startDate: string;
  declare endDate: string;
  declare startHalfDay: boolean;
  declare endHalfDay: boolean;
  declare units: number;
  declare chargedDates: ChargedLeaveDay[];
  declare balancePeriodStart: string | null;
  declare reason: string;
  declare documentationReference: string | null;
  declare status: LeaveRequestStatus;
  declare idempotencyKey: string | null;
  declare submittedAt: Date;
  declare reviewedAt: Date | null;
  declare reviewedByUserId: string | null;
  declare reviewerNote: string | null;
  declare rejectionReason: string | null;
  declare cancellationRequestedAt: Date | null;
  declare cancelledAt: Date | null;
  declare cancelledByUserId: string | null;
  declare cancellationReason: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare organization?: Organization;
  declare employee?: User;
  declare reviewer?: User;
  declare cancelledBy?: User;
  declare leaveType?: LeaveType;
}

export function initLeaveRequest(sequelize: Sequelize): typeof LeaveRequest {
  LeaveRequest.init(
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
      leaveTypeId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'leave_type_id',
        references: { model: 'leave_types', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      startDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        field: 'start_date',
      },
      endDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        field: 'end_date',
      },
      startHalfDay: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        field: 'start_half_day',
        defaultValue: false,
      },
      endHalfDay: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        field: 'end_half_day',
        defaultValue: false,
      },
      units: {
        type: DataTypes.DECIMAL(8, 2),
        allowNull: false,
      },
      chargedDates: {
        type: DataTypes.JSON,
        allowNull: false,
        field: 'charged_dates',
        defaultValue: [],
      },
      balancePeriodStart: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        field: 'balance_period_start',
      },
      reason: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      documentationReference: {
        type: DataTypes.STRING(500),
        allowNull: true,
        field: 'documentation_reference',
      },
      status: {
        type: DataTypes.ENUM(...LEAVE_REQUEST_STATUSES),
        allowNull: false,
        defaultValue: 'PENDING',
      },
      idempotencyKey: {
        type: DataTypes.STRING(128),
        allowNull: true,
        field: 'idempotency_key',
      },
      submittedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'submitted_at',
      },
      reviewedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'reviewed_at',
      },
      reviewedByUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'reviewed_by_user_id',
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
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
      cancellationRequestedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'cancellation_requested_at',
      },
      cancelledAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'cancelled_at',
      },
      cancelledByUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'cancelled_by_user_id',
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      cancellationReason: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: 'cancellation_reason',
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
      modelName: 'LeaveRequest',
      tableName: 'leave_requests',
      underscored: true,
      timestamps: true,
      indexes: [
        { name: 'leave_requests_org_employee_status_idx', fields: ['organization_id', 'employee_id', 'status'] },
        { name: 'leave_requests_org_status_idx', fields: ['organization_id', 'status'] },
        { name: 'leave_requests_org_dates_idx', fields: ['organization_id', 'start_date', 'end_date'] },
        { name: 'leave_requests_employee_type_idx', fields: ['employee_id', 'leave_type_id'] },
        {
          name: 'leave_requests_idempotency_unique',
          unique: true,
          fields: ['organization_id', 'employee_id', 'idempotency_key'],
        },
      ],
    },
  );

  return LeaveRequest;
}
