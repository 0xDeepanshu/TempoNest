import { Op } from 'sequelize';
import { DateTime, IANAZone } from 'luxon';
import {
  ActivityIdleInterval,
  Break,
  IntegrationEmployeeMapping,
  TimeSession,
  User,
} from '../../database';
import { AppError } from '../../utils/errors';
import { paginate } from '../../utils/pagination';
import { clampInterval, secondsBetween, totalSeconds, type Interval } from '../../utils/time';
import {
  breakIntervals,
  effectiveSessionInterval,
  reportRange,
  workingIntervalsForSessions,
} from '../reporting/reporting.service';
import { getCurrentSession } from '../timeTracking/timeSession.service';
import { effectiveSessionEnd, toTimeSessionSummary } from '../timeTracking/timeSession.mapper';
import { toIntegrationEmployeeView } from './integration.employee.service';
import type { TimeSession as TimeSessionModel } from '../timeTracking/timeSession.model';
import type { IntegrationConnection as IntegrationConnectionModel } from './integrationConnection.model';
import type { IntegrationEmployeeMapping as MappingModel } from './integrationEmployeeMapping.model';
import type {
  IntegrationIdleQuery,
  IntegrationSessionHistoryQuery,
  IntegrationStatusQuery,
  IntegrationSummaryQuery,
} from './integration.schemas';

const mappingUserInclude = {
  model: User,
  as: 'workzenUser',
  required: true,
  attributes: ['id', 'name', 'email'],
};

type MappingScope = {
  mapping: MappingModel;
  userId: string;
};

async function loadMappingScope(options: {
  connection: IntegrationConnectionModel;
  externalEmployeeId?: string;
}): Promise<MappingScope[]> {
  const { connection, externalEmployeeId } = options;

  const where: Record<string, unknown> = {
    connectionId: connection.id,
    organizationId: connection.organizationId,
    status: 'ACTIVE',
    workzenUserId: { [Op.ne]: null },
  };
  if (externalEmployeeId) where.externalEmployeeId = externalEmployeeId;

  const mappings = await IntegrationEmployeeMapping.findAll({
    where,
    include: [mappingUserInclude],
    order: [
      ['externalEmployeeId', 'ASC'],
      ['id', 'ASC'],
    ],
  });

  if (externalEmployeeId && mappings.length === 0) {
    throw AppError.notFound(
      'This employee is not mapped to the integration',
      'EMPLOYEE_NOT_MAPPED',
    );
  }

  return mappings
    .filter((mapping): mapping is MappingModel & { workzenUserId: string } =>
      Boolean(mapping.workzenUserId),
    )
    .map((mapping) => ({ mapping, userId: mapping.workzenUserId }));
}

async function loadSessionsForUsers(options: {
  organizationId: string;
  userIds: string[];
  start: Date;
  end: Date;
}) {
  const { organizationId, userIds, start, end } = options;
  if (userIds.length === 0) return [];

  return TimeSession.findAll({
    where: {
      organizationId,
      employeeId: { [Op.in]: userIds },
      startedAt: { [Op.lt]: end },
      [Op.or]: [{ endedAt: null }, { endedAt: { [Op.gt]: start } }],
    },
    include: [{ model: Break, as: 'breaks', required: false }],
    order: [
      ['startedAt', 'ASC'],
      ['id', 'ASC'],
    ],
  });
}

function externalIdByUserId(scopes: MappingScope[]): Map<string, string> {
  return new Map(scopes.map((scope) => [scope.userId, scope.mapping.externalEmployeeId]));
}

function employeeByUserId(scopes: MappingScope[]): Map<string, MappingScope['mapping']> {
  return new Map(scopes.map((scope) => [scope.userId, scope.mapping]));
}

