import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { getClientIp, getUserAgent } from '../../utils/pagination';
import {
  createApplicationClassification,
  listApplicationClassifications,
  updateApplicationClassification,
} from './applicationClassification.service';
import type {
  ClassificationListQuery,
  CreateClassificationInput,
  UpdateClassificationInput,
} from './applicationClassification.schemas';

function auditContext(req: Request) {
  return {
    ipAddress: getClientIp(req) ?? null,
    userAgent: getUserAgent(req),
  };
}

export const list = asyncHandler(async (req: Request, res: Response) => {
  const result = await listApplicationClassifications({
    organizationId: req.organization!.organization.id,
    actorRole: req.organization!.effective,
    query: req.query as unknown as ClassificationListQuery,
  });
  res.status(200).json(result);
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const classification = await createApplicationClassification({
    organizationId: req.organization!.organization.id,
    actorUserId: req.auth!.user.id,
    actorRole: req.organization!.effective,
    input: req.body as CreateClassificationInput,
    context: auditContext(req),
  });
  res.status(201).json({ data: { classification }, serverTime: new Date().toISOString() });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const classification = await updateApplicationClassification({
    organizationId: req.organization!.organization.id,
    classificationId: req.params.classificationId!,
    actorUserId: req.auth!.user.id,
    actorRole: req.organization!.effective,
    input: req.body as UpdateClassificationInput,
    context: auditContext(req),
  });
  res.status(200).json({ data: { classification }, serverTime: new Date().toISOString() });
});
