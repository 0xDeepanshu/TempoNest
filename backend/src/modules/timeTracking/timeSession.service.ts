import { Op, Transaction, UniqueConstraintError } from 'sequelize';
import { sequelize, AgentSyncEvent, Break, DesktopAgent, TimeSession, User } from '../../database';
import { config } from '../../config/env';
import { AppError } from '../../utils/errors';
import { paginate } from '../../utils/pagination';
import { secondsBetween } from '../../utils/time';
import { serializeByKey } from '../../utils/serialize';
import { agentHub } from '../../realtime/agentHub';
import { touchAgent } from '../desktopAgents/desktopAgent.service';
import { toTimeSessionSummary } from './timeSession.mapper';
import type { Role } from '../memberships/roles';
import type { DesktopAgent as DesktopAgentModel } from '../desktopAgents/desktopAgent.model';
import type { OfflineEventInput, OfflineSyncInput, SessionListQuery } from './timeSession.schemas';
import type { TimeSession as TimeSessionModel } from './timeSession.model';
import type { AgentSyncEvent as AgentSyncEventModel } from './offlineEvent.model';

const sessionIncludes = [
  { model: Break, as: 'breaks', required: false },
  { model: DesktopAgent, as: 'desktopAgent', required: false },
  { model: User, as: 'employee', required: false, attributes: ['id', 'name', 'email'] },
];

export async function lockEmployee(
  transaction: Transaction,
  employeeId: string,
): Promise<void> {
  // Serializes start/stop/break transitions for one employee on PostgreSQL.
  // SQLite serializes writers at the database level.
  await User.findByPk(employeeId, {
    transaction,
    lock: Transaction.LOCK.UPDATE,
    attributes: ['id'],
  });
}

async function loadSession(sessionId: string): Promise<TimeSessionModel> {
  const session = await TimeSession.findByPk(sessionId, { include: sessionIncludes });
  if (!session) throw AppError.notFound('Time session not found', 'SESSION_NOT_FOUND');
  return session;
}

async function closeActiveBreak(
  transaction: Transaction,
  sessionId: string,
  end: Date,
  allowZeroLength = false,
): Promise<void> {
  const brk = await Break.findOne({
    where: { timeSessionId: sessionId, endedAt: null },
    transaction,
    lock: Transaction.LOCK.UPDATE,
  });
  if (!brk) return;
  if (brk.startedAt.getTime() > end.getTime()) {
    throw AppError.conflict('Break start is after the requested end time', 'INVALID_BREAK_INTERVAL');
  }
  if (brk.startedAt.getTime() === end.getTime() && !allowZeroLength) {
    throw AppError.conflict('Break start is at the requested end time', 'INVALID_BREAK_INTERVAL');
  }
  await brk.update({ endedAt: end, status: 'ENDED' }, { transaction });
}

function publishSession(session: TimeSessionModel): void {
  agentHub.publishToAgent(session.desktopAgentId ?? '', {
    type: 'session.updated',
    serverTime: new Date().toISOString(),
    session: toTimeSessionSummary(session),
  });
}

/** Lets attendance check-in publish the same realtime update after commit. */
export function publishSessionUpdate(session: TimeSessionModel): void {
  publishSession(session);
}

/**
 * Core online-session creation. Callers must hold the per-employee serialization
 * key; the transaction must also hold (or request) the employee row lock so
 * attendance check-in can attach evidence atomically with the session.
 */
