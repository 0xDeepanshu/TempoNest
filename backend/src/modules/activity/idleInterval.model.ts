import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import type { Organization } from '../organizations/organization.model';
import type { User } from '../users/user.model';
import type { DesktopAgent } from '../desktopAgents/desktopAgent.model';
import type { TimeSession } from '../timeTracking/timeSession.model';

/**
 * A validated OS-level inactivity interval. The agent uses keyboard/mouse
 * inactivity signals locally; no keystrokes, pointer content, window titles,
 * clipboard content or screenshots are ever sent. Duration is recomputed from
 * the stored interval. `threshold_seconds` snapshots the organization policy
 * that applied when the interval was accepted.
 */
export interface ActivityIdleIntervalAttributes {
  id: string;
  organizationId: string;
  employeeId: string;
  timeSessionId: string;
  desktopAgentId: string | null;
  idempotencyKey: string;
  startedAt: Date;
  endedAt: Date;
  durationSeconds: number;
  thresholdSeconds: number;
  platform: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ActivityIdleIntervalCreationAttributes = Optional<
  ActivityIdleIntervalAttributes,
  'id' | 'desktopAgentId' | 'durationSeconds' | 'platform' | 'createdAt' | 'updatedAt'
>;

export class ActivityIdleInterval
  extends Model<ActivityIdleIntervalAttributes, ActivityIdleIntervalCreationAttributes>
  implements ActivityIdleIntervalAttributes
{
  declare id: string;
  declare organizationId: string;
  declare employeeId: string;
  declare timeSessionId: string;
  declare desktopAgentId: string | null;
  declare idempotencyKey: string;
  declare startedAt: Date;
  declare endedAt: Date;
  declare durationSeconds: number;
  declare thresholdSeconds: number;
  declare platform: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare organization?: Organization;
  declare employee?: User;
  declare desktopAgent?: DesktopAgent;
  declare timeSession?: TimeSession;
}

export function initActivityIdleInterval(sequelize: Sequelize): typeof ActivityIdleInterval {
  ActivityIdleInterval.init(
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
      timeSessionId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'time_session_id',
        references: { model: 'time_sessions', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      desktopAgentId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'desktop_agent_id',
        references: { model: 'desktop_agents', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      idempotencyKey: {
        type: DataTypes.STRING(160),
        allowNull: false,
        field: 'idempotency_key',
      },
      startedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'started_at',
      },
      endedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'ended_at',
      },
      durationSeconds: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'duration_seconds',
      },
      thresholdSeconds: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'threshold_seconds',
      },
      platform: {
        type: DataTypes.STRING(40),
        allowNull: true,
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
      modelName: 'ActivityIdleInterval',
      tableName: 'activity_idle_intervals',
      underscored: true,
      timestamps: true,
      indexes: [
        {
          name: 'activity_idle_intervals_agent_key_unique',
          unique: true,
          fields: ['desktop_agent_id', 'idempotency_key'],
        },
        {
          name: 'activity_idle_intervals_org_employee_started_idx',
          fields: ['organization_id', 'employee_id', 'started_at'],
        },
        {
          name: 'activity_idle_intervals_session_started_idx',
          fields: ['time_session_id', 'started_at'],
        },
        {
          name: 'activity_idle_intervals_org_started_idx',
          fields: ['organization_id', 'started_at'],
        },
      ],
    },
  );

  return ActivityIdleInterval;
}
