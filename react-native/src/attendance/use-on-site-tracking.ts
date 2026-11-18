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
  requestOnSiteLocationAccess,
  resumeOnSiteTracking,
  stopOnSiteTracking,
  subscribeOnSiteTracking,
  type LocationResumeResult,
  type OnSiteTrackingSnapshot,
} from '../location/on-site-tracking';

interface Options {
  agent: MobileAgent | null;
  organizationId: string | null;
  userId: string | null;
  session: TimeSessionSummary | null;
  checkIn: AttendanceCheckInSummary | null;
  ownsSession: boolean;
  applySession?: (session: TimeSessionSummary, serverTime: string) => void;
  applyLocationPause?: (sessionId: string, pausedAt: string) => void;
}

export interface OnSiteTrackingResult extends OnSiteTrackingSnapshot {
  retry: () => void;
  /** Sends a fresh location fix; the timer only resumes once it is accepted. */
  prepareResume: () => Promise<LocationResumeResult>;
  /** Prompts for permission or opens the matching device settings screen. */
  enableLocation: () => Promise<void>;
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

  const {
    agent,
    organizationId,
    userId,
    session,
    checkIn,
    ownsSession,
    applySession,
    applyLocationPause,
  } = options;
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
      applySession,
      applyLocationPause,
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
    applyLocationPause,
    applySession,
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
      !onSiteOwned
    ) {
      return;
    }

    const identity = {
      organizationId,
      userId,
      agent: { id: agentId, key: agentKey },
      sessionId,
      applySession,
      applyLocationPause,
    };

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') return;
      // A paused session is reconciled through the pause path so the server
      // remains authoritative for whether it is a break or a location pause.
      if (sessionStatus === 'ON_BREAK') void pauseOnSiteTracking(identity);
      else void reconcileOnSiteTracking(identity);
    });
    return () => subscription.remove();
  }, [
    agentId,
    agentKey,
    applyLocationPause,
    applySession,
    onSiteOwned,
    organizationId,
    sessionId,
    sessionStatus,
    status,
    userId,
  ]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  const prepareResume = useCallback(async (): Promise<LocationResumeResult> => {
    if (!agentId || !agentKey || !organizationId || !userId || !sessionId) {
      return {
        ok: false,
        reason: 'NETWORK',
        message: 'This session is not available on this device.',
      };
    }
    return resumeOnSiteTracking({
      organizationId,
      userId,
      agent: { id: agentId, key: agentKey },
      sessionId,
      applySession,
      applyLocationPause,
    });
  }, [
    agentId,
    agentKey,
    applyLocationPause,
    applySession,
    organizationId,
    sessionId,
    userId,
  ]);

  const enableLocation = useCallback(async (): Promise<void> => {
    if (!agentId || !agentKey || !organizationId || !userId || !sessionId) return;
    await requestOnSiteLocationAccess({
      organizationId,
      userId,
      agent: { id: agentId, key: agentKey },
      sessionId,
      applySession,
      applyLocationPause,
    });
  }, [
    agentId,
    agentKey,
    applyLocationPause,
    applySession,
    organizationId,
    sessionId,
    userId,
  ]);

  return { ...snapshot, retry, prepareResume, enableLocation };
}
