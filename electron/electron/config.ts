import { app } from 'electron'
import { join } from 'node:path'

const DEFAULT_API_BASE_URL = 'http://localhost:4000/api/v1'
const API_PREFIX = '/api/v1'

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

export function getApiBaseUrl(): string {
  return trimTrailingSlash(process.env.TEMPO_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL)
}

/**
 * Derive the agent socket URL from the API base unless an explicit override is
 * supplied. Keeping both values in main-process configuration means the
 * renderer never needs to know either URL.
 */
export function getWebSocketUrl(): string {
  const explicit = process.env.TEMPO_WS_URL?.trim()
  if (explicit) return explicit

  const url = new URL(getApiBaseUrl())
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  const path = url.pathname.replace(/\/+$/, '')
  url.pathname = path.endsWith(API_PREFIX)
    ? `${path}/ws/agent`
    : `${path}${API_PREFIX}/ws/agent`
  url.search = ''
  url.hash = ''
  return url.toString()
}

export const REQUEST_TIMEOUT_MS = 12_000
export const HEARTBEAT_FALLBACK_MS = 60_000
export const MAX_SYNC_BATCH = 200

export function getUserDataPath(...parts: string[]): string {
  return join(app.getPath('userData'), ...parts)
}
