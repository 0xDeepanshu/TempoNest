import type { IncomingMessage } from 'node:http'
import WebSocket, { type RawData } from 'ws'
import type {
  PendingScreenLiveSession,
  ScreenLiveSocketError,
  ScreenLiveStartCommand
} from './backendTypes'
import { getScreenStreamUrl } from './config'
import type { LiveFrameCapture } from './screenCapture'
import { ScreenshotOperationError } from './screenshotErrors'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const MIN_FPS = 1
const MAX_FPS = 5
const DEFAULT_FPS = 2
const MIN_FRAME_INTERVAL_MS = 200
const MIN_FRAME_WIDTH = 320
const MAX_FRAME_WIDTH = 2560
const MIN_FRAME_BYTES = 32 * 1024
const MAX_FRAME_BYTES = 8 * 1024 * 1024
const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 6_000]

const LOST_CONNECTION: ReconnectFailure = {
  code: 'SCREEN_LIVE_DISCONNECTED',
  message: 'The live screen stream lost its connection.'
}

type ReconnectFailure = { code: string; message: string }

export interface LiveScreenCredentials {
  accessToken: string
  agentId: string
  agentKey: string
}

export interface LiveScreenServiceOptions {
  getCredentials: () => LiveScreenCredentials | null
  refreshAccessToken: () => Promise<boolean>
  capture: LiveFrameCapture
  createSocket?: (url: string, headers: Record<string, string>) => WebSocket
  now?: () => number
}

/** JSON control channel used only for local capture failures, never frames. */
export interface ScreenLiveControlChannel {
  sendScreenLiveFailure: (liveSessionId: string, code: string, message: string) => void
}

export interface LiveScreenSocketHandler {
  setControlChannel: (channel: ScreenLiveControlChannel | null) => void
  handleConnected: (serverTime?: string) => void
  handlePending: (pending: PendingScreenLiveSession | null) => void
  handleStart: (command: ScreenLiveStartCommand | PendingScreenLiveSession) => void
  handleStop: (liveSessionId: string, reason?: string) => void
  handleServerError: (error: ScreenLiveSocketError) => void
  handleDisconnected: () => void
  detachSession: () => void
  dispose: () => void
}

export type LiveScreenPhase =
  | 'idle'
  | 'connecting'
  | 'streaming'
  | 'reconnecting'
  | 'failed'

export interface LiveScreenState {
  phase: LiveScreenPhase
  liveSessionId: string | null
  framesSent: number
  lastFrameAt: string | null
  lastError: ReconnectFailure | null
  reconnectAttempts: number
}

interface ActiveCapture {
  liveSessionId: string
  timeSessionId: string
  streamPath: string
  expiresAt: number
  maxFps: number
  maxFrameWidth: number
  maxFrameBytes: number
  socket: WebSocket | null
  controller: AbortController
  frameTimer: NodeJS.Timeout | null
  expiryTimer: NodeJS.Timeout | null
  reconnectTimer: NodeJS.Timeout | null
  captureBusy: boolean
  ready: boolean
  stopped: boolean
  authRetried: boolean
  pendingUpgradeFailure: boolean
  attempts: number
  framesSent: number
  lastFrameAt: string | null
}

type LiveTarget = Omit<PendingScreenLiveSession, 'expiresAt'> & { expiresAt: number }

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.round(value)))
}

function normalizeTarget(
  command: ScreenLiveStartCommand | PendingScreenLiveSession
): LiveTarget | null {
  if (!command || typeof command !== 'object') return null
  const liveSessionId = command.liveSessionId
  const timeSessionId = command.timeSessionId
  const streamPath = command.streamPath
  const expiresAt = Date.parse(command.expiresAt)

  if (typeof liveSessionId !== 'string' || !UUID_PATTERN.test(liveSessionId)) return null
  if (typeof timeSessionId !== 'string' || timeSessionId.length === 0) return null
  if (typeof streamPath !== 'string' || !streamPath.startsWith('/') || streamPath.length > 512) {
    return null
  }
  if (!Number.isFinite(expiresAt)) return null

  return {
    liveSessionId,
    timeSessionId,
    expiresAt,
    streamPath,
    maxFps: clampInteger(command.maxFps, MIN_FPS, MAX_FPS, DEFAULT_FPS),
    maxFrameWidth: clampInteger(
      command.maxFrameWidth,
      MIN_FRAME_WIDTH,
      MAX_FRAME_WIDTH,
      MAX_FRAME_WIDTH
    ),
    maxFrameBytes: clampInteger(
      command.maxFrameBytes,
      MIN_FRAME_BYTES,
      MAX_FRAME_BYTES,
      MAX_FRAME_BYTES
    )
  }
}

