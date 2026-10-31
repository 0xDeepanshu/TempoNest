import { Op } from 'sequelize';
import {
  ActivityIdleInterval,
  ApplicationActivity,
  Break,
  Membership,
  TimeSession,
  User,
} from '../../database';
import { AppError } from '../../utils/errors';
import { paginate } from '../../utils/pagination';
import {
  clampInterval,
  intersectIntervals,
  mergeIntervals,
  subtractIntervals,
  totalSeconds,
  type Interval,
} from '../../utils/time';
import { toPublicUser } from '../memberships/membership.mapper';
import type { Role } from '../memberships/roles';
import { isSelfScoped, type PermissionSubject } from '../memberships/permissions';
import {
  loadClassificationCategories,
  normalizeApplicationIdentifier,
} from '../activity/applicationClassification.service';
import { loadTrackingSettings } from '../activity/trackingSettings.service';
import type {
  ApplicationProductivityCategory,
} from '../activity/applicationClassification.model';
import type { Organization as OrganizationModel } from '../organizations/organization.model';
import type { ActivityIdleInterval as IdleIntervalModel } from '../activity/idleInterval.model';
import type { ApplicationActivity as ActivityModel } from '../activity/applicationActivity.model';
import type { TimeSession as TimeSessionModel } from '../timeTracking/timeSession.model';
import { ensureEmployee, reportRange, type ReportRange } from './reporting.service';
import type { ActivityOverviewQuery, ActivitySummaryQuery } from './reporting.schemas';

const DISCLAIMER =
  'Application usage is foreground metadata only. It is not a definitive measure or proof of productivity and must not be used as an employee performance score.';

const CATEGORY_ORDER: ApplicationProductivityCategory[] = [
  'PRODUCTIVE',
  'NEUTRAL',
  'UNPRODUCTIVE',
  'UNCLASSIFIED',
];

type RangeData = {
  sessions: TimeSessionModel[];
  activities: ActivityModel[];
  idleIntervals: IdleIntervalModel[];
};

type ApplicationGroup = {
  applicationIdentifier: string;
  applicationName: string;
  category: ApplicationProductivityCategory;
  totalSeconds: number;
  eventIds: Set<string>;
  sessionIds: Set<string>;
};

export type ActivityWindowMetrics = {
  sessionCount: number;
  trackedSeconds: number;
  workingSeconds: number;
  breakSeconds: number;
  idleSeconds: number;
  activeSeconds: number;
  applicationSeconds: number;
  unaccountedActiveSeconds: number;
  activityCoveragePercent: number;
  categorySeconds: Record<ApplicationProductivityCategory, number>;
  productivePercentOfActive: number | null;
  unclassifiedPercentOfActive: number | null;
  groups: ApplicationGroup[];
  hasActivityData: boolean;
  hasIdleData: boolean;
};

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function percentOf(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return roundOneDecimal((numerator / denominator) * 100);
}

function intersectSets(left: Interval[], right: Interval[]): Interval[] {
  const output: Interval[] = [];
  for (const a of left) {
    for (const b of right) {
      const clipped = intersectIntervals(a, b);
      if (clipped) output.push(clipped);
    }
  }
  return mergeIntervals(output);
}

function subtractSets(base: Interval[], cuts: Interval[]): Interval[] {
  const mergedCuts = mergeIntervals(cuts);
  const output: Interval[] = [];
  for (const interval of base) {
    output.push(...subtractIntervals(interval, mergedCuts));
  }
  return mergeIntervals(output);
}

function emptyCategorySeconds(): Record<ApplicationProductivityCategory, number> {
  return {
    PRODUCTIVE: 0,
    NEUTRAL: 0,
    UNPRODUCTIVE: 0,
    UNCLASSIFIED: 0,
  };
}

/**
 * Presence math for one window. Session time is authoritative; breaks and idle
 * intervals are subtracted before activity is attributed. Activity is clipped
 * again to the resulting active intervals, so no interval can count twice.
 */
