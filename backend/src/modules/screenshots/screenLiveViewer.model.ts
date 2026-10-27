import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import type { Organization } from '../organizations/organization.model';
import type { User } from '../users/user.model';
import type { ScreenLiveSession } from './screenLiveSession.model';

export interface ScreenLiveViewerAttributes {
  id: string;
  organizationId: string;
  screenLiveSessionId: string;
  userId: string;
  ticketHash: string | null;
  ticketExpiresAt: Date | null;
  joinedAt: Date | null;
  leftAt: Date | null;
  lastSeenAt: Date | null;
  disconnectedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ScreenLiveViewerCreationAttributes = Optional<
  ScreenLiveViewerAttributes,
  | 'id'
  | 'ticketHash'
  | 'ticketExpiresAt'
  | 'joinedAt'
  | 'leftAt'
  | 'lastSeenAt'
  | 'disconnectedReason'
  | 'createdAt'
  | 'updatedAt'
>;

/**
 * An authorized admin viewer attached to a live session. The opaque viewer
 * ticket is stored only as an HMAC hash and is consumed on WebSocket connect.
 * No frame data is ever stored.
 */
export class ScreenLiveViewer
  extends Model<ScreenLiveViewerAttributes, ScreenLiveViewerCreationAttributes>
  implements ScreenLiveViewerAttributes
{
  declare id: string;
  declare organizationId: string;
  declare screenLiveSessionId: string;
  declare userId: string;
  declare ticketHash: string | null;
  declare ticketExpiresAt: Date | null;
  declare joinedAt: Date | null;
  declare leftAt: Date | null;
  declare lastSeenAt: Date | null;
  declare disconnectedReason: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare organization?: Organization;
  declare session?: ScreenLiveSession;
  declare user?: User;
}

export function initScreenLiveViewer(sequelize: Sequelize): typeof ScreenLiveViewer {
  ScreenLiveViewer.init(
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
      screenLiveSessionId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'screen_live_session_id',
        references: { model: 'screen_live_sessions', key: 'id' },
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
      ticketHash: {
        type: DataTypes.STRING(64),
        allowNull: true,
        field: 'ticket_hash',
      },
      ticketExpiresAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'ticket_expires_at',
      },
      joinedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'joined_at',
      },
      leftAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'left_at',
      },
      lastSeenAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'last_seen_at',
      },
      disconnectedReason: {
        type: DataTypes.STRING(64),
        allowNull: true,
        field: 'disconnected_reason',
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
      modelName: 'ScreenLiveViewer',
      tableName: 'screen_live_viewers',
      underscored: true,
      timestamps: true,
      indexes: [
        {
          name: 'screen_live_viewers_session_idx',
          fields: ['screen_live_session_id'],
        },
        {
          name: 'screen_live_viewers_ticket_unique',
          unique: true,
          fields: ['ticket_hash'],
        },
        {
          name: 'screen_live_viewers_org_user_idx',
          fields: ['organization_id', 'user_id'],
        },
      ],
    },
  );

  return ScreenLiveViewer;
}
