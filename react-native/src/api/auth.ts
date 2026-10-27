import * as tokens from '../auth/tokens';
import {
  ApiError,
  SessionExpiredError,
  isSessionFailure,
} from './errors';
import { httpJson } from './http';
import type { AuthSessionPayload } from './types';

let refreshInFlight: Promise<AuthSessionPayload> | null = null;

export async function signInWithPassword(
  email: string,
  password: string,
): Promise<AuthSessionPayload> {
  const response = await httpJson<{ data: AuthSessionPayload }>('/auth/login', {
    method: 'POST',
    body: { email, password, client: 'mobile' },
    timeoutMs: 20_000,
  });
  await tokens.applyAuthSession(response.data);
  return response.data;
}

/**
 * Refresh tokens are single-use and rotated by the server. Concurrent callers
 * share one request so a screen refresh cannot redeem the same token twice.
 */
export function refreshSession(): Promise<AuthSessionPayload> {
  if (!refreshInFlight) {
    refreshInFlight = performRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function performRefresh(): Promise<AuthSessionPayload> {
  const storedRefreshToken = await tokens.readRefreshToken();
  if (!storedRefreshToken) {
    tokens.clearAccessToken();
    tokens.notifySessionExpired('missing_refresh_token');
    throw new SessionExpiredError();
  }

  const generation = tokens.getSessionGeneration();

  try {
    const response = await httpJson<{ data: AuthSessionPayload }>('/auth/refresh', {
      method: 'POST',
      body: { refreshToken: storedRefreshToken, client: 'mobile' },
      timeoutMs: 15_000,
    });

    // Do not resurrect a session that was signed out (or replaced) while the
    // rotation was in flight.
    if (tokens.getSessionGeneration() !== generation) {
      throw new SessionExpiredError('The session changed while it was refreshing.');
    }

    await tokens.applyAuthSession(response.data);
    return response.data;
  } catch (error) {
    if (tokens.getSessionGeneration() !== generation) {
      throw error instanceof SessionExpiredError
        ? error
        : new SessionExpiredError('The session changed while it was refreshing.');
    }

    if (error instanceof ApiError && isSessionFailure(error)) {
      await tokens.clearCredentials().catch(() => undefined);
      tokens.notifySessionExpired(error.code);
      throw new SessionExpiredError(error.message);
    }
    // Network/server failures must not discard a possibly valid stored token.
    throw error;
  }
}
