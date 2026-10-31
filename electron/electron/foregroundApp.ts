import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'

/** The only metadata sent upstream: a process identifier and a display name. */
export interface ForegroundApp {
  identifier: string
  name: string
}

export type ForegroundAppListener = (app: ForegroundApp | null) => void
export type ForegroundFailureListener = (message: string) => void

export interface ForegroundAppSource {
  readonly supported: boolean
  readonly limitation: string | null
  start(listener: ForegroundAppListener, onFailure?: ForegroundFailureListener): void
  stop(): void
}

const MAX_IDENTIFIER_LENGTH = 200
const MAX_NAME_LENGTH = 255
const WINDOWS_POLL_MS = 2_000
const POSIX_POLL_MS = 5_000
const MAX_WINDOWS_RESTARTS = 3
const WINDOWS_RESTART_DELAY_MS = 5_000

/**
 * Normalizes a detected process into the backend's metadata shape. It never
 * invents an identifier: a missing process name is reported as unknown.
 */
export function normalizeForegroundApp(identifier: unknown, name: unknown): ForegroundApp | null {
  if (typeof identifier !== 'string') return null
  const rawIdentifier = identifier.trim()
  if (!rawIdentifier || rawIdentifier.length > MAX_IDENTIFIER_LENGTH) return null

  const display =
    typeof name === 'string' && name.trim() ? name.trim() : rawIdentifier

  return {
    // Classification identifiers are lowercase on the backend, so a stable
    // lowercase process name keeps observed rows consistent.
    identifier: rawIdentifier.toLowerCase().slice(0, MAX_IDENTIFIER_LENGTH),
    name: display.slice(0, MAX_NAME_LENGTH)
  }
}

/** Parses one JSON line emitted by the Windows helper. */
export function parseForegroundLine(line: string): ForegroundApp | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed === 'null') return null

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    if (typeof parsed !== 'object' || parsed === null) return null
    return normalizeForegroundApp(parsed.identifier, parsed.name)
  } catch {
    return null
  }
}

/**
 * Windows helper. It asks User32 for the foreground window only to obtain the
 * owning process ID, then reports that process's name and file description.
 * It never reads window text, URLs, keyboard input or clipboard data.
 */
