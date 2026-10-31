import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import type { Organization } from '../organizations/organization.model';
import type { User } from '../users/user.model';
import type { LeaveBalance } from './leaveBalance.model';
import type { LeaveRequest } from './leaveRequest.model';
import type { LeaveType } from './leaveType.model';

export const LEAVE_LEDGER_ENTRY_KINDS = [
  'INITIAL_ENTITLEMENT',
  'ACCRUAL',
  'CARRY_FORWARD',
  'ADJUSTMENT',
  'RESERVATION',
  'RESERVATION_RELEASE',
  'CONSUMPTION',
  'CONSUMPTION_RESTORE',
] as const;
export type LeaveLedgerEntryKind = (typeof LEAVE_LEDGER_ENTRY_KINDS)[number];

export interface LeaveLedgerEntryAttributes {
  id: string;
  organizationId: string;
  balanceId: string;
  employeeId: string;
  leaveTypeId: string;
  leaveRequestId: string | null;
  kind: LeaveLedgerEntryKind;
  accrualPeriod: string | null;
  entitledDelta: number;
  accruedDelta: number;
  adjustmentDelta: number;
  carriedForwardDelta: number;
  reservedDelta: number;
  consumedDelta: number;
  availableDelta: number;
  balanceAfter: number;
  reason: string | null;
  idempotencyKey: string | null;
  actorUserId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export type LeaveLedgerEntryCreationAttributes = Optional<
  LeaveLedgerEntryAttributes,
  | 'id'
  | 'leaveRequestId'
  | 'accrualPeriod'
  | 'entitledDelta'
  | 'accruedDelta'
  | 'adjustmentDelta'
  | 'carriedForwardDelta'
  | 'reservedDelta'
  | 'consumedDelta'
  | 'availableDelta'
  | 'balanceAfter'
  | 'reason'
  | 'idempotencyKey'
  | 'actorUserId'
  | 'metadata'
  | 'createdAt'
  | 'updatedAt'
>;

/**
 * Append-only explanation of every balance change. `idempotencyKey` makes
 * lazy accrual and carry-forward exactly-once across retries and instances.
 */
export class LeaveLedgerEntry
  extends Model<LeaveLedgerEntryAttributes, LeaveLedgerEntryCreationAttributes>
  implements LeaveLedgerEntryAttributes
{
  declare id: string;
  declare organizationId: string;
  declare balanceId: string;
  declare employeeId: string;
  declare leaveTypeId: string;
  declare leaveRequestId: string | null;
  declare kind: LeaveLedgerEntryKind;
  declare accrualPeriod: string | null;
  declare entitledDelta: number;
  declare accruedDelta: number;
  declare adjustmentDelta: number;
  declare carriedForwardDelta: number;
  declare reservedDelta: number;
  declare consumedDelta: number;
  declare availableDelta: number;
  declare balanceAfter: number;
  declare reason: string | null;
  declare idempotencyKey: string | null;
  declare actorUserId: string | null;
  declare metadata: Record<string, unknown> | null;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare organization?: Organization;
  declare balance?: LeaveBalance;
  declare employee?: User;
  declare leaveType?: LeaveType;
  declare leaveRequest?: LeaveRequest;
  declare actor?: User;
}

export function initLeaveLedgerEntry(sequelize: Sequelize): typeof LeaveLedgerEntry {
  LeaveLedgerEntry.init(
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
      balanceId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'balance_id',
        references: { model: 'leave_balances', key: 'id' },
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
      leaveRequestId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'leave_request_id',
        references: { model: 'leave_requests', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      kind: {
        type: DataTypes.ENUM(...LEAVE_LEDGER_ENTRY_KINDS),
        allowNull: false,
      },
      accrualPeriod: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        field: 'accrual_period',
      },
      entitledDelta: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        field: 'entitled_delta',
        defaultValue: 0,
      },
      accruedDelta: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        field: 'accrued_delta',
        defaultValue: 0,
      },
      adjustmentDelta: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        field: 'adjustment_delta',
        defaultValue: 0,
      },
      carriedForwardDelta: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        field: 'carried_forward_delta',
        defaultValue: 0,
      },
      reservedDelta: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        field: 'reserved_delta',
        defaultValue: 0,
      },
      consumedDelta: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        field: 'consumed_delta',
        defaultValue: 0,
      },
      availableDelta: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        field: 'available_delta',
        defaultValue: 0,
      },
      balanceAfter: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        field: 'balance_after',
        defaultValue: 0,
      },
      reason: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      idempotencyKey: {
        type: DataTypes.STRING(128),
        allowNull: true,
        field: 'idempotency_key',
      },
      actorUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'actor_user_id',
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      metadata: {
        type: DataTypes.JSON,
        allowNull: true,
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
      modelName: 'LeaveLedgerEntry',
      tableName: 'leave_ledger_entries',
      underscored: true,
      timestamps: true,
      indexes: [
        {
          name: 'leave_ledger_balance_key_unique',
          unique: true,
          fields: ['balance_id', 'idempotency_key'],
        },
        {
          name: 'leave_ledger_accrual_unique',
          unique: true,
          fields: ['organization_id', 'employee_id', 'leave_type_id', 'accrual_period'],
        },
        { name: 'leave_ledger_balance_created_idx', fields: ['balance_id', 'created_at'] },
        { name: 'leave_ledger_org_employee_idx', fields: ['organization_id', 'employee_id', 'created_at'] },
        { name: 'leave_ledger_request_idx', fields: ['leave_request_id'] },
      ],
    },
  );

  return LeaveLedgerEntry;
}
