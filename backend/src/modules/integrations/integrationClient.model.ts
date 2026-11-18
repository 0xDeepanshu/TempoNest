import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import {
  INTEGRATION_CLIENT_STATUSES,
  type IntegrationClientStatus,
} from './integration.constants';

export interface IntegrationClientAttributes {
  id: string;
  clientId: string;
  name: string;
  description: string | null;
  redirectUris: string[];
  allowedScopes: string[];
  secretHash: string;
  status: IntegrationClientStatus;
  createdByUserId: string | null;
  lastSecretRotatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type IntegrationClientCreationAttributes = Optional<
  IntegrationClientAttributes,
  | 'id'
  | 'description'
  | 'createdByUserId'
  | 'lastSecretRotatedAt'
  | 'createdAt'
  | 'updatedAt'
>;

export class IntegrationClient
  extends Model<IntegrationClientAttributes, IntegrationClientCreationAttributes>
  implements IntegrationClientAttributes
{
  declare id: string;
  declare clientId: string;
  declare name: string;
  declare description: string | null;
  declare redirectUris: string[];
  declare allowedScopes: string[];
  declare secretHash: string;
  declare status: IntegrationClientStatus;
  declare createdByUserId: string | null;
  declare lastSecretRotatedAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

export function initIntegrationClient(sequelize: Sequelize): typeof IntegrationClient {
  IntegrationClient.init(
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: () => generateUuid(),
      },
      clientId: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
        field: 'client_id',
      },
      name: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      redirectUris: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [],
        field: 'redirect_uris',
      },
      allowedScopes: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [],
        field: 'allowed_scopes',
      },
      secretHash: {
        type: DataTypes.STRING(64),
        allowNull: false,
        field: 'secret_hash',
      },
      status: {
        type: DataTypes.ENUM(...INTEGRATION_CLIENT_STATUSES),
        allowNull: false,
        defaultValue: 'ACTIVE',
      },
      createdByUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'created_by_user_id',
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      lastSecretRotatedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'last_secret_rotated_at',
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
      modelName: 'IntegrationClient',
      tableName: 'integration_clients',
      underscored: true,
      timestamps: true,
      indexes: [
        { name: 'integration_clients_client_id_unique', unique: true, fields: ['client_id'] },
        { name: 'integration_clients_status_idx', fields: ['status'] },
      ],
    },
  );

  return IntegrationClient;
}