function toSessionView(options: {
  session: TimeSessionModel;
  externalEmployeeId: string;
  mapping: MappingModel;
  now: Date;
}) {
  const { session, externalEmployeeId, mapping, now } = options;
  const summary = toTimeSessionSummary(session, now);
  const sessionEnd = effectiveSessionEnd(session, now);
  const breakSeconds = (session.breaks ?? []).reduce(
    (sum, brk) => sum + secondsBetween(brk.startedAt, brk.endedAt ?? sessionEnd),
    0,
  );

  return {
    externalEmployeeId,
    sessionId: summary.id,
    employee: mapping.workzenUser
      ? toIntegrationEmployeeView(mapping.workzenUser)
      : { id: session.employeeId },
    startedAt: summary.startedAt,
    endedAt: summary.endedAt,
    status: summary.status,
    source: summary.source,
    durationSeconds: summary.durationSeconds,
    breakSeconds,
    workingSeconds: Math.max(0, summary.durationSeconds - breakSeconds),
    activeBreak: summary.activeBreak,
    breaks: (summary.breaks ?? []).map((brk) => ({
      id: brk.id,
      startedAt: brk.startedAt,
      endedAt: brk.endedAt,
      status: brk.status,
      durationSeconds: brk.durationSeconds,
    })),
  };
}

/**
 * Current attendance for one explicitly mapped external employee. This is the
 * authoritative read path for Flowtrium; it never exposes monitoring data.
 */
export async function getEmployeeStatus(options: {
  connection: IntegrationConnectionModel;
  query: IntegrationStatusQuery;
}) {
  const { connection, query } = options;
  const scopes = await loadMappingScope({
    connection,
    externalEmployeeId: query.externalEmployeeId,
  });
  const scope = scopes[0];
  if (!scope) {
    throw AppError.notFound(
      'This employee is not mapped to the integration',
      'EMPLOYEE_NOT_MAPPED',
    );
  }

  const session = await getCurrentSession(connection.organizationId, scope.userId);
  const employee = scope.mapping.workzenUser
    ? toIntegrationEmployeeView(scope.mapping.workzenUser)
    : { id: scope.userId };

  if (!session) {
    return {
      externalEmployeeId: scope.mapping.externalEmployeeId,
      employee,
      status: 'OFFLINE' as const,
      session: null,
      serverTime: new Date().toISOString(),
    };
  }

  const now = new Date();
  return {
    externalEmployeeId: scope.mapping.externalEmployeeId,
    employee,
    status: session.status === 'ON_BREAK' ? ('ON_BREAK' as const) : ('WORKING' as const),
    session: toSessionView({
      session,
      externalEmployeeId: scope.mapping.externalEmployeeId,
      mapping: scope.mapping,
      now,
    }),
    serverTime: now.toISOString(),
  };
}

export async function listSessionHistory(options: {
  connection: IntegrationConnectionModel;
  query: IntegrationSessionHistoryQuery;
}) {
  const { connection, query } = options;
  const scopes = await loadMappingScope({
    connection,
    externalEmployeeId: query.externalEmployeeId,
  });
  const userIds = scopes.map((scope) => scope.userId);
  if (userIds.length === 0) {
    return paginate([], 0, query.page, query.limit);
  }

  const range = reportRange(query.from, query.to, connection.organization?.timezone ?? 'UTC');
  const now = new Date();

  const where: Record<string | symbol, unknown> = {
    organizationId: connection.organizationId,
    employeeId: { [Op.in]: userIds },
    startedAt: { [Op.lt]: range.end },
    [Op.or]: [{ endedAt: null }, { endedAt: { [Op.gt]: range.start } }],
  };

  const result = await TimeSession.findAndCountAll({
    where,
    include: [{ model: Break, as: 'breaks', required: false }],
    order: [
      ['startedAt', 'DESC'],
      ['id', 'ASC'],
    ],
    limit: query.limit,
    offset: (query.page - 1) * query.limit,
    distinct: true,
  });

  const externalIds = externalIdByUserId(scopes);
  const mappings = employeeByUserId(scopes);

  return {
    ...paginate(
      result.rows.map((session) =>
        toSessionView({
          session,
          externalEmployeeId: externalIds.get(session.employeeId) ?? 'unknown',
          mapping: mappings.get(session.employeeId)!,
          now,
        }),
      ),
      result.count,
      query.page,
      query.limit,
    ),
    from: query.from,
    to: query.to,
    timezone: connection.organization?.timezone ?? 'UTC',
  };
}

