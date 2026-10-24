import { localDayBounds } from '@shared/localDay'
import type {
  BreakInterval,
  TimerState,
  TodayTotals,
  TrackingStatus,
  WorkSession
} from '@/types/tracking'

export const MAX_COMPLETED_SESSIONS = 100

export function createIdleTimerState(): TimerState {
  return {
    version: 2,
    status: 'idle',
    activeSession: null,
    completedSessions: []
  }
}

function safeNow(now: number): number {
  return Number.isFinite(now) ? Math.max(0, now) : Date.now()
}

export function getOpenBreak(session: WorkSession | null): BreakInterval | null {
  if (!session) return null

  for (let index = session.breaks.length - 1; index >= 0; index -= 1) {
    if (session.breaks[index].endedAt === null) {
      return session.breaks[index]
    }
  }

  return null
}

function breakDuration(interval: BreakInterval, now: number): number {
  const end = Math.max(interval.startedAt, interval.endedAt ?? now)
  return Math.max(0, end - interval.startedAt)
}

export function totalBreakMs(session: WorkSession, now: number): number {
  return session.breaks.reduce((total, interval) => total + breakDuration(interval, now), 0)
}

export function workElapsedMs(session: WorkSession, now: number): number {
  const end = Math.max(session.startedAt, session.endedAt ?? now)
  return Math.max(0, end - session.startedAt - totalBreakMs(session, now))
}

export function ongoingBreakMs(session: WorkSession | null, now: number): number {
  const openBreak = getOpenBreak(session)
  return openBreak ? breakDuration(openBreak, now) : 0
}

function overlapMs(start: number, end: number, rangeStart: number, rangeEnd: number): number {
  return Math.max(0, Math.min(end, rangeEnd) - Math.max(start, rangeStart))
}

function sessionWorkInRange(session: WorkSession, rangeStart: number, rangeEnd: number): number {
  const sessionEnd = Math.min(session.endedAt ?? rangeEnd, rangeEnd)
  if (sessionEnd <= rangeStart) return 0

  const elapsed = overlapMs(session.startedAt, sessionEnd, rangeStart, rangeEnd)
  const breaks = session.breaks.reduce(
    (total, interval) =>
      total +
      overlapMs(interval.startedAt, interval.endedAt ?? rangeEnd, rangeStart, rangeEnd),
    0
  )

  return Math.max(0, elapsed - breaks)
}

function sessionBreaksInRange(session: WorkSession, rangeStart: number, rangeEnd: number): number {
  return session.breaks.reduce(
    (total, interval) =>
      total +
      overlapMs(interval.startedAt, interval.endedAt ?? rangeEnd, rangeStart, rangeEnd),
    0
  )
}

export function getTodayTotals(state: TimerState, now: number): TodayTotals {
  const { start: todayStartedAt } = localDayBounds(now)
  const completedToday = state.completedSessions.filter(
    (session) => session.endedAt !== null && session.endedAt > todayStartedAt
  )

  let workMs = 0
  let breakMs = 0

  for (const session of completedToday) {
    workMs += sessionWorkInRange(session, todayStartedAt, now)
    breakMs += sessionBreaksInRange(session, todayStartedAt, now)
  }

  const activeStartedToday = state.activeSession !== null && state.activeSession.startedAt < now
  if (state.activeSession) {
    workMs += sessionWorkInRange(state.activeSession, todayStartedAt, now)
    breakMs += sessionBreaksInRange(state.activeSession, todayStartedAt, now)
  }

  return {
    workMs,
    breakMs,
    sessionCount: completedToday.length + (activeStartedToday ? 1 : 0)
  }
}

export type TimerAction =
  | { type: 'start'; now: number; sessionId: string }
  | { type: 'start_break'; now: number; breakId: string }
  | { type: 'resume'; now: number }
  | { type: 'stop'; now: number }
  | { type: 'hydrate'; activeSession: WorkSession | null; status: TrackingStatus }
  | { type: 'server_session'; session: WorkSession }
  | { type: 'server_day'; sessions: WorkSession[]; now: number }
  | { type: 'load_cached'; state: TimerState }
  | { type: 'reset' }

/**
 * All transitions are guarded here. UI clicks and duplicate events cannot
 * create a second active session or a break outside an active work session.
 */
