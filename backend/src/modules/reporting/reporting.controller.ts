import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  getApplicationTimelineReport,
  getApplicationUsageReport,
  getDailyReport,
  getSessionReport,
  getTrackingStatus,
} from './reporting.service';
import type {
  ApplicationTimelineQuery,
  ApplicationUsageQuery,
  DailyReportQuery,
  SessionReportQuery,
  TrackingStatusQuery,
} from './reporting.schemas';

export const trackingStatus = asyncHandler(async (req: Request, res: Response) => {
  const result = await getTrackingStatus({
    organization: req.organization!.organization,
    query: req.query as unknown as TrackingStatusQuery,
  });
  res.status(200).json(result);
});

export const sessions = asyncHandler(async (req: Request, res: Response) => {
  const result = await getSessionReport({
    organization: req.organization!.organization,
    query: req.query as unknown as SessionReportQuery,
  });
  res.status(200).json(result);
});

export const daily = asyncHandler(async (req: Request, res: Response) => {
  const result = await getDailyReport({
    organization: req.organization!.organization,
    query: req.query as unknown as DailyReportQuery,
  });
  res.status(200).json({ data: result });
});

export const applicationUsage = asyncHandler(async (req: Request, res: Response) => {
  const result = await getApplicationUsageReport({
    organization: req.organization!.organization,
    query: req.query as unknown as ApplicationUsageQuery,
  });
  res.status(200).json(result);
});

export const applicationTimeline = asyncHandler(async (req: Request, res: Response) => {
  const result = await getApplicationTimelineReport({
    organization: req.organization!.organization,
    query: req.query as unknown as ApplicationTimelineQuery,
  });
  res.status(200).json(result);
});