export async function startSessionInTransaction(options: {
  transaction: Transaction;
  organizationId: string;
  employeeId: string;
  agent: DesktopAgentModel;
  employeeLocked?: boolean;
}): Promise<{ session: TimeSessionModel; autoClosedSessionId: string | null }> {
  const { transaction, organizationId, employeeId, agent } = options;
  const now = new Date();
  let autoClosedSessionId: string | null = null;

  if (!options.employeeLocked) {
    await lockEmployee(transaction, employeeId);
  }

  const active = await TimeSession.findOne({
    where: { employeeId, endedAt: null },
    transaction,
    lock: Transaction.LOCK.UPDATE,
  });

  if (active) {
    const heartbeatAge = now.getTime() - active.lastHeartbeatAt.getTime();
    if (heartbeatAge <= config.timeTracking.sessionStaleSeconds * 1000) {
      throw AppError.conflict(
        'An active time session already exists. Stop it before starting a new one.',
        'ACTIVE_SESSION_EXISTS',
      );
    }

    // Recover from a device that vanished without stopping. The session is
    // closed at its last known heartbeat, never at the new start time.
    const cutoff = new Date(
      Math.max(active.startedAt.getTime(), active.lastHeartbeatAt.getTime()),
    );
    await closeActiveBreak(transaction, active.id, cutoff, true);
    await active.update(
      { endedAt: cutoff, status: 'STOPPED', lastHeartbeatAt: cutoff },
      { transaction },
    );
    autoClosedSessionId = active.id;
  }

  const agentActive = await TimeSession.findOne({
    where: { desktopAgentId: agent.id, endedAt: null },
    transaction,
    lock: Transaction.LOCK.UPDATE,
  });
  if (agentActive) {
    throw AppError.conflict(
      'This desktop agent already has an active session.',
      'AGENT_SESSION_EXISTS',
    );
  }

  const session = await TimeSession.create(
    {
      organizationId,
      employeeId,
      desktopAgentId: agent.id,
      startedAt: now,
      endedAt: null,
      status: 'ACTIVE',
      source: 'ONLINE',
      lastHeartbeatAt: now,
    },
    { transaction },
  );

  return { session, autoClosedSessionId };
}

export async function startSession(options: {
  organizationId: string;
  employeeId: string;
  agent: DesktopAgentModel;
}): Promise<{ session: TimeSessionModel; autoClosedSessionId: string | null }> {
  const { organizationId, employeeId, agent } = options;

  try {
    const result = await serializeByKey(`employee:${employeeId}`, () =>
      sequelize.transaction((transaction) =>
        startSessionInTransaction({
          transaction,
          organizationId,
          employeeId,
          agent,
        }),
      ),
    );

    const full = await loadSession(result.session.id);
    publishSession(full);
    return { session: full, autoClosedSessionId: result.autoClosedSessionId };
  } catch (error) {
    if (error instanceof UniqueConstraintError) {
      throw AppError.conflict(
        'An active time session already exists. Stop it before starting a new one.',
        'ACTIVE_SESSION_EXISTS',
      );
    }
    throw error;
  }
}

export async function stopSession(options: {
  organizationId: string;
  employeeId: string;
  agent: DesktopAgentModel;
  sessionId: string;
}): Promise<TimeSessionModel> {
  const { organizationId, employeeId, agent, sessionId } = options;

  const session = await serializeByKey(`employee:${employeeId}`, () => {
    const now = new Date();
    return sequelize.transaction(async (transaction) => {
      await lockEmployee(transaction, employeeId);
      const existing = await TimeSession.findOne({
        where: {
          id: sessionId,
          organizationId,
          employeeId,
          desktopAgentId: agent.id,
        },
        transaction,
        lock: Transaction.LOCK.UPDATE,
      });

      if (!existing) throw AppError.notFound('Time session not found', 'SESSION_NOT_FOUND');
      if (existing.endedAt || existing.status === 'STOPPED') {
        throw AppError.conflict('This time session is already stopped', 'SESSION_NOT_ACTIVE');
      }
      if (now.getTime() <= existing.startedAt.getTime()) {
        throw AppError.conflict('Session end must be after its start', 'INVALID_SESSION_INTERVAL');
      }

      await closeActiveBreak(transaction, existing.id, now);
      await existing.update(
        { endedAt: now, status: 'STOPPED', lastHeartbeatAt: now },
        { transaction },
      );
      return existing;
    });
  });

  const full = await loadSession(session.id);
  publishSession(full);
  return full;
}

