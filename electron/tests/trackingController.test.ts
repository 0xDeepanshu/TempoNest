import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthSession } from '../src/types/auth'
import type {
  BackendSessionEnvelope,
  BackendTimeSession,
  OfflineEvent,
  OfflineSyncResult
} from '../electron/backendTypes'
import { NetworkError } from '../electron/errors'
import { OfflineQueue } from '../electron/offlineQueue'
import { TrackingController } from '../electron/trackingController'
import type { AgentManager } from '../electron/agentManager'
import type { AuthManager } from '../electron/authManager'

vi.mock('../electron/agentSocket', () => ({
  AgentSocket: class {
    isOpen = false
    connect(): void {}
    disconnect(): void {}
  }
}))

const USER_ID = 'user-1'
const ORG_ID = 'org-1'
const SESSION_ID = '9e743d59-3e42-4e3e-8e0d-8a4d6f8b1c11'
const NOW = '2026-10-24T09:00:00.000Z'

const session: AuthSession = {
  employee: {
    id: USER_ID,
    organizationId: ORG_ID,
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    initials: 'AL',
    jobTitle: '',
    team: ''
  },
  membership: {
    employeeId: USER_ID,
    organization: { id: ORG_ID, name: 'Acme', slug: 'acme' },
    role: 'employee'
  },
  authenticatedAt: NOW
}

const credentials = {
  id: 'agent-1',
  key: 'tna_key',
  deviceId: 'device-1',
  organizationId: ORG_ID,
  userId: USER_ID
}

function backendSession(overrides: Partial<BackendTimeSession> = {}): BackendTimeSession {
  return {
    id: SESSION_ID,
    organizationId: ORG_ID,
    employeeId: USER_ID,
    desktopAgentId: credentials.id,
    startedAt: '2026-10-24T08:00:00.000Z',
    endedAt: null,
    status: 'ACTIVE',
    source: 'ONLINE',
    lastHeartbeatAt: null,
    heartbeatFresh: true,
    activeBreak: null,
    createdAt: '2026-10-24T08:00:00.000Z',
    updatedAt: '2026-10-24T08:00:00.000Z',
    ...overrides
  }
}

const opened: TrackingController[] = []
const directories: string[] = []

function queuePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'temponest-controller-'))
  directories.push(directory)
  return join(directory, 'queue.json')
}

function createHarness(
  handler: (path: string, options?: { body?: unknown }) => Promise<unknown>,
  path = queuePath()
) {
  const queue = new OfflineQueue(path)
  const calls: Array<{ path: string; body?: unknown }> = []
  const request = vi.fn(async (requestPath: string, options?: { body?: unknown }) => {
    calls.push({ path: requestPath, body: options?.body })
    return handler(requestPath, options)
  })

  const auth = {
    client: { request },
    getAccessToken: () => 'access-token',
    refreshAccessToken: async () => true,
    invalidateSession: async () => undefined
  }
  const agents = {
    ensureAgent: async () => credentials,
    getCredentials: () => credentials,
    rotateAgent: async () => credentials,
    forgetAgent: () => undefined
  }

  const controller = new TrackingController({
    auth: auth as unknown as AuthManager,
    agents: agents as unknown as AgentManager,
    queue,
    websocketUrl: 'ws://127.0.0.1:1'
  })
  opened.push(controller)
  return { controller, queue, request, calls, path }
}

function currentActive(): { session: BackendTimeSession; serverTime: string } {
  return { session: backendSession(), serverTime: NOW }
}

function syncApplied(): (path: string, options?: { body?: unknown }) => Promise<OfflineSyncResult> {
  return async (_path, options) => {
    const body = options?.body as { deviceId: string; events: OfflineEvent[] }
    return {
      deviceId: body.deviceId,
      serverTime: NOW,
      results: body.events.map((event) => ({
        eventId: event.eventId,
        type: event.type,
        status: 'applied' as const
      }))
    }
  }
}

