import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import type { Organization } from '../organizations/organization.model';
import type { User } from '../users/user.model';

export const DESKTOP_AGENT_CLIENT_TYPES = ['ELECTRON', 'MOBILE'] as const;
export type DesktopAgentClientType = (typeof DESKTOP_AGENT_CLIENT_TYPES)[number];

/**
 * A registered device installation. The raw agent key is returned exactly
 * once at registration and only its HMAC hash is persisted. Revocation is
 * logical so that historical sessions and activity remain attributable.
 *
 * `clientType` records provenance: legacy and Electron registrations are
 * `ELECTRON`; mobile app installations register as `MOBILE`.
 */
export interface DesktopAgentAttributes {
  id: string;
  organizationId: string;
  userId: string;
  deviceIdentifier: string;
  name: string;
  platform: string | null;
  osVersion: string | null;
  appVersion: string | null;
  clientType: DesktopAgentClientType;
  agentKeyHash: string;
  lastSeenAt: Date | null;
  lastConnectedAt: Date | null;
  lastDisconnectedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type DesktopAgentCreationAttributes = Optional<
  DesktopAgentAttributes,
  | 'id'
  | 'platform'
  | 'osVersion'
  | 'appVersion'
  | 'clientType'
  | 'lastSeenAt'
  | 'lastConnectedAt'
  | 'lastDisconnectedAt'
  | 'revokedAt'
  | 'createdAt'
  | 'updatedAt'
>;

export class DesktopAgent
  extends Model<DesktopAgentAttributes, DesktopAgentCreationAttributes>
  implements DesktopAgentAttributes
{
  declare id: string;
  declare organizationId: string;
  declare userId: string;
  declare deviceIdentifier: string;
  declare name: string;
  declare platform: string | null;
  declare osVersion: string | null;
  declare appVersion: string | null;
  declare clientType: DesktopAgentClientType;
  declare agentKeyHash: string;
  declare lastSeenAt: Date | null;
  declare lastConnectedAt: Date | null;
  declare lastDisconnectedAt: Date | null;
  declare revokedAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare organization?: Organization;
  declare user?: User;
}

export function initDesktopAgent(sequelize: Sequelize): typeof DesktopAgent {
  DesktopAgent.init(
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
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'user_id',
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      deviceIdentifier: {
        type: DataTypes.STRING(160),
        allowNull: false,
        field: 'device_identifier',
      },
      name: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      platform: {
        type: DataTypes.STRING(40),
        allowNull: true,
      },
      osVersion: {
        type: DataTypes.STRING(80),
        allowNull: true,
        field: 'os_version',
      },
      appVersion: {
        type: DataTypes.STRING(40),
        allowNull: true,
        field: 'app_version',
      },
      clientType: {
        type: DataTypes.ENUM(...DESKTOP_AGENT_CLIENT_TYPES),
        allowNull: false,
        defaultValue: 'ELECTRON',
        field: 'client_type',
      },
      agentKeyHash: {
        type: DataTypes.STRING(64),
        allowNull: false,
        field: 'agent_key_hash',
      },
      lastSeenAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'last_seen_at',
      },
      lastConnectedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'last_connected_at',
      },
      lastDisconnectedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'last_disconnected_at',
      },
      revokedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'revoked_at',
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
      modelName: 'DesktopAgent',
      tableName: 'desktop_agents',
      underscored: true,
      timestamps: true,
      indexes: [
        {
          name: 'desktop_agents_org_user_device_unique',
          unique: true,
          fields: ['organization_id', 'user_id', 'device_identifier'],
        },
        { name: 'desktop_agents_org_user_idx', fields: ['organization_id', 'user_id'] },
        { name: 'desktop_agents_org_revoked_idx', fields: ['organization_id', 'revoked_at'] },
        { name: 'desktop_agents_last_seen_idx', fields: ['last_seen_at'] },
      ],
    },
  );

  return DesktopAgent;
}
