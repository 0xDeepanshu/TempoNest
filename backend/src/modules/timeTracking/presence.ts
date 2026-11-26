/**
 * The integration's answer to "is this person working right now?". It applies WorkZen's own heartbeat rule, the same one
 * the WorkZen tracking page uses: a session is live only while its heartbeat is fresh (no older than the heartbeat
 * stale window). An open session with a stale heartbeat has no end time yet, but the device has stopped reporting, so it
 * is not working. Historical sessions and their durations are not changed by this.
 */
export type IntegrationPresenceStatus = 'WORKING' | 'ON_BREAK' | 'OFFLINE';

export function integrationPresence(
  session: { status: string; lastHeartbeatAt: Date | null } | null,
  now: Date,
  heartbeatStaleSeconds: number,
): IntegrationPresenceStatus {
  if (!session || !session.lastHeartbeatAt) return 'OFFLINE';
  const ageMs = now.getTime() - session.lastHeartbeatAt.getTime();
  if (ageMs > heartbeatStaleSeconds * 1000) return 'OFFLINE';
  return session.status === 'ON_BREAK' ? 'ON_BREAK' : 'WORKING';
}
