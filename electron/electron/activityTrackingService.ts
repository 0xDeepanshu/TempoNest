import type { AuthSession } from '../src/types/auth'
import type { ActivityTrackingStatus, TrackingSnapshot } from '../src/types/electron'
import type { ActivityQueue } from './activityQueue'
import type {
  ActivityStateStore,
  OpenAppInterval,
  OpenIdleInterval
} from './activityState'
import type {
  ApplicationActivityBatchResult,
  ApplicationActivityPayload,
  BackendActivitySettingsEnvelope,
  BackendTrackingSettings,
  IdleIntervalBatchResult,
  IdleIntervalPayload
} from './backendTypes'
import { ApiError, NetworkError } from './errors'
import type { ForegroundApp, ForegroundAppSource } from './foregroundApp'
import type { SystemActivitySignals } from './systemActivity'

const DEFAULT_IDLE_POLL_MS = 5_000
const DEFAULT_SETTINGS_REFRESH_MS = 3 * 60_000
const DEFAULT_UPLOAD_TICK_MS = 30_000
const DEFAULT_MAX_BACKOFF_MS = 5 * 60_000
const MIN_BACKOFF_MS = 1_000
const DRAIN_DELAY_MS = 250
const BATCH_SIZE = 200
const MAX_OBSERVATION_GAP_MS = 60_000
const IDLE_RESUME_SECONDS = 10
const MIN_INTERVAL_MS = 1_000
const POLICY_REFRESH_AFTER_DISABLE_MS = 5_000
const RATE_LIMIT_RETRY_MS = 60_000
const DEFAULT_THRESHOLD_MINUTES = 5

export interface ActivityAgentCredentials {
  id: string
  key: string
}

export interface ActivityApiRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  agent?: { id: string; key: string } | null
  organizationId?: string
}

/** The subset of ApiClient the activity collector depends on. */
export interface ActivityApiClient {
  request<T>(path: string, options?: ActivityApiRequestOptions): Promise<T>
}

export interface ActivityTrackingServiceOptions {
  client: ActivityApiClient
  getCredentials: () => ActivityAgentCredentials | null
  rotateCredentials?: () => Promise<ActivityAgentCredentials | null>
  getDeviceId: () => string
  queue: ActivityQueue
  state: ActivityStateStore
  detector: ForegroundAppSource
  signals: SystemActivitySignals
  platform: string
  now?: () => number
  idlePollIntervalMs?: number
  settingsRefreshIntervalMs?: number
  uploadTickMs?: number
  maxBackoffMs?: number
  batchSize?: number
}

interface PolicyState {
  known: boolean
  appTrackingEnabled: boolean
  idleDetectionEnabled: boolean
  idleThresholdMinutes: number
  productivityClassificationEnabled: boolean
  policyVersion: number | null
}

interface SessionContext {
  working: boolean
  sessionId: string | null
  sessionStartedAt: number | null
  breakStartedAt: number | null
}

interface OpenApp {
  identifier: string
  name: string
  startedAt: number
  lastSeenAt: number
  sessionId: string | null
}

interface OpenIdle {
  startedAt: number
  lastSeenAt: number
  sessionId: string | null
}

const UNKNOWN_POLICY: PolicyState = {
  known: false,
  appTrackingEnabled: false,
  idleDetectionEnabled: false,
  idleThresholdMinutes: DEFAULT_THRESHOLD_MINUTES,
  productivityClassificationEnabled: false,
  policyVersion: null
}

const INACTIVE_CONTEXT: SessionContext = {
  working: false,
  sessionId: null,
  sessionStartedAt: null,
  breakStartedAt: null
}

function toIso(ms: number): string {
  return new Date(ms).toISOString()
}

