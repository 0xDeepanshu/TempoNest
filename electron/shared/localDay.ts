/**
 * The tracker defines "today" in the device's local timezone, matching the
 * existing timer convention. The Electron main process and the renderer both
 * use these bounds so the backend query and the displayed totals agree.
 */
export interface LocalDayBounds {
  /** Inclusive local start of the day, in epoch milliseconds. */
  start: number
  /** Exclusive local start of the next day, in epoch milliseconds. */
  end: number
}

export function localDayBounds(now: number): LocalDayBounds {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { start: start.getTime(), end: end.getTime() }
}
