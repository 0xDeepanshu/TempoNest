import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import type { Organization } from '../organizations/organization.model';
import type { Role } from '../memberships/roles';

export const DEFAULT_SCREENSHOT_REQUEST_ROLES: Role[] = ['OWNER', 'ADMIN'];
export const DEFAULT_SCREENSHOT_VIEW_ROLES: Role[] = ['OWNER', 'ADMIN'];

/**
 * Organization-level monitoring disclosure and limits. Screenshots are
 * disabled by default: an organization must explicitly enable them and publish
 * a disclosure before any request can be created.
 */
export interface ScreenshotPolicyAttributes {
  id: string;
  organizationId: string;
  enabled: boolean;
  requestRoles: Role[];
  viewRoles: Role[];
  requestCooldownSeconds: number;
  retentionDays: number;
  auditRetentionDays: number;
  employeeAcknowledgementRequired: boolean;
  disclosureVersion: string;
  disclosureText: string;
  createdAt: Date;
  updatedAt: Date;
}

export type ScreenshotPolicyCreationAttributes = Optional<
  ScreenshotPolicyAttributes,
  | 'id'
  | 'enabled'
  | 'requestRoles'
  | 'viewRoles'
  | 'requestCooldownSeconds'
  | 'retentionDays'
  | 'auditRetentionDays'
  | 'employeeAcknowledgementRequired'
  | 'disclosureVersion'
  | 'disclosureText'
  | 'createdAt'
  | 'updatedAt'
>;

export class ScreenshotPolicy
  extends Model<ScreenshotPolicyAttributes, ScreenshotPolicyCreationAttributes>
  implements ScreenshotPolicyAttributes
{
  declare id: string;
  declare organizationId: string;
  declare enabled: boolean;
  declare requestRoles: Role[];
  declare viewRoles: Role[];
  declare requestCooldownSeconds: number;
  declare retentionDays: number;
  declare auditRetentionDays: number;
  declare employeeAcknowledgementRequired: boolean;
  declare disclosureVersion: string;
  declare disclosureText: string;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare organization?: Organization;
}

export const DEFAULT_SCREENSHOT_DISCLOSURE_TEXT =
  'Authorized administrators may request individual screenshots of your desktop while a work ' +
  'session is active. Screenshots are captured by your TempoNest desktop agent in the ' +
  'background, stored privately, and retained only for the period described by your organization.';

export function initScreenshotPolicy(sequelize: Sequelize): typeof ScreenshotPolicy {
  ScreenshotPolicy.init(
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
      enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      requestRoles: {
        type: DataTypes.JSON,
        allowNull: false,
        field: 'request_roles',
        defaultValue: DEFAULT_SCREENSHOT_REQUEST_ROLES,
      },
      viewRoles: {
        type: DataTypes.JSON,
        allowNull: false,
        field: 'view_roles',
        defaultValue: DEFAULT_SCREENSHOT_VIEW_ROLES,
      },
      requestCooldownSeconds: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'request_cooldown_seconds',
        defaultValue: 5,
      },
      retentionDays: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'retention_days',
        defaultValue: 30,
      },
      auditRetentionDays: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'audit_retention_days',
        defaultValue: 365,
      },
      employeeAcknowledgementRequired: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        field: 'employee_acknowledgement_required',
        defaultValue: false,
      },
      disclosureVersion: {
        type: DataTypes.STRING(64),
        allowNull: false,
        field: 'disclosure_version',
        defaultValue: 'v1',
      },
      disclosureText: {
        type: DataTypes.TEXT,
        allowNull: false,
        field: 'disclosure_text',
        defaultValue: DEFAULT_SCREENSHOT_DISCLOSURE_TEXT,
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
      modelName: 'ScreenshotPolicy',
      tableName: 'screenshot_policies',
      underscored: true,
      timestamps: true,
      indexes: [
        { name: 'screenshot_policies_org_unique', unique: true, fields: ['organization_id'] },
      ],
    },
  );

  return ScreenshotPolicy;
}
