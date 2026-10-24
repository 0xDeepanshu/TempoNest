import { Op } from 'sequelize';
import { DateTime, IANAZone } from 'luxon';
import {
  ApplicationActivity,
  Break,
  DesktopAgent,
  Membership,
  TimeSession,
  User,
} from '../../database';
import { config } from '../../config/env';
import { AppError } from '../../utils/errors';
import { paginate } from '../../utils/pagination';
import {
  clampInterval,
  intersectIntervals,
  mergeIntervals,
  subtractIntervals,
  totalSeconds,
  type Interval,
  secondsBetween,
} from '../../utils/time';
import { toPublicUser } from '../memberships/membership.mapper';
import { isAgentOnline, toDesktopAgentSummary } from '../desktopAgents/desktopAgent.mapper';
import {
  isHeartbeatFresh,
  toTimeSessionSummary,
} from '../timeTracking/timeSession.mapper';
import type { Organization as OrganizationModel } from '../organizations/organization.model';
import type { TimeSession as TimeSessionModel } from '../timeTracking/timeSession.model';
import type { DesktopAgent as DesktopAgentModel } from '../desktopAgents/desktopAgent.model';
import type { Break as BreakModel } from '../timeTracking/break.model';
import type {
  ApplicationTimelineQuery,
  ApplicationUsageQuery,
  DailyReportQuery,
  SessionReportQuery,
  TrackingStatusQuery,
} from './reporting.schemas';

const DISCLAIMER =
  'Application usage is foreground metadata only. It is not a definitive measure or proof of productivity.';

export type RangeDay = { date: string; start: Date; end: Date };
export type ReportRange = { start: Date; end: Date; days: RangeDay[] };

export function reportRange(from: string, to: string, timezone: string): ReportRange {
  const zone = IANAZone.isValidZone(timezone) ? timezone : 'UTC';
  const start = DateTime.fromISO(from, { zone }).startOf('day');
  const endExclusive = DateTime.fromISO(to, { zone }).plus({ days: 1 }).startOf('day');

  if (!start.isValid || !endExclusive.isValid || endExclusive <= start) {
    throw AppError.unprocessable('Invalid reporting date range', 'VALIDATION_ERROR');
  }

  const days: RangeDay[] = [];
  for (let cursor = start; cursor < endExclusive; cursor = cursor.plus({ days: 1 })) {
    days.push({
      date: cursor.toISODate()!,
      start: cursor.toUTC().toJSDate(),
      end: cursor.plus({ days: 1 }).toUTC().toJSDate(),
    });
  }

  return { start: start.toUTC().toJSDate(), end: endExclusive.toUTC().toJSDate(), days };
}

export async function ensureEmployee(organizationId: string, employeeId: string) {
  const membership = await Membership.findOne({
    where: { organizationId, userId: employeeId },
    include: [{ model: User, as: 'user', required: true }],
  });
  if (!membership) {
    throw AppError.notFound('Employee is not a member of this organization', 'EMPLOYEE_NOT_FOUND');
  }
  return membership;
}

export async function loadSessionsOverlapping(options: {
  organizationId: string;
  employeeId?: string;
  start: Date;
  end: Date;
  status?: string;
}): Promise<TimeSessionModel[]> {
  const where: Record<string, unknown> = {
    organizationId: options.organizationId,
    startedAt: { [Op.lt]: options.end },
    [Op.or]: [{ endedAt: null }, { endedAt: { [Op.gt]: options.start } }],
  };
  if (options.employeeId) where.employeeId = options.employeeId;
  if (options.status) where.status = options.status;

  return TimeSession.findAll({
    where,
    include: [{ model: Break, as: 'breaks', required: false }],
    order: [
      ['startedAt', 'ASC'],
      ['id', 'ASC'],
    ],
  });
}

export function effectiveSessionInterval(
  session: TimeSessionModel,
  now: Date,
  rangeStart: Date,
  rangeEnd: Date,
): Interval | null {
  return clampInterval(
    { start: session.startedAt, end: session.endedAt ?? now },
    rangeStart,
    rangeEnd,
  );
}

