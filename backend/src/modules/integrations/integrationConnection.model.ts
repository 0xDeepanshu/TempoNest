import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import {
  INTEGRATION_CONNECTION_STATUSES,
  type IntegrationConnectionStatus,
} from './integration.constants';
import type { IntegrationClient } from './integrationClient.model';
import type { Organization } from '../organizations/organization.model';
import type { User } from '../users/user.model';

/**
 * An organisation-level link between one Flowtrium organisation (identified by
 * an opaque external id owned by the client) and one WorkZen organisation.
 * Multiple Flowtrium organisations may connect to the same WorkZen organisation
 * but one Flowtrium organisation cannot be linked to two WorkZen organisations
 * under the same client at the same time.
 */
export interface IntegrationConnectionAttributes {
  id: string;
  clientId: string;
  organizationId: string;
  externalOrganizationId: string;
  status: IntegrationConnectionStatus;
  scopes: string[];
  connectedByUserId: string | null;
  connectedAt: Date;
  lastAuthorizedAt: Date;
  disconnectedAt: Date | null;
  revokedAt: Date | null;
  webhookSequence: number;
  createdAt: Date;
  updatedAt: Date;
}

export type IntegrationConnectionCreationAttributes = Optional<
  IntegrationConnectionAttributes,
  | 'id'
  | 'status'
  | 'connectedByUserId'
  | 'connectedAt'
  | 'lastAuthorizedAt'
  | 'disconnectedAt'
  | 'revokedAt'
  | 'webhookSequence'
  | 'createdAt'
  | 'updatedAt'
>;

export class IntegrationConnection
  extends Model<IntegrationConnectionAttributes, IntegrationConnectionCreationAttributes>
  implements IntegrationConnectionAttributes
{
  declare id: string;
  declare clientId: string;
  declare organizationId: string;
  declare externalOrganizationId: string;
  declare status: IntegrationConnectionStatus;
  declare scopes: string[];
  declare connectedByUserId: string | null;
  declare connectedAt: Date;
  declare lastAuthorizedAt: Date;
  declare disconnectedAt: Date | null;
  declare revokedAt: Date | null;
  declare webhookSequence: number;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare client?: IntegrationClient;
  declare organization?: Organization;
  declare connectedBy?: User | null;
}

export function initIntegrationConnection(sequelize: Sequelize): typeof IntegrationConnection {
  IntegrationConnection.init(
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: () => generateUuid(),
      },
      clientId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'client_id',
        references: { model: 'integration_clients', key: 'id' },
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
      externalOrganizationId: {
        type: DataTypes.STRING(200),
        allowNull: false,
        field: 'external_organization_id',
      },
      status: {
        type: DataTypes.ENUM(...INTEGRATION_CONNECTION_STATUSES),
        allowNull: false,
        defaultValue: 'ACTIVE',
      },
      scopes: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [],
      },
      connectedByUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'connected_by_user_id',
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      connectedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'connected_at',
      },
      lastAuthorizedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'last_authorized_at',
      },
      disconnectedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'disconnected_at',
      },
      revokedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'revoked_at',
      },
      webhookSequence: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'webhook_sequence',
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
      modelName: 'IntegrationConnection',
      tableName: 'integration_connections',
      underscored: true,
      timestamps: true,
      indexes: [
        { name: 'integration_connections_org_idx', fields: ['organization_id'] },
        { name: 'integration_connections_client_org_idx', fields: ['client_id', 'organization_id'] },
        { name: 'integration_connections_client_external_idx', fields: ['client_id', 'external_organization_id'] },
        { name: 'integration_connections_status_idx', fields: ['status'] },
        {
          name: 'integration_connections_active_external_unique',
          unique: true,
          fields: ['client_id', 'external_organization_id'],
          where: { status: 'ACTIVE' },
        },
      ],
    },
  );

  return IntegrationConnection;
}
