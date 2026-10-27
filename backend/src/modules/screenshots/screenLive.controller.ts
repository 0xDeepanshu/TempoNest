import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { getClientIp, getUserAgent } from '../../utils/pagination';
import {
  issueScreenLiveViewerTicket,
  startScreenLiveSession,
  stopScreenLiveSession,
} from './screenLive.service';

function now(): string {
  return new Date().toISOString();
}

function auditContext(req: Request) {
  return {
    ipAddress: getClientIp(req) ?? null,
    userAgent: getUserAgent(req),
  };
}

export const startLiveSession = asyncHandler(async (req: Request, res: Response) => {
  const result = await startScreenLiveSession({
    organizationId: req.organization!.organization.id,
    employeeId: req.params.employeeId!,
    actorUserId: req.auth!.user.id,
    actorRole: req.organization!.membership.role,
    context: auditContext(req),
  });

  res.status(result.reused ? 200 : 201).json({
    data: {
      session: result.session,
      delivery: {
        agentOnline: result.agentOnline,
        delivered: result.delivered,
        note: result.delivered
          ? 'The live capture command was sent to the desktop agent.'
          : 'The agent is not connected. Capture begins once it reconnects and validates the session.',
      },
      reused: result.reused,
    },
    serverTime: now(),
  });
});

export const createViewerTicket = asyncHandler(async (req: Request, res: Response) => {
  const result = await issueScreenLiveViewerTicket({
    organizationId: req.organization!.organization.id,
    sessionId: req.params.sessionId!,
    actorUserId: req.auth!.user.id,
    actorRole: req.organization!.membership.role,
    context: auditContext(req),
  });

  res.status(201).json({
    data: {
      ticket: result.ticket,
      expiresAt: result.expiresAt,
      websocketPath: result.websocketPath,
      session: result.session,
      viewer: result.viewer,
    },
    serverTime: now(),
  });
});

export const stopLiveSession = asyncHandler(async (req: Request, res: Response) => {
  const result = await stopScreenLiveSession({
    organizationId: req.organization!.organization.id,
    sessionId: req.params.sessionId!,
    actorUserId: req.auth!.user.id,
    actorRole: req.organization!.membership.role,
    context: auditContext(req),
  });

  res.status(200).json({
    data: { session: result.session, stopped: result.stopped },
    serverTime: now(),
  });
});
