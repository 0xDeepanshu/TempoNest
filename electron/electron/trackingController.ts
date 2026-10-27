import { randomUUID } from 'node:crypto'
import { localDayBounds } from '../shared/localDay'
import type { AuthSession } from '../src/types/auth'
import type {
  ServerSessionSnapshot,
  TrackingOperationResult,
  TrackingRuntimeStatus,
  TrackingSnapshot,
  UserFacingError
} from '../src/types/electron'
import type { TrackingStatus } from '../src/types/tracking'
import type {
  BackendBreak,
  BackendBreakEnvelope,
  BackendCurrentEnvelope,
  BackendSessionEnvelope,
  BackendStartEnvelope,
  BackendTimeSession,
  OfflineEvent,
  OfflineSyncResult
} from './backendTypes'
import { AgentSocket, type AgentSocketCredentials, type ConnectedPayload } from './agentSocket'
import type { AgentManager } from './agentManager'
import type { AuthManager } from './authManager'
import { HEARTBEAT_FALLBACK_MS, MAX_SYNC_BATCH } from './config'
import { ApiError, NetworkError, toUserFacingError } from './errors'
import type { OfflineQueue } from './offlineQueue'
import type { LiveScreenSocketHandler } from './liveScreenService'
import type { ScreenshotSocketHandler } from './screenshotService'

const DEFAULTS: TrackingRuntimeStatus = {
  connection: 'unknown',
  message: null,
  pendingEvents: 0,
  serverTime: null
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// The list endpoint is paginated. Today's session count is normally small, but
// a bounded loop keeps a misbehaving page response from stalling launch.
const TODAY_PAGE_SIZE = 100
const MAX_TODAY_PAGES = 20

const TOTALS_UNAVAILABLE: UserFacingError = {
  code: 'TOTALS_UNAVAILABLE',
  message: "Today's totals could not be loaded. Check the connection and retry."
}

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value)
}

function mapBreak(brk: BackendBreak): ServerSessionSnapshot['breaks'][number] {
  return {
    id: brk.id,
    startedAt: brk.startedAt,
    endedAt: brk.endedAt
  }
}

function mapSession(session: BackendTimeSession, pendingSync = false): ServerSessionSnapshot {
  const breaks = session.breaks ?? (session.activeBreak ? [session.activeBreak] : [])
  return {
    id: session.id,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    breaks: [...breaks]
      .sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt))
      .map(mapBreak),
    ...(pendingSync ? { pendingSync: true } : {})
  }
}

function statusForSession(session: ServerSessionSnapshot | null): TrackingStatus {
  if (!session || session.endedAt) return 'idle'
  return session.breaks.some((brk) => brk.endedAt === null) ? 'on_break' : 'working'
}

function cloneSnapshot(snapshot: TrackingSnapshot): TrackingSnapshot {
  return {
    status: snapshot.status,
    session: snapshot.session
      ? {
          ...snapshot.session,
          breaks: snapshot.session.breaks.map((brk) => ({ ...brk }))
        }
      : null,
    serverTime: snapshot.serverTime,
    ...(snapshot.pendingStopAt ? { pendingStopAt: snapshot.pendingStopAt } : {}),
    ...(snapshot.todaySessions
      ? {
          todaySessions: snapshot.todaySessions.map((session) => ({
            ...session,
            breaks: session.breaks.map((brk) => ({ ...brk }))
          }))
        }
      : {}),
    ...(snapshot.totalsError ? { totalsError: { ...snapshot.totalsError } } : {})
  }
}

function emptySnapshot(): TrackingSnapshot {
  return { status: 'idle', session: null, serverTime: null }
}

function isConflictAdoption(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 409) return false
  return [
    'ACTIVE_SESSION_EXISTS',
    'AGENT_SESSION_EXISTS',
    'BREAK_ALREADY_ACTIVE',
    'NO_ACTIVE_BREAK',
    'SESSION_NOT_ACTIVE',
    'SESSION_ALREADY_STOPPED',
    'SESSION_NOT_FOUND'
  ].includes(error.code)
}

interface TrackingControllerOptions {
  auth: AuthManager
  agents: AgentManager
  queue: OfflineQueue
  websocketUrl: string
  screenshots?: ScreenshotSocketHandler
  liveScreen?: LiveScreenSocketHandler
}

