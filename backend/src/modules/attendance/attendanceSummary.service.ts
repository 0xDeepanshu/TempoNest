import { DateTime, IANAZone } from 'luxon';
import { AppError } from '../../utils/errors';
import { totalSeconds, type Interval } from '../../utils/time';
import {
  breakIntervals,
  effectiveSessionInterval,
  ensureEmployee,
  loadSessionsOverlapping,
  reportRange,
  workingIntervalsForSessions,
} from '../reporting/reporting.service';
import type { Organization as OrganizationModel } from '../organizations/organization.model';
import type { Role } from '../memberships/roles';
import { isSelfScoped, type PermissionSubject } from '../memberships/permissions';
import type { AttendanceSummaryPeriod, AttendanceSummaryQuery } from './attendance.schemas';

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

function periodBoundaries(date: string, period: AttendanceSummaryPeriod, timezone: string) {
  if (period === 'daily') return { periodStart: date, periodEnd: date };

  const localDate = DateTime.fromISO(date, { zone: zoneFor(timezone) });
  if (period === 'weekly') {
    const start = localDate.startOf('week');
    return {
      periodStart: start.toISODate()!,
      periodEnd: start.plus({ days: 6 }).toISODate()!,
    };
  }

  const start = localDate.startOf('month');
  return {
    periodStart: start.toISODate()!,
    periodEnd: start.endOf('month').toISODate()!,
  };
}

function minDate(current: Date | null, candidate: Date): Date {
  if (!current || candidate.getTime() < current.getTime()) return candidate;
  return current;
}

function maxDate(current: Date | null, candidate: Date): Date {
  if (!current || candidate.getTime() > current.getTime()) return candidate;
  return current;
}

export async function getAttendanceSummary(options: {
  organization: OrganizationModel;
  actorUserId: string;
  actorRole: Role | PermissionSubject;
  query: AttendanceSummaryQuery;
}) {
  const { organization, actorUserId, actorRole, query } = options;

  let employeeId = query.employeeId;
  if (isSelfScoped(actorRole)) {
    employeeId = actorUserId;
  } else if (!employeeId) {
    throw AppError.unprocessable(
      'employeeId is required when viewing another employee attendance summary',
      'EMPLOYEE_ID_REQUIRED',
    );
  }

  await ensureEmployee(organization.id, employeeId);
  const range = reportRange(query.from, query.to, organization.timezone);
  const now = new Date();
  const sessions = await loadSessionsOverlapping({
    organizationId: organization.id,
    employeeId,
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

    const { periodStart, periodEnd } = periodBoundaries(
      day.date,
      query.period,
      organization.timezone,
    );
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
    employeeId,
    period: query.period,
    from: query.from,
    to: query.to,
    timezone: organization.timezone,
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
