import { config } from '../../config/env';
import type { DesktopAgent } from './desktopAgent.model';

export function isAgentOnline(agent: DesktopAgent, now = new Date()): boolean {
  if (agent.revokedAt) return false;
  if (!agent.lastSeenAt) return false;
  return now.getTime() - agent.lastSeenAt.getTime() <= config.timeTracking.heartbeatStaleSeconds * 1000;
}

/** Public representation. The agent key hash is never exposed. */
export function toDesktopAgentSummary(agent: DesktopAgent, now = new Date()) {
  return {
    id: agent.id,
    organizationId: agent.organizationId,
    userId: agent.userId,
    deviceId: agent.deviceIdentifier,
    name: agent.name,
    platform: agent.platform,
    osVersion: agent.osVersion,
    appVersion: agent.appVersion,
    clientType: agent.clientType,
    status: agent.revokedAt ? ('REVOKED' as const) : ('ACTIVE' as const),
    online: isAgentOnline(agent, now),
    lastSeenAt: agent.lastSeenAt,
    lastConnectedAt: agent.lastConnectedAt,
    lastDisconnectedAt: agent.lastDisconnectedAt,
    revokedAt: agent.revokedAt,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    ...(agent.user
      ? {
          user: {
            id: agent.user.id,
            name: agent.user.name,
            email: agent.user.email,
            status: agent.user.status,
          },
        }
      : {}),
  };
}

export type DesktopAgentSummary = ReturnType<typeof toDesktopAgentSummary>;
