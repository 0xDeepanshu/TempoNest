import { Op, Transaction } from 'sequelize';
import type { NextFunction, Request, Response } from 'express';
import {
  sequelize,
  AttendanceCheckIn,
  AttendanceLocationSample,
  AttendanceLocationTracking,
  Break,
  TimeSession,
  User,
} from '../../database';
import { config } from '../../config/env';
import { AppError } from '../../utils/errors';
import { serializeByKey } from '../../utils/serialize';
import { touchAgent } from '../desktopAgents/desktopAgent.service';
import {
  hasPermission,
  isSelfScoped,
  type PermissionSubject,
} from '../memberships/permissions';
import { recordAuditEvent, type AuditContext } from '../screenshots/audit.service';
import {
  getCurrentSession,
} from '../timeTracking/timeSession.service';
import { toTimeSessionSummary } from '../timeTracking/timeSession.mapper';
import { isLocationPauseReason } from './attendanceLocationTracking.model';
import type { Role } from '../memberships/roles';
import type { DesktopAgent as DesktopAgentModel } from '../desktopAgents/desktopAgent.model';
import type { Organization as OrganizationModel } from '../organizations/organization.model';
import type { AttendanceCheckIn as AttendanceCheckInModel } from './attendanceCheckIn.model';
import type { AttendanceLocationSample as AttendanceLocationSampleModel } from './attendanceLocationSample.model';
import type { AttendanceLocationTracking as AttendanceLocationTrackingModel } from './attendanceLocationTracking.model';
import type { Break as BreakModel } from '../timeTracking/break.model';
import type { TimeSession as TimeSessionModel } from '../timeTracking/timeSession.model';
import type {
  AttendanceLocationHistoryQuery,
  AttendanceLocationSampleInput,
  AttendanceLocationSamplesInput,
  AttendanceLocationStatusInput,
} from './attendance.schemas';

export type AttendanceLocationState =
  | 'ACTIVE'
  | 'PAUSED'
  | 'STOPPED'
  | 'PERMISSION_UNAVAILABLE'
  | 'STALE';

type SampleResultStatus = 'ACCEPTED' | 'DUPLICATE' | 'REJECTED';

type SampleResult = {
  clientSampleId: string;
  status: SampleResultStatus;
  code?: string;
};

type TrackingSummary = {
  status: 'ACTIVE' | 'PAUSED' | 'STOPPED';
  reason: string | null;
  permission: 'ALWAYS' | 'FOREGROUND_ONLY' | 'DENIED' | 'UNKNOWN';
  backgroundAllowed: boolean;
  lastSampleAt: Date | null;
  lastReportedAt: Date;
  updatedAt: Date;
};

const locationSessionIncludes = [{ model: Break, as: 'breaks', required: false }];

const historyCheckInIncludes = [
  { model: User, as: 'employee', required: false, attributes: ['id', 'name', 'email'] },
  {
    model: TimeSession,
    as: 'timeSession',
    required: true,
    include: [{ model: Break, as: 'breaks', required: false }],
  },
];

export function toLocationTrackingSummary(
  tracking: AttendanceLocationTrackingModel,
): TrackingSummary {
  return {
    status: tracking.status,
    reason: tracking.reason,
    permission: tracking.permission,
    backgroundAllowed: tracking.backgroundAllowed,
    lastSampleAt: tracking.lastSampleAt,
    lastReportedAt: tracking.lastReportedAt,
    updatedAt: tracking.updatedAt,
  };
}

function toLocationSampleSummary(sample: AttendanceLocationSampleModel) {
  return {
    id: sample.id,
    latitude: Number(sample.latitude),
    longitude: Number(sample.longitude),
    accuracyMeters: Number(sample.accuracyMeters),
    capturedAt: sample.capturedAt,
    receivedAt: sample.receivedAt,
    source: sample.source,
  };
}

/**
 * Derives the displayed tracking state from server records. Samples and
 * reports are the only evidence of liveness; the server never assumes that a
 * device is tracking merely because a session is active.
 */
