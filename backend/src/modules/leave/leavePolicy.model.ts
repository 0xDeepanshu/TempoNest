import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import type { Organization } from '../organizations/organization.model';
import type { LeaveType } from './leaveType.model';

export const ACCRUAL_FREQUENCIES = ['NONE', 'MONTHLY', 'QUARTERLY', 'ANNUAL'] as const;
export type AccrualFrequency = (typeof ACCRUAL_FREQUENCIES)[number];

export const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5] as const;

export interface LeavePolicyAttributes {
  id: string;
  organizationId: string;
  leaveTypeId: string;
  initialEntitlement: number;
  accrualFrequency: AccrualFrequency;
  accrualAmount: number;
  accrualDayOfMonth: number;
  accrualEffectiveFrom: string | null;
  prorateAccrual: boolean;
  balancePeriodStartMonth: number;
  balancePeriodStartDay: number;
  carryForwardAllowance: number;
  maxBalance: number | null;
  prorateInitialEntitlement: boolean;
  workingDays: number[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type LeavePolicyCreationAttributes = Optional<
  LeavePolicyAttributes,
  | 'id'
  | 'initialEntitlement'
  | 'accrualFrequency'
  | 'accrualAmount'
  | 'accrualDayOfMonth'
  | 'accrualEffectiveFrom'
  | 'prorateAccrual'
  | 'balancePeriodStartMonth'
  | 'balancePeriodStartDay'
  | 'carryForwardAllowance'
  | 'maxBalance'
  | 'prorateInitialEntitlement'
  | 'workingDays'
  | 'isActive'
  | 'createdAt'
  | 'updatedAt'
>;

/**
 * One policy per leave type. Accrual is applied lazily when a balance is read
 * or reserved: each scheduled tranche is written to the ledger with an
 * idempotency key, so reads never double-credit and no payroll engine is
 * required.
 */
export class LeavePolicy
  extends Model<LeavePolicyAttributes, LeavePolicyCreationAttributes>
  implements LeavePolicyAttributes
{
  declare id: string;
  declare organizationId: string;
  declare leaveTypeId: string;
  declare initialEntitlement: number;
  declare accrualFrequency: AccrualFrequency;
  declare accrualAmount: number;
  declare accrualDayOfMonth: number;
  declare accrualEffectiveFrom: string | null;
  declare prorateAccrual: boolean;
  declare balancePeriodStartMonth: number;
  declare balancePeriodStartDay: number;
  declare carryForwardAllowance: number;
  declare maxBalance: number | null;
  declare prorateInitialEntitlement: boolean;
  declare workingDays: number[];
  declare isActive: boolean;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare organization?: Organization;
  declare leaveType?: LeaveType;
}

export function initLeavePolicy(sequelize: Sequelize): typeof LeavePolicy {
  LeavePolicy.init(
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
      leaveTypeId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'leave_type_id',
        references: { model: 'leave_types', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      initialEntitlement: {
        type: DataTypes.DECIMAL(8, 2),
        allowNull: false,
        field: 'initial_entitlement',
        defaultValue: 0,
      },
      accrualFrequency: {
        type: DataTypes.ENUM(...ACCRUAL_FREQUENCIES),
        allowNull: false,
        field: 'accrual_frequency',
        defaultValue: 'NONE',
      },
      accrualAmount: {
        type: DataTypes.DECIMAL(8, 2),
        allowNull: false,
        field: 'accrual_amount',
        defaultValue: 0,
      },
      accrualDayOfMonth: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'accrual_day_of_month',
        defaultValue: 1,
      },
      accrualEffectiveFrom: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        field: 'accrual_effective_from',
      },
      prorateAccrual: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        field: 'prorate_accrual',
        defaultValue: false,
      },
      balancePeriodStartMonth: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'balance_period_start_month',
        defaultValue: 1,
      },
      balancePeriodStartDay: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'balance_period_start_day',
        defaultValue: 1,
      },
      carryForwardAllowance: {
        type: DataTypes.DECIMAL(8, 2),
        allowNull: false,
        field: 'carry_forward_allowance',
        defaultValue: 0,
      },
      maxBalance: {
        type: DataTypes.DECIMAL(8, 2),
        allowNull: true,
        field: 'max_balance',
      },
      prorateInitialEntitlement: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        field: 'prorate_initial_entitlement',
        defaultValue: false,
      },
      workingDays: {
        // ISO weekday numbers: 1 = Monday ... 7 = Sunday.
        type: DataTypes.JSON,
        allowNull: false,
        field: 'working_days',
        defaultValue: [...DEFAULT_WORKING_DAYS],
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        field: 'is_active',
        defaultValue: true,
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
      modelName: 'LeavePolicy',
      tableName: 'leave_policies',
      underscored: true,
      timestamps: true,
      indexes: [
        {
          name: 'leave_policies_organization_type_unique',
          unique: true,
          fields: ['organization_id', 'leave_type_id'],
        },
        { name: 'leave_policies_leave_type_idx', fields: ['leave_type_id'] },
      ],
    },
  );

  return LeavePolicy;
}