afterEach(() => {
  for (const controller of opened.splice(0)) controller.dispose()
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('TrackingController shutdown', () => {
  it('stops the active server session exactly once for overlapping shutdown calls', async () => {
    let stops = 0
    const { controller, queue, calls } = createHarness(async (path) => {
      if (path.endsWith('/time-sessions/current')) return currentActive()
      if (path.endsWith('/time-sessions/sync')) return syncApplied()(path)
      if (path.endsWith('/stop')) {
        stops += 1
        return {
          session: backendSession({ endedAt: NOW, status: 'STOPPED' }),
          serverTime: NOW
        } satisfies BackendSessionEnvelope
      }
      throw new Error(`Unexpected request: ${path}`)
    })

    controller.attachSession(session)
    await controller.restore()

    await Promise.all([controller.shutdown(), controller.shutdown()])

    expect(stops).toBe(1)
    expect(calls.filter((call) => call.path.endsWith('/stop'))).toHaveLength(1)
    expect(queue.count()).toBe(0)
  })

  it('keeps a durable pending stop when the server is unreachable', async () => {
    let stops = 0
    const { controller, queue } = createHarness(async (path) => {
      if (path.endsWith('/time-sessions/current')) return currentActive()
      if (path.endsWith('/time-sessions/sync')) return syncApplied()(path)
      if (path.endsWith('/stop')) {
        stops += 1
        throw new NetworkError()
      }
      throw new Error(`Unexpected request: ${path}`)
    })

    controller.attachSession(session)
    await controller.restore()
    await controller.shutdown()

    expect(stops).toBe(1)
    const events = queue.all()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'SESSION_STOP', sessionId: SESSION_ID })
    expect(Number.isFinite(Date.parse(events[0].occurredAt))).toBe(true)
  })

  it('queues a stop for an offline session that only exists in the queue', async () => {
    const path = queuePath()
    const seed = new OfflineQueue(path)
    seed.bindUser(USER_ID)
    seed.append({
      eventId: 'event-00000001',
      type: 'SESSION_START',
      occurredAt: '2026-10-24T08:00:00.000Z',
      sessionId: SESSION_ID
    })

    const { controller, queue, calls } = createHarness(async (requestPath) => {
      if (requestPath.endsWith('/time-sessions/sync')) throw new NetworkError()
      if (requestPath.endsWith('/time-sessions/current')) throw new NetworkError()
      throw new Error(`Unexpected request: ${requestPath}`)
    }, path)

    controller.attachSession(session)
    await controller.shutdown()

    const events = queue.all()
    expect(events.map((event) => event.type)).toEqual(['SESSION_START', 'SESSION_STOP'])
    expect(events[1].sessionId).toBe(SESSION_ID)
    expect(calls.some((call) => call.path.endsWith('/stop'))).toBe(false)
  })
})

describe('TrackingController.detachSession', () => {
  it('keeps pending events for involuntary invalidation and clears them on sign-out', () => {
    const path = queuePath()
    const seed = new OfflineQueue(path)
    seed.bindUser(USER_ID)
    seed.append({
      eventId: 'event-00000003',
      type: 'SESSION_STOP',
      occurredAt: '2026-10-24T08:30:00.000Z',
      sessionId: SESSION_ID
    })

    const { controller, queue } = createHarness(async () => {
      throw new NetworkError()
    }, path)

    controller.detachSession()
    expect(queue.count()).toBe(1)

    controller.detachSession(true)
    expect(queue.count()).toBe(0)
  })
})

