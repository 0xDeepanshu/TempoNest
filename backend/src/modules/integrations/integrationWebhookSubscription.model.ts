import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import {
  INTEGRATION_WEBHOOK_SUBSCRIPTION_STATUSES,
  type IntegrationWebhookSubscriptionStatus,
} from './integration.constants';
import type { IntegrationConnection } from './integrationConnection.model';
import type { Organization } from '../organizations/organization.model';
import type { User } from '../users/user.model';

/**
 * Webhook endpoint registered by the integration client. The signing secret is
 * encrypted at rest because it must be recoverable to compute HMAC signatures.
 * The plaintext secret is returned only when created or rotated.
 */
export interface IntegrationWebhookSubscriptionAttributes {
  id: string;
  connectionId: string;
  organizationId: string;
  url: string;
  description: string | null;
  eventTypes: string[];
  status: IntegrationWebhookSubscriptionStatus;
  secretCiphertext: string;
  secretVersion: number;
  previousSecretCiphertext: string | null;
  previousSecretExpiresAt: Date | null;
  createdByUserId: string | null;
  disabledAt: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  failureCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export type IntegrationWebhookSubscriptionCreationAttributes = Optional<
  IntegrationWebhookSubscriptionAttributes,
  | 'id'
  | 'description'
  | 'status'
  | 'secretVersion'
  | 'previousSecretCiphertext'
  | 'previousSecretExpiresAt'
  | 'createdByUserId'
  | 'disabledAt'
  | 'lastSuccessAt'
  | 'lastFailureAt'
  | 'failureCount'
  | 'createdAt'
  | 'updatedAt'
>;

export class IntegrationWebhookSubscription
  extends Model<
    IntegrationWebhookSubscriptionAttributes,
    IntegrationWebhookSubscriptionCreationAttributes
  >
  implements IntegrationWebhookSubscriptionAttributes
{
  declare id: string;
  declare connectionId: string;
  declare organizationId: string;
  declare url: string;
  declare description: string | null;
  declare eventTypes: string[];
  declare status: IntegrationWebhookSubscriptionStatus;
  declare secretCiphertext: string;
  declare secretVersion: number;
  declare previousSecretCiphertext: string | null;
  declare previousSecretExpiresAt: Date | null;
  declare createdByUserId: string | null;
  declare disabledAt: Date | null;
  declare lastSuccessAt: Date | null;
  declare lastFailureAt: Date | null;
  declare failureCount: number;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare connection?: IntegrationConnection;
  declare organization?: Organization;
  declare createdBy?: User | null;
}

export function initIntegrationWebhookSubscription(
  sequelize: Sequelize,
): typeof IntegrationWebhookSubscription {
  IntegrationWebhookSubscription.init(
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
      url: {
        type: DataTypes.STRING(2048),
        allowNull: false,
      },
      description: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },
      eventTypes: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [],
        field: 'event_types',
      },
      status: {
        type: DataTypes.ENUM(...INTEGRATION_WEBHOOK_SUBSCRIPTION_STATUSES),
        allowNull: false,
        defaultValue: 'ACTIVE',
      },
      secretCiphertext: {
        type: DataTypes.TEXT,
        allowNull: false,
        field: 'secret_ciphertext',
      },
      secretVersion: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
        field: 'secret_version',
      },
      previousSecretCiphertext: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: 'previous_secret_ciphertext',
      },
      previousSecretExpiresAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'previous_secret_expires_at',
      },
      createdByUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'created_by_user_id',
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      disabledAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'disabled_at',
      },
      lastSuccessAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'last_success_at',
      },
      lastFailureAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'last_failure_at',
      },
      failureCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'failure_count',
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
      modelName: 'IntegrationWebhookSubscription',
      tableName: 'integration_webhook_subscriptions',
      underscored: true,
      timestamps: true,
      indexes: [
        {
          name: 'integration_webhook_subscriptions_connection_idx',
          fields: ['connection_id', 'status'],
        },
        {
          name: 'integration_webhook_subscriptions_url_unique',
          unique: true,
          fields: ['connection_id', 'url'],
        },
      ],
    },
  );

  return IntegrationWebhookSubscription;
}
