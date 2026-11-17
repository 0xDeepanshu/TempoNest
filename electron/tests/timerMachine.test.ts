import { describe, expect, it } from 'vitest'
import {
  createIdleTimerState,
  getOpenBreak,
  getTodayTotals,
  ongoingBreakMs,
  timerReducer,
  workElapsedMs
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

  it('keeps elapsed time anchored to timestamps through offline gaps and device sleep', () => {
    const started = 1_000_000
    const working = timerReducer(createIdleTimerState(), {
      type: 'start',
      now: started,
      sessionId: 'resilient'
    })

    // No ticks are needed while disconnected: the duration is derived from the
    // persisted start timestamp on every render.
    expect(workElapsedMs(working.activeSession!, started + 30 * MINUTE)).toBe(30 * MINUTE)

    // Suspend/resume or a clock jump of several hours must not drift or reset.
    expect(workElapsedMs(working.activeSession!, started + 8 * 60 * MINUTE)).toBe(
      8 * 60 * MINUTE
    )

    const breakAt = started + 60 * MINUTE
    const onBreak = timerReducer(working, { type: 'start_break', now: breakAt, breakId: 'break' })
    const afterSleep = started + 6 * 60 * MINUTE
    expect(ongoingBreakMs(onBreak.activeSession, afterSleep)).toBe(5 * 60 * MINUTE)
    expect(workElapsedMs(onBreak.activeSession!, afterSleep)).toBe(60 * MINUTE)

    const resumed = timerReducer(onBreak, { type: 'resume', now: afterSleep })
    expect(workElapsedMs(resumed.activeSession!, afterSleep)).toBe(60 * MINUTE)

    const stopped = timerReducer(resumed, { type: 'stop', now: afterSleep + 30 * MINUTE })
    expect(stopped.completedSessions[0].endedAt).toBe(afterSleep + 30 * MINUTE)
    expect(stopped.completedSessions[0].breaks[0]).toMatchObject({
      startedAt: breakAt,
      endedAt: afterSleep
    })
    expect(timerReducer(stopped, { type: 'stop', now: afterSleep + 60 * MINUTE })).toBe(stopped)
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

describe('timer lifecycle regressions', () => {
  it('Start → Stop → Start keeps counting instead of staying at zero', () => {
    let state = timerReducer(createIdleTimerState(), {
      type: 'start',
      now: 1_000,
      sessionId: 'session-1'
    })
    state = timerReducer(state, { type: 'stop', now: 61_000 })
    expect(state.status).toBe('idle')
    expect(state.completedSessions).toHaveLength(1)

    state = timerReducer(state, {
      type: 'start',
      now: 62_000,
      sessionId: 'session-2'
    })

    expect(state.status).toBe('working')
    expect(state.activeSession?.id).toBe('session-2')
    expect(state.completedSessions.map((session) => session.id)).toEqual(['session-1'])
    // A second after the new Start the display must advance, not stay at zero.
    expect(workElapsedMs(state.activeSession!, 63_000)).toBe(1_000)
    expect(workElapsedMs(state.activeSession!, 92_000)).toBe(30_000)
  })

  it('Start → Break → Resume → Stop preserves the interval history', () => {
    let state = timerReducer(createIdleTimerState(), {
      type: 'start',
      now: 1_000,
      sessionId: 'session'
    })
    state = timerReducer(state, { type: 'start_break', now: 31_000, breakId: 'break' })
    expect(ongoingBreakMs(state.activeSession, 51_000)).toBe(20_000)

    state = timerReducer(state, { type: 'resume', now: 51_000 })
    expect(state.status).toBe('working')
    expect(getOpenBreak(state.activeSession)).toBeNull()

    state = timerReducer(state, { type: 'stop', now: 91_000 })
    expect(state.status).toBe('idle')
    expect(state.completedSessions[0]).toMatchObject({
      id: 'session',
      startedAt: 1_000,
      endedAt: 91_000,
      breaks: [{ id: 'break', startedAt: 31_000, endedAt: 51_000 }]
    })
  })

  it('supports several consecutive sessions without losing or duplicating totals', () => {
    const now = todayAt(18, 0)
    let state = createIdleTimerState()
    const ids = ['one', 'two', 'three']

    ids.forEach((id, index) => {
      const startedAt = todayAt(9 + index, 0)
      state = timerReducer(state, { type: 'start', now: startedAt, sessionId: id })
      state = timerReducer(state, { type: 'stop', now: startedAt + 30 * MINUTE })
    })

    expect(state.status).toBe('idle')
    expect(state.completedSessions.map((session) => session.id)).toEqual([
      'three',
      'two',
      'one'
    ])
    expect(getTodayTotals(state, now)).toEqual({
      workMs: 90 * MINUTE,
      breakMs: 0,
      sessionCount: 3
    })
  })

  it('resumes a cached active session after an app restart and derives elapsed time from its timestamp', () => {
    const cached = timerReducer(createIdleTimerState(), {
      type: 'start',
      now: 1_000,
      sessionId: 'before-restart'
    })

    // Reloading the renderer hydrates the persisted state; no tick is needed to
    // reconstruct the elapsed duration.
    const reloaded = timerReducer(createIdleTimerState(), { type: 'load_cached', state: cached })
    expect(reloaded.status).toBe('working')
    expect(reloaded.activeSession?.startedAt).toBe(1_000)
    expect(workElapsedMs(reloaded.activeSession!, 121_000)).toBe(120_000)

    const stopped = timerReducer(reloaded, { type: 'stop', now: 121_000 })
    expect(stopped.completedSessions[0].endedAt).toBe(121_000)
  })

  it('does not let a delayed completion for an older session clear a newer active session', () => {
    let state = timerReducer(createIdleTimerState(), {
      type: 'start',
      now: 1_000,
      sessionId: 'older'
    })
    state = timerReducer(state, { type: 'stop', now: 2_000 })
    state = timerReducer(state, {
      type: 'start',
      now: 3_000,
      sessionId: 'newer'
    })

    const afterLateEvent = timerReducer(state, {
      type: 'server_session',
      session: { id: 'older', startedAt: 1_000, endedAt: 2_000, breaks: [] }
    })

    expect(afterLateEvent.activeSession?.id).toBe('newer')
    expect(afterLateEvent.status).toBe('working')
    expect(afterLateEvent.completedSessions.map((session) => session.id)).toEqual(['older'])
  })

  it('still closes the active session when the completion matches its own ID', () => {
    let state = timerReducer(createIdleTimerState(), {
      type: 'start',
      now: 1_000,
      sessionId: 'session'
    })
    state = timerReducer(state, {
      type: 'server_session',
      session: { id: 'session', startedAt: 1_000, endedAt: 8_000, breaks: [] }
    })

    expect(state.status).toBe('idle')
    expect(state.activeSession).toBeNull()
    expect(state.completedSessions).toHaveLength(1)
  })

  it('replaces an optimistic client ID with the server ID instead of double counting', () => {
    const now = todayAt(18, 0)
    let state = timerReducer(createIdleTimerState(), {
      type: 'start',
      now: todayAt(9, 0),
      sessionId: 'local-optimistic'
    })
    state = timerReducer(state, { type: 'stop', now: todayAt(9, 30) })
    expect(getTodayTotals(state, now).sessionCount).toBe(1)

    state = timerReducer(state, {
      type: 'server_session',
      session: {
        id: 'server-authoritative',
        startedAt: todayAt(9, 0),
        endedAt: todayAt(9, 30),
        breaks: []
      },
      replacesSessionId: 'local-optimistic'
    })

    expect(state.completedSessions.map((session) => session.id)).toEqual([
      'server-authoritative'
    ])
    expect(getTodayTotals(state, now)).toEqual({
      workMs: 30 * MINUTE,
      breakMs: 0,
      sessionCount: 1
    })
  })

  it('counts an active session that starts exactly at the displayed server now', () => {
    const now = todayAt(12, 0)
    const state = timerReducer(createIdleTimerState(), {
      type: 'start',
      now,
      sessionId: 'just-started'
    })

    expect(getTodayTotals(state, now).sessionCount).toBe(1)
  })
})
