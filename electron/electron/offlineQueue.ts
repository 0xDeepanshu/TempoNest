import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync
} from 'node:fs'
import { dirname } from 'node:path'
import type { OfflineEvent, OfflineEventType } from './backendTypes'

const EVENT_TYPES: OfflineEventType[] = [
  'SESSION_START',
  'BREAK_START',
  'BREAK_END',
  'SESSION_STOP'
]

const STORE_VERSION = 2

interface OwnerQueue {
  organizationId: string
  employeeId: string
  events: OfflineEvent[]
}

interface QueueFile {
  version: typeof STORE_VERSION
  owners: Record<string, OwnerQueue>
  /** Events written by the single-user v1 queue, adopted on first bind. */
  legacy: { userId: string; events: OfflineEvent[] } | null
}

function ownerKey(organizationId: string, employeeId: string): string {
  return `${organizationId}:${employeeId}`
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

function sanitizeEvents(value: unknown): OfflineEvent[] {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  return value.filter((event): event is OfflineEvent => {
    if (!isEvent(event) || seen.has(event.eventId)) return false
    seen.add(event.eventId)
    return true
  })
}

function emptyQueue(): QueueFile {
  return { version: STORE_VERSION, owners: {}, legacy: null }
}

/**
 * Durable queue of timestamped offline time-tracking events.
 *
 * Events are keyed by organization and employee, so signing out, switching
 * accounts on a shared Windows install, or quitting the app never discards
 * another employee's unsynced work. The queue holds no tokens, agent keys or
 * device credentials; each owner's events are only flushed under an
 * authenticated session for that same organization and employee.
 */
export class OfflineQueue {
  private queue: QueueFile = emptyQueue()
  private currentOwnerKey: string | null = null

  constructor(private readonly filePath: string) {
    this.load()
  }

  private load(): void {
    try {
      if (!existsSync(this.filePath)) return
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Record<string, unknown>

      if (parsed.version === 1) {
        // Preserve events written before per-owner storage existed. They are
        // adopted by the first matching employee sign-in.
        const userId = typeof parsed.userId === 'string' ? parsed.userId : null
        const events = sanitizeEvents(parsed.events)
        this.queue = {
          ...emptyQueue(),
          legacy: userId && events.length > 0 ? { userId, events } : null
        }
        if (this.queue.legacy) this.persist()
        return
      }

      if (parsed.version !== STORE_VERSION || typeof parsed.owners !== 'object' || !parsed.owners) {
        return
      }

      const owners: Record<string, OwnerQueue> = {}
      for (const value of Object.values(parsed.owners as Record<string, unknown>)) {
        if (typeof value !== 'object' || value === null) continue
        const candidate = value as Record<string, unknown>
        if (
          typeof candidate.organizationId !== 'string' ||
          typeof candidate.employeeId !== 'string'
        ) {
          continue
        }
        const events = sanitizeEvents(candidate.events)
        if (events.length === 0) continue
        owners[ownerKey(candidate.organizationId, candidate.employeeId)] = {
          organizationId: candidate.organizationId,
          employeeId: candidate.employeeId,
          events
        }
      }

      const legacy =
        typeof parsed.legacy === 'object' && parsed.legacy !== null
          ? (parsed.legacy as Record<string, unknown>)
          : null
      const legacyUserId = typeof legacy?.userId === 'string' ? legacy.userId : null
      const legacyEvents = sanitizeEvents(legacy?.events)

      this.queue = {
        version: STORE_VERSION,
        owners,
        legacy:
          legacyUserId && legacyEvents.length > 0
            ? { userId: legacyUserId, events: legacyEvents }
            : null
      }
    } catch {
      this.queue = emptyQueue()
    }
  }

  /**
   * Selects the active owner without mutating or discarding any stored events.
   * Re-binding the same owner is a no-op, and switching accounts simply points
   * `all()`, `append()` and `remove()` at a different bucket.
   */
  bindOwner(organizationId: string, employeeId: string): void {
    const key = ownerKey(organizationId, employeeId)
    let changed = false

    if (!this.queue.owners[key]) {
      this.queue.owners[key] = { organizationId, employeeId, events: [] }
      changed = true
    }

    if (this.queue.legacy?.userId === employeeId) {
      const owner = this.queue.owners[key]
      const merged = [...this.queue.legacy.events, ...owner.events]
      const seen = new Set<string>()
      owner.events = merged.filter((event) => {
        if (seen.has(event.eventId)) return false
        seen.add(event.eventId)
        return true
      })
      this.queue.legacy = null
      changed = true
    }

    this.currentOwnerKey = key
    if (changed) this.persist()
  }

  /** Clears the active owner selection without touching persisted events. */
  detachOwner(): void {
    this.currentOwnerKey = null
  }

  all(): OfflineEvent[] {
    const owner = this.currentOwner()
    return owner ? [...owner.events] : []
  }

  count(): number {
    return this.currentOwner()?.events.length ?? 0
  }

  append(event: OfflineEvent): void {
    if (!isEvent(event)) throw new Error('Invalid offline event')
    const owner = this.currentOwner()
    if (!owner) throw new Error('No offline queue owner is bound')
    if (owner.events.some((existing) => existing.eventId === event.eventId)) return
    owner.events.push(event)
    this.persist()
  }

  remove(eventIds: Iterable<string>): void {
    const owner = this.currentOwner()
    if (!owner) return

    const removed = new Set(eventIds)
    if (removed.size === 0) return
    owner.events = owner.events.filter((event) => !removed.has(event.eventId))
    this.persist()
  }

  private currentOwner(): OwnerQueue | null {
    if (!this.currentOwnerKey) return null
    return this.queue.owners[this.currentOwnerKey] ?? null
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`
    const fd = openSync(temporaryPath, 'w', 0o600)
    try {
      writeFileSync(fd, JSON.stringify(this.queue), { encoding: 'utf8' })
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(temporaryPath, this.filePath)
  }
}
