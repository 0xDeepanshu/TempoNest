import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import { normalizeEmail } from '../../utils/email';
import { INVITABLE_ROLES, type InvitableRole } from '../memberships/roles';
import type { Organization } from '../organizations/organization.model';
import type { User } from '../users/user.model';

export interface InvitationAttributes {
  id: string;
  organizationId: string;
  email: string;
  role: InvitableRole;
  tokenHash: string;
  inviterId: string | null;
  expiresAt: Date;
  acceptedAt: Date | null;
  acceptedByUserId: string | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type InvitationCreationAttributes = Optional<
  InvitationAttributes,
  'id' | 'acceptedAt' | 'acceptedByUserId' | 'revokedAt' | 'createdAt' | 'updatedAt'
>;

export class Invitation
  extends Model<InvitationAttributes, InvitationCreationAttributes>
  implements InvitationAttributes
{
  declare id: string;
  declare organizationId: string;
  declare email: string;
  declare role: InvitableRole;
  declare tokenHash: string;
  declare inviterId: string | null;
  declare expiresAt: Date;
  declare acceptedAt: Date | null;
  declare acceptedByUserId: string | null;
  declare revokedAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare organization?: Organization;
  declare inviter?: User | null;
  declare acceptedByUser?: User | null;
}

export function initInvitation(sequelize: Sequelize): typeof Invitation {
  Invitation.init(
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
      email: {
        type: DataTypes.STRING(254),
        allowNull: false,
      },
      role: {
        type: DataTypes.ENUM(...INVITABLE_ROLES),
        allowNull: false,
        defaultValue: 'EMPLOYEE',
      },
      tokenHash: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
        field: 'token_hash',
      },
      inviterId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'inviter_id',
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'expires_at',
      },
      acceptedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'accepted_at',
      },
      acceptedByUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'accepted_by_user_id',
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      revokedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'revoked_at',
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
      modelName: 'Invitation',
      tableName: 'invitations',
      underscored: true,
      timestamps: true,
      hooks: {
        beforeValidate(invitation) {
          if (typeof invitation.email === 'string') {
            invitation.email = normalizeEmail(invitation.email);
          }
        },
      },
      indexes: [
        { name: 'invitations_token_hash_unique', unique: true, fields: ['token_hash'] },
        { name: 'invitations_organization_email_idx', fields: ['organization_id', 'email'] },
        { name: 'invitations_expires_at_idx', fields: ['expires_at'] },
      ],
    },
  );

  return Invitation;
}
