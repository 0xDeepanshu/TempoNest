import { Op } from 'sequelize';
import { config } from '../../config/env';
import { logger } from '../../config/logger';
import {
  ActivityIdleInterval,
  ApplicationActivity,
  Organization,
  OrganizationTrackingSettings,
} from '../../database';
import { DEFAULT_TRACKING_SETTINGS, ACTIVITY_RETENTION_DAYS_MAX, ACTIVITY_RETENTION_DAYS_MIN } from './trackingSettings.model';

function retentionDays(value: number | null | undefined): number {
  if (value === null || value === undefined) return DEFAULT_TRACKING_SETTINGS.activityRetentionDays;
  return Math.min(ACTIVITY_RETENTION_DAYS_MAX, Math.max(ACTIVITY_RETENTION_DAYS_MIN, value));
}

/**
 * Purges detailed activity and idle intervals older than each organization's
 * configured retention window. Current classifications are policy, not event
 * data, so they are never deleted here. Only fully elapsed rows are removed so
 * a session that crosses the cutoff is preserved until it ends.
 */
export async function purgeActivityHistory(now = new Date()) {
  const [organizations, settingsRows] = await Promise.all([
    Organization.findAll({ attributes: ['id'] }),
    OrganizationTrackingSettings.findAll({ attributes: ['organizationId', 'activityRetentionDays'] }),
  ]);

  const configured = new Map(
    settingsRows.map((row) => [row.organizationId, row.activityRetentionDays]),
  );

  let activitiesDeleted = 0;
  let idleIntervalsDeleted = 0;

  for (const organization of organizations) {
    const days = retentionDays(configured.get(organization.id));
    const cutoff = new Date(now.getTime() - days * 86_400_000);

    activitiesDeleted += await ApplicationActivity.destroy({
      where: {
        organizationId: organization.id,
        endedAt: { [Op.lt]: cutoff },
      },
    });
    idleIntervalsDeleted += await ActivityIdleInterval.destroy({
      where: {
        organizationId: organization.id,
        endedAt: { [Op.lt]: cutoff },
      },
    });
  }

  return {
    organizationsProcessed: organizations.length,
    activitiesDeleted,
    idleIntervalsDeleted,
  };
}

/**
 * Runs the retention purge periodically. The interval is unref'd so this
 * housekeeping never keeps the process alive on its own.
 */
export function startActivityMaintenance(): () => void {
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    void purgeActivityHistory()
      .then((summary) => {
        if (summary.activitiesDeleted || summary.idleIntervalsDeleted) {
          logger.info({ summary }, 'activity retention purge completed');
        }
      })
      .catch((error) => logger.error({ err: error }, 'activity retention purge failed'))
      .finally(() => {
        running = false;
      });
  };

  run();
  const timer = setInterval(run, config.activity.retentionPurgeIntervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