type PeriodAccumulator = {
  periodStart: string;
  periodEnd: string;
  workedSeconds: number;
  breakSeconds: number;
  sessionIds: Set<string>;
  activeDays: number;
  daysIncluded: number;
  firstStartedAt: Date | null;
  lastEndedAt: Date | null;
};

function zoneFor(timezone: string): string {
  return IANAZone.isValidZone(timezone) ? timezone : 'UTC';
}

function periodBoundaries(date: string, period: 'daily' | 'monthly', timezone: string) {
  if (period === 'daily') return { periodStart: date, periodEnd: date };
  const start = DateTime.fromISO(date, { zone: zoneFor(timezone) }).startOf('month');
  return {
    periodStart: start.toISODate()!,
    periodEnd: start.endOf('month').toISODate()!,
  };
}

function minDate(current: Date | null, candidate: Date): Date {
  return !current || candidate.getTime() < current.getTime() ? candidate : current;
}

function maxDate(current: Date | null, candidate: Date): Date {
  return !current || candidate.getTime() > current.getTime() ? candidate : current;
}

/**
 * Daily or monthly attendance totals across every mapped employee, or for one
 * explicitly filtered employee. Working time excludes breaks; both are clipped
 * to the requested organisation-timezone range.
 */
export async function getAttendanceSummary(options: {
  connection: IntegrationConnectionModel;
  query: IntegrationSummaryQuery;
}) {
  const { connection, query } = options;
  const scopes = await loadMappingScope({
    connection,
    externalEmployeeId: query.externalEmployeeId,
  });
  const timezone = connection.organization?.timezone ?? 'UTC';
  const range = reportRange(query.from, query.to, timezone);
  const now = new Date();

  const sessions = await loadSessionsForUsers({
    organizationId: connection.organizationId,
    userIds: scopes.map((scope) => scope.userId),
    start: range.start,
    end: range.end,
  });

  const periods = new Map<string, PeriodAccumulator>();
  const allSessionIds = new Set<string>();
  let firstStartedAt: Date | null = null;
  let lastEndedAt: Date | null = null;

  for (const day of range.days) {
    const overlapping = sessions.filter(
      (session) => effectiveSessionInterval(session, now, day.start, day.end) !== null,
    );
    const working = workingIntervalsForSessions(sessions, now, day.start, day.end);
    const breaks = breakIntervals(sessions, now, day.start, day.end);
    const intervals: Interval[] = overlapping
      .map((session) => effectiveSessionInterval(session, now, day.start, day.end))
      .filter((interval): interval is Interval => interval !== null);

    const dayFirstStartedAt = intervals.length
      ? new Date(Math.min(...intervals.map((interval) => interval.start.getTime())))
      : null;
    const dayLastEndedAt = intervals.length
      ? new Date(Math.max(...intervals.map((interval) => interval.end.getTime())))
      : null;

    const { periodStart, periodEnd } = periodBoundaries(day.date, query.period, timezone);
    const accumulator =
      periods.get(periodStart) ??
      {
        periodStart,
        periodEnd,
        workedSeconds: 0,
        breakSeconds: 0,
        sessionIds: new Set<string>(),
        activeDays: 0,
        daysIncluded: 0,
        firstStartedAt: null,
        lastEndedAt: null,
      };

    accumulator.workedSeconds += totalSeconds(working);
    accumulator.breakSeconds += totalSeconds(breaks);
    accumulator.daysIncluded += 1;
    if (overlapping.length > 0) accumulator.activeDays += 1;
    for (const session of overlapping) {
      accumulator.sessionIds.add(session.id);
      allSessionIds.add(session.id);
    }
    if (dayFirstStartedAt) {
      accumulator.firstStartedAt = minDate(accumulator.firstStartedAt, dayFirstStartedAt);
      firstStartedAt = minDate(firstStartedAt, dayFirstStartedAt);
    }
    if (dayLastEndedAt) {
      accumulator.lastEndedAt = maxDate(accumulator.lastEndedAt, dayLastEndedAt);
      lastEndedAt = maxDate(lastEndedAt, dayLastEndedAt);
    }
    periods.set(periodStart, accumulator);
  }

  const rows = [...periods.values()]
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart))
    .map((period) => ({
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      workedSeconds: period.workedSeconds,
      breakSeconds: period.breakSeconds,
      sessionCount: period.sessionIds.size,
      activeDays: period.activeDays,
      daysIncluded: period.daysIncluded,
      firstStartedAt: period.firstStartedAt,
      lastEndedAt: period.lastEndedAt,
    }));

  return {
    externalEmployeeId: query.externalEmployeeId ?? null,
    mappedEmployeeCount: scopes.length,
    period: query.period,
    from: query.from,
    to: query.to,
    timezone,
    totals: {
      workedSeconds: rows.reduce((sum, period) => sum + period.workedSeconds, 0),
      breakSeconds: rows.reduce((sum, period) => sum + period.breakSeconds, 0),
      sessionCount: allSessionIds.size,
      activeDays: rows.reduce((sum, period) => sum + period.activeDays, 0),
      firstStartedAt,
      lastEndedAt,
    },
    periods: rows,
  };
}

