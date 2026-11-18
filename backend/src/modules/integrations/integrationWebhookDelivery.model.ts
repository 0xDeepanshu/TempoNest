import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import {
  INTEGRATION_WEBHOOK_DELIVERY_STATUSES,
  type IntegrationWebhookDeliveryStatus,
} from './integration.constants';
import type { IntegrationWebhookEvent } from './integrationWebhookEvent.model';
import type { IntegrationWebhookSubscription } from './integrationWebhookSubscription.model';
import type { Organization } from '../organizations/organization.model';

/** Per-subscription delivery attempt and its bounded retry state. */
export interface IntegrationWebhookDeliveryAttributes {
  id: string;
  eventId: string;
  subscriptionId: string;
  organizationId: string;
  status: IntegrationWebhookDeliveryStatus;
  attemptCount: number;
  nextAttemptAt: Date;
  lastAttemptAt: Date | null;
  responseStatus: number | null;
  error: string | null;
  deliveredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type IntegrationWebhookDeliveryCreationAttributes = Optional<
  IntegrationWebhookDeliveryAttributes,
  | 'id'
  | 'status'
  | 'attemptCount'
  | 'nextAttemptAt'
  | 'lastAttemptAt'
  | 'responseStatus'
  | 'error'
  | 'deliveredAt'
  | 'createdAt'
  | 'updatedAt'
>;

export class IntegrationWebhookDelivery
  extends Model<
    IntegrationWebhookDeliveryAttributes,
    IntegrationWebhookDeliveryCreationAttributes
  >
  implements IntegrationWebhookDeliveryAttributes
{
  declare id: string;
  declare eventId: string;
  declare subscriptionId: string;
  declare organizationId: string;
  declare status: IntegrationWebhookDeliveryStatus;
  declare attemptCount: number;
  declare nextAttemptAt: Date;
  declare lastAttemptAt: Date | null;
  declare responseStatus: number | null;
  declare error: string | null;
  declare deliveredAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare event?: IntegrationWebhookEvent;
  declare subscription?: IntegrationWebhookSubscription;
  declare organization?: Organization;
}

export function initIntegrationWebhookDelivery(
  sequelize: Sequelize,
): typeof IntegrationWebhookDelivery {
  IntegrationWebhookDelivery.init(
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: () => generateUuid(),
      },
      eventId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'event_id',
        references: { model: 'integration_webhook_events', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      subscriptionId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'subscription_id',
        references: { model: 'integration_webhook_subscriptions', key: 'id' },
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
      status: {
        type: DataTypes.ENUM(...INTEGRATION_WEBHOOK_DELIVERY_STATUSES),
        allowNull: false,
        defaultValue: 'PENDING',
      },
      attemptCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'attempt_count',
      },
      nextAttemptAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'next_attempt_at',
      },
      lastAttemptAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'last_attempt_at',
      },
      responseStatus: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'response_status',
      },
      error: {
        type: DataTypes.STRING(1000),
        allowNull: true,
      },
      deliveredAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'delivered_at',
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
      modelName: 'IntegrationWebhookDelivery',
      tableName: 'integration_webhook_deliveries',
      underscored: true,
      timestamps: true,
      indexes: [
        {
          name: 'integration_webhook_deliveries_event_sub_unique',
          unique: true,
          fields: ['event_id', 'subscription_id'],
        },
        {
          name: 'integration_webhook_deliveries_status_next_idx',
          fields: ['status', 'next_attempt_at'],
        },
        {
          name: 'integration_webhook_deliveries_subscription_created_idx',
          fields: ['subscription_id', 'created_at'],
        },
      ],
    },
  );

  return IntegrationWebhookDelivery;
}