export function deriveAttendanceLocationState(options: {
  session: TimeSessionModel | null;
  tracking: AttendanceLocationTrackingModel | null;
  now?: Date;
}) {
  const { session, tracking } = options;
  const now = options.now ?? new Date();
  const staleAfterSeconds = config.attendance.trackingStaleSeconds;

  const build = (
    state: AttendanceLocationState,
    reason: string | null,
  ) => ({
    state,
    reason,
    permission: tracking?.permission ?? ('UNKNOWN' as const),
    backgroundAllowed: tracking?.backgroundAllowed ?? false,
    lastSampleAt: tracking?.lastSampleAt ?? null,
    lastReportedAt: tracking?.lastReportedAt ?? null,
    staleAfterSeconds,
  });

  if (!session || session.endedAt || session.status === 'STOPPED') {
    return build('STOPPED', 'SESSION_ENDED');
  }
  if (session.status === 'ON_BREAK') {
    if (tracking && isLocationPauseReason(tracking.reason)) {
      return tracking.reason === 'PERMISSION_DENIED'
        ? build('PERMISSION_UNAVAILABLE', 'PERMISSION_DENIED')
        : build('PAUSED', tracking.reason);
    }
    return build('PAUSED', 'BREAK');
  }
  if (!tracking) {
    return build('STOPPED', 'NOT_STARTED');
  }
  if (tracking.status === 'STOPPED') {
    return tracking.permission === 'DENIED'
      ? build('PERMISSION_UNAVAILABLE', 'PERMISSION_DENIED')
      : build('STOPPED', tracking.reason ?? 'STOPPED');
  }

  const lastActivity = Math.max(
    tracking.lastSampleAt?.getTime() ?? 0,
    tracking.lastReportedAt.getTime(),
  );
  if (now.getTime() - lastActivity > staleAfterSeconds * 1000) {
    return tracking.permission === 'DENIED'
      ? build('PERMISSION_UNAVAILABLE', 'PERMISSION_DENIED')
      : build('STALE', tracking.reason ?? 'NO_RECENT_UPDATE');
  }
  if (tracking.permission === 'DENIED') {
    return build('PERMISSION_UNAVAILABLE', 'PERMISSION_DENIED');
  }
  if (tracking.status === 'PAUSED') {
    return build('PAUSED', tracking.reason ?? 'PAUSED');
  }
  return build('ACTIVE', tracking.reason ?? null);
}

async function loadCheckInForSession(options: {
  organizationId: string;
  employeeId: string;
  sessionId: string;
}): Promise<AttendanceCheckInModel | null> {
  return AttendanceCheckIn.findOne({
    where: {
      organizationId: options.organizationId,
      employeeId: options.employeeId,
      timeSessionId: options.sessionId,
    },
  });
}

async function loadLocationSession(options: {
  organizationId: string;
  employeeId: string;
  agentId: string;
  sessionId: string;
  transaction?: Transaction;
  lock?: boolean;
}): Promise<TimeSessionModel> {
  const session = await TimeSession.findOne({
    where: {
      id: options.sessionId,
      organizationId: options.organizationId,
      employeeId: options.employeeId,
      desktopAgentId: options.agentId,
    },
    include: locationSessionIncludes,
    transaction: options.transaction,
    ...(options.lock ? { lock: Transaction.LOCK.UPDATE } : {}),
  });
  if (!session) {
    throw AppError.notFound('Time session not found', 'SESSION_NOT_FOUND');
  }
  return session;
}

function assertOnSite(checkIn: AttendanceCheckInModel | null): void {
  if (!checkIn || checkIn.workMode !== 'ON_SITE') {
    throw AppError.conflict(
      'Location tracking is only available for ON_SITE attendance',
      'LOCATION_TRACKING_REQUIRES_ON_SITE',
    );
  }
}

function assertSessionActive(session: TimeSessionModel, now: Date): void {
  if (session.endedAt || session.status === 'STOPPED') {
    throw AppError.conflict('This time session is already stopped', 'SESSION_NOT_ACTIVE');
  }
  if (
    now.getTime() - session.lastHeartbeatAt.getTime() >
    config.timeTracking.sessionStaleSeconds * 1000
  ) {
    throw AppError.conflict(
      'This time session is stale and must be restarted',
      'SESSION_STALE',
    );
  }
}

function isInsideBreak(breaks: BreakModel[], capturedAt: Date): boolean {
  return breaks.some(
    (brk) =>
      capturedAt.getTime() >= brk.startedAt.getTime() &&
      (brk.endedAt === null || capturedAt.getTime() < brk.endedAt.getTime()),
  );
}

