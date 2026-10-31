import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createForegroundAppSource,
  normalizeForegroundApp,
  parseForegroundLine
} from '../electron/foregroundApp'

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> }
    stderr: EventEmitter & { setEncoding: ReturnType<typeof vi.fn>; resume: ReturnType<typeof vi.fn> }
    kill: ReturnType<typeof vi.fn>
  }
  child.stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() })
  child.stderr = Object.assign(new EventEmitter(), {
    setEncoding: vi.fn(),
    resume: vi.fn()
  })
  child.kill = vi.fn(() => {
    child.emit('exit', null, 'SIGTERM')
  })
  return child
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('foreground application metadata', () => {
  it('normalizes a process name without inventing a display name', () => {
    expect(normalizeForegroundApp('Code.EXE', 'Visual Studio Code')).toEqual({
      identifier: 'code.exe',
      name: 'Visual Studio Code'
    })
    expect(normalizeForegroundApp('code', null)).toEqual({ identifier: 'code', name: 'code' })
    expect(normalizeForegroundApp('   ', 'Code')).toBeNull()
    expect(normalizeForegroundApp(null, 'Code')).toBeNull()
  })

  it('parses the helper output and treats an unknown foreground as no observation', () => {
    expect(parseForegroundLine('{"identifier":"slack","name":"Slack"}')).toEqual({
      identifier: 'slack',
      name: 'Slack'
    })
    expect(parseForegroundLine('null')).toBeNull()
    expect(parseForegroundLine('not json')).toBeNull()
    expect(parseForegroundLine('{"name":"missing identifier"}')).toBeNull()
  })

  it('reports no application names on an unsupported platform instead of guessing', () => {
    const onFailure = vi.fn()
    const listener = vi.fn()
    const source = createForegroundAppSource({ platform: 'aix' })

    expect(source.supported).toBe(false)
    source.start(listener, onFailure)
    source.stop()

    expect(onFailure).toHaveBeenCalledWith(
      expect.stringContaining('not implemented for this operating system')
    )
    expect(listener).not.toHaveBeenCalled()
  })

  it('explains that Linux needs X11 and xdotool instead of silently reporting nothing', () => {
    vi.stubEnv('DISPLAY', '')
    const source = createForegroundAppSource({ platform: 'linux' })

    expect(source.supported).toBe(false)
    expect(source.limitation).toContain('X11')
    expect(source.limitation).toContain('Wayland')
  })

  it('streams only identifier and display name from the Windows helper', async () => {
    vi.useFakeTimers()
    const child = fakeChild()
    const spawnImpl = vi.fn(() => child)
    const source = createForegroundAppSource({
      platform: 'win32',
      spawnImpl: spawnImpl as unknown as typeof import('node:child_process').spawn
    })

    const listener = vi.fn()
    source.start(listener)

    const script = String(spawnImpl.mock.calls[0][1])
    expect(script).toContain('GetForegroundWindow')
    expect(script).toContain('GetWindowThreadProcessId')
    expect(script).not.toContain('GetWindowText')
    expect(script).not.toContain('Clipboard')

    child.stdout.emit('data', '{"identifier":"Code","name":"Visual Studio Code"}\n')
    expect(listener).toHaveBeenCalledWith({
      identifier: 'code',
      name: 'Visual Studio Code'
    })

    child.stdout.emit('data', 'null\n')
    expect(listener).toHaveBeenLastCalledWith(null)

    source.stop()
    expect(child.kill).toHaveBeenCalled()
  })

  it('reports a missing macOS permission as a limitation', () => {
    vi.useFakeTimers()
    const child = fakeChild()
    const source = createForegroundAppSource({
      platform: 'darwin',
      spawnImpl: (() => child) as unknown as typeof import('node:child_process').spawn,
      pollIntervalMs: 60_000
    })

    const listener = vi.fn()
    const onFailure = vi.fn()
    source.start(listener, onFailure)
    child.stderr.emit('data', 'not authorized')
    child.emit('exit', 1)

    expect(onFailure).toHaveBeenCalledWith(expect.stringContaining('Accessibility'))
    expect(listener).toHaveBeenLastCalledWith(null)

    source.stop()
  })
})