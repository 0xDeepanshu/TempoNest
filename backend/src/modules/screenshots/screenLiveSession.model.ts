import { DataTypes, Model, Op, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import type { Organization } from '../organizations/organization.model';
import type { User } from '../users/user.model';
import type { DesktopAgent } from '../desktopAgents/desktopAgent.model';
import type { TimeSession } from '../timeTracking/timeSession.model';
import type { ScreenLiveViewer } from './screenLiveViewer.model';
import type { ScreenLiveOrigin } from '../integrations/integration.constants';

export const SCREEN_LIVE_SESSION_STATUSES = ['ACTIVE', 'ENDED'] as const;
export type ScreenLiveSessionStatus = (typeof SCREEN_LIVE_SESSION_STATUSES)[number];

export const SCREEN_LIVE_TERMINATION_REASONS = [
  'VIEWER_STOPPED',
  'ALL_VIEWERS_LEFT',
  'AGENT_DISCONNECTED',
  'AGENT_FAILED',
  'EXPIRED',
  'POLICY_DISABLED',
  'SESSION_ENDED',
  'ORGANIZATION_SUSPENDED',
  'AGENT_REVOKED',
  'SERVER_SHUTDOWN',
  'VIEWER_LINK_REVOKED',
  'INTEGRATION_DISCONNECTED',
  'INDICATOR_UNAVAILABLE',
  'FEATURE_DISABLED',
  'VERIFICATION_UNAVAILABLE',
  'LINK_LEASE_EXPIRED',
] as const;
export type ScreenLiveTerminationReason = (typeof SCREEN_LIVE_TERMINATION_REASONS)[number];

export interface ScreenLiveSessionAttributes {
  id: string;
  organizationId: string;
  employeeId: string;
  desktopAgentId: string;
  timeSessionId: string;
  startedByUserId: string;
  status: ScreenLiveSessionStatus;
  startedAt: Date;
  expiresAt: Date;
  endedAt: Date | null;
  terminationReason: string | null;
  /** WORKZEN for the in-product flow, INTEGRATION for a linked partner viewer. */
  origin: ScreenLiveOrigin;
  integrationConnectionId: string | null;
  integrationViewerLinkId: string | null;
  externalOrganizationId: string | null;
  externalUserId: string | null;
  /** When the employee's desktop agent confirmed its on-screen indicator is visible. */
  indicatorConfirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ScreenLiveSessionCreationAttributes = Optional<
  ScreenLiveSessionAttributes,
  | 'id'
  | 'status'
  | 'endedAt'
  | 'terminationReason'
  | 'origin'
  | 'integrationConnectionId'
  | 'integrationViewerLinkId'
  | 'externalOrganizationId'
  | 'externalUserId'
  | 'indicatorConfirmedAt'
  | 'createdAt'
  | 'updatedAt'
>;

export class ScreenLiveSession
  extends Model<ScreenLiveSessionAttributes, ScreenLiveSessionCreationAttributes>
  implements ScreenLiveSessionAttributes
{
  declare id: string;
  declare organizationId: string;
  declare employeeId: string;
  declare desktopAgentId: string;
  declare timeSessionId: string;
  declare startedByUserId: string;
  declare status: ScreenLiveSessionStatus;
  declare startedAt: Date;
  declare expiresAt: Date;
  declare endedAt: Date | null;
  declare terminationReason: string | null;
  declare origin: ScreenLiveOrigin;
  declare integrationConnectionId: string | null;
  declare integrationViewerLinkId: string | null;
  declare externalOrganizationId: string | null;
  declare externalUserId: string | null;
  declare indicatorConfirmedAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare organization?: Organization;
  declare employee?: User;
  declare desktopAgent?: DesktopAgent;
  declare timeSession?: TimeSession;
  declare startedBy?: User;
  declare viewers?: ScreenLiveViewer[];
}

export function initScreenLiveSession(sequelize: Sequelize): typeof ScreenLiveSession {
  ScreenLiveSession.init(
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
      timeSessionId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'time_session_id',
        references: { model: 'time_sessions', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      startedByUserId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'started_by_user_id',
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      status: {
        type: DataTypes.STRING(16),
        allowNull: false,
        defaultValue: 'ACTIVE',
      },
      startedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'started_at',
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'expires_at',
      },
      endedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'ended_at',
      },
      terminationReason: {
        type: DataTypes.STRING(64),
        allowNull: true,
        field: 'termination_reason',
      },
      origin: {
        type: DataTypes.STRING(16),
        allowNull: false,
        defaultValue: 'WORKZEN',
      },
      integrationConnectionId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'integration_connection_id',
        references: { model: 'integration_connections', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      integrationViewerLinkId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'integration_viewer_link_id',
        references: { model: 'integration_viewer_links', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      externalOrganizationId: {
        type: DataTypes.STRING(200),
        allowNull: true,
        field: 'external_organization_id',
      },
      externalUserId: {
        type: DataTypes.STRING(200),
        allowNull: true,
        field: 'external_user_id',
      },
      indicatorConfirmedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'indicator_confirmed_at',
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
      modelName: 'ScreenLiveSession',
      tableName: 'screen_live_sessions',
      underscored: true,
      timestamps: true,
      indexes: [
        {
          name: 'screen_live_sessions_active_employee_unique',
          unique: true,
          fields: ['organization_id', 'employee_id'],
          where: { status: 'ACTIVE' } as never,
        },
        {
          name: 'screen_live_sessions_org_status_expires_idx',
          fields: ['organization_id', 'status', 'expires_at'],
        },
        {
          name: 'screen_live_sessions_agent_status_idx',
          fields: ['desktop_agent_id', 'status'],
        },
        {
          name: 'screen_live_sessions_employee_started_idx',
          fields: ['organization_id', 'employee_id', 'started_at'],
        },
      ],
    },
  );

  return ScreenLiveSession;
}

export function isActiveScreenLiveSession(
  session: Pick<ScreenLiveSessionAttributes, 'status' | 'expiresAt'>,
  now = new Date(),
): boolean {
  return session.status === 'ACTIVE' && session.expiresAt.getTime() > now.getTime();
}

export const ACTIVE_SCREEN_LIVE_STATUSES = ['ACTIVE'] as const;
export const SCREEN_LIVE_ACTIVE_WHERE = {
  status: { [Op.eq]: 'ACTIVE' },
};
