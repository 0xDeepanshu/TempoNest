import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import type { Organization } from '../organizations/organization.model';
import type { User } from '../users/user.model';
import type { LeaveBalance } from './leaveBalance.model';
import type { LeaveLedgerEntry } from './leaveLedgerEntry.model';
import type {
  CreditExpiryReason,
  LeavePolicy,
} from './leavePolicy.model';

export const CREDIT_SOURCE_KINDS = [
  'INITIAL_ENTITLEMENT',
  'ACCRUAL',
  'CARRY_FORWARD',
  'ADJUSTMENT',
  'LEGACY',
] as const;
export type CreditSourceKind = (typeof CREDIT_SOURCE_KINDS)[number];

export interface LeaveCreditTrancheAttributes {
  id: string;
  organizationId: string;
  employeeId: string;
  leaveTypeId: string;
  balanceId: string;
  sourceKind: CreditSourceKind;
  sourceLedgerEntryId: string | null;
  periodAllocated: string;
  allocated: number;
  consumed: number;
  reserved: number;
  expired: number;
  expiresAt: string | null;
  expiryReason: CreditExpiryReason;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export type LeaveCreditTrancheCreationAttributes = Optional<
  LeaveCreditTrancheAttributes,
  | 'id'
  | 'sourceLedgerEntryId'
  | 'allocated'
  | 'consumed'
  | 'reserved'
  | 'expired'
  | 'expiresAt'
  | 'expiryReason'
  | 'metadata'
  | 'createdAt'
  | 'updatedAt'
>;

/**
 * One row per credit grant. The aggregate `leave_balances` row remains the
 * authoritative balance; this table records which grant a request reserved or
 * consumed and when that grant expires. `source_ledger_entry_id` is unique, so
 * lazy accrual/carry-forward retries can never create a second tranche for the
 * same ledger credit.
 */
export class LeaveCreditTranche
  extends Model<LeaveCreditTrancheAttributes, LeaveCreditTrancheCreationAttributes>
  implements LeaveCreditTrancheAttributes
{
  declare id: string;
  declare organizationId: string;
  declare employeeId: string;
  declare leaveTypeId: string;
  declare balanceId: string;
  declare sourceKind: CreditSourceKind;
  declare sourceLedgerEntryId: string | null;
  declare periodAllocated: string;
  declare allocated: number;
  declare consumed: number;
  declare reserved: number;
  declare expired: number;
  declare expiresAt: string | null;
  declare expiryReason: CreditExpiryReason;
  declare metadata: Record<string, unknown> | null;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare organization?: Organization;
  declare employee?: User;
  declare balance?: LeaveBalance;
  declare sourceLedgerEntry?: LeaveLedgerEntry;
  declare policy?: LeavePolicy;

  /** Units that can still be reserved or spent. */
  get remaining(): number {
    return Math.max(
      0,
      Math.round(
        (Number(this.allocated || 0) -
          Number(this.consumed || 0) -
          Number(this.reserved || 0) -
          Number(this.expired || 0) +
          Number.EPSILON) *
          100,
      ) / 100,
    );
  }
}

export function initLeaveCreditTranche(sequelize: Sequelize): typeof LeaveCreditTranche {
  LeaveCreditTranche.init(
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
      balanceId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'balance_id',
        references: { model: 'leave_balances', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      sourceKind: {
        type: DataTypes.STRING(30),
        allowNull: false,
        field: 'source_kind',
      },
      sourceLedgerEntryId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'source_ledger_entry_id',
        references: { model: 'leave_ledger_entries', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      periodAllocated: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        field: 'period_allocated',
      },
      allocated: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      consumed: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      reserved: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      expired: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      expiresAt: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        field: 'expires_at',
      },
      expiryReason: {
        type: DataTypes.STRING(30),
        allowNull: false,
        field: 'expiry_reason',
        defaultValue: 'NONE',
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
      modelName: 'LeaveCreditTranche',
      tableName: 'leave_credit_tranches',
      underscored: true,
      timestamps: true,
      indexes: [
        {
          name: 'leave_credit_tranches_source_ledger_unique',
          unique: true,
          fields: ['source_ledger_entry_id'],
        },
        { name: 'leave_credit_tranches_balance_idx', fields: ['balance_id'] },
        {
          name: 'leave_credit_tranches_expiry_idx',
          fields: ['organization_id', 'employee_id', 'leave_type_id', 'expires_at'],
        },
      ],
    },
  );

  return LeaveCreditTranche;
}
