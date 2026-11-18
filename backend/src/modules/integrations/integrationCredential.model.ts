import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import type { IntegrationAuthorizationCode } from './integrationAuthorizationCode.model';
import type { IntegrationClient } from './integrationClient.model';
import type { IntegrationConnection } from './integrationConnection.model';
import type { User } from '../users/user.model';

/**
 * Scoped OAuth-style integration credential. Access and refresh tokens are
 * stored only as keyed hashes. Refresh rotation keeps a previous hash so reuse
 * of an already-rotated token is treated as theft and revokes the credential.
 */
export interface IntegrationCredentialAttributes {
  id: string;
  connectionId: string;
  clientId: string;
  authorizationCodeId: string | null;
  accessTokenHash: string;
  refreshTokenHash: string;
  previousRefreshTokenHash: string | null;
  scopes: string[];
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  lastUsedAt: Date;
  rotatedAt: Date | null;
  revokedAt: Date | null;
  revokedReason: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type IntegrationCredentialCreationAttributes = Optional<
  IntegrationCredentialAttributes,
  | 'id'
  | 'authorizationCodeId'
  | 'previousRefreshTokenHash'
  | 'lastUsedAt'
  | 'rotatedAt'
  | 'revokedAt'
  | 'revokedReason'
  | 'createdByUserId'
  | 'createdAt'
  | 'updatedAt'
>;

export class IntegrationCredential
  extends Model<IntegrationCredentialAttributes, IntegrationCredentialCreationAttributes>
  implements IntegrationCredentialAttributes
{
  declare id: string;
  declare connectionId: string;
  declare clientId: string;
  declare authorizationCodeId: string | null;
  declare accessTokenHash: string;
  declare refreshTokenHash: string;
  declare previousRefreshTokenHash: string | null;
  declare scopes: string[];
  declare accessExpiresAt: Date;
  declare refreshExpiresAt: Date;
  declare lastUsedAt: Date;
  declare rotatedAt: Date | null;
  declare revokedAt: Date | null;
  declare revokedReason: string | null;
  declare createdByUserId: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare connection?: IntegrationConnection;
  declare client?: IntegrationClient;
  declare authorizationCode?: IntegrationAuthorizationCode | null;
  declare createdBy?: User | null;
}

export function initIntegrationCredential(sequelize: Sequelize): typeof IntegrationCredential {
  IntegrationCredential.init(
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
      clientId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'client_id',
        references: { model: 'integration_clients', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      authorizationCodeId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'authorization_code_id',
        references: { model: 'integration_authorization_codes', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      accessTokenHash: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
        field: 'access_token_hash',
      },
      refreshTokenHash: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
        field: 'refresh_token_hash',
      },
      previousRefreshTokenHash: {
        type: DataTypes.STRING(64),
        allowNull: true,
        field: 'previous_refresh_token_hash',
      },
      scopes: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [],
      },
      accessExpiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'access_expires_at',
      },
      refreshExpiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'refresh_expires_at',
      },
      lastUsedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'last_used_at',
      },
      rotatedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'rotated_at',
      },
      revokedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'revoked_at',
      },
      revokedReason: {
        type: DataTypes.STRING(64),
        allowNull: true,
        field: 'revoked_reason',
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
      modelName: 'IntegrationCredential',
      tableName: 'integration_credentials',
      underscored: true,
      timestamps: true,
      indexes: [
        {
          name: 'integration_credentials_access_hash_unique',
          unique: true,
          fields: ['access_token_hash'],
        },
        {
          name: 'integration_credentials_refresh_hash_unique',
          unique: true,
          fields: ['refresh_token_hash'],
        },
        {
          name: 'integration_credentials_previous_refresh_idx',
          fields: ['previous_refresh_token_hash'],
        },
        { name: 'integration_credentials_connection_idx', fields: ['connection_id'] },
        { name: 'integration_credentials_revoked_idx', fields: ['revoked_at'] },
      ],
    },
  );

  return IntegrationCredential;
}
