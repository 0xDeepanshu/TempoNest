import { app, BrowserWindow, ipcMain, session, shell } from 'electron'
import { join } from 'node:path'
import { BRANDING } from '../shared/branding'
import type { AppInfo } from '../src/types/electron'
import { AppRuntime } from './appRuntime'
import { ShutdownCoordinator } from './shutdownCoordinator'

const rendererUrl = process.env.ELECTRON_RENDERER_URL
let runtime: AppRuntime | null = null

// Fast Refresh needs inline scripts in development. The production policy is
// injected into index.html at build time and is intentionally stricter.
const developmentCsp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws: http:",
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'"
].join('; ')

app.setName(BRANDING.name)
app.setAppUserModelId(BRANDING.appId)

// A second process would race the first one through the rotating refresh token
// and could revoke the signed-in session family. Focus the existing window
// instead of starting another main process.
if (!app.requestSingleInstanceLock()) {
  app.exit(0)
}

app.on('second-instance', () => {
  const window = BrowserWindow.getAllWindows()[0]
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.focus()
})

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 900,
    minHeight: 640,
    show: false,
    title: BRANDING.name,
    backgroundColor: '#f4f6f8',
    autoHideMenuBar: true,
    icon: join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  })

  window.once('ready-to-show', () => {
    window.show()
  })

  // Never let the renderer open arbitrary windows or navigate away from the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    if (rendererUrl && url.startsWith(rendererUrl)) {
      return
    }
    event.preventDefault()
  })

  if (rendererUrl) {
    void window.loadURL(rendererUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })

  if (rendererUrl) {
    session.defaultSession.webRequest.onHeadersReceived({ urls: ['*://*/*'] }, (details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [developmentCsp]
        }
      })
    })
  }

  ipcMain.handle('app:info', (): AppInfo => {
    return {
      name: BRANDING.name,
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform
    }
  })

  runtime = new AppRuntime()
  runtime.registerIpc()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

const shutdown = new ShutdownCoordinator(async () => {
  const activeRuntime = runtime
  runtime = null
  await activeRuntime?.shutdown()
})
let shutdownComplete = false

// Alt+F4 and the title-bar close button both end in window-all-closed →
// app.quit() on Windows. Prevent the first quit long enough to stop the active
// server session and dispose the socket, then allow the real quit through.
app.on('before-quit', (event) => {
  if (shutdownComplete) return
  event.preventDefault()
  void shutdown.run().finally(() => {
    shutdownComplete = true
    app.quit()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