function captureFailure(error: unknown): ReconnectFailure {
  if (error instanceof ScreenshotOperationError) {
    switch (error.code) {
      case 'OS_PERMISSION_DENIED':
        return {
          code: error.code,
          message: 'Screen Recording permission is not granted, so live viewing stopped.'
        }
      case 'CAPTURE_UNAVAILABLE':
        return {
          code: error.code,
          message: 'The operating system did not allow the screen to be captured.'
        }
      case 'CAPTURE_TOO_LARGE':
        return {
          code: error.code,
          message: 'Live screen frames exceeded the server payload limit, so capture stopped.'
        }
      case 'CAPTURE_EMPTY':
        return {
          code: error.code,
          message: 'The screen capture was empty, so live viewing stopped.'
        }
      default:
        return {
          code: 'CAPTURE_FAILED',
          message: 'The screen could not be captured for live viewing.'
        }
    }
  }

  return {
    code: 'CAPTURE_FAILED',
    message: 'The screen could not be captured for live viewing.'
  }
}

/**
 * Captures the primary display only while an administrator-authorized live
 * session is active. Frames travel on a dedicated binary socket; capture stops
 * on the server stop command, expiry, socket loss, sign-out, or app shutdown.
 *
 * The service exposes no IPC surface: the renderer cannot start, stop, or
 * inspect live capture.
 */
export class LiveScreenService implements LiveScreenSocketHandler {
  private readonly options: LiveScreenServiceOptions
  private channel: ScreenLiveControlChannel | null = null
  private active: ActiveCapture | null = null
  private clockOffsetMs = 0
  private disposed = false
  private state: LiveScreenState = {
    phase: 'idle',
    liveSessionId: null,
    framesSent: 0,
    lastFrameAt: null,
    lastError: null,
    reconnectAttempts: 0
  }

  constructor(options: LiveScreenServiceOptions) {
    this.options = options
  }

  setControlChannel(channel: ScreenLiveControlChannel | null): void {
    this.channel = channel
  }

  getState(): LiveScreenState {
    return { ...this.state, lastError: this.state.lastError ? { ...this.state.lastError } : null }
  }

  handleConnected(serverTime?: string): void {
    if (!serverTime) return
    const parsed = Date.parse(serverTime)
    if (Number.isFinite(parsed)) this.clockOffsetMs = parsed - Date.now()
  }

  handlePending(pending: PendingScreenLiveSession | null): void {
    if (pending) {
      this.handleStart(pending)
      return
    }
    if (this.active) this.stopActive('ENDED')
  }

  handleStart(command: ScreenLiveStartCommand | PendingScreenLiveSession): void {
    if (this.disposed) return
    const target = normalizeTarget(command)
    if (!target) {
      this.setState({ phase: 'failed', lastError: { code: 'INVALID_COMMAND', message: 'Invalid live screen command.' } })
      return
    }
    if (this.active?.liveSessionId === target.liveSessionId) return
    if (target.expiresAt <= this.nowMs()) return

    this.stopActive('REPLACED')

    const active: ActiveCapture = {
      ...target,
      socket: null,
      controller: new AbortController(),
      frameTimer: null,
      expiryTimer: null,
      reconnectTimer: null,
      captureBusy: false,
      ready: false,
      stopped: false,
      authRetried: false,
      pendingUpgradeFailure: false,
      attempts: 0,
      framesSent: 0,
      lastFrameAt: null
    }
    this.active = active
    this.setState({
      phase: 'connecting',
      liveSessionId: active.liveSessionId,
      framesSent: 0,
      lastFrameAt: null,
      lastError: null,
      reconnectAttempts: 0
    })

    this.scheduleExpiry(active)
    this.connect(active)
  }

  handleStop(liveSessionId: string, _reason?: string): void {
    if (this.active?.liveSessionId === liveSessionId) this.stopActive('STOPPED')
  }

  handleServerError(error: ScreenLiveSocketError): void {
    if (!this.active) return
    if (error.liveSessionId && error.liveSessionId !== this.active.liveSessionId) return
    const failure = {
      code: error.code ?? 'SCREEN_LIVE_ERROR',
      message: error.message ?? 'The live screen stream reported an error.'
    }
    this.stopActive('ENDED')
    this.setState({ phase: 'failed', lastError: failure })
  }

  handleDisconnected(): void {
    if (this.active) this.stopActive('DISCONNECTED')
  }

