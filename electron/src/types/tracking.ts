export type TrackingStatus = 'idle' | 'working' | 'on_break'

export interface BreakInterval {
  id: string
  startedAt: number
  /** `null` while the break is in progress. */
  endedAt: number | null
}

export interface WorkSession {
  id: string
  startedAt: number
  /** `null` while the session is active. */
  endedAt: number | null
  breaks: BreakInterval[]
}

/**
 * Versioned, timestamp-based state. Duration is always derived from these
 * timestamps, so a throttled or restarted renderer cannot drift the timer.
 */
export interface TimerState {
  version: 2
  status: TrackingStatus
  activeSession: WorkSession | null
  completedSessions: WorkSession[]
}

export interface TodayTotals {
  workMs: number
  breakMs: number
  sessionCount: number
}

/** Whether the displayed totals are verified by the backend. */
export type TotalsLoadState = 'loading' | 'ready' | 'error'
