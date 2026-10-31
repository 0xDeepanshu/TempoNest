import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActivityQueue } from '../electron/activityQueue'
import { ActivityStateStore } from '../electron/activityState'
import { ActivityTrackingService } from '../electron/activityTrackingService'
import type { ActivityApiClient } from '../electron/activityTrackingService'
import type {
  ApplicationActivityPayload,
  BackendTrackingSettings,
  IdleIntervalPayload
} from '../electron/backendTypes'
import { ApiError, NetworkError } from '../electron/errors'
import type {
  ForegroundApp,
  ForegroundAppListener,
  ForegroundAppSource
} from '../electron/foregroundApp'
import type { SystemActivitySignals } from '../electron/systemActivity'
import type { AuthSession } from '../src/types/auth'
import type { TrackingSnapshot } from '../src/types/electron'

const NOW = Date.parse('2026-10-23T12:00:00.000Z')
const SESSION_STARTED = NOW - 60 * 60_000

const AUTH_SESSION: AuthSession = {
  employee: {
    id: 'user-1',
    organizationId: 'org-1',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    initials: 'AL',
    jobTitle: 'Engineer',
    team: ''
  },
  membership: {
    employeeId: 'user-1',
    organization: { id: 'org-1', name: 'Acme', slug: 'acme' },
    role: 'employee'
  },
  authenticatedAt: new Date(NOW).toISOString()
}

const CODE: ForegroundApp = { identifier: 'code', name: 'Visual Studio Code' }
const SLACK: ForegroundApp = { identifier: 'slack', name: 'Slack' }

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

function workingSnapshot(startedAt = SESSION_STARTED): TrackingSnapshot {
  return {
    status: 'working',
    serverTime: iso(NOW),
    session: {
      id: 'session-1',
      startedAt: iso(startedAt),
      endedAt: null,
      breaks: []
    }
  }
}

function breakSnapshot(breakStartedAt: number): TrackingSnapshot {
  return {
    status: 'on_break',
    serverTime: iso(breakStartedAt),
    session: {
      id: 'session-1',
      startedAt: iso(SESSION_STARTED),
      endedAt: null,
      breaks: [{ id: 'break-1', startedAt: iso(breakStartedAt), endedAt: null }]
    }
  }
}

function idleSnapshot(): TrackingSnapshot {
  return {
    status: 'idle',
    serverTime: iso(NOW),
    session: null
  }
}

class FakeDetector implements ForegroundAppSource {
  readonly supported: boolean
  readonly limitation: string | null
  listener: ForegroundAppListener | null = null
  onFailure: ((message: string) => void) | null = null
  starts = 0
  stops = 0

  constructor(supported = true, limitation: string | null = null) {
    this.supported = supported
    this.limitation = limitation
  }

  start(listener: ForegroundAppListener, onFailure?: (message: string) => void): void {
    this.starts += 1
    this.listener = listener
    this.onFailure = onFailure ?? null
  }

  stop(): void {
    if (this.listener) this.stops += 1
    this.listener = null
    this.onFailure = null
  }

  emit(app: ForegroundApp | null): void {
    this.listener?.(app)
  }

  fail(message: string): void {
    this.onFailure?.(message)
  }
}

class FakeSignals implements SystemActivitySignals {
  idleSeconds = 0
  private suspendListener: (() => void) | null = null
  private resumeListener: (() => void) | null = null

  getSystemIdleSeconds(): number {
    return this.idleSeconds
  }

  onSuspend(listener: () => void): () => void {
    this.suspendListener = listener
    return () => {
      this.suspendListener = null
    }
  }

  onResume(listener: () => void): () => void {
    this.resumeListener = listener
    return () => {
      this.resumeListener = null
    }
  }

  suspend(): void {
    this.suspendListener?.()
  }

  resume(): void {
    this.resumeListener?.()
  }
}

type PolicyOverrides = Partial<
  Pick<
    BackendTrackingSettings,
    'appTrackingEnabled' | 'idleDetectionEnabled' | 'idleThresholdMinutes' | 'policyVersion'
  >
>

interface Harness {
  service: ActivityTrackingService
  queue: ActivityQueue
  state: ActivityStateStore
  detector: FakeDetector
  signals: FakeSignals
  calls: Array<{ path: string; options?: { body?: unknown } }>
  setPolicy: (overrides: PolicyOverrides) => void
  setSettingsError: (error: Error | null) => void
  setAppHandler: (handler: ((events: ApplicationActivityPayload[]) => unknown) | null) => void
  setIdleHandler: (handler: ((intervals: IdleIntervalPayload[]) => unknown) | null) => void
}

