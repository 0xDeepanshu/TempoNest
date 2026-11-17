import type { UpdateStatus } from '../src/types/electron'

export interface UpdateInfoLike {
  version: string
}

export interface UpdateProgressLike {
  percent: number
}

/**
 * The subset of `electron-updater`'s `autoUpdater` used here. Keeping the
 * controller behind this interface lets the update state machine be tested
 * without loading Electron or contacting GitHub.
 */
export interface UpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowDowngrade: boolean
  allowPrerelease: boolean
  on(event: 'checking-for-update', listener: () => void): unknown
  on(event: 'update-available', listener: (info: UpdateInfoLike) => void): unknown
  on(event: 'update-not-available', listener: (info: UpdateInfoLike) => void): unknown
  on(event: 'download-progress', listener: (progress: UpdateProgressLike) => void): unknown
  on(event: 'update-downloaded', listener: (info: UpdateInfoLike) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  removeListener(event: string, listener: (...args: never[]) => void): unknown
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

export interface UpdateControllerOptions {
  updater: UpdaterLike
  currentVersion: string
  supported: boolean
  beforeInstall: () => Promise<void>
  /** Delay before the first automatic check after launch. */
  initialCheckDelayMs?: number
  /** Interval between periodic checks while the app stays open. */
  checkIntervalMs?: number
}

const DEFAULT_INITIAL_CHECK_DELAY_MS = 10_000
const DEFAULT_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

/**
 * Owns the update lifecycle. Downloads and installs are always user-initiated;
 * no check, download, error, or install path touches the timer or session
 * services.
 */
export class UpdateController {
  private readonly updater: UpdaterLike
  private readonly beforeInstall: () => Promise<void>
  private readonly initialCheckDelayMs: number
  private readonly checkIntervalMs: number
  private readonly subscribers = new Set<(status: UpdateStatus) => void>()
  private readonly subscriptions: Array<{ event: string; listener: (...args: never[]) => void }> = []
  private status: UpdateStatus
  private initialTimer: ReturnType<typeof setTimeout> | null = null
  private intervalTimer: ReturnType<typeof setInterval> | null = null
  private checking = false
  private downloading = false
  private installing = false
  private started = false
  private disposed = false

  constructor(options: UpdateControllerOptions) {
    this.updater = options.updater
    this.beforeInstall = options.beforeInstall
    this.initialCheckDelayMs = options.initialCheckDelayMs ?? DEFAULT_INITIAL_CHECK_DELAY_MS
    this.checkIntervalMs = options.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS
    this.status = {
      phase: 'idle',
      supported: options.supported,
      currentVersion: options.currentVersion,
      availableVersion: null,
      progressPercent: null,
      message: null,
      lastCheckedAt: null
    }

    this.bindEvents()
  }

  getStatus(): UpdateStatus {
    return { ...this.status }
  }

  onStatusChanged(listener: (status: UpdateStatus) => void): () => void {
    this.subscribers.add(listener)
    return () => {
      this.subscribers.delete(listener)
    }
  }

  start(): void {
    if (this.started || this.disposed || !this.status.supported) return
    this.started = true

    // The employee always chooses when to download and restart. Auto-install
    // on quit is disabled so a normal quit never installs behind their back.
    this.updater.autoDownload = false
    this.updater.autoInstallOnAppQuit = false
    this.updater.allowDowngrade = false
    this.updater.allowPrerelease = false

    this.initialTimer = setTimeout(() => {
      this.initialTimer = null
      void this.check()
    }, this.initialCheckDelayMs)
    this.initialTimer.unref?.()

    this.intervalTimer = setInterval(() => {
      if (this.status.phase === 'downloading' || this.status.phase === 'downloaded') return
      void this.check()
    }, this.checkIntervalMs)
    this.intervalTimer.unref?.()
  }

  async check(): Promise<UpdateStatus> {
    if (!this.status.supported || this.disposed) return this.getStatus()
    // Never stack requests or replace a downloaded installer with a new check.
    if (
      this.checking ||
      this.status.phase === 'downloading' ||
      this.status.phase === 'downloaded'
    ) {
      return this.getStatus()
    }

    this.checking = true
    try {
      await this.updater.checkForUpdates()
    } catch (error) {
      this.handleError(error)
    } finally {
      this.checking = false
      this.status.lastCheckedAt = new Date().toISOString()
      this.emit()
    }
    return this.getStatus()
  }

  async download(): Promise<UpdateStatus> {
    if (!this.status.supported || this.disposed) return this.getStatus()
    if (this.downloading || this.status.phase !== 'available') return this.getStatus()

    this.downloading = true
    this.set({ phase: 'downloading', progressPercent: 0, message: null })
    try {
      await this.updater.downloadUpdate()
    } catch (error) {
      this.handleError(error)
    } finally {
      this.downloading = false
    }
    return this.getStatus()
  }

  async install(): Promise<void> {
    if (this.status.phase !== 'downloaded') {
      throw new Error('No downloaded update is ready to install.')
    }
    if (this.installing) return
    this.installing = true
    try {
      // Stop the active session and flush durable state before the updater
      // closes the windows. The offline queue is written before any request,
      // so an unreachable server never loses the quit-time stop.
      await this.beforeInstall()
      this.updater.quitAndInstall(false, true)
    } finally {
      this.installing = false
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.initialTimer) clearTimeout(this.initialTimer)
    if (this.intervalTimer) clearInterval(this.intervalTimer)
    this.initialTimer = null
    this.intervalTimer = null
    for (const { event, listener } of this.subscriptions) {
      this.updater.removeListener(event, listener)
    }
    this.subscriptions.length = 0
    this.subscribers.clear()
  }

  private bindEvents(): void {
    this.listen('checking-for-update', () => {
      this.set({ phase: 'checking', message: null })
    })
    this.listen('update-available', (info: UpdateInfoLike) => {
      this.set({
        phase: 'available',
        availableVersion: info.version,
        progressPercent: null,
        message: null
      })
    })
    this.listen('update-not-available', () => {
      this.set({
        phase: 'not-available',
        availableVersion: null,
        progressPercent: null,
        message: null
      })
    })
    this.listen('download-progress', (progress: UpdateProgressLike) => {
      const percent = Number.isFinite(progress.percent)
        ? Math.min(100, Math.max(0, Math.round(progress.percent)))
        : null
      this.set({ phase: 'downloading', progressPercent: percent })
    })
    this.listen('update-downloaded', (info: UpdateInfoLike) => {
      this.set({
        phase: 'downloaded',
        availableVersion: info.version,
        progressPercent: 100,
        message: null
      })
    })
    this.listen('error', (error: Error) => {
      this.handleError(error)
    })
  }

  private listen(event: string, listener: (...args: never[]) => void): void {
    this.subscriptions.push({ event, listener })
    // The concrete event/listener pairs are validated by UpdaterLike.
    ;(this.updater.on as (event: string, handler: (...args: never[]) => void) => unknown)(
      event,
      listener
    )
  }

  private set(next: Partial<UpdateStatus>): void {
    if (this.disposed) return
    this.status = { ...this.status, ...next }
    this.emit()
  }

  private emit(): void {
    if (this.disposed) return
    const snapshot = this.getStatus()
    for (const listener of [...this.subscribers]) listener(snapshot)
  }

  private handleError(error: unknown): void {
    console.warn('[updates] update check failed', error)
    this.set({ phase: 'error', progressPercent: null, message: describeUpdateError(error) })
  }
}

function describeUpdateError(error: unknown): string {
  const raw = error instanceof Error ? error.message : ''

  if (/ENOTFOUND|EAI_AGAIN|ECONN|ETIMEDOUT|net::|network|internet|offline/i.test(raw)) {
    return 'Could not reach the update server. Check your connection and try again.'
  }
  if (/404|latest\.ya?ml/i.test(raw)) {
    return 'No update package is available right now. Try again later.'
  }
  return 'The update could not be completed. Please try again.'
}