export function computeActivityWindowMetrics(options: {
  sessions: TimeSessionModel[];
  activities: ActivityModel[];
  idleIntervals: IdleIntervalModel[];
  classification: Map<string, ApplicationProductivityCategory>;
  classificationEnabled: boolean;
  start: Date;
  end: Date;
  now: Date;
}): ActivityWindowMetrics {
  const { sessions, activities, idleIntervals, classification, classificationEnabled, start, end, now } =
    options;

  const sessionIntervals: Interval[] = [];
  const breakIntervals: Interval[] = [];

  for (const session of sessions) {
    const sessionInterval = clampInterval(
      { start: session.startedAt, end: session.endedAt ?? now },
      start,
      end,
    );
    if (!sessionInterval) continue;
    sessionIntervals.push(sessionInterval);

    for (const brk of session.breaks ?? []) {
      const clipped = intersectIntervals(
        { start: brk.startedAt, end: brk.endedAt ?? now },
        sessionInterval,
      );
      if (clipped) breakIntervals.push(clipped);
    }
  }

  const tracked = mergeIntervals(sessionIntervals);
  const breaks = mergeIntervals(breakIntervals);
  const working = subtractSets(tracked, breaks);

  const idleInRange: Interval[] = [];
  for (const idle of idleIntervals) {
    const clipped = clampInterval({ start: idle.startedAt, end: idle.endedAt }, start, end);
    if (clipped) idleInRange.push(clipped);
  }
  const idle = intersectSets(idleInRange, working);
  const active = subtractSets(working, idle);

  const groups = new Map<string, ApplicationGroup>();
  const activityIntervals: Interval[] = [];

  for (const activity of activities) {
    const activityInterval = clampInterval(
      { start: activity.startedAt, end: activity.endedAt },
      start,
      end,
    );
    if (!activityInterval) continue;

    for (const activeInterval of active) {
      const clipped = intersectIntervals(activityInterval, activeInterval);
      if (!clipped) continue;
      activityIntervals.push(clipped);

      const key = normalizeApplicationIdentifier(activity.applicationIdentifier);
      const category = classificationEnabled
        ? (classification.get(key) ?? 'UNCLASSIFIED')
        : 'UNCLASSIFIED';
      const group = groups.get(key);
      if (group) {
        group.totalSeconds += Math.floor((clipped.end.getTime() - clipped.start.getTime()) / 1000);
        group.eventIds.add(activity.id);
        group.sessionIds.add(activity.timeSessionId);
      } else {
        groups.set(key, {
          applicationIdentifier: activity.applicationIdentifier,
          applicationName: activity.applicationName,
          category,
          totalSeconds: Math.floor((clipped.end.getTime() - clipped.start.getTime()) / 1000),
          eventIds: new Set([activity.id]),
          sessionIds: new Set([activity.timeSessionId]),
        });
      }
    }
  }

  const activeSeconds = totalSeconds(active);
  const applicationSeconds = totalSeconds(mergeIntervals(activityIntervals));
  const categorySeconds = emptyCategorySeconds();
  for (const group of groups.values()) {
    categorySeconds[group.category] += group.totalSeconds;
  }

  const sortedGroups = [...groups.values()].sort(
    (a, b) =>
      b.totalSeconds - a.totalSeconds ||
      a.applicationName.localeCompare(b.applicationName) ||
      a.applicationIdentifier.localeCompare(b.applicationIdentifier),
  );

  const hasActivityData = applicationSeconds > 0;
  const productivePercentOfActive =
    classificationEnabled && hasActivityData && activeSeconds > 0
      ? percentOf(categorySeconds.PRODUCTIVE, activeSeconds)
      : null;
  const unclassifiedPercentOfActive =
    classificationEnabled && hasActivityData && activeSeconds > 0
      ? percentOf(categorySeconds.UNCLASSIFIED, activeSeconds)
      : null;

  return {
    sessionCount: sessionIntervals.length,
    trackedSeconds: totalSeconds(tracked),
    workingSeconds: totalSeconds(working),
    breakSeconds: totalSeconds(breaks),
    idleSeconds: totalSeconds(idle),
    activeSeconds,
    applicationSeconds,
    unaccountedActiveSeconds: Math.max(0, activeSeconds - applicationSeconds),
    activityCoveragePercent: activeSeconds > 0 ? Math.min(100, percentOf(applicationSeconds, activeSeconds)) : 0,
    categorySeconds,
    productivePercentOfActive,
    unclassifiedPercentOfActive,
    groups: sortedGroups,
    hasActivityData,
    hasIdleData: idleIntervals.length > 0,
  };
}