function appResponse(events: ApplicationActivityPayload[], status = 'accepted') {
  return {
    received: events.length,
    accepted: status === 'accepted' ? events.length : 0,
    duplicated: status === 'duplicate' ? events.length : 0,
    rejected: status === 'rejected' ? events.length : 0,
    results: events.map((event) => ({
      idempotencyKey: event.idempotencyKey,
      status,
      ...(status === 'accepted' ? { activityId: `activity-${event.idempotencyKey}` } : {}),
      ...(status === 'rejected' ? { code: 'EVENT_OVERLAP', message: 'Overlaps a known event.' } : {})
    })),
    disclaimer: 'Server computed productivity.'
  }
}

function idleResponse(intervals: IdleIntervalPayload[], thresholdSeconds: number) {
  return {
    received: intervals.length,
    accepted: intervals.length,
    duplicated: 0,
    rejected: 0,
    results: intervals.map((interval) => ({
      idempotencyKey: interval.idempotencyKey,
      status: 'accepted',
      idleIntervalId: `idle-${interval.idempotencyKey}`
    })),
    thresholdSeconds,
    disclaimer: 'Server computed productivity.'
  }
}

function createHarness(
  options: {
    policy?: PolicyOverrides
    settingsError?: Error | null
    detectorSupported?: boolean
    detectorLimitation?: string | null
    seedState?: (state: ActivityStateStore) => void
  } = {}
): Harness {
  const directory = mkdtempSync(join(tmpdir(), 'temponest-activity-service-'))
  const queue = new ActivityQueue(join(directory, 'activity-queue.json'))
  const state = new ActivityStateStore(join(directory, 'activity-state.json'))
  options.seedState?.(state)

  const policy: BackendTrackingSettings = {
    organizationId: 'org-1',
    appTrackingEnabled: true,
    idleDetectionEnabled: false,
    idleThresholdMinutes: 5,
    productivityClassificationEnabled: true,
    activityRetentionDays: 30,
    policyVersion: 7,
    policyUpdatedAt: iso(NOW),
    updatedAt: iso(NOW),
    ...options.policy
  }

  let settingsError = options.settingsError ?? null
  let appHandler: ((events: ApplicationActivityPayload[]) => unknown) | null = null
  let idleHandler: ((intervals: IdleIntervalPayload[]) => unknown) | null = null
  const calls: Harness['calls'] = []
  const detector = new FakeDetector(
    options.detectorSupported ?? true,
    options.detectorLimitation ?? null
  )
  const signals = new FakeSignals()

  const request = vi.fn(async (path: string, requestOptions?: { body?: unknown }) => {
    calls.push({ path, options: requestOptions })
    if (path.endsWith('/activity/settings')) {
      if (settingsError) throw settingsError
      return { settings: { ...policy } }
    }
    if (path.endsWith('/application-activities/batch')) {
      const events = (requestOptions?.body as { events: ApplicationActivityPayload[] }).events
      return appHandler ? await appHandler(events) : appResponse(events)
    }
    if (path.endsWith('/idle-intervals/batch')) {
      const intervals = (requestOptions?.body as { intervals: IdleIntervalPayload[] }).intervals
      return idleHandler
        ? await idleHandler(intervals)
        : idleResponse(intervals, policy.idleThresholdMinutes * 60)
    }
    throw new Error(`Unexpected API call: ${path}`)
  })

  const service = new ActivityTrackingService({
    client: { request } as unknown as ActivityApiClient,
    getCredentials: () => ({ id: 'agent-1', key: 'agent-secret-key' }),
    getDeviceId: () => 'device-1',
    queue,
    state,
    detector,
    signals,
    platform: 'win32',
    settingsRefreshIntervalMs: 60 * 60_000,
    uploadTickMs: 30_000,
    idlePollIntervalMs: 5_000,
    maxBackoffMs: 4_000,
    batchSize: 200
  })

  return {
    service,
    queue,
    state,
    detector,
    signals,
    calls,
    setPolicy(overrides) {
      Object.assign(policy, overrides)
    },
    setSettingsError(error) {
      settingsError = error
    },
    setAppHandler(handler) {
      appHandler = handler
    },
    setIdleHandler(handler) {
      idleHandler = handler
    }
  }
}

