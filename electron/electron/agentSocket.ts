import WebSocket, { type RawData } from 'ws'
import type { IncomingMessage } from 'node:http'
import type {
  BackendTimeSession,
  PendingScreenshotRequest,
  ScreenshotCommand
} from './backendTypes'

export interface AgentSocketCredentials {
  accessToken: string
  agentId: string
  agentKey: string
}

export interface ConnectedPayload {
  type: 'connected'
  serverTime: string
  state: string
  session: BackendTimeSession | null
  pendingScreenshotRequests?: PendingScreenshotRequest[]
  heartbeatIntervalSeconds?: number
}

interface AgentSocketOptions {
  url: string
  getCredentials: () => AgentSocketCredentials | null
  refreshAccessToken: () => Promise<boolean>
  /** Used when an HTTP upgrade returns 401, which may mean the agent key rotated. */
  recoverCredentials: () => Promise<boolean>
  onConnected: (payload: ConnectedPayload) => void
  onSession: (session: BackendTimeSession | null) => void
  onConnectionChanged: (online: boolean) => void
  onBlocked: (code: string, reason: string) => void
  onFatalAuth: () => void
  onScreenshotRequest?: (command: ScreenshotCommand) => void
  onScreenshotPending?: (requests: PendingScreenshotRequest[]) => void
  onScreenshotCancelled?: (requestId: string) => void
  onScreenshotError?: (error: { code?: string; message?: string; requestId?: string }) => void
}

const MAX_BACKOFF_MS = 30_000

/**
 * Node-side agent socket. It authenticates during the HTTP upgrade so the
 * bearer token and agent key never reach the renderer.
 */
export class AgentSocket {
  private socket: WebSocket | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private reconnectAttempts = 0
  private generation = 0
  private intentionalClose = false

  constructor(private readonly options: AgentSocketOptions) {}

  get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  connect(): void {
    const credentials = this.options.getCredentials()
    if (!credentials) return

    this.clearReconnectTimer()
    this.disconnect(false)
    this.intentionalClose = false

    const generation = ++this.generation
    const socket = new WebSocket(this.options.url, {
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        'X-Agent-Id': credentials.agentId,
        'X-Agent-Key': credentials.agentKey
      }
    })
    this.socket = socket

    socket.on('open', () => {
      if (generation !== this.generation) return
      this.reconnectAttempts = 0
      this.options.onConnectionChanged(true)
    })

    socket.on('message', (raw: RawData, isBinary: boolean) => {
      if (generation !== this.generation || isBinary) return
      this.handleMessage(raw.toString())
    })

    socket.on('unexpected-response', (_request: unknown, response: IncomingMessage) => {
      if (generation !== this.generation) return
      const status = response.statusCode ?? 0
      response.resume()
      this.generation += 1
      socket.terminate()
      this.options.onConnectionChanged(false)
      this.clearHeartbeat()
      void this.handleUpgradeFailure(status)
    })

    socket.on('close', (code, reasonBuffer) => {
      if (generation !== this.generation) return
      this.socket = null
      this.clearHeartbeat()
      this.options.onConnectionChanged(false)
      if (this.intentionalClose) return

      const reason = reasonBuffer.toString()
      if (code === 4003) {
        this.options.onBlocked(reason || 'ACCESS_BLOCKED', reason || 'Access was blocked.')
        return
      }
      if (code === 4001) {
        void this.handleAuthExpired()
        return
      }
      this.scheduleReconnect()
    })

    socket.on('error', () => {
      // The close handler owns reconnect/backoff behaviour. Error details may
      // contain transport internals that should not reach the renderer.
    })
  }

  disconnect(clearCredentials = false): void {
    this.intentionalClose = true
    this.generation += 1
    this.clearHeartbeat()
    this.clearReconnectTimer()

    if (this.socket) {
      const socket = this.socket
      this.socket = null
      try {
        socket.close(1000, 'client shutdown')
      } catch {
        socket.terminate()
      }
    }

    if (clearCredentials) {
      this.options.onConnectionChanged(false)
    }
  }

  requestStatus(): void {
    if (!this.isOpen) return
    try {
      this.socket?.send(JSON.stringify({ type: 'session.status' }))
    } catch {
      // The close handler reconnects if the transport is gone.
    }
  }

  private sendHeartbeat(): void {
    if (!this.isOpen) return
    try {
      this.socket?.send(JSON.stringify({ type: 'heartbeat' }))
    } catch {
      // The close handler reconnects if the transport is gone.
    }
  }

  private scheduleHeartbeat(seconds: number | undefined): void {
    this.clearHeartbeat()
    const intervalMs = Math.max(15, Math.floor(seconds ?? 60)) * 1000
    this.sendHeartbeat()
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), intervalMs)
  }

  private clearHeartbeat(): void {
    if (!this.heartbeatTimer) return
    clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
  }

  private handleMessage(raw: string): void {
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return
    }

    const type = payload.type
    if (type === 'connected') {
      const connected = payload as unknown as ConnectedPayload
      this.scheduleHeartbeat(connected.heartbeatIntervalSeconds)
      this.options.onConnected(connected)
      this.options.onSession(connected.session ?? null)
      if (connected.pendingScreenshotRequests?.length) {
        this.options.onScreenshotPending?.(connected.pendingScreenshotRequests)
      }
      return
    }

    if (type === 'screenshot.request') {
      this.options.onScreenshotRequest?.(payload as unknown as ScreenshotCommand)
      return
    }

    if (type === 'screenshot.cancelled') {
      const requestId = payload.requestId
      if (typeof requestId === 'string') this.options.onScreenshotCancelled?.(requestId)
      return
    }

    if (type === 'screenshot.error') {
      this.options.onScreenshotError?.({
        code: typeof payload.code === 'string' ? payload.code : undefined,
        message: typeof payload.message === 'string' ? payload.message : undefined,
        requestId: typeof payload.requestId === 'string' ? payload.requestId : undefined
      })
      return
    }

    if (type === 'heartbeat.ack' || type === 'session.status' || type === 'session.updated') {
      const session = (payload.session ?? null) as BackendTimeSession | null
      this.options.onSession(session)
      return
    }

    if (type === 'agent.revoked') {
      this.options.onScreenshotError?.({
        code: 'AGENT_REVOKED',
        message: 'This device was revoked by an administrator.'
      })
      this.options.onBlocked('AGENT_REVOKED', 'This device was revoked by an administrator.')
      this.disconnect()
    }
  }

  private async handleAuthExpired(): Promise<void> {
    try {
      const refreshed = await this.options.refreshAccessToken()
      if (!refreshed) {
        this.options.onFatalAuth()
        return
      }
      this.scheduleReconnect(0)
    } catch {
      this.scheduleReconnect()
    }
  }

  private async handleUpgradeFailure(status: number): Promise<void> {
    if (status === 403) {
      this.options.onBlocked('ACCESS_BLOCKED', 'Access to TempoNest was blocked by the server.')
      return
    }

    if (status === 401) {
      try {
        const recovered = await this.options.recoverCredentials()
        if (recovered) {
          this.connect()
          return
        }
      } catch {
        // Fall through to normal backoff; the next call may recover.
      }
    }

    this.scheduleReconnect()
  }

  private scheduleReconnect(delayMs?: number): void {
    if (this.intentionalClose || this.reconnectTimer) return

    const exponential = Math.min(
      MAX_BACKOFF_MS,
      1000 * Math.pow(2, Math.min(this.reconnectAttempts, 5))
    )
    const jittered = Math.round(exponential * (0.65 + Math.random() * 0.7))
    this.reconnectAttempts += 1

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delayMs ?? jittered)
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }
}