  detachSession(): void {
    this.clockOffsetMs = 0
    this.stopActive('SIGNED_OUT')
  }

  dispose(): void {
    this.disposed = true
    this.stopActive('SHUTDOWN')
    this.channel = null
  }

  private connect(active: ActiveCapture): void {
    if (!this.isCurrent(active)) return
    if (this.nowMs() >= active.expiresAt) {
      this.stopActive('EXPIRED')
      return
    }

    const credentials = this.options.getCredentials()
    if (!credentials) {
      this.stopActive('SIGNED_OUT')
      return
    }

    let url: string
    try {
      url = getScreenStreamUrl(active.streamPath, active.liveSessionId)
    } catch {
      this.stopActive('FAILED', {
        code: 'SCREEN_LIVE_UNAVAILABLE',
        message: 'The live screen stream address was invalid.'
      })
      return
    }

    const headers = {
      Authorization: `Bearer ${credentials.accessToken}`,
      'X-Agent-Id': credentials.agentId,
      'X-Agent-Key': credentials.agentKey
    }

    let socket: WebSocket
    try {
      socket = this.options.createSocket
        ? this.options.createSocket(url, headers)
        : new WebSocket(url, { headers })
    } catch {
      this.scheduleReconnect(active)
      return
    }

    active.socket = socket
    active.ready = false

    socket.on('open', () => {
      if (!this.isCurrent(active)) return
      active.authRetried = false
    })

    socket.on('message', (raw: RawData, isBinary: boolean) => {
      if (!this.isCurrent(active) || isBinary) return
      let message: { type?: unknown }
      try {
        message = JSON.parse(raw.toString()) as { type?: unknown }
      } catch {
        return
      }
      if (message.type === 'live.ready') {
        this.startStreaming(active)
        return
      }
      if (message.type === 'live.stop') {
        this.stopActive('STOPPED')
      }
    })

    socket.on('unexpected-response', (_request: unknown, response: IncomingMessage) => {
      if (!this.isCurrent(active)) return
      const status = response.statusCode ?? 0
      response.resume()
      active.pendingUpgradeFailure = true
      active.socket = null
      socket.terminate()
      void this.handleUpgradeFailure(active, status)
    })

    socket.on('close', (code) => {
      if (!this.isCurrent(active)) return
      active.socket = null
      if (active.pendingUpgradeFailure) {
        active.pendingUpgradeFailure = false
        return
      }
      this.handleSocketClosed(active, code)
    })

    socket.on('error', () => {
      // The close handler owns stopping or reconnecting.
    })
  }

  private handleSocketClosed(active: ActiveCapture, code: number): void {
    this.clearFrameTimer(active)
    active.ready = false
    if (active.stopped) return

    if (code === 4000 || code === 1000 || code === 1001) {
      this.stopActive('ENDED')
      return
    }
    if (code === 4003) {
      this.stopActive('FAILED', {
        code: 'SCREEN_LIVE_REJECTED',
        message: 'The live screen server rejected the captured frames.'
      })
      return
    }
    this.scheduleReconnect(active)
  }

  private async handleUpgradeFailure(active: ActiveCapture, status: number): Promise<void> {
    if (!this.isCurrent(active)) return

    if (status === 401 && !active.authRetried) {
      active.authRetried = true
      try {
        if (await this.options.refreshAccessToken()) {
          this.connect(active)
          return
        }
      } catch {
        // Fall through to the reconnect backoff.
      }
    }

    if (status === 403 || status === 404 || status === 409 || status === 410) {
      this.stopActive('ENDED')
      return
    }

    this.scheduleReconnect(active)
  }

  private scheduleReconnect(active: ActiveCapture): void {
    if (!this.isCurrent(active) || active.reconnectTimer) return

    if (active.attempts >= RECONNECT_DELAYS_MS.length) {
      this.stopActive('ENDED', LOST_CONNECTION)
      return
    }

    const delay = RECONNECT_DELAYS_MS[active.attempts]
    active.attempts += 1
    if (this.nowMs() + delay >= active.expiresAt) {
      this.stopActive('EXPIRED')
      return
    }

    this.setState({ phase: 'reconnecting', reconnectAttempts: active.attempts })
    active.reconnectTimer = setTimeout(() => {
      active.reconnectTimer = null
      this.connect(active)
    }, delay)
    active.reconnectTimer.unref?.()
  }

  private startStreaming(active: ActiveCapture): void {
    if (!this.isCurrent(active) || active.ready) return
    active.ready = true
    active.attempts = 0
    active.authRetried = false
    this.setState({ phase: 'streaming', reconnectAttempts: 0, lastError: null })
    this.scheduleFrame(active, 0)
  }

