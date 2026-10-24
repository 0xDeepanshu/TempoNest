import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import { describe, expect, it } from 'vitest'

const BASE_URL = (process.env.TEMPO_API_BASE_URL ?? 'http://localhost:4000/api/v1').replace(
  /\/+$/,
  ''
)
const WS_URL = BASE_URL.replace(/^http/, 'ws') + '/ws/agent'
const PASSWORD = 'CorrectHorseBatteryStaple9!'
const describeE2E = process.env.TEMPO_E2E === '1' ? describe : describe.skip

interface ApiResponse<T> {
  status: number
  data: T | null
  error: { code: string; message: string } | null
}

async function api<T>(
  path: string,
  options: {
    method?: string
    token?: string
    agent?: { id: string; key: string }
    body?: unknown
  } = {}
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.token) headers.Authorization = `Bearer ${options.token}`
  if (options.agent) {
    headers['X-Agent-Id'] = options.agent.id
    headers['X-Agent-Key'] = options.agent.key
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  })

  const text = await response.text()
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : null
  const envelope = payload?.data as T | undefined
  const error = payload?.error as { code: string; message: string } | undefined
  return {
    status: response.status,
    data: envelope ?? null,
    error: error ?? null
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function openAgentSocket(headers: Record<string, string>): Promise<{
  socket: WebSocket
  connected: Record<string, unknown>
}> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(WS_URL, { headers })
    const timeout = setTimeout(() => {
      socket.terminate()
      reject(new Error('Timed out waiting for the agent WebSocket'))
    }, 8_000)

    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as Record<string, unknown>
      if (message.type === 'connected') {
        clearTimeout(timeout)
        resolve({ socket, connected: message })
      }
    })
    socket.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    socket.on('unexpected-response', (_request, response) => {
      clearTimeout(timeout)
      reject(new Error(`WebSocket upgrade failed with HTTP ${response.statusCode ?? 0}`))
    })
  })
}

function waitForClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for WebSocket close')), 8_000)
    socket.once('close', (code, reason) => {
      clearTimeout(timeout)
      resolve({ code, reason: reason.toString() })
    })
  })
}

