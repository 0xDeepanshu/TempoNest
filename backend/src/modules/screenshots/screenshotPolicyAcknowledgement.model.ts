import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import type { Organization } from '../organizations/organization.model';
import type { User } from '../users/user.model';

/**
 * Durable acknowledgement of a specific disclosure version. Updating the
 * policy disclosure version invalidates earlier acknowledgements until the
 * employee acknowledges the new text.
 */
export interface ScreenshotPolicyAcknowledgementAttributes {
  id: string;
  organizationId: string;
  employeeId: string;
  policyVersion: string;
  acknowledgedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type ScreenshotPolicyAcknowledgementCreationAttributes = Optional<
  ScreenshotPolicyAcknowledgementAttributes,
  'id' | 'acknowledgedAt' | 'createdAt' | 'updatedAt'
>;

export class ScreenshotPolicyAcknowledgement
  extends Model<
    ScreenshotPolicyAcknowledgementAttributes,
    ScreenshotPolicyAcknowledgementCreationAttributes
  >
  implements ScreenshotPolicyAcknowledgementAttributes
{
  declare id: string;
  declare organizationId: string;
  declare employeeId: string;
  declare policyVersion: string;
  declare acknowledgedAt: Date;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare organization?: Organization;
  declare employee?: User;
}

export function initScreenshotPolicyAcknowledgement(
  sequelize: Sequelize,
): typeof ScreenshotPolicyAcknowledgement {
  ScreenshotPolicyAcknowledgement.init(
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
      employeeId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'employee_id',
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      policyVersion: {
        type: DataTypes.STRING(64),
        allowNull: false,
        field: 'policy_version',
      },
      acknowledgedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'acknowledged_at',
        defaultValue: () => new Date(),
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
      modelName: 'ScreenshotPolicyAcknowledgement',
      tableName: 'screenshot_policy_acknowledgements',
      underscored: true,
      timestamps: true,
      indexes: [
        {
          name: 'screenshot_ack_org_employee_version_unique',
          unique: true,
          fields: ['organization_id', 'employee_id', 'policy_version'],
        },
        {
          name: 'screenshot_ack_org_employee_idx',
          fields: ['organization_id', 'employee_id'],
        },
      ],
    },
  );

  return ScreenshotPolicyAcknowledgement;
}
