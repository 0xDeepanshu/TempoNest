import { BrowserWindow, app, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus, UserFacingError } from '../src/types/electron'
import { UpdateController, type UpdaterLike } from './updateController'

type IpcEnvelope<T> = { ok: true; value: T } | { ok: false; error: UserFacingError }

const UPDATE_CHANNELS = [
  'updates:status',
  'updates:check',
  'updates:download',
  'updates:install'
] as const

/**
 * Connects the updater state machine to Electron. Update artifacts are only
 * produced for Windows NSIS builds, so development builds and other platforms
 * expose a permanently unsupported state and never contact GitHub.
 */
export class UpdateRuntime {
  private readonly controller: UpdateController
  private readonly unsubscribe: () => void

  constructor(beforeInstall: () => Promise<void>) {
    this.controller = new UpdateController({
      updater: autoUpdater as unknown as UpdaterLike,
      currentVersion: app.getVersion(),
      supported: app.isPackaged && process.platform === 'win32',
      beforeInstall
    })
    this.unsubscribe = this.controller.onStatusChanged((status) => {
      this.broadcast('updates:statusChanged', status)
    })
  }

  registerIpc(): void {
    for (const channel of UPDATE_CHANNELS) {
      ipcMain.removeHandler(channel)
    }

    ipcMain.handle('updates:status', () => ({
      ok: true,
      value: this.controller.getStatus()
    }))
    ipcMain.handle('updates:check', () => this.wrap(() => this.controller.check()))
    ipcMain.handle('updates:download', () => this.wrap(() => this.controller.download()))
    ipcMain.handle('updates:install', () => this.wrap(() => this.controller.install()))
  }

  start(): void {
    this.controller.start()
  }

  dispose(): void {
    this.unsubscribe()
    this.controller.dispose()
    for (const channel of UPDATE_CHANNELS) {
      ipcMain.removeHandler(channel)
    }
  }

  private async wrap<T>(operation: () => Promise<T>): Promise<IpcEnvelope<T>> {
    try {
      return { ok: true, value: await operation() }
    } catch {
      return {
        ok: false,
        error: {
          code: 'UPDATE_FAILED',
          message: 'The update could not be started. Restart WorkZen and try again.'
        }
      }
    }
  }

  private broadcast(channel: string, payload: UpdateStatus): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(channel, payload)
      }
    }
  }
}
