import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import type { Organization } from '../organizations/organization.model';
import type { LeavePolicy } from './leavePolicy.model';

export interface LeaveTypeAttributes {
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
  createdAt: Date;
  updatedAt: Date;
}

export type LeaveTypeCreationAttributes = Optional<
  LeaveTypeAttributes,
  | 'id'
  | 'description'
  | 'isActive'
  | 'isPaid'
  | 'requiresBalance'
  | 'allowNegativeBalance'
  | 'maxConsecutiveDays'
  | 'minNoticeDays'
  | 'requiresDocumentation'
  | 'allowApprovedCancellation'
  | 'cancellationRequiresApproval'
  | 'createdAt'
  | 'updatedAt'
>;

/**
 * Organization-scoped leave type. A policy row is created alongside every
 * type so working-day calculation and balance rules always have an explicit
 * configuration to read; the defaults grant no entitlement.
 */
export class LeaveType
  extends Model<LeaveTypeAttributes, LeaveTypeCreationAttributes>
  implements LeaveTypeAttributes
{
  declare id: string;
  declare organizationId: string;
  declare name: string;
  declare description: string | null;
  declare isActive: boolean;
  declare isPaid: boolean;
  declare requiresBalance: boolean;
  declare allowNegativeBalance: boolean;
  declare maxConsecutiveDays: number | null;
  declare minNoticeDays: number;
  declare requiresDocumentation: boolean;
  declare allowApprovedCancellation: boolean;
  declare cancellationRequiresApproval: boolean;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare organization?: Organization;
  declare policy?: LeavePolicy;
}

export function initLeaveType(sequelize: Sequelize): typeof LeaveType {
  LeaveType.init(
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
      name: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        field: 'is_active',
        defaultValue: true,
      },
      isPaid: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        field: 'is_paid',
        defaultValue: true,
      },
      requiresBalance: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        field: 'requires_balance',
        defaultValue: true,
      },
      allowNegativeBalance: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        field: 'allow_negative_balance',
        defaultValue: false,
      },
      maxConsecutiveDays: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'max_consecutive_days',
      },
      minNoticeDays: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'min_notice_days',
        defaultValue: 0,
      },
      requiresDocumentation: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        field: 'requires_documentation',
        defaultValue: false,
      },
      allowApprovedCancellation: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        field: 'allow_approved_cancellation',
        defaultValue: true,
      },
      cancellationRequiresApproval: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        field: 'cancellation_requires_approval',
        defaultValue: false,
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
      modelName: 'LeaveType',
      tableName: 'leave_types',
      underscored: true,
      timestamps: true,
      indexes: [
        {
          name: 'leave_types_organization_name_unique',
          unique: true,
          fields: ['organization_id', 'name'],
        },
        { name: 'leave_types_organization_active_idx', fields: ['organization_id', 'is_active'] },
      ],
    },
  );

  return LeaveType;
}