async function upsertTracking(
  options: {
    transaction: Transaction;
    session: TimeSessionModel;
    organizationId: string;
    employeeId: string;
    agentId: string;
    status: 'ACTIVE' | 'PAUSED' | 'STOPPED';
    reason: string | null;
    permission: 'ALWAYS' | 'FOREGROUND_ONLY' | 'DENIED' | 'UNKNOWN';
    backgroundAllowed: boolean;
    lastSampleAt?: Date | null;
  },
): Promise<AttendanceLocationTrackingModel> {
  const { transaction, session } = options;
  const existing = await AttendanceLocationTracking.findOne({
    where: { timeSessionId: session.id },
    transaction,
    lock: Transaction.LOCK.UPDATE,
  });

  if (!existing) {
    return AttendanceLocationTracking.create(
      {
        organizationId: options.organizationId,
        employeeId: options.employeeId,
        desktopAgentId: options.agentId,
        timeSessionId: session.id,
        status: options.status,
        reason: options.reason,
        permission: options.permission,
        backgroundAllowed: options.backgroundAllowed,
        lastSampleAt: options.lastSampleAt ?? null,
        lastReportedAt: new Date(),
      },
      { transaction },
    );
  }

  const lastSampleAt =
    options.lastSampleAt &&
    (!existing.lastSampleAt || options.lastSampleAt > existing.lastSampleAt)
      ? options.lastSampleAt
      : existing.lastSampleAt;

  return existing.update(
    {
      status: options.status,
      reason: options.reason,
      permission: options.permission,
      backgroundAllowed: options.backgroundAllowed,
      lastSampleAt,
      lastReportedAt: new Date(),
    },
    { transaction },
  );
}

/**
 * Mobile-only reconciliation endpoint. It tells the device whether the server
 * still considers the ON_SITE session eligible for tracking, including the
 * break/agent checks that a restart might have missed.
 */
export async function getAttendanceLocationStatus(options: {
  organizationId: string;
  employeeId: string;
  agent: DesktopAgentModel;
}) {
  const { organizationId, employeeId, agent } = options;
  const session = await getCurrentSession(organizationId, employeeId);
  const now = new Date();

  if (!session) {
    return {
      shouldTrack: false,
      reason: 'NO_ACTIVE_SESSION',
      workMode: null,
      checkIn: null,
      session: null,
      tracking: null,
      locationState: deriveAttendanceLocationState({ session: null, tracking: null, now }),
    };
  }

  const checkIn = await loadCheckInForSession({
    organizationId,
    employeeId,
    sessionId: session.id,
  });
  const agentMatches = session.desktopAgentId === agent.id;

  let tracking: AttendanceLocationTrackingModel | null = null;
  if (agentMatches) {
    tracking = await AttendanceLocationTracking.findOne({
      where: { organizationId, employeeId, timeSessionId: session.id },
    });
  }

  const locationPauseReason =
    tracking && isLocationPauseReason(tracking.reason) ? tracking.reason : null;

  let reason: string | null = null;
  if (!agentMatches) reason = 'AGENT_MISMATCH';
  else if (!checkIn) reason = 'NO_CHECK_IN';
  else if (checkIn.workMode !== 'ON_SITE') reason = 'WORK_MODE_NOT_ON_SITE';
  else if (session.status === 'ON_BREAK') reason = locationPauseReason ?? 'BREAK';
  else if (session.endedAt || session.status === 'STOPPED') reason = 'SESSION_ENDED';

  return {
    shouldTrack:
      agentMatches &&
      checkIn?.workMode === 'ON_SITE' &&
      session.status === 'ACTIVE' &&
      !session.endedAt,
    reason,
    workMode: checkIn?.workMode ?? null,
    checkIn: checkIn
      ? { id: checkIn.id, workMode: checkIn.workMode, createdAt: checkIn.createdAt }
      : null,
    session: toTimeSessionSummary(session, now),
    tracking: tracking ? toLocationTrackingSummary(tracking) : null,
    locationState: deriveAttendanceLocationState({
      session: agentMatches ? session : null,
      tracking,
      now,
    }),
  };
}

/**
 * Pauses the running session through the existing Break state machine when the
 * device can no longer prove continuous location. Work time already excludes
 * break intervals, so an active session can never keep accruing after a
 * location-loss report.
 */
/**
 * The server only trusts location up to the last accepted sample, so the pause
 * is backdated there. Everything between that fix and the report (app killed,
 * offline, location switched off) is excluded from work time instead of being
 * counted as verified activity. A manual break that already ended is a floor:
 * two break intervals may never overlap.
 */