describe('TrackingController launch reconciliation', () => {
  it('flushes the pending stop before fetching current state after relaunch', async () => {    const path = queuePath()
    const first = createHarness(async (requestPath) => {
      if (requestPath.endsWith('/time-sessions/current')) return currentActive()
      if (requestPath.endsWith('/stop')) throw new NetworkError()
      throw new Error(`Unexpected request: ${requestPath}`)
    }, path)

    first.controller.attachSession(session)
    await first.controller.restore()
    await first.controller.shutdown()
    expect(first.queue.count()).toBe(1)
    first.controller.dispose()

    const second = createHarness(async (requestPath, options) => {
      if (requestPath.endsWith('/time-sessions/sync')) return syncApplied()(requestPath, options)
      if (requestPath.endsWith('/time-sessions/current')) {
        return { session: null, serverTime: NOW }
      }
      throw new Error(`Unexpected request: ${requestPath}`)
    }, path)

    second.controller.attachSession(session)
    const snapshot = await second.controller.restore()

    expect(second.queue.count()).toBe(0)
    expect(snapshot?.status).toBe('idle')
    expect(snapshot?.session).toBeNull()

    const syncIndex = second.calls.findIndex((call) => call.path.endsWith('/sync'))
    const currentIndex = second.calls.findIndex((call) => call.path.endsWith('/current'))
    expect(syncIndex).toBeGreaterThanOrEqual(0)
    expect(currentIndex).toBeGreaterThan(syncIndex)
  })

  it('returns an idle snapshot when the queue ends in a stop but the server is offline', async () => {
    const path = queuePath()
    const queue = new OfflineQueue(path)
    queue.bindUser(USER_ID)
    queue.append({
      eventId: 'event-00000002',
      type: 'SESSION_STOP',
      occurredAt: '2026-10-24T08:30:00.000Z',
      sessionId: SESSION_ID
    })

    const { controller } = createHarness(async () => {
      throw new NetworkError()
    }, path)

    controller.attachSession(session)
    const snapshot = await controller.restore()

    expect(snapshot?.status).toBe('idle')
    expect(snapshot?.session).toBeNull()
    // The stop time lets the renderer close the cached session and keep its minutes.
    expect(snapshot?.pendingStopAt).toBe('2026-10-24T08:30:00.000Z')
  })
})

function localDayIso(hours: number, minutes = 0, dayOffset = 0): string {
  const date = new Date()
  date.setDate(date.getDate() + dayOffset)
  date.setHours(hours, minutes, 0, 0)
  return date.toISOString()
}

function listRequest(path: string): boolean {
  return path.includes('/time-sessions?')
}

