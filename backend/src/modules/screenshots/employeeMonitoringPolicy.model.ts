import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import type { Organization } from '../organizations/organization.model';
import type { User } from '../users/user.model';

/**
 * Per-employee monitoring switch. This is deliberately independent of the
 * membership role and of the organization-wide screenshot policy: monitoring
 * requires both the organization policy and this employee policy to be enabled.
 *
 * A missing row means DISABLED. Existing employees are therefore never
 * monitored implicitly when this table is introduced.
 */
export interface EmployeeMonitoringPolicyAttributes {
  id: string;
  organizationId: string;
  employeeId: string;
  enabled: boolean;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type EmployeeMonitoringPolicyCreationAttributes = Optional<
  EmployeeMonitoringPolicyAttributes,
  'id' | 'enabled' | 'updatedByUserId' | 'createdAt' | 'updatedAt'
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
      ],
    },
  );

  return EmployeeMonitoringPolicy;
}
