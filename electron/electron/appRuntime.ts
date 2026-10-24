import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import type { AuthSession } from '../src/types/auth'
import type {
  MonitoringStatus,
  TrackingOperationResult,
  TrackingRuntimeStatus,
  TrackingSnapshot,
  UserFacingError
} from '../src/types/electron'
import { AgentManager } from './agentManager'
import { AuthManager } from './authManager'
import { getApiBaseUrl, getWebSocketUrl } from './config'
import { toUserFacingError } from './errors'
import { OfflineQueue } from './offlineQueue'
import { capturePrimaryScreen } from './screenCapture'
import { ScreenshotService } from './screenshotService'
import { SecureStore } from './secureStore'
import { TrackingController } from './trackingController'

type IpcEnvelope<T> = { ok: true; value: T } | { ok: false; error: UserFacingError }

const AUTH_CHANNELS = ['auth:restore', 'auth:signIn', 'auth:signOut'] as const
const TRACKING_CHANNELS = [
  'tracking:restore',
  'tracking:start',
  'tracking:startBreak',
  'tracking:endBreak',
  'tracking:stop',
  'tracking:refreshCurrent',
  'tracking:status'
] as const
const MONITORING_CHANNELS = ['monitoring:status'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
    throw new Error(`Invalid ${field}`)
  }
  return value
}

function requireTimestamp(value: unknown, field: string): string {
  const timestamp = requireString(value, field)
  if (!Number.isFinite(Date.parse(timestamp))) throw new Error(`Invalid ${field}`)
  return timestamp
}

/**
 * Wires the main-process services to the narrow preload IPC surface. Every
 * response is an explicit envelope so raw API errors and credentials are never
 * forwarded to the renderer.
 */
export class AppRuntime {
  private readonly auth: AuthManager
  private readonly tracking: TrackingController
  private readonly screenshots: ScreenshotService
  private readonly authUnsubscribe: () => void
  private readonly trackingUnsubscribe: () => void
  private readonly statusUnsubscribe: () => void
  private readonly monitoringUnsubscribe: () => void
  private shutdownPromise: Promise<void> | null = null
  private disposed = false

  constructor() {
    const userData = app.getPath('userData')
    const store = new SecureStore(join(userData, 'secure-store.json'))
    const queue = new OfflineQueue(join(userData, 'offline-queue.json'))
    this.auth = new AuthManager(getApiBaseUrl(), store)
    const agents = new AgentManager(store, this.auth.client)
    this.screenshots = new ScreenshotService({
      client: this.auth.client,
      getAccessToken: () => this.auth.getAccessToken(),
      refreshAccessToken: () => this.auth.refreshAccessToken(),
      getCredentials: () => agents.getCredentials(),
      rotateCredentials: async () => {
        const session = this.auth.getSession()
        if (!session) return null
        try {
          return await agents.rotateAgent(session)
        } catch {
          return null
        }
      },
      capture: capturePrimaryScreen
    })
    this.tracking = new TrackingController({
      auth: this.auth,
      agents,
      queue,
      websocketUrl: getWebSocketUrl(),
      screenshots: this.screenshots
    })

    this.authUnsubscribe = this.auth.onSessionChanged((session) => {
      if (session) {
        this.tracking.attachSession(session)
        this.screenshots.attachSession(session.membership.organization.id)
      } else {
        this.screenshots.detachSession()
        this.tracking.detachSession(this.auth.consumeExplicitSignOut())
      }
      this.broadcast('auth:sessionChanged', session)
    })
    this.trackingUnsubscribe = this.tracking.onStateChanged((snapshot) => {
      this.broadcast('tracking:stateChanged', snapshot)
    })
    this.statusUnsubscribe = this.tracking.onStatusChanged((status) => {
      this.broadcast('tracking:statusChanged', status)
    })
    this.monitoringUnsubscribe = this.screenshots.onStatusChanged((status) => {
      this.broadcast('monitoring:statusChanged', status)
    })
  }

