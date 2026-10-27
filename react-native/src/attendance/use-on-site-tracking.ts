import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import type {
  AttendanceCheckInSummary,
  TimeSessionSummary,
} from '../api/types';
import { useAuth } from '../auth/auth-context';
import type { MobileAgent } from '../device/mobile-agent';
import {
  getOnSiteTrackingSnapshot,
  pauseOnSiteTracking,
  reconcileOnSiteTracking,
  stopOnSiteTracking,
  subscribeOnSiteTracking,
  type OnSiteTrackingSnapshot,
} from '../location/on-site-tracking';

interface Options {
  agent: MobileAgent | null;
  organizationId: string | null;
  userId: string | null;
  session: TimeSessionSummary | null;
  checkIn: AttendanceCheckInSummary | null;
  ownsSession: boolean;
}

export interface OnSiteTrackingResult extends OnSiteTrackingSnapshot {
  retry: () => void;
}

/**
 * Keeps the OS-level location tracker aligned with the server session. Every
 * start is preceded by a server reconciliation, so a restart never resumes
 * tracking from stale local state.
 */
export function useOnSiteTracking(options: Options): OnSiteTrackingResult {
  const { status } = useAuth();
  const snapshot = useSyncExternalStore(
    subscribeOnSiteTracking,
    getOnSiteTrackingSnapshot,
    getOnSiteTrackingSnapshot,
  );
  const [attempt, setAttempt] = useState(0);

  const { agent, organizationId, userId, session, checkIn, ownsSession } = options;
  const agentId = agent?.id ?? null;
  const agentKey = agent?.key ?? null;
  const sessionId = session?.id ?? null;
  const sessionStatus = session?.status ?? null;
  const workMode = checkIn?.workMode ?? null;
  const onSiteOwned =
    Boolean(sessionId) &&
    ownsSession &&
    workMode === 'ON_SITE' &&
    sessionStatus !== 'STOPPED';

  useEffect(() => {
    if (status !== 'authenticated' || !agentId || !agentKey || !organizationId || !userId) {
      void stopOnSiteTracking();
      return;
    }

    if (!onSiteOwned || !sessionId) {
      void stopOnSiteTracking({ report: true });
      return;
    }

    const identity = {
      organizationId,
      userId,
      agent: { id: agentId, key: agentKey },
      sessionId,
    };

    if (sessionStatus === 'ON_BREAK') {
      void pauseOnSiteTracking(identity);
      return;
    }

    if (sessionStatus === 'ACTIVE') {
      void reconcileOnSiteTracking(identity);
      return;
    }

    void stopOnSiteTracking({ report: true });
  }, [
    agentId,
    agentKey,
    attempt,
    onSiteOwned,
    organizationId,
    sessionId,
    sessionStatus,
    status,
    userId,
  ]);

  useEffect(() => {
    if (
      status !== 'authenticated' ||
      !agentId ||
      !agentKey ||
      !organizationId ||
      !userId ||
      !sessionId ||
      !onSiteOwned ||
      sessionStatus === 'ON_BREAK'
    ) {
      return;
    }

    const identity = {
      organizationId,
      userId,
      agent: { id: agentId, key: agentKey },
      sessionId,
    };

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void reconcileOnSiteTracking(identity);
    });
    return () => subscription.remove();
  }, [
    agentId,
    agentKey,
    onSiteOwned,
    organizationId,
    sessionId,
    sessionStatus,
    status,
    userId,
  ]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  return { ...snapshot, retry };
}
