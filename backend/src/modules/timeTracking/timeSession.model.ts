import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import type { Organization } from '../organizations/organization.model';
import type { User } from '../users/user.model';
import type { DesktopAgent } from '../desktopAgents/desktopAgent.model';
import type { Break } from './break.model';

export const TIME_SESSION_STATUSES = ['ACTIVE', 'ON_BREAK', 'STOPPED'] as const;
export type TimeSessionStatus = (typeof TIME_SESSION_STATUSES)[number];

export const TIME_SESSION_SOURCES = ['ONLINE', 'OFFLINE'] as const;
export type TimeSessionSource = (typeof TIME_SESSION_SOURCES)[number];

export interface TimeSessionAttributes {
  id: string;
  organizationId: string;
  employeeId: string;
  desktopAgentId: string | null;
  startedAt: Date;
  endedAt: Date | null;
  status: TimeSessionStatus;
  source: TimeSessionSource;
  lastHeartbeatAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type TimeSessionCreationAttributes = Optional<
  TimeSessionAttributes,
  'id' | 'endedAt' | 'status' | 'source' | 'createdAt' | 'updatedAt'
>;

export class TimeSession
  extends Model<TimeSessionAttributes, TimeSessionCreationAttributes>
  implements TimeSessionAttributes
{
  declare id: string;
  declare organizationId: string;
  declare employeeId: string;
  declare desktopAgentId: string | null;
  declare startedAt: Date;
  declare endedAt: Date | null;
  declare status: TimeSessionStatus;
  declare source: TimeSessionSource;
  declare lastHeartbeatAt: Date;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare organization?: Organization;
  declare employee?: User;
  declare desktopAgent?: DesktopAgent;
  declare breaks?: Break[];
}

export function initTimeSession(sequelize: Sequelize): typeof TimeSession {
  TimeSession.init(
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
        allowNull: true,
        field: 'desktop_agent_id',
        references: { model: 'desktop_agents', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      startedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'started_at',
      },
      endedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'ended_at',
      },
      status: {
        type: DataTypes.ENUM(...TIME_SESSION_STATUSES),
        allowNull: false,
        defaultValue: 'ACTIVE',
      },
      source: {
        type: DataTypes.ENUM(...TIME_SESSION_SOURCES),
        allowNull: false,
        defaultValue: 'ONLINE',
      },
      lastHeartbeatAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'last_heartbeat_at',
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
      modelName: 'TimeSession',
      tableName: 'time_sessions',
      underscored: true,
      timestamps: true,
      indexes: [
        // A database-level guard against duplicate concurrent work. The
        // service also locks the employee row; these indexes are the last
        // line of defence and cover multiple application instances.
        {
          name: 'time_sessions_active_employee_unique',
          unique: true,
          fields: ['employee_id'],
          where: { ended_at: null },
        },
        {
          name: 'time_sessions_active_agent_unique',
          unique: true,
          fields: ['desktop_agent_id'],
          where: { ended_at: null },
        },
        { name: 'time_sessions_org_employee_started_idx', fields: ['organization_id', 'employee_id', 'started_at'] },
        { name: 'time_sessions_org_started_idx', fields: ['organization_id', 'started_at'] },
        { name: 'time_sessions_agent_started_idx', fields: ['desktop_agent_id', 'started_at'] },
        { name: 'time_sessions_heartbeat_idx', fields: ['last_heartbeat_at'] },
      ],
    },
  );

  return TimeSession;
}
