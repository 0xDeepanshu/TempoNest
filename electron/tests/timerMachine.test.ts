import { describe, expect, it } from 'vitest'
import {
  createIdleTimerState,
  getOpenBreak,
  getTodayTotals,
  timerReducer
} from '../src/tracking/timerMachine'
import type { WorkSession } from '../src/types/tracking'

describe('timerReducer', () => {
  it('guards duplicate starts and breaks', () => {
    const started = timerReducer(createIdleTimerState(), {
      type: 'start',
      now: 1_000,
      sessionId: 'session-1'
    })
    expect(started.status).toBe('working')

    const duplicateStart = timerReducer(started, {
      type: 'start',
      now: 2_000,
      sessionId: 'session-2'
    })
    expect(duplicateStart).toBe(started)

    const onBreak = timerReducer(started, {
      type: 'start_break',
      now: 3_000,
      breakId: 'break-1'
    })
    expect(onBreak.status).toBe('on_break')
    expect(timerReducer(onBreak, { type: 'start_break', now: 4_000, breakId: 'break-2' })).toBe(
      onBreak
    )

    const resumed = timerReducer(onBreak, { type: 'resume', now: 8_000 })
    expect(resumed.status).toBe('working')
    expect(getOpenBreak(resumed.activeSession)).toBeNull()
  })

  it('hydrates an authoritative active session and preserves completed history', () => {
    const completed: WorkSession = {
      id: 'completed-1',
      startedAt: 1_000,
      endedAt: 2_000,
      breaks: []
    }
    const state = {
      ...createIdleTimerState(),
      completedSessions: [completed]
    }

    const hydrated = timerReducer(state, {
      type: 'hydrate',
      status: 'on_break',
      activeSession: {
        id: 'server-session',
        startedAt: 5_000,
        endedAt: null,
        breaks: [{ id: 'server-break', startedAt: 6_000, endedAt: null }]
      }
    })

    expect(hydrated.status).toBe('on_break')
    expect(hydrated.activeSession?.id).toBe('server-session')
    expect(hydrated.completedSessions).toEqual([completed])

    const idle = timerReducer(hydrated, {
      type: 'hydrate',
      status: 'idle',
      activeSession: null
    })
    expect(idle.status).toBe('idle')
    expect(idle.activeSession).toBeNull()
    expect(idle.completedSessions).toEqual([completed])
  })

  it('uses the server end timestamp for the completed session', () => {
    const working = timerReducer(createIdleTimerState(), {
      type: 'start',
      now: 1_000,
      sessionId: 'server-session'
    })
    const localStop = timerReducer(working, { type: 'stop', now: 9_000 })
    expect(localStop.completedSessions[0].endedAt).toBe(9_000)

    const reconciled = timerReducer(localStop, {
      type: 'server_session',
      session: {
        id: 'server-session',
        startedAt: 1_500,
        endedAt: 8_500,
        breaks: [{ id: 'brk', startedAt: 3_000, endedAt: 4_000 }]
      }
    })

    expect(reconciled.status).toBe('idle')
    expect(reconciled.completedSessions).toHaveLength(1)
    expect(reconciled.completedSessions[0]).toMatchObject({
      id: 'server-session',
      startedAt: 1_500,
      endedAt: 8_500
    })
  })

  it('excludes break time from today totals', () => {
    const state = timerReducer(createIdleTimerState(), {
      type: 'start',
      now: Date.now() - 60 * 60_000,
      sessionId: 'session'
    })
    const onBreak = timerReducer(state, {
      type: 'start_break',
      now: Date.now() - 30 * 60_000,
      breakId: 'break'
    })
    const now = Date.now()
    const totals = getTodayTotals(onBreak, now)
    expect(totals.workMs).toBeGreaterThanOrEqual(29 * 60_000)
    expect(totals.breakMs).toBeGreaterThanOrEqual(29 * 60_000)
  })
})

const MINUTE = 60_000

function todayAt(hours: number, minutes: number, dayOffset = 0): number {
  const date = new Date()
  date.setDate(date.getDate() + dayOffset)
  date.setHours(hours, minutes, 0, 0)
  return date.getTime()
}

