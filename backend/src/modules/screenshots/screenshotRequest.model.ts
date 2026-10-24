import { DataTypes, Model, Op, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import type { Organization } from '../organizations/organization.model';
import type { User } from '../users/user.model';
import type { DesktopAgent } from '../desktopAgents/desktopAgent.model';
import type { TimeSession } from '../timeTracking/timeSession.model';
import type { Screenshot } from './screenshot.model';

export const SCREENSHOT_REQUEST_STATUSES = [
  'PENDING',
  'CLAIMED',
  'COMPLETED',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
] as const;
export type ScreenshotRequestStatus = (typeof SCREENSHOT_REQUEST_STATUSES)[number];

export const ACTIVE_SCREENSHOT_REQUEST_STATUSES: ScreenshotRequestStatus[] = ['PENDING', 'CLAIMED'];

export interface ScreenshotRequestAttributes {
  id: string;
  organizationId: string;
  employeeId: string;
  requestingAdminId: string | null;
  desktopAgentId: string | null;
  timeSessionId: string | null;
  status: ScreenshotRequestStatus;
  requestedAt: Date;
  expiresAt: Date;
  acknowledgedAt: Date | null;
  claimedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  failureCode: string | null;
  failureMessage: string | null;
  idempotencyKey: string | null;
  expectedContentType: string | null;
  storageKey: string | null;
  uploadTokenHash: string | null;
  uploadExpiresAt: Date | null;
  uploadedAt: Date | null;
  uploadedSize: number | null;
  uploadedContentType: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ScreenshotRequestCreationAttributes = Optional<
  ScreenshotRequestAttributes,
  | 'id'
  | 'requestingAdminId'
  | 'desktopAgentId'
  | 'timeSessionId'
  | 'status'
  | 'acknowledgedAt'
  | 'claimedAt'
  | 'completedAt'
  | 'cancelledAt'
  | 'failureCode'
  | 'failureMessage'
  | 'idempotencyKey'
  | 'expectedContentType'
  | 'storageKey'
  | 'uploadTokenHash'
  | 'uploadExpiresAt'
  | 'uploadedAt'
  | 'uploadedSize'
  | 'uploadedContentType'
  | 'createdAt'
  | 'updatedAt'
>;

export class ScreenshotRequest
  extends Model<ScreenshotRequestAttributes, ScreenshotRequestCreationAttributes>
  implements ScreenshotRequestAttributes
{
  declare id: string;
  declare organizationId: string;
  declare employeeId: string;
  declare requestingAdminId: string | null;
  declare desktopAgentId: string | null;
  declare timeSessionId: string | null;
  declare status: ScreenshotRequestStatus;
  declare requestedAt: Date;
  declare expiresAt: Date;
  declare acknowledgedAt: Date | null;
  declare claimedAt: Date | null;
  declare completedAt: Date | null;
  declare cancelledAt: Date | null;
  declare failureCode: string | null;
  declare failureMessage: string | null;
  declare idempotencyKey: string | null;
  declare expectedContentType: string | null;
  declare storageKey: string | null;
  declare uploadTokenHash: string | null;
  declare uploadExpiresAt: Date | null;
  declare uploadedAt: Date | null;
  declare uploadedSize: number | null;
  declare uploadedContentType: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare organization?: Organization;
  declare employee?: User;
  declare requestingAdmin?: User;
  declare desktopAgent?: DesktopAgent;
  declare timeSession?: TimeSession;
  declare screenshot?: Screenshot;
}

export function initScreenshotRequest(sequelize: Sequelize): typeof ScreenshotRequest {
  ScreenshotRequest.init(
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
      requestingAdminId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'requesting_admin_id',
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      desktopAgentId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'desktop_agent_id',
        references: { model: 'desktop_agents', key: 'id' },
        onDelete: 'SET NULL',
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
      status: {
        type: DataTypes.ENUM(...SCREENSHOT_REQUEST_STATUSES),
        allowNull: false,
        defaultValue: 'PENDING',
      },
      requestedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'requested_at',
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'expires_at',
      },
      acknowledgedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'acknowledged_at',
      },
      claimedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'claimed_at',
      },
      completedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'completed_at',
      },
      cancelledAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'cancelled_at',
      },
      failureCode: {
        type: DataTypes.STRING(64),
        allowNull: true,
        field: 'failure_code',
      },
      failureMessage: {
        type: DataTypes.STRING(500),
        allowNull: true,
        field: 'failure_message',
      },
      idempotencyKey: {
        type: DataTypes.STRING(160),
        allowNull: true,
        field: 'idempotency_key',
      },
      expectedContentType: {
        type: DataTypes.STRING(64),
        allowNull: true,
        field: 'expected_content_type',
      },
      storageKey: {
        type: DataTypes.STRING(512),
        allowNull: true,
        field: 'storage_key',
      },
      uploadTokenHash: {
        type: DataTypes.STRING(64),
        allowNull: true,
        field: 'upload_token_hash',
      },
      uploadExpiresAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'upload_expires_at',
      },
      uploadedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'uploaded_at',
      },
      uploadedSize: {
        // Screenshot files are capped well below the 32-bit INTEGER range.
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'uploaded_size',
      },
      uploadedContentType: {
        type: DataTypes.STRING(64),
        allowNull: true,
        field: 'uploaded_content_type',
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
      modelName: 'ScreenshotRequest',
      tableName: 'screenshot_requests',
      underscored: true,
      timestamps: true,
      indexes: [
        {
          name: 'screenshot_requests_active_employee_unique',
          unique: true,
          fields: ['organization_id', 'employee_id'],
          where: { status: { [Op.in]: ACTIVE_SCREENSHOT_REQUEST_STATUSES } } as never,
        },
        {
          name: 'screenshot_requests_idempotency_unique',
          unique: true,
          fields: ['organization_id', 'requesting_admin_id', 'idempotency_key'],
        },
        {
          name: 'screenshot_requests_upload_token_unique',
          unique: true,
          fields: ['upload_token_hash'],
        },
        {
          name: 'screenshot_requests_storage_key_unique',
          unique: true,
          fields: ['storage_key'],
        },
        {
          name: 'screenshot_requests_org_employee_requested_idx',
          fields: ['organization_id', 'employee_id', 'requested_at'],
        },
        {
          name: 'screenshot_requests_org_status_expires_idx',
          fields: ['organization_id', 'status', 'expires_at'],
        },
        {
          name: 'screenshot_requests_agent_status_idx',
          fields: ['desktop_agent_id', 'status'],
        },
      ],
    },
  );

  return ScreenshotRequest;
}