export function timerReducer(state: TimerState, action: TimerAction): TimerState {
  switch (action.type) {
    case 'hydrate': {
      if (!action.activeSession) {
        if (state.status === 'idle' && state.activeSession === null) return state
        return {
          ...state,
          status: 'idle',
          activeSession: null
        }
      }

      return {
        ...state,
        status: action.activeSession.breaks.some((interval) => interval.endedAt === null)
          ? 'on_break'
          : action.status === 'idle'
            ? 'working'
            : action.status,
        activeSession: {
          ...action.activeSession,
          endedAt: null,
          breaks: [...action.activeSession.breaks].sort(
            (left, right) => left.startedAt - right.startedAt
          )
        }
      }
    }

    case 'server_session': {
      const session = action.session
      if (session.endedAt === null) {
        return timerReducer(state, {
          type: 'hydrate',
          activeSession: session,
          status: getOpenBreak(session) ? 'on_break' : 'working'
        })
      }

      const existingIndex = state.completedSessions.findIndex(
        (completed) => completed.id === session.id
      )
      const completedSessions =
        existingIndex >= 0
          ? state.completedSessions.map((completed) =>
              completed.id === session.id ? session : completed
            )
          : [session, ...state.completedSessions].slice(0, MAX_COMPLETED_SESSIONS)

      return {
        ...state,
        status: 'idle',
        activeSession: null,
        completedSessions
      }
    }

    case 'start': {
      if (state.status !== 'idle' || state.activeSession) return state

      const startedAt = safeNow(action.now)
      return {
        ...state,
        status: 'working',
        activeSession: {
          id: action.sessionId,
          startedAt,
          endedAt: null,
          breaks: []
        }
      }
    }

    case 'start_break': {
      if (state.status !== 'working' || !state.activeSession || getOpenBreak(state.activeSession)) {
        return state
      }

      const interval: BreakInterval = {
        id: action.breakId,
        startedAt: safeNow(action.now),
        endedAt: null
      }

      return {
        ...state,
        status: 'on_break',
        activeSession: {
          ...state.activeSession,
          breaks: [...state.activeSession.breaks, interval]
        }
      }
    }

    case 'resume': {
      if (state.status !== 'on_break' || !state.activeSession) return state

      const openBreak = getOpenBreak(state.activeSession)
      if (!openBreak) return state

      const endedAt = Math.max(openBreak.startedAt, safeNow(action.now))
      return {
        ...state,
        status: 'working',
        activeSession: {
          ...state.activeSession,
          breaks: state.activeSession.breaks.map((interval) =>
            interval.id === openBreak.id ? { ...interval, endedAt } : interval
          )
        }
      }
    }

    case 'load_cached':
      return action.state

    case 'reset':
      return createIdleTimerState()

    case 'server_day': {
      // The backend list is authoritative for sessions overlapping today. It
      // includes the active session and returns its breaks as intervals.
      const byId = new Map(action.sessions.map((session) => [session.id, session]))
      let active: WorkSession | null = null
      for (const session of action.sessions) {
        if (session.endedAt !== null) continue
        if (!active || session.startedAt > active.startedAt) active = session
      }
      if (active) byId.delete(active.id)

      // Keep locally completed sessions that the server did not return. They
      // are either older local history or events still awaiting sync; IDs that
      // the server returned always use the server's timestamps.
      const { start: todayStart } = localDayBounds(action.now)
      const localOnly = state.completedSessions.filter(
        (session) => session.endedAt !== null && !byId.has(session.id) && session.id !== active?.id
      )
      const currentDay = [
        ...byId.values(),
        ...localOnly.filter((session) => (session.endedAt ?? 0) > todayStart)
      ].sort((left, right) => (right.endedAt ?? 0) - (left.endedAt ?? 0))
      const history = localOnly
        .filter((session) => (session.endedAt ?? 0) <= todayStart)
        .sort((left, right) => (right.endedAt ?? 0) - (left.endedAt ?? 0))
        .slice(0, Math.max(0, MAX_COMPLETED_SESSIONS - currentDay.length))
      const completedSessions = [...currentDay, ...history]

      return {
        version: 2,
        status: active ? (getOpenBreak(active) ? 'on_break' : 'working') : 'idle',
        activeSession: active,
        completedSessions
      }
    }

    case 'stop': {
      if (!state.activeSession || state.status === 'idle') return state

      const endedAt = Math.max(state.activeSession.startedAt, safeNow(action.now))
      const completedSession: WorkSession = {
        ...state.activeSession,
        endedAt,
        breaks: state.activeSession.breaks.map((interval) => {
          if (interval.endedAt !== null) return interval
          return {
            ...interval,
            endedAt: Math.max(interval.startedAt, endedAt)
          }
        })
      }

      return {
        version: 2,
        status: 'idle',
        activeSession: null,
        completedSessions: [completedSession, ...state.completedSessions].slice(
          0,
          MAX_COMPLETED_SESSIONS
        )
      }
    }
  }
}

const VALID_STATUSES: TrackingStatus[] = ['idle', 'working', 'on_break']

export function isTrackingStatus(value: unknown): value is TrackingStatus {
  return typeof value === 'string' && VALID_STATUSES.includes(value as TrackingStatus)
}
