import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const MAX_INTERVAL_MS = 24 * 60 * 60 * 1000

export interface OpenAppInterval {
  identifier: string
  name: string
  startedAt: string
  lastSeenAt: string
  sessionId: string | null
}

export interface OpenIdleInterval {
  startedAt: string
  lastSeenAt: string
  sessionId: string | null
}

interface StateFile {
  version: 1
  userId: string | null
  openApp: OpenAppInterval | null
  openIdle: OpenIdleInterval | null
}

const EMPTY_STATE: StateFile = {
  version: 1,
  userId: null,
  openApp: null,
  openIdle: null
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function isValidRange(startedAt: unknown, lastSeenAt: unknown): boolean {
  if (!isTimestamp(startedAt) || !isTimestamp(lastSeenAt)) return false
  const start = Date.parse(startedAt)
  const end = Date.parse(lastSeenAt)
  return end >= start && end - start <= MAX_INTERVAL_MS
}

function isSessionId(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length > 0 && value.length <= 64)
}

function isOpenApp(value: unknown): value is OpenAppInterval {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.identifier === 'string' &&
    candidate.identifier.length > 0 &&
    candidate.identifier.length <= 200 &&
    typeof candidate.name === 'string' &&
    candidate.name.length > 0 &&
    candidate.name.length <= 255 &&
    isSessionId(candidate.sessionId) &&
    isValidRange(candidate.startedAt, candidate.lastSeenAt)
  )
}

function isOpenIdle(value: unknown): value is OpenIdleInterval {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return isSessionId(candidate.sessionId) && isValidRange(candidate.startedAt, candidate.lastSeenAt)
}

/**
 * Durable snapshot of the interval that was open when the process stopped.
 * On the next launch it is closed at its last observed timestamp, so a crash or
 * restart cannot fabricate activity for time the agent was not running.
 */
export class ActivityStateStore {
  private state: StateFile = { ...EMPTY_STATE }

  constructor(private readonly filePath: string) {
    this.load()
  }

  private load(): void {
    try {
      if (!existsSync(this.filePath)) return
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<StateFile>
      if (parsed.version !== 1) return

      this.state = {
        version: 1,
        userId: typeof parsed.userId === 'string' ? parsed.userId : null,
        openApp: isOpenApp(parsed.openApp) ? parsed.openApp : null,
        openIdle: isOpenIdle(parsed.openIdle) ? parsed.openIdle : null
      }
    } catch {
      this.state = { ...EMPTY_STATE }
    }
  }

  bindUser(userId: string | null): void {
    if (this.state.userId === userId) return
    this.state = { ...EMPTY_STATE, userId }
    this.persist()
  }

  getUserId(): string | null {
    return this.state.userId
  }

  getOpenApp(): OpenAppInterval | null {
    return this.state.openApp ? { ...this.state.openApp } : null
  }

  getOpenIdle(): OpenIdleInterval | null {
    return this.state.openIdle ? { ...this.state.openIdle } : null
  }

  setOpenApp(interval: OpenAppInterval | null): void {
    this.state = { ...this.state, openApp: interval }
    this.persist()
  }

  setOpenIdle(interval: OpenIdleInterval | null): void {
    this.state = { ...this.state, openIdle: interval }
    this.persist()
  }

  /** Writes both open intervals in one atomic update. */
  save(openApp: OpenAppInterval | null, openIdle: OpenIdleInterval | null): void {
    this.state = { ...this.state, openApp, openIdle }
    this.persist()
  }

  clearOpenIntervals(): void {
    if (this.state.openApp === null && this.state.openIdle === null) return
    this.state = { ...this.state, openApp: null, openIdle: null }
    this.persist()
  }

  clear(): void {
    const userId = this.state.userId
    this.state = { ...EMPTY_STATE, userId }
    this.persist()
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`
    writeFileSync(temporaryPath, JSON.stringify(this.state), { encoding: 'utf8', mode: 0o600 })
    renameSync(temporaryPath, this.filePath)
  }
}