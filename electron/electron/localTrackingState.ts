import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

interface TrackingStateFile {
  version: 1
  userId: string | null
  lastStoppedSessionId: string | null
  lastStoppedAt: string | null
}

const EMPTY_STATE: TrackingStateFile = {
  version: 1,
  userId: null,
  lastStoppedSessionId: null,
  lastStoppedAt: null
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

/**
 * Durable, non-secret display hint used after a session is confirmed stopped.
 * It lets the next launch clear a stale renderer timer before the authoritative
 * server snapshot arrives, without ever storing tokens or agent credentials.
 */
export class LocalTrackingState {
  private state: TrackingStateFile = { ...EMPTY_STATE }

  constructor(private readonly filePath: string) {
    this.load()
  }

  private load(): void {
    try {
      if (!existsSync(this.filePath)) return
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<TrackingStateFile>
      if (parsed.version !== 1) return

      this.state = {
        version: 1,
        userId: typeof parsed.userId === 'string' ? parsed.userId : null,
        lastStoppedSessionId:
          typeof parsed.lastStoppedSessionId === 'string' ? parsed.lastStoppedSessionId : null,
        lastStoppedAt: isTimestamp(parsed.lastStoppedAt) ? parsed.lastStoppedAt : null
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

  getLastStoppedSessionId(): string | null {
    return this.state.lastStoppedSessionId
  }

  markStopped(sessionId: string, stoppedAt: string): void {
    this.state = {
      ...this.state,
      lastStoppedSessionId: sessionId,
      lastStoppedAt: isTimestamp(stoppedAt) ? stoppedAt : new Date().toISOString()
    }
    this.persist()
  }

  clearStopped(): void {
    if (this.state.lastStoppedSessionId === null && this.state.lastStoppedAt === null) return
    this.state = { ...this.state, lastStoppedSessionId: null, lastStoppedAt: null }
    this.persist()
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`
    writeFileSync(temporaryPath, JSON.stringify(this.state), { encoding: 'utf8', mode: 0o600 })
    renameSync(temporaryPath, this.filePath)
  }
}
