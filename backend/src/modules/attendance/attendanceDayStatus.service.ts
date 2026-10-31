import { Op } from 'sequelize';
import { DateTime } from 'luxon';
import { LeaveRequest } from '../../database';
import { totalSeconds } from '../../utils/time';
import { isSelfScoped, type PermissionSubject } from '../memberships/permissions';
import {
  ensureEmployee,
  loadSessionsOverlapping,
  reportRange,
  workingIntervalsForSessions,
} from '../reporting/reporting.service';
import { toUnits, todayInTimezone } from '../leave/leaveCalendar';
import {
  holidayUnitsForEmployee,
  loadApplicableHolidays,
  organizationWorkingDays,
} from '../leave/holiday.service';
import type { Organization as OrganizationModel } from '../organizations/organization.model';
import type { AttendanceDayStatusQuery } from './attendance.schemas';

export const ATTENDANCE_DAY_STATUSES = [
  'PRESENT',
  'ABSENT',
  'ON_LEAVE',
  'HOLIDAY',
  'HALF_DAY_HOLIDAY',
  'HOLIDAY_WORKED',
  'WEEKLY_OFF',
  'SCHEDULED',
] as const;
export type AttendanceDayStatus = (typeof ATTENDANCE_DAY_STATUSES)[number];

export type AttendanceDayClassification = {
  date: string;
  status: AttendanceDayStatus;
  isWorkingDay: boolean;
  holidayUnits: number;
  leaveUnits: number;
  expectedWorkFraction: number;
  workedSeconds: number;
  holidays: Array<{
    id: string;
    name: string;
    category: string;
    duration: string;
  }>;
};

/**
 * Classifies each day in a range from the current holiday calendar, working
 * days, approved leave charged dates, and tracked work. Classification is
 * derived on read so holiday corrections affect future calculations without
 * mutating stored sessions or approved leave rows.
 */
export async function getAttendanceDayStatus(options: {
  organization: OrganizationModel;
  actorUserId: string;
  actorRole: PermissionSubject;
  query: AttendanceDayStatusQuery;
}): Promise<{
  employeeId: string;
  from: string;
  to: string;
  workingDays: number[];
  days: AttendanceDayClassification[];
  summary: Record<AttendanceDayStatus, number>;
}> {
  const { organization, actorUserId, actorRole, query } = options;
  const employeeId = isSelfScoped(actorRole) ? actorUserId : query.employeeId ?? actorUserId;
  await ensureEmployee(organization.id, employeeId);

  const range = reportRange(query.from, query.to, organization.timezone);
  const workingDays = await organizationWorkingDays(organization.id);
  const workingDaySet = new Set(workingDays);

  const [holidayUnits, holidayRows, leaveRequests, sessions] = await Promise.all([
    holidayUnitsForEmployee({
      organizationId: organization.id,
      employeeId,
      from: query.from,
      to: query.to,
    }),
    loadApplicableHolidays({
      organizationId: organization.id,
      employeeId,
      from: query.from,
      to: query.to,
    }),
    LeaveRequest.findAll({
      where: {
        organizationId: organization.id,
        employeeId,
        status: 'APPROVED',
        startDate: { [Op.lte]: query.to },
        endDate: { [Op.gte]: query.from },
      },
      order: [['startDate', 'ASC']],
    }),
    loadSessionsOverlapping({
      organizationId: organization.id,
      employeeId,
      start: range.start,
      end: range.end,
    }),
  ]);

  const holidaysByDate = new Map<string, AttendanceDayClassification['holidays']>();
  for (const holiday of holidayRows) {
    const list = holidaysByDate.get(holiday.holidayDate) ?? [];
    list.push({
      id: holiday.id,
      name: holiday.name,
      category: holiday.category,
      duration: holiday.duration,
    });
    holidaysByDate.set(holiday.holidayDate, list);
  }

  const leaveUnitsByDate = new Map<string, number>();
  for (const request of leaveRequests) {
    for (const charged of request.chargedDates ?? []) {
      if (charged.date < query.from || charged.date > query.to) continue;
      const current = leaveUnitsByDate.get(charged.date) ?? 0;
      leaveUnitsByDate.set(charged.date, Math.min(1, Math.round((current + toUnits(charged.units)) * 100) / 100));
    }
  }

  const now = new Date();
  const today = todayInTimezone(organization.timezone);
  const summary: Record<AttendanceDayStatus, number> = {
    PRESENT: 0,
    ABSENT: 0,
    ON_LEAVE: 0,
    HOLIDAY: 0,
    HALF_DAY_HOLIDAY: 0,
    HOLIDAY_WORKED: 0,
    WEEKLY_OFF: 0,
    SCHEDULED: 0,
  };

  const days: AttendanceDayClassification[] = range.days.map((day) => {
    const daySessions = sessions.filter((session) => {
      const endedAt = session.endedAt ?? now;
      return session.startedAt < day.end && endedAt > day.start;
    });
    const workedSeconds = totalSeconds(
      workingIntervalsForSessions(daySessions, now, day.start, day.end),
    );

    const holidayUnitsForDate = holidayUnits.get(day.date) ?? 0;
    const leaveUnits = leaveUnitsByDate.get(day.date) ?? 0;
    const weekday = DateTime.fromISO(day.date, { zone: 'utc' }).weekday;
    const isWorkingDay = workingDaySet.has(weekday);

    let status: AttendanceDayStatus;
    if (holidayUnitsForDate >= 1) {
      status = workedSeconds > 0 ? 'HOLIDAY_WORKED' : 'HOLIDAY';
    } else if (holidayUnitsForDate > 0) {
      status = 'HALF_DAY_HOLIDAY';
    } else if (!isWorkingDay) {
      status = 'WEEKLY_OFF';
    } else if (leaveUnits > 0) {
      status = 'ON_LEAVE';
    } else if (workedSeconds > 0) {
      status = 'PRESENT';
    } else if (day.date > today) {
      status = 'SCHEDULED';
    } else {
      status = 'ABSENT';
    }

    summary[status] += 1;

    return {
      date: day.date,
      status,
      isWorkingDay,
      holidayUnits: holidayUnitsForDate,
      leaveUnits,
      expectedWorkFraction: Math.max(0, Math.round((1 - holidayUnitsForDate) * 100) / 100),
      workedSeconds,
      holidays: holidaysByDate.get(day.date) ?? [],
    };
  });

  return {
    employeeId,
    from: query.from,
    to: query.to,
    workingDays,
    days,
    summary,
  };
}