describe('getTodayTotals', () => {
  it('keeps a stopped 55-minute session in today totals after a relaunch reconciliation', () => {
    const now = todayAt(18, 0)
    const stopped = {
      id: 'stopped-55',
      startedAt: todayAt(9, 0),
      endedAt: todayAt(9, 0) + 55 * MINUTE,
      breaks: []
    }

    // A relaunch starts from idle/cache, then applies the server day and the
    // idle current state. Neither step may erase the authoritative history.
    const afterServerDay = timerReducer(createIdleTimerState(), {
      type: 'server_day',
      sessions: [stopped],
      now
    })
    const reconciled = timerReducer(afterServerDay, {
      type: 'hydrate',
      activeSession: null,
      status: 'idle'
    })

    expect(getTodayTotals(reconciled, now)).toEqual({
      workMs: 55 * MINUTE,
      breakMs: 0,
      sessionCount: 1
    })
  })

  it('derives work and break durations from the session intervals', () => {
    const now = todayAt(18, 0)
    const session: WorkSession = {
      id: 'interval-session',
      startedAt: todayAt(9, 0),
      endedAt: todayAt(10, 0),
      breaks: [
        { id: 'break-1', startedAt: todayAt(9, 15), endedAt: todayAt(9, 25) },
        { id: 'break-2', startedAt: todayAt(9, 40), endedAt: todayAt(9, 55) }
      ]
    }
    const state = timerReducer(createIdleTimerState(), {
      type: 'server_day',
      sessions: [session],
      now
    })

    expect(getTodayTotals(state, now)).toEqual({
      workMs: 35 * MINUTE,
      breakMs: 25 * MINUTE,
      sessionCount: 1
    })
  })

  it('attributes only the current-day portion of a midnight-crossing session', () => {
    const now = todayAt(12, 0)
    const session: WorkSession = {
      id: 'overnight',
      startedAt: todayAt(23, 30, -1),
      endedAt: todayAt(0, 30),
      breaks: [
        // Entirely before midnight.
        { id: 'before', startedAt: todayAt(23, 45, -1), endedAt: todayAt(23, 50, -1) },
        // After midnight.
        { id: 'after', startedAt: todayAt(0, 10), endedAt: todayAt(0, 20) }
      ]
    }
    const state = timerReducer(createIdleTimerState(), {
      type: 'server_day',
      sessions: [session],
      now
    })

    expect(getTodayTotals(state, now)).toEqual({
      workMs: 20 * MINUTE,
      breakMs: 10 * MINUTE,
      sessionCount: 1
    })
  })

  it('counts an active session without double-counting it as completed', () => {
    const now = todayAt(12, 0)
    const active: WorkSession = {
      id: 'active',
      startedAt: todayAt(10, 0),
      endedAt: null,
      breaks: [{ id: 'open-break', startedAt: todayAt(10, 30), endedAt: todayAt(10, 45) }]
    }
    const state = timerReducer(createIdleTimerState(), {
      type: 'server_day',
      sessions: [active],
      now
    })

    expect(state.activeSession?.id).toBe('active')
    expect(getTodayTotals(state, now)).toEqual({
      workMs: 105 * MINUTE,
      breakMs: 15 * MINUTE,
      sessionCount: 1
    })
  })
})

describe('server day reconciliation', () => {
  it('does not replace today totals with zero when the server list is empty', () => {
    const now = todayAt(18, 0)
    const unsynced: WorkSession = {
      id: 'unsynced',
      startedAt: todayAt(9, 0),
      endedAt: todayAt(9, 55),
      breaks: []
    }
    const cached = timerReducer(createIdleTimerState(), {
      type: 'server_session',
      session: unsynced
    })

    const reconciled = timerReducer(cached, { type: 'server_day', sessions: [], now })

    expect(reconciled.completedSessions.map((session) => session.id)).toEqual(['unsynced'])
    expect(getTodayTotals(reconciled, now)).toEqual({
      workMs: 55 * MINUTE,
      breakMs: 0,
      sessionCount: 1
    })
  })

  it('merges a pending stop once even when reconciliation runs repeatedly', () => {
    const now = todayAt(18, 0)
    const session: WorkSession = {
      id: 'pending-stop',
      startedAt: todayAt(9, 0),
      endedAt: todayAt(9, 55),
      breaks: []
    }
    const cached = timerReducer(createIdleTimerState(), {
      type: 'server_session',
      session
    })

    const once = timerReducer(cached, { type: 'server_day', sessions: [session], now })
    const twice = timerReducer(once, { type: 'server_day', sessions: [session], now })

    expect(twice.completedSessions).toHaveLength(1)
    expect(twice.completedSessions[0].id).toBe('pending-stop')
    expect(getTodayTotals(twice, now)).toEqual({
      workMs: 55 * MINUTE,
      breakMs: 0,
      sessionCount: 1
    })
  })

  it('prefers server timestamps for a session that also exists locally', () => {
    const now = todayAt(18, 0)
    const local: WorkSession = {
      id: 'shared',
      startedAt: todayAt(9, 0),
      endedAt: todayAt(10, 0),
      breaks: []
    }
    const server: WorkSession = {
      ...local,
      endedAt: todayAt(9, 40),
      breaks: [{ id: 'lunch', startedAt: todayAt(9, 10), endedAt: todayAt(9, 20) }]
    }
    const cached = timerReducer(createIdleTimerState(), {
      type: 'server_session',
      session: local
    })

    const reconciled = timerReducer(cached, { type: 'server_day', sessions: [server], now })

    expect(reconciled.completedSessions).toHaveLength(1)
    expect(getTodayTotals(reconciled, now)).toEqual({
      workMs: 30 * MINUTE,
      breakMs: 10 * MINUTE,
      sessionCount: 1
    })
  })
})