describeE2E('real TempoNest backend integration', () => {
  it('authenticates, tracks, syncs offline events, rotates tokens and handles revocation', async () => {
    const health = await api<{ status: string }>('/health')
    expect(health.status).toBe(200)
    expect(health.data?.status).toBe('ok')

    const email = `electron.e2e.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@example.com`
    const register = await api('/auth/register', {
      method: 'POST',
      body: { name: 'Electron E2E', email, password: PASSWORD }
    })
    expect(register.status).toBe(201)

    const login = await api<{
      user: { id: string; email: string }
      accessToken: string
      refreshToken: string
      tokenType: string
      memberships: unknown[]
    }>('/auth/login', {
      method: 'POST',
      body: { email, password: PASSWORD, client: 'desktop' }
    })
    expect(login.status).toBe(200)
    expect(login.data?.tokenType).toBe('Bearer')
    expect(login.data?.accessToken).toBeTruthy()
    expect(login.data?.refreshToken).toBeTruthy()
    expect(login.data?.memberships).toEqual([])

    let accessToken = login.data!.accessToken
    const initialRefreshToken = login.data!.refreshToken

    const organization = await api<{
      organization: { id: string; name: string }
      membership: { role: string }
    }>('/organizations', {
      method: 'POST',
      token: accessToken,
      body: { name: `Electron E2E ${Date.now()}` }
    })
    expect(organization.status).toBe(201)
    expect(organization.data?.membership.role).toBe('OWNER')
    const organizationId = organization.data!.organization.id

    const deviceId = `electron-e2e-${Date.now()}`
    const registration = await api<{
      agent: { id: string; deviceId: string; status: string }
      agentKey: string
      rotated: boolean
    }>(`/organizations/${organizationId}/desktop-agents`, {
      method: 'POST',
      token: accessToken,
      body: {
        deviceId,
        name: 'Electron E2E device',
        platform: 'win32',
        appVersion: '0.1.0'
      }
    })
    expect(registration.status).toBe(201)
    expect(registration.data?.rotated).toBe(false)
    expect(registration.data?.agentKey.startsWith('tna_')).toBe(true)

    let agent = { id: registration.data!.agent.id, key: registration.data!.agentKey }

    const authenticatedAgent = await api<{
      agent: { id: string }
      organization: { id: string }
      user: { id: string }
    }>('/desktop-agents/authenticate', {
      method: 'POST',
      body: { agentId: agent.id, agentKey: agent.key }
    })
    expect(authenticatedAgent.status).toBe(200)
    expect(authenticatedAgent.data?.organization.id).toBe(organizationId)

    // Online start/break/resume/heartbeat/stop, all server-timestamped.
    const started = await api<{
      session: { id: string; startedAt: string; status: string; source: string }
      autoClosedSessionId: string | null
      serverTime: string
    }>(`/organizations/${organizationId}/time-sessions/start`, {
      method: 'POST',
      token: accessToken,
      agent
    })
    expect(started.status).toBe(201)
    expect(started.data?.session.status).toBe('ACTIVE')
    expect(started.data?.session.source).toBe('ONLINE')
    const sessionId = started.data!.session.id

    await delay(30)
    const onBreak = await api<{ session: { status: string }; breakId: string }>(
      `/organizations/${organizationId}/time-sessions/${sessionId}/breaks`,
      { method: 'POST', token: accessToken, agent }
    )
    expect(onBreak.status).toBe(201)
    expect(onBreak.data?.session.status).toBe('ON_BREAK')
    expect(onBreak.data?.breakId).toBeTruthy()

    await delay(30)
    const resumed = await api<{ session: { status: string }; breakId: string }>(
      `/organizations/${organizationId}/time-sessions/${sessionId}/breaks/end`,
      { method: 'POST', token: accessToken, agent }
    )
    expect(resumed.status).toBe(200)
    expect(resumed.data?.session.status).toBe('ACTIVE')

    const heartbeat = await api<{ session: { id: string } }>(
      `/organizations/${organizationId}/time-sessions/${sessionId}/heartbeat`,
      { method: 'POST', token: accessToken, agent }
    )
    expect(heartbeat.status).toBe(200)
    expect(heartbeat.data?.session.id).toBe(sessionId)

    await delay(30)
    const stopped = await api<{ session: { id: string; status: string; endedAt: string } }>(
      `/organizations/${organizationId}/time-sessions/${sessionId}/stop`,
      { method: 'POST', token: accessToken, agent }
    )
    expect(stopped.status).toBe(200)
    expect(stopped.data?.session.status).toBe('STOPPED')
    expect(stopped.data?.session.endedAt).toBeTruthy()

    const currentAfterStop = await api<{ session: unknown | null }>(
      `/organizations/${organizationId}/time-sessions/current`,
      { token: accessToken }
    )
    expect(currentAfterStop.data?.session).toBeNull()

    // The stopped session remains available as today's authoritative history
    // through the existing paginated list endpoint, including its breaks.
    const dayStart = new Date()
    dayStart.setHours(0, 0, 0, 0)
    const nextDayStart = new Date(dayStart)
    nextDayStart.setDate(nextDayStart.getDate() + 1)

    function dayPath(limit: number, page: number): string {
      const query = new URLSearchParams({
        from: dayStart.toISOString(),
        to: new Date(nextDayStart.getTime() - 1).toISOString(),
        limit: String(limit),
        page: String(page)
      })
      return `/organizations/${organizationId}/time-sessions?${query.toString()}`
    }

    interface ListedSession {
      id: string
      endedAt: string | null
      breaks?: Array<{ id: string; startedAt: string; endedAt: string | null }>
    }

    const todayList = await api<ListedSession[]>(dayPath(100, 1), { token: accessToken })
    expect(todayList.status).toBe(200)
    const listedStopped = todayList.data?.find((item) => item.id === sessionId)
    expect(listedStopped?.endedAt).toBeTruthy()
    expect(listedStopped?.breaks?.length).toBeGreaterThanOrEqual(1)
    expect(listedStopped?.breaks?.every((item) => item.endedAt !== null)).toBe(true)

    // Explicit offline reconciliation: applied, duplicate, then durable conflict.
    const offlineSessionId = randomUUID()
    const now = Date.now()
    const offlineEvents = [
      {
        eventId: randomUUID(),
        type: 'SESSION_START',
        occurredAt: new Date(now - 5 * 60_000).toISOString(),
        sessionId: offlineSessionId
      },
      {
        eventId: randomUUID(),
        type: 'BREAK_START',
        occurredAt: new Date(now - 4 * 60_000).toISOString(),
        sessionId: offlineSessionId
      },
      {
        eventId: randomUUID(),
        type: 'BREAK_END',
        occurredAt: new Date(now - 3 * 60_000).toISOString(),
        sessionId: offlineSessionId
      },
      {
        eventId: randomUUID(),
        type: 'SESSION_STOP',
        occurredAt: new Date(now - 2 * 60_000).toISOString(),
        sessionId: offlineSessionId
      }
    ]

    const sync = await api<{
      deviceId: string
      results: Array<{ eventId: string; status: string; code?: string }>
    }>(`/organizations/${organizationId}/time-sessions/sync`, {
      method: 'POST',
      token: accessToken,
      agent,
      body: { deviceId, events: offlineEvents }
    })
    expect(sync.status).toBe(200)
    expect(sync.data?.results.map((result) => result.status)).toEqual([
      'applied',
      'applied',
      'applied',
      'applied'
    ])

    // Offline-synced events appear in the same day list with their interval data,
    // which is what the Electron totals reconciliation reads after a relaunch.
    const afterSync = await api<ListedSession[]>(dayPath(100, 1), { token: accessToken })
    expect(afterSync.status).toBe(200)
    const listedOffline = afterSync.data?.find((item) => item.id === offlineSessionId)
    expect(listedOffline?.endedAt).toBeTruthy()
    expect(listedOffline?.breaks).toHaveLength(1)
    expect(listedOffline?.breaks?.[0].endedAt).toBeTruthy()

    const duplicate = await api<{
      results: Array<{ status: string; originalStatus?: string }>
    }>(`/organizations/${organizationId}/time-sessions/sync`, {
      method: 'POST',
      token: accessToken,
      agent,
      body: { deviceId, events: offlineEvents }
    })
    expect(duplicate.status).toBe(200)
    expect(duplicate.data?.results.every((result) => result.status === 'duplicate')).toBe(true)
    expect(duplicate.data?.results[0].originalStatus).toBe('APPLIED')

    const conflict = await api<{ results: Array<{ status: string; code?: string }> }>(
      `/organizations/${organizationId}/time-sessions/sync`,
      {
        method: 'POST',
        token: accessToken,
        agent,
        body: {
          deviceId,
          events: [
            {
              eventId: randomUUID(),
              type: 'SESSION_START',
              occurredAt: new Date(now - 60_000).toISOString(),
              sessionId: offlineSessionId
            }
          ]
        }
      }
    )
    expect(conflict.status).toBe(200)
    expect(conflict.data?.results[0].status).toBe('conflict')
    expect(conflict.data?.results[0].code).toBe('SESSION_ID_EXISTS')

    // Refresh rotates both tokens.
    const refreshed = await api<{
      accessToken: string
      refreshToken: string
    }>('/auth/refresh', {
      method: 'POST',
      body: { refreshToken: initialRefreshToken, client: 'desktop' }
    })
    expect(refreshed.status).toBe(200)
    expect(refreshed.data?.accessToken).toBeTruthy()
    expect(refreshed.data?.refreshToken).not.toBe(initialRefreshToken)
    accessToken = refreshed.data!.accessToken

    // Live WebSocket: participant receives connected state, then admin revocation
    // stops the active session and closes the socket with 4003.
    const socketSession = await api<{ session: { id: string } }>(
      `/organizations/${organizationId}/time-sessions/start`,
      { method: 'POST', token: accessToken, agent }
    )
    expect(socketSession.status).toBe(201)

    const { socket, connected } = await openAgentSocket({
      Authorization: `Bearer ${accessToken}`,
      'X-Agent-Id': agent.id,
      'X-Agent-Key': agent.key
    })
    expect(connected.type).toBe('connected')
    expect((connected.agent as { id: string }).id).toBe(agent.id)
    expect((connected.session as { id: string }).id).toBe(socketSession.data!.session.id)
    const closed = waitForClose(socket)

    const revoke = await api<{
      agent: { status: string }
      stoppedSessionIds: string[]
    }>(`/organizations/${organizationId}/desktop-agents/${agent.id}`, {
      method: 'DELETE',
      token: accessToken
    })
    expect(revoke.status).toBe(200)
    expect(revoke.data?.agent.status).toBe('REVOKED')
    expect(revoke.data?.stoppedSessionIds).toContain(socketSession.data!.session.id)

    const closeEvent = await closed
    expect(closeEvent.code).toBe(4003)

    const afterRevoke = await api<{ session: unknown | null }>(
      `/organizations/${organizationId}/time-sessions/current`,
      { token: accessToken }
    )
    expect(afterRevoke.data?.session).toBeNull()

    // Reusing the old rotated token revokes the session family.
    const reuse = await api('/auth/refresh', {
      method: 'POST',
      body: { refreshToken: initialRefreshToken, client: 'desktop' }
    })
    expect(reuse.status).toBe(401)

    const afterReuse = await api('/auth/me', { token: accessToken })
    expect(afterReuse.status).toBe(401)
  })
})
