import { config } from '../../config/env';
import { secondsBetween } from '../../utils/time';
import type { Break as BreakModel } from './break.model';
import type { TimeSession as TimeSessionModel } from './timeSession.model';

export function isHeartbeatFresh(lastHeartbeatAt: Date | null, now = new Date()): boolean {
  if (!lastHeartbeatAt) return false;
  return now.getTime() - lastHeartbeatAt.getTime() <= config.timeTracking.heartbeatStaleSeconds * 1000;
}

export function toBreakSummary(brk: BreakModel, now = new Date()) {
  return {
    id: brk.id,
    organizationId: brk.organizationId,
    sessionId: brk.timeSessionId,
    startedAt: brk.startedAt,
    endedAt: brk.endedAt,
    status: brk.status,
    durationSeconds: secondsBetween(brk.startedAt, brk.endedAt ?? now),
    createdAt: brk.createdAt,
    updatedAt: brk.updatedAt,
  };
}

export function toTimeSessionSummary(session: TimeSessionModel, now = new Date()) {
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
    durationSeconds: secondsBetween(session.startedAt, session.endedAt ?? now),
    heartbeatFresh: isHeartbeatFresh(session.lastHeartbeatAt, now),
    activeBreak: activeBreak ? toBreakSummary(activeBreak, now) : null,
    ...(breaks ? { breaks: breaks.map((brk) => toBreakSummary(brk, now)) } : {}),
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
