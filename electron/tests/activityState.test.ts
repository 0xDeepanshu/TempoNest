import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ActivityStateStore } from '../electron/activityState'

const NOW = Date.parse('2026-10-23T12:00:00.000Z')

function openApp(overrides: Record<string, string | null> = {}) {
  return {
    identifier: 'code',
    name: 'Visual Studio Code',
    startedAt: new Date(NOW - 60_000).toISOString(),
    lastSeenAt: new Date(NOW - 10_000).toISOString(),
    sessionId: 'session-1',
    ...overrides
  }
}

describe('ActivityStateStore', () => {
  it('round-trips open intervals so a restart can close them at the last observation', () => {
    const directory = mkdtempSync(join(tmpdir(), 'temponest-activity-state-'))
    const file = join(directory, 'state.json')

    const writer = new ActivityStateStore(file)
    writer.bindUser('user-1')
    writer.save(openApp(), {
      startedAt: new Date(NOW - 600_000).toISOString(),
      lastSeenAt: new Date(NOW - 5_000).toISOString(),
      sessionId: null
    })

    const reader = new ActivityStateStore(file)
    expect(reader.getUserId()).toBe('user-1')
    expect(reader.getOpenApp()).toEqual(openApp())
    expect(reader.getOpenIdle()?.lastSeenAt).toBe(new Date(NOW - 5_000).toISOString())
  })

  it('does not attach the previous employee intervals to a new employee', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'temponest-activity-state-')), 'state.json')
    const store = new ActivityStateStore(file)
    store.bindUser('user-1')
    store.setOpenApp(openApp())

    store.bindUser('user-2')
    expect(store.getOpenApp()).toBeNull()
    expect(store.getOpenIdle()).toBeNull()
  })

  it('rejects an interval longer than the backend maximum', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'temponest-activity-state-')), 'state.json')
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        userId: 'user-1',
        openApp: openApp({
          startedAt: new Date(NOW - 25 * 60 * 60_000).toISOString(),
          lastSeenAt: new Date(NOW).toISOString()
        }),
        openIdle: null
      })
    )

    const store = new ActivityStateStore(file)
    expect(store.getOpenApp()).toBeNull()
  })

  it('clears open intervals without clearing the employee binding', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'temponest-activity-state-')), 'state.json')
    const store = new ActivityStateStore(file)
    store.bindUser('user-1')
    store.setOpenApp(openApp())
    store.clearOpenIntervals()

    expect(store.getUserId()).toBe('user-1')
    expect(store.getOpenApp()).toBeNull()
    expect(readFileSync(file, 'utf8')).not.toContain('applicationIdentifier')
  })
})