async function loadRangeData(options: {
  organizationId: string;
  employeeIds: string[];
  range: ReportRange;
}): Promise<RangeData> {
  const { organizationId, employeeIds, range } = options;
  if (employeeIds.length === 0) {
    return { sessions: [], activities: [], idleIntervals: [] };
  }

  const [sessions, activities, idleIntervals] = await Promise.all([
    TimeSession.findAll({
      where: {
        organizationId,
        employeeId: { [Op.in]: employeeIds },
        startedAt: { [Op.lt]: range.end },
        [Op.or]: [{ endedAt: null }, { endedAt: { [Op.gt]: range.start } }],
      },
      include: [{ model: Break, as: 'breaks', required: false }],
      order: [
        ['startedAt', 'ASC'],
        ['id', 'ASC'],
      ],
    }),
    ApplicationActivity.findAll({
      where: {
        organizationId,
        employeeId: { [Op.in]: employeeIds },
        startedAt: { [Op.lt]: range.end },
        endedAt: { [Op.gt]: range.start },
      },
      order: [
        ['startedAt', 'ASC'],
        ['id', 'ASC'],
      ],
    }),
    ActivityIdleInterval.findAll({
      where: {
        organizationId,
        employeeId: { [Op.in]: employeeIds },
        startedAt: { [Op.lt]: range.end },
        endedAt: { [Op.gt]: range.start },
      },
      order: [
        ['startedAt', 'ASC'],
        ['id', 'ASC'],
      ],
    }),
  ]);

  return { sessions, activities, idleIntervals };
}

function metricsForRange(data: RangeData, range: ReportRange, classification: Map<string, ApplicationProductivityCategory>, classificationEnabled: boolean, now: Date) {
  return computeActivityWindowMetrics({
    sessions: data.sessions,
    activities: data.activities,
    idleIntervals: data.idleIntervals,
    classification,
    classificationEnabled,
    start: range.start,
    end: range.end,
    now,
  });
}

function policySummary(settings: Awaited<ReturnType<typeof loadTrackingSettings>>) {
  return {
    appTrackingEnabled: settings.appTrackingEnabled,
    idleDetectionEnabled: settings.idleDetectionEnabled,
    idleThresholdMinutes: settings.idleThresholdMinutes,
    productivityClassificationEnabled: settings.productivityClassificationEnabled,
    activityRetentionDays: settings.activityRetentionDays,
    policyVersion: settings.policyVersion,
    policyUpdatedAt: settings.policyUpdatedAt,
  };
}

function totalsFromMetrics(metrics: ActivityWindowMetrics) {
  return {
    sessionCount: metrics.sessionCount,
    trackedSeconds: metrics.trackedSeconds,
    workingSeconds: metrics.workingSeconds,
    breakSeconds: metrics.breakSeconds,
    idleSeconds: metrics.idleSeconds,
    activeSeconds: metrics.activeSeconds,
    applicationSeconds: metrics.applicationSeconds,
    unaccountedActiveSeconds: metrics.unaccountedActiveSeconds,
    activityCoveragePercent: metrics.activityCoveragePercent,
    productiveSeconds: metrics.categorySeconds.PRODUCTIVE,
    neutralSeconds: metrics.categorySeconds.NEUTRAL,
    unproductiveSeconds: metrics.categorySeconds.UNPRODUCTIVE,
    unclassifiedSeconds: metrics.categorySeconds.UNCLASSIFIED,
    productivePercentOfActive: metrics.productivePercentOfActive,
    unclassifiedPercentOfActive: metrics.unclassifiedPercentOfActive,
    hasActivityData: metrics.hasActivityData,
    hasIdleData: metrics.hasIdleData,
  };
}

export async function getActivitySummary(options: {
  organization: OrganizationModel;
  actorUserId: string;
  actorRole: Role | PermissionSubject;
  query: ActivitySummaryQuery;
}) {
  const { organization, actorUserId, actorRole, query } = options;
  let employeeId = query.employeeId ?? actorUserId;

  if (isSelfScoped(actorRole) && employeeId !== actorUserId) {
    throw AppError.forbidden(
      'Employees may only read their own activity summary',
      'PERMISSION_DENIED',
    );
  }

  const membership = await ensureEmployee(organization.id, employeeId);
  employeeId = membership.userId;

  const range = reportRange(query.from, query.to, organization.timezone);
  const now = new Date();
  const settings = await loadTrackingSettings(organization.id);
  const classificationEnabled = settings.productivityClassificationEnabled;
  const classification = classificationEnabled
    ? await loadClassificationCategories(organization.id)
    : new Map<string, ApplicationProductivityCategory>();

  const data = await loadRangeData({
    organizationId: organization.id,
    employeeIds: [employeeId],
    range,
  });
  const metrics = metricsForRange(data, range, classification, classificationEnabled, now);

  const days = range.days.map((day) => {
    const dayMetrics = computeActivityWindowMetrics({
      sessions: data.sessions,
      activities: data.activities,
      idleIntervals: data.idleIntervals,
      classification,
      classificationEnabled,
      start: day.start,
      end: day.end,
      now,
    });
    return {
      date: day.date,
      ...totalsFromMetrics(dayMetrics),
    };
  });

  return {
    employeeId,
    from: query.from,
    to: query.to,
    timezone: organization.timezone,
    policy: policySummary(settings),
    totals: totalsFromMetrics(metrics),
    categories: CATEGORY_ORDER.map((category) => ({
      category,
      seconds: metrics.categorySeconds[category],
      percentOfActiveTime:
        metrics.activeSeconds > 0
          ? percentOf(metrics.categorySeconds[category], metrics.activeSeconds)
          : 0,
    })),
    applications: metrics.groups.map((group) => ({
      applicationIdentifier: group.applicationIdentifier,
      applicationName: group.applicationName,
      category: group.category,
      classified: group.category !== 'UNCLASSIFIED',
      totalSeconds: group.totalSeconds,
      percentageOfActiveTime:
        metrics.activeSeconds > 0 ? percentOf(group.totalSeconds, metrics.activeSeconds) : 0,
      eventCount: group.eventIds.size,
      sessionCount: group.sessionIds.size,
    })),
    days,
    disclaimer: DISCLAIMER,
  };
}

