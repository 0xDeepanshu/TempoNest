import { useCallback, useEffect, useState } from 'react';

import { describeError } from '../api/errors';
import { useAuth } from '../auth/auth-context';
import { MobileAgentError, ensureMobileAgent, type MobileAgent } from './mobile-agent';

interface MobileAgentState {
  key: string | null;
  attempt: number;
  status: 'idle' | 'loading' | 'ready' | 'error';
  agent: MobileAgent | null;
  error: string | null;
  revoked: boolean;
}

const IDLE_STATE: MobileAgentState = {
  key: null,
  attempt: 0,
  status: 'idle',
  agent: null,
  error: null,
  revoked: false,
};

export function useMobileAgent() {
  const { status: authStatus, user, activeOrganization } = useAuth();
  const [state, setState] = useState<MobileAgentState>(IDLE_STATE);
  const [attempt, setAttempt] = useState(0);

  const userId = user?.id ?? null;
  const organizationId = activeOrganization?.id ?? null;
  const authKey =
    authStatus === 'authenticated' && userId && organizationId
      ? `${organizationId}:${userId}`
      : null;

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (!authKey || !userId || !organizationId) return;

    let cancelled = false;

    ensureMobileAgent(organizationId, userId)
      .then((agent) => {
        if (cancelled) return;
        setState({
          key: authKey,
          attempt,
          status: 'ready',
          agent,
          error: null,
          revoked: false,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          key: authKey,
          attempt,
          status: 'error',
          agent: null,
          error:
            error instanceof MobileAgentError ? error.message : describeError(error),
          revoked: error instanceof MobileAgentError && error.code === 'REVOKED',
        });
      });

    return () => {
      cancelled = true;
    };
  }, [authKey, userId, organizationId, attempt]);

  if (!authKey) return { ...IDLE_STATE, retry };

  // A new account, organization, or retry shows the loading state without
  // synchronously resetting state from inside the effect.
  const visibleState: MobileAgentState =
    state.key !== authKey || state.attempt !== attempt || state.status === 'idle'
      ? {
          key: authKey,
          attempt,
          status: 'loading',
          agent: null,
          error: null,
          revoked: false,
        }
      : state;

  return { ...visibleState, retry };
}
