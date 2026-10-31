import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import type { Organization } from '../organizations/organization.model';
import type { User } from '../users/user.model';

export const HOLIDAY_CATEGORIES = [
  'PUBLIC',
  'COMPANY',
  'OPTIONAL',
  'NATIONAL',
  'STATE',
  'GAZETTED',
  'RESTRICTED',
] as const;
export type HolidayCategory = (typeof HOLIDAY_CATEGORIES)[number];

/** Categories an administrator may pick when adding a holiday by hand. */
export const MANUAL_HOLIDAY_CATEGORIES = ['PUBLIC', 'COMPANY', 'OPTIONAL'] as const;

/** Categories that are only meaningful for government-imported holidays. */
export const GOVERNMENT_HOLIDAY_CATEGORIES = [
  'NATIONAL',
  'STATE',
  'GAZETTED',
  'RESTRICTED',
] as const;
export type GovernmentHolidayCategory = (typeof GOVERNMENT_HOLIDAY_CATEGORIES)[number];

export const HOLIDAY_SOURCES = ['MANUAL', 'GOVERNMENT'] as const;
export type HolidaySource = (typeof HOLIDAY_SOURCES)[number];

export const HOLIDAY_DURATIONS = ['FULL_DAY', 'FIRST_HALF', 'SECOND_HALF'] as const;
export type HolidayDuration = (typeof HOLIDAY_DURATIONS)[number];

export const HOLIDAY_APPLICABILITIES = ['ORGANIZATION', 'EMPLOYEES'] as const;
export type HolidayApplicability = (typeof HOLIDAY_APPLICABILITIES)[number];

export interface LeaveHolidayAttributes {
  id: string;
  organizationId: string;
  holidayDate: string;
  name: string;
  category: HolidayCategory;
  duration: HolidayDuration;
  description: string | null;
  appliesToAll: boolean;
  applicableEmployeeIds: string[];
  /** Reserved for organizations that later enable department applicability. */
  departmentIds: string[];
  /** Reserved for organizations that later enable location applicability. */
  locationIds: string[];
  createdByUserId: string | null;
  updatedByUserId: string | null;
  /**
   * Published government holidays participate in leave charging and attendance
   * classification. Imported drafts stay unpublished until an admin publishes
   * them; manual holidays default to published to preserve existing behaviour.
   */
  published: boolean;
  source: HolidaySource;
  sourceId: string | null;
  sourceYear: number | null;
  sourceName: string | null;
  sourceUrl: string | null;
  sourceReference: string | null;
  jurisdictionCountry: string | null;
  jurisdictionRegion: string | null;
  importedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type LeaveHolidayCreationAttributes = Optional<
  LeaveHolidayAttributes,
  | 'id'
  | 'category'
  | 'duration'
  | 'description'
  | 'appliesToAll'
  | 'applicableEmployeeIds'
  | 'departmentIds'
  | 'locationIds'
  | 'createdByUserId'
  | 'updatedByUserId'
  | 'published'
  | 'source'
  | 'sourceId'
  | 'sourceYear'
  | 'sourceName'
  | 'sourceUrl'
  | 'sourceReference'
  | 'jurisdictionCountry'
  | 'jurisdictionRegion'
  | 'importedAt'
  | 'createdAt'
  | 'updatedAt'
>;

/**
 * Organization holiday calendar used when charging working days and when
 * classifying attendance. Existing rows are org-wide full-day holidays; the
 * additive fields support categories, half-days, and employee applicability.
 */
export class LeaveHoliday
  extends Model<LeaveHolidayAttributes, LeaveHolidayCreationAttributes>
  implements LeaveHolidayAttributes
{
  declare id: string;
  declare organizationId: string;
  declare holidayDate: string;
  declare name: string;
  declare category: HolidayCategory;
  declare duration: HolidayDuration;
  declare description: string | null;
  declare appliesToAll: boolean;
  declare applicableEmployeeIds: string[];
  declare departmentIds: string[];
  declare locationIds: string[];
  declare createdByUserId: string | null;
  declare updatedByUserId: string | null;
  declare published: boolean;
  declare source: HolidaySource;
  declare sourceId: string | null;
  declare sourceYear: number | null;
  declare sourceName: string | null;
  declare sourceUrl: string | null;
  declare sourceReference: string | null;
  declare jurisdictionCountry: string | null;
  declare jurisdictionRegion: string | null;
  declare importedAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare organization?: Organization;
  declare createdBy?: User;
  declare updatedBy?: User;
}

export function initLeaveHoliday(sequelize: Sequelize): typeof LeaveHoliday {
  LeaveHoliday.init(
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
      holidayDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        field: 'holiday_date',
      },
      name: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      category: {
        type: DataTypes.STRING(24),
        allowNull: false,
        defaultValue: 'COMPANY',
      },
      duration: {
        type: DataTypes.STRING(16),
        allowNull: false,
        defaultValue: 'FULL_DAY',
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      appliesToAll: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        field: 'applies_to_all',
        defaultValue: true,
      },
      applicableEmployeeIds: {
        type: DataTypes.JSON,
        allowNull: false,
        field: 'applicable_employee_ids',
        defaultValue: [],
      },
      departmentIds: {
        type: DataTypes.JSON,
        allowNull: false,
        field: 'department_ids',
        defaultValue: [],
      },
      locationIds: {
        type: DataTypes.JSON,
        allowNull: false,
        field: 'location_ids',
        defaultValue: [],
      },
      createdByUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'created_by_user_id',
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      updatedByUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'updated_by_user_id',
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      published: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      source: {
        type: DataTypes.STRING(24),
        allowNull: false,
        defaultValue: 'MANUAL',
      },
      sourceId: {
        type: DataTypes.STRING(120),
        allowNull: true,
        field: 'source_id',
      },
      sourceYear: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'source_year',
      },
      sourceName: {
        type: DataTypes.STRING(200),
        allowNull: true,
        field: 'source_name',
      },
      sourceUrl: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: 'source_url',
      },
      sourceReference: {
        type: DataTypes.STRING(240),
        allowNull: true,
        field: 'source_reference',
      },
      jurisdictionCountry: {
        type: DataTypes.STRING(8),
        allowNull: true,
        field: 'jurisdiction_country',
      },
      jurisdictionRegion: {
        type: DataTypes.STRING(40),
        allowNull: true,
        field: 'jurisdiction_region',
      },
      importedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'imported_at',
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
      modelName: 'LeaveHoliday',
      tableName: 'leave_holidays',
      underscored: true,
      timestamps: true,
      indexes: [
        { name: 'leave_holidays_organization_date_idx', fields: ['organization_id', 'holiday_date'] },
        {
          name: 'leave_holidays_organization_category_idx',
          fields: ['organization_id', 'category'],
        },
        {
          name: 'leave_holidays_organization_applies_idx',
          fields: ['organization_id', 'applies_to_all'],
        },
        {
          name: 'leave_holidays_organization_source_unique',
          unique: true,
          fields: ['organization_id', 'source_id'],
        },
        {
          name: 'leave_holidays_organization_published_idx',
          fields: ['organization_id', 'published'],
        },
      ],
    },
  );

  return LeaveHoliday;
}
