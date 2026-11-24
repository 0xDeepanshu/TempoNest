import type { NextFunction, Request, Response } from 'express';
import { config } from '../../config/env';
import { AppError } from '../../utils/errors';
import { asyncHandler } from '../../utils/asyncHandler';
import { integrationAuditContext } from './integration.http';
import {
  getIntegrationLiveSession,
  issueIntegrationViewerTicket,
  listLiveScreenEmployees,
  startIntegrationLiveSession,
  stopIntegrationLiveSession,
} from './integration.screenLive.service';

/**
 * Second, independent switch for live screens through integrations. With it off, the viewer-link and
 * live-screen routes behave as if they do not exist, even for a token that holds `screens:live`.
 * Revocation routes are never gated, so an existing link can always be withdrawn.
 */
export function requireLiveScreensEnabled(_req: Request, _res: Response, next: NextFunction): void {
  if (!config.integrations.enabled || !config.integrations.liveScreensEnabled) {
    return next(AppError.notFound('Live screens are not enabled', 'LIVE_SCREENS_DISABLED'));
  }
  next();
}

function noStore(res: Response): void {
  res.set('Cache-Control', 'no-store');
}

export const listLiveEmployeesHandler = asyncHandler(async (req: Request, res: Response) => {
  const data = await listLiveScreenEmployees({
    integration: req.integration!,
    externalUserId: (req.query as { externalUserId: string }).externalUserId,
    context: integrationAuditContext(req),
  });
  noStore(res);
  res.status(200).json({ data });
});

export const startLiveSessionHandler = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as { externalUserId: string; externalEmployeeId: string };
  const data = await startIntegrationLiveSession({
    integration: req.integration!,
    externalUserId: body.externalUserId,
    externalEmployeeId: body.externalEmployeeId,
    context: integrationAuditContext(req),
  });
  noStore(res);
  res.status(data.reused ? 200 : 201).json({ data });
});

export const getLiveSessionHandler = asyncHandler(async (req: Request, res: Response) => {
  const data = await getIntegrationLiveSession({
    integration: req.integration!,
    externalUserId: (req.query as { externalUserId: string }).externalUserId,
    sessionId: req.params.sessionId!,
    context: integrationAuditContext(req),
  });
  noStore(res);
  res.status(200).json({ data });
});

export const issueViewerTicketHandler = asyncHandler(async (req: Request, res: Response) => {
  const data = await issueIntegrationViewerTicket({
    integration: req.integration!,
    externalUserId: (req.body as { externalUserId: string }).externalUserId,
    sessionId: req.params.sessionId!,
    context: integrationAuditContext(req),
  });
  noStore(res);
  res.status(201).json({ data });
});

export const stopLiveSessionHandler = asyncHandler(async (req: Request, res: Response) => {
  const data = await stopIntegrationLiveSession({
    integration: req.integration!,
    externalUserId: (req.body as { externalUserId: string }).externalUserId,
    sessionId: req.params.sessionId!,
    context: integrationAuditContext(req),
  });
  noStore(res);
  res.status(200).json({ data });
});