export function breakIntervals(
  sessions: TimeSessionModel[],
  now: Date,
  rangeStart: Date,
  rangeEnd: Date,
): Interval[] {
  const intervals: Interval[] = [];
  for (const session of sessions) {
    const sessionInterval = effectiveSessionInterval(session, now, rangeStart, rangeEnd);
    if (!sessionInterval) continue;
    for (const brk of session.breaks ?? []) {
      const clipped = intersectIntervals(
        { start: brk.startedAt, end: brk.endedAt ?? now },
        sessionInterval,
      );
      if (clipped) intervals.push(clipped);
    }
  }
  return mergeIntervals(intervals);
}

/** Working intervals = session time inside the range, minus all breaks. */
export function workingIntervalsForSessions(
  sessions: TimeSessionModel[],
  now: Date,
  rangeStart: Date,
  rangeEnd: Date,
): Interval[] {
  const intervals: Interval[] = [];
  for (const session of sessions) {
    const sessionInterval = effectiveSessionInterval(session, now, rangeStart, rangeEnd);
    if (!sessionInterval) continue;
    const cuts = (session.breaks ?? [])
      .map((brk) =>
        intersectIntervals(
          { start: brk.startedAt, end: brk.endedAt ?? now },
          sessionInterval!,
        ),
      )
      .filter((interval): interval is Interval => interval !== null);
    intervals.push(...subtractIntervals(sessionInterval, mergeIntervals(cuts)));
  }
  return mergeIntervals(intervals);
}

export async function getTrackingStatus(options: {
  organization: OrganizationModel;
  query: TrackingStatusQuery;
}) {
  const { organization, query } = options;
  const now = new Date();
  const where: Record<string, unknown> = {
    organizationId: organization.id,
    status: 'ACTIVE',
  };
  if (query.employeeId) where.userId = query.employeeId;

  const memberships = await Membership.findAndCountAll({
    where,
    include: [{ model: User, as: 'user', required: true }],
    order: [
      ['createdAt', 'ASC'],
      ['id', 'ASC'],
    ],
    limit: query.limit,
    offset: (query.page - 1) * query.limit,
    distinct: true,
  });

  const userIds = memberships.rows.map((membership) => membership.userId);
  const activeSessions =
    userIds.length === 0
      ? []
      : await TimeSession.findAll({
          where: {
            organizationId: organization.id,
            employeeId: { [Op.in]: userIds },
            endedAt: null,
          },
          include: [
            { model: Break, as: 'breaks', required: false },
            { model: DesktopAgent, as: 'desktopAgent', required: false },
          ],
        });

  const agents =
    userIds.length === 0
      ? []
      : await DesktopAgent.findAll({
          where: {
            organizationId: organization.id,
            userId: { [Op.in]: userIds },
            revokedAt: null,
          },
          order: [
            ['lastSeenAt', 'DESC'],
            ['id', 'ASC'],
          ],
        });

  const sessionByUser = new Map(activeSessions.map((session) => [session.employeeId, session]));
  const latestAgentByUser = new Map<string, DesktopAgentModel>();
  for (const agent of agents) {
    const current = latestAgentByUser.get(agent.userId);
    if (!current || (agent.lastSeenAt?.getTime() ?? 0) > (current.lastSeenAt?.getTime() ?? 0)) {
      latestAgentByUser.set(agent.userId, agent);
    }
  }

  const rows = memberships.rows.map((membership) => {
    const session = sessionByUser.get(membership.userId) ?? null;
    const agent = latestAgentByUser.get(membership.userId) ?? null;
    const sessionFresh = session ? isHeartbeatFresh(session.lastHeartbeatAt, now) : false;
    const agentFresh = agent ? isAgentOnline(agent, now) : false;

    const state = sessionFresh
      ? session!.status === 'ON_BREAK'
        ? ('ON_BREAK' as const)
        : ('WORKING' as const)
      : agentFresh
        ? ('ONLINE' as const)
        : ('OFFLINE' as const);

    return {
      employee: toPublicUser(membership.user!),
      state,
      online: agentFresh,
      heartbeatStale: session ? !sessionFresh : null,
      activeSession: session ? toTimeSessionSummary(session, now) : null,
      lastHeartbeatAt: session?.lastHeartbeatAt ?? null,
      lastSeenAt: agent?.lastSeenAt ?? null,
      agent: agent ? toDesktopAgentSummary(agent, now) : null,
    };
  });

  return {
    ...paginate(rows, memberships.count, query.page, query.limit),
    timezone: organization.timezone,
    heartbeatStaleAfterSeconds: config.timeTracking.heartbeatStaleSeconds,
    serverTime: now.toISOString(),
  };
}

