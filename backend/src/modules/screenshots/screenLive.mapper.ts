import { config } from '../../config/env';
import type { ScreenLiveSession } from './screenLiveSession.model';
import type { ScreenLiveViewer } from './screenLiveViewer.model';

function userSummary(user: { id: string; name: string; email: string } | undefined | null) {
  return user ? { id: user.id, name: user.name, email: user.email } : undefined;
}

export function toScreenLiveSessionSummary(session: ScreenLiveSession) {
  return {
    id: session.id,
    organizationId: session.organizationId,
    employeeId: session.employeeId,
    desktopAgentId: session.desktopAgentId,
    timeSessionId: session.timeSessionId,
    startedByUserId: session.startedByUserId,
    status: session.status,
    startedAt: session.startedAt,
    expiresAt: session.expiresAt,
    endedAt: session.endedAt,
    terminationReason: session.terminationReason,
    ...(session.employee ? { employee: userSummary(session.employee) } : {}),
    ...(session.startedBy ? { startedBy: userSummary(session.startedBy) } : {}),
    ...(session.desktopAgent
      ? {
          desktopAgent: {
            id: session.desktopAgent.id,
            name: session.desktopAgent.name,
            platform: session.desktopAgent.platform,
          },
        }
      : {}),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

export type ScreenLiveSessionSummary = ReturnType<typeof toScreenLiveSessionSummary>;

/**
 * Server -> agent command. It contains only the identifiers and capture limits
 * the desktop needs; no viewer identity, ticket, or frame bytes are included.
 */
export function toScreenLiveStartCommand(session: ScreenLiveSession) {
  return {
    type: 'screen.live.start' as const,
    liveSessionId: session.id,
    timeSessionId: session.timeSessionId,
    expiresAt: session.expiresAt.toISOString(),
    maxFps: config.screenLive.maxFps,
    maxFrameWidth: config.screenLive.maxFrameWidth,
    maxFrameBytes: config.screenLive.maxFrameBytes,
    streamPath: `${config.apiPrefix}${config.screenLive.agentPath}`,
  };
}

export function toScreenLivePendingSession(session: ScreenLiveSession) {
  return {
    liveSessionId: session.id,
    timeSessionId: session.timeSessionId,
    expiresAt: session.expiresAt.toISOString(),
    maxFps: config.screenLive.maxFps,
    maxFrameWidth: config.screenLive.maxFrameWidth,
    maxFrameBytes: config.screenLive.maxFrameBytes,
    streamPath: `${config.apiPrefix}${config.screenLive.agentPath}`,
  };
}

export function toScreenLiveViewerSummary(viewer: ScreenLiveViewer) {
  return {
    id: viewer.id,
    screenLiveSessionId: viewer.screenLiveSessionId,
    userId: viewer.userId,
    joinedAt: viewer.joinedAt,
    leftAt: viewer.leftAt,
    lastSeenAt: viewer.lastSeenAt,
    disconnectedReason: viewer.disconnectedReason,
    ...(viewer.user ? { user: userSummary(viewer.user) } : {}),
  };
}

export type ScreenLiveViewerSummary = ReturnType<typeof toScreenLiveViewerSummary>;
