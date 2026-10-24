import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { OfflineEvent, OfflineEventType } from './backendTypes'

const EVENT_TYPES: OfflineEventType[] = [
  'SESSION_START',
  'BREAK_START',
  'BREAK_END',
  'SESSION_STOP'
]

interface QueueFile {
  version: 1
  userId: string | null
  events: OfflineEvent[]
}

function isEvent(value: unknown): value is OfflineEvent {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.eventId === 'string' &&
    candidate.eventId.length >= 8 &&
    typeof candidate.sessionId === 'string' &&
    typeof candidate.occurredAt === 'string' &&
    Number.isFinite(Date.parse(candidate.occurredAt)) &&
    typeof candidate.type === 'string' &&
    EVENT_TYPES.includes(candidate.type as OfflineEventType)
  )
}

/**
 * Durable queue of timestamped offline time-tracking events. It contains no
 * tokens or agent credentials and is scoped to one authenticated employee.
 */
export class OfflineQueue {
  private queue: QueueFile = { version: 1, userId: null, events: [] }

  constructor(private readonly filePath: string) {
    this.load()
  }

  private load(): void {
    try {
      if (!existsSync(this.filePath)) return
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<QueueFile>
      if (parsed.version !== 1 || !Array.isArray(parsed.events)) return

      const seen = new Set<string>()
      const events = parsed.events.filter((event): event is OfflineEvent => {
        if (!isEvent(event) || seen.has(event.eventId)) return false
        seen.add(event.eventId)
        return true
      })

      this.queue = {
        version: 1,
        userId: typeof parsed.userId === 'string' ? parsed.userId : null,
        events
      }
    } catch {
      this.queue = { version: 1, userId: null, events: [] }
    }
  }

  bindUser(userId: string | null): void {
    if (this.queue.userId === userId) return
    this.queue = { version: 1, userId, events: [] }
    this.persist()
  }

  all(): OfflineEvent[] {
    return [...this.queue.events]
  }

  count(): number {
    return this.queue.events.length
  }

  append(event: OfflineEvent): void {
    if (!isEvent(event)) throw new Error('Invalid offline event')
    if (this.queue.events.some((existing) => existing.eventId === event.eventId)) return
    this.queue.events.push(event)
    this.persist()
  }

  remove(eventIds: Iterable<string>): void {
    const removed = new Set(eventIds)
    if (removed.size === 0) return
    this.queue.events = this.queue.events.filter((event) => !removed.has(event.eventId))
    this.persist()
  }

  clear(): void {
    this.queue = { version: 1, userId: null, events: [] }
    this.persist()
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`
    writeFileSync(temporaryPath, JSON.stringify(this.queue), { encoding: 'utf8', mode: 0o600 })
    renameSync(temporaryPath, this.filePath)
  }
}
