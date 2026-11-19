import { Op } from 'sequelize';
import { EmployeeMonitoringPolicy, Membership } from '../../database';
import { logger } from '../../config/logger';
import { SCHEDULED_CAPTURE_IDEMPOTENCY_PREFIX } from './employeeMonitoringPolicy.model';
import { createScreenshotRequest } from './screenshot.service';

/** Shortest retry after a transient capture failure (offline, no session…). */
const TRANSIENT_RETRY_MINUTES = 5;
const DUE_BATCH_SIZE = 50;

/**
 * Claims and runs due per-employee captures.
 *
 * Only policies with both the general monitoring switch and the dedicated
 * scheduled-capture switch enabled are eligible. The organization-wide policy
 * and the employee's active membership are enforced by
 * `createScreenshotRequest`, so a disabled employee or organization is deferred
 * rather than captured.
 *
 * The due slot is advanced with a conditional UPDATE before any request is
 * created. That makes a slot claim atomic across processes: only one worker
 * wins, and a restarted server never replays a backlog because the next slot is
 * always computed from "now", not from the missed due time.
 */
export async function runDueScheduledCaptures(now = new Date()): Promise<{
  captured: number;
  deferred: number;
}> {
  const due = await EmployeeMonitoringPolicy.findAll({
    where: {
      scheduledCaptureEnabled: true,
      enabled: true,
      nextCaptureAt: { [Op.ne]: null, [Op.lte]: now },
    },
    attributes: [
      'id',
      'organizationId',
      'employeeId',
      'captureIntervalMinutes',
      'nextCaptureAt',
    ],
    order: [['nextCaptureAt', 'ASC']],
    limit: DUE_BATCH_SIZE,
  });

  let captured = 0;
  let deferred = 0;

  for (const policy of due) {
    const intervalMinutes = policy.captureIntervalMinutes || 30;
    const dueAt = policy.nextCaptureAt;
    const nextCaptureAt = new Date(now.getTime() + intervalMinutes * 60_000);

    const [claimed] = await EmployeeMonitoringPolicy.update(
      { nextCaptureAt },
      {
        where: {
          id: policy.id,
          scheduledCaptureEnabled: true,
          enabled: true,
          nextCaptureAt: { [Op.ne]: null, [Op.lte]: now },
        },
      },
    );
    if (claimed !== 1) continue;

    const membership = await Membership.findOne({
      where: {
        organizationId: policy.organizationId,
        userId: policy.employeeId,
        status: 'ACTIVE',
      },
      attributes: ['role'],
    });

    if (!membership) {
      // Suspended or removed employees stay scheduled but cannot be captured.
      deferred += 1;
      continue;
    }

    try {
      const slotKey = (dueAt ?? now).toISOString();
      await createScreenshotRequest({
        organizationId: policy.organizationId,
        employeeId: policy.employeeId,
        actorUserId: policy.employeeId,
        actorRole: membership.role,
        scheduled: true,
        idempotencyKey: `${SCHEDULED_CAPTURE_IDEMPOTENCY_PREFIX}${policy.id}:${slotKey}`,
      });
      captured += 1;
    } catch (error) {
      deferred += 1;
      // Retry sooner than the normal cadence when the employee was offline or
      // between sessions, but never create a burst of missed captures.
      const retryAt = new Date(
        now.getTime() + Math.min(intervalMinutes, TRANSIENT_RETRY_MINUTES) * 60_000,
      );
      await EmployeeMonitoringPolicy.update(
        { nextCaptureAt: retryAt },
        {
          where: {
            id: policy.id,
            scheduledCaptureEnabled: true,
            enabled: true,
            nextCaptureAt,
          },
        },
      ).catch(() => undefined);

      logger.debug(
        {
          err: error,
          organizationId: policy.organizationId,
          employeeId: policy.employeeId,
          retryAt: retryAt.toISOString(),
        },
        'scheduled screenshot capture deferred',
      );
    }
  }

  return { captured, deferred };
}