  registerIpc(): void {
    for (const channel of [...AUTH_CHANNELS, ...TRACKING_CHANNELS, ...MONITORING_CHANNELS]) {
      ipcMain.removeHandler(channel)
    }

    ipcMain.handle('auth:restore', () =>
      this.wrap<AuthSession | null>(() => this.auth.restoreSession())
    )
    ipcMain.handle('auth:signIn', (_event, credentials: unknown) =>
      this.wrap<AuthSession>(async () => {
        if (!isRecord(credentials)) throw new Error('Invalid sign-in request')
        return this.auth.signIn({
          email: requireString(credentials.email, 'email'),
          password: requireString(credentials.password, 'password')
        })
      })
    )
    ipcMain.handle('auth:signOut', () => this.wrap<void>(() => this.auth.signOut()))

    ipcMain.handle('tracking:restore', () =>
      this.wrap<TrackingSnapshot | null>(() => this.tracking.restore())
    )
    ipcMain.handle('tracking:start', (_event, sessionId: unknown, startedAt: unknown) =>
      this.wrap<TrackingOperationResult>(() =>
        this.tracking.start(
          requireString(sessionId, 'sessionId'),
          requireTimestamp(startedAt, 'startedAt')
        )
      )
    )
    ipcMain.handle(
      'tracking:startBreak',
      (_event, sessionId: unknown, breakId: unknown, startedAt: unknown) =>
        this.wrap<TrackingOperationResult>(() =>
          this.tracking.startBreak(
            requireString(sessionId, 'sessionId'),
            requireString(breakId, 'breakId'),
            requireTimestamp(startedAt, 'startedAt')
          )
        )
    )
    ipcMain.handle(
      'tracking:endBreak',
      (_event, sessionId: unknown, breakId: unknown, endedAt: unknown) =>
        this.wrap<TrackingOperationResult>(() =>
          this.tracking.endBreak(
            requireString(sessionId, 'sessionId'),
            requireString(breakId, 'breakId'),
            requireTimestamp(endedAt, 'endedAt')
          )
        )
    )
    ipcMain.handle('tracking:stop', (_event, sessionId: unknown, endedAt: unknown) =>
      this.wrap<TrackingOperationResult>(() =>
        this.tracking.stop(
          requireString(sessionId, 'sessionId'),
          requireTimestamp(endedAt, 'endedAt')
        )
      )
    )
    ipcMain.handle('tracking:refreshCurrent', () =>
      this.wrap<TrackingSnapshot | null>(() => this.tracking.refreshCurrent())
    )
    ipcMain.handle('tracking:status', () =>
      this.wrap<TrackingRuntimeStatus>(() => Promise.resolve(this.tracking.getStatus()))
    )
    ipcMain.handle('monitoring:status', () =>
      this.wrap<MonitoringStatus>(() => Promise.resolve(this.screenshots.getStatus()))
    )
  }

  /**
   * Stops the authoritative server session before tearing down credentials,
   * sockets and IPC handlers. Safe to call from overlapping quit paths.
   */
  shutdown(): Promise<void> {
    if (!this.shutdownPromise) {
      this.shutdownPromise = (async () => {
        try {
          await this.tracking.shutdown()
        } finally {
          this.dispose()
        }
      })()
    }
    return this.shutdownPromise
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.authUnsubscribe()
    this.trackingUnsubscribe()
    this.statusUnsubscribe()
    this.monitoringUnsubscribe()
    this.screenshots.dispose()
    this.tracking.dispose()
    for (const channel of [...AUTH_CHANNELS, ...TRACKING_CHANNELS, ...MONITORING_CHANNELS]) {
      ipcMain.removeHandler(channel)
    }
  }

  private async wrap<T>(operation: () => Promise<T>): Promise<IpcEnvelope<T>> {
    try {
      return { ok: true, value: await operation() }
    } catch (error) {
      return { ok: false, error: toUserFacingError(error) }
    }
  }

  private broadcast(channel: string, payload: unknown): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(channel, payload)
      }
    }
  }
}
