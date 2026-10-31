import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import { DATA_SCOPES, type DataScope, type Permission } from '../memberships/permissions';
import type { Organization } from '../organizations/organization.model';
import type { User } from '../users/user.model';

export interface CustomRoleAttributes {
  id: string;
  organizationId: string;
  name: string;
  nameNormalized: string;
  description: string | null;
  permissions: Permission[];
  dataScope: DataScope;
  onboardingEligible: boolean;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type CustomRoleCreationAttributes = Optional<
  CustomRoleAttributes,
  | 'id'
  | 'description'
  | 'permissions'
  | 'dataScope'
  | 'onboardingEligible'
  | 'createdByUserId'
  | 'createdAt'
  | 'updatedAt'
>;

export class CustomRole
  extends Model<CustomRoleAttributes, CustomRoleCreationAttributes>
  implements CustomRoleAttributes
{
  declare id: string;
  declare organizationId: string;
  declare name: string;
  declare nameNormalized: string;
  declare description: string | null;
  declare permissions: Permission[];
  declare dataScope: DataScope;
  declare onboardingEligible: boolean;
  declare createdByUserId: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare organization?: Organization;
  declare createdBy?: User;
}

export function initCustomRole(sequelize: Sequelize): typeof CustomRole {
  CustomRole.init(
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
        type: DataTypes.STRING(80),
        allowNull: false,
      },
      nameNormalized: {
        type: DataTypes.STRING(80),
        allowNull: false,
        field: 'name_normalized',
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
        defaultValue: 'SELF',
      },
      onboardingEligible: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        field: 'onboarding_eligible',
        defaultValue: false,
      },
      createdByUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'created_by_user_id',
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
      modelName: 'CustomRole',
      tableName: 'custom_roles',
      underscored: true,
      timestamps: true,
      indexes: [
        {
          name: 'custom_roles_org_name_unique',
          unique: true,
          fields: ['organization_id', 'name_normalized'],
        },
        { name: 'custom_roles_org_created_idx', fields: ['organization_id', 'created_at'] },
      ],
    },
  );

  return CustomRole;
}
