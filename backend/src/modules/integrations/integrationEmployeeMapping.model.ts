import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import {
  INTEGRATION_EMPLOYEE_MAPPING_STATUSES,
  INTEGRATION_MATCH_METHODS,
  type IntegrationEmployeeMappingStatus,
  type IntegrationMatchMethod,
} from './integration.constants';
import type { IntegrationConnection } from './integrationConnection.model';
import type { Organization } from '../organizations/organization.model';
import type { User } from '../users/user.model';

/**
 * Identity link between an existing Flowtrium employee and an existing WorkZen
 * employee. No user or membership rows are created, merged or modified.
 */
export interface IntegrationEmployeeMappingAttributes {
  id: string;
  connectionId: string;
  organizationId: string;
  /** Null while an external employee is pending manual matching. */
  workzenUserId: string | null;
  externalEmployeeId: string;
  externalEmployeeEmail: string | null;
  workzenEmailSnapshot: string | null;
  status: IntegrationEmployeeMappingStatus;
  matchMethod: IntegrationMatchMethod | null;
  conflictReason: string | null;
  resolvedByUserId: string | null;
  resolvedAt: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type IntegrationEmployeeMappingCreationAttributes = Optional<
  IntegrationEmployeeMappingAttributes,
  | 'id'
  | 'workzenUserId'
  | 'externalEmployeeEmail'
  | 'workzenEmailSnapshot'
  | 'status'
  | 'matchMethod'
  | 'conflictReason'
  | 'resolvedByUserId'
  | 'resolvedAt'
  | 'notes'
  | 'createdAt'
  | 'updatedAt'
>;

export class IntegrationEmployeeMapping
  extends Model<IntegrationEmployeeMappingAttributes, IntegrationEmployeeMappingCreationAttributes>
  implements IntegrationEmployeeMappingAttributes
{
  declare id: string;
  declare connectionId: string;
  declare organizationId: string;
  declare workzenUserId: string | null;
  declare externalEmployeeId: string;
  declare externalEmployeeEmail: string | null;
  declare workzenEmailSnapshot: string | null;
  declare status: IntegrationEmployeeMappingStatus;
  declare matchMethod: IntegrationMatchMethod | null;
  declare conflictReason: string | null;
  declare resolvedByUserId: string | null;
  declare resolvedAt: Date | null;
  declare notes: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare connection?: IntegrationConnection;
  declare organization?: Organization;
  declare workzenUser?: User;
  declare resolvedBy?: User | null;
}

export function initIntegrationEmployeeMapping(
  sequelize: Sequelize,
): typeof IntegrationEmployeeMapping {
  IntegrationEmployeeMapping.init(
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: () => generateUuid(),
      },
      connectionId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'connection_id',
        references: { model: 'integration_connections', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      organizationId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'organization_id',
        references: { model: 'organizations', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      workzenUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'workzen_user_id',
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      externalEmployeeId: {
        type: DataTypes.STRING(200),
        allowNull: false,
        field: 'external_employee_id',
      },
      externalEmployeeEmail: {
        type: DataTypes.STRING(254),
        allowNull: true,
        field: 'external_employee_email',
      },
      workzenEmailSnapshot: {
        type: DataTypes.STRING(254),
        allowNull: true,
        field: 'workzen_email_snapshot',
      },
      status: {
        type: DataTypes.ENUM(...INTEGRATION_EMPLOYEE_MAPPING_STATUSES),
        allowNull: false,
        defaultValue: 'PENDING',
      },
      matchMethod: {
        type: DataTypes.ENUM(...INTEGRATION_MATCH_METHODS),
        allowNull: true,
        field: 'match_method',
      },
      conflictReason: {
        type: DataTypes.STRING(64),
        allowNull: true,
        field: 'conflict_reason',
      },
      resolvedByUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'resolved_by_user_id',
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      resolvedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'resolved_at',
      },
      notes: {
        type: DataTypes.STRING(500),
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
      modelName: 'IntegrationEmployeeMapping',
      tableName: 'integration_employee_mappings',
      underscored: true,
      timestamps: true,
      indexes: [
        {
          name: 'integration_employee_mappings_workzen_unique',
          unique: true,
          fields: ['connection_id', 'workzen_user_id'],
        },
        {
          name: 'integration_employee_mappings_external_unique',
          unique: true,
          fields: ['connection_id', 'external_employee_id'],
        },
        {
          name: 'integration_employee_mappings_org_status_idx',
          fields: ['organization_id', 'status'],
        },
      ],
    },
  );

  return IntegrationEmployeeMapping;
}
