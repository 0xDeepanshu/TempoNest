import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import type { Organization } from '../organizations/organization.model';
import type { User } from '../users/user.model';
import type { DesktopAgent } from '../desktopAgents/desktopAgent.model';

export const OFFLINE_EVENT_TYPES = [
  'SESSION_START',
  'SESSION_STOP',
  'BREAK_START',
  'BREAK_END',
] as const;
export type OfflineEventType = (typeof OFFLINE_EVENT_TYPES)[number];

export const OFFLINE_EVENT_STATUSES = ['APPLIED', 'CONFLICT'] as const;
export type OfflineEventStatus = (typeof OFFLINE_EVENT_STATUSES)[number];

/**
 * Durable idempotency ledger for offline time-tracking events. The unique
 * (agent, client event id) pair makes retries safe across process restarts.
 */
export interface AgentSyncEventAttributes {
  id: string;
  organizationId: string;
  employeeId: string;
  desktopAgentId: string;
  eventId: string;
  eventType: OfflineEventType;
  occurredAt: Date;
  status: OfflineEventStatus;
  conflictCode: string | null;
  message: string | null;
  result: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export type AgentSyncEventCreationAttributes = Optional<
  AgentSyncEventAttributes,
  'id' | 'status' | 'conflictCode' | 'message' | 'result' | 'createdAt' | 'updatedAt'
>;

export class AgentSyncEvent
  extends Model<AgentSyncEventAttributes, AgentSyncEventCreationAttributes>
  implements AgentSyncEventAttributes
{
  declare id: string;
  declare organizationId: string;
  declare employeeId: string;
  declare desktopAgentId: string;
  declare eventId: string;
  declare eventType: OfflineEventType;
  declare occurredAt: Date;
  declare status: OfflineEventStatus;
  declare conflictCode: string | null;
  declare message: string | null;
  declare result: Record<string, unknown>;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare organization?: Organization;
  declare employee?: User;
  declare desktopAgent?: DesktopAgent;
}

export function initAgentSyncEvent(sequelize: Sequelize): typeof AgentSyncEvent {
  AgentSyncEvent.init(
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
      employeeId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'employee_id',
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      desktopAgentId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'desktop_agent_id',
        references: { model: 'desktop_agents', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      eventId: {
        type: DataTypes.STRING(160),
        allowNull: false,
        field: 'event_id',
      },
      eventType: {
        type: DataTypes.ENUM(...OFFLINE_EVENT_TYPES),
        allowNull: false,
        field: 'event_type',
      },
      occurredAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'occurred_at',
      },
      status: {
        type: DataTypes.ENUM(...OFFLINE_EVENT_STATUSES),
        allowNull: false,
      },
      conflictCode: {
        type: DataTypes.STRING(80),
        allowNull: true,
        field: 'conflict_code',
      },
      message: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      result: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: {},
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
      modelName: 'AgentSyncEvent',
      tableName: 'agent_sync_events',
      underscored: true,
      timestamps: true,
      indexes: [
        {
          name: 'agent_sync_events_agent_event_unique',
          unique: true,
          fields: ['desktop_agent_id', 'event_id'],
        },
        { name: 'agent_sync_events_org_occurred_idx', fields: ['organization_id', 'occurred_at'] },
        { name: 'agent_sync_events_employee_occurred_idx', fields: ['employee_id', 'occurred_at'] },
      ],
    },
  );

  return AgentSyncEvent;
}
