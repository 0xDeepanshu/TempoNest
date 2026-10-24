import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { authService, trackingService } from '@/services'
import { getOpenBreak, getTodayTotals, ongoingBreakMs, timerReducer, workElapsedMs } from '@/tracking/timerMachine'
import { loadTimerState, saveTimerState, timerOwnerKey } from '@/tracking/timerStorage'
import { toWorkSession } from '@/tracking/serverMapping'
import type { AuthSession } from '@/types/auth'
import type {
  TrackingConnectionState,
  TrackingOperationResult,
  TrackingRuntimeStatus,
  TrackingSnapshot
} from '@/types/electron'
import type {
  TimerState,
  TodayTotals,
  TotalsLoadState,
  TrackingStatus,
  WorkSession
} from '@/types/tracking'

interface TimerContextValue {
  /** False until the launch snapshot has been reconciled with the backend. */
  ready: boolean
  status: TrackingStatus
  activeSessionStartedAt: number | null
  activeBreakStartedAt: number | null
  workElapsedMs: number
  breakElapsedMs: number
  todayTotals: TodayTotals
  totalsState: TotalsLoadState
  totalsError: string | null
  connection: TrackingConnectionState
  syncMessage: string | null
  pendingEvents: number
  startWork: () => void
  stopWork: () => void
  startBreak: () => void
  resumeWork: () => void
  retryTotals: () => void
}

const TimerContext = createContext<TimerContextValue | null>(null)

const INITIAL_RUNTIME_STATUS: TrackingRuntimeStatus = {
  connection: 'unknown',
  message: null,
  pendingEvents: 0,
  serverTime: null
}

