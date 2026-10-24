import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import type { Organization } from '../organizations/organization.model';
import type { TimeSession } from './timeSession.model';

export const BREAK_STATUSES = ['ACTIVE', 'ENDED'] as const;
export type BreakStatus = (typeof BREAK_STATUSES)[number];

export interface BreakAttributes {
  id: string;
  organizationId: string;
  timeSessionId: string;
  startedAt: Date;
  endedAt: Date | null;
  status: BreakStatus;
  createdAt: Date;
  updatedAt: Date;
}

export type BreakCreationAttributes = Optional<
  BreakAttributes,
  'id' | 'endedAt' | 'status' | 'createdAt' | 'updatedAt'
>;

export class Break extends Model<BreakAttributes, BreakCreationAttributes> implements BreakAttributes {
  declare id: string;
  declare organizationId: string;
  declare timeSessionId: string;
  declare startedAt: Date;
  declare endedAt: Date | null;
  declare status: BreakStatus;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare organization?: Organization;
  declare timeSession?: TimeSession;
}

export function initBreak(sequelize: Sequelize): typeof Break {
  Break.init(
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
      timeSessionId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'time_session_id',
        references: { model: 'time_sessions', key: 'id' },
        onDelete: 'CASCADE',
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
        type: DataTypes.ENUM(...BREAK_STATUSES),
        allowNull: false,
        defaultValue: 'ACTIVE',
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
      modelName: 'Break',
      tableName: 'breaks',
      underscored: true,
      timestamps: true,
      indexes: [
        {
          name: 'breaks_active_session_unique',
          unique: true,
          fields: ['time_session_id'],
          where: { ended_at: null },
        },
        { name: 'breaks_session_started_idx', fields: ['time_session_id', 'started_at'] },
        { name: 'breaks_org_started_idx', fields: ['organization_id', 'started_at'] },
      ],
    },
  );

  return Break;
}