export function resolveLocationPauseStart(options: {
  session: TimeSessionModel;
  lastVerifiedAt: Date | null;
  now: Date;
}): Date {
  const { session, lastVerifiedAt, now } = options;
  const floor = (session.breaks ?? []).reduce(
    (latest, brk) => Math.max(latest, brk.endedAt?.getTime() ?? 0),
    session.startedAt.getTime(),
  );
  const candidate = lastVerifiedAt ? lastVerifiedAt.getTime() : now.getTime();
  return new Date(Math.min(now.getTime(), Math.max(floor, candidate)));
}

async function pauseSessionForLocation(
  transaction: Transaction,
  session: TimeSessionModel,
  now: Date,
  lastVerifiedAt: Date | null,
): Promise<void> {
  if (session.status === 'ON_BREAK') return;

  const openBreak = await Break.findOne({
    where: { timeSessionId: session.id, endedAt: null },
    transaction,
    lock: Transaction.LOCK.UPDATE,
  });

  const pauseAt = resolveLocationPauseStart({ session, lastVerifiedAt, now });
  const brk =
    openBreak ??
    (await Break.create(
      {
        organizationId: session.organizationId,
        timeSessionId: session.id,
        startedAt: pauseAt,
        endedAt: null,
        status: 'ACTIVE',
      },
      { transaction },
    ));

  session.breaks = [...(session.breaks ?? []), brk];
  await session.update({ status: 'ON_BREAK', lastHeartbeatAt: now }, { transaction });
}

/**
 * Records what the device reports about the OS-level tracker. The status is
 * normalized against the server's session state so a racing request can never
 * mark a session ACTIVE while it is on a break or already stopped.
 */
export async function reportAttendanceLocationStatus(options: {
  organizationId: string;
  employeeId: string;
  agent: DesktopAgentModel;
  input: AttendanceLocationStatusInput;
}) {
  const { organizationId, employeeId, agent, input } = options;

  return serializeByKey(`employee:${employeeId}`, () =>
    sequelize.transaction(async (transaction) => {
      const now = new Date();
      const session = await loadLocationSession({
        organizationId,
        employeeId,
        agentId: agent.id,
        sessionId: input.sessionId,
        transaction,
        lock: true,
      });
      const checkIn = await loadCheckInForSession({
        organizationId,
        employeeId,
        sessionId: session.id,
      });
      assertOnSite(checkIn);

      const ended = Boolean(session.endedAt) || session.status === 'STOPPED';
      if (ended && input.state !== 'STOPPED') {
        throw AppError.conflict('This time session is already stopped', 'SESSION_NOT_ACTIVE');
      }
      if (!ended && input.state !== 'STOPPED') assertSessionActive(session, now);

      const existingTracking = await AttendanceLocationTracking.findOne({
        where: { timeSessionId: session.id },
        transaction,
        lock: Transaction.LOCK.UPDATE,
      });
      const priorPauseReason =
        existingTracking && isLocationPauseReason(existingTracking.reason)
          ? existingTracking.reason
          : null;

      let status: 'ACTIVE' | 'PAUSED' | 'STOPPED' = input.state;
      let reason = input.reason ?? null;

      if (!ended) {
        const reportedPauseReason = isLocationPauseReason(input.reason)
          ? input.reason
          : input.permission === 'DENIED'
            ? 'PERMISSION_DENIED'
            : null;

        if (session.status === 'ON_BREAK') {
          // A device that recovers while the timer is paused must not resume
          // it; only the employee's explicit resume action may do that.
          status = 'PAUSED';
          reason = reportedPauseReason ?? priorPauseReason ?? 'BREAK';
        } else if (reportedPauseReason) {
          await pauseSessionForLocation(
            transaction,
            session,
            now,
            existingTracking?.lastSampleAt ?? null,
          );
          status = reportedPauseReason === 'PERMISSION_DENIED' ? 'STOPPED' : 'PAUSED';
          reason = reportedPauseReason;
        }
      }

      const tracking = await upsertTracking({
        transaction,
        session,
        organizationId,
        employeeId,
        agentId: agent.id,
        status,
        reason,
        permission: input.permission,
        backgroundAllowed: input.backgroundAllowed,
      });

      if (!ended) {
        await session.update({ lastHeartbeatAt: now }, { transaction });
      }
      await touchAgent(agent, now);

      return {
        tracking: toLocationTrackingSummary(tracking),
        session: toTimeSessionSummary(session, now),
        locationState: deriveAttendanceLocationState({ session, tracking, now }),
      };
    }),
  );
}

