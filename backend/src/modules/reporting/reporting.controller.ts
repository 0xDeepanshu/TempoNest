import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../utils/errors';
import { isSelfScoped } from '../memberships/permissions';
import {
  getApplicationTimelineReport,
  getApplicationUsageReport,
  getDailyReport,
  getSessionReport,
  getTrackingStatus,
} from './reporting.service';
import { getActivityOverview, getActivitySummary } from './activityAnalytics.service';
import type {
  ActivityOverviewQuery,
  ActivitySummaryQuery,
  ApplicationTimelineQuery,
  ApplicationUsageQuery,
  DailyReportQuery,
  SessionReportQuery,
  TrackingStatusQuery,
} from './reporting.schemas';

/**
 * Report endpoints are organization-wide for managers and admins. A custom
 * role explicitly scoped to SELF may only read its own employee records, even
 * when it holds report:read.
 */
function scopedReportQuery<T extends { employeeId?: string }>(req: Request): T {
  const context = req.organization!;
  const query = req.query as unknown as T;
  if (!isSelfScoped(context.effective)) return query;

  const actorUserId = req.auth!.user.id;
  if (query.employeeId && query.employeeId !== actorUserId) {
    throw AppError.forbidden(
      'Your role is limited to your own records',
      'PERMISSION_DENIED',
    );
  }
  query.employeeId = actorUserId;
  return query;
}

export const trackingStatus = asyncHandler(async (req: Request, res: Response) => {
  const result = await getTrackingStatus({
    organization: req.organization!.organization,
    query: scopedReportQuery<TrackingStatusQuery>(req),
  });
  res.status(200).json(result);
});

export const sessions = asyncHandler(async (req: Request, res: Response) => {
  const result = await getSessionReport({
    organization: req.organization!.organization,
    query: scopedReportQuery<SessionReportQuery>(req),
  });
  res.status(200).json(result);
});

export const daily = asyncHandler(async (req: Request, res: Response) => {
  const result = await getDailyReport({
    organization: req.organization!.organization,
    query: scopedReportQuery<DailyReportQuery>(req),
  });
  res.status(200).json({ data: result });
});

export const applicationUsage = asyncHandler(async (req: Request, res: Response) => {
  const result = await getApplicationUsageReport({
    organization: req.organization!.organization,
    query: scopedReportQuery<ApplicationUsageQuery>(req),
  });
  res.status(200).json(result);
});

export const applicationTimeline = asyncHandler(async (req: Request, res: Response) => {
  const result = await getApplicationTimelineReport({
    organization: req.organization!.organization,
    query: scopedReportQuery<ApplicationTimelineQuery>(req),
  });
  res.status(200).json(result);
});

export const activitySummary = asyncHandler(async (req: Request, res: Response) => {
  const context = req.organization!;
  const result = await getActivitySummary({
    organization: context.organization,
    actorUserId: context.membership.userId,
    actorRole: context.effective,
    query: req.query as unknown as ActivitySummaryQuery,
  });
  res.status(200).json({ data: result });
});

export const activityOverview = asyncHandler(async (req: Request, res: Response) => {
  const result = await getActivityOverview({
    organization: req.organization!.organization,
    query: scopedReportQuery<ActivityOverviewQuery>(req),
  });
  res.status(200).json(result);
});
