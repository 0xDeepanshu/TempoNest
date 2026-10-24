import { beforeEach, describe, expect, it } from 'vitest'
import { BRANDING } from '@shared/branding'
import { loadTimerState, saveTimerState, timerOwnerKey } from '../src/tracking/timerStorage'
import type { AuthSession } from '../src/types/auth'
import type { TimerState, WorkSession } from '../src/types/tracking'

class MemoryStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

const storage = new MemoryStorage()

function installWindow(): void {
  ;(globalThis as unknown as { window: { localStorage: MemoryStorage } }).window = {
    localStorage: storage
  }
}

function sessionFor(employeeId: string, organizationId: string): AuthSession {
  return {
    employee: {
      id: employeeId,
      organizationId,
      name: employeeId,
      email: `${employeeId}@example.com`,
      initials: 'ID',
      jobTitle: '',
      team: ''
    },
    membership: {
      employeeId,
      organization: { id: organizationId, name: organizationId, slug: organizationId },
      role: 'employee'
    },
    authenticatedAt: '2026-10-24T09:00:00.000Z'
  }
}

const completed: WorkSession = {
  id: 'session-a',
  startedAt: 1_000,
  endedAt: 1_001,
  breaks: []
}

function stateWith(session: WorkSession): TimerState {
  return {
    version: 2,
    status: 'idle',
    activeSession: null,
    completedSessions: [session]
  }
}

beforeEach(() => {
  storage.removeItem(BRANDING.storageKeys.timerStateByOwner)
  storage.removeItem(BRANDING.storageKeys.timerState)
  installWindow()
})

describe('timer storage ownership', () => {
  it('keeps cached totals isolated per employee and organization', () => {
    const ownOrg = timerOwnerKey(sessionFor('user-1', 'org-1'))
    const otherEmployee = timerOwnerKey(sessionFor('user-2', 'org-1'))
    const otherOrg = timerOwnerKey(sessionFor('user-1', 'org-2'))
    expect(ownOrg).not.toBeNull()
    expect(otherEmployee).not.toBeNull()
    expect(otherOrg).not.toBeNull()

    saveTimerState(ownOrg, stateWith(completed))
    saveTimerState(otherEmployee, stateWith({ ...completed, id: 'session-b' }))
    saveTimerState(otherOrg, stateWith({ ...completed, id: 'session-c' }))

    expect(loadTimerState(ownOrg).completedSessions.map((session) => session.id)).toEqual([
      'session-a'
    ])
    expect(loadTimerState(otherEmployee).completedSessions.map((session) => session.id)).toEqual([
      'session-b'
    ])
    expect(loadTimerState(otherOrg).completedSessions.map((session) => session.id)).toEqual([
      'session-c'
    ])
  })

  it('returns idle state for an unauthenticated owner without touching stored data', () => {
    const owner = timerOwnerKey(sessionFor('user-1', 'org-1'))
    saveTimerState(owner, stateWith(completed))

    expect(loadTimerState(null).completedSessions).toEqual([])
    saveTimerState(null, stateWith({ ...completed, id: 'anonymous' }))
    expect(loadTimerState(owner).completedSessions.map((session) => session.id)).toEqual([
      'session-a'
    ])
  })

  it('does not attribute the unscoped legacy cache to an authenticated owner', () => {
    storage.setItem(
      BRANDING.storageKeys.timerState,
      JSON.stringify({
        version: 2,
        status: 'idle',
        activeSession: null,
        completedSessions: [completed]
      })
    )

    const owner = timerOwnerKey(sessionFor('user-1', 'org-1'))
    expect(loadTimerState(owner).completedSessions).toEqual([])
  })
})
