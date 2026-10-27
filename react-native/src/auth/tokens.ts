import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { AuthSessionPayload } from '../api/types';

const REFRESH_TOKEN_KEY = 'temponest.refreshToken';

interface TokenState {
  accessToken: string | null;
  accessExpiresAt: number;
}

const state: TokenState = {
  accessToken: null,
  accessExpiresAt: 0,
};

let sessionGeneration = 0;

/** Increments whenever credentials are replaced or cleared. */
export function getSessionGeneration(): number {
  return sessionGeneration;
}

// The web target is only a development preview. Secrets stay in memory there
// and are never written to browser storage.
const webSecretStore = new Map<string, string>();

async function writeSecret(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    webSecretStore.set(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function readSecret(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return webSecretStore.get(key) ?? null;
  }
  return SecureStore.getItemAsync(key);
}

async function deleteSecret(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    webSecretStore.delete(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

/** Shared with the pending check-in record, which must also stay encrypted. */
export { readSecret, writeSecret, deleteSecret };

const sessionExpiredListeners = new Set<(reason: string) => void>();

export function subscribeToSessionExpired(listener: (reason: string) => void): () => void {
  sessionExpiredListeners.add(listener);
  return () => {
    sessionExpiredListeners.delete(listener);
  };
}

export function notifySessionExpired(reason: string): void {
  for (const listener of sessionExpiredListeners) listener(reason);
}

export function setAccessToken(accessToken: string, accessTokenExpiresAt: string): void {
  state.accessToken = accessToken;
  const parsed = Date.parse(accessTokenExpiresAt);
  state.accessExpiresAt = Number.isNaN(parsed) ? 0 : parsed;
}

export function getAccessToken(): string | null {
  return state.accessToken;
}

export function accessTokenExpiresSoon(skewMs = 60_000): boolean {
  if (!state.accessToken) return true;
  if (state.accessExpiresAt === 0) return false;
  return state.accessExpiresAt - Date.now() <= skewMs;
}

export function clearAccessToken(): void {
  state.accessToken = null;
  state.accessExpiresAt = 0;
}

export async function storeRefreshToken(refreshToken: string): Promise<void> {
  await writeSecret(REFRESH_TOKEN_KEY, refreshToken);
}

export function readRefreshToken(): Promise<string | null> {
  return readSecret(REFRESH_TOKEN_KEY);
}

export async function applyAuthSession(payload: AuthSessionPayload): Promise<void> {
  await storeRefreshToken(payload.refreshToken);
  sessionGeneration += 1;
  setAccessToken(payload.accessToken, payload.accessTokenExpiresAt);
}

export async function clearCredentials(): Promise<void> {
  sessionGeneration += 1;
  clearAccessToken();
  try {
    await deleteSecret(REFRESH_TOKEN_KEY);
  } catch {
    // A missing or inaccessible keychain entry is already a signed-out state.
  }
}

/** Per-organization agent keys never leave secure storage except in memory. */
export function agentSecretKey(organizationId: string, userId: string): string {
  return `temponest.agentKey.${organizationId}.${userId}`;
}

export function readAgentKey(organizationId: string, userId: string): Promise<string | null> {
  return readSecret(agentSecretKey(organizationId, userId));
}

export function storeAgentKey(
  organizationId: string,
  userId: string,
  agentKey: string,
): Promise<void> {
  return writeSecret(agentSecretKey(organizationId, userId), agentKey);
}

export function deleteAgentKey(organizationId: string, userId: string): Promise<void> {
  return deleteSecret(agentSecretKey(organizationId, userId));
}
