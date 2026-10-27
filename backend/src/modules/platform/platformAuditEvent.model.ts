import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import type { Organization } from '../organizations/organization.model';
import type { User } from '../users/user.model';

export const PLATFORM_AUDIT_ACTIONS = [
  'ORGANIZATION_RENAMED',
  'ORGANIZATION_SUSPENDED',
  'ORGANIZATION_REACTIVATED',
  'ORGANIZATION_SOFT_DELETED',
] as const;
export type PlatformAuditAction = (typeof PLATFORM_AUDIT_ACTIONS)[number];

/**
 * Append-only platform audit trail. It is deliberately separate from the
 * organization-scoped audit_events table so history survives organization
 * suspension or soft deletion and is not cascaded away with tenant data.
 */
export interface PlatformAuditEventAttributes {
  id: string;
  actorUserId: string | null;
  targetOrganizationId: string | null;
  targetOrganizationName: string;
  action: PlatformAuditAction;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type PlatformAuditEventCreationAttributes = Optional<
  PlatformAuditEventAttributes,
  | 'id'
  | 'actorUserId'
  | 'targetOrganizationId'
  | 'metadata'
  | 'ipAddress'
  | 'userAgent'
  | 'createdAt'
  | 'updatedAt'
>;

export class PlatformAuditEvent
  extends Model<PlatformAuditEventAttributes, PlatformAuditEventCreationAttributes>
  implements PlatformAuditEventAttributes
{
  declare id: string;
  declare actorUserId: string | null;
  declare targetOrganizationId: string | null;
  declare targetOrganizationName: string;
  declare action: PlatformAuditAction;
  declare metadata: Record<string, unknown>;
  declare ipAddress: string | null;
  declare userAgent: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare actor?: User;
  declare targetOrganization?: Organization;
}

export function initPlatformAuditEvent(sequelize: Sequelize): typeof PlatformAuditEvent {
  PlatformAuditEvent.init(
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: () => generateUuid(),
      },
      actorUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'actor_user_id',
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      targetOrganizationId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'target_organization_id',
        references: { model: 'organizations', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      targetOrganizationName: {
        type: DataTypes.STRING(120),
        allowNull: false,
        field: 'target_organization_name',
      },
      action: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      metadata: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: {},
      },
      ipAddress: {
        type: DataTypes.STRING(64),
        allowNull: true,
        field: 'ip_address',
      },
      userAgent: {
        type: DataTypes.STRING(512),
        allowNull: true,
        field: 'user_agent',
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
      modelName: 'PlatformAuditEvent',
      tableName: 'platform_audit_events',
      underscored: true,
      timestamps: true,
      indexes: [
        {
          name: 'platform_audit_events_org_created_idx',
          fields: ['target_organization_id', 'created_at'],
        },
        { name: 'platform_audit_events_actor_created_idx', fields: ['actor_user_id', 'created_at'] },
        { name: 'platform_audit_events_action_created_idx', fields: ['action', 'created_at'] },
      ],
    },
  );

  return PlatformAuditEvent;
}