/**
 * Accepts a bounded batch of device samples for one session. Each sample is
 * validated independently so one bad fix cannot discard a whole offline queue;
 * duplicates are reported per sample and are safe to retry.
 */
export async function ingestAttendanceLocationSamples(options: {
  organizationId: string;
  employeeId: string;
  agent: DesktopAgentModel;
  input: AttendanceLocationSamplesInput;
}) {
  const { organizationId, employeeId, agent, input } = options;

  return serializeByKey(`employee:${employeeId}`, () =>
    sequelize.transaction(async (transaction) => {
      const now = new Date();
      const session = await loadLocationSession({
        organizationId,
        employeeId,
        agentId: agent.id,
        sessionId: input.sessionId,
        transaction,
        lock: true,
      });
      const checkIn = await loadCheckInForSession({
        organizationId,
        employeeId,
        sessionId: session.id,
      });
      assertOnSite(checkIn);
      assertSessionActive(session, now);

      const trackingBefore = await AttendanceLocationTracking.findOne({
        where: { timeSessionId: session.id },
        transaction,
        lock: Transaction.LOCK.UPDATE,
      });
      // A location pause is still a Break for work-time purposes, but a fresh
      // fix received during it is the server-side proof the employee needs
      // before an explicit resume can be accepted.
      const locationPause =
        session.status === 'ON_BREAK' &&
        Boolean(trackingBefore && isLocationPauseReason(trackingBefore.reason));

      const breaks = session.breaks ?? [];
      const entries = input.samples.map((sample) => ({
        sample,
        result: undefined as SampleResult | undefined,
      }));

      const firstById = new Map<string, (typeof entries)[number]>();
      for (const entry of entries) {
        if (firstById.has(entry.sample.clientSampleId)) {
          entry.result = {
            clientSampleId: entry.sample.clientSampleId,
            status: 'DUPLICATE',
            code: 'DUPLICATE_IN_REQUEST',
          };
        } else {
          firstById.set(entry.sample.clientSampleId, entry);
        }
      }

      const candidateIds = [...firstById.keys()];
      const existing = await AttendanceLocationSample.findAll({
        where: {
          timeSessionId: session.id,
          clientSampleId: { [Op.in]: candidateIds },
        },
        attributes: ['clientSampleId'],
        transaction,
      });
      const existingIds = new Set(existing.map((row) => row.clientSampleId));

      const rows: Array<{
        organizationId: string;
        employeeId: string;
        desktopAgentId: string;
        timeSessionId: string;
        clientSampleId: string;
        latitude: number;
        longitude: number;
        accuracyMeters: number;
        capturedAt: Date;
        receivedAt: Date;
        source: 'DEVICE' | 'UNKNOWN';
      }> = [];

      for (const entry of entries) {
        if (entry.result) continue;
        const sample = entry.sample;
        const reject = (code: string) => {
          entry.result = {
            clientSampleId: sample.clientSampleId,
            status: 'REJECTED',
            code,
          };
        };

        if (existingIds.has(sample.clientSampleId)) {
          entry.result = {
            clientSampleId: sample.clientSampleId,
            status: 'DUPLICATE',
            code: 'ALREADY_RECORDED',
          };
          continue;
        }

        const capturedAt = new Date(sample.capturedAt);
        if (capturedAt.getTime() > now.getTime() + config.attendance.locationFutureSkewSeconds * 1000) {
          reject('SAMPLE_IN_FUTURE');
          continue;
        }
        if (
          capturedAt.getTime() <
          session.startedAt.getTime() - config.attendance.locationFutureSkewSeconds * 1000
        ) {
          reject('SAMPLE_BEFORE_SESSION');
          continue;
        }
        if (sample.accuracyMeters > config.attendance.trackingMaxAccuracyMeters) {
          reject('ACCURACY_TOO_LOW');
          continue;
        }
        if (!locationPause && isInsideBreak(breaks, capturedAt)) {
          reject('SAMPLE_DURING_BREAK');
          continue;
        }

        entry.result = {
          clientSampleId: sample.clientSampleId,
          status: 'ACCEPTED',
        };
        rows.push({
          organizationId,
          employeeId,
          desktopAgentId: agent.id,
          timeSessionId: session.id,
          clientSampleId: sample.clientSampleId,
          latitude: sample.latitude,
          longitude: sample.longitude,
          accuracyMeters: sample.accuracyMeters,
          capturedAt,
          receivedAt: now,
          source: sample.source ?? 'DEVICE',
        });
      }

      if (rows.length > 0) {
        await AttendanceLocationSample.bulkCreate(rows, {
          transaction,
          ignoreDuplicates: true,
        });

        const status = session.status === 'ON_BREAK' ? 'PAUSED' : 'ACTIVE';
        const reason =
          session.status === 'ON_BREAK'
            ? (locationPause ? trackingBefore?.reason ?? 'BREAK' : 'BREAK')
            : null;
        const permission =
          trackingBefore?.permission === 'DENIED'
            ? 'UNKNOWN'
            : trackingBefore?.permission ?? 'UNKNOWN';
        // Evidence is anchored to when the fix was captured, not when a queued
        // batch finally arrived. A pause reported after an offline gap or a
        // process kill is then backdated to the last real fix instead of
        // counting the unverified interval as work.
        const latestCapturedAt = rows.reduce(
          (latest, row) => (row.capturedAt > latest ? row.capturedAt : latest),
          new Date(0),
        );

        await upsertTracking({
          transaction,
          session,
          organizationId,
          employeeId,
          agentId: agent.id,
          status,
          reason,
          permission,
          backgroundAllowed: trackingBefore?.backgroundAllowed ?? false,
          lastSampleAt: latestCapturedAt,
        });

        // Accepted samples are the mobile heartbeat while the app is
        // backgrounded, so an active session must not go stale under a running
        // tracker.
        await session.update({ lastHeartbeatAt: now }, { transaction });
        await touchAgent(agent, now);
      }

      const results = entries.map((entry) => entry.result!);
      return {
        sessionId: session.id,
        accepted: results.filter((result) => result.status === 'ACCEPTED').length,
        duplicates: results.filter((result) => result.status === 'DUPLICATE').length,
        rejected: results.filter((result) => result.status === 'REJECTED').length,
        results,
        session: toTimeSessionSummary(session, now),
      };
    }),
  );
}

