import { BRANDING } from '@shared/branding'
import { readStoredJson, writeStoredJson } from '@/lib/storage'
import {
  createIdleTimerState,
  getOpenBreak,
  MAX_COMPLETED_SESSIONS
} from '@/tracking/timerMachine'
import type { AuthSession } from '@/types/auth'
import type { BreakInterval, TimerState, WorkSession } from '@/types/tracking'

const OWNED_KEY = BRANDING.storageKeys.timerStateByOwner
const OWNER_STORE_VERSION = 3

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function normalizeBreak(
  value: unknown,
  sessionStartedAt: number,
  sessionEndedAt: number | null
): BreakInterval | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !isTimestamp(value.startedAt)) {
    return null
  }

  if (value.startedAt < sessionStartedAt) return null
  if (sessionEndedAt !== null && value.startedAt > sessionEndedAt) return null

  let endedAt: number | null = null
  if (isTimestamp(value.endedAt)) {
    endedAt = Math.max(value.startedAt, value.endedAt)
    if (sessionEndedAt !== null) {
      endedAt = Math.min(endedAt, sessionEndedAt)
    }
  }

  return {
    id: value.id,
    startedAt: value.startedAt,
    endedAt
  }
}

function normalizeBreaks(
  value: unknown,
  sessionStartedAt: number,
  sessionEndedAt: number | null
): BreakInterval[] {
  if (!Array.isArray(value)) return []

  return value
    .map((candidate) => normalizeBreak(candidate, sessionStartedAt, sessionEndedAt))
    .filter((interval): interval is BreakInterval => interval !== null)
    .sort((left, right) => left.startedAt - right.startedAt)
}

function normalizeCompletedSession(value: unknown): WorkSession | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !isTimestamp(value.startedAt) ||
    !isTimestamp(value.endedAt) ||
    value.endedAt < value.startedAt
  ) {
    return null
  }

  const endedAt = value.endedAt
  const breaks = normalizeBreaks(value.breaks, value.startedAt, endedAt).map((interval) =>
    interval.endedAt === null ? { ...interval, endedAt } : interval
  )

  return {
    id: value.id,
    startedAt: value.startedAt,
    endedAt,
    breaks
  }
}

function normalizeActiveSession(value: unknown): WorkSession | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !isTimestamp(value.startedAt) ||
    value.endedAt !== null
  ) {
    return null
  }

  return {
    id: value.id,
    startedAt: value.startedAt,
    endedAt: null,
    breaks: normalizeBreaks(value.breaks, value.startedAt, null)
  }
}

function normalizeCompletedSessions(value: unknown): WorkSession[] {
  if (!Array.isArray(value)) return []

  return value
    .map(normalizeCompletedSession)
    .filter((session): session is WorkSession => session !== null)
    .sort((left, right) => (right.endedAt ?? 0) - (left.endedAt ?? 0))
    .slice(0, MAX_COMPLETED_SESSIONS)
}

function normalizeCurrentState(value: unknown): TimerState | null {
  if (!isRecord(value) || value.version !== 2) return null

  const completedSessions = normalizeCompletedSessions(value.completedSessions)
  const activeSession =
    value.activeSession === null ? null : normalizeActiveSession(value.activeSession)

  if (activeSession) {
    return {
      version: 2,
      status: getOpenBreak(activeSession) ? 'on_break' : 'working',
      activeSession,
      completedSessions
    }
  }

  return {
    version: 2,
    status: 'idle',
    activeSession: null,
    completedSessions
  }
}

/**
 * Cache entries are keyed by authenticated organization and employee. The
 * legacy unscoped cache is intentionally not adopted: it cannot be attributed
 * to an owner, and the authoritative backend day is loaded on every launch.
 */
export function timerOwnerKey(session: AuthSession | null): string | null {
  if (!session) return null
  return `${session.membership.organization.id}:${session.employee.id}`
}

function readOwners(): Record<string, TimerState> {
  const stored = readStoredJson<unknown>(OWNED_KEY)
  if (!isRecord(stored) || stored.version !== OWNER_STORE_VERSION) return {}
  if (!isRecord(stored.owners)) return {}

  const owners: Record<string, TimerState> = {}
  for (const [ownerKey, value] of Object.entries(stored.owners)) {
    const state = normalizeCurrentState(value)
    if (state) owners[ownerKey] = state
  }
  return owners
}

export function loadTimerState(ownerKey: string | null): TimerState {
  if (!ownerKey) return createIdleTimerState()
  return readOwners()[ownerKey] ?? createIdleTimerState()
}

export function saveTimerState(ownerKey: string | null, state: TimerState): void {
  if (!ownerKey) return
  const owners = readOwners()
  owners[ownerKey] = state
  writeStoredJson(OWNED_KEY, {
    version: OWNER_STORE_VERSION,
    owners
  })
}