function parseMs(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function isValidSettings(value: unknown): value is BackendTrackingSettings {
  if (typeof value !== 'object' || value === null) return false
  const settings = value as Record<string, unknown>
  return (
    typeof settings.organizationId === 'string' &&
    typeof settings.appTrackingEnabled === 'boolean' &&
    typeof settings.idleDetectionEnabled === 'boolean' &&
    Number.isFinite(settings.idleThresholdMinutes) &&
    Number(settings.idleThresholdMinutes) >= 1 &&
    Number(settings.idleThresholdMinutes) <= 120 &&
    typeof settings.productivityClassificationEnabled === 'boolean' &&
    Number.isFinite(settings.policyVersion)
  )
}

/**
 * Owns foreground-application and idle metadata collection in the main
 * process. The admin policy is always the source of truth: collection starts
 * only after authentication plus a successful settings fetch, stops the moment
 * the applicable flag is disabled, and uploads raw intervals only.
 *
 * No window titles, URLs, keystrokes, clipboard contents or screenshots are
 * read, queued or sent here.
 */
export class ActivityTrackingService {
  private readonly client: ActivityApiClient
  private readonly options: ActivityTrackingServiceOptions
  private readonly now: () => number
  private readonly idlePollIntervalMs: number
  private readonly settingsRefreshIntervalMs: number
  private readonly uploadTickMs: number
  private readonly maxBackoffMs: number
  private readonly batchSize: number

  private readonly listeners = new Set<(status: ActivityTrackingStatus) => void>()
  private readonly unsubscribeSuspend: () => void
  private readonly unsubscribeResume: () => void

  private attached = false
  private disposed = false
  private stopping = false
  private userId: string | null = null
  private organizationId: string | null = null
  private accessBlocked = false
  private suspended = false

  private policy: PolicyState = { ...UNKNOWN_POLICY }
  private context: SessionContext = { ...INACTIVE_CONTEXT }

  private openApp: OpenApp | null = null
  private openIdle: OpenIdle | null = null
  private lastAppObservedAt: number | null = null
  private lastIdlePollAt: number | null = null
  private idleTrustFloor = 0
  private recoveryDone = false

  private appCollectionActive = false
  private idleCollectionActive = false
  private detectorFailure: string | null = null
  private message: string | null = null
  private lastUploadAt: string | null = null
  private lastStatePersistAt = 0
  private lastStatusJson = ''

  private settingsTimer: NodeJS.Timeout | null = null
  private idleTimer: NodeJS.Timeout | null = null
  private uploadTimer: NodeJS.Timeout | null = null
  private policyRefreshTimer: NodeJS.Timeout | null = null
  private flushTimer: NodeJS.Timeout | null = null
  private flushAt: number | null = null
  private settingsRefresh: Promise<void> | null = null
  private shutdownPromise: Promise<void> | null = null

  private flushing = false
  private appInFlight = false
  private idleInFlight = false
  private appBackoffMs = MIN_BACKOFF_MS
  private idleBackoffMs = MIN_BACKOFF_MS
  private appNextAttemptAt = 0
  private idleNextAttemptAt = 0

  constructor(options: ActivityTrackingServiceOptions) {
    this.options = options
    this.client = options.client
    this.now = options.now ?? Date.now
    this.idlePollIntervalMs = options.idlePollIntervalMs ?? DEFAULT_IDLE_POLL_MS
    this.settingsRefreshIntervalMs =
      options.settingsRefreshIntervalMs ?? DEFAULT_SETTINGS_REFRESH_MS
    this.uploadTickMs = options.uploadTickMs ?? DEFAULT_UPLOAD_TICK_MS
    this.maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS
    this.batchSize = options.batchSize ?? BATCH_SIZE

    this.unsubscribeSuspend = options.signals.onSuspend(() => this.handleSuspend())
    this.unsubscribeResume = options.signals.onResume(() => this.handleResume())
  }

  onStatusChanged(listener: (status: ActivityTrackingStatus) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getStatus(): ActivityTrackingStatus {
    const counts = this.options.queue.counts()
    return {
      policyKnown: this.policy.known,
      appTrackingEnabled: this.policy.appTrackingEnabled,
      idleDetectionEnabled: this.policy.idleDetectionEnabled,
      productivityClassificationEnabled: this.policy.productivityClassificationEnabled,
      idleThresholdMinutes: this.policy.known ? this.policy.idleThresholdMinutes : null,
      policyVersion: this.policy.policyVersion,
      foregroundDetection: this.options.detector.supported ? 'supported' : 'unavailable',
      foregroundDetectionMessage:
        this.detectorFailure ?? this.options.detector.limitation ?? null,
      appCollectionActive:
        this.appCollectionActive &&
        this.options.detector.supported &&
        this.detectorFailure === null,
      idleCollectionActive: this.idleCollectionActive,
      pendingAppEvents: counts.appEvents,
      pendingIdleIntervals: counts.idleIntervals,
      lastUploadAt: this.lastUploadAt,
      message: this.message
    }
  }

  attachSession(session: AuthSession): void {
    if (this.disposed) return
    const userId = session.employee.id
    const organizationId = session.membership.organization.id
    if (this.attached && this.userId === userId && this.organizationId === organizationId) return

    if (this.attached) this.stopRuntime(false)

    this.attached = true
    this.stopping = false
    this.userId = userId
    this.organizationId = organizationId
    this.accessBlocked = false
    this.suspended = false
    this.policy = { ...UNKNOWN_POLICY }
    this.context = { ...INACTIVE_CONTEXT }
    this.openApp = null
    this.openIdle = null
    this.lastAppObservedAt = null
    this.lastIdlePollAt = null
    this.idleTrustFloor = 0
    this.recoveryDone = false
    this.detectorFailure = null
    this.message = null
    this.lastUploadAt = null
    this.appBackoffMs = MIN_BACKOFF_MS
    this.idleBackoffMs = MIN_BACKOFF_MS
    this.appNextAttemptAt = 0
    this.idleNextAttemptAt = 0

    this.options.queue.bindUser(userId)
    this.options.state.bindUser(userId)
    this.startTimers()
    this.emitStatus()
    void this.refreshSettings()
  }

  /**
   * Called before the tracking layer forgets agent credentials so any open
   * interval can still be finalized. Explicit sign-out also clears queued
   * activity; involuntary invalidation keeps it for the same employee.
   */
  detachSession(clearQueuedActivity = false): void {
    this.finalizeOpenIntervals(this.now())
    this.stopRuntime(false)
    this.clearTimers()

    if (clearQueuedActivity) {
      this.options.queue.clear()
      this.options.state.clear()
    } else {
      this.options.state.clearOpenIntervals()
    }

    this.attached = false
    this.userId = null
    this.organizationId = null
    this.policy = { ...UNKNOWN_POLICY }
    this.context = { ...INACTIVE_CONTEXT }
    this.accessBlocked = false
    this.suspended = false
    this.detectorFailure = null
    this.message = null
    this.emitStatus()
  }

  setTrackingSnapshot(snapshot: TrackingSnapshot): void {
    if (!this.attached) return

    const next = this.deriveContext(snapshot)
    const now = this.now()
    const leftWork = this.context.working && !next.working
    const sessionChanged =
      this.context.working && next.working && this.context.sessionId !== next.sessionId

    if (leftWork || sessionChanged) {
      const boundary =
        leftWork && next.breakStartedAt !== null ? Math.min(now, next.breakStartedAt) : now
      this.finalizeOpenIntervals(boundary)
      this.kick(0)
    }

    this.context = next
    this.updateCollectionRuntimes()
    this.emitStatus()
  }

  handleConnection(online: boolean): void {
    if (!this.attached) return
    if (online) {
      void this.refreshSettings()
      this.kick(0)
    }
  }

  /** The tracking layer reported a revoked device or blocked access. */
  handleBlocked(): void {
    if (!this.attached || this.accessBlocked) return
    this.stopForBlocked('Activity tracking stopped because this device is blocked.')
  }

  refreshSettings(): Promise<void> {
    if (!this.attached || this.disposed || !this.organizationId) return Promise.resolve()
    if (this.settingsRefresh) return this.settingsRefresh

    const organizationId = this.organizationId
    this.settingsRefresh = this.performSettingsRefresh(organizationId).finally(() => {
      this.settingsRefresh = null
    })
    return this.settingsRefresh
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise
    this.shutdownPromise = Promise.resolve().then(() => {
      this.stopping = true
      this.finalizeOpenIntervals(this.now())
      this.stopRuntime(false)
      this.clearTimers()
      this.persistState(true)
      this.emitStatus()
    })
    return this.shutdownPromise
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.stopRuntime(false)
    this.clearTimers()
    this.unsubscribeSuspend()
    this.unsubscribeResume()
    this.listeners.clear()
  }

  private deriveContext(snapshot: TrackingSnapshot): SessionContext {
    const session = snapshot.session
    const hasActiveSession = Boolean(session && session.endedAt === null)
    const working = snapshot.status === 'working' && hasActiveSession
    const openBreak = session?.breaks.find((brk) => brk.endedAt === null)?.startedAt ?? null

    return {
      working,
      sessionId: working && session && !session.pendingSync ? session.id : null,
      sessionStartedAt: parseMs(session?.startedAt),
      breakStartedAt: parseMs(openBreak)
    }
  }

  private async performSettingsRefresh(organizationId: string): Promise<void> {
    try {
      const response = await this.client.request<BackendActivitySettingsEnvelope>(
        `/organizations/${organizationId}/activity/settings`
      )
      if (!this.attached || this.organizationId !== organizationId || this.disposed) return
      if (!isValidSettings(response?.settings)) {
        this.setMessage('The activity policy response was invalid, so activity tracking is paused.')
        return
      }
      this.applySettings(response.settings)
    } catch (error) {
      if (!this.attached || this.organizationId !== organizationId || this.disposed) return

      if (error instanceof NetworkError) {
        this.setMessage(
          this.policy.known
            ? 'The activity policy could not be refreshed. The last known policy remains in use.'
            : 'Activity tracking is waiting for the server policy; the network is unavailable.'
        )
        return
      }
      if (error instanceof ApiError) {
        if (error.status === 401) {
          this.setMessage('Your session expired. Sign in again to resume activity tracking.')
          return
        }
        if (error.status === 403) {
          this.stopForBlocked(
            'Activity tracking stopped because access to this organization is no longer available.'
          )
          return
        }
      }
      this.setMessage('The activity policy could not be refreshed.')
    }
  }

  private applySettings(settings: BackendTrackingSettings): void {
    const previous = this.policy
    const next: PolicyState = {
      known: true,
      appTrackingEnabled: settings.appTrackingEnabled,
      idleDetectionEnabled: settings.idleDetectionEnabled,
      idleThresholdMinutes: Math.round(settings.idleThresholdMinutes),
      productivityClassificationEnabled: settings.productivityClassificationEnabled,
      policyVersion: settings.policyVersion
    }

    if (previous.known && previous.appTrackingEnabled && !next.appTrackingEnabled) {
      this.closeOpenAppAtLastSeen()
    }
    if (previous.known && previous.idleDetectionEnabled && !next.idleDetectionEnabled) {
      this.closeOpenIdleAtLastSeen()
    }

    this.policy = next
    this.clearPolicyDisabledMessage()

    if (!this.recoveryDone) {
      this.recoveryDone = true
      this.recoverPersistedIntervals()
    }

    this.updateCollectionRuntimes()
    const counts = this.options.queue.counts()
    if (
      (next.appTrackingEnabled && counts.appEvents > 0) ||
      (next.idleDetectionEnabled && counts.idleIntervals > 0)
    ) {
      this.kick(0)
    }
    this.emitStatus()
  }

  private recoverPersistedIntervals(): void {
    const now = this.now()
    const openApp = this.options.state.getOpenApp()
    const openIdle = this.options.state.getOpenIdle()
    let recovered = false

    if (openApp) {
      const startedAt = parseMs(openApp.startedAt)
      const lastSeenAt = parseMs(openApp.lastSeenAt)
      if (startedAt !== null && lastSeenAt !== null) {
        const end = Math.min(lastSeenAt, now)
        if (end - startedAt >= MIN_INTERVAL_MS) {
          this.enqueueApp({
            idempotencyKey: this.appKey(startedAt),
            ...(openApp.sessionId ? { sessionId: openApp.sessionId } : {}),
            applicationIdentifier: openApp.identifier,
            applicationName: openApp.name,
            platform: this.options.platform,
            startedAt: toIso(startedAt),
            endedAt: toIso(end)
          })
          recovered = true
        }
      }
    }

    if (openIdle) {
      const startedAt = parseMs(openIdle.startedAt)
      const lastSeenAt = parseMs(openIdle.lastSeenAt)
      if (startedAt !== null && lastSeenAt !== null) {
        const end = Math.min(lastSeenAt, now)
        const thresholdMs = this.policy.idleThresholdMinutes * 60_000
        if (end - startedAt >= thresholdMs) {
          this.enqueueIdle({
            idempotencyKey: this.idleKey(startedAt),
            ...(openIdle.sessionId ? { sessionId: openIdle.sessionId } : {}),
            platform: this.options.platform,
            startedAt: toIso(startedAt),
            endedAt: toIso(end)
          })
          recovered = true
        }
      }
    }

    this.options.state.clearOpenIntervals()
    if (recovered) {
      this.setMessage(
        'Activity recorded before the last shutdown was recovered and will be uploaded.'
      )
      this.kick(0)
    }
  }

  private updateCollectionRuntimes(): void {
    const canCollect =
      this.attached &&
      !this.disposed &&
      !this.stopping &&
      !this.accessBlocked &&
      !this.suspended &&
      this.policy.known &&
      this.context.working

    const appActive = canCollect && this.policy.appTrackingEnabled
    const idleActive = canCollect && this.policy.idleDetectionEnabled

    if (appActive !== this.appCollectionActive) {
      if (appActive) this.startAppCollection()
      else this.stopAppCollection()
    }
    if (idleActive !== this.idleCollectionActive) {
      if (idleActive) this.startIdleCollection()
      else this.stopIdleCollection()
    }
  }

  private startAppCollection(): void {
    this.appCollectionActive = true
    this.lastAppObservedAt = null
    this.options.detector.start(
      (app) => this.handleAppObservation(app),
      (message) => {
        this.detectorFailure = message
        this.setMessage(message)
      }
    )
    this.emitStatus()
  }

  private stopAppCollection(): void {
    this.closeOpenAppAtLastSeen()
    this.appCollectionActive = false
    this.lastAppObservedAt = null
    this.options.detector.stop()
    this.emitStatus()
  }

  private startIdleCollection(): void {
    this.idleCollectionActive = true
    this.lastIdlePollAt = null
    this.idleTrustFloor = this.now()
    this.pollIdle()
    this.idleTimer = setInterval(() => this.pollIdle(), this.idlePollIntervalMs)
    this.idleTimer.unref()
    this.emitStatus()
  }

  private stopIdleCollection(): void {
    this.closeOpenIdleAtLastSeen()
    this.idleCollectionActive = false
    this.lastIdlePollAt = null
    if (this.idleTimer) clearInterval(this.idleTimer)
    this.idleTimer = null
    this.emitStatus()
  }

  private handleAppObservation(app: ForegroundApp | null): void {
    if (!this.appCollectionActive || this.suspended) return

    const now = this.now()
    const previousObservation = this.lastAppObservedAt
    const discontinuity =
      previousObservation !== null &&
      (now < previousObservation - 5_000 || now - previousObservation > MAX_OBSERVATION_GAP_MS)

    if (discontinuity) {
      // A sleep/resume or clock jump is a boundary: end at the last confirmed
      // observation and never span the gap with a fabricated interval.
      if (this.openApp) this.closeOpenApp(this.openApp.lastSeenAt)
      this.lastAppObservedAt = null
    }

    if (!app) {
      if (this.openApp) this.closeOpenApp(Math.min(this.openApp.lastSeenAt, now))
      this.persistState(true)
      this.emitStatus()
      return
    }

    this.lastAppObservedAt = now

    if (this.openApp && this.openApp.identifier === app.identifier) {
      this.openApp.lastSeenAt = now
      this.persistState(false)
      return
    }

    if (this.openApp) this.closeOpenApp(now)

    this.openApp = {
      identifier: app.identifier,
      name: app.name,
      startedAt: now,
      lastSeenAt: now,
      sessionId: this.context.sessionId
    }
    this.persistState(true)
    this.emitStatus()
  }

  private pollIdle(): void {
    if (!this.idleCollectionActive || !this.policy.known || this.suspended) return

    const now = this.now()
    const previousPoll = this.lastIdlePollAt
    const discontinuity =
      previousPoll !== null &&
      (now < previousPoll - 5_000 || now - previousPoll > MAX_OBSERVATION_GAP_MS)

    if (discontinuity) {
      if (this.openIdle) this.closeOpenIdle(Math.min(this.openIdle.lastSeenAt, now))
      // The OS idle counter may include time before a suspend/resume. Do not
      // backdate a new interval across that boundary.
      this.idleTrustFloor = now
    }
    this.lastIdlePollAt = now

    const idleSeconds = Math.max(0, this.options.signals.getSystemIdleSeconds())
    const thresholdSeconds = this.policy.idleThresholdMinutes * 60
    const thresholdMs = thresholdSeconds * 1000

    if (this.openIdle) {
      if (idleSeconds <= Math.min(thresholdSeconds, IDLE_RESUME_SECONDS)) {
        const end = idleSeconds > 0 ? Math.min(now, now - idleSeconds * 1000) : now
        this.closeOpenIdle(end)
      } else {
        this.openIdle.lastSeenAt = now
        this.persistState(false)
      }
      return
    }

    if (idleSeconds < thresholdSeconds) return

    const sessionStart = this.context.sessionStartedAt ?? now
    const idleStart = Math.max(
      now - idleSeconds * 1000,
      sessionStart,
      this.idleTrustFloor
    )
    if (now - idleStart < thresholdMs) return

    this.openIdle = {
      startedAt: idleStart,
      lastSeenAt: now,
      sessionId: this.context.sessionId
    }
    this.persistState(true)
    this.emitStatus()
  }

  private handleSuspend(): void {
    if (!this.attached || this.suspended) return
    this.suspended = true
    this.finalizeOpenIntervals(this.now())
    this.updateCollectionRuntimes()
    this.setMessage('Activity tracking is paused while the computer sleeps.')
    this.emitStatus()
  }

  private handleResume(): void {
    if (!this.attached || !this.suspended) return
    this.suspended = false
    this.lastAppObservedAt = null
    this.lastIdlePollAt = null
    this.idleTrustFloor = this.now()
    this.updateCollectionRuntimes()
    this.kick(0)
    this.setMessage('Activity tracking resumed after the computer woke up.')
    this.emitStatus()
  }

  private finalizeOpenIntervals(endMs: number): void {
    this.closeOpenApp(endMs)
    this.closeOpenIdle(endMs)
    this.persistState(true)
  }

  /** Ends at the last confirmed observation, never across an unobserved gap. */
  private closeOpenAppAtLastSeen(): void {
    if (this.openApp) this.closeOpenApp(this.openApp.lastSeenAt)
  }

  private closeOpenIdleAtLastSeen(): void {
    if (this.openIdle) this.closeOpenIdle(this.openIdle.lastSeenAt)
  }

  private closeOpenApp(endMs: number): void {
    const open = this.openApp
    if (!open) return

    this.openApp = null
    const end = Math.min(endMs, this.now())
    if (end - open.startedAt >= MIN_INTERVAL_MS) {
      this.enqueueApp({
        idempotencyKey: this.appKey(open.startedAt),
        ...(open.sessionId ? { sessionId: open.sessionId } : {}),
        applicationIdentifier: open.identifier,
        applicationName: open.name,
        platform: this.options.platform,
        startedAt: toIso(open.startedAt),
        endedAt: toIso(end)
      })
    }
    this.persistState(true)
  }

  private closeOpenIdle(endMs: number): void {
    const open = this.openIdle
    if (!open) return

    this.openIdle = null
    const end = Math.min(endMs, this.now())
    const thresholdMs = this.policy.idleThresholdMinutes * 60_000
    if (end - open.startedAt >= thresholdMs && end - open.startedAt >= MIN_INTERVAL_MS) {
      this.enqueueIdle({
        idempotencyKey: this.idleKey(open.startedAt),
        ...(open.sessionId ? { sessionId: open.sessionId } : {}),
        platform: this.options.platform,
        startedAt: toIso(open.startedAt),
        endedAt: toIso(end)
      })
    }
    this.persistState(true)
  }

  private appKey(startedAt: number): string {
    return `app-${this.options.getDeviceId()}-${startedAt}`
  }

  private idleKey(startedAt: number): string {
    return `idle-${this.options.getDeviceId()}-${startedAt}`
  }

  private enqueueApp(payload: ApplicationActivityPayload): void {
    try {
      const before = this.options.queue.droppedCounts()
      this.options.queue.appendApp(payload)
      const after = this.options.queue.droppedCounts()
      if (after.appEvents > before.appEvents) {
        this.setMessage(
          'The local activity queue reached its limit, so its oldest application events were discarded.'
        )
      }
      this.kick(2_000)
      this.emitStatus()
    } catch {
      this.setMessage('An application activity interval could not be stored locally.')
    }
  }

  private enqueueIdle(payload: IdleIntervalPayload): void {
    try {
      const before = this.options.queue.droppedCounts()
      this.options.queue.appendIdle(payload)
      const after = this.options.queue.droppedCounts()
      if (after.idleIntervals > before.idleIntervals) {
        this.setMessage(
          'The local activity queue reached its limit, so its oldest idle intervals were discarded.'
        )
      }
      this.kick(2_000)
      this.emitStatus()
    } catch {
      this.setMessage('An idle interval could not be stored locally.')
    }
  }

  private persistState(force: boolean): void {
    const now = this.now()
    if (!force && now - this.lastStatePersistAt < 5_000) return
    this.lastStatePersistAt = now

    const openApp: OpenAppInterval | null = this.openApp
      ? {
          identifier: this.openApp.identifier,
          name: this.openApp.name,
          startedAt: toIso(this.openApp.startedAt),
          lastSeenAt: toIso(this.openApp.lastSeenAt),
          sessionId: this.openApp.sessionId
        }
      : null
    const openIdle: OpenIdleInterval | null = this.openIdle
      ? {
          startedAt: toIso(this.openIdle.startedAt),
          lastSeenAt: toIso(this.openIdle.lastSeenAt),
          sessionId: this.openIdle.sessionId
        }
      : null

    try {
      this.options.state.save(openApp, openIdle)
    } catch {
      this.setMessage('Activity state could not be saved to disk; the queue may be incomplete.')
    }
  }

  private startTimers(): void {
    this.clearTimers()
    this.settingsTimer = setInterval(() => {
      void this.refreshSettings()
    }, this.settingsRefreshIntervalMs)
    this.settingsTimer.unref()

    this.uploadTimer = setInterval(() => {
      this.kick(0)
    }, this.uploadTickMs)
    this.uploadTimer.unref()
  }

  private clearTimers(): void {
    if (this.settingsTimer) clearInterval(this.settingsTimer)
    if (this.idleTimer) clearInterval(this.idleTimer)
    if (this.uploadTimer) clearInterval(this.uploadTimer)
    if (this.policyRefreshTimer) clearTimeout(this.policyRefreshTimer)
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.settingsTimer = null
    this.idleTimer = null
    this.uploadTimer = null
    this.policyRefreshTimer = null
    this.flushTimer = null
    this.flushAt = null
  }

  private stopRuntime(finalize: boolean): void {
    if (finalize) this.finalizeOpenIntervals(this.now())
    if (this.idleTimer) clearInterval(this.idleTimer)
    this.idleTimer = null
    this.options.detector.stop()
    this.appCollectionActive = false
    this.idleCollectionActive = false
    this.lastAppObservedAt = null
    this.lastIdlePollAt = null
    if (this.openApp) this.openApp = null
    if (this.openIdle) this.openIdle = null
  }

  private stopForBlocked(message: string): void {
    this.accessBlocked = true
    this.finalizeOpenIntervals(this.now())
    this.updateCollectionRuntimes()
    this.setMessage(message)
    this.emitStatus()
  }

  private handlePolicyDisabled(kind: 'app' | 'idle'): void {
    if (kind === 'app' && this.policy.appTrackingEnabled) {
      this.closeOpenAppAtLastSeen()
      this.policy = { ...this.policy, appTrackingEnabled: false }
    }
    if (kind === 'idle' && this.policy.idleDetectionEnabled) {
      this.closeOpenIdleAtLastSeen()
      this.policy = { ...this.policy, idleDetectionEnabled: false }
    }

    this.updateCollectionRuntimes()
    this.setMessage(
      kind === 'app'
        ? 'App tracking was disabled by your organization. Queued activity is retained until tracking is re-enabled.'
        : 'Idle detection was disabled by your organization. Queued intervals are retained until it is re-enabled.'
    )
    this.schedulePolicyRefresh()
    this.emitStatus()
  }

  private schedulePolicyRefresh(): void {
    if (this.policyRefreshTimer) return
    this.policyRefreshTimer = setTimeout(() => {
      this.policyRefreshTimer = null
      void this.refreshSettings()
    }, POLICY_REFRESH_AFTER_DISABLE_MS)
    this.policyRefreshTimer.unref()
  }

  private clearPolicyDisabledMessage(): void {
    if (
      this.message?.startsWith('App tracking was disabled') ||
      this.message?.startsWith('Idle detection was disabled')
    ) {
      this.message = null
    }
  }

  private kick(delayMs = 0): void {
    if (!this.attached || this.disposed || this.stopping || this.accessBlocked || this.suspended) {
      return
    }
    const next = this.nextAttemptAt()
    if (next === null) return

    const now = this.now()
    const at = Math.max(now + delayMs, next)
    if (this.flushTimer && this.flushAt !== null && this.flushAt <= at) return
    if (this.flushTimer) clearTimeout(this.flushTimer)

    this.flushAt = at
    const wait = Math.max(0, at - now)
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flushAt = null
      void this.flush()
    }, wait)
    this.flushTimer.unref()
  }

  private nextAttemptAt(): number | null {
    if (!this.attached || !this.policy.known || this.accessBlocked) return null
    const now = this.now()
    const counts = this.options.queue.counts()
    const candidates: number[] = []

    if (this.policy.appTrackingEnabled && counts.appEvents > 0) {
      candidates.push(Math.max(now, this.appNextAttemptAt))
    }
    if (this.policy.idleDetectionEnabled && counts.idleIntervals > 0) {
      candidates.push(Math.max(now, this.idleNextAttemptAt))
    }
    return candidates.length > 0 ? Math.min(...candidates) : null
  }

  private async flush(): Promise<void> {
    if (!this.attached || this.disposed || this.stopping || this.accessBlocked || this.suspended) {
      return
    }
    if (this.flushing) return
    this.flushing = true

    try {
      const now = this.now()
      const counts = this.options.queue.counts()
      if (
        this.policy.known &&
        this.policy.appTrackingEnabled &&
        !this.appInFlight &&
        counts.appEvents > 0 &&
        now >= this.appNextAttemptAt
      ) {
        await this.flushApp()
      }
      if (
        this.policy.known &&
        this.policy.idleDetectionEnabled &&
        !this.idleInFlight &&
        this.options.queue.counts().idleIntervals > 0 &&
        now >= this.idleNextAttemptAt
      ) {
        await this.flushIdle()
      }
    } finally {
      this.flushing = false
      const next = this.nextAttemptAt()
      if (next !== null) this.kick(Math.max(0, next - this.now()))
    }
  }

  private async flushApp(): Promise<void> {
    if (!this.options.getCredentials()) {
      this.setMessage('Activity uploads are waiting for this device to finish registering.')
      return
    }

    const batch = this.options.queue.appEvents().slice(0, this.batchSize)
    if (batch.length === 0) return

    this.appInFlight = true
    try {
      const response = await this.withAgentRetry((agent) =>
        this.client.request<ApplicationActivityBatchResult>(
          `/organizations/${this.organizationId}/application-activities/batch`,
          { method: 'POST', body: { events: batch }, agent }
        )
      )

      const acknowledged = new Set<string>()
      let rejected = 0
      for (const result of response.results ?? []) {
        if (
          result.status === 'accepted' ||
          result.status === 'duplicate' ||
          result.status === 'rejected'
        ) {
          acknowledged.add(result.idempotencyKey)
        }
        if (result.status === 'rejected') rejected += 1
      }
      this.options.queue.removeApp(acknowledged)

      this.appBackoffMs = MIN_BACKOFF_MS
      this.lastUploadAt = toIso(this.now())
      if (rejected > 0) {
        this.message = `${rejected} activity event${rejected === 1 ? '' : 's'} were rejected by the server and removed.`
      } else {
        this.message = null
      }

      if (this.options.queue.counts().appEvents > 0) {
        this.appNextAttemptAt = this.now() + DRAIN_DELAY_MS
      } else {
        this.appNextAttemptAt = 0
      }
      this.emitStatus()
    } catch (error) {
      this.handleAppFlushError(error)
    } finally {
      this.appInFlight = false
    }
  }

  private async flushIdle(): Promise<void> {
    if (!this.options.getCredentials()) {
      this.setMessage('Activity uploads are waiting for this device to finish registering.')
      return
    }

    const batch = this.options.queue.idleIntervals().slice(0, this.batchSize)
    if (batch.length === 0) return

    this.idleInFlight = true
    try {
      const response = await this.withAgentRetry((agent) =>
        this.client.request<IdleIntervalBatchResult>(
          `/organizations/${this.organizationId}/activity/idle-intervals/batch`,
          { method: 'POST', body: { intervals: batch }, agent }
        )
      )

      const acknowledged = new Set<string>()
      let rejected = 0
      for (const result of response.results ?? []) {
        if (
          result.status === 'accepted' ||
          result.status === 'duplicate' ||
          result.status === 'rejected'
        ) {
          acknowledged.add(result.idempotencyKey)
        }
        if (result.status === 'rejected') rejected += 1
      }
      this.options.queue.removeIdle(acknowledged)

      this.idleBackoffMs = MIN_BACKOFF_MS
      this.lastUploadAt = toIso(this.now())
      if (rejected > 0) {
        this.message = `${rejected} idle interval${rejected === 1 ? '' : 's'} were rejected by the server and removed.`
      } else {
        this.message = null
      }

      if (this.options.queue.counts().idleIntervals > 0) {
        this.idleNextAttemptAt = this.now() + DRAIN_DELAY_MS
      } else {
        this.idleNextAttemptAt = 0
      }
      this.emitStatus()
    } catch (error) {
      this.handleIdleFlushError(error)
    } finally {
      this.idleInFlight = false
    }
  }

  private async withAgentRetry<T>(
    operation: (agent: ActivityAgentCredentials) => Promise<T>
  ): Promise<T> {
    const credentials = this.options.getCredentials()
    if (!credentials) throw new Error('No activity credentials are available.')

    try {
      return await operation(credentials)
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code === 'AGENT_CREDENTIALS_INVALID' &&
        this.options.rotateCredentials
      ) {
        const rotated = await this.options.rotateCredentials()
        if (rotated) return operation(rotated)
      }
      throw error
    }
  }

  private handleAppFlushError(error: unknown): void {
    if (error instanceof ApiError) {
      if (error.code === 'APP_TRACKING_DISABLED') {
        this.handlePolicyDisabled('app')
        return
      }
      if (error.code === 'AGENT_REVOKED') {
        this.stopForBlocked('This device was revoked. Activity tracking stopped.')
        return
      }
      if (error.status === 401) {
        this.appNextAttemptAt = this.now() + this.maxBackoffMs
        this.setMessage('Activity uploads are paused until you sign in again.')
        return
      }
      if (error.status === 403) {
        this.stopForBlocked(
          'Activity tracking stopped because access to this organization is no longer available.'
        )
        return
      }
      if (error.status === 429) {
        this.appNextAttemptAt = this.now() + RATE_LIMIT_RETRY_MS
        this.setMessage('Activity uploads are temporarily rate limited; they will retry automatically.')
        return
      }
      if (error.status >= 500) {
        this.backoff('app')
        this.setMessage('Application activity uploads failed and will retry automatically.')
        return
      }

      // A whole-batch validation failure is permanent. Dropping it avoids
      // retrying malformed data forever while leaving the rest of the queue.
      const keys = this.options.queue
        .appEvents()
        .slice(0, this.batchSize)
        .map((event) => event.idempotencyKey)
      this.options.queue.removeApp(keys)
      this.appNextAttemptAt = 0
      this.setMessage('The server rejected an application activity batch, so its events were discarded.')
      this.emitStatus()
      return
    }

    if (error instanceof NetworkError) {
      this.backoff('app')
      this.setMessage(
        'Offline: application activity is stored securely and will sync automatically.'
      )
      return
    }

    this.backoff('app')
    this.setMessage('Application activity uploads failed and will retry automatically.')
  }

  private handleIdleFlushError(error: unknown): void {
    if (error instanceof ApiError) {
      if (error.code === 'IDLE_DETECTION_DISABLED') {
        this.handlePolicyDisabled('idle')
        return
      }
      if (error.code === 'AGENT_REVOKED') {
        this.stopForBlocked('This device was revoked. Activity tracking stopped.')
        return
      }
      if (error.status === 401) {
        this.idleNextAttemptAt = this.now() + this.maxBackoffMs
        this.setMessage('Activity uploads are paused until you sign in again.')
        return
      }
      if (error.status === 403) {
        this.stopForBlocked(
          'Activity tracking stopped because access to this organization is no longer available.'
        )
        return
      }
      if (error.status === 429) {
        this.idleNextAttemptAt = this.now() + RATE_LIMIT_RETRY_MS
        this.setMessage('Activity uploads are temporarily rate limited; they will retry automatically.')
        return
      }
      if (error.status >= 500) {
        this.backoff('idle')
        this.setMessage('Idle interval uploads failed and will retry automatically.')
        return
      }

      const keys = this.options.queue
        .idleIntervals()
        .slice(0, this.batchSize)
        .map((interval) => interval.idempotencyKey)
      this.options.queue.removeIdle(keys)
      this.idleNextAttemptAt = 0
      this.setMessage('The server rejected an idle interval batch, so its intervals were discarded.')
      this.emitStatus()
      return
    }

    if (error instanceof NetworkError) {
      this.backoff('idle')
      this.setMessage('Offline: idle intervals are stored securely and will sync automatically.')
      return
    }

    this.backoff('idle')
    this.setMessage('Idle interval uploads failed and will retry automatically.')
  }

  private backoff(kind: 'app' | 'idle'): void {
    const now = this.now()
    if (kind === 'app') {
      this.appNextAttemptAt = now + this.appBackoffMs
      this.appBackoffMs = Math.min(this.appBackoffMs * 2, this.maxBackoffMs)
    } else {
      this.idleNextAttemptAt = now + this.idleBackoffMs
      this.idleBackoffMs = Math.min(this.idleBackoffMs * 2, this.maxBackoffMs)
    }
  }

  private setMessage(message: string | null): void {
    if (this.message === message) return
    this.message = message
    this.emitStatus()
  }

  private emitStatus(): void {
    if (this.disposed) return
    const status = this.getStatus()
    const serialized = JSON.stringify(status)
    if (serialized === this.lastStatusJson) return
    this.lastStatusJson = serialized

    for (const listener of this.listeners) {
      try {
        listener({ ...status })
      } catch {
        // A renderer or logging failure must not affect collection.
      }
    }
  }
}