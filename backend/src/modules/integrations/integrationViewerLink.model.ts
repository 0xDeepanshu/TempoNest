import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import {
  INTEGRATION_VIEWER_LINK_REQUEST_STATUSES,
  INTEGRATION_VIEWER_LINK_STATUSES,
  type IntegrationViewerLinkRequestStatus,
  type IntegrationViewerLinkStatus,
} from './integration.constants';

/**
 * A pending request to bind one external (Flowtrium) user to a WorkZen user. It is created by the
 * integration with its own token, and consumed exactly once by a signed-in WorkZen OWNER on the
 * hosted approval page. Only the hash of the nonce is stored.
 */
export interface IntegrationViewerLinkRequestAttributes {
  id: string;
  connectionId: string;
  organizationId: string;
  externalUserId: string;
  externalUserLabel: string;
  externalOrganizationLabel: string;
  nonceHash: string;
  codeChallenge: string;
  browserBindingHash: string | null;
  status: IntegrationViewerLinkRequestStatus;
  expiresAt: Date;
  decidedAt: Date | null;
  decidedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type IntegrationViewerLinkRequestCreationAttributes = Optional<
  IntegrationViewerLinkRequestAttributes,
  'id' | 'browserBindingHash' | 'status' | 'decidedAt' | 'decidedByUserId' | 'createdAt' | 'updatedAt'
>;

export class IntegrationViewerLinkRequest
  extends Model<
    IntegrationViewerLinkRequestAttributes,
    IntegrationViewerLinkRequestCreationAttributes
  >
  implements IntegrationViewerLinkRequestAttributes
{
  declare id: string;
  declare connectionId: string;
  declare organizationId: string;
  declare externalUserId: string;
  declare externalUserLabel: string;
  declare externalOrganizationLabel: string;
  declare nonceHash: string;
  declare codeChallenge: string;
  declare browserBindingHash: string | null;
  declare status: IntegrationViewerLinkRequestStatus;
  declare expiresAt: Date;
  declare decidedAt: Date | null;
  declare decidedByUserId: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

export function initIntegrationViewerLinkRequest(
  sequelize: Sequelize,
): typeof IntegrationViewerLinkRequest {
  IntegrationViewerLinkRequest.init(
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
      externalUserId: { type: DataTypes.STRING(200), allowNull: false, field: 'external_user_id' },
      externalUserLabel: {
        type: DataTypes.STRING(200),
        allowNull: false,
        field: 'external_user_label',
      },
      externalOrganizationLabel: {
        type: DataTypes.STRING(200),
        allowNull: false,
        field: 'external_organization_label',
      },
      nonceHash: { type: DataTypes.STRING(64), allowNull: false, field: 'nonce_hash' },
      codeChallenge: { type: DataTypes.STRING(128), allowNull: false, field: 'code_challenge' },
      browserBindingHash: {
        type: DataTypes.STRING(64),
        allowNull: true,
        field: 'browser_binding_hash',
      },
      status: {
        type: DataTypes.STRING(16),
        allowNull: false,
        defaultValue: 'PENDING',
        validate: { isIn: [[...INTEGRATION_VIEWER_LINK_REQUEST_STATUSES]] },
      },
      expiresAt: { type: DataTypes.DATE, allowNull: false, field: 'expires_at' },
      decidedAt: { type: DataTypes.DATE, allowNull: true, field: 'decided_at' },
      decidedByUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'decided_by_user_id',
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    },
    {
      sequelize,
      modelName: 'IntegrationViewerLinkRequest',
      tableName: 'integration_viewer_link_requests',
      underscored: true,
      timestamps: true,
      indexes: [
        { name: 'integration_viewer_link_requests_nonce_unique', unique: true, fields: ['nonce_hash'] },
        {
          name: 'integration_viewer_link_requests_connection_user_idx',
          fields: ['connection_id', 'external_user_id', 'status'],
        },
      ],
    },
  );
  return IntegrationViewerLinkRequest;
}

/**
 * The verified identity binding. `workzenUserId` was authenticated by WorkZen itself during the
 * approval; `externalUserId` is the integration's claim about which of its own users that person
 * is. Nothing is ever matched by email.
 */
export interface IntegrationViewerLinkAttributes {
  id: string;
  connectionId: string;
  organizationId: string;
  workzenUserId: string;
  externalUserId: string;
  externalUserLabel: string;
  status: IntegrationViewerLinkStatus;
  requestId: string | null;
  linkedAt: Date;
  leaseExpiresAt: Date | null;
  revokedAt: Date | null;
  revokedByUserId: string | null;
  revokeReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type IntegrationViewerLinkCreationAttributes = Optional<
  IntegrationViewerLinkAttributes,
  | 'id'
  | 'status'
  | 'requestId'
  | 'leaseExpiresAt'
  | 'revokedAt'
  | 'revokedByUserId'
  | 'revokeReason'
  | 'createdAt'
  | 'updatedAt'
>;

export class IntegrationViewerLink
  extends Model<IntegrationViewerLinkAttributes, IntegrationViewerLinkCreationAttributes>
  implements IntegrationViewerLinkAttributes
{
  declare id: string;
  declare connectionId: string;
  declare organizationId: string;
  declare workzenUserId: string;
  declare externalUserId: string;
  declare externalUserLabel: string;
  declare status: IntegrationViewerLinkStatus;
  declare requestId: string | null;
  declare linkedAt: Date;
  declare leaseExpiresAt: Date | null;
  declare revokedAt: Date | null;
  declare revokedByUserId: string | null;
  declare revokeReason: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

export function initIntegrationViewerLink(sequelize: Sequelize): typeof IntegrationViewerLink {
  IntegrationViewerLink.init(
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
        allowNull: false,
        field: 'workzen_user_id',
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      externalUserId: { type: DataTypes.STRING(200), allowNull: false, field: 'external_user_id' },
      externalUserLabel: {
        type: DataTypes.STRING(200),
        allowNull: false,
        field: 'external_user_label',
      },
      status: {
        type: DataTypes.STRING(16),
        allowNull: false,
        defaultValue: 'ACTIVE',
        validate: { isIn: [[...INTEGRATION_VIEWER_LINK_STATUSES]] },
      },
      requestId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'request_id',
        references: { model: 'integration_viewer_link_requests', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      linkedAt: { type: DataTypes.DATE, allowNull: false, field: 'linked_at' },
      leaseExpiresAt: { type: DataTypes.DATE, allowNull: true, field: 'lease_expires_at' },
      revokedAt: { type: DataTypes.DATE, allowNull: true, field: 'revoked_at' },
      revokedByUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'revoked_by_user_id',
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      revokeReason: { type: DataTypes.STRING(64), allowNull: true, field: 'revoke_reason' },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    },
    {
      sequelize,
      modelName: 'IntegrationViewerLink',
      tableName: 'integration_viewer_links',
      underscored: true,
      timestamps: true,
      indexes: [
        {
          name: 'integration_viewer_links_active_external_unique',
          unique: true,
          fields: ['connection_id', 'external_user_id'],
          where: { status: 'ACTIVE' } as never,
        },
        {
          name: 'integration_viewer_links_active_workzen_unique',
          unique: true,
          fields: ['connection_id', 'workzen_user_id'],
          where: { status: 'ACTIVE' } as never,
        },
        { name: 'integration_viewer_links_org_status_idx', fields: ['organization_id', 'status'] },
      ],
    },
  );
  return IntegrationViewerLink;
}