export async function getActivityOverview(options: {
  organization: OrganizationModel;
  query: ActivityOverviewQuery;
}) {
  const { organization, query } = options;
  if (query.employeeId) {
    await ensureEmployee(organization.id, query.employeeId);
  }

  const range = reportRange(query.from, query.to, organization.timezone);
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
  });

  const employeeIds = memberships.rows.map((membership) => membership.userId);
  const settings = await loadTrackingSettings(organization.id);
  const classificationEnabled = settings.productivityClassificationEnabled;
  const classification = classificationEnabled
    ? await loadClassificationCategories(organization.id)
    : new Map<string, ApplicationProductivityCategory>();
  const data = await loadRangeData({
    organizationId: organization.id,
    employeeIds,
    range,
  });

  const rows = memberships.rows.map((membership) => {
    const employeeId = membership.userId;
    const metrics = computeActivityWindowMetrics({
      sessions: data.sessions.filter((session) => session.employeeId === employeeId),
      activities: data.activities.filter((activity) => activity.employeeId === employeeId),
      idleIntervals: data.idleIntervals.filter((idle) => idle.employeeId === employeeId),
      classification,
      classificationEnabled,
      start: range.start,
      end: range.end,
      now,
    });

    return {
      employee: toPublicUser(membership.user!),
      ...totalsFromMetrics(metrics),
      topApplications: metrics.groups.slice(0, 3).map((group) => ({
        applicationIdentifier: group.applicationIdentifier,
        applicationName: group.applicationName,
        category: group.category,
        totalSeconds: group.totalSeconds,
      })),
    };
  });

  const aggregate = rows.reduce(
    (sum, row) => {
      sum.trackedSeconds += row.trackedSeconds;
      sum.workingSeconds += row.workingSeconds;
      sum.breakSeconds += row.breakSeconds;
      sum.idleSeconds += row.idleSeconds;
      sum.activeSeconds += row.activeSeconds;
      sum.applicationSeconds += row.applicationSeconds;
      sum.productiveSeconds += row.productiveSeconds;
      sum.neutralSeconds += row.neutralSeconds;
      sum.unproductiveSeconds += row.unproductiveSeconds;
      sum.unclassifiedSeconds += row.unclassifiedSeconds;
      return sum;
    },
    {
      trackedSeconds: 0,
      workingSeconds: 0,
      breakSeconds: 0,
      idleSeconds: 0,
      activeSeconds: 0,
      applicationSeconds: 0,
      productiveSeconds: 0,
      neutralSeconds: 0,
      unproductiveSeconds: 0,
      unclassifiedSeconds: 0,
    },
  );

  return {
    ...paginate(rows, memberships.count, query.page, query.limit),
    from: query.from,
    to: query.to,
    timezone: organization.timezone,
    policy: policySummary(settings),
    totals: {
      ...aggregate,
      activityCoveragePercent:
        aggregate.activeSeconds > 0
          ? Math.min(100, percentOf(aggregate.applicationSeconds, aggregate.activeSeconds))
          : 0,
      productivePercentOfActive:
        classificationEnabled &&
        aggregate.applicationSeconds > 0 &&
        aggregate.activeSeconds > 0
          ? percentOf(aggregate.productiveSeconds, aggregate.activeSeconds)
          : null,
      unclassifiedPercentOfActive:
        classificationEnabled &&
        aggregate.applicationSeconds > 0 &&
        aggregate.activeSeconds > 0
          ? percentOf(aggregate.unclassifiedSeconds, aggregate.activeSeconds)
          : null,
    },
    disclaimer: DISCLAIMER,
  };
}
