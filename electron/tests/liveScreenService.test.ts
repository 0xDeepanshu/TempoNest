import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import type { PendingScreenLiveSession, ScreenLiveStartCommand } from '../electron/backendTypes'
import type { LiveFrameCapture } from '../electron/screenCapture'
import { ScreenshotOperationError } from '../electron/screenshotErrors'
import { LiveScreenService } from '../electron/liveScreenService'

class FakeSocket extends EventEmitter {
  readyState: number = WebSocket.CONNECTING
  bufferedAmount = 0
  readonly sent: Array<{ data: Buffer; binary?: boolean }> = []
  readonly closes: Array<{ code: number; reason: string }> = []

  constructor(
    readonly url: string,
    readonly headers: Record<string, string>
  ) {
    super()
  }

  send(data: Buffer, options?: { binary?: boolean }): void {
    this.sent.push({ data: Buffer.from(data), binary: options?.binary })
  }

  close(code: number, reason: string): void {
    this.closes.push({ code, reason })
    this.readyState = WebSocket.CLOSED
    setImmediate(() => this.emit('close', code, Buffer.from(reason)))
  }

  terminate(): void {
    this.readyState = WebSocket.CLOSED
    this.emit('close', 1006, Buffer.alloc(0))
  }

  open(): void {
    this.readyState = WebSocket.OPEN
    this.emit('open')
  }

  receive(payload: Record<string, unknown>): void {
    this.emit('message', Buffer.from(JSON.stringify(payload)), false)
  }
}

