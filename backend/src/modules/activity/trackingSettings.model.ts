import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import type { Organization } from '../organizations/organization.model';

export const IDLE_THRESHOLD_MINUTES_MIN = 1;
export const IDLE_THRESHOLD_MINUTES_MAX = 120;
export const ACTIVITY_RETENTION_DAYS_MIN = 7;
export const ACTIVITY_RETENTION_DAYS_MAX = 3650;

export const DEFAULT_TRACKING_SETTINGS = {
  appTrackingEnabled: true,
  idleDetectionEnabled: true,
  idleThresholdMinutes: 5,
  productivityClassificationEnabled: true,
  activityRetentionDays: 90,
} as const;

/**
 * Organization-level desktop tracking policy. The row is created lazily; the
 * defaults above apply when no row exists yet. `policyVersion` increments on
 * every accepted update so agents and reports can detect policy changes.
 */
export interface OrganizationTrackingSettingsAttributes {
  id: string;
  organizationId: string;
  appTrackingEnabled: boolean;
  idleDetectionEnabled: boolean;
  idleThresholdMinutes: number;
  productivityClassificationEnabled: boolean;
  activityRetentionDays: number;
  policyVersion: number;
  policyUpdatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type OrganizationTrackingSettingsCreationAttributes = Optional<
  OrganizationTrackingSettingsAttributes,
  | 'id'
  | 'appTrackingEnabled'
  | 'idleDetectionEnabled'
  | 'idleThresholdMinutes'
  | 'productivityClassificationEnabled'
  | 'activityRetentionDays'
  | 'policyVersion'
  | 'policyUpdatedAt'
  | 'createdAt'
  | 'updatedAt'
>;

export class OrganizationTrackingSettings
  extends Model<
    OrganizationTrackingSettingsAttributes,
    OrganizationTrackingSettingsCreationAttributes
  >
  implements OrganizationTrackingSettingsAttributes
{
  declare id: string;
  declare organizationId: string;
  declare appTrackingEnabled: boolean;
  declare idleDetectionEnabled: boolean;
  declare idleThresholdMinutes: number;
  declare productivityClassificationEnabled: boolean;
  declare activityRetentionDays: number;
  declare policyVersion: number;
  declare policyUpdatedAt: Date;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare organization?: Organization;
}

export function initOrganizationTrackingSettings(
  sequelize: Sequelize,
): typeof OrganizationTrackingSettings {
  OrganizationTrackingSettings.init(
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
      appTrackingEnabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        field: 'app_tracking_enabled',
        defaultValue: DEFAULT_TRACKING_SETTINGS.appTrackingEnabled,
      },
      idleDetectionEnabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        field: 'idle_detection_enabled',
        defaultValue: DEFAULT_TRACKING_SETTINGS.idleDetectionEnabled,
      },
      idleThresholdMinutes: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'idle_threshold_minutes',
        defaultValue: DEFAULT_TRACKING_SETTINGS.idleThresholdMinutes,
      },
      productivityClassificationEnabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        field: 'productivity_classification_enabled',
        defaultValue: DEFAULT_TRACKING_SETTINGS.productivityClassificationEnabled,
      },
      activityRetentionDays: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'activity_retention_days',
        defaultValue: DEFAULT_TRACKING_SETTINGS.activityRetentionDays,
      },
      policyVersion: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'policy_version',
        defaultValue: 1,
      },
      policyUpdatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'policy_updated_at',
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
      modelName: 'OrganizationTrackingSettings',
      tableName: 'organization_tracking_settings',
      underscored: true,
      timestamps: true,
      indexes: [
        {
          name: 'organization_tracking_settings_org_unique',
          unique: true,
          fields: ['organization_id'],
        },
      ],
    },
  );

  return OrganizationTrackingSettings;
}