/**
 * Allows every member to inspect their own history, and only roles explicitly
 * granted `attendance:location:read` to inspect someone else's. The check-in
 * owner is resolved here so self-access works for every role; the service
 * repeats the full authorization and organization-scope check.
 */
export async function requireAttendanceLocationHistoryAccess(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const context = req.organization;
  if (!context) {
    return next(
      AppError.forbidden('Organization context is required', 'ORGANIZATION_CONTEXT_REQUIRED'),
    );
  }
  if (hasPermission(context.effective, 'attendance:location:read')) return next();

  try {
    const checkIn = await AttendanceCheckIn.findOne({
      where: {
        id: req.params.checkInId,
        organizationId: req.organization!.organization.id,
      },
      attributes: ['employeeId'],
    });
    // Missing check-ins and employee self-scope are resolved by the service so
    // it can keep returning 404 for records the caller cannot see.
    if (!checkIn || checkIn.employeeId === req.auth?.user.id) return next();
    if (isSelfScoped(context.effective)) return next();
    return next(AppError.forbidden('Your role does not permit this action', 'PERMISSION_DENIED'));
  } catch (error) {
    return next(error);
  }
}

export async function getAttendanceLocationHistory(options: {
  organization: OrganizationModel;
  checkInId: string;
  actorUserId: string;
  actorRole: Role | PermissionSubject;
  query: AttendanceLocationHistoryQuery;
  context?: AuditContext;
}) {
  const { organization, checkInId, actorUserId, actorRole, query } = options;
  const now = new Date();

  const checkIn = await AttendanceCheckIn.findOne({
    where: { id: checkInId, organizationId: organization.id },
    include: historyCheckInIncludes,
  });
  if (!checkIn) {
    throw AppError.notFound('Attendance check-in not found', 'ATTENDANCE_CHECK_IN_NOT_FOUND');
  }

  const isSelf = checkIn.employeeId === actorUserId;
  if (isSelfScoped(actorRole) && !isSelf) {
    throw AppError.notFound('Attendance check-in not found', 'ATTENDANCE_CHECK_IN_NOT_FOUND');
  }
  if (!isSelf && !hasPermission(actorRole, 'attendance:location:read')) {
    throw AppError.forbidden('Your role does not permit this action', 'PERMISSION_DENIED');
  }
  if (checkIn.workMode !== 'ON_SITE') {
    throw AppError.unprocessable(
      'Location history is only recorded for ON_SITE attendance',
      'LOCATION_HISTORY_NOT_AVAILABLE',
    );
  }

  const tracking = await AttendanceLocationTracking.findOne({
    where: {
      organizationId: organization.id,
      employeeId: checkIn.employeeId,
      timeSessionId: checkIn.timeSessionId,
    },
  });

  const sampleWhere = {
    organizationId: organization.id,
    employeeId: checkIn.employeeId,
    timeSessionId: checkIn.timeSessionId,
  };

  const [rows, totalSamples] = await Promise.all([
    AttendanceLocationSample.findAll({
      where: sampleWhere,
      order: [
        ['capturedAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit: query.limit + 1,
    }),
    AttendanceLocationSample.count({ where: sampleWhere }),
  ]);
  const truncated = rows.length > query.limit;
  const samples = (truncated ? rows.slice(0, query.limit) : rows)
    .reverse()
    .map(toLocationSampleSummary);

  if (!isSelf) {
    await recordAuditEvent(
      {
        organizationId: organization.id,
        actorUserId,
        targetEmployeeId: checkIn.employeeId,
        action: 'ATTENDANCE_LOCATION_HISTORY_VIEWED',
        entityType: 'ATTENDANCE_CHECK_IN',
        entityId: checkIn.id,
        metadata: {
          timeSessionId: checkIn.timeSessionId,
          employeeId: checkIn.employeeId,
          returnedSamples: samples.length,
          totalSamples,
          truncated,
          limit: query.limit,
        },
      },
      { context: options.context },
    );
  }

  const retentionCutoff = new Date(
    now.getTime() - config.attendance.locationRetentionDays * 86_400_000,
  );

  return {
    checkIn: {
      id: checkIn.id,
      employeeId: checkIn.employeeId,
      sessionId: checkIn.timeSessionId,
      workMode: checkIn.workMode,
      createdAt: checkIn.createdAt,
      location:
        checkIn.latitude !== null &&
        checkIn.longitude !== null &&
        checkIn.accuracyMeters !== null &&
        checkIn.locationRecordedAt !== null
          ? {
              latitude: Number(checkIn.latitude),
              longitude: Number(checkIn.longitude),
              accuracyMeters: Number(checkIn.accuracyMeters),
              recordedAt: checkIn.locationRecordedAt,
            }
          : null,
    },
    employee: checkIn.employee
      ? {
          id: checkIn.employee.id,
          name: checkIn.employee.name,
          email: checkIn.employee.email,
        }
      : null,
    session: checkIn.timeSession ? toTimeSessionSummary(checkIn.timeSession, now) : null,
    tracking: tracking ? toLocationTrackingSummary(tracking) : null,
    locationState: deriveAttendanceLocationState({
      session: checkIn.timeSession ?? null,
      tracking,
      now,
    }),
    samples,
    totalSamples,
    truncated,
    retention: {
      days: config.attendance.locationRetentionDays,
      cutoff: retentionCutoff,
    },
  };
}

/**
 * Deletes precise samples older than the configured retention window and
 * tracking rows whose session ended before it. Runs from the server's periodic
 * maintenance loop; the retention window is configurable.
 */
export async function purgeAttendanceLocationHistory(now = new Date()) {
  const cutoff = new Date(
    now.getTime() - config.attendance.locationRetentionDays * 86_400_000,
  );

  const samplesDeleted = await AttendanceLocationSample.destroy({
    where: { capturedAt: { [Op.lt]: cutoff } },
  });

  const endedSessions = await TimeSession.findAll({
    where: { endedAt: { [Op.lt]: cutoff } },
    attributes: ['id'],
    raw: true,
  });

  const ids = endedSessions.map((session) => session.id);
  let trackingDeleted = 0;
  for (let index = 0; index < ids.length; index += 500) {
    const chunk = ids.slice(index, index + 500);
    trackingDeleted += await AttendanceLocationTracking.destroy({
      where: { timeSessionId: { [Op.in]: chunk } },
    });
  }

  return { cutoff, samplesDeleted, trackingDeleted };
}
