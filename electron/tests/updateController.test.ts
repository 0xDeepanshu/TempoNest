import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UpdateController, type UpdaterLike } from '../electron/updateController'

class FakeUpdater extends EventEmitter {
  autoDownload = true
  autoInstallOnAppQuit = true
  allowDowngrade = true
  allowPrerelease = true
  checkCalls = 0
  downloadCalls = 0
  quitCalls: Array<[boolean | undefined, boolean | undefined]> = []
  pendingCheck: Promise<void> | null = null
  checkError: Error | null = null
  downloadError: Error | null = null

  async checkForUpdates(): Promise<unknown> {
    this.checkCalls += 1
    if (this.checkError) throw this.checkError
    if (this.pendingCheck) await this.pendingCheck
    return null
  }

  async downloadUpdate(): Promise<unknown> {
    this.downloadCalls += 1
    if (this.downloadError) throw this.downloadError
    return []
  }

  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void {
    this.quitCalls.push([isSilent, isForceRunAfter])
  }
}

function setup(
  overrides: {
    supported?: boolean
    beforeInstall?: () => Promise<void>
    initialCheckDelayMs?: number
    checkIntervalMs?: number
  } = {}
) {
  const updater = new FakeUpdater()
  const controller = new UpdateController({
    updater: updater as unknown as UpdaterLike,
    currentVersion: '0.2.0',
    supported: overrides.supported ?? true,
    beforeInstall: overrides.beforeInstall ?? (async () => undefined),
    initialCheckDelayMs: overrides.initialCheckDelayMs ?? 60_000,
    checkIntervalMs: overrides.checkIntervalMs ?? 60_000
  })
  return { updater, controller }
}

async function markAvailable(updater: FakeUpdater, version = '0.2.1') {
  updater.emit('checking-for-update')
  updater.emit('update-available', { version })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('UpdateController', () => {
  it('does not check, download or install in development builds', async () => {
    vi.useFakeTimers()
    const { updater, controller } = setup({ supported: false, initialCheckDelayMs: 100 })

    controller.start()
    await vi.advanceTimersByTimeAsync(500_000)

    expect((await controller.check()).supported).toBe(false)
    await controller.download()
    await expect(controller.install()).rejects.toThrow(/ready to install/)

    expect(updater.checkCalls).toBe(0)
    expect(updater.downloadCalls).toBe(0)
    expect(updater.quitCalls).toHaveLength(0)
  })

  it('maps the updater lifecycle events to display-safe states', () => {
    const { updater, controller } = setup()

    updater.emit('checking-for-update')
    expect(controller.getStatus().phase).toBe('checking')

    updater.emit('update-not-available', { version: '0.2.0' })
    expect(controller.getStatus()).toMatchObject({
      phase: 'not-available',
      availableVersion: null,
      progressPercent: null
    })

    updater.emit('update-available', { version: '0.2.1' })
    expect(controller.getStatus()).toMatchObject({
      phase: 'available',
      availableVersion: '0.2.1'
    })

    updater.emit('download-progress', { percent: 42.6 })
    expect(controller.getStatus()).toMatchObject({
      phase: 'downloading',
      progressPercent: 43
    })

    updater.emit('download-progress', { percent: 140 })
    expect(controller.getStatus().progressPercent).toBe(100)

    updater.emit('update-downloaded', { version: '0.2.1' })
    expect(controller.getStatus()).toMatchObject({
      phase: 'downloaded',
      availableVersion: '0.2.1',
      progressPercent: 100
    })
  })

  it('turns connection errors into a retryable message without leaking the raw error', () => {
    const { updater, controller } = setup()

    updater.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED at https://github.com/...'))

    const status = controller.getStatus()
    expect(status.phase).toBe('error')
    expect(status.message).toBe(
      'Could not reach the update server. Check your connection and try again.'
    )
    expect(status.message).not.toContain('github.com')
  })

  it('handles a rejected check and records the check time', async () => {
    const { updater, controller } = setup()
    updater.checkError = new Error('Cannot find latest.yml in the latest release artifacts')

    const status = await controller.check()

    expect(status.phase).toBe('error')
    expect(status.message).toBe('No update package is available right now. Try again later.')
    expect(status.lastCheckedAt).not.toBeNull()
  })

  it('prevents overlapping checks', async () => {
    const { updater, controller } = setup()
    let release!: () => void
    updater.pendingCheck = new Promise<void>((resolve) => {
      release = resolve
    })

    const first = controller.check()
    const second = controller.check()
    expect(updater.checkCalls).toBe(1)

    release()
    await Promise.all([first, second])
    expect(updater.checkCalls).toBe(1)
  })

  it('only downloads an available update and never duplicates a download', async () => {
    const { updater, controller } = setup()

    await controller.download()
    expect(updater.downloadCalls).toBe(0)

    await markAvailable(updater)
    const first = controller.download()
    const second = controller.download()
    expect(updater.downloadCalls).toBe(1)

    await Promise.all([first, second])
    expect(controller.getStatus().phase).toBe('downloading')
  })

  it('does not check again once an update is downloaded', async () => {
    const { updater, controller } = setup()
    await markAvailable(updater)
    updater.emit('update-downloaded', { version: '0.2.1' })

    await controller.check()

    expect(updater.checkCalls).toBe(0)
    expect(controller.getStatus().phase).toBe('downloaded')
  })

  it('runs quit cleanup before handing control to the installer', async () => {
    const order: string[] = []
    const { updater, controller } = setup({
      beforeInstall: async () => {
        order.push('shutdown')
      }
    })
    updater.quitAndInstall = (isSilent?: boolean, isForceRunAfter?: boolean) => {
      order.push('install')
      updater.quitCalls.push([isSilent, isForceRunAfter])
    }

    await expect(controller.install()).rejects.toThrow(/ready to install/)

    updater.emit('update-downloaded', { version: '0.2.1' })
    await controller.install()

    expect(order).toEqual(['shutdown', 'install'])
    expect(updater.quitCalls).toEqual([[false, true]])
  })

  it('configures manual download, disables install-on-quit, and checks on schedule', async () => {
    vi.useFakeTimers()
    const { updater, controller } = setup({
      initialCheckDelayMs: 1_000,
      checkIntervalMs: 60_000
    })

    controller.start()

    expect(updater.autoDownload).toBe(false)
    expect(updater.autoInstallOnAppQuit).toBe(false)
    expect(updater.allowDowngrade).toBe(false)
    expect(updater.allowPrerelease).toBe(false)

    await vi.advanceTimersByTimeAsync(999)
    expect(updater.checkCalls).toBe(0)

    await vi.advanceTimersByTimeAsync(1)
    expect(updater.checkCalls).toBe(1)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(updater.checkCalls).toBe(2)

    // A downloaded build waits for the explicit restart instead of rechecking.
    updater.emit('update-downloaded', { version: '0.2.1' })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(updater.checkCalls).toBe(2)
  })

  it('stops publishing state after disposal', () => {
    const { updater, controller } = setup()
    const seen: string[] = []
    controller.onStatusChanged((status) => seen.push(status.phase))

    updater.emit('update-available', { version: '0.2.1' })
    expect(seen).toEqual(['available'])

    controller.dispose()
    updater.emit('update-downloaded', { version: '0.2.1' })
    expect(seen).toEqual(['available'])
    expect(controller.getStatus().phase).toBe('available')
  })
})
