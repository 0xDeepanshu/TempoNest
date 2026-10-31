import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { ingestActivityBatch } from './activity.service';
import { ingestIdleIntervalBatch } from './idleInterval.service';
import { loadTrackingSettings } from './trackingSettings.service';
import type { ActivityBatchInput } from './activity.schemas';
import type { IdleIntervalBatchInput } from './idleInterval.schemas';

export const ingest = asyncHandler(async (req: Request, res: Response) => {
  const result = await ingestActivityBatch({
    organizationId: req.organization!.organization.id,
    employeeId: req.auth!.user.id,
    agent: req.desktopAgent!,
    input: req.body as ActivityBatchInput,
  });

  res.status(200).json({ data: result });
});

export const ingestIdle = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.organization!.organization.id;
  const settings = await loadTrackingSettings(organizationId);
  const result = await ingestIdleIntervalBatch({
    organizationId,
    employeeId: req.auth!.user.id,
    agent: req.desktopAgent!,
    settings,
    input: req.body as IdleIntervalBatchInput,
  });

  res.status(200).json({ data: result });
});
