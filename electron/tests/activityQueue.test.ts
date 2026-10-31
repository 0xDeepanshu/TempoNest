import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ActivityQueue, MAX_QUEUED_APP_EVENTS } from '../electron/activityQueue'
import type { ApplicationActivityPayload, IdleIntervalPayload } from '../electron/backendTypes'

const NOW = Date.parse('2026-10-23T12:00:00.000Z')
const directories: string[] = []

function directory(): string {
  const created = mkdtempSync(join(tmpdir(), 'temponest-activity-queue-'))
  directories.push(created)
  return created
}

afterEach(() => {
  directories.splice(0)
})

function appEvent(offset = 0, overrides: Partial<ApplicationActivityPayload> = {}) {
  const startedAt = NOW + offset
  return {
    idempotencyKey: `app-device-1-${startedAt}`,
    sessionId: 'session-1',
    applicationIdentifier: 'code',
    applicationName: 'Visual Studio Code',
    platform: 'win32',
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date(startedAt + 5_000).toISOString(),
    ...overrides
  } satisfies ApplicationActivityPayload
}

function idleInterval(offset = 0): IdleIntervalPayload {
  const startedAt = NOW + offset
  return {
    idempotencyKey: `idle-device-1-${startedAt}`,
    sessionId: 'session-1',
    platform: 'win32',
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date(startedAt + 6 * 60_000).toISOString()
  }
}

describe('ActivityQueue', () => {
  it('persists queued intervals across instances and keeps ordering', () => {
    const file = join(directory(), 'queue.json')
    const first = new ActivityQueue(file)
    first.bindUser('user-1')
    first.appendApp(appEvent(0))
    first.appendApp(appEvent(10_000))
    first.appendIdle(idleInterval(0))

    const second = new ActivityQueue(file)
    expect(second.counts()).toEqual({ appEvents: 2, idleIntervals: 1 })
    expect(second.appEvents().map((event) => event.startedAt)).toEqual([
      new Date(NOW).toISOString(),
      new Date(NOW + 10_000).toISOString()
    ])
  })

  it('ignores duplicate idempotency keys so a retry cannot double-count', () => {
    const queue = new ActivityQueue(join(directory(), 'queue.json'))
    queue.bindUser('user-1')
    queue.appendApp(appEvent(0))
    queue.appendApp(appEvent(0))

    expect(queue.counts().appEvents).toBe(1)
  })

  it('drops invalid metadata instead of persisting it', () => {
    const queue = new ActivityQueue(join(directory(), 'queue.json'))
    queue.bindUser('user-1')

    expect(() =>
      queue.appendApp(appEvent(0, { applicationName: '' }))
    ).toThrow('Invalid application activity event')
    expect(() =>
      queue.appendApp(
        appEvent(0, {
          startedAt: new Date(NOW + 10_000).toISOString(),
          endedAt: new Date(NOW).toISOString()
        })
      )
    ).toThrow('Invalid application activity event')

    expect(queue.counts().appEvents).toBe(0)
  })

  it('scopes a different employee to an empty queue', () => {
    const file = join(directory(), 'queue.json')
    const queue = new ActivityQueue(file)
    queue.bindUser('user-1')
    queue.appendApp(appEvent(0))

    queue.bindUser('user-2')
    expect(queue.counts()).toEqual({ appEvents: 0, idleIntervals: 0 })

    queue.bindUser('user-1')
    expect(queue.counts().appEvents).toBe(0)
  })

  it('bounds growth by discarding the oldest entries and counting the loss', () => {
    const file = join(directory(), 'queue.json')
    const seeded = Array.from({ length: MAX_QUEUED_APP_EVENTS }, (_value, index) =>
      appEvent(index * 2_000)
    )
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        userId: 'user-1',
        appEvents: seeded,
        idleIntervals: [],
        droppedAppEvents: 0,
        droppedIdleIntervals: 0
      })
    )

    const queue = new ActivityQueue(file)
    queue.appendApp(appEvent(MAX_QUEUED_APP_EVENTS * 2_000))

    const events = queue.appEvents()
    expect(events).toHaveLength(MAX_QUEUED_APP_EVENTS)
    expect(events[0].idempotencyKey).toBe(seeded[1].idempotencyKey)
    expect(queue.droppedCounts().appEvents).toBe(1)
  })

  it('survives a corrupt queue file without throwing', () => {
    const file = join(directory(), 'queue.json')
    writeFileSync(file, '{not json')

    const queue = new ActivityQueue(file)
    queue.bindUser('user-1')
    expect(queue.counts()).toEqual({ appEvents: 0, idleIntervals: 0 })
  })

  it('stores only backend-approved activity metadata', () => {
    const file = join(directory(), 'queue.json')
    const queue = new ActivityQueue(file)
    queue.bindUser('user-1')
    queue.appendApp(appEvent(0))
    queue.appendIdle(idleInterval(0))

    const serialized = readFileSync(file, 'utf8')
    for (const forbidden of [
      'windowTitle',
      'window.title',
      'clipboard',
      'keystroke',
      'document',
      'accessToken',
      'refreshToken',
      'agentKey',
      'bearer'
    ]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }

    expect(Object.keys(queue.appEvents()[0]).sort()).toEqual([
      'applicationIdentifier',
      'applicationName',
      'endedAt',
      'idempotencyKey',
      'platform',
      'sessionId',
      'startedAt'
    ])
  })
})