import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  endBreak,
  getCurrentSession,
  getSessionForActor,
  heartbeat,
  listSessions,
  startBreak,
  startSession,
  stopSession,
  syncOfflineEvents,
} from './timeSession.service';
import { toTimeSessionSummary } from './timeSession.mapper';
import type { OfflineSyncInput, SessionListQuery } from './timeSession.schemas';

function now(): string {
  return new Date().toISOString();
}

export const start = asyncHandler(async (req: Request, res: Response) => {
  const result = await startSession({
    organizationId: req.organization!.organization.id,
    employeeId: req.auth!.user.id,
    agent: req.desktopAgent!,
  });

  res.status(201).json({
    data: {
      session: toTimeSessionSummary(result.session),
      autoClosedSessionId: result.autoClosedSessionId,
      serverTime: now(),
    },
  });
});

export const current = asyncHandler(async (req: Request, res: Response) => {
  const session = await getCurrentSession(
    req.organization!.organization.id,
    req.auth!.user.id,
  );

  res.status(200).json({
    data: {
      session: session ? toTimeSessionSummary(session) : null,
      serverTime: now(),
    },
  });
});

export const stop = asyncHandler(async (req: Request, res: Response) => {
  const session = await stopSession({
    organizationId: req.organization!.organization.id,
    employeeId: req.auth!.user.id,
    agent: req.desktopAgent!,
    sessionId: req.params.sessionId!,
  });

  res.status(200).json({ data: { session: toTimeSessionSummary(session), serverTime: now() } });
});

export const breakStart = asyncHandler(async (req: Request, res: Response) => {
  const result = await startBreak({
    organizationId: req.organization!.organization.id,
    employeeId: req.auth!.user.id,
    agent: req.desktopAgent!,
    sessionId: req.params.sessionId!,
  });

  res.status(201).json({
    data: {
      session: toTimeSessionSummary(result.session),
      breakId: result.breakId,
      serverTime: now(),
    },
  });
});

export const breakEnd = asyncHandler(async (req: Request, res: Response) => {
  const result = await endBreak({
    organizationId: req.organization!.organization.id,
    employeeId: req.auth!.user.id,
    agent: req.desktopAgent!,
    sessionId: req.params.sessionId!,
  });

  res.status(200).json({
    data: {
      session: toTimeSessionSummary(result.session),
      breakId: result.breakId,
      serverTime: now(),
    },
  });
});

export const heartbeatController = asyncHandler(async (req: Request, res: Response) => {
  const session = await heartbeat({
    organizationId: req.organization!.organization.id,
    employeeId: req.auth!.user.id,
    agent: req.desktopAgent!,
    sessionId: req.params.sessionId!,
  });

  res.status(200).json({
    data: {
      session: toTimeSessionSummary(session),
      agentLastSeenAt: req.desktopAgent!.lastSeenAt,
      serverTime: now(),
    },
  });
});

export const detail = asyncHandler(async (req: Request, res: Response) => {
  const session = await getSessionForActor({
    organizationId: req.organization!.organization.id,
    sessionId: req.params.sessionId!,
    actorUserId: req.auth!.user.id,
    actorRole: req.organization!.membership.role,
  });

  res.status(200).json({ data: { session: toTimeSessionSummary(session), serverTime: now() } });
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const result = await listSessions({
    organizationId: req.organization!.organization.id,
    actorUserId: req.auth!.user.id,
    actorRole: req.organization!.membership.role,
    query: req.query as unknown as SessionListQuery,
  });

  res.status(200).json({ ...result, serverTime: now() });
});

export const sync = asyncHandler(async (req: Request, res: Response) => {
  const result = await syncOfflineEvents({
    organizationId: req.organization!.organization.id,
    employeeId: req.auth!.user.id,
    agent: req.desktopAgent!,
    input: req.body as OfflineSyncInput,
  });

  res.status(200).json({ data: result });
});
