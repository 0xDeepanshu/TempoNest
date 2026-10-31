import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ApplicationActivityPayload, IdleIntervalPayload } from './backendTypes'

/** Bounded so a long offline period cannot grow the local file without limit. */
export const MAX_QUEUED_APP_EVENTS = 2_000
export const MAX_QUEUED_IDLE_INTERVALS = 1_000
const MAX_INTERVAL_MS = 24 * 60 * 60 * 1000

interface QueueFile {
  version: 1
  userId: string | null
  appEvents: ApplicationActivityPayload[]
  idleIntervals: IdleIntervalPayload[]
  droppedAppEvents: number
  droppedIdleIntervals: number
}

function emptyQueue(userId: string | null = null): QueueFile {
  return {
    version: 1,
    userId,
    appEvents: [],
    idleIntervals: [],
    droppedAppEvents: 0,
    droppedIdleIntervals: 0
  }
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function isKey(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 8 && value.length <= 160
}

function isOptionalSessionId(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === 'string' && value.length > 0 && value.length <= 64)
}

function isOptionalPlatform(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === 'string' && value.length > 0 && value.length <= 40)
}

function hasValidInterval(startedAt: string, endedAt: string): boolean {
  const start = Date.parse(startedAt)
  const end = Date.parse(endedAt)
  return Number.isFinite(start) && Number.isFinite(end) && end > start && end - start <= MAX_INTERVAL_MS
}

function isAppEvent(value: unknown): value is ApplicationActivityPayload {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    isKey(candidate.idempotencyKey) &&
    isOptionalSessionId(candidate.sessionId) &&
    isOptionalPlatform(candidate.platform) &&
    typeof candidate.applicationIdentifier === 'string' &&
    candidate.applicationIdentifier.length > 0 &&
    candidate.applicationIdentifier.length <= 200 &&
    typeof candidate.applicationName === 'string' &&
    candidate.applicationName.length > 0 &&
    candidate.applicationName.length <= 255 &&
    isTimestamp(candidate.startedAt) &&
    isTimestamp(candidate.endedAt) &&
    hasValidInterval(candidate.startedAt, candidate.endedAt)
  )
}

function isIdleInterval(value: unknown): value is IdleIntervalPayload {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    isKey(candidate.idempotencyKey) &&
    isOptionalSessionId(candidate.sessionId) &&
    isOptionalPlatform(candidate.platform) &&
    isTimestamp(candidate.startedAt) &&
    isTimestamp(candidate.endedAt) &&
    hasValidInterval(candidate.startedAt, candidate.endedAt)
  )
}

function uniqueAppEvents(events: unknown[]): ApplicationActivityPayload[] {
  const seen = new Set<string>()
  return events.filter((event): event is ApplicationActivityPayload => {
    if (!isAppEvent(event) || seen.has(event.idempotencyKey)) return false
    seen.add(event.idempotencyKey)
    return true
  })
}

function uniqueIdleIntervals(intervals: unknown[]): IdleIntervalPayload[] {
  const seen = new Set<string>()
  return intervals.filter((interval): interval is IdleIntervalPayload => {
    if (!isIdleInterval(interval) || seen.has(interval.idempotencyKey)) return false
    seen.add(interval.idempotencyKey)
    return true
  })
}

/**
 * Durable queue for foreground-application intervals and idle intervals. It
 * stores only the metadata the backend accepts and is scoped to one employee.
 * Authentication tokens and credentials are never written here.
 */
export class ActivityQueue {
  private queue: QueueFile = emptyQueue()

  constructor(private readonly filePath: string) {
    this.load()
  }

  private load(): void {
    try {
      if (!existsSync(this.filePath)) return
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<QueueFile>
      if (parsed.version !== 1) return

      this.queue = {
        version: 1,
        userId: typeof parsed.userId === 'string' ? parsed.userId : null,
        appEvents: uniqueAppEvents(
          Array.isArray(parsed.appEvents) ? parsed.appEvents : []
        ).slice(-MAX_QUEUED_APP_EVENTS),
        idleIntervals: uniqueIdleIntervals(
          Array.isArray(parsed.idleIntervals) ? parsed.idleIntervals : []
        ).slice(-MAX_QUEUED_IDLE_INTERVALS),
        droppedAppEvents: Number.isFinite(parsed.droppedAppEvents)
          ? Math.max(0, Number(parsed.droppedAppEvents))
          : 0,
        droppedIdleIntervals: Number.isFinite(parsed.droppedIdleIntervals)
          ? Math.max(0, Number(parsed.droppedIdleIntervals))
          : 0
      }
    } catch {
      this.queue = emptyQueue()
    }
  }

  bindUser(userId: string | null): void {
    if (this.queue.userId === userId) return
    this.queue = emptyQueue(userId)
    this.persist()
  }

  appEvents(): ApplicationActivityPayload[] {
    return [...this.queue.appEvents]
  }

  idleIntervals(): IdleIntervalPayload[] {
    return [...this.queue.idleIntervals]
  }

  counts(): { appEvents: number; idleIntervals: number } {
    return {
      appEvents: this.queue.appEvents.length,
      idleIntervals: this.queue.idleIntervals.length
    }
  }

  droppedCounts(): { appEvents: number; idleIntervals: number } {
    return {
      appEvents: this.queue.droppedAppEvents,
      idleIntervals: this.queue.droppedIdleIntervals
    }
  }

  appendApp(event: ApplicationActivityPayload): void {
    if (!isAppEvent(event)) throw new Error('Invalid application activity event')
    if (this.queue.appEvents.some((existing) => existing.idempotencyKey === event.idempotencyKey)) {
      return
    }

    this.queue.appEvents.push(event)
    if (this.queue.appEvents.length > MAX_QUEUED_APP_EVENTS) {
      this.queue.appEvents.splice(0, this.queue.appEvents.length - MAX_QUEUED_APP_EVENTS)
      this.queue.droppedAppEvents += 1
    }
    this.persist()
  }

  appendIdle(interval: IdleIntervalPayload): void {
    if (!isIdleInterval(interval)) throw new Error('Invalid idle interval')
    if (
      this.queue.idleIntervals.some(
        (existing) => existing.idempotencyKey === interval.idempotencyKey
      )
    ) {
      return
    }

    this.queue.idleIntervals.push(interval)
    if (this.queue.idleIntervals.length > MAX_QUEUED_IDLE_INTERVALS) {
      this.queue.idleIntervals.splice(
        0,
        this.queue.idleIntervals.length - MAX_QUEUED_IDLE_INTERVALS
      )
      this.queue.droppedIdleIntervals += 1
    }
    this.persist()
  }

  removeApp(keys: Iterable<string>): void {
    const removed = new Set(keys)
    if (removed.size === 0) return
    this.queue.appEvents = this.queue.appEvents.filter(
      (event) => !removed.has(event.idempotencyKey)
    )
    this.persist()
  }

  removeIdle(keys: Iterable<string>): void {
    const removed = new Set(keys)
    if (removed.size === 0) return
    this.queue.idleIntervals = this.queue.idleIntervals.filter(
      (interval) => !removed.has(interval.idempotencyKey)
    )
    this.persist()
  }

  clear(): void {
    const userId = this.queue.userId
    this.queue = emptyQueue(userId)
    this.persist()
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`
    writeFileSync(temporaryPath, JSON.stringify(this.queue), { encoding: 'utf8', mode: 0o600 })
    renameSync(temporaryPath, this.filePath)
  }
}