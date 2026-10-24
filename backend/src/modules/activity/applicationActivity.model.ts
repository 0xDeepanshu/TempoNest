import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import type { Organization } from '../organizations/organization.model';
import type { User } from '../users/user.model';
import type { DesktopAgent } from '../desktopAgents/desktopAgent.model';
import type { TimeSession } from '../timeTracking/timeSession.model';

/**
 * Foreground application metadata only. The agent never sends window titles,
 * keystrokes, clipboard contents, or screenshots. Duration is recomputed from
 * the stored interval; a client-supplied duration is ignored.
 */
export interface ApplicationActivityAttributes {
  id: string;
  organizationId: string;
  employeeId: string;
  timeSessionId: string;
  desktopAgentId: string | null;
  applicationIdentifier: string;
  applicationName: string;
  startedAt: Date;
  endedAt: Date;
  durationSeconds: number;
  idempotencyKey: string;
  createdAt: Date;
  updatedAt: Date;
}

export type ApplicationActivityCreationAttributes = Optional<
  ApplicationActivityAttributes,
  'id' | 'durationSeconds' | 'createdAt' | 'updatedAt'
>;

export class ApplicationActivity
  extends Model<ApplicationActivityAttributes, ApplicationActivityCreationAttributes>
  implements ApplicationActivityAttributes
{
  declare id: string;
  declare organizationId: string;
  declare employeeId: string;
  declare timeSessionId: string;
  declare desktopAgentId: string | null;
  declare applicationIdentifier: string;
  declare applicationName: string;
  declare startedAt: Date;
  declare endedAt: Date;
  declare durationSeconds: number;
  declare idempotencyKey: string;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare organization?: Organization;
  declare employee?: User;
  declare desktopAgent?: DesktopAgent;
  declare timeSession?: TimeSession;
}

export function initApplicationActivity(sequelize: Sequelize): typeof ApplicationActivity {
  ApplicationActivity.init(
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
      applicationIdentifier: {
        type: DataTypes.STRING(200),
        allowNull: false,
        field: 'application_identifier',
      },
      applicationName: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: 'application_name',
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
      idempotencyKey: {
        type: DataTypes.STRING(160),
        allowNull: false,
        field: 'idempotency_key',
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
      modelName: 'ApplicationActivity',
      tableName: 'application_activities',
      underscored: true,
      timestamps: true,
      indexes: [
        {
          name: 'application_activities_agent_key_unique',
          unique: true,
          fields: ['desktop_agent_id', 'idempotency_key'],
        },
        {
          name: 'application_activities_org_employee_started_idx',
          fields: ['organization_id', 'employee_id', 'started_at'],
        },
        { name: 'application_activities_session_started_idx', fields: ['time_session_id', 'started_at'] },
        { name: 'application_activities_org_started_idx', fields: ['organization_id', 'started_at'] },
      ],
    },
  );

  return ApplicationActivity;
}
