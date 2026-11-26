import { describe, expect, it } from 'vitest';
import { integrationPresence } from '../src/modules/timeTracking/presence';

// Regression: the integration reported an unclosed session as WORKING even when its heartbeat had stopped, so a person
// whose device had gone offline appeared to be working. WorkZen's own rule is that a session is live only while its
// heartbeat is fresh.

const STALE_SECONDS = 120;
const now = new Date('2026-11-27T10:00:00.000Z');
const secondsAgo = (seconds: number) => new Date(now.getTime() - seconds * 1000);

describe('integration presence follows WorkZen heartbeat rules', () => {
  it('reports WORKING for an open session with a fresh heartbeat', () => {
    expect(integrationPresence({ status: 'ACTIVE', lastHeartbeatAt: secondsAgo(30) }, now, STALE_SECONDS)).toBe('WORKING');
  });

  it('reports ON_BREAK for a fresh session that is on a break', () => {
    expect(integrationPresence({ status: 'ON_BREAK', lastHeartbeatAt: secondsAgo(30) }, now, STALE_SECONDS)).toBe('ON_BREAK');
  });

  it('reports OFFLINE for an open session whose heartbeat is stale, even though it has no end time', () => {
    // The reported case: WorkZen shows "Offline / Session stale"; the open row alone must not mean working.
    expect(integrationPresence({ status: 'ACTIVE', lastHeartbeatAt: secondsAgo(300) }, now, STALE_SECONDS)).toBe('OFFLINE');
  });

  it('treats a heartbeat exactly at the stale boundary as fresh, as WorkZen does', () => {
    expect(integrationPresence({ status: 'ACTIVE', lastHeartbeatAt: secondsAgo(STALE_SECONDS) }, now, STALE_SECONDS)).toBe('WORKING');
    expect(integrationPresence({ status: 'ACTIVE', lastHeartbeatAt: secondsAgo(STALE_SECONDS + 1) }, now, STALE_SECONDS)).toBe('OFFLINE');
  });

  it('reports OFFLINE when there is no session, or no heartbeat was ever recorded', () => {
    expect(integrationPresence(null, now, STALE_SECONDS)).toBe('OFFLINE');
    expect(integrationPresence({ status: 'ACTIVE', lastHeartbeatAt: null }, now, STALE_SECONDS)).toBe('OFFLINE');
  });
});
