import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import { DATA_SCOPES, type DataScope, type Permission } from '../memberships/permissions';
import type { Organization } from '../organizations/organization.model';
import type { User } from '../users/user.model';

export interface ManagerRoleOverrideAttributes {
  id: string;
  organizationId: string;
  description: string | null;
  permissions: Permission[];
  dataScope: DataScope;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ManagerRoleOverrideCreationAttributes = Optional<
  ManagerRoleOverrideAttributes,
  'id' | 'description' | 'permissions' | 'dataScope' | 'updatedByUserId' | 'createdAt' | 'updatedAt'
>;

export class ManagerRoleOverride
  extends Model<ManagerRoleOverrideAttributes, ManagerRoleOverrideCreationAttributes>
  implements ManagerRoleOverrideAttributes
{
  declare id: string;
  declare organizationId: string;
  declare description: string | null;
  declare permissions: Permission[];
  declare dataScope: DataScope;
  declare updatedByUserId: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare organization?: Organization;
  declare updatedBy?: User | null;
}

export function initManagerRoleOverride(sequelize: Sequelize): typeof ManagerRoleOverride {
  ManagerRoleOverride.init(
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
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      permissions: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [],
      },
      dataScope: {
        type: DataTypes.ENUM(...DATA_SCOPES),
        allowNull: false,
        field: 'data_scope',
        defaultValue: 'ORGANIZATION',
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
      modelName: 'ManagerRoleOverride',
      tableName: 'manager_role_overrides',
      underscored: true,
      timestamps: true,
      indexes: [
        {
          name: 'manager_role_overrides_org_unique',
          unique: true,
          fields: ['organization_id'],
        },
      ],
    },
  );

  return ManagerRoleOverride;
}