export async function startBreak(options: {
  organizationId: string;
  employeeId: string;
  agent: DesktopAgentModel;
  sessionId: string;
}): Promise<{ session: TimeSessionModel; breakId: string }> {
  const { organizationId, employeeId, agent, sessionId } = options;

  const result = await serializeByKey(`employee:${employeeId}`, () => {
    const now = new Date();
    return sequelize.transaction(async (transaction) => {
      await lockEmployee(transaction, employeeId);
      const session = await TimeSession.findOne({
        where: {
          id: sessionId,
          organizationId,
          employeeId,
          desktopAgentId: agent.id,
        },
        transaction,
        lock: Transaction.LOCK.UPDATE,
      });

      if (!session) throw AppError.notFound('Time session not found', 'SESSION_NOT_FOUND');
      if (session.endedAt || session.status === 'STOPPED') {
        throw AppError.conflict('Cannot start a break on a stopped session', 'SESSION_NOT_ACTIVE');
      }
      if (session.status === 'ON_BREAK') {
        throw AppError.conflict('A break is already active', 'BREAK_ALREADY_ACTIVE');
      }

      const openBreak = await Break.findOne({
        where: { timeSessionId: session.id, endedAt: null },
        transaction,
        lock: Transaction.LOCK.UPDATE,
      });
      if (openBreak) {
        throw AppError.conflict('A break is already active', 'BREAK_ALREADY_ACTIVE');
      }

      const brk = await Break.create(
        {
          organizationId,
          timeSessionId: session.id,
          startedAt: now,
          endedAt: null,
          status: 'ACTIVE',
        },
        { transaction },
      );
      await session.update({ status: 'ON_BREAK', lastHeartbeatAt: now }, { transaction });
      return { session, breakId: brk.id };
    });
  });

  const full = await loadSession(result.session.id);
  publishSession(full);
  return { session: full, breakId: result.breakId };
}

export async function endBreak(options: {
  organizationId: string;
  employeeId: string;
  agent: DesktopAgentModel;
  sessionId: string;
}): Promise<{ session: TimeSessionModel; breakId: string }> {
  const { organizationId, employeeId, agent, sessionId } = options;

  const result = await serializeByKey(`employee:${employeeId}`, () => {
    const now = new Date();
    return sequelize.transaction(async (transaction) => {
      await lockEmployee(transaction, employeeId);
      const session = await TimeSession.findOne({
        where: {
          id: sessionId,
          organizationId,
          employeeId,
          desktopAgentId: agent.id,
        },
        transaction,
        lock: Transaction.LOCK.UPDATE,
      });

      if (!session) throw AppError.notFound('Time session not found', 'SESSION_NOT_FOUND');
      if (session.endedAt || session.status === 'STOPPED') {
        throw AppError.conflict('Cannot end a break on a stopped session', 'SESSION_NOT_ACTIVE');
      }
      if (session.status !== 'ON_BREAK') {
        throw AppError.conflict('There is no active break to end', 'NO_ACTIVE_BREAK');
      }

      const brk = await Break.findOne({
        where: { timeSessionId: session.id, endedAt: null },
        transaction,
        lock: Transaction.LOCK.UPDATE,
      });
      if (!brk) {
        throw AppError.conflict('There is no active break to end', 'NO_ACTIVE_BREAK');
      }
      if (now.getTime() < brk.startedAt.getTime()) {
        throw AppError.conflict('Break end must be after its start', 'INVALID_BREAK_INTERVAL');
      }

      await brk.update({ endedAt: now, status: 'ENDED' }, { transaction });
      await session.update({ status: 'ACTIVE', lastHeartbeatAt: now }, { transaction });
      return { session, breakId: brk.id };
    });
  });

  const full = await loadSession(result.session.id);
  publishSession(full);
  return { session: full, breakId: result.breakId };
}

export async function heartbeat(options: {
  organizationId: string;
  employeeId: string;
  agent: DesktopAgentModel;
  sessionId: string;
}): Promise<TimeSessionModel> {
  const { organizationId, employeeId, agent, sessionId } = options;
  const now = new Date();

  const session = await TimeSession.findOne({
    where: {
      id: sessionId,
      organizationId,
      employeeId,
      desktopAgentId: agent.id,
    },
    include: sessionIncludes,
  });

  if (!session) throw AppError.notFound('Time session not found', 'SESSION_NOT_FOUND');
  if (session.endedAt || session.status === 'STOPPED') {
    throw AppError.conflict('This time session is stopped', 'SESSION_NOT_ACTIVE');
  }

  await session.update({ lastHeartbeatAt: now });
  await touchAgent(agent, now);
  return session;
}

export async function getCurrentSession(
  organizationId: string,
  employeeId: string,
): Promise<TimeSessionModel | null> {
  return TimeSession.findOne({
    where: { organizationId, employeeId, endedAt: null },
    include: sessionIncludes,
  });
}