describe('TrackingController today sessions', () => {
  it('loads a stopped session that ended before the app was reopened', async () => {
    const stopped = backendSession({
      id: SESSION_ID,
      startedAt: localDayIso(9, 0),
      endedAt: localDayIso(9, 55),
      status: 'STOPPED',
      source: 'OFFLINE',
      breaks: [
        {
          id: 'break-1',
          sessionId: SESSION_ID,
          startedAt: localDayIso(9, 15),
          endedAt: localDayIso(9, 25),
          status: 'ENDED'
        }
      ]
    })

    const { controller } = createHarness(async (path) => {
      if (listRequest(path)) return [stopped]
      if (path.endsWith('/time-sessions/current')) {
        return { session: null, serverTime: NOW }
      }
      throw new Error(`Unexpected request: ${path}`)
    })

    controller.attachSession(session)
    const snapshot = await controller.restore()

    expect(snapshot?.status).toBe('idle')
    expect(snapshot?.session).toBeNull()
    expect(snapshot?.totalsError).toBeUndefined()
    expect(snapshot?.todaySessions).toHaveLength(1)
    expect(snapshot?.todaySessions?.[0]).toMatchObject({
      id: SESSION_ID,
      startedAt: localDayIso(9, 0),
      endedAt: localDayIso(9, 55)
    })
    expect(snapshot?.todaySessions?.[0].breaks).toEqual([
      { id: 'break-1', startedAt: localDayIso(9, 15), endedAt: localDayIso(9, 25) }
    ])
  })

  it('queries the current local day through the paginated list endpoint', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      backendSession({
        id: `session-${index}`,
        startedAt: localDayIso(8, index % 60),
        endedAt: localDayIso(8, (index % 60) + 1)
      })
    )
    const secondPage = [
      backendSession({
        id: 'session-last',
        startedAt: localDayIso(7, 0),
        endedAt: localDayIso(7, 55)
      })
    ]
    const pages: number[] = []

    const { controller, calls } = createHarness(async (path) => {
      if (listRequest(path)) {
        const page = Number(new URL(path, 'http://localhost').searchParams.get('page'))
        pages.push(page)
        return page === 1 ? firstPage : secondPage
      }
      if (path.endsWith('/time-sessions/current')) {
        return { session: null, serverTime: NOW }
      }
      throw new Error(`Unexpected request: ${path}`)
    })

    controller.attachSession(session)
    const snapshot = await controller.restore()

    expect(pages).toContain(1)
    expect(pages).toContain(2)
    expect(pages).not.toContain(3)
    expect(snapshot?.todaySessions).toHaveLength(101)

    const listCall = calls.find((call) => listRequest(call.path))
    const query = new URL(listCall?.path ?? '', 'http://localhost').searchParams
    expect(query.get('limit')).toBe('100')
    const from = new Date(query.get('from') ?? '')
    const to = new Date(query.get('to') ?? '')
    const expectedStart = new Date()
    expectedStart.setHours(0, 0, 0, 0)
    const expectedEnd = new Date(expectedStart)
    expectedEnd.setDate(expectedEnd.getDate() + 1)
    expect(from.getTime()).toBe(expectedStart.getTime())
    expect(to.getTime()).toBe(expectedEnd.getTime() - 1)
  })

  it('keeps only sessions for the authenticated employee and local day', async () => {
    const mine = backendSession({
      id: 'mine',
      startedAt: localDayIso(9, 0),
      endedAt: localDayIso(9, 55)
    })
    const otherEmployee = backendSession({
      id: 'other-employee',
      employeeId: 'user-2',
      startedAt: localDayIso(9, 0),
      endedAt: localDayIso(9, 55)
    })
    const otherOrganization = backendSession({
      id: 'other-org',
      organizationId: 'org-2',
      startedAt: localDayIso(9, 0),
      endedAt: localDayIso(9, 55)
    })
    const yesterday = backendSession({
      id: 'yesterday',
      startedAt: localDayIso(9, 0, -1),
      endedAt: localDayIso(10, 0, -1)
    })
    const tomorrow = backendSession({
      id: 'tomorrow',
      startedAt: localDayIso(9, 0, 1),
      endedAt: localDayIso(10, 0, 1)
    })
    const overnight = backendSession({
      id: 'overnight',
      startedAt: localDayIso(23, 0, -1),
      endedAt: localDayIso(0, 30)
    })

    const { controller } = createHarness(async (path) => {
      if (listRequest(path)) {
        return [mine, otherEmployee, otherOrganization, yesterday, tomorrow, overnight]
      }
      if (path.endsWith('/time-sessions/current')) {
        return { session: null, serverTime: NOW }
      }
      throw new Error(`Unexpected request: ${path}`)
    })

    controller.attachSession(session)
    const snapshot = await controller.restore()

    expect(snapshot?.todaySessions?.map((item) => item.id).sort()).toEqual(['mine', 'overnight'])
  })

  it('marks totals unverified without discarding the reconciled timer when the list fails', async () => {
    const { controller } = createHarness(async (path) => {
      if (listRequest(path)) throw new NetworkError()
      if (path.endsWith('/time-sessions/current')) return currentActive()
      throw new Error(`Unexpected request: ${path}`)
    })

    controller.attachSession(session)
    const snapshot = await controller.restore()

    expect(snapshot?.session?.id).toBe(SESSION_ID)
    expect(snapshot?.todaySessions).toBeUndefined()
    expect(snapshot?.totalsError?.code).toBe('TOTALS_UNAVAILABLE')
  })
})
