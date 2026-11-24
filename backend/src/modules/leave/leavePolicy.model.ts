import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import type { Organization } from '../organizations/organization.model';
import type { LeaveType } from './leaveType.model';

export const ACCRUAL_FREQUENCIES = ['NONE', 'MONTHLY', 'QUARTERLY', 'ANNUAL'] as const;
export type AccrualFrequency = (typeof ACCRUAL_FREQUENCIES)[number];

/**
 * How a balance is reset. CUSTOM and FINANCIAL_YEAR use the configured
 * balancePeriodStartMonth/Day; CALENDAR_YEAR is always 1 January;
 * JOINING_ANNIVERSARY uses the employee's membership date; NEVER creates a
 * single open-ended period so nothing is reset automatically.
 */
export const RESET_PERIODS = [
  'CALENDAR_YEAR',
  'FINANCIAL_YEAR',
  'JOINING_ANNIVERSARY',
  'CUSTOM',
  'NEVER',
] as const;
export type ResetPeriod = (typeof RESET_PERIODS)[number];

/**
 * Order in which credits are consumed. EXPIRY_FIRST is the default and gives
 * the required earliest-expiry-first behaviour.
 */
export const CARRY_FORWARD_ORDERS = [
  'EXPIRY_FIRST',
  'CARRY_FORWARD_FIRST',
  'NEW_FIRST',
] as const;
export type CarryForwardOrder = (typeof CARRY_FORWARD_ORDERS)[number];

export const CREDIT_EXPIRY_REASONS = [
  'NONE',
  'MONTHLY_RESET',
  'ANNUAL_RESET',
  'CARRY_FORWARD',
] as const;
export type CreditExpiryReason = (typeof CREDIT_EXPIRY_REASONS)[number];

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
  carryForwardEnabled: boolean;
  carryForwardExpiryMonths: number | null;
  carryForwardOrder: CarryForwardOrder;
  resetPeriod: ResetPeriod;
  maxCreditsPerApplication: number | null;
  monthlyUsageLimitEnabled: boolean;
  monthlyUsageLimit: number | null;
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
  | 'carryForwardEnabled'
  | 'carryForwardExpiryMonths'
  | 'carryForwardOrder'
  | 'resetPeriod'
  | 'maxCreditsPerApplication'
  | 'monthlyUsageLimitEnabled'
  | 'monthlyUsageLimit'
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
  declare carryForwardEnabled: boolean;
  declare carryForwardExpiryMonths: number | null;
  declare carryForwardOrder: CarryForwardOrder;
  declare resetPeriod: ResetPeriod;
  declare maxCreditsPerApplication: number | null;
  declare monthlyUsageLimitEnabled: boolean;
  declare monthlyUsageLimit: number | null;
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
      carryForwardEnabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        field: 'carry_forward_enabled',
        defaultValue: false,
      },
      carryForwardExpiryMonths: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'carry_forward_expiry_months',
      },
      carryForwardOrder: {
        type: DataTypes.STRING(30),
        allowNull: false,
        field: 'carry_forward_order',
        defaultValue: 'EXPIRY_FIRST',
      },
      resetPeriod: {
        type: DataTypes.STRING(30),
        allowNull: false,
        field: 'reset_period',
        defaultValue: 'CUSTOM',
      },
      maxCreditsPerApplication: {
        type: DataTypes.DECIMAL(8, 2),
        allowNull: true,
        field: 'max_credits_per_application',
      },
      monthlyUsageLimitEnabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        field: 'monthly_usage_limit_enabled',
        defaultValue: false,
      },
      monthlyUsageLimit: {
        type: DataTypes.DECIMAL(8, 2),
        allowNull: true,
        field: 'monthly_usage_limit',
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