export async function getSessionForActor(options: {
  organizationId: string;
  sessionId: string;
  actorUserId: string;
  actorRole: Role;
}): Promise<TimeSessionModel> {
  const { organizationId, sessionId, actorUserId, actorRole } = options;
  const where: Record<string, unknown> = { id: sessionId, organizationId };
  if (actorRole === 'EMPLOYEE') where.employeeId = actorUserId;

  const session = await TimeSession.findOne({ where, include: sessionIncludes });
  if (!session) throw AppError.notFound('Time session not found', 'SESSION_NOT_FOUND');
  return session;
}

export async function listSessions(options: {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  query: SessionListQuery;
}) {
  const { organizationId, actorUserId, actorRole, query } = options;
  const where: Record<string, unknown> = { organizationId };

  if (actorRole === 'EMPLOYEE') {
    where.employeeId = actorUserId;
  } else if (query.employeeId) {
    where.employeeId = query.employeeId;
  }
  if (query.status) where.status = query.status;
  if (query.to) {
    where.startedAt = { [Op.lte]: new Date(query.to) };
  }
  if (query.from) {
    (where as Record<string | symbol, unknown>)[Op.or] = [
      { endedAt: null },
      { endedAt: { [Op.gte]: new Date(query.from) } },
    ];
  }

  const result = await TimeSession.findAndCountAll({
    where,
    include: sessionIncludes,
    order: [
      ['startedAt', 'DESC'],
      ['id', 'ASC'],
    ],
    limit: query.limit,
    offset: (query.page - 1) * query.limit,
    distinct: true,
  });

  return paginate(
    result.rows.map((session) => toTimeSessionSummary(session)),
    result.count,
    query.page,
    query.limit,
  );
}

type OfflineResult = {
  eventId: string;
  type: OfflineEventInput['type'];
  status: 'applied' | 'duplicate' | 'conflict';
  code?: string;
  message?: string;
  originalStatus?: 'APPLIED' | 'CONFLICT';
  result?: Record<string, unknown>;
};

function storedResult(record: AgentSyncEventModel, duplicate: boolean): OfflineResult {
  return {
    eventId: record.eventId,
    type: record.eventType,
    status: duplicate ? 'duplicate' : record.status.toLowerCase() === 'applied' ? 'applied' : 'conflict',
    ...(duplicate ? { originalStatus: record.status } : {}),
    ...(record.conflictCode ? { code: record.conflictCode } : {}),
    ...(record.message ? { message: record.message } : {}),
    result: record.result,
  };
}

async function recordOfflineConflict(options: {
  organizationId: string;
  employeeId: string;
  agentId: string;
  event: OfflineEventInput;
  occurredAt: Date;
  code: string;
  message: string;
}): Promise<AgentSyncEventModel> {
  const { organizationId, employeeId, agentId, event, occurredAt, code, message } = options;
  try {
    return await serializeByKey(`employee:${employeeId}`, () =>
      AgentSyncEvent.create({
        organizationId,
        employeeId,
        desktopAgentId: agentId,
        eventId: event.eventId,
        eventType: event.type,
        occurredAt,
        status: 'CONFLICT',
        conflictCode: code,
        message: message.slice(0, 500),
        result: {},
      }),
    );
  } catch (error) {
    if (error instanceof UniqueConstraintError) {
      const existing = await AgentSyncEvent.findOne({
        where: { desktopAgentId: agentId, eventId: event.eventId },
      });
      if (existing) return existing;
    }
    throw error;
  }
}