export async function getSessionReport(options: {
  organization: OrganizationModel;
  query: SessionReportQuery;
}) {
  const { organization, query } = options;
  const range = reportRange(query.from, query.to, organization.timezone);
  const now = new Date();

  if (query.employeeId) {
    await ensureEmployee(organization.id, query.employeeId);
  }

  const where: Record<string, unknown> = {
    organizationId: organization.id,
    startedAt: { [Op.lt]: range.end },
    [Op.or]: [{ endedAt: null }, { endedAt: { [Op.gt]: range.start } }],
  };
  if (query.employeeId) where.employeeId = query.employeeId;
  if (query.status) where.status = query.status;

  const result = await TimeSession.findAndCountAll({
    where,
    include: [
      { model: Break, as: 'breaks', required: false },
      { model: User, as: 'employee', required: true, attributes: ['id', 'name', 'email'] },
      { model: DesktopAgent, as: 'desktopAgent', required: false },
    ],
    order: [
      ['startedAt', 'DESC'],
      ['id', 'ASC'],
    ],
    limit: query.limit,
    offset: (query.page - 1) * query.limit,
    distinct: true,
  });

  const rows = result.rows.map((session) => {
    const summary = toTimeSessionSummary(session, now);
    const breakSeconds = (session.breaks ?? []).reduce(
      (sum, brk) => sum + secondsBetween(brk.startedAt, brk.endedAt ?? now),
      0,
    );
    return {
      ...summary,
      breakSeconds,
      workingSeconds: Math.max(0, summary.durationSeconds - breakSeconds),
    };
  });

  return {
    ...paginate(rows, result.count, query.page, query.limit),
    from: query.from,
    to: query.to,
    timezone: organization.timezone,
  };
}

export async function getDailyReport(options: {
  organization: OrganizationModel;
  query: DailyReportQuery;
}) {
  const { organization, query } = options;
  await ensureEmployee(organization.id, query.employeeId);
  const range = reportRange(query.from, query.to, organization.timezone);
  const now = new Date();
  const sessions = await loadSessionsOverlapping({
    organizationId: organization.id,
    employeeId: query.employeeId,
    start: range.start,
    end: range.end,
  });

  const days = range.days.map((day) => {
    const overlapping = sessions.filter((session) => {
      const interval = effectiveSessionInterval(session, now, day.start, day.end);
      return interval !== null;
    });

    const working = workingIntervalsForSessions(sessions, now, day.start, day.end);
    const breaks = breakIntervals(sessions, now, day.start, day.end);
    const intervals = overlapping
      .map((session) => effectiveSessionInterval(session, now, day.start, day.end))
      .filter((interval): interval is Interval => interval !== null);

    return {
      date: day.date,
      employeeId: query.employeeId,
      workedSeconds: totalSeconds(working),
      breakSeconds: totalSeconds(breaks),
      sessionCount: overlapping.length,
      firstStartedAt: intervals.length
        ? new Date(Math.min(...intervals.map((interval) => interval.start.getTime())))
        : null,
      lastEndedAt: intervals.length
        ? new Date(Math.max(...intervals.map((interval) => interval.end.getTime())))
        : null,
    };
  });

  return {
    employeeId: query.employeeId,
    from: query.from,
    to: query.to,
    timezone: organization.timezone,
    days,
  };
}

type ActivitySegment = {
  activityId: string;
  sessionId: string;
  applicationIdentifier: string;
  applicationName: string;
  startedAt: Date;
  endedAt: Date;
  durationSeconds: number;
};

