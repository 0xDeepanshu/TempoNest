import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import type { Organization } from '../organizations/organization.model';
import type { User } from '../users/user.model';

export const APPLICATION_PRODUCTIVITY_CATEGORIES = [
  'PRODUCTIVE',
  'NEUTRAL',
  'UNPRODUCTIVE',
  'UNCLASSIFIED',
] as const;
export type ApplicationProductivityCategory =
  (typeof APPLICATION_PRODUCTIVITY_CATEGORIES)[number];

/**
 * Current organization-scoped classification for one application identifier.
 * Reports join this catalog at query time, so changing a category changes how
 * historical (retained) activity is categorized without rewriting activity
 * rows. Every change is recorded in the audit trail.
 */
export interface ApplicationClassificationAttributes {
  id: string;
  organizationId: string;
  applicationIdentifier: string;
  applicationName: string;
  category: ApplicationProductivityCategory;
  classifiedByUserId: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ApplicationClassificationCreationAttributes = Optional<
  ApplicationClassificationAttributes,
  | 'id'
  | 'category'
  | 'classifiedByUserId'
  | 'notes'
  | 'createdAt'
  | 'updatedAt'
>;

export class ApplicationClassification
  extends Model<ApplicationClassificationAttributes, ApplicationClassificationCreationAttributes>
  implements ApplicationClassificationAttributes
{
  declare id: string;
  declare organizationId: string;
  declare applicationIdentifier: string;
  declare applicationName: string;
  declare category: ApplicationProductivityCategory;
  declare classifiedByUserId: string | null;
  declare notes: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare organization?: Organization;
  declare classifiedBy?: User;
}

export function initApplicationClassification(
  sequelize: Sequelize,
): typeof ApplicationClassification {
  ApplicationClassification.init(
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
      applicationIdentifier: {
        type: DataTypes.STRING(200),
        allowNull: false,
        field: 'application_identifier',
      },
      applicationName: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: 'application_name',
      },
      category: {
        type: DataTypes.ENUM(...APPLICATION_PRODUCTIVITY_CATEGORIES),
        allowNull: false,
        defaultValue: 'UNCLASSIFIED',
      },
      classifiedByUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'classified_by_user_id',
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
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
      modelName: 'ApplicationClassification',
      tableName: 'application_classifications',
      underscored: true,
      timestamps: true,
      indexes: [
        {
          name: 'application_classifications_org_identifier_unique',
          unique: true,
          fields: ['organization_id', 'application_identifier'],
        },
        {
          name: 'application_classifications_org_category_idx',
          fields: ['organization_id', 'category'],
        },
      ],
    },
  );

  return ApplicationClassification;
}
