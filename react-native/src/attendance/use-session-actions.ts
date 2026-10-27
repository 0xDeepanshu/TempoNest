import { useCallback, useState } from 'react';

import { checkoutSession, endBreak, startBreak } from '../api/attendance';
import { ApiError, NetworkError, isApiErrorCode } from '../api/errors';
import type { TimeSessionSummary } from '../api/types';
import type { MobileAgent } from '../device/mobile-agent';

export type SessionAction = 'break-start' | 'break-end' | 'checkout';

export interface SessionActionMessage {
  tone: 'error' | 'info';
  text: string;
}

interface Options {
  agent: MobileAgent | null;
  organizationId: string | null;
  session: TimeSessionSummary | null;
  ownsSession: boolean;
  refresh: () => Promise<void>;
  applySession: (session: TimeSessionSummary, serverTime: string) => void;
  clearSession: (serverTime: string) => void;
}

interface SessionWriteResult {
  session: TimeSessionSummary;
  serverTime: string;
}

/**
 * Break, resume, and checkout writes. Writes are never retried blindly: a
 * conflict or transport failure refetches the server state so the UI always
 * reflects what the backend actually recorded.
 */
export function useSessionActions(options: Options) {
  const {
    agent,
    organizationId,
    session,
    ownsSession,
    refresh,
    applySession,
    clearSession,
  } = options;
  const [action, setAction] = useState<SessionAction | null>(null);
  const [message, setMessage] = useState<SessionActionMessage | null>(null);

  const run = useCallback(
    async (
      kind: SessionAction,
      request: () => Promise<SessionWriteResult>,
      applies: 'session' | 'clear',
    ) => {
      if (action) return;
      setAction(kind);
      setMessage(null);

      try {
        const result = await request();
        if (applies === 'clear') clearSession(result.serverTime);
        else applySession(result.session, result.serverTime);
      } catch (error) {
        if (error instanceof NetworkError) {
          await refresh();
          setMessage({
            tone: 'info',
            text: 'The request did not reach TempoNest, so the latest server state was reloaded.',
          });
        } else if (
          isApiErrorCode(
            error,
            'SESSION_NOT_ACTIVE',
            'SESSION_NOT_FOUND',
            'NO_ACTIVE_BREAK',
            'BREAK_ALREADY_ACTIVE',
          )
        ) {
          await refresh();
          setMessage({
            tone: 'info',
            text: 'That session had already changed. The latest server state was reloaded.',
          });
        } else if (error instanceof ApiError) {
          await refresh();
          setMessage({ tone: 'error', text: error.message });
        } else {
          setMessage({
            tone: 'error',
            text: 'That action could not be completed. Refresh and try again.',
          });
        }
      } finally {
        setAction(null);
      }
    },
    [action, applySession, clearSession, refresh],
  );

  const start = useCallback(async () => {
    if (!agent || !organizationId || !session || !ownsSession) return;
    await run(
      'break-start',
      async () => {
        const response = await startBreak(organizationId, session.id, agent);
        return { session: response.data.session, serverTime: response.data.serverTime };
      },
      'session',
    );
  }, [agent, organizationId, ownsSession, run, session]);

  const resume = useCallback(async () => {
    if (!agent || !organizationId || !session || !ownsSession) return;
    await run(
      'break-end',
      async () => {
        const response = await endBreak(organizationId, session.id, agent);
        return { session: response.data.session, serverTime: response.data.serverTime };
      },
      'session',
    );
  }, [agent, organizationId, ownsSession, run, session]);

  const checkout = useCallback(async () => {
    if (!agent || !organizationId || !session || !ownsSession) return;
    await run(
      'checkout',
      async () => {
        const response = await checkoutSession(organizationId, session.id, agent);
        return { session: response.data.session, serverTime: response.data.serverTime };
      },
      'clear',
    );
  }, [agent, organizationId, ownsSession, run, session]);

  return {
    action,
    message,
    start,
    resume,
    checkout,
    clearMessage: () => setMessage(null),
  };
}
