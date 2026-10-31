import type { Transaction } from 'sequelize';
import { OrganizationTrackingSettings, sequelize } from '../../database';
import { AppError } from '../../utils/errors';
import { hasPermission, type PermissionSubject } from '../memberships/permissions';
import { recordAuditEvent, type AuditContext } from '../screenshots/audit.service';
import { DEFAULT_TRACKING_SETTINGS, type OrganizationTrackingSettings as TrackingSettingsModel } from './trackingSettings.model';
import type { UpdateTrackingSettingsInput } from './trackingSettings.schemas';

export function toTrackingSettingsSummary(settings: TrackingSettingsModel) {
  return {
    organizationId: settings.organizationId,
    appTrackingEnabled: settings.appTrackingEnabled,
    idleDetectionEnabled: settings.idleDetectionEnabled,
    idleThresholdMinutes: settings.idleThresholdMinutes,
    productivityClassificationEnabled: settings.productivityClassificationEnabled,
    activityRetentionDays: settings.activityRetentionDays,
    policyVersion: settings.policyVersion,
    policyUpdatedAt: settings.policyUpdatedAt,
    updatedAt: settings.updatedAt,
  };
}

export async function getOrCreateTrackingSettings(
  organizationId: string,
  transaction?: Transaction,
): Promise<TrackingSettingsModel> {
  const [settings] = await OrganizationTrackingSettings.findOrCreate({
    where: { organizationId },
    defaults: {
      organizationId,
      ...DEFAULT_TRACKING_SETTINGS,
      policyVersion: 1,
      policyUpdatedAt: new Date(),
    },
    ...(transaction ? { transaction } : {}),
  });
  return settings;
}

export async function getTrackingSettingsView(organizationId: string) {
  const settings = await getOrCreateTrackingSettings(organizationId);
  return toTrackingSettingsSummary(settings);
}

/**
 * Returns the effective policy for an organization. Callers that gate writes
 * use this rather than trusting a client-provided policy snapshot.
 */
export async function loadTrackingSettings(organizationId: string) {
  return getOrCreateTrackingSettings(organizationId);
}

export async function updateTrackingSettings(options: {
  organizationId: string;
  actorUserId: string;
  actorRole: PermissionSubject;
  input: UpdateTrackingSettingsInput;
  context?: AuditContext;
}) {
  if (!hasPermission(options.actorRole, 'activity:policy')) {
    throw AppError.forbidden(
      'Your role cannot change desktop tracking settings',
      'PERMISSION_DENIED',
    );
  }

  return sequelize.transaction(async (transaction) => {
    const existing = await getOrCreateTrackingSettings(options.organizationId, transaction);
    const settings = await OrganizationTrackingSettings.findByPk(existing.id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!settings) {
      throw AppError.notFound('Tracking settings not found', 'TRACKING_SETTINGS_NOT_FOUND');
    }

    const changedFields = Object.keys(options.input).filter(
      (key) => options.input[key as keyof UpdateTrackingSettingsInput] !== undefined,
    );
    const policyUpdatedAt = new Date();
    await settings.update(
      {
        ...options.input,
        policyVersion: settings.policyVersion + 1,
        policyUpdatedAt,
      },
      { transaction },
    );

    await recordAuditEvent(
      {
        organizationId: options.organizationId,
        actorUserId: options.actorUserId,
        action: 'APP_TRACKING_POLICY_UPDATED',
        entityType: 'ORGANIZATION_TRACKING_SETTINGS',
        entityId: settings.id,
        metadata: {
          changedFields,
          appTrackingEnabled: settings.appTrackingEnabled,
          idleDetectionEnabled: settings.idleDetectionEnabled,
          idleThresholdMinutes: settings.idleThresholdMinutes,
          productivityClassificationEnabled: settings.productivityClassificationEnabled,
          activityRetentionDays: settings.activityRetentionDays,
          policyVersion: settings.policyVersion,
        },
      },
      { transaction, context: options.context },
    );

    return toTrackingSettingsSummary(settings);
  });
}