  private scheduleFrame(active: ActiveCapture, delayMs: number): void {
    if (!this.isCurrent(active) || active.frameTimer) return
    const intervalMs = Math.max(
      MIN_FRAME_INTERVAL_MS,
      Math.floor(1000 / active.maxFps)
    )
    active.frameTimer = setTimeout(() => {
      active.frameTimer = null
      void this.captureTick(active, intervalMs)
    }, delayMs)
    active.frameTimer.unref?.()
  }

  private async captureTick(active: ActiveCapture, intervalMs: number): Promise<void> {
    if (!this.isCurrent(active) || !active.ready) return

    if (this.nowMs() >= active.expiresAt) {
      this.stopActive('EXPIRED')
      return
    }

    const socket = active.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    if (active.captureBusy) {
      this.scheduleFrame(active, intervalMs)
      return
    }
    if (socket.bufferedAmount > active.maxFrameBytes) {
      // The link is backed up. Skip this frame instead of queueing memory.
      this.scheduleFrame(active, intervalMs)
      return
    }

    active.captureBusy = true
    try {
      const frame = await this.options.capture({
        signal: active.controller.signal,
        maxWidth: active.maxFrameWidth,
        maxBytes: active.maxFrameBytes
      })
      if (!this.isCurrent(active) || !active.ready) return
      if (frame.bytes.length === 0 || frame.bytes.length > active.maxFrameBytes) {
        throw new ScreenshotOperationError(
          'CAPTURE_TOO_LARGE',
          'The live screen frame exceeded the server payload limit.'
        )
      }

      const target = active.socket
      if (!target || target.readyState !== WebSocket.OPEN) return
      target.send(frame.bytes, { binary: true })
      active.framesSent += 1
      active.lastFrameAt = frame.capturedAt
      this.setState({ framesSent: active.framesSent, lastFrameAt: frame.capturedAt })
    } catch (error) {
      if (!this.isCurrent(active)) return
      this.stopActive('FAILED', captureFailure(error))
      return
    } finally {
      active.captureBusy = false
      if (this.isCurrent(active) && active.ready) {
        this.scheduleFrame(active, intervalMs)
      }
    }
  }

  private scheduleExpiry(active: ActiveCapture): void {
    const delay = Math.max(0, active.expiresAt - this.nowMs()) + 250
    active.expiryTimer = setTimeout(() => {
      active.expiryTimer = null
      if (this.isCurrent(active)) this.stopActive('EXPIRED')
    }, delay)
    active.expiryTimer.unref?.()
  }

  private stopActive(reason: string, failure?: ReconnectFailure): void {
    const active = this.active
    if (!active) {
      if (failure) {
        this.setState({ phase: 'failed', lastError: failure })
      }
      return
    }

    this.active = null
    active.stopped = true
    active.ready = false
    active.controller.abort()
    this.clearFrameTimer(active)
    if (active.expiryTimer) {
      clearTimeout(active.expiryTimer)
      active.expiryTimer = null
    }
    if (active.reconnectTimer) {
      clearTimeout(active.reconnectTimer)
      active.reconnectTimer = null
    }

    const socket = active.socket
    active.socket = null
    if (socket) {
      try {
        if (socket.readyState === WebSocket.OPEN) {
          socket.close(1000, reason)
        } else {
          socket.terminate()
        }
      } catch {
        socket.terminate()
      }
    }

    this.setState({
      phase: failure ? 'failed' : reason === 'FAILED' ? 'failed' : 'idle',
      liveSessionId: null,
      framesSent: active.framesSent,
      lastFrameAt: active.lastFrameAt,
      lastError: failure ?? null,
      reconnectAttempts: 0
    })

    if (failure) {
      try {
        this.channel?.sendScreenLiveFailure(active.liveSessionId, failure.code, failure.message)
      } catch {
        // The JSON control channel may already be gone; the server expires the
        // session independently.
      }
    }
  }

  private clearFrameTimer(active: ActiveCapture): void {
    if (!active.frameTimer) return
    clearTimeout(active.frameTimer)
    active.frameTimer = null
  }

  private isCurrent(active: ActiveCapture): boolean {
    return this.active === active && !active.stopped && !this.disposed
  }

  private nowMs(): number {
    return (this.options.now?.() ?? Date.now()) + this.clockOffsetMs
  }

  private setState(patch: Partial<LiveScreenState>): void {
    this.state = { ...this.state, ...patch }
  }
}
