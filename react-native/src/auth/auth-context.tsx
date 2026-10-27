import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { refreshSession, signInWithPassword } from '../api/auth';
import { revokeSessionAndClear } from '../api/client';
import { describeError, SessionExpiredError } from '../api/errors';
import type { Membership, Organization, PublicUser } from '../api/types';
import { stopOnSiteTracking } from '../location/on-site-tracking';
import {
  readSelectedOrganizationId,
  writeSelectedOrganizationId,
} from '../storage/metadata';
import * as tokens from './tokens';

export type AuthStatus = 'loading' | 'unauthenticated' | 'restore_error' | 'authenticated';

interface AuthState {
  status: AuthStatus;
  user: PublicUser | null;
  memberships: Membership[];
  activeOrganization: Organization | null;
  notice: string | null;
  restoreError: string | null;
}

interface AuthContextValue extends AuthState {
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  retryRestore: () => void;
  dismissNotice: () => void;
}

const UNAUTHENTICATED_STATE: AuthState = {
  status: 'unauthenticated',
  user: null,
  memberships: [],
  activeOrganization: null,
  notice: null,
  restoreError: null,
};

const AuthContext = createContext<AuthContextValue | null>(null);

function activeOrganizations(memberships: Membership[]): Organization[] {
  const organizations: Organization[] = [];
  for (const membership of memberships) {
    if (
      membership.status === 'ACTIVE' &&
      membership.organization?.status === 'ACTIVE'
    ) {
      organizations.push(membership.organization);
    }
  }
  return organizations;
}

async function resolveOrganization(
  userId: string,
  memberships: Membership[],
): Promise<Organization | null> {
  const organizations = activeOrganizations(memberships);
  if (organizations.length === 0) return null;

  const storedId = await readSelectedOrganizationId(userId).catch(() => null);
  const fallback = organizations[0];
  if (!fallback) return null;
  const selected =
    organizations.find((organization) => organization.id === storedId) ?? fallback;

  if (selected.id !== storedId) {
    await writeSelectedOrganizationId(userId, selected.id).catch(() => undefined);
  }

  return selected;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    user: null,
    memberships: [],
    activeOrganization: null,
    notice: null,
    restoreError: null,
  });
  const [restoreAttempt, setRestoreAttempt] = useState(0);

  useEffect(
    () =>
      tokens.subscribeToSessionExpired(() => {
        setState((previous) =>
          previous.status === 'unauthenticated'
            ? previous
            : {
                ...UNAUTHENTICATED_STATE,
                notice: 'Your session ended. Sign in again to continue.',
              },
        );
      }),
    [],
  );

  useEffect(() => {
    let cancelled = false;

    async function restore() {
      setState((previous) => ({
        ...previous,
        status: 'loading',
        restoreError: null,
      }));

      let storedRefreshToken: string | null;
      try {
        storedRefreshToken = await tokens.readRefreshToken();
      } catch (error) {
        if (!cancelled) {
          setState({
            ...UNAUTHENTICATED_STATE,
            status: 'restore_error',
            restoreError: `Could not read the saved session. ${describeError(error)}`,
          });
        }
        return;
      }

      if (!storedRefreshToken) {
        if (!cancelled) setState(UNAUTHENTICATED_STATE);
        return;
      }

      try {
        const payload = await refreshSession();
        const activeOrganization = await resolveOrganization(payload.user.id, payload.memberships);
        if (cancelled) return;

        setState({
          status: 'authenticated',
          user: payload.user,
          memberships: payload.memberships,
          activeOrganization,
          notice: null,
          restoreError: null,
        });
      } catch (error) {
        if (cancelled) return;

        if (error instanceof SessionExpiredError) {
          setState({
            ...UNAUTHENTICATED_STATE,
            notice: 'Your session ended. Sign in again to continue.',
          });
          return;
        }

        // The refresh token is intentionally kept. A temporary outage or
        // server error must not force the employee to sign in again.
        setState({
          ...UNAUTHENTICATED_STATE,
          status: 'restore_error',
          restoreError: describeError(error),
        });
      }
    }

    void restore();

    return () => {
      cancelled = true;
    };
  }, [restoreAttempt]);

  const signIn = useCallback(async (email: string, password: string) => {
    const payload = await signInWithPassword(email.trim(), password);
    const activeOrganization = await resolveOrganization(payload.user.id, payload.memberships);

    setState({
      status: 'authenticated',
      user: payload.user,
      memberships: payload.memberships,
      activeOrganization,
      notice: null,
      restoreError: null,
    });
  }, []);

  const signOut = useCallback(async () => {
    setState(UNAUTHENTICATED_STATE);
    await stopOnSiteTracking();
    await revokeSessionAndClear();
  }, []);

  const retryRestore = useCallback(() => {
    setRestoreAttempt((value) => value + 1);
  }, []);

  const dismissNotice = useCallback(() => {
    setState((previous) => ({ ...previous, notice: null }));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, signIn, signOut, retryRestore, dismissNotice }),
    [state, signIn, signOut, retryRestore, dismissNotice],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside an AuthProvider');
  }
  return context;
}