function command(
  overrides: Partial<ScreenLiveStartCommand> = {}
): ScreenLiveStartCommand {
  return {
    type: 'screen.live.start',
    liveSessionId: randomUUID(),
    timeSessionId: randomUUID(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    maxFps: 2,
    maxFrameWidth: 1600,
    maxFrameBytes: 2_097_152,
    streamPath: '/api/v1/ws/screen-stream',
    ...overrides
  }
}

function createHarness(options: { capture?: LiveFrameCapture } = {}) {
  const sockets: FakeSocket[] = []
  const reports: Array<{ liveSessionId: string; code: string; message: string }> = []
  const capture =
    options.capture ??
    (vi.fn<LiveFrameCapture>(async () => ({
      bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      capturedAt: new Date().toISOString(),
      width: 1280,
      height: 720
    })) as unknown as LiveFrameCapture)

  const refreshAccessToken = vi.fn(async () => true)
  const service = new LiveScreenService({
    getCredentials: () => ({ accessToken: 'token-1', agentId: 'agent-1', agentKey: 'key-1' }),
    refreshAccessToken,
    capture,
    createSocket: (url, headers) => {
      const socket = new FakeSocket(url, headers)
      sockets.push(socket)
      return socket as unknown as WebSocket
    }
  })
  service.setControlChannel({
    sendScreenLiveFailure: (liveSessionId, code, message) =>
      reports.push({ liveSessionId, code, message })
  })

  return { service, sockets, reports, capture, refreshAccessToken }
}

async function settle(times = 3): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('LiveScreenService', () => {
  it('connects to the dedicated binary stream and captures only after live.ready', async () => {
    const harness = createHarness()
    const start = command()

    harness.service.handleStart(start)

    expect(harness.sockets).toHaveLength(1)
    const socket = harness.sockets[0]
    expect(socket.url).toContain('/api/v1/ws/screen-stream')
    expect(socket.url).toContain(`liveSessionId=${start.liveSessionId}`)
    expect(socket.headers.Authorization).toBe('Bearer token-1')
    expect(socket.headers['X-Agent-Id']).toBe('agent-1')
    expect(socket.headers['X-Agent-Key']).toBe('key-1')

    await settle()
    expect(harness.capture).not.toHaveBeenCalled()

    socket.open()
    socket.receive({ type: 'live.ready', liveSessionId: start.liveSessionId })
    await vi.waitFor(() => expect(harness.capture).toHaveBeenCalled(), { timeout: 1_000 })

    await vi.waitFor(() => expect(socket.sent.length).toBeGreaterThan(0), { timeout: 1_000 })
    expect(socket.sent[0].binary).toBe(true)
    expect(socket.sent[0].data.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]))
    expect(harness.service.getState().phase).toBe('streaming')
    expect(harness.service.getState().framesSent).toBeGreaterThan(0)

    const captureOptions = (harness.capture as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(captureOptions.maxWidth).toBe(1600)
    expect(captureOptions.maxBytes).toBe(2_097_152)

    harness.service.handleStop(start.liveSessionId)
    expect(harness.service.getState().phase).toBe('idle')
    expect(socket.closes.at(-1)?.reason).toBe('STOPPED')
  })

  it('stops capture immediately when the server sends live.stop', async () => {
    const harness = createHarness()
    const start = command()
    harness.service.handleStart(start)
    const socket = harness.sockets[0]

    socket.open()
    socket.receive({ type: 'live.ready' })
    await vi.waitFor(() => expect(harness.capture).toHaveBeenCalled(), { timeout: 1_000 })

    socket.receive({ type: 'live.stop', reason: 'VIEWER_STOPPED' })
    const callsAtStop = (harness.capture as unknown as ReturnType<typeof vi.fn>).mock.calls.length

    await new Promise((resolve) => setTimeout(resolve, 700))
    expect((harness.capture as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      callsAtStop
    )
    expect(harness.service.getState().phase).toBe('idle')
    expect(harness.reports).toHaveLength(0)
  })

  it('reports a capture failure over the JSON channel and stops', async () => {
    const failure = new ScreenshotOperationError(
      'OS_PERMISSION_DENIED',
      'Screen Recording permission is not granted.'
    )
    const harness = createHarness({ capture: vi.fn(async () => Promise.reject(failure)) })
    const start = command()
    harness.service.handleStart(start)
    const socket = harness.sockets[0]

    socket.open()
    socket.receive({ type: 'live.ready' })

    await vi.waitFor(() => expect(harness.reports).toHaveLength(1), { timeout: 1_000 })
    expect(harness.reports[0]).toMatchObject({
      liveSessionId: start.liveSessionId,
      code: 'OS_PERMISSION_DENIED'
    })
    expect(harness.service.getState().phase).toBe('failed')

    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(harness.reports).toHaveLength(1)
  })

  it('stops on expiry without reporting a failure', async () => {
    const harness = createHarness()
    const start = command({ expiresAt: new Date(Date.now() + 40).toISOString() })
    harness.service.handleStart(start)
    const socket = harness.sockets[0]
    socket.open()
    socket.receive({ type: 'live.ready' })

    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(harness.service.getState().phase).toBe('idle')
    expect(harness.service.getState().liveSessionId).toBeNull()
    expect(harness.reports).toHaveLength(0)
  })

  it('stops when the JSON agent socket disconnects or the session is no longer pending', async () => {
    const harness = createHarness()
    const start = command()
    harness.service.handleStart(start)
    const socket = harness.sockets[0]
    socket.open()
    socket.receive({ type: 'live.ready' })
    await vi.waitFor(() => expect(harness.capture).toHaveBeenCalled(), { timeout: 1_000 })

    harness.service.handleDisconnected()
    expect(harness.service.getState().phase).toBe('idle')
    expect(socket.closes.at(-1)?.code).toBe(1000)

    const second = command()
    harness.service.handleStart(second)
    expect(harness.service.getState().liveSessionId).toBe(second.liveSessionId)
    harness.service.handlePending(null)
    expect(harness.service.getState().liveSessionId).toBeNull()
  })

  it('resumes from a pending session delivered on reconnect', async () => {
    const harness = createHarness()
    const pending: PendingScreenLiveSession = {
      liveSessionId: randomUUID(),
      timeSessionId: randomUUID(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      maxFps: 2,
      maxFrameWidth: 1600,
      maxFrameBytes: 2_097_152,
      streamPath: '/api/v1/ws/screen-stream'
    }

    harness.service.handlePending(pending)
    expect(harness.sockets).toHaveLength(1)
    expect(harness.sockets[0].url).toContain(`liveSessionId=${pending.liveSessionId}`)
  })

  it('replaces capture when the server starts a different live session', () => {
    const harness = createHarness()
    harness.service.handleStart(command())
    const first = harness.sockets[0]

    const next = command()
    harness.service.handleStart(next)

    expect(harness.sockets).toHaveLength(2)
    expect(first.readyState).toBe(WebSocket.CLOSED)
    expect(harness.service.getState().liveSessionId).toBe(next.liveSessionId)
  })

  it('ignores malformed commands and stops on shutdown', () => {
    const harness = createHarness()
    harness.service.handleStart({
      ...command(),
      liveSessionId: 'not-a-uuid'
    })
    expect(harness.sockets).toHaveLength(0)
    expect(harness.service.getState().phase).toBe('failed')

    harness.service.handleStart(command())
    const socket = harness.sockets[0]
    harness.service.dispose()
    expect(harness.service.getState().phase).toBe('idle')
    expect(socket.closes.length + (socket.readyState === WebSocket.CLOSED ? 1 : 0)).toBeGreaterThan(0)
  })

  it('refreshes the access token once after a 401 upgrade response', async () => {
    const harness = createHarness()
    const start = command()
    harness.service.handleStart(start)
    const socket = harness.sockets[0] as unknown as EventEmitter & {
      emit: (event: string, ...args: unknown[]) => boolean
      terminate: () => void
    }

    const response = { statusCode: 401, resume: vi.fn() }
    socket.emit('unexpected-response', {}, response)
    await settle()

    expect(harness.refreshAccessToken).toHaveBeenCalledTimes(1)
    expect(harness.sockets).toHaveLength(2)
  })
})