async function applyOfflineEvent(options: {
  organizationId: string;
  employeeId: string;
  agent: DesktopAgentModel;
  event: OfflineEventInput;
  occurredAt: Date;
}): Promise<{ record: AgentSyncEventModel; duplicate: boolean; sessionId?: string }> {
  const { organizationId, employeeId, agent, event, occurredAt } = options;

  try {
    return await serializeByKey(`employee:${employeeId}`, () =>
      sequelize.transaction(async (transaction) => {
        await lockEmployee(transaction, employeeId);

      const existing = await AgentSyncEvent.findOne({
        where: { desktopAgentId: agent.id, eventId: event.eventId },
        transaction,
        lock: Transaction.LOCK.UPDATE,
      });
      if (existing) return { record: existing, duplicate: true };

      let result: Record<string, unknown> = {};

      if (event.type === 'SESSION_START') {
        const idCollision = await TimeSession.findByPk(event.sessionId, { transaction });
        if (idCollision) {
          throw AppError.conflict('sessionId is already in use', 'SESSION_ID_EXISTS');
        }

        const active = await TimeSession.findOne({
          where: { employeeId, endedAt: null },
          transaction,
          lock: Transaction.LOCK.UPDATE,
        });
        if (active) {
          throw AppError.conflict(
            'An active session already exists for this employee',
            'ACTIVE_SESSION_EXISTS',
          );
        }

        const agentActive = await TimeSession.findOne({
          where: { desktopAgentId: agent.id, endedAt: null },
          transaction,
          lock: Transaction.LOCK.UPDATE,
        });
        if (agentActive) {
          throw AppError.conflict('This agent already has an active session', 'AGENT_SESSION_EXISTS');
        }

        const session = await TimeSession.create(
          {
            id: event.sessionId,
            organizationId,
            employeeId,
            desktopAgentId: agent.id,
            startedAt: occurredAt,
            endedAt: null,
            status: 'ACTIVE',
            source: 'OFFLINE',
            lastHeartbeatAt: occurredAt,
          },
          { transaction },
        );
        result = {
          sessionId: session.id,
          startedAt: session.startedAt,
          status: session.status,
        };
      } else {
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

        if (event.type === 'SESSION_STOP') {
          if (session.endedAt || session.status === 'STOPPED') {
            throw AppError.conflict('Session is already stopped', 'SESSION_ALREADY_STOPPED');
          }
          if (occurredAt.getTime() <= session.startedAt.getTime()) {
            throw AppError.conflict('Session stop precedes its start', 'INVALID_SESSION_INTERVAL');
          }

          await closeActiveBreak(transaction, session.id, occurredAt);
          await session.update(
            { endedAt: occurredAt, status: 'STOPPED', lastHeartbeatAt: occurredAt },
            { transaction },
          );
          result = {
            sessionId: session.id,
            endedAt: session.endedAt,
            status: session.status,
          };
        } else if (event.type === 'BREAK_START') {
          if (session.endedAt || session.status === 'STOPPED') {
            throw AppError.conflict('Session is already stopped', 'SESSION_ALREADY_STOPPED');
          }
          if (occurredAt.getTime() < session.startedAt.getTime()) {
            throw AppError.conflict('Break starts before the session', 'INVALID_BREAK_INTERVAL');
          }
          if (session.status === 'ON_BREAK') {
            throw AppError.conflict('A break is already active', 'BREAK_ALREADY_ACTIVE');
          }
          const openBreak = await Break.findOne({
            where: { timeSessionId: session.id, endedAt: null },
            transaction,
            lock: Transaction.LOCK.UPDATE,
          });
          if (openBreak) {
            throw AppError.conflict('A break is already active', 'BREAK_ALREADY_ACTIVE');
          }

          const brk = await Break.create(
            {
              organizationId,
              timeSessionId: session.id,
              startedAt: occurredAt,
              endedAt: null,
              status: 'ACTIVE',
            },
            { transaction },
          );
          await session.update(
            { status: 'ON_BREAK', lastHeartbeatAt: occurredAt },
            { transaction },
          );
          result = {
            sessionId: session.id,
            breakId: brk.id,
            startedAt: brk.startedAt,
            status: 'ON_BREAK',
          };
        } else {
          // BREAK_END
          if (session.endedAt || session.status === 'STOPPED') {
            throw AppError.conflict('Session is already stopped', 'SESSION_ALREADY_STOPPED');
          }
          if (session.status !== 'ON_BREAK') {
            throw AppError.conflict('There is no active break', 'NO_ACTIVE_BREAK');
          }
          const brk = await Break.findOne({
            where: { timeSessionId: session.id, endedAt: null },
            transaction,
            lock: Transaction.LOCK.UPDATE,
          });
          if (!brk) throw AppError.conflict('There is no active break', 'NO_ACTIVE_BREAK');
          if (occurredAt.getTime() < brk.startedAt.getTime()) {
            throw AppError.conflict('Break end precedes its start', 'INVALID_BREAK_INTERVAL');
          }

          await brk.update({ endedAt: occurredAt, status: 'ENDED' }, { transaction });
          await session.update(
            { status: 'ACTIVE', lastHeartbeatAt: occurredAt },
            { transaction },
          );
          result = {
            sessionId: session.id,
            breakId: brk.id,
            endedAt: brk.endedAt,
            status: 'ACTIVE',
          };
        }
      }

      const record = await AgentSyncEvent.create(
        {
          organizationId,
          employeeId,
          desktopAgentId: agent.id,
          eventId: event.eventId,
          eventType: event.type,
          occurredAt,
          status: 'APPLIED',
          conflictCode: null,
          message: null,
          result,
        },
        { transaction },
      );

      return {
        record,
        duplicate: false,
        sessionId: typeof result.sessionId === 'string' ? result.sessionId : undefined,
      };
      }),
    );
  } catch (error) {
    if (error instanceof AppError) {
      const record = await recordOfflineConflict({
        organizationId,
        employeeId,
        agentId: agent.id,
        event,
        occurredAt,
        code: error.code,
        message: error.message,
      });
      return { record, duplicate: false };
    }
    if (error instanceof UniqueConstraintError && error.fields?.['event_id']) {
      const existing = await AgentSyncEvent.findOne({
        where: { desktopAgentId: agent.id, eventId: event.eventId },
      });
      if (existing) return { record: existing, duplicate: true };
    }
    throw error;
  }
}

