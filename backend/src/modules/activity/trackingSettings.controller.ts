import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { getClientIp, getUserAgent } from '../../utils/pagination';
import { getTrackingSettingsView, updateTrackingSettings } from './trackingSettings.service';
import type { UpdateTrackingSettingsInput } from './trackingSettings.schemas';

export const getSettings = asyncHandler(async (req: Request, res: Response) => {
  const settings = await getTrackingSettingsView(req.organization!.organization.id);
  res.status(200).json({ data: { settings }, serverTime: new Date().toISOString() });
});

export const updateSettings = asyncHandler(async (req: Request, res: Response) => {
  const settings = await updateTrackingSettings({
    organizationId: req.organization!.organization.id,
    actorUserId: req.auth!.user.id,
    actorRole: req.organization!.effective,
    input: req.body as UpdateTrackingSettingsInput,
    context: {
      ipAddress: getClientIp(req) ?? null,
      userAgent: getUserAgent(req),
    },
  });

  res.status(200).json({ data: { settings }, serverTime: new Date().toISOString() });
});