/**
 * Idle time recorded by the existing desktop activity tracker. It is only
 * available where the organisation already records it; no new tracking is
 * introduced for the integration.
 */
export async function getIdleSummary(options: {
  connection: IntegrationConnectionModel;
  query: IntegrationIdleQuery;
}) {
  const { connection, query } = options;
  const scopes = await loadMappingScope({
    connection,
    externalEmployeeId: query.externalEmployeeId,
  });
  const timezone = connection.organization?.timezone ?? 'UTC';
  const range = reportRange(query.from, query.to, timezone);

  if (scopes.length === 0) {
    return {
      externalEmployeeId: query.externalEmployeeId ?? null,
      from: query.from,
      to: query.to,
      timezone,
      totalIdleSeconds: 0,
      employees: [],
    };
  }

  const where: Record<string | symbol, unknown> = {
    organizationId: connection.organizationId,
    employeeId: { [Op.in]: scopes.map((scope) => scope.userId) },
    startedAt: { [Op.lt]: range.end },
    [Op.or]: [{ endedAt: null }, { endedAt: { [Op.gt]: range.start } }],
  };

  const intervals = await ActivityIdleInterval.findAll({
    where,
    order: [
      ['startedAt', 'ASC'],
      ['id', 'ASC'],
    ],
  });

  const byUser = new Map<string, { idleSeconds: number; intervalCount: number }>();
  for (const idle of intervals) {
    const clipped = clampInterval(
      { start: idle.startedAt, end: idle.endedAt ?? range.end },
      range.start,
      range.end,
    );
    if (!clipped) continue;
    const current = byUser.get(idle.employeeId) ?? { idleSeconds: 0, intervalCount: 0 };
    current.idleSeconds += secondsBetween(clipped.start, clipped.end);
    current.intervalCount += 1;
    byUser.set(idle.employeeId, current);
  }

  const employees = scopes.map((scope) => {
    const idle = byUser.get(scope.userId) ?? { idleSeconds: 0, intervalCount: 0 };
    return {
      externalEmployeeId: scope.mapping.externalEmployeeId,
      employee: scope.mapping.workzenUser
        ? toIntegrationEmployeeView(scope.mapping.workzenUser)
        : { id: scope.userId },
      idleSeconds: idle.idleSeconds,
      intervalCount: idle.intervalCount,
    };
  });

  return {
    externalEmployeeId: query.externalEmployeeId ?? null,
    from: query.from,
    to: query.to,
    timezone,
    totalIdleSeconds: employees.reduce((sum, employee) => sum + employee.idleSeconds, 0),
    employees,
  };
}
