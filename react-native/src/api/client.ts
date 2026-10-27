import * as tokens from '../auth/tokens';
import { refreshSession } from './auth';
import { ApiError, NetworkError } from './errors';
import { httpJson } from './http';

const AGENT_AUTH_CODES = new Set([
  'AGENT_AUTH_REQUIRED',
  'AGENT_CREDENTIALS_INVALID',
  'AGENT_REVOKED',
  'MOBILE_AGENT_REQUIRED',
]);

export interface AgentCredentials {
  id: string;
  key: string;
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  auth?: boolean;
  agent?: AgentCredentials | null;
  organizationId?: string;
  skipRefresh?: boolean;
  retryNetwork?: boolean;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveAccessToken(): Promise<string> {
  if (!tokens.accessTokenExpiresSoon()) {
    const existing = tokens.getAccessToken();
    if (existing) return existing;
  }
  const refreshed = await refreshSession();
  return refreshed.accessToken;
}

/** Used by binary uploads that cannot go through the JSON request helper. */
export function getValidAccessToken(): Promise<string> {
  return resolveAccessToken();
}

/**
 * Authenticated request with single refresh-and-retry. Writes are never
 * retried automatically; callers use server idempotency when they need safe
 * retries. Reads retry once on a transport failure.
 */
export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const method = options.method ?? 'GET';
  const requiresAuth = options.auth ?? true;
  const retryOnNetwork = options.retryNetwork ?? method === 'GET';
  let retriedAuth = false;
  let retriedNetwork = false;

  for (;;) {
    const headers: Record<string, string> = { ...options.headers };
    if (options.organizationId) {
      headers['X-Organization-Id'] = options.organizationId;
    }
    if (options.agent) {
      headers['X-Agent-Id'] = options.agent.id;
      headers['X-Agent-Key'] = options.agent.key;
    }
    if (requiresAuth) {
      headers.Authorization = `Bearer ${await resolveAccessToken()}`;
    }

    try {
      return await httpJson<T>(path, {
        method,
        body: options.body,
        headers,
        timeoutMs: options.timeoutMs,
      });
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 401 &&
        requiresAuth &&
        !options.skipRefresh &&
        !retriedAuth &&
        !AGENT_AUTH_CODES.has(error.code)
      ) {
        retriedAuth = true;
        await refreshSession();
        continue;
      }

      if (error instanceof ApiError && AGENT_AUTH_CODES.has(error.code)) {
        throw error;
      }

      if (error instanceof NetworkError && retryOnNetwork && !retriedNetwork) {
        retriedNetwork = true;
        await delay(700);
        continue;
      }

      throw error;
    }
  }
}

export async function revokeSessionAndClear(): Promise<void> {
  const storedRefreshToken = await tokens.readRefreshToken().catch(() => null);

  // Local-first: the device is signed out even when the revoke call cannot
  // reach the server.
  await tokens.clearCredentials();

  if (!storedRefreshToken) return;

  try {
    await httpJson('/auth/logout', {
      method: 'POST',
      body: { refreshToken: storedRefreshToken },
      timeoutMs: 8_000,
    });
  } catch {
    // The local session is already gone; the server token will expire on its own.
  }
}
