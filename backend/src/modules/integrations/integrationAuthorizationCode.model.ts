import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import type { IntegrationAuthorizationRequest } from './integrationAuthorizationRequest.model';
import type { IntegrationClient } from './integrationClient.model';
import type { IntegrationConnection } from './integrationConnection.model';
import type { Organization } from '../organizations/organization.model';
import type { User } from '../users/user.model';

/** Short-lived, single-use authorization code. Only its keyed hash is stored. */
export interface IntegrationAuthorizationCodeAttributes {
  id: string;
  authorizationRequestId: string;
  clientId: string;
  organizationId: string;
  authorizedByUserId: string | null;
  connectionId: string | null;
  codeHash: string;
  redirectUri: string;
  scopes: string[];
  codeChallenge: string;
  codeChallengeMethod: string;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type IntegrationAuthorizationCodeCreationAttributes = Optional<
  IntegrationAuthorizationCodeAttributes,
  | 'id'
  | 'authorizedByUserId'
  | 'connectionId'
  | 'consumedAt'
  | 'createdAt'
  | 'updatedAt'
>;

export class IntegrationAuthorizationCode
  extends Model<
    IntegrationAuthorizationCodeAttributes,
    IntegrationAuthorizationCodeCreationAttributes
  >
  implements IntegrationAuthorizationCodeAttributes
{
  declare id: string;
  declare authorizationRequestId: string;
  declare clientId: string;
  declare organizationId: string;
  declare authorizedByUserId: string | null;
  declare connectionId: string | null;
  declare codeHash: string;
  declare redirectUri: string;
  declare scopes: string[];
  declare codeChallenge: string;
  declare codeChallengeMethod: string;
  declare expiresAt: Date;
  declare consumedAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare authorizationRequest?: IntegrationAuthorizationRequest;
  declare client?: IntegrationClient;
  declare organization?: Organization;
  declare authorizedBy?: User | null;
  declare connection?: IntegrationConnection | null;
}

export function initIntegrationAuthorizationCode(
  sequelize: Sequelize,
): typeof IntegrationAuthorizationCode {
  IntegrationAuthorizationCode.init(
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: () => generateUuid(),
      },
      authorizationRequestId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'authorization_request_id',
        references: { model: 'integration_authorization_requests', key: 'id' },
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
      organizationId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'organization_id',
        references: { model: 'organizations', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      authorizedByUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'authorized_by_user_id',
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      connectionId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'connection_id',
        references: { model: 'integration_connections', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      codeHash: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
        field: 'code_hash',
      },
      redirectUri: {
        type: DataTypes.STRING(2048),
        allowNull: false,
        field: 'redirect_uri',
      },
      scopes: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [],
      },
      codeChallenge: {
        type: DataTypes.STRING(128),
        allowNull: false,
        field: 'code_challenge',
      },
      codeChallengeMethod: {
        type: DataTypes.STRING(10),
        allowNull: false,
        defaultValue: 'S256',
        field: 'code_challenge_method',
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'expires_at',
      },
      consumedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'consumed_at',
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
      modelName: 'IntegrationAuthorizationCode',
      tableName: 'integration_authorization_codes',
      underscored: true,
      timestamps: true,
      indexes: [
        {
          name: 'integration_auth_codes_hash_unique',
          unique: true,
          fields: ['code_hash'],
        },
        { name: 'integration_auth_codes_expires_idx', fields: ['expires_at'] },
        { name: 'integration_auth_codes_client_idx', fields: ['client_id'] },
        { name: 'integration_auth_codes_org_idx', fields: ['organization_id'] },
      ],
    },
  );

  return IntegrationAuthorizationCode;
}