export async function syncOfflineEvents(options: {
  organizationId: string;
  employeeId: string;
  agent: DesktopAgentModel;
  input: OfflineSyncInput;
}): Promise<{
  deviceId: string;
  serverTime: string;
  results: OfflineResult[];
}> {
  const { organizationId, employeeId, agent, input } = options;
  const now = new Date();

  if (input.deviceId !== agent.deviceIdentifier) {
    throw AppError.forbidden('Device identity does not match the authenticated agent', 'DEVICE_MISMATCH');
  }

  const indexed = input.events.map((event, index) => ({
    event,
    index,
    occurredAt: new Date(event.occurredAt),
  }));
  indexed.sort((a, b) => {
    const diff = a.occurredAt.getTime() - b.occurredAt.getTime();
    return diff !== 0 ? diff : a.index - b.index;
  });

  const results: OfflineResult[] = new Array(input.events.length);
  const touchedSessions = new Set<string>();

  for (const item of indexed) {
    const { event, occurredAt, index } = item;

    const existing = await AgentSyncEvent.findOne({
      where: { desktopAgentId: agent.id, eventId: event.eventId },
    });
    if (existing) {
      results[index] = storedResult(existing, true);
      continue;
    }

    if (occurredAt.getTime() > now.getTime() + config.timeTracking.offlineFutureSkewSeconds * 1000) {
      const record = await recordOfflineConflict({
        organizationId,
        employeeId,
        agentId: agent.id,
        event,
        occurredAt,
        code: 'EVENT_IN_FUTURE',
        message: 'Event timestamp is too far in the future',
      });
      results[index] = storedResult(record, false);
      continue;
    }

    if (occurredAt.getTime() < now.getTime() - config.timeTracking.offlineMaxBackfillSeconds * 1000) {
      const record = await recordOfflineConflict({
        organizationId,
        employeeId,
        agentId: agent.id,
        event,
        occurredAt,
        code: 'EVENT_TOO_OLD',
        message: 'Event is older than the allowed offline backfill window',
      });
      results[index] = storedResult(record, false);
      continue;
    }

    const applied = await applyOfflineEvent({
      organizationId,
      employeeId,
      agent,
      event,
      occurredAt,
    });

    if (applied.sessionId) touchedSessions.add(applied.sessionId);
    results[index] = storedResult(applied.record, applied.duplicate);
  }

  await touchAgent(agent, now);

  for (const sessionId of touchedSessions) {
    const session = await TimeSession.findByPk(sessionId, { include: sessionIncludes });
    if (session) publishSession(session);
  }

  return {
    deviceId: agent.deviceIdentifier,
    serverTime: now.toISOString(),
    results,
  };
}

/**
 * Used by reporting and tests to verify that the online and offline paths
 * compute durations from stored timestamps rather than client input.
 */
export function durationForSession(session: TimeSessionModel, now = new Date()): number {
  return secondsBetween(session.startedAt, session.endedAt ?? now);
}
