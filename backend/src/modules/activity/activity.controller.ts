import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { ingestActivityBatch } from './activity.service';
import type { ActivityBatchInput } from './activity.schemas';

export const ingest = asyncHandler(async (req: Request, res: Response) => {
  const result = await ingestActivityBatch({
    organizationId: req.organization!.organization.id,
    employeeId: req.auth!.user.id,
    agent: req.desktopAgent!,
    input: req.body as ActivityBatchInput,
  });

  res.status(200).json({ data: result });
});