function createUuid(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()

  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20
  )}-${hex.slice(20)}`
}

export function TimerProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(timerReducer, null, () => loadTimerState(null))
  const [now, setNow] = useState(() => Date.now())
  const [runtime, setRuntime] = useState<TrackingRuntimeStatus>(INITIAL_RUNTIME_STATUS)
  const [ready, setReady] = useState(false)
  const [totalsState, setTotalsState] = useState<TotalsLoadState>('loading')
  const [totalsError, setTotalsError] = useState<string | null>(null)
  const ownerKey = useRef<string | null>(null)
  const operationSequence = useRef(0)
  const isActive = state.status !== 'idle'

  const applySnapshot = useCallback((snapshot: TrackingSnapshot | null) => {
    const todaySessions = snapshot?.todaySessions
      ? snapshot.todaySessions
          .map(toWorkSession)
          .filter((session): session is WorkSession => session !== null)
      : null

    if (todaySessions) {
      // The list was fetched after `/current`, so it is the newest authority for
      // both the active session and today's completed intervals.
      dispatch({ type: 'server_day', sessions: todaySessions, now: Date.now() })
      return
    }

    if (!snapshot?.session) {
      // A durable stop that the server has not confirmed yet still closes the
      // cached session locally so the displayed totals keep the worked minutes.
      const stoppedAt = snapshot?.pendingStopAt ? Date.parse(snapshot.pendingStopAt) : NaN
      if (Number.isFinite(stoppedAt)) {
        dispatch({ type: 'stop', now: stoppedAt })
      } else {
        dispatch({ type: 'hydrate', activeSession: null, status: 'idle' })
      }
      return
    }

    const session = toWorkSession(snapshot.session)
    if (!session) {
      dispatch({ type: 'hydrate', activeSession: null, status: 'idle' })
      return
    }
    if (session.endedAt !== null) {
      dispatch({ type: 'server_session', session })
      return
    }
    dispatch({ type: 'hydrate', activeSession: session, status: snapshot.status })
  }, [])

  const applyResult = useCallback(
    (result: TrackingOperationResult) => {
      // A queued mutation has no fresh server snapshot. Keep the renderer's
      // optimistic timestamp state until reconnect sync becomes authoritative.
      if (!result.queued) applySnapshot(result.snapshot)
      if (result.completedSession) {
        const completed = toWorkSession(result.completedSession)
        if (completed?.endedAt !== null && completed?.endedAt !== undefined) {
          dispatch({ type: 'server_session', session: completed })
        }
      }
      if (result.error) {
        setRuntime((current) => ({ ...current, message: result.error?.message ?? null }))
      }
    },
    [applySnapshot]
  )

  const refreshFromServer = useCallback(async () => {
    try {
      const snapshot = await trackingService.refreshCurrent()
      if (!snapshot) {
        setTotalsState('error')
        setTotalsError("Today's totals could not be loaded. Check the connection and retry.")
        return
      }
      applySnapshot(snapshot)
      if (snapshot.todaySessions) {
        setTotalsState('ready')
        setTotalsError(null)
      } else {
        setTotalsState('error')
        setTotalsError(
          snapshot.totalsError?.message ??
            "Today's totals could not be loaded. Check the connection and retry."
        )
      }
    } catch {
      setTotalsState('error')
      setTotalsError("Today's totals could not be loaded. Check the connection and retry.")
    }
  }, [applySnapshot])

  const retryTotals = useCallback(() => {
    setTotalsState('loading')
    setTotalsError(null)
    void refreshFromServer()
  }, [refreshFromServer])

  const runAction = useCallback(
    (operation: () => Promise<TrackingOperationResult>) => {
      const sequence = ++operationSequence.current
      void operation()
        .then((result) => {
          if (sequence !== operationSequence.current) return
          applyResult(result)
        })
        .catch((cause: unknown) => {
          if (sequence !== operationSequence.current) return
          setRuntime((current) => ({
            ...current,
            message:
              cause instanceof Error
                ? cause.message
                : 'The timer change could not be completed.'
          }))
          void refreshFromServer()
        })
    },
    [applyResult, refreshFromServer]
  )

  // Exactly one ticker while a session exists. Elapsed values still come from
  // timestamps, so suspended intervals, sleep, and throttling cannot drift.
  useEffect(() => {
    if (!isActive) return

    setNow(Date.now())
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [isActive])

  useEffect(() => {
    saveTimerState(ownerKey.current, state)
  }, [state])

  useEffect(() => {
    const persist = () => saveTimerState(ownerKey.current, state)
    window.addEventListener('beforeunload', persist)
    return () => window.removeEventListener('beforeunload', persist)
  }, [state])

  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) setNow(Date.now())
    }

    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])

  // The renderer's timer is a display cache. Reconcile it with the main-process
  // authority on launch, after sign-in, and whenever the server publishes state.
  useEffect(() => {
    let active = true
    let sequence = 0
    let startedOwner: string | null = null

    const reconcile = (sessionOwner: string) => {
      const current = ++sequence
      setReady(false)
      void trackingService
        .restore()
        .then((snapshot) => {
          if (!active || current !== sequence || ownerKey.current !== sessionOwner) return
          if (snapshot) applySnapshot(snapshot)
          if (snapshot?.todaySessions) {
            setTotalsState('ready')
            setTotalsError(null)
          } else {
            setTotalsState('error')
            setTotalsError(
              snapshot?.totalsError?.message ??
                "Today's totals could not be loaded. Check the connection and retry."
            )
          }
          setReady(true)
        })
        .catch(() => {
          if (!active || current !== sequence || ownerKey.current !== sessionOwner) return
          setTotalsState('error')
          setTotalsError("Today's totals could not be loaded. Check the connection and retry.")
          setReady(true)
        })
    }

    const beginSession = (session: AuthSession) => {
      const nextOwner = timerOwnerKey(session)
      if (!nextOwner || startedOwner === nextOwner) return
      startedOwner = nextOwner
      if (ownerKey.current !== nextOwner) {
        ownerKey.current = nextOwner
        dispatch({ type: 'load_cached', state: loadTimerState(nextOwner) })
      }
      setTotalsState('loading')
      setTotalsError(null)
      reconcile(nextOwner)
    }

    const endSession = () => {
      startedOwner = null
      ownerKey.current = null
      sequence += 1
      operationSequence.current += 1
      setRuntime(INITIAL_RUNTIME_STATUS)
      setTotalsState('loading')
      setTotalsError(null)
      setReady(true)
      dispatch({ type: 'reset' })
    }

    const unsubscribeState = trackingService.onStateChanged((snapshot) => {
      if (!active) return
      applySnapshot(snapshot)
      if (snapshot.todaySessions) {
        setTotalsState('ready')
        setTotalsError(null)
      } else if (snapshot.totalsError) {
        setTotalsState('error')
        setTotalsError(snapshot.totalsError.message)
      }
    })
    const unsubscribeStatus = trackingService.onStatusChanged((status) => {
      if (active) setRuntime(status)
    })
    const unsubscribeAuth = authService.onSessionChanged?.((session) => {
      if (!active) return
      if (!session) {
        endSession()
        return
      }
      beginSession(session)
    })

    // A renderer reload can reuse a main-process session without emitting a
    // session-change event. Restoring here is single-flighted in the main
    // process and only establishes the owner key and first reconciliation.
    void authService
      .restoreSession()
      .then((restored) => {
        if (active && restored) beginSession(restored)
      })
      .catch(() => undefined)

    void trackingService
      .getStatus()
      .then((status) => {
        if (active) setRuntime(status)
      })
      .catch(() => undefined)

    return () => {
      active = false
      unsubscribeState()
      unsubscribeStatus()
      unsubscribeAuth?.()
    }
  }, [applySnapshot])

  const startWork = useCallback(() => {
    const startedAt = Date.now()
    const sessionId = createUuid()
    setNow(startedAt)
    dispatch({ type: 'start', now: startedAt, sessionId })
    runAction(() => trackingService.start(sessionId, new Date(startedAt).toISOString()))
  }, [runAction])

  const stopWork = useCallback(() => {
    const sessionId = state.activeSession?.id
    if (!sessionId) return

    const stoppedAt = Date.now()
    setNow(stoppedAt)
    dispatch({ type: 'stop', now: stoppedAt })
    runAction(() => trackingService.stop(sessionId, new Date(stoppedAt).toISOString()))
  }, [runAction, state.activeSession?.id])

  const startBreak = useCallback(() => {
    const sessionId = state.activeSession?.id
    if (!sessionId) return

    const startedAt = Date.now()
    const breakId = createUuid()
    setNow(startedAt)
    dispatch({ type: 'start_break', now: startedAt, breakId })
    runAction(() =>
      trackingService.startBreak(sessionId, breakId, new Date(startedAt).toISOString())
    )
  }, [runAction, state.activeSession?.id])

  const resumeWork = useCallback(() => {
    const sessionId = state.activeSession?.id
    const openBreak = getOpenBreak(state.activeSession)
    if (!sessionId || !openBreak) return

    const resumedAt = Date.now()
    setNow(resumedAt)
    dispatch({ type: 'resume', now: resumedAt })
    runAction(() =>
      trackingService.endBreak(sessionId, openBreak.id, new Date(resumedAt).toISOString())
    )
  }, [runAction, state.activeSession])

  const value = useMemo<TimerContextValue>(() => {
    const activeSession = state.activeSession
    const openBreak = getOpenBreak(activeSession)

    return {
      ready,
      status: state.status,
      activeSessionStartedAt: activeSession?.startedAt ?? null,
      activeBreakStartedAt: openBreak?.startedAt ?? null,
      workElapsedMs: activeSession ? workElapsedMs(activeSession, now) : 0,
      breakElapsedMs: ongoingBreakMs(activeSession, now),
      todayTotals: getTodayTotals(state, now),
      totalsState,
      totalsError,
      connection: runtime.connection,
      syncMessage: runtime.message,
      pendingEvents: runtime.pendingEvents,
      startWork,
      stopWork,
      startBreak,
      resumeWork,
      retryTotals
    }
  }, [
    now,
    ready,
    resumeWork,
    retryTotals,
    runtime,
    startBreak,
    startWork,
    state,
    stopWork,
    totalsError,
    totalsState
  ])

  return <TimerContext.Provider value={value}>{children}</TimerContext.Provider>
}

export function useTimer(): TimerContextValue {
  const context = useContext(TimerContext)
  if (!context) {
    throw new Error('useTimer must be used inside a TimerProvider')
  }

  return context
}

export type { TimerState }
