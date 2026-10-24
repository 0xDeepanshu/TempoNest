import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import { normalizeEmail } from '../../utils/email';
import type { Membership } from '../memberships/membership.model';
import type { Session } from '../auth/session.model';

export const USER_STATUSES = ['ACTIVE', 'DISABLED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export interface UserAttributes {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  status: UserStatus;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type UserCreationAttributes = Optional<
  UserAttributes,
  'id' | 'status' | 'lastLoginAt' | 'createdAt' | 'updatedAt'
>;

export class User extends Model<UserAttributes, UserCreationAttributes> implements UserAttributes {
  declare id: string;
  declare name: string;
  declare email: string;
  declare passwordHash: string;
  declare status: UserStatus;
  declare lastLoginAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare memberships?: Membership[];
  declare sessions?: Session[];
}

export function initUser(sequelize: Sequelize): typeof User {
  User.init(
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: () => generateUuid(),
      },
      name: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      email: {
        type: DataTypes.STRING(254),
        allowNull: false,
        unique: true,
      },
      passwordHash: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: 'password_hash',
      },
      status: {
        type: DataTypes.ENUM(...USER_STATUSES),
        allowNull: false,
        defaultValue: 'ACTIVE',
      },
      lastLoginAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'last_login_at',
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
      modelName: 'User',
      tableName: 'users',
      underscored: true,
      timestamps: true,
      defaultScope: {
        // Password hashes are excluded by default and only loaded explicitly
        // for authentication via User.unscoped().
        attributes: { exclude: ['passwordHash'] },
      },
      scopes: {
        withPassword: {
          attributes: { include: ['passwordHash'] },
        },
      },
      hooks: {
        beforeValidate(user) {
          if (typeof user.email === 'string') user.email = normalizeEmail(user.email);
          if (typeof user.name === 'string') user.name = user.name.trim();
        },
      },
      indexes: [
        { name: 'users_email_unique', unique: true, fields: ['email'] },
        { name: 'users_status_idx', fields: ['status'] },
      ],
    },
  );

  return User;
}
