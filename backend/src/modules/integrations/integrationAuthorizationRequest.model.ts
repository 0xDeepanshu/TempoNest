import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import {
  INTEGRATION_AUTHORIZATION_REQUEST_STATUSES,
  type IntegrationAuthorizationRequestStatus,
} from './integration.constants';
import type { IntegrationClient } from './integrationClient.model';
import type { Organization } from '../organizations/organization.model';
import type { User } from '../users/user.model';

/**
 * A browser-bound authorization attempt. `state` is supplied by Flowtrium and
 * `browserBinding` is a WorkZen-generated secret in an HttpOnly cookie, so the
 * approval decision cannot be forged from another browser session.
 */
export interface IntegrationAuthorizationRequestAttributes {
  id: string;
  clientId: string;
  stateHash: string;
  /**
   * Encrypted copy of the client-supplied state. OAuth requires the state to be
   * echoed back verbatim; the plaintext column is never stored, and lookups are
   * still performed by the HMAC hash.
   */
  stateCiphertext: string;
  browserBindingHash: string;
  redirectUri: string;
  /**
   * The Flowtrium organization the browser was authorized for. Binding it to
   * the attempt prevents the code exchange from linking a different external
   * organization than the one the WorkZen administrator approved.
   */
  externalOrganizationId: string | null;
  scopes: string[];
  codeChallenge: string;
  codeChallengeMethod: string;
  status: IntegrationAuthorizationRequestStatus;
  authorizedByUserId: string | null;
  organizationId: string | null;
  expiresAt: Date;
  decidedAt: Date | null;
  consumedAt: Date | null;
  errorCode: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type IntegrationAuthorizationRequestCreationAttributes = Optional<
  IntegrationAuthorizationRequestAttributes,
  | 'id'
  | 'status'
  | 'authorizedByUserId'
  | 'organizationId'
  | 'externalOrganizationId'
  | 'decidedAt'
  | 'consumedAt'
  | 'errorCode'
  | 'ipAddress'
  | 'userAgent'
  | 'createdAt'
  | 'updatedAt'
>;

export class IntegrationAuthorizationRequest
  extends Model<
    IntegrationAuthorizationRequestAttributes,
    IntegrationAuthorizationRequestCreationAttributes
  >
  implements IntegrationAuthorizationRequestAttributes
{
  declare id: string;
  declare clientId: string;
  declare stateHash: string;
  declare stateCiphertext: string;
  declare browserBindingHash: string;
  declare redirectUri: string;
  declare externalOrganizationId: string | null;
  declare scopes: string[];
  declare codeChallenge: string;
  declare codeChallengeMethod: string;
  declare status: IntegrationAuthorizationRequestStatus;
  declare authorizedByUserId: string | null;
  declare organizationId: string | null;
  declare expiresAt: Date;
  declare decidedAt: Date | null;
  declare consumedAt: Date | null;
  declare errorCode: string | null;
  declare ipAddress: string | null;
  declare userAgent: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare client?: IntegrationClient;
  declare authorizedBy?: User | null;
  declare organization?: Organization | null;
}

export function initIntegrationAuthorizationRequest(
  sequelize: Sequelize,
): typeof IntegrationAuthorizationRequest {
  IntegrationAuthorizationRequest.init(
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
      stateHash: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
        field: 'state_hash',
      },
      stateCiphertext: {
        type: DataTypes.TEXT,
        allowNull: false,
        field: 'state_ciphertext',
      },
      browserBindingHash: {
        type: DataTypes.STRING(64),
        allowNull: false,
        field: 'browser_binding_hash',
      },
      redirectUri: {
        type: DataTypes.STRING(2048),
        allowNull: false,
        field: 'redirect_uri',
      },
      externalOrganizationId: {
        type: DataTypes.STRING(200),
        allowNull: true,
        field: 'external_organization_id',
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
      status: {
        type: DataTypes.ENUM(...INTEGRATION_AUTHORIZATION_REQUEST_STATUSES),
        allowNull: false,
        defaultValue: 'PENDING',
      },
      authorizedByUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'authorized_by_user_id',
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      organizationId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'organization_id',
        references: { model: 'organizations', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'expires_at',
      },
      decidedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'decided_at',
      },
      consumedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'consumed_at',
      },
      errorCode: {
        type: DataTypes.STRING(64),
        allowNull: true,
        field: 'error_code',
      },
      ipAddress: {
        type: DataTypes.STRING(64),
        allowNull: true,
        field: 'ip_address',
      },
      userAgent: {
        type: DataTypes.STRING(512),
        allowNull: true,
        field: 'user_agent',
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
      modelName: 'IntegrationAuthorizationRequest',
      tableName: 'integration_authorization_requests',
      underscored: true,
      timestamps: true,
      indexes: [
        {
          name: 'integration_auth_requests_state_hash_unique',
          unique: true,
          fields: ['state_hash'],
        },
        { name: 'integration_auth_requests_expires_idx', fields: ['expires_at'] },
        { name: 'integration_auth_requests_client_status_idx', fields: ['client_id', 'status'] },
      ],
    },
  );

  return IntegrationAuthorizationRequest;
}
