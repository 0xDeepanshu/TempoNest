import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import type { Organization } from '../organizations/organization.model';
import type { User } from '../users/user.model';
import type { LeaveType } from './leaveType.model';
import type { LeaveLedgerEntry } from './leaveLedgerEntry.model';

export interface LeaveBalanceAttributes {
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
  createdAt: Date;
  updatedAt: Date;
}

export type LeaveBalanceCreationAttributes = Optional<
  LeaveBalanceAttributes,
  | 'id'
  | 'entitledBalance'
  | 'accruedBalance'
  | 'adjustmentBalance'
  | 'carriedForwardBalance'
  | 'approvedConsumed'
  | 'pendingReserved'
  | 'availableBalance'
  | 'createdAt'
  | 'updatedAt'
>;

/**
 * Cached aggregate per employee, leave type and balance period. The ledger is
 * the source of truth for how each aggregate changed; every mutation rewrites
 * the aggregate within the same transaction as its ledger entry.
 *
 * available = entitled + accrued + adjustments + carriedForward
 *             - approvedConsumed - pendingReserved
 */
export class LeaveBalance
  extends Model<LeaveBalanceAttributes, LeaveBalanceCreationAttributes>
  implements LeaveBalanceAttributes
{
  declare id: string;
  declare organizationId: string;
  declare employeeId: string;
  declare leaveTypeId: string;
  declare periodStart: string;
  declare periodEnd: string;
  declare entitledBalance: number;
  declare accruedBalance: number;
  declare adjustmentBalance: number;
  declare carriedForwardBalance: number;
  declare approvedConsumed: number;
  declare pendingReserved: number;
  declare availableBalance: number;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare organization?: Organization;
  declare employee?: User;
  declare leaveType?: LeaveType;
  declare ledgerEntries?: LeaveLedgerEntry[];
}

export function initLeaveBalance(sequelize: Sequelize): typeof LeaveBalance {
  LeaveBalance.init(
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
      periodStart: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        field: 'period_start',
      },
      periodEnd: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        field: 'period_end',
      },
      entitledBalance: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        field: 'entitled_balance',
        defaultValue: 0,
      },
      accruedBalance: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        field: 'accrued_balance',
        defaultValue: 0,
      },
      adjustmentBalance: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        field: 'adjustment_balance',
        defaultValue: 0,
      },
      carriedForwardBalance: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        field: 'carried_forward_balance',
        defaultValue: 0,
      },
      approvedConsumed: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        field: 'approved_consumed',
        defaultValue: 0,
      },
      pendingReserved: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        field: 'pending_reserved',
        defaultValue: 0,
      },
      availableBalance: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        field: 'available_balance',
        defaultValue: 0,
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
      modelName: 'LeaveBalance',
      tableName: 'leave_balances',
      underscored: true,
      timestamps: true,
      indexes: [
        {
          name: 'leave_balances_employee_type_period_unique',
          unique: true,
          fields: ['organization_id', 'employee_id', 'leave_type_id', 'period_start'],
        },
        { name: 'leave_balances_organization_period_idx', fields: ['organization_id', 'period_start'] },
        { name: 'leave_balances_employee_idx', fields: ['employee_id'] },
      ],
    },
  );

  return LeaveBalance;
}