async function buildActivitySegments(options: {
  organization: OrganizationModel;
  employeeId: string;
  start: Date;
  end: Date;
}): Promise<{ segments: ActivitySegment[]; working: Interval[]; now: Date }> {
  const { organization, employeeId, start, end } = options;
  const now = new Date();
  const sessions = await loadSessionsOverlapping({
    organizationId: organization.id,
    employeeId,
    start,
    end,
  });
  const working = workingIntervalsForSessions(sessions, now, start, end);

  const activities = await ApplicationActivity.findAll({
    where: {
      organizationId: organization.id,
      employeeId,
      startedAt: { [Op.lt]: end },
      endedAt: { [Op.gt]: start },
    },
    order: [
      ['startedAt', 'ASC'],
      ['id', 'ASC'],
    ],
  });

  const segments: ActivitySegment[] = [];
  for (const activity of activities) {
    for (const interval of working) {
      const clipped = intersectIntervals(
        { start: activity.startedAt, end: activity.endedAt },
        interval,
      );
      if (!clipped) continue;
      segments.push({
        activityId: activity.id,
        sessionId: activity.timeSessionId,
        applicationIdentifier: activity.applicationIdentifier,
        applicationName: activity.applicationName,
        startedAt: clipped.start,
        endedAt: clipped.end,
        durationSeconds: secondsBetween(clipped.start, clipped.end),
      });
    }
  }

  return { segments, working, now };
}

export async function getApplicationUsageReport(options: {
  organization: OrganizationModel;
  query: ApplicationUsageQuery;
}) {
  const { organization, query } = options;
  await ensureEmployee(organization.id, query.employeeId);
  const range = reportRange(query.from, query.to, organization.timezone);
  const { segments, working } = await buildActivitySegments({
    organization,
    employeeId: query.employeeId,
    start: range.start,
    end: range.end,
  });

  type Group = {
    applicationIdentifier: string;
    applicationName: string;
    totalSeconds: number;
    eventIds: Set<string>;
    sessionIds: Set<string>;
  };

  const groups = new Map<string, Group>();
  for (const segment of segments) {
    const key = `${segment.applicationIdentifier}\u0000${segment.applicationName}`;
    const group =
      groups.get(key) ??
      {
        applicationIdentifier: segment.applicationIdentifier,
        applicationName: segment.applicationName,
        totalSeconds: 0,
        eventIds: new Set<string>(),
        sessionIds: new Set<string>(),
      };
    group.totalSeconds += segment.durationSeconds;
    group.eventIds.add(segment.activityId);
    group.sessionIds.add(segment.sessionId);
    groups.set(key, group);
  }

  const sorted = [...groups.values()].sort(
    (a, b) => b.totalSeconds - a.totalSeconds || a.applicationName.localeCompare(b.applicationName),
  );
  const totalSecondsAll = sorted.reduce((sum, group) => sum + group.totalSeconds, 0);
  const trackedWorkingSeconds = totalSeconds(working);
  const pageStart = (query.page - 1) * query.limit;
  const data = sorted.slice(pageStart, pageStart + query.limit).map((group) => ({
    applicationIdentifier: group.applicationIdentifier,
    applicationName: group.applicationName,
    totalSeconds: group.totalSeconds,
    percentageOfTrackedTime:
      trackedWorkingSeconds === 0
        ? 0
        : Math.round((group.totalSeconds / trackedWorkingSeconds) * 1000) / 10,
    eventCount: group.eventIds.size,
    sessionCount: group.sessionIds.size,
  }));

  return {
    ...paginate(data, sorted.length, query.page, query.limit),
    employeeId: query.employeeId,
    from: query.from,
    to: query.to,
    timezone: organization.timezone,
    trackedWorkingSeconds,
    totalApplicationSeconds: totalSecondsAll,
    disclaimer: DISCLAIMER,
  };
}

export async function getApplicationTimelineReport(options: {
  organization: OrganizationModel;
  query: ApplicationTimelineQuery;
}) {
  const { organization, query } = options;
  await ensureEmployee(organization.id, query.employeeId);
  const range = reportRange(query.from, query.to, organization.timezone);
  const { segments } = await buildActivitySegments({
    organization,
    employeeId: query.employeeId,
    start: range.start,
    end: range.end,
  });

  const pageStart = (query.page - 1) * query.limit;
  const data = segments.slice(pageStart, pageStart + query.limit).map((segment) => ({
    activityId: segment.activityId,
    sessionId: segment.sessionId,
    applicationIdentifier: segment.applicationIdentifier,
    applicationName: segment.applicationName,
    startedAt: segment.startedAt,
    endedAt: segment.endedAt,
    durationSeconds: segment.durationSeconds,
  }));

  return {
    ...paginate(data, segments.length, query.page, query.limit),
    employeeId: query.employeeId,
    from: query.from,
    to: query.to,
    timezone: organization.timezone,
    disclaimer: DISCLAIMER,
  };
}
