import { config } from '../../config/env';
import { secondsBetween } from '../../utils/time';
import type { Break as BreakModel } from './break.model';
import type { TimeSession as TimeSessionModel } from './timeSession.model';

export function isHeartbeatFresh(lastHeartbeatAt: Date | null, now = new Date()): boolean {
  if (!lastHeartbeatAt) return false;
  return now.getTime() - lastHeartbeatAt.getTime() <= config.timeTracking.heartbeatStaleSeconds * 1000;
}

/**
 * End of a session's effective interval. An open session is only credited up
 * to now while it is still receiving heartbeats. Once it is older than the
 * session stale window it is credited up to its last heartbeat, which is the
 * same cutoff the stale-session recovery uses. This stops a crashed or
 * disconnected device from inflating attendance or live durations while the
 * session row is still open.
 */
export function effectiveSessionEnd(session: TimeSessionModel, now = new Date()): Date {
  if (session.endedAt) return session.endedAt;
  const lastHeartbeat = session.lastHeartbeatAt ?? session.startedAt;
  const staleAfterMs = config.timeTracking.sessionStaleSeconds * 1000;
  if (now.getTime() - lastHeartbeat.getTime() <= staleAfterMs) return now;
  return lastHeartbeat;
}

export function toBreakSummary(
  brk: BreakModel,
  now = new Date(),
  sessionEnd?: Date,
) {
  return {
    id: brk.id,
    organizationId: brk.organizationId,
    sessionId: brk.timeSessionId,
    startedAt: brk.startedAt,
    endedAt: brk.endedAt,
    status: brk.status,
    durationSeconds: secondsBetween(
      brk.startedAt,
      brk.endedAt ?? sessionEnd ?? now,
    ),
    createdAt: brk.createdAt,
    updatedAt: brk.updatedAt,
  };
}

export function toTimeSessionSummary(session: TimeSessionModel, now = new Date()) {
  const sessionEnd = effectiveSessionEnd(session, now);
  const breaks = session.breaks
    ? [...session.breaks].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
    : undefined;
  const activeBreak = breaks?.find((brk) => brk.endedAt === null);

  return {
    id: session.id,
    organizationId: session.organizationId,
    employeeId: session.employeeId,
    desktopAgentId: session.desktopAgentId,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    status: session.status,
    source: session.source,
    lastHeartbeatAt: session.lastHeartbeatAt,
    durationSeconds: secondsBetween(session.startedAt, sessionEnd),
    heartbeatFresh: isHeartbeatFresh(session.lastHeartbeatAt, now),
    activeBreak: activeBreak ? toBreakSummary(activeBreak, now, sessionEnd) : null,
    ...(breaks ? { breaks: breaks.map((brk) => toBreakSummary(brk, now, sessionEnd)) } : {}),
    ...(session.desktopAgent
      ? {
          desktopAgent: {
            id: session.desktopAgent.id,
            name: session.desktopAgent.name,
            platform: session.desktopAgent.platform,
            status: session.desktopAgent.revokedAt ? 'REVOKED' : 'ACTIVE',
          },
        }
      : {}),
    ...(session.employee
      ? {
          employee: {
            id: session.employee.id,
            name: session.employee.name,
            email: session.employee.email,
          },
        }
      : {}),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

export type TimeSessionSummary = ReturnType<typeof toTimeSessionSummary>;
