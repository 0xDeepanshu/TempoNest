import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import { ROLES, type Role } from './roles';
import type { Organization } from '../organizations/organization.model';
import type { User } from '../users/user.model';
import type { CustomRole } from '../roles/customRole.model';

export const MEMBERSHIP_STATUSES = ['ACTIVE', 'SUSPENDED', 'REMOVED'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export interface MembershipAttributes {
  id: string;
  organizationId: string;
  userId: string;
  role: Role;
  customRoleId: string | null;
  status: MembershipStatus;
  removedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type MembershipCreationAttributes = Optional<
  MembershipAttributes,
  'id' | 'customRoleId' | 'status' | 'removedAt' | 'createdAt' | 'updatedAt'
>;

export class Membership
  extends Model<MembershipAttributes, MembershipCreationAttributes>
  implements MembershipAttributes
{
  declare id: string;
  declare organizationId: string;
  declare userId: string;
  declare role: Role;
  declare customRoleId: string | null;
  declare status: MembershipStatus;
  declare removedAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare organization?: Organization;
  declare user?: User;
  declare customRole?: CustomRole | null;
}

export function initMembership(sequelize: Sequelize): typeof Membership {
  Membership.init(
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
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'user_id',
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      role: {
        type: DataTypes.ENUM(...ROLES),
        allowNull: false,
        defaultValue: 'EMPLOYEE',
      },
      customRoleId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'custom_role_id',
        references: { model: 'custom_roles', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      status: {
        type: DataTypes.ENUM(...MEMBERSHIP_STATUSES),
        allowNull: false,
        defaultValue: 'ACTIVE',
      },
      removedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'removed_at',
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
      modelName: 'Membership',
      tableName: 'memberships',
      underscored: true,
      timestamps: true,
      indexes: [
        {
          name: 'memberships_organization_user_unique',
          unique: true,
          fields: ['organization_id', 'user_id'],
        },
        { name: 'memberships_organization_status_idx', fields: ['organization_id', 'status'] },
        { name: 'memberships_user_idx', fields: ['user_id'] },
        { name: 'memberships_organization_role_idx', fields: ['organization_id', 'role'] },
        { name: 'memberships_custom_role_idx', fields: ['custom_role_id'] },
      ],
    },
  );

  return Membership;
}
