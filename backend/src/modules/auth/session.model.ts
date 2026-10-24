import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import type { User } from '../users/user.model';

export interface SessionAttributes {
  id: string;
  userId: string;
  accessTokenHash: string;
  accessExpiresAt: Date;
  refreshTokenHash: string;
  previousRefreshTokenHash: string | null;
  refreshExpiresAt: Date;
  csrfTokenHash: string;
  userAgent: string | null;
  ipAddress: string | null;
  lastUsedAt: Date;
  rotatedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type SessionCreationAttributes = Optional<
  SessionAttributes,
  | 'id'
  | 'previousRefreshTokenHash'
  | 'userAgent'
  | 'ipAddress'
  | 'lastUsedAt'
  | 'rotatedAt'
  | 'revokedAt'
  | 'createdAt'
  | 'updatedAt'
>;

export class Session extends Model<SessionAttributes, SessionCreationAttributes> implements SessionAttributes {
  declare id: string;
  declare userId: string;
  declare accessTokenHash: string;
  declare accessExpiresAt: Date;
  declare refreshTokenHash: string;
  declare previousRefreshTokenHash: string | null;
  declare refreshExpiresAt: Date;
  declare csrfTokenHash: string;
  declare userAgent: string | null;
  declare ipAddress: string | null;
  declare lastUsedAt: Date;
  declare rotatedAt: Date | null;
  declare revokedAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare user?: User;
}

export function initSession(sequelize: Sequelize): typeof Session {
  Session.init(
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: () => generateUuid(),
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'user_id',
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      accessTokenHash: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
        field: 'access_token_hash',
      },
      accessExpiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'access_expires_at',
      },
      refreshTokenHash: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
        field: 'refresh_token_hash',
      },
      previousRefreshTokenHash: {
        type: DataTypes.STRING(64),
        allowNull: true,
        field: 'previous_refresh_token_hash',
      },
      refreshExpiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'refresh_expires_at',
      },
      csrfTokenHash: {
        type: DataTypes.STRING(64),
        allowNull: false,
        field: 'csrf_token_hash',
      },
      userAgent: {
        type: DataTypes.STRING(512),
        allowNull: true,
        field: 'user_agent',
      },
      ipAddress: {
        type: DataTypes.STRING(45),
        allowNull: true,
        field: 'ip_address',
      },
      lastUsedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'last_used_at',
      },
      rotatedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'rotated_at',
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
      modelName: 'Session',
      tableName: 'sessions',
      underscored: true,
      timestamps: true,
      indexes: [
        { name: 'sessions_access_token_hash_unique', unique: true, fields: ['access_token_hash'] },
        { name: 'sessions_refresh_token_hash_unique', unique: true, fields: ['refresh_token_hash'] },
        { name: 'sessions_user_idx', fields: ['user_id'] },
        { name: 'sessions_previous_refresh_idx', fields: ['previous_refresh_token_hash'] },
        { name: 'sessions_refresh_expires_idx', fields: ['refresh_expires_at'] },
        { name: 'sessions_revoked_at_idx', fields: ['revoked_at'] },
      ],
    },
  );

  return Session;
}
