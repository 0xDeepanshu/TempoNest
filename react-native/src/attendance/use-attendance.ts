import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { fetchCurrentAttendance, sendSessionHeartbeat } from '../api/attendance';
import { ApiError, describeError, isSessionExpiredError } from '../api/errors';
import type {
  CurrentAttendancePayload,
  TimeSessionSummary,
} from '../api/types';
import { useAuth } from '../auth/auth-context';
import type { MobileAgent } from '../device/mobile-agent';
import { computeWorkTime, serverClockOffset, type WorkTime } from './timing';

const HEARTBEAT_INTERVAL_MS = 60_000;
const CLOCK_TICK_MS = 1_000;

export type AttendanceStatus = 'idle' | 'loading' | 'ready' | 'error';

interface AttendanceState {
  status: AttendanceStatus;
  attendance: CurrentAttendancePayload | null;
  error: string | null;
  lastSyncedAt: number | null;
  serverOffsetMs: number;
  refreshing: boolean;
}

const INITIAL_STATE: AttendanceState = {
  status: 'idle',
  attendance: null,
  error: null,
  lastSyncedAt: null,
  serverOffsetMs: 0,
  refreshing: false,
};

export interface AttendanceResult extends AttendanceState {
  session: TimeSessionSummary | null;
  workTime: WorkTime | null;
  ownsSession: boolean;
  nowMs: number;
  refresh: () => Promise<void>;
  retry: () => void;
  applySession: (session: TimeSessionSummary, serverTime: string) => void;
  clearSession: (serverTime: string) => void;
}

/**
 * Reads attendance state and keeps an active session alive with a foreground
 * heartbeat. The timer is derived from server timestamps plus the measured
 * server clock offset; the device clock only provides the ticking "now".
 */
export function useAttendance(agent: MobileAgent | null): AttendanceResult {
  const { status: authStatus, activeOrganization } = useAuth();
  const organizationId = activeOrganization?.id ?? null;
  const agentId = agent?.id ?? null;

  const [state, setState] = useState<AttendanceState>(INITIAL_STATE);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [attempt, setAttempt] = useState(0);

  const mounted = useRef(true);
  const requestSequence = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const ticker = setInterval(() => setNowMs(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(ticker);
  }, []);

  const refresh = useCallback(async () => {
    if (!organizationId) return;

    const requestId = ++requestSequence.current;
    setState((previous) => ({ ...previous, refreshing: true }));

    try {
      const receivedAt = Date.now();
      const response = await fetchCurrentAttendance(organizationId);
      if (!mounted.current || requestId !== requestSequence.current) return;

      setState({
        status: 'ready',
        attendance: response.data,
        error: null,
        lastSyncedAt: receivedAt,
        serverOffsetMs: serverClockOffset(response.serverTime, receivedAt),
        refreshing: false,
      });
    } catch (error) {
      if (!mounted.current || requestId !== requestSequence.current) return;

      if (isSessionExpiredError(error)) {
        setState((previous) => ({ ...previous, refreshing: false }));
        return;
      }

      // A failed refresh never discards a session that is already on screen.
      setState((previous) => ({
        ...previous,
        status: previous.attendance ? 'ready' : 'error',
        error: describeError(error),
        refreshing: false,
      }));
    }
  }, [organizationId]);

  useEffect(() => {
    if (authStatus !== 'authenticated' || !organizationId || !agentId) {
      // Invalidate any in-flight response for a previous identity or device.
      requestSequence.current += 1;
      setState(INITIAL_STATE);
      return;
    }

    setState((previous) => ({
      ...previous,
      status: previous.attendance ? previous.status : 'loading',
      error: null,
    }));
    void refresh();
  }, [authStatus, organizationId, agentId, refresh, attempt]);

  const session = state.attendance?.session ?? null;
  const sessionId = session?.id ?? null;
  const sessionAgentId = session?.desktopAgentId ?? null;
  const ownsSession = Boolean(agentId && sessionAgentId === agentId);

  useEffect(() => {
    if (!organizationId || !agent || !sessionId || sessionAgentId !== agent.id) return;

    const heartbeatOrganizationId = organizationId;
    const heartbeatSessionId = sessionId;
    const heartbeatAgent = agent;
    let cancelled = false;

    async function beat() {
      if (AppState.currentState !== 'active') return;

      try {
        const receivedAt = Date.now();
        const response = await sendSessionHeartbeat(
          heartbeatOrganizationId,
          heartbeatSessionId,
          heartbeatAgent,
        );
        if (cancelled || !mounted.current) return;

        setState((previous) => {
          if (previous.attendance?.session?.id !== heartbeatSessionId) return previous;
          return {
            ...previous,
            attendance: {
              ...previous.attendance,
              session: response.data.session,
            },
            serverOffsetMs: serverClockOffset(response.data.serverTime, receivedAt),
            lastSyncedAt: receivedAt,
          };
        });
      } catch (error) {
        if (cancelled || !mounted.current) return;
        if (isSessionExpiredError(error)) return;

        // Reconcile with the server instead of assuming the timer is gone.
        if (error instanceof ApiError) void refresh();
      }
    }

    void beat();
    const interval = setInterval(() => void beat(), HEARTBEAT_INTERVAL_MS);
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void beat();
    });

    return () => {
      cancelled = true;
      clearInterval(interval);
      subscription.remove();
    };
  }, [organizationId, agent, sessionId, sessionAgentId, refresh]);

  useEffect(() => {
    if (!organizationId || !agentId) return;

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void refresh();
    });

    return () => subscription.remove();
  }, [organizationId, agentId, refresh]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  const applySession = useCallback((session: TimeSessionSummary, serverTime: string) => {
    requestSequence.current += 1;
    const receivedAt = Date.now();
    setState((previous) => ({
      ...previous,
      status: 'ready',
      attendance: previous.attendance
        ? { ...previous.attendance, session }
        : { checkIn: null, session },
      error: null,
      lastSyncedAt: receivedAt,
      serverOffsetMs: serverClockOffset(serverTime, receivedAt),
      refreshing: false,
    }));
  }, []);

  const clearSession = useCallback((serverTime: string) => {
    requestSequence.current += 1;
    const receivedAt = Date.now();
    setState({
      status: 'ready',
      attendance: { checkIn: null, session: null },
      error: null,
      lastSyncedAt: receivedAt,
      serverOffsetMs: serverClockOffset(serverTime, receivedAt),
      refreshing: false,
    });
  }, []);

  const workTime = session ? computeWorkTime(session, nowMs + state.serverOffsetMs) : null;

  return {
    ...state,
    session,
    workTime,
    ownsSession,
    nowMs,
    refresh,
    retry,
    applySession,
    clearSession,
  };
}
