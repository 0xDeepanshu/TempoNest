import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import type { Membership } from '../memberships/membership.model';
import type { Invitation } from '../invitations/invitation.model';

export const ORGANIZATION_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

export interface OrganizationAttributes {
  id: string;
  name: string;
  slug: string;
  status: OrganizationStatus;
  timezone: string;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type OrganizationCreationAttributes = Optional<
  OrganizationAttributes,
  'id' | 'status' | 'timezone' | 'deletedAt' | 'createdAt' | 'updatedAt'
>;

export class Organization
  extends Model<OrganizationAttributes, OrganizationCreationAttributes>
  implements OrganizationAttributes
{
  declare id: string;
  declare name: string;
  declare slug: string;
  declare status: OrganizationStatus;
  declare timezone: string;
  declare deletedAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare memberships?: Membership[];
  declare invitations?: Invitation[];
}

export function initOrganization(sequelize: Sequelize): typeof Organization {
  Organization.init(
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: () => generateUuid(),
      },
      name: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      slug: {
        type: DataTypes.STRING(140),
        allowNull: false,
        unique: true,
      },
      status: {
        type: DataTypes.ENUM(...ORGANIZATION_STATUSES),
        allowNull: false,
        defaultValue: 'ACTIVE',
      },
      timezone: {
        // IANA zone, e.g. "Europe/Berlin". Validated at the API boundary.
        type: DataTypes.STRING(64),
        allowNull: false,
        defaultValue: 'UTC',
      },
      deletedAt: {
        // Soft-delete marker. A deleted organization and every tenant-owned
        // record remain in place; access is blocked by the organization context
        // while platform administrators can still inspect and audit it.
        type: DataTypes.DATE,
        allowNull: true,
        field: 'deleted_at',
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
      modelName: 'Organization',
      tableName: 'organizations',
      underscored: true,
      timestamps: true,
      indexes: [
        { name: 'organizations_slug_unique', unique: true, fields: ['slug'] },
        { name: 'organizations_status_idx', fields: ['status'] },
        { name: 'organizations_deleted_at_idx', fields: ['deleted_at'] },
      ],
    },
  );

  return Organization;
}
