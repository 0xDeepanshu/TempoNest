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
  createdAt: Date;
  updatedAt: Date;
}

export type OrganizationCreationAttributes = Optional<
  OrganizationAttributes,
  'id' | 'status' | 'timezone' | 'createdAt' | 'updatedAt'
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
      ],
    },
  );

  return Organization;
}
