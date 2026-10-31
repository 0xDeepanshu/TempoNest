import { Transaction, UniqueConstraintError } from 'sequelize';
import { sequelize, ActivityIdleInterval, TimeSession, User } from '../../database';
import { config } from '../../config/env';
import { AppError } from '../../utils/errors';
import { secondsBetween } from '../../utils/time';
import { serializeByKey } from '../../utils/serialize';
import { touchAgent } from '../desktopAgents/desktopAgent.service';
import type { DesktopAgent as DesktopAgentModel } from '../desktopAgents/desktopAgent.model';
import type { IdleIntervalBatchInput, IdleIntervalInput } from './idleInterval.schemas';
import type { OrganizationTrackingSettings } from './trackingSettings.model';

export type IdleIngestionResult = {
  idempotencyKey: string;
  status: 'accepted' | 'duplicate' | 'rejected';
  idleIntervalId?: string;
  code?: string;
  message?: string;
};

async function lockEmployee(transaction: Transaction, employeeId: string): Promise<void> {
  await User.findByPk(employeeId, {
    transaction,
    lock: Transaction.LOCK.UPDATE,
    attributes: ['id'],
  });
}

function reject(interval: IdleIntervalInput, code: string, message: string): IdleIngestionResult {
  return { idempotencyKey: interval.idempotencyKey, status: 'rejected', code, message };
}

async function resolveSession(options: {
  organizationId: string;
  employeeId: string;
  agent: DesktopAgentModel;
  sessionId?: string;
  transaction: Transaction;
}) {
  const { organizationId, employeeId, agent, sessionId, transaction } = options;
  return TimeSession.findOne({
    where: {
      ...(sessionId ? { id: sessionId } : { endedAt: null }),
      organizationId,
      employeeId,
      desktopAgentId: agent.id,
    },
    order: sessionId ? undefined : [['startedAt', 'DESC']],
    transaction,
    lock: Transaction.LOCK.UPDATE,
  });
}

async function ingestOne(options: {
  organizationId: string;
  employeeId: string;
  agent: DesktopAgentModel;
  interval: IdleIntervalInput;
  thresholdSeconds: number;
  now: Date;
}): Promise<IdleIngestionResult> {
  const { organizationId, employeeId, agent, interval, thresholdSeconds, now } = options;
  const startedAt = new Date(interval.startedAt);
  const endedAt = new Date(interval.endedAt);

  const existing = await ActivityIdleInterval.findOne({
    where: { desktopAgentId: agent.id, idempotencyKey: interval.idempotencyKey },
  });
  if (existing) {
    return {
      idempotencyKey: interval.idempotencyKey,
      status: 'duplicate',
      idleIntervalId: existing.id,
    };
  }

  if (endedAt.getTime() > now.getTime() + config.timeTracking.activityFutureSkewSeconds * 1000) {
    return reject(interval, 'EVENT_IN_FUTURE', 'Idle interval ends too far in the future');
  }
  if (startedAt.getTime() < now.getTime() - config.timeTracking.activityMaxBackfillSeconds * 1000) {
    return reject(interval, 'EVENT_TOO_OLD', 'Idle interval is older than the allowed backfill window');
  }

  const durationSeconds = secondsBetween(startedAt, endedAt);
  if (durationSeconds < thresholdSeconds) {
    return reject(
      interval,
      'IDLE_BELOW_THRESHOLD',
      `Idle interval is shorter than the organization threshold (${thresholdSeconds} seconds)`,
    );
  }

  try {
    const created = await serializeByKey(`employee:${employeeId}`, () =>
      sequelize.transaction(async (transaction) => {
        await lockEmployee(transaction, employeeId);

        const duplicate = await ActivityIdleInterval.findOne({
          where: { desktopAgentId: agent.id, idempotencyKey: interval.idempotencyKey },
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        if (duplicate) return { duplicate, interval: null };

        const session = await resolveSession({
          organizationId,
          employeeId,
          agent,
          sessionId: interval.sessionId,
          transaction,
        });
        if (!session) {
          throw AppError.conflict('Unknown session for this agent', 'SESSION_NOT_FOUND');
        }

        const skewMs = config.timeTracking.activityFutureSkewSeconds * 1000;
        const sessionEnd = session.endedAt ?? now;
        if (startedAt.getTime() < session.startedAt.getTime() - skewMs) {
          throw AppError.conflict('Idle interval starts before the session', 'EVENT_OUTSIDE_SESSION');
        }
        if (endedAt.getTime() > sessionEnd.getTime() + skewMs) {
          throw AppError.conflict('Idle interval ends after the session', 'EVENT_OUTSIDE_SESSION');
        }

        const record = await ActivityIdleInterval.create(
          {
            organizationId,
            employeeId,
            timeSessionId: session.id,
            desktopAgentId: agent.id,
            idempotencyKey: interval.idempotencyKey,
            startedAt,
            endedAt,
            durationSeconds,
            thresholdSeconds,
            platform: interval.platform ?? agent.platform ?? null,
          },
          { transaction },
        );
        return { duplicate: null, interval: record };
      }),
    );

    if (created.duplicate) {
      return {
        idempotencyKey: interval.idempotencyKey,
        status: 'duplicate',
        idleIntervalId: created.duplicate.id,
      };
    }

    return {
      idempotencyKey: interval.idempotencyKey,
      status: 'accepted',
      idleIntervalId: created.interval!.id,
    };
  } catch (error) {
    if (error instanceof AppError) {
      return reject(interval, error.code, error.message);
    }
    if (error instanceof UniqueConstraintError) {
      const duplicate = await ActivityIdleInterval.findOne({
        where: { desktopAgentId: agent.id, idempotencyKey: interval.idempotencyKey },
      });
      if (duplicate) {
        return {
          idempotencyKey: interval.idempotencyKey,
          status: 'duplicate',
          idleIntervalId: duplicate.id,
        };
      }
    }
    throw error;
  }
}

/**
 * Idle intervals are accepted independently of app tracking. Overlapping idle
 * intervals are reconciled (merged) at report time, so retries after sleep,
 * resume, or an agent restart cannot inflate idle totals.
 */
export async function ingestIdleIntervalBatch(options: {
  organizationId: string;
  employeeId: string;
  agent: DesktopAgentModel;
  settings: OrganizationTrackingSettings;
  input: IdleIntervalBatchInput;
}): Promise<{
  received: number;
  accepted: number;
  duplicated: number;
  rejected: number;
  results: IdleIngestionResult[];
  thresholdSeconds: number;
  disclaimer: string;
}> {
  const { organizationId, employeeId, agent, settings, input } = options;

  if (!settings.idleDetectionEnabled) {
    throw AppError.forbidden(
      'Idle detection is disabled by this organization',
      'IDLE_DETECTION_DISABLED',
    );
  }

  const thresholdSeconds = settings.idleThresholdMinutes * 60;
  const now = new Date();
  const results: IdleIngestionResult[] = [];

  for (const interval of input.intervals) {
    results.push(
      await ingestOne({
        organizationId,
        employeeId,
        agent,
        interval,
        thresholdSeconds,
        now,
      }),
    );
  }

  await touchAgent(agent, now);

  return {
    received: input.intervals.length,
    accepted: results.filter((result) => result.status === 'accepted').length,
    duplicated: results.filter((result) => result.status === 'duplicate').length,
    rejected: results.filter((result) => result.status === 'rejected').length,
    results,
    thresholdSeconds,
    disclaimer:
      'Idle detection uses operating-system inactivity signals only. No keystrokes, pointer content, window titles, clipboard data, or screenshots are collected.',
  };
}
