import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import {
  INTEGRATION_WEBHOOK_EVENT_STATUSES,
  type IntegrationWebhookEventStatus,
} from './integration.constants';
import type { IntegrationConnection } from './integrationConnection.model';
import type { Organization } from '../organizations/organization.model';

/**
 * Durable outbox row. One row represents one business event for one connected
 * organisation; per-subscription delivery state lives in delivery rows.
 */
export interface IntegrationWebhookEventAttributes {
  id: string;
  connectionId: string;
  organizationId: string;
  eventId: string;
  eventType: string;
  sequence: number;
  payload: Record<string, unknown>;
  occurredAt: Date;
  status: IntegrationWebhookEventStatus;
  attemptCount: number;
  lastError: string | null;
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type IntegrationWebhookEventCreationAttributes = Optional<
  IntegrationWebhookEventAttributes,
  | 'id'
  | 'status'
  | 'attemptCount'
  | 'lastError'
  | 'processedAt'
  | 'createdAt'
  | 'updatedAt'
>;

export class IntegrationWebhookEvent
  extends Model<IntegrationWebhookEventAttributes, IntegrationWebhookEventCreationAttributes>
  implements IntegrationWebhookEventAttributes
{
  declare id: string;
  declare connectionId: string;
  declare organizationId: string;
  declare eventId: string;
  declare eventType: string;
  declare sequence: number;
  declare payload: Record<string, unknown>;
  declare occurredAt: Date;
  declare status: IntegrationWebhookEventStatus;
  declare attemptCount: number;
  declare lastError: string | null;
  declare processedAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare connection?: IntegrationConnection;
  declare organization?: Organization;
}

export function initIntegrationWebhookEvent(
  sequelize: Sequelize,
): typeof IntegrationWebhookEvent {
  IntegrationWebhookEvent.init(
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
      eventId: {
        type: DataTypes.UUID,
        allowNull: false,
        unique: true,
        field: 'event_id',
      },
      eventType: {
        type: DataTypes.STRING(64),
        allowNull: false,
        field: 'event_type',
      },
      sequence: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      payload: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: {},
      },
      occurredAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'occurred_at',
      },
      status: {
        type: DataTypes.ENUM(...INTEGRATION_WEBHOOK_EVENT_STATUSES),
        allowNull: false,
        defaultValue: 'PENDING',
      },
      attemptCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'attempt_count',
      },
      lastError: {
        type: DataTypes.STRING(1000),
        allowNull: true,
        field: 'last_error',
      },
      processedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'processed_at',
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
      modelName: 'IntegrationWebhookEvent',
      tableName: 'integration_webhook_events',
      underscored: true,
      timestamps: true,
      indexes: [
        { name: 'integration_webhook_events_event_id_unique', unique: true, fields: ['event_id'] },
        {
          name: 'integration_webhook_events_connection_sequence_unique',
          unique: true,
          fields: ['connection_id', 'sequence'],
        },
        { name: 'integration_webhook_events_status_created_idx', fields: ['status', 'created_at'] },
        { name: 'integration_webhook_events_org_created_idx', fields: ['organization_id', 'created_at'] },
      ],
    },
  );

  return IntegrationWebhookEvent;
}
