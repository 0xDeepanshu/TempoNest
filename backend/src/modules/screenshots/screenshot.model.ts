import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import type { Organization } from '../organizations/organization.model';
import type { User } from '../users/user.model';
import type { TimeSession } from '../timeTracking/timeSession.model';
import type { ScreenshotRequest } from './screenshotRequest.model';

/**
 * Private screenshot metadata. The binary lives only in object storage under
 * `storageKey`; it is never stored in PostgreSQL and the key is never returned
 * by the API.
 */
export interface ScreenshotAttributes {
  id: string;
  organizationId: string;
  employeeId: string;
  timeSessionId: string | null;
  screenshotRequestId: string;
  requestingAdminId: string | null;
  capturedAt: Date;
  storageKey: string;
  contentType: string;
  fileSizeBytes: number;
  retentionExpiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type ScreenshotCreationAttributes = Optional<
  ScreenshotAttributes,
  | 'id'
  | 'timeSessionId'
  | 'requestingAdminId'
  | 'capturedAt'
  | 'createdAt'
  | 'updatedAt'
>;

export class Screenshot
  extends Model<ScreenshotAttributes, ScreenshotCreationAttributes>
  implements ScreenshotAttributes
{
  declare id: string;
  declare organizationId: string;
  declare employeeId: string;
  declare timeSessionId: string | null;
  declare screenshotRequestId: string;
  declare requestingAdminId: string | null;
  declare capturedAt: Date;
  declare storageKey: string;
  declare contentType: string;
  declare fileSizeBytes: number;
  declare retentionExpiresAt: Date;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare organization?: Organization;
  declare employee?: User;
  declare requestingAdmin?: User;
  declare timeSession?: TimeSession;
  declare request?: ScreenshotRequest;
}

export function initScreenshot(sequelize: Sequelize): typeof Screenshot {
  Screenshot.init(
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
      timeSessionId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'time_session_id',
        references: { model: 'time_sessions', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      screenshotRequestId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'screenshot_request_id',
        references: { model: 'screenshot_requests', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      requestingAdminId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'requesting_admin_id',
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      capturedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'captured_at',
      },
      storageKey: {
        type: DataTypes.STRING(512),
        allowNull: false,
        field: 'storage_key',
      },
      contentType: {
        type: DataTypes.STRING(64),
        allowNull: false,
        field: 'content_type',
      },
      fileSizeBytes: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'file_size_bytes',
      },
      retentionExpiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'retention_expires_at',
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
      modelName: 'Screenshot',
      tableName: 'screenshots',
      underscored: true,
      timestamps: true,
      indexes: [
        {
          name: 'screenshots_request_unique',
          unique: true,
          fields: ['screenshot_request_id'],
        },
        {
          name: 'screenshots_storage_key_unique',
          unique: true,
          fields: ['storage_key'],
        },
        {
          name: 'screenshots_org_employee_captured_idx',
          fields: ['organization_id', 'employee_id', 'captured_at'],
        },
        {
          name: 'screenshots_org_retention_idx',
          fields: ['organization_id', 'retention_expires_at'],
        },
        {
          name: 'screenshots_retention_idx',
          fields: ['retention_expires_at'],
        },
      ],
    },
  );

  return Screenshot;
}
