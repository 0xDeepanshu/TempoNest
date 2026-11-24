import { BrowserWindow, screen } from 'electron'
import type { LiveIndicator } from './liveScreenService'

const WIDTH = 380
const HEIGHT = 46
const SHOW_TIMEOUT_MS = 3_000

const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Live viewing</title>
<style>
  html,body{margin:0;height:100%;background:#7f1d1d;color:#fff;font:600 14px system-ui,-apple-system,"Segoe UI",sans-serif;
    display:flex;align-items:center;justify-content:center;gap:10px;user-select:none;overflow:hidden}
  .dot{width:10px;height:10px;border-radius:50%;background:#fecaca;animation:pulse 1.4s ease-in-out infinite}
  @keyframes pulse{50%{opacity:.35}}
</style></head><body><span class="dot"></span><span>Your screen is being viewed live</span></body></html>`

/**
 * A small always-on-top banner that stays on the primary display for as long as an integration viewer is
 * watching. It cannot be focused, moved, minimised or closed by the employee, ignores mouse input so it
 * never blocks their work, and is visible on top of full-screen windows. It does not name the viewer.
 */
export class LiveIndicatorWindow implements LiveIndicator {
  private window: BrowserWindow | null = null
  private onLost: (() => void) | null = null
  private wanted = false

  async show(onLost: () => void): Promise<boolean> {
    this.hide()
    this.wanted = true
    this.onLost = onLost
    try {
      const { workArea } = screen.getPrimaryDisplay()
      const window = new BrowserWindow({
        width: WIDTH,
        height: HEIGHT,
        x: Math.round(workArea.x + (workArea.width - WIDTH) / 2),
        y: workArea.y + 8,
        frame: false,
        show: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        closable: false,
        fullscreenable: false,
        focusable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        hasShadow: true,
        backgroundColor: '#7f1d1d',
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false }
      })
      this.window = window
      window.setAlwaysOnTop(true, 'screen-saver')
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      window.setIgnoreMouseEvents(true)
      window.on('closed', () => this.lost(window))
      window.on('hide', () => this.lost(window))
      window.on('minimize', () => this.lost(window))

      const shown = new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), SHOW_TIMEOUT_MS)
        window.once('show', () => {
          clearTimeout(timer)
          resolve(true)
        })
      })
      await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(HTML)}`)
      window.showInactive()
      return (await shown) && this.isVisible()
    } catch {
      this.hide()
      return false
    }
  }

  isVisible(): boolean {
    const window = this.window
    return Boolean(window && !window.isDestroyed() && window.isVisible() && !window.isMinimized())
  }

  hide(): void {
    this.wanted = false
    this.onLost = null
    const window = this.window
    this.window = null
    if (window && !window.isDestroyed()) {
      window.removeAllListeners('closed')
      window.removeAllListeners('hide')
      window.removeAllListeners('minimize')
      window.destroy()
    }
  }

  private lost(window: BrowserWindow): void {
    if (this.window !== window || !this.wanted) return
    const callback = this.onLost
    this.hide()
    callback?.()
  }
}