function setNow(ms: number): void {
  vi.setSystemTime(ms)
}

async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}

async function attachWorking(
  harness: Harness,
  snapshot: TrackingSnapshot = workingSnapshot()
): Promise<void> {
  harness.service.attachSession(AUTH_SESSION)
  await harness.service.refreshSettings()
  harness.service.setTrackingSnapshot(snapshot)
  await vi.advanceTimersByTimeAsync(0)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('ActivityTrackingService policy gating', () => {
  it('does not collect before authentication and a successful policy fetch', async () => {
    const harness = createHarness({ settingsError: new NetworkError('offline') })

    harness.service.attachSession(AUTH_SESSION)
    harness.service.setTrackingSnapshot(workingSnapshot())

    expect(harness.detector.starts).toBe(0)
    expect(harness.service.getStatus().policyKnown).toBe(false)
    expect(harness.service.getStatus().appCollectionActive).toBe(false)

    await harness.service.refreshSettings()

    expect(harness.detector.starts).toBe(0)
    expect(harness.service.getStatus().message).toContain('server policy')

    harness.setSettingsError(null)
    await harness.service.refreshSettings()

    expect(harness.detector.starts).toBe(1)
    expect(harness.service.getStatus().policyKnown).toBe(true)
    expect(harness.service.getStatus().appCollectionActive).toBe(true)
  })

  it('collects app and idle activity independently according to the policy', async () => {
    const harness = createHarness({
      policy: { appTrackingEnabled: false, idleDetectionEnabled: true }
    })

    await attachWorking(harness)

    expect(harness.detector.starts).toBe(0)
    expect(harness.service.getStatus().appCollectionActive).toBe(false)
    expect(harness.service.getStatus().idleCollectionActive).toBe(true)
  })

  it('stops immediately when a settings refresh disables tracking and resumes on re-enable', async () => {
    const harness = createHarness()
    await attachWorking(harness)
    expect(harness.detector.starts).toBe(1)

    setNow(NOW)
    harness.detector.emit(CODE)
    setNow(NOW + 5_000)
    harness.detector.emit(CODE)

    harness.setPolicy({ appTrackingEnabled: false, idleDetectionEnabled: false })
    await harness.service.refreshSettings()

    const events = harness.queue.appEvents()
    expect(events).toHaveLength(1)
    expect(events[0].endedAt).toBe(iso(NOW + 5_000))
    expect(harness.detector.listener).toBeNull()
    expect(harness.service.getStatus().appTrackingEnabled).toBe(false)
    expect(harness.service.getStatus().appCollectionActive).toBe(false)

    harness.setPolicy({ appTrackingEnabled: true })
    await harness.service.refreshSettings()

    expect(harness.detector.starts).toBe(2)
    expect(harness.service.getStatus().appCollectionActive).toBe(true)
  })

  it('surfaces a detector limitation without inventing an application', async () => {
    const harness = createHarness({
      detectorLimitation: 'Accessibility permission is required.'
    })
    await attachWorking(harness)

    harness.detector.fail('Accessibility permission is required.')

    expect(harness.service.getStatus().foregroundDetectionMessage).toContain('Accessibility')
    expect(harness.service.getStatus().appCollectionActive).toBe(false)
    expect(harness.queue.counts().appEvents).toBe(0)
  })
})

describe('ActivityTrackingService foreground aggregation', () => {
  it('aggregates repeated samples, splits on app changes and ends at a break boundary', async () => {
    const harness = createHarness()
    await attachWorking(harness)

    setNow(NOW)
    harness.detector.emit(CODE)
    setNow(NOW + 10_000)
    harness.detector.emit(CODE)
    expect(harness.queue.counts().appEvents).toBe(0)

    setNow(NOW + 20_000)
    harness.detector.emit(SLACK)

    const first = harness.queue.appEvents()
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({
      applicationIdentifier: 'code',
      applicationName: 'Visual Studio Code',
      platform: 'win32',
      sessionId: 'session-1',
      startedAt: iso(NOW),
      endedAt: iso(NOW + 20_000)
    })

    setNow(NOW + 25_000)
    harness.service.setTrackingSnapshot(breakSnapshot(NOW + 25_000))

    const afterBreak = harness.queue.appEvents()
    expect(afterBreak).toHaveLength(2)
    expect(afterBreak[1]).toMatchObject({
      applicationIdentifier: 'slack',
      startedAt: iso(NOW + 20_000),
      endedAt: iso(NOW + 25_000)
    })
    expect(afterBreak[0].endedAt).toBe(afterBreak[1].startedAt)
    expect(harness.service.getStatus().appCollectionActive).toBe(false)
  })

  it('ends an open interval at the last observation when the foreground is unknown', async () => {
    const harness = createHarness()
    await attachWorking(harness)

    setNow(NOW)
    harness.detector.emit(CODE)
    setNow(NOW + 5_000)
    harness.detector.emit(CODE)
    setNow(NOW + 10_000)
    harness.detector.emit(null)

    const events = harness.queue.appEvents()
    expect(events).toHaveLength(1)
    expect(events[0].startedAt).toBe(iso(NOW))
    expect(events[0].endedAt).toBe(iso(NOW + 5_000))
    expect(harness.state.getOpenApp()).toBeNull()
  })

  it('never records an application interval for a non-working session', async () => {
    const harness = createHarness()
    harness.service.attachSession(AUTH_SESSION)
    await harness.service.refreshSettings()
    harness.service.setTrackingSnapshot(idleSnapshot())

    harness.detector.emit(CODE)

    expect(harness.detector.starts).toBe(0)
    expect(harness.queue.counts().appEvents).toBe(0)
  })
})

describe('ActivityTrackingService idle detection', () => {
  it('requires the server threshold before recording and only uploads complete intervals', async () => {
    const harness = createHarness({
      policy: { appTrackingEnabled: false, idleDetectionEnabled: true, idleThresholdMinutes: 5 }
    })
    await attachWorking(harness)

    harness.signals.idleSeconds = 360
    await advance(6 * 60_000)

    const open = harness.state.getOpenIdle()
    expect(open).not.toBeNull()
    expect(open?.startedAt).toBe(iso(NOW))
    expect(harness.queue.counts().idleIntervals).toBe(0)

    harness.signals.idleSeconds = 2
    await advance(5_000)

    const intervals = harness.queue.idleIntervals()
    expect(intervals).toHaveLength(1)
    expect(intervals[0].startedAt).toBe(iso(NOW))
    expect(intervals[0].endedAt).toBe(iso(NOW + 6 * 60_000 + 3_000))
    expect(Date.parse(intervals[0].endedAt) - Date.parse(intervals[0].startedAt)).toBeGreaterThanOrEqual(
      5 * 60_000
    )

    await advance(2_000)

    expect(harness.queue.counts().idleIntervals).toBe(0)
    const batch = harness.calls.find((call) => call.path.endsWith('/idle-intervals/batch'))
    expect(batch?.options?.body).toEqual({
      intervals: [expect.objectContaining({ idempotencyKey: intervals[0].idempotencyKey })]
    })
  })

  it('excludes break time from an idle interval', async () => {
    const harness = createHarness({
      policy: { appTrackingEnabled: false, idleDetectionEnabled: true, idleThresholdMinutes: 1 }
    })
    await attachWorking(harness)

    harness.signals.idleSeconds = 120
    await advance(120_000)
    expect(harness.state.getOpenIdle()).not.toBeNull()

    setNow(NOW + 130_000)
    harness.service.setTrackingSnapshot(breakSnapshot(NOW + 130_000))

    const intervals = harness.queue.idleIntervals()
    expect(intervals).toHaveLength(1)
    expect(intervals[0].startedAt).toBe(iso(NOW))
    expect(intervals[0].endedAt).toBe(iso(NOW + 130_000))
    expect(harness.service.getStatus().idleCollectionActive).toBe(false)
  })

  it('does not backfill idle time across a suspend and resume', async () => {
    const harness = createHarness({
      policy: { appTrackingEnabled: true, idleDetectionEnabled: true }
    })
    await attachWorking(harness)

    setNow(NOW)
    harness.detector.emit(CODE)
    setNow(NOW + 30_000)
    harness.detector.emit(CODE)
    harness.signals.suspend()

    expect(harness.queue.counts().appEvents).toBe(1)
    expect(harness.queue.appEvents()[0].startedAt).toBe(iso(NOW))
    expect(harness.queue.appEvents()[0].endedAt).toBe(iso(NOW + 30_000))
    expect(harness.detector.listener).toBeNull()

    setNow(NOW + 30_000 + 10 * 60_000)
    harness.signals.resume()

    expect(harness.detector.starts).toBe(2)
    expect(harness.queue.counts().appEvents).toBe(1)

    harness.detector.emit(SLACK)
    setNow(NOW + 30_000 + 10 * 60_000 + 5_000)
    harness.service.detachSession()

    const events = harness.queue.appEvents()
    expect(events).toHaveLength(2)
    expect(events[1].startedAt).toBe(iso(NOW + 30_000 + 10 * 60_000))
    expect(events[1].endedAt).toBe(iso(NOW + 30_000 + 10 * 60_000 + 5_000))
  })

  it('does not treat sleep time as idle when the OS counter includes it', async () => {
    const harness = createHarness({
      policy: { appTrackingEnabled: false, idleDetectionEnabled: true, idleThresholdMinutes: 5 }
    })
    await attachWorking(harness)

    harness.signals.suspend()
    setNow(NOW + 30 * 60_000)
    harness.signals.resume()

    harness.signals.idleSeconds = 31 * 60
    setNow(NOW + 30 * 60_000 + 5_000)
    await advance(5_000)

    expect(harness.queue.counts().idleIntervals).toBe(0)
    expect(harness.state.getOpenIdle()).toBeNull()
  })
})

describe('ActivityTrackingService upload reliability', () => {
  it('retries a transient failure with the same idempotency key and drains duplicates', async () => {
    const harness = createHarness()
    await attachWorking(harness)

    setNow(NOW)
    harness.detector.emit(CODE)
    setNow(NOW + 5_000)
    harness.detector.emit(SLACK)
    expect(harness.queue.counts().appEvents).toBe(1)

    const attempts: ApplicationActivityPayload[][] = []
    let failed = false
    harness.setAppHandler(async (events) => {
      attempts.push(events)
      if (!failed) {
        failed = true
        throw new NetworkError()
      }
      return appResponse(events, 'duplicate')
    })

    await advance(2_000)
    expect(attempts).toHaveLength(1)
    expect(harness.queue.counts().appEvents).toBe(1)
    expect(harness.service.getStatus().message).toContain('Offline')

    await advance(1_000)
    expect(attempts).toHaveLength(2)
    expect(attempts[1][0].idempotencyKey).toBe(attempts[0][0].idempotencyKey)
    expect(harness.queue.counts().appEvents).toBe(0)
  })

  it('removes per-event rejections and keeps the rest of the queue usable', async () => {
    const harness = createHarness()
    await attachWorking(harness)

    setNow(NOW)
    harness.detector.emit(CODE)
    setNow(NOW + 5_000)
    harness.detector.emit(SLACK)
    setNow(NOW + 10_000)
    harness.service.setTrackingSnapshot(idleSnapshot())
    expect(harness.queue.counts().appEvents).toBe(2)

    harness.setAppHandler((events) => ({
      ...appResponse(events),
      accepted: 1,
      rejected: 1,
      results: events.map((event, index) => ({
        idempotencyKey: event.idempotencyKey,
        status: index === 0 ? 'rejected' : 'accepted',
        ...(index === 0 ? { code: 'EVENT_OUTSIDE_SESSION', message: 'rejected' } : {})
      }))
    }))

    await advance(2_000)

    expect(harness.queue.counts().appEvents).toBe(0)
    expect(harness.service.getStatus().message).toContain('rejected')
  })

  it('does not retry a permanently malformed batch forever', async () => {
    const harness = createHarness()
    await attachWorking(harness)

    setNow(NOW)
    harness.detector.emit(CODE)
    setNow(NOW + 5_000)
    harness.detector.emit(SLACK)

    harness.setAppHandler(() => {
      throw new ApiError(400, 'VALIDATION_ERROR', 'invalid body')
    })

    await advance(2_000)

    expect(harness.queue.counts().appEvents).toBe(0)
    expect(harness.service.getStatus().message).toContain('discarded')
    expect(harness.calls.filter((call) => call.path.endsWith('/application-activities/batch'))).toHaveLength(1)
  })

  it('treats a 403 policy error as a local disable while retaining queued activity', async () => {
    const harness = createHarness()
    await attachWorking(harness)

    setNow(NOW)
    harness.detector.emit(CODE)
    setNow(NOW + 5_000)
    harness.detector.emit(SLACK)

    harness.setAppHandler(() => {
      throw new ApiError(403, 'APP_TRACKING_DISABLED', 'disabled by policy')
    })

    await advance(2_000)

    expect(harness.service.getStatus().appTrackingEnabled).toBe(false)
    expect(harness.service.getStatus().appCollectionActive).toBe(false)
    expect(harness.detector.listener).toBeNull()
    expect(harness.queue.counts().appEvents).toBe(1)

    harness.setAppHandler(null)
    await advance(5_000)
    await advance(1)

    expect(harness.detector.starts).toBe(2)
    expect(harness.service.getStatus().appTrackingEnabled).toBe(true)
    expect(harness.queue.counts().appEvents).toBe(0)
  })

  it('pauses uploads for a revoked agent without discarding the queue', async () => {
    const harness = createHarness()
    await attachWorking(harness)

    setNow(NOW)
    harness.detector.emit(CODE)
    setNow(NOW + 5_000)
    harness.detector.emit(SLACK)

    harness.setAppHandler(() => {
      throw new ApiError(403, 'AGENT_REVOKED', 'revoked')
    })

    await advance(2_000)

    expect(harness.queue.counts().appEvents).toBe(2)
    expect(harness.service.getStatus().appCollectionActive).toBe(false)
    expect(harness.service.getStatus().message).toContain('revoked')
  })

  it('never stores credentials or sensitive content in upload payloads', async () => {
    const harness = createHarness()
    await attachWorking(harness)

    setNow(NOW)
    harness.detector.emit(CODE)
    setNow(NOW + 5_000)
    harness.detector.emit(SLACK)

    await advance(2_000)

    const serialized = JSON.stringify(harness.calls.map((call) => call.options?.body))
    for (const forbidden of [
      'agent-secret-key',
      'X-Agent-Key',
      'windowTitle',
      'clipboard',
      'keystroke',
      'https://example.com'
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })
})

describe('ActivityTrackingService restart reconciliation', () => {
  it('closes a persisted interval at its last observation instead of the launch time', async () => {
    const harness = createHarness({
      policy: { appTrackingEnabled: true, idleDetectionEnabled: true, idleThresholdMinutes: 5 },
      seedState(state) {
        state.bindUser('user-1')
        state.save(
          {
            identifier: 'code',
            name: 'Visual Studio Code',
            startedAt: iso(NOW - 10 * 60_000),
            lastSeenAt: iso(NOW - 2 * 60_000),
            sessionId: 'session-1'
          },
          {
            startedAt: iso(NOW - 10 * 60_000),
            lastSeenAt: iso(NOW - 9 * 60_000),
            sessionId: 'session-1'
          }
        )
      }
    })

    harness.service.attachSession(AUTH_SESSION)
    await harness.service.refreshSettings()

    const events = harness.queue.appEvents()
    expect(events).toHaveLength(1)
    expect(events[0].startedAt).toBe(iso(NOW - 10 * 60_000))
    expect(events[0].endedAt).toBe(iso(NOW - 2 * 60_000))
    expect(harness.queue.counts().idleIntervals).toBe(0)
    expect(harness.state.getOpenApp()).toBeNull()
    expect(harness.state.getOpenIdle()).toBeNull()

    await advance(1)

    expect(harness.queue.counts().appEvents).toBe(0)
    const batch = harness.calls.find((call) => call.path.endsWith('/application-activities/batch'))
    expect(batch?.options?.body).toEqual({
      events: [expect.objectContaining({ idempotencyKey: events[0].idempotencyKey })]
    })
  })

  it('does not merge interrupted intervals across a restart boundary', async () => {
    const harness = createHarness()
    await attachWorking(harness)

    setNow(NOW)
    harness.detector.emit(CODE)
    setNow(NOW + 5_000)
    await harness.service.shutdown()
    harness.service.detachSession()

    const first = harness.queue.appEvents()
    expect(first).toHaveLength(1)
    expect(first[0].endedAt).toBe(iso(NOW + 5_000))

    harness.service.attachSession(AUTH_SESSION)
    await harness.service.refreshSettings()
    harness.service.setTrackingSnapshot(workingSnapshot())

    expect(harness.queue.counts().appEvents).toBe(1)
    expect(harness.state.getOpenApp()).toBeNull()
  })
})