/**
 * Main-process authority for time tracking. The renderer receives snapshots,
 * never tokens. Mutations that hit a confirmed network failure are written to
 * a durable queue and replayed through the backend's idempotent sync endpoint.
 */
export class TrackingController {
  private readonly auth: AuthManager
  private readonly agents: AgentManager
  private readonly queue: OfflineQueue
  private readonly socket: AgentSocket
  private readonly screenshots?: ScreenshotSocketHandler
  private readonly liveScreen?: LiveScreenSocketHandler
  private session: AuthSession | null = null
  private snapshot: TrackingSnapshot = emptySnapshot()
  private status: TrackingRuntimeStatus = { ...DEFAULTS }
  private listeners = new Set<(snapshot: TrackingSnapshot) => void>()
  private statusListeners = new Set<(status: TrackingRuntimeStatus) => void>()
  private operationChain: Promise<unknown> = Promise.resolve()
  private initializing: Promise<void> | null = null
  private blocked = false
  private shuttingDown = false
  private shutdownPromise: Promise<void> | null = null
  private readonly sessionAliases = new Map<string, string>()
  private readonly fallbackHeartbeat: NodeJS.Timeout
  private readonly reconnectSweep: NodeJS.Timeout

  constructor(options: TrackingControllerOptions) {
    this.auth = options.auth
    this.agents = options.agents
    this.queue = options.queue
    this.screenshots = options.screenshots
    this.liveScreen = options.liveScreen

    this.socket = new AgentSocket({
      url: options.websocketUrl,
      getCredentials: () => this.socketCredentials(),
      refreshAccessToken: () => this.auth.refreshAccessToken(),
      recoverCredentials: () => this.recoverCredentials(),
      onConnected: (payload) => this.handleConnected(payload),
      onSession: (session) => this.handleSocketSession(session),
      onConnectionChanged: (online) => this.handleConnectionChanged(online),
      onBlocked: (code, reason) => {
        void this.blockAccess(code, reason)
      },
      onFatalAuth: () => {
        void this.auth.invalidateSession()
      },
      onScreenshotRequest: (command) => this.screenshots?.handleRequest(command),
      onScreenshotPending: (requests) => this.screenshots?.handlePending(requests),
      onScreenshotCancelled: (requestId) => this.screenshots?.handleCancelled(requestId),
      onScreenshotError: (error) => this.screenshots?.handleServerError(error),
      onScreenLiveStart: (command) => this.liveScreen?.handleStart(command),
      onScreenLivePending: (pending) => this.liveScreen?.handlePending(pending),
      onScreenLiveStop: (liveSessionId, reason) =>
        this.liveScreen?.handleStop(liveSessionId, reason),
      onScreenLiveError: (error) => this.liveScreen?.handleServerError(error),
      onScreenLiveDisconnected: () => this.liveScreen?.handleDisconnected()
    })

    this.liveScreen?.setControlChannel({
      sendScreenLiveFailure: (liveSessionId, code, message) =>
        this.socket.sendScreenLiveFailure(liveSessionId, code, message)
    })

    this.fallbackHeartbeat = setInterval(() => {
      void this.sendFallbackHeartbeat()
    }, HEARTBEAT_FALLBACK_MS)
    this.fallbackHeartbeat.unref()

    this.reconnectSweep = setInterval(() => {
      if (!this.session || this.blocked) return
      if (this.status.connection !== 'offline' && this.socket.isOpen) return
      void this.enqueue(async () => {
        try {
          await this.ensureAgentCredentials()
          if (!this.socket.isOpen) this.socket.connect()
          const flushed = await this.flushQueue()
          if (flushed) await this.fetchCurrent()
        } catch {
          // The next sweep retries; the durable queue is already saved.
        }
      })
    }, 30_000)
    this.reconnectSweep.unref()
  }