const WINDOWS_SCRIPT = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TnForeground {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@
while ($true) {
  $payload = 'null'
  try {
    $handle = [TnForeground]::GetForegroundWindow()
    if ($handle -ne [IntPtr]::Zero) {
      $processId = 0
      [void][TnForeground]::GetWindowThreadProcessId($handle, [ref]$processId)
      if ($processId -gt 0) {
        $process = Get-Process -Id $processId -ErrorAction Stop
        $name = $process.ProcessName
        if (-not [string]::IsNullOrWhiteSpace($name)) {
          $description = $null
          try { $description = $process.MainModule.FileVersionInfo.FileDescription } catch { }
          if ([string]::IsNullOrWhiteSpace($description)) { $description = $name }
          $payload = (@{ identifier = $name; name = $description } | ConvertTo-Json -Compress)
        }
      }
    }
  } catch { }
  [Console]::Out.WriteLine($payload)
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds ${WINDOWS_POLL_MS}
}
`

function createWindowsSource(spawnImpl: typeof spawn): ForegroundAppSource {
  let child: ReturnType<typeof spawn> | null = null
  let listener: ForegroundAppListener | null = null
  let onFailure: ForegroundFailureListener | null = null
  let stopping = false
  let restarts = 0
  let restartTimer: NodeJS.Timeout | null = null
  let buffer = ''
  let failureReported = false

  const reportFailure = (message: string): void => {
    if (failureReported) return
    failureReported = true
    onFailure?.(message)
  }

  const launch = (): void => {
    if (stopping) return

    let spawned: ReturnType<typeof spawn>
    try {
      spawned = spawnImpl(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WINDOWS_SCRIPT],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
      )
    } catch {
      reportFailure('Foreground application detection could not start on this device.')
      listener?.(null)
      return
    }

    child = spawned
    buffer = ''
    spawned.stdout?.setEncoding('utf8')
    spawned.stdout?.on('data', (chunk: string) => {
      buffer += chunk
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        listener?.(parseForegroundLine(line))
        newline = buffer.indexOf('\n')
      }
    })
    // Diagnostics may contain local paths or account names; never log them.
    spawned.stderr?.resume()

    spawned.on('error', () => {
      reportFailure('Foreground application detection is unavailable on this device.')
      listener?.(null)
    })

    spawned.on('exit', () => {
      child = null
      if (stopping) return
      listener?.(null)
      if (restarts < MAX_WINDOWS_RESTARTS) {
        restarts += 1
        restartTimer = setTimeout(launch, WINDOWS_RESTART_DELAY_MS)
        restartTimer.unref()
      } else {
        reportFailure(
          'Windows foreground application detection stopped unexpectedly. Restart TempoNest to resume app tracking.'
        )
      }
    })
  }

  return {
    supported: true,
    limitation: null,
    start(nextListener, nextFailure) {
      this.stop()
      stopping = false
      restarts = 0
      failureReported = false
      listener = nextListener
      onFailure = nextFailure ?? null
      launch()
    },
    stop() {
      stopping = true
      listener = null
      onFailure = null
      if (restartTimer) clearTimeout(restartTimer)
      restartTimer = null
      if (child) {
        child.kill()
        child = null
      }
    }
  }
}

const MAC_SCRIPT = `
tell application "System Events"
  set frontApp to first application process whose frontmost is true
  set appName to name of frontApp
  try
    set appId to bundle identifier of frontApp
  on error
    set appId to ""
  end try
  return appName & "|" & appId
end tell
`

function createMacSource(spawnImpl: typeof spawn, pollMs: number): ForegroundAppSource {
  let timer: NodeJS.Timeout | null = null
  let busy = false
  let listener: ForegroundAppListener | null = null
  let onFailure: ForegroundFailureListener | null = null
  let failureReported = false

  const poll = (): void => {
    if (busy || !listener) return
    busy = true

    let child: ReturnType<typeof spawn>
    try {
      child = spawnImpl('osascript', ['-e', MAC_SCRIPT], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch {
      busy = false
      listener(null)
      return
    }

    let output = ''
    let errorOutput = ''
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      output += chunk
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      errorOutput += chunk
    })
    child.on('error', () => {
      busy = false
      listener?.(null)
    })
    child.on('exit', (code) => {
      busy = false
      if (code !== 0 || !output.trim()) {
        if (!failureReported && errorOutput.trim()) {
          failureReported = true
          onFailure?.(
            'macOS requires Accessibility/Automation permission for System Events to identify the foreground application.'
          )
        }
        listener?.(null)
        return
      }

      const separator = output.indexOf('|')
      const appName = (separator >= 0 ? output.slice(0, separator) : output).trim()
      const bundleId = separator >= 0 ? output.slice(separator + 1).trim() : ''
      listener?.(normalizeForegroundApp(bundleId || appName, appName))
    })
  }

  return {
    supported: true,
    limitation: null,
    start(nextListener, nextFailure) {
      this.stop()
      listener = nextListener
      onFailure = nextFailure ?? null
      failureReported = false
      poll()
      timer = setInterval(poll, pollMs)
      timer.unref()
    },
    stop() {
      listener = null
      onFailure = null
      if (timer) clearInterval(timer)
      timer = null
    }
  }
}

function createLinuxSource(spawnImpl: typeof spawn, pollMs: number): ForegroundAppSource {
  let timer: NodeJS.Timeout | null = null
  let busy = false
  let listener: ForegroundAppListener | null = null
  let onFailure: ForegroundFailureListener | null = null
  let failureReported = false

  const poll = (): void => {
    if (busy || !listener) return
    busy = true

    let child: ReturnType<typeof spawn>
    try {
      child = spawnImpl('xdotool', ['getactivewindow', 'getwindowpid'], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch {
      busy = false
      listener(null)
      return
    }

    let output = ''
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      output += chunk
    })
    child.stderr?.resume()
    child.on('error', () => {
      busy = false
      if (!failureReported) {
        failureReported = true
        onFailure?.(
          'Linux foreground application detection requires the xdotool package on an X11 session; Wayland is not supported.'
        )
      }
      listener?.(null)
    })
    child.on('exit', () => {
      busy = false
      const pid = Number.parseInt(output.trim(), 10)
      if (!Number.isFinite(pid) || pid <= 0) {
        listener?.(null)
        return
      }

      try {
        const command = readFileSync(`/proc/${pid}/comm`, 'utf8').trim()
        listener?.(normalizeForegroundApp(command, command))
      } catch {
        listener?.(null)
      }
    })
  }

  return {
    supported: true,
    limitation: 'Linux foreground detection requires X11 and the xdotool package.',
    start(nextListener, nextFailure) {
      this.stop()
      listener = nextListener
      onFailure = nextFailure ?? null
      failureReported = false
      poll()
      timer = setInterval(poll, pollMs)
      timer.unref()
    },
    stop() {
      listener = null
      onFailure = null
      if (timer) clearInterval(timer)
      timer = null
    }
  }
}

const UNSUPPORTED_LIMITATION =
  'Foreground application detection is not implemented for this operating system.'

export interface ForegroundAppSourceOptions {
  platform?: NodeJS.Platform
  spawnImpl?: typeof spawn
  pollIntervalMs?: number
}

/**
 * Creates the platform foreground reader. Windows uses a long-lived
 * PowerShell helper; macOS uses System Events (Automation permission) and
 * Linux uses xdotool on X11. Unsupported platforms report the limitation
 * instead of reporting guessed application names.
 */
export function createForegroundAppSource(
  options: ForegroundAppSourceOptions = {}
): ForegroundAppSource {
  const platform = options.platform ?? process.platform
  const spawnImpl = options.spawnImpl ?? spawn
  const pollMs = options.pollIntervalMs ?? POSIX_POLL_MS

  if (platform === 'win32') return createWindowsSource(spawnImpl)
  if (platform === 'darwin') return createMacSource(spawnImpl, pollMs)
  if (platform === 'linux') {
    if (!process.env.DISPLAY) {
      return {
        supported: false,
        limitation:
          'Linux foreground detection needs an X11 display; no DISPLAY was found (Wayland sessions are not supported).',
        start(_listener, onFailure) {
          onFailure?.(
            'Linux foreground detection needs an X11 display; no DISPLAY was found (Wayland sessions are not supported).'
          )
        },
        stop() {
          // Nothing to stop.
        }
      }
    }
    return createLinuxSource(spawnImpl, pollMs)
  }

  return {
    supported: false,
    limitation: UNSUPPORTED_LIMITATION,
    start(_listener, onFailure) {
      onFailure?.(UNSUPPORTED_LIMITATION)
    },
    stop() {
      // Nothing to stop.
    }
  }
}

