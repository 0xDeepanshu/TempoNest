import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import type { Organization } from '../organizations/organization.model';
import type { User } from '../users/user.model';

/**
 * Per-employee monitoring settings.
 *
 * `enabled` is the general monitoring switch: it controls manual screenshot
 * requests and live screen viewing, and it is independent of the membership
 * role and of the organization-wide screenshot policy.
 *
 * `scheduledCaptureEnabled` is the separate, opt-in switch for automatic
 * periodic screenshots. It defaults to false for every employee, so scheduled
 * capture is never started implicitly. When it is enabled (and general
 * monitoring is also enabled), `captureIntervalMinutes` drives a server-side
 * schedule: the scheduler claims a due `nextCaptureAt` slot and creates the
 * same screenshot request an administrator would create manually.
 *
 * A missing row is treated as disabled defensively, so legacy or partially
 * migrated data is never captured implicitly.
 */
export const DEFAULT_CAPTURE_INTERVAL_MINUTES = 30;
export const SUPPORTED_CAPTURE_INTERVALS = [5, 10, 15, 20, 30, 45, 60] as const;
export type CaptureIntervalMinutes = (typeof SUPPORTED_CAPTURE_INTERVALS)[number];

/** Idempotency-key prefix used by server-side scheduled captures. */
export const SCHEDULED_CAPTURE_IDEMPOTENCY_PREFIX = 'scheduled:';

export interface EmployeeMonitoringPolicyAttributes {
  id: string;
  organizationId: string;
  employeeId: string;
  enabled: boolean;
  scheduledCaptureEnabled: boolean;
  captureIntervalMinutes: number;
  nextCaptureAt: Date | null;
  lastCaptureAt: Date | null;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type EmployeeMonitoringPolicyCreationAttributes = Optional<
  EmployeeMonitoringPolicyAttributes,
  | 'id'
  | 'enabled'
  | 'scheduledCaptureEnabled'
  | 'captureIntervalMinutes'
  | 'nextCaptureAt'
  | 'lastCaptureAt'
  | 'updatedByUserId'
  | 'createdAt'
  | 'updatedAt'
>;

export class EmployeeMonitoringPolicy
  extends Model<
    EmployeeMonitoringPolicyAttributes,
    EmployeeMonitoringPolicyCreationAttributes
  >
  implements EmployeeMonitoringPolicyAttributes
{
  declare id: string;
  declare organizationId: string;
  declare employeeId: string;
  declare enabled: boolean;
  declare scheduledCaptureEnabled: boolean;
  declare captureIntervalMinutes: number;
  declare nextCaptureAt: Date | null;
  declare lastCaptureAt: Date | null;
  declare updatedByUserId: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare organization?: Organization;
  declare employee?: User;
  declare updatedBy?: User;
}

export function initEmployeeMonitoringPolicy(
  sequelize: Sequelize,
): typeof EmployeeMonitoringPolicy {
  EmployeeMonitoringPolicy.init(
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
      enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      scheduledCaptureEnabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        field: 'scheduled_capture_enabled',
        defaultValue: false,
      },
      captureIntervalMinutes: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'capture_interval_minutes',
        defaultValue: DEFAULT_CAPTURE_INTERVAL_MINUTES,
      },
      nextCaptureAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'next_capture_at',
      },
      lastCaptureAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'last_capture_at',
      },
      updatedByUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'updated_by_user_id',
        references: { model: 'users', key: 'id' },
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
      modelName: 'EmployeeMonitoringPolicy',
      tableName: 'employee_monitoring_policies',
      underscored: true,
      timestamps: true,
      indexes: [
        {
          name: 'employee_monitoring_policies_org_employee_unique',
          unique: true,
          fields: ['organization_id', 'employee_id'],
        },
        {
          name: 'employee_monitoring_policies_due_idx',
          fields: ['scheduled_capture_enabled', 'enabled', 'next_capture_at'],
        },
      ],
    },
  );

  return EmployeeMonitoringPolicy;
}