  onStateChanged(listener: (snapshot: TrackingSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onStatusChanged(listener: (status: TrackingRuntimeStatus) => void): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  getSnapshot(): TrackingSnapshot {
    return cloneSnapshot(this.snapshot)
  }

  getStatus(): TrackingRuntimeStatus {
    return { ...this.status }
  }

  attachSession(session: AuthSession): void {
    this.session = session
    this.blocked = false
    this.queue.bindUser(session.employee.id)
    this.updateStatus({
      connection: 'unknown',
      message: null,
      pendingEvents: this.queue.count()
    })

    if (this.initializing) return
    this.initializing = this.initialize().finally(() => {
      this.initializing = null
    })
  }

  /**
   * Explicit sign-out clears queued events. Involuntary invalidation keeps them
   * so a pending quit-time stop can still be applied after the same employee
   * signs in again; `bindUser` discards them if a different employee signs in.
   */
  detachSession(clearQueuedEvents = false): void {
    this.session = null
    this.blocked = false
    this.liveScreen?.detachSession()
    this.socket.disconnect(true)
    if (clearQueuedEvents) this.queue.clear()
    this.agents.forgetAgent()
    this.sessionAliases.clear()
    this.snapshot = emptySnapshot()
    this.updateStatus({ ...DEFAULTS })
    this.emitSnapshot()
  }

  dispose(): void {
    this.shuttingDown = true
    clearInterval(this.fallbackHeartbeat)
    clearInterval(this.reconnectSweep)
    this.liveScreen?.dispose()
    this.socket.disconnect()
  }

  /**
   * Quit path. The durable stop is written before the network request so an
   * offline quit, a lost response, or a forced process exit still leaves the
   * backend stoppable through the idempotent `/sync` endpoint on the next
   * launch. The queued event is removed only after the server confirms the
   * stop (or reports that the session is already inactive).
   */
  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise

    this.shuttingDown = true
    clearInterval(this.fallbackHeartbeat)
    clearInterval(this.reconnectSweep)
    this.liveScreen?.detachSession()

    this.shutdownPromise = this.enqueue(() => this.stopActiveSessionForShutdown())
      .catch(() => undefined)
      .finally(() => {
        this.socket.disconnect()
      })
    return this.shutdownPromise
  }

  restore(): Promise<TrackingSnapshot | null> {
    return this.enqueue(async () => {
      if (!this.session) return null
      await this.ensureReady()
      const flushed = await this.flushQueue()
      if (!flushed && this.queue.count() > 0) return this.pendingQueueSnapshot()
      const current = await this.fetchCurrent()
      return this.status.connection === 'offline' ? this.pendingQueueSnapshot() : current
    })
  }

  refreshCurrent(): Promise<TrackingSnapshot | null> {
    return this.enqueue(async () => {
      if (!this.session) return null
      await this.ensureReady()
      const flushed = await this.flushQueue()
      if (!flushed && this.queue.count() > 0) return this.pendingQueueSnapshot()
      const current = await this.fetchCurrent()
      return this.status.connection === 'offline' ? this.pendingQueueSnapshot() : current
    })
  }

  private async stopActiveSessionForShutdown(): Promise<void> {
    if (!this.session || this.blocked) return

    try {
      await this.ensureReady()
    } catch {
      // Fall back to whatever local state is known.
    }

    let active =
      this.snapshot.session && !this.snapshot.session.endedAt ? this.snapshot.session : null

    if (!active) {
      const pendingSessionId = this.pendingQueueSessionId()
      if (pendingSessionId) {
        active = {
          id: pendingSessionId,
          startedAt: new Date().toISOString(),
          endedAt: null,
          breaks: [],
          pendingSync: true
        }
      }
    }

    if (!active) {
      const current = await this.fetchCurrent()
      active = current.session && !current.session.endedAt ? current.session : null
    }

    if (!active) return

    const serverSessionId = active.pendingSync ? active.id : this.resolveSessionId(active.id)
    const stopEvent = this.persistPendingStop(serverSessionId)

    if (active.pendingSync) return

    try {
      const credentials = await this.ensureAgentCredentials()
      await this.withAgentRetry(() =>
        this.auth.client.request<BackendSessionEnvelope>(
          `/organizations/${this.organizationId()}/time-sessions/${serverSessionId}/stop`,
          { method: 'POST', body: undefined, agent: credentials }
        )
      )
      this.queue.remove([stopEvent.eventId])
    } catch (error) {
      if (isConflictAdoption(error)) {
        this.queue.remove([stopEvent.eventId])
        return
      }
      // Network failures and unexpected errors keep the durable stop event for
      // the next launch's `/sync` reconciliation.
    }
  }

  private persistPendingStop(sessionId: string): OfflineEvent {
    const existing = this.queue
      .all()
      .find((event) => event.type === 'SESSION_STOP' && event.sessionId === sessionId)
    if (existing) return existing

    const event: OfflineEvent = {
      eventId: randomUUID(),
      type: 'SESSION_STOP',
      occurredAt: new Date().toISOString(),
      sessionId
    }
    this.queue.append(event)
    return event
  }

  /** The latest queued session that started and has not been stopped. */
  private pendingQueueSessionId(): string | null {
    const active = new Map<string, boolean>()
    for (const event of this.queue.all()) {
      if (event.type === 'SESSION_START') active.set(event.sessionId, true)
      if (event.type === 'SESSION_STOP') active.set(event.sessionId, false)
    }

    let candidate: string | null = null
    for (const [sessionId, isActive] of active) {
      if (isActive) candidate = sessionId
    }
    return candidate
  }

  /**
   * If the durable queue ends in a stop, the local timer must not reappear as
   * running when the server cannot be reached on the next launch.
   */
  private pendingQueueSnapshot(): TrackingSnapshot | null {
    const last = this.queue.all().at(-1)
    if (last?.type !== 'SESSION_STOP') return null
    return { ...emptySnapshot(), pendingStopAt: last.occurredAt }
  }

  start(clientSessionId: string, _startedAt: string): Promise<TrackingOperationResult> {
    return this.enqueue(async () => {
      if (!this.session || this.blocked) return this.errorResult('ACCESS_BLOCKED')
      const sessionId = isUuid(clientSessionId) ? clientSessionId : randomUUID()

      await this.ensureReady()
      await this.flushQueue()

      try {
        const credentials = await this.ensureAgentCredentials()
        const response = await this.withAgentRetry(() =>
          this.auth.client.request<BackendStartEnvelope>(
            `/organizations/${this.organizationId()}/time-sessions/start`,
            { method: 'POST', body: undefined, agent: credentials }
          )
        )

        const serverSession = mapSession(response.session)
        this.sessionAliases.set(sessionId, serverSession.id)
        this.updateStatus({ connection: 'online', message: null })
        this.accountForAutoClose(response.autoClosedSessionId)
        this.applySnapshot({
          status: statusForSession(serverSession),
          session: serverSession,
          serverTime: response.serverTime
        })
        if (!this.socket.isOpen) this.socket.connect()
        return this.result(this.snapshot)
      } catch (error) {
        if (isConflictAdoption(error)) {
          await this.fetchCurrent()
          return this.result(this.snapshot)
        }
        return this.handleMutationFailure('SESSION_START', sessionId, new Date(), error, true)
      }
    })
  }

  startBreak(
    sessionId: string,
    _breakId: string,
    startedAt: string
  ): Promise<TrackingOperationResult> {
    return this.enqueue(async () => {
      if (!this.session || this.blocked) return this.errorResult('ACCESS_BLOCKED')
      const serverSessionId = this.resolveSessionId(sessionId)

      await this.ensureReady()
      await this.flushQueue()

      try {
        const credentials = await this.ensureAgentCredentials()
        const response = await this.withAgentRetry(() =>
          this.auth.client.request<BackendBreakEnvelope>(
            `/organizations/${this.organizationId()}/time-sessions/${serverSessionId}/breaks`,
            { method: 'POST', body: undefined, agent: credentials }
          )
        )
        const serverSession = mapSession(response.session)
        this.sessionAliases.set(sessionId, serverSession.id)
        this.updateStatus({ connection: 'online', message: null })
        this.applySnapshot({
          status: statusForSession(serverSession),
          session: serverSession,
          serverTime: response.serverTime
        })
        return this.result(this.snapshot)
      } catch (error) {
        if (isConflictAdoption(error)) {
          await this.fetchCurrent()
          return this.result(this.snapshot, false, null)
        }
        return this.handleMutationFailure(
          'BREAK_START',
          serverSessionId,
          new Date(startedAt),
          error,
          false
        )
      }
    })
  }

  endBreak(sessionId: string, _breakId: string, endedAt: string): Promise<TrackingOperationResult> {
    return this.enqueue(async () => {
      if (!this.session || this.blocked) return this.errorResult('ACCESS_BLOCKED')
      const serverSessionId = this.resolveSessionId(sessionId)

      await this.ensureReady()
      await this.flushQueue()

      try {
        const credentials = await this.ensureAgentCredentials()
        const response = await this.withAgentRetry(() =>
          this.auth.client.request<BackendBreakEnvelope>(
            `/organizations/${this.organizationId()}/time-sessions/${serverSessionId}/breaks/end`,
            { method: 'POST', body: undefined, agent: credentials }
          )
        )
        const serverSession = mapSession(response.session)
        this.updateStatus({ connection: 'online', message: null })
        this.applySnapshot({
          status: statusForSession(serverSession),
          session: serverSession,
          serverTime: response.serverTime
        })
        return this.result(this.snapshot)
      } catch (error) {
        if (isConflictAdoption(error)) {
          await this.fetchCurrent()
          return this.result(this.snapshot, false, null)
        }
        return this.handleMutationFailure(
          'BREAK_END',
          serverSessionId,
          new Date(endedAt),
          error,
          false
        )
      }
    })
  }

  stop(sessionId: string, endedAt: string): Promise<TrackingOperationResult> {
    return this.enqueue(async () => {
      if (!this.session || this.blocked) return this.errorResult('ACCESS_BLOCKED')
      const serverSessionId = this.resolveSessionId(sessionId)

      await this.ensureReady()
      await this.flushQueue()

      try {
        const credentials = await this.ensureAgentCredentials()
        const response = await this.withAgentRetry(() =>
          this.auth.client.request<BackendSessionEnvelope>(
            `/organizations/${this.organizationId()}/time-sessions/${serverSessionId}/stop`,
            { method: 'POST', body: undefined, agent: credentials }
          )
        )
        const completed = mapSession(response.session)
        this.sessionAliases.delete(sessionId)
        this.sessionAliases.delete(serverSessionId)
        this.updateStatus({ connection: 'online', message: null })
        this.applySnapshot({ status: 'idle', session: null, serverTime: response.serverTime })
        return {
          snapshot: this.getSnapshot(),
          completedSession: completed,
          queued: false,
          error: null
        }
      } catch (error) {
        if (error instanceof ApiError && ['SESSION_NOT_FOUND', 'SESSION_NOT_ACTIVE'].includes(error.code)) {
          const current = await this.fetchCurrent()
          if (current.session && !current.session.endedAt) {
            // The local ID was stale (for example, an offline sync adopted a
            // server ID). The employee explicitly asked to stop, so stop the
            // authoritative active session once.
            try {
              const credentials = await this.ensureAgentCredentials()
              await this.auth.client.request<BackendSessionEnvelope>(
                `/organizations/${this.organizationId()}/time-sessions/${current.session.id}/stop`,
                { method: 'POST', body: undefined, agent: credentials }
              )
            } catch {
              // A concurrent stop already succeeded; fetch below is authoritative.
            }
            const after = await this.fetchCurrent()
            return {
              snapshot: after,
              completedSession: null,
              queued: false,
              error: null
            }
          }
          this.applySnapshot({ status: 'idle', session: null, serverTime: current.serverTime })
          return this.result(this.snapshot)
        }
        return this.handleMutationFailure(
          'SESSION_STOP',
          serverSessionId,
          new Date(endedAt),
          error,
          false,
          true
        )
      }
    })
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operationChain.then(operation, operation)
    this.operationChain = next.catch(() => undefined)
    return next
  }

  private async initialize(): Promise<void> {
    try {
      await this.ensureAgentCredentials()
      const flushed = await this.flushQueue()
      if (flushed) await this.fetchCurrent()
      else this.updateStatus({ connection: 'offline' })
    } catch (error) {
      if (error instanceof NetworkError) {
        this.updateStatus({
          connection: 'offline',
          message: 'The server is unreachable. New timer events will sync automatically.'
        })
        return
      }
      if (error instanceof ApiError && error.code === 'AGENT_REVOKED') {
        await this.blockAccess('AGENT_REVOKED', 'This device was revoked by an administrator.')
        return
      }
      const safe = toUserFacingError(error)
      this.updateStatus({ connection: 'unknown', message: safe.message })
    }
  }

  private ensureReady(): Promise<void> {
    if (!this.session) return Promise.resolve()
    if (this.initializing) return this.initializing
    if (this.status.connection === 'unknown') {
      this.initializing = this.initialize().finally(() => {
        this.initializing = null
      })
      return this.initializing
    }
    return Promise.resolve()
  }

  private async ensureAgentCredentials() {
    if (!this.session) throw new Error('Not authenticated')
    const credentials = await this.agents.ensureAgent(this.session)
    if (!this.socket.isOpen && !this.shuttingDown) this.socket.connect()
    this.updateStatus({ connection: this.socket.isOpen ? 'online' : this.status.connection })
    return credentials
  }

  private async withAgentRetry<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof ApiError && error.code === 'AGENT_CREDENTIALS_INVALID' && this.session) {
        await this.agents.rotateAgent(this.session)
        if (!this.socket.isOpen) this.socket.connect()
        return operation()
      }
      throw error
    }
  }

  private socketCredentials(): AgentSocketCredentials | null {
    const token = this.auth.getAccessToken()
    const agent = this.agents.getCredentials()
    if (!token || !agent) return null
    return {
      accessToken: token,
      agentId: agent.id,
      agentKey: agent.key
    }
  }

  private async recoverCredentials(): Promise<boolean> {
    if (!this.session) return false
    const refreshed = await this.auth.refreshAccessToken()
    if (!refreshed) return false
    await this.agents.rotateAgent(this.session)
    return true
  }

  private handleConnected(payload: ConnectedPayload): void {
    this.updateStatus({ connection: 'online', message: null, pendingEvents: this.queue.count() })
    this.screenshots?.handleConnected(payload.serverTime)
    this.liveScreen?.handleConnected(payload.serverTime)
    if (this.queue.count() > 0) {
      void this.enqueue(async () => {
        const flushed = await this.flushQueue()
        if (flushed) await this.fetchCurrent()
      })
    }
  }

  private handleSocketSession(session: BackendTimeSession | null): void {
    // While any offline event is pending, the server snapshot predates the
    // durable queue. The batch flush followed by /current is authoritative.
    if (this.queue.count() > 0) return
    if (!session) {
      // A null socket update after an active session means the server ended it
      // (administrator stop, revocation cleanup, or stale-heartbeat close). We
      // do not know its end time from a null payload, so refresh current state
      // and today's intervals instead of discarding the worked minutes.
      const hadActive = this.snapshot.session !== null && this.snapshot.session.endedAt === null
      if (hadActive) {
        void this.enqueue(() => this.fetchCurrent()).catch(() => undefined)
        return
      }
      this.applySnapshot({ status: 'idle', session: null, serverTime: null })
      return
    }
    const mapped = mapSession(session)
    this.applySnapshot({
      status: statusForSession(mapped),
      session: mapped,
      serverTime: new Date().toISOString()
    })
  }

  private handleConnectionChanged(online: boolean): void {
    if (this.blocked) return
    if (online) {
      this.updateStatus({ connection: 'online', message: null })
      return
    }
    this.updateStatus({
      connection: 'offline',
      message: 'Live connection lost. Timer events will sync when the connection returns.'
    })
  }

  private async sendFallbackHeartbeat(): Promise<void> {
    if (!this.session || this.blocked || this.socket.isOpen) return
    const active = this.snapshot.session
    if (!active || active.endedAt || active.pendingSync) return

    try {
      const credentials = this.agents.getCredentials()
      if (!credentials) return
      const response = await this.auth.client.request<BackendSessionEnvelope>(
        `/organizations/${this.organizationId()}/time-sessions/${active.id}/heartbeat`,
        { method: 'POST', body: undefined, agent: credentials }
      )
      const mapped = mapSession(response.session)
      this.applySnapshot({
        status: statusForSession(mapped),
        session: mapped,
        serverTime: response.serverTime
      })
      this.updateStatus({ connection: 'online', message: null })
    } catch (error) {
      if (error instanceof NetworkError) {
        this.updateStatus({ connection: 'offline' })
        return
      }
      if (isConflictAdoption(error)) {
        await this.fetchCurrent()
        return
      }
      if (error instanceof ApiError && error.code === 'AGENT_REVOKED') {
        await this.blockAccess('AGENT_REVOKED', 'This device was revoked by an administrator.')
      }
    }
  }

  private async flushQueue(): Promise<boolean> {
    if (!this.session) return false
    if (this.queue.count() === 0) {
      this.updateStatus({ pendingEvents: 0 })
      return true
    }

    try {
      const credentials = await this.ensureAgentCredentials()
      while (this.queue.count() > 0) {
        const batch = this.queue.all().slice(0, MAX_SYNC_BATCH)
        const response = await this.auth.client.request<OfflineSyncResult>(
          `/organizations/${this.organizationId()}/time-sessions/sync`,
          {
            method: 'POST',
            agent: credentials,
            body: {
              deviceId: credentials.deviceId,
              events: batch
            }
          }
        )

        const acknowledged = new Set<string>()
        let conflictMessage: string | null = null
        for (const result of response.results) {
          acknowledged.add(result.eventId)
          if (result.status === 'conflict') {
            conflictMessage =
              result.message ??
              'The server rejected an offline timer event. The current server state has been restored.'
          }
        }

        this.queue.remove(acknowledged)
        this.updateStatus({
          connection: 'online',
          message: conflictMessage,
          pendingEvents: this.queue.count(),
          serverTime: response.serverTime
        })
      }

      return true
    } catch (error) {
      if (error instanceof NetworkError) {
        this.updateStatus({
          connection: 'offline',
          message: 'Sync is paused until the server can be reached.',
          pendingEvents: this.queue.count()
        })
        return false
      }
      if (isConflictAdoption(error)) return true
      if (error instanceof ApiError && error.code === 'AGENT_REVOKED') {
        await this.blockAccess('AGENT_REVOKED', 'This device was revoked by an administrator.')
        return false
      }
      const safe = toUserFacingError(error)
      this.updateStatus({
        connection: 'online',
        message: safe.message,
        pendingEvents: this.queue.count()
      })
      return false
    }
  }

  private async fetchCurrent(): Promise<TrackingSnapshot> {
    if (!this.session) return this.getSnapshot()
    try {
      const response = await this.auth.client.request<BackendCurrentEnvelope>(
        `/organizations/${this.organizationId()}/time-sessions/current`
      )
      const mapped = response.session ? mapSession(response.session) : null

      // Totals come from the authoritative session list, not from the cached
      // current session. A failure here must not discard the reconciled timer;
      // it only marks the totals as unverified so the renderer can retry.
      let todaySessions: ServerSessionSnapshot[] | undefined
      let totalsError: UserFacingError | undefined
      try {
        todaySessions = await this.fetchTodaySessions()
      } catch {
        totalsError = { ...TOTALS_UNAVAILABLE }
      }

      this.applySnapshot({
        status: statusForSession(mapped),
        session: mapped,
        serverTime: response.serverTime,
        ...(todaySessions ? { todaySessions } : {}),
        ...(totalsError ? { totalsError } : {})
      })
      this.updateStatus({ connection: 'online', pendingEvents: this.queue.count() })
      return this.snapshot
    } catch (error) {
      if (error instanceof NetworkError) {
        this.updateStatus({ connection: 'offline' })
        return this.snapshot
      }
      if (error instanceof ApiError && error.code === 'AGENT_REVOKED') {
        await this.blockAccess('AGENT_REVOKED', 'This device was revoked by an administrator.')
      }
      return this.snapshot
    }
  }

  /**
   * Loads every session that overlaps the current local day through the
   * existing list endpoint. The range is filtered again locally by the same
   * local-day bounds so midnight-crossing sessions are included, and the
   * response is restricted to the authenticated employee and organization.
   */
  private async fetchTodaySessions(): Promise<ServerSessionSnapshot[]> {
    if (!this.session) return []

    const organizationId = this.organizationId()
    const employeeId = this.session.employee.id
    const { start, end } = localDayBounds(Date.now())
    const from = new Date(start).toISOString()
    const to = new Date(end - 1).toISOString()
    const found = new Map<string, ServerSessionSnapshot>()

    for (let page = 1; page <= MAX_TODAY_PAGES; page += 1) {
      const query = new URLSearchParams({
        from,
        to,
        limit: String(TODAY_PAGE_SIZE),
        page: String(page)
      })
      const sessions = await this.auth.client.request<BackendTimeSession[]>(
        `/organizations/${organizationId}/time-sessions?${query.toString()}`
      )
      if (!Array.isArray(sessions) || sessions.length === 0) break

      for (const session of sessions) {
        if (session.organizationId !== organizationId) continue
        if (session.employeeId !== employeeId) continue

        const startedAt = Date.parse(session.startedAt)
        const endedAt = session.endedAt === null ? null : Date.parse(session.endedAt)
        if (!Number.isFinite(startedAt) || startedAt >= end) continue
        if (endedAt !== null && (!Number.isFinite(endedAt) || endedAt <= start)) continue
        if (found.has(session.id)) continue

        found.set(session.id, mapSession(session))
      }

      if (sessions.length < TODAY_PAGE_SIZE) break
    }

    return [...found.values()].sort(
      (left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt)
    )
  }

  private handleMutationFailure(
    type: OfflineEvent['type'],
    sessionId: string,
    occurredAt: Date,
    error: unknown,
    startingSession: boolean,
    stoppedSession = false
  ): TrackingOperationResult {
    if (error instanceof NetworkError) {
      const event: OfflineEvent = {
        eventId: randomUUID(),
        type,
        occurredAt: occurredAt.toISOString(),
        sessionId
      }
      this.queue.append(event)

      if (startingSession) {
        this.applySnapshot({
          status: 'working',
          session: {
            id: sessionId,
            startedAt: occurredAt.toISOString(),
            endedAt: null,
            breaks: [],
            pendingSync: true
          },
          serverTime: null
        })
      } else if (stoppedSession) {
        this.applySnapshot({ status: 'idle', session: null, serverTime: null })
      }

      this.updateStatus({
        connection: 'offline',
        message: 'Offline: timer events are stored securely and will sync automatically.',
        pendingEvents: this.queue.count()
      })

      return {
        snapshot: this.getSnapshot(),
        completedSession: null,
        queued: true,
        error: null
      }
    }

    if (error instanceof ApiError && error.code === 'AGENT_REVOKED') {
      void this.blockAccess('AGENT_REVOKED', 'This device was revoked by an administrator.')
      return this.errorResult('AGENT_REVOKED')
    }

    if (error instanceof ApiError && error.status === 401) {
      void this.auth.invalidateSession()
      return this.errorResult(error.code)
    }

    const safe = toUserFacingError(error)
    this.updateStatus({ message: safe.message })
    return {
      snapshot: this.getSnapshot(),
      completedSession: null,
      queued: false,
      error: safe
    }
  }

  private async blockAccess(code: string, message: string): Promise<void> {
    if (this.blocked) return
    this.blocked = true
    this.liveScreen?.detachSession()
    this.socket.disconnect()
    this.agents.forgetAgent()
    this.sessionAliases.clear()
    this.applySnapshot({ status: 'idle', session: null, serverTime: null })
    this.updateStatus({
      connection: 'blocked',
      message,
      pendingEvents: this.queue.count()
    })

    if (code !== 'AGENT_REVOKED') {
      await this.auth.invalidateSession()
    }
  }

  private accountForAutoClose(autoClosedSessionId: string | null): void {
    if (!autoClosedSessionId) return
    this.updateStatus({
      message: 'A stale session from a previous run was closed at its last heartbeat.'
    })
  }

  private applySnapshot(snapshot: TrackingSnapshot): void {
    this.snapshot = cloneSnapshot(snapshot)
    this.emitSnapshot()
  }

  private emitSnapshot(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.getSnapshot())
      } catch {
        // Rendering failures must not affect the main-process tracker.
      }
    }
  }

  private updateStatus(patch: Partial<TrackingRuntimeStatus>): void {
    const next: TrackingRuntimeStatus = {
      ...this.status,
      ...patch,
      pendingEvents: patch.pendingEvents ?? this.queue.count()
    }
    if (
      next.connection === this.status.connection &&
      next.message === this.status.message &&
      next.pendingEvents === this.status.pendingEvents &&
      next.serverTime === this.status.serverTime
    ) {
      return
    }

    this.status = next
    for (const listener of this.statusListeners) {
      try {
        listener({ ...this.status })
      } catch {
        // Rendering failures must not affect the main-process tracker.
      }
    }
  }

  private result(
    snapshot: TrackingSnapshot,
    queued = false,
    error: UserFacingError | null = null
  ): TrackingOperationResult {
    return {
      snapshot: cloneSnapshot(snapshot),
      completedSession: null,
      queued,
      error
    }
  }

  private errorResult(code: string): TrackingOperationResult {
    const safe = toUserFacingError(new ApiError(403, code, this.status.message ?? 'Access blocked.'))
    return {
      snapshot: this.getSnapshot(),
      completedSession: null,
      queued: false,
      error: safe
    }
  }

  private resolveSessionId(sessionId: string): string {
    return this.sessionAliases.get(sessionId) ?? sessionId
  }

  private organizationId(): string {
    if (!this.session) throw new Error('Not authenticated')
    return this.session.membership.organization.id
  }
}
