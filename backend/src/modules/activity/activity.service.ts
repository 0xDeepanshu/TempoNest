import { Op, Transaction, UniqueConstraintError } from 'sequelize';
import { sequelize, ApplicationActivity, TimeSession, User } from '../../database';
import { config } from '../../config/env';
import { AppError } from '../../utils/errors';
import { secondsBetween } from '../../utils/time';
import { serializeByKey } from '../../utils/serialize';
import { touchAgent } from '../desktopAgents/desktopAgent.service';
import type { DesktopAgent as DesktopAgentModel } from '../desktopAgents/desktopAgent.model';
import type { ActivityBatchInput, ActivityEventInput } from './activity.schemas';

export type ActivityIngestionResult = {
  idempotencyKey: string;
  status: 'accepted' | 'duplicate' | 'rejected';
  activityId?: string;
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

function reject(
  event: ActivityEventInput,
  code: string,
  message: string,
): ActivityIngestionResult {
  return { idempotencyKey: event.idempotencyKey, status: 'rejected', code, message };
}

async function ingestOne(options: {
  organizationId: string;
  employeeId: string;
  agent: DesktopAgentModel;
  event: ActivityEventInput;
  now: Date;
}): Promise<ActivityIngestionResult> {
  const { organizationId, employeeId, agent, event, now } = options;
  const startedAt = new Date(event.startedAt);
  const endedAt = new Date(event.endedAt);

  const existing = await ApplicationActivity.findOne({
    where: { desktopAgentId: agent.id, idempotencyKey: event.idempotencyKey },
  });
  if (existing) {
    return {
      idempotencyKey: event.idempotencyKey,
      status: 'duplicate',
      activityId: existing.id,
    };
  }

  if (endedAt.getTime() > now.getTime() + config.timeTracking.activityFutureSkewSeconds * 1000) {
    return reject(event, 'EVENT_IN_FUTURE', 'Activity end is too far in the future');
  }
  if (startedAt.getTime() < now.getTime() - config.timeTracking.activityMaxBackfillSeconds * 1000) {
    return reject(event, 'EVENT_TOO_OLD', 'Activity is older than the allowed backfill window');
  }

  try {
    const created = await serializeByKey(`employee:${employeeId}`, () =>
      sequelize.transaction(async (transaction) => {
        await lockEmployee(transaction, employeeId);

      const duplicate = await ApplicationActivity.findOne({
        where: { desktopAgentId: agent.id, idempotencyKey: event.idempotencyKey },
        transaction,
        lock: Transaction.LOCK.UPDATE,
      });
      if (duplicate) return { duplicate, activity: null };

      const session = await TimeSession.findOne({
        where: {
          id: event.sessionId,
          organizationId,
          employeeId,
          desktopAgentId: agent.id,
        },
        transaction,
        lock: Transaction.LOCK.UPDATE,
      });
      if (!session) {
        throw AppError.conflict('Unknown session for this agent', 'SESSION_NOT_FOUND');
      }

      const sessionEnd = session.endedAt ?? now;
      const skewMs = config.timeTracking.activityFutureSkewSeconds * 1000;
      if (startedAt.getTime() < session.startedAt.getTime() - skewMs) {
        throw AppError.conflict('Activity starts before the session', 'EVENT_OUTSIDE_SESSION');
      }
      if (endedAt.getTime() > sessionEnd.getTime() + skewMs) {
        throw AppError.conflict('Activity ends after the session', 'EVENT_OUTSIDE_SESSION');
      }

      const overlap = await ApplicationActivity.findOne({
        where: {
          employeeId,
          startedAt: { [Op.lt]: endedAt },
          endedAt: { [Op.gt]: startedAt },
        },
        transaction,
        lock: Transaction.LOCK.UPDATE,
      });
      if (overlap) {
        throw AppError.conflict(
          'Activity interval overlaps an existing foreground application event',
          'EVENT_OVERLAP',
        );
      }

      const activity = await ApplicationActivity.create(
        {
          organizationId,
          employeeId,
          timeSessionId: session.id,
          desktopAgentId: agent.id,
          applicationIdentifier: event.applicationIdentifier,
          applicationName: event.applicationName,
          startedAt,
          endedAt,
          durationSeconds: secondsBetween(startedAt, endedAt),
          idempotencyKey: event.idempotencyKey,
        },
        { transaction },
      );
      return { activity, duplicate: null };
      }),
    );

    if (created.duplicate) {
      return {
        idempotencyKey: event.idempotencyKey,
        status: 'duplicate',
        activityId: created.duplicate.id,
      };
    }

    return {
      idempotencyKey: event.idempotencyKey,
      status: 'accepted',
      activityId: created.activity!.id,
    };
  } catch (error) {
    if (error instanceof AppError) {
      return reject(event, error.code, error.message);
    }
    if (error instanceof UniqueConstraintError) {
      const duplicate = await ApplicationActivity.findOne({
        where: { desktopAgentId: agent.id, idempotencyKey: event.idempotencyKey },
      });
      if (duplicate) {
        return {
          idempotencyKey: event.idempotencyKey,
          status: 'duplicate',
          activityId: duplicate.id,
        };
      }
    }
    throw error;
  }
}

/**
 * Batch ingestion is intentionally per-event: a rejected or duplicate event
 * does not discard the rest of an offline batch. Employee/org are derived from
 * the authenticated agent; clients cannot submit identity fields.
 */
export async function ingestActivityBatch(options: {
  organizationId: string;
  employeeId: string;
  agent: DesktopAgentModel;
  input: ActivityBatchInput;
}): Promise<{
  received: number;
  accepted: number;
  duplicated: number;
  rejected: number;
  results: ActivityIngestionResult[];
  disclaimer: string;
}> {
  const { organizationId, employeeId, agent, input } = options;
  const now = new Date();
  const results: ActivityIngestionResult[] = [];

  for (const event of input.events) {
    results.push(await ingestOne({ organizationId, employeeId, agent, event, now }));
  }

  await touchAgent(agent, now);

  return {
    received: input.events.length,
    accepted: results.filter((result) => result.status === 'accepted').length,
    duplicated: results.filter((result) => result.status === 'duplicate').length,
    rejected: results.filter((result) => result.status === 'rejected').length,
    results,
    disclaimer:
      'Application usage is foreground metadata only. It is not a definitive measure or proof of productivity.',
  };
}
