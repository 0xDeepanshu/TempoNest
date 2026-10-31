import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import type { Organization } from '../organizations/organization.model';
import type { User } from '../users/user.model';
import { DEFAULT_WORKING_DAYS } from './leavePolicy.model';

export interface OrganizationHolidaySettingsAttributes {
  id: string;
  organizationId: string;
  enabled: boolean;
  optionalHolidaysEnabled: boolean;
  allowHalfDayHolidays: boolean;
  defaultCalendarYear: number | null;
  defaultApplicability: 'ORGANIZATION' | 'EMPLOYEES';
  workingDays: number[];
  governmentCountry: string;
  governmentRegion: string | null;
  governmentYear: number | null;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type OrganizationHolidaySettingsCreationAttributes = Optional<
  OrganizationHolidaySettingsAttributes,
  | 'id'
  | 'enabled'
  | 'optionalHolidaysEnabled'
  | 'allowHalfDayHolidays'
  | 'defaultCalendarYear'
  | 'defaultApplicability'
  | 'workingDays'
  | 'governmentCountry'
  | 'governmentRegion'
  | 'governmentYear'
  | 'updatedByUserId'
  | 'createdAt'
  | 'updatedAt'
>;

/**
 * Organization-level holiday configuration. Weekly working days are exposed
 * here for calendar and attendance classification; leave charging continues to
 * use each leave policy's own workingDays so existing policies are unchanged.
 */
export class OrganizationHolidaySettings
  extends Model<
    OrganizationHolidaySettingsAttributes,
    OrganizationHolidaySettingsCreationAttributes
  >
  implements OrganizationHolidaySettingsAttributes
{
  declare id: string;
  declare organizationId: string;
  declare enabled: boolean;
  declare optionalHolidaysEnabled: boolean;
  declare allowHalfDayHolidays: boolean;
  declare defaultCalendarYear: number | null;
  declare defaultApplicability: 'ORGANIZATION' | 'EMPLOYEES';
  declare workingDays: number[];
  declare governmentCountry: string;
  declare governmentRegion: string | null;
  declare governmentYear: number | null;
  declare updatedByUserId: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare organization?: Organization;
  declare updatedBy?: User;
}

export function initOrganizationHolidaySettings(
  sequelize: Sequelize,
): typeof OrganizationHolidaySettings {
  OrganizationHolidaySettings.init(
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
        unique: true,
        field: 'organization_id',
        references: { model: 'organizations', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      optionalHolidaysEnabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        field: 'optional_holidays_enabled',
        defaultValue: true,
      },
      allowHalfDayHolidays: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        field: 'allow_half_day_holidays',
        defaultValue: true,
      },
      defaultCalendarYear: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'default_calendar_year',
      },
      defaultApplicability: {
        type: DataTypes.STRING(24),
        allowNull: false,
        field: 'default_applicability',
        defaultValue: 'ORGANIZATION',
      },
      workingDays: {
        type: DataTypes.JSON,
        allowNull: false,
        field: 'working_days',
        defaultValue: [...DEFAULT_WORKING_DAYS],
      },
      governmentCountry: {
        type: DataTypes.STRING(8),
        allowNull: false,
        field: 'government_country',
        defaultValue: 'IN',
      },
      governmentRegion: {
        type: DataTypes.STRING(40),
        allowNull: true,
        field: 'government_region',
      },
      governmentYear: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'government_year',
      },
      updatedByUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'updated_by_user_id',
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
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
      modelName: 'OrganizationHolidaySettings',
      tableName: 'organization_holiday_settings',
      underscored: true,
      timestamps: true,
      indexes: [
        {
          name: 'organization_holiday_settings_org_unique',
          unique: true,
          fields: ['organization_id'],
        },
      ],
    },
  );

  return OrganizationHolidaySettings;
}
