import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { OfflineQueue } from '../electron/offlineQueue'

const directories: string[] = []

const ORG_A = 'org-a'
const ORG_B = 'org-b'
const USER_A = 'user-a'
const USER_B = 'user-b'

function createQueue(): { queue: OfflineQueue; path: string } {
  const directory = mkdtempSync(join(tmpdir(), 'temponest-queue-'))
  directories.push(directory)
  const path = join(directory, 'queue.json')
  return { queue: new OfflineQueue(path), path }
}

function event(eventId: string, sessionId: string, type: 'SESSION_START' | 'SESSION_STOP') {
  return {
    eventId,
    type,
    occurredAt: '2026-10-22T08:00:00.000Z',
    sessionId
  } as const
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('OfflineQueue', () => {
  it('persists events, de-duplicates IDs and removes acknowledgements', () => {
    const { queue, path } = createQueue()
    queue.bindOwner(ORG_A, USER_A)

    const start = event('event-00000001', '9e743d59-3e42-4e3e-8e0d-8a4d6f8b1c11', 'SESSION_START')
    queue.append(start)
    queue.append(start)
    expect(queue.count()).toBe(1)

    const reloaded = new OfflineQueue(path)
    reloaded.bindOwner(ORG_A, USER_A)
    expect(reloaded.all()).toEqual([start])

    reloaded.remove([start.eventId])
    expect(reloaded.count()).toBe(0)
  })

  it('keeps each account’s events across sign-out and account switching', () => {
    const { queue, path } = createQueue()
    const sessionA = '9e743d59-3e42-4e3e-8e0d-8a4d6f8b1c11'
    const sessionB = '3a7c3a7c-3a7c-4a7c-8a7c-3a7c3a7c3a7c'

    queue.bindOwner(ORG_A, USER_A)
    queue.append(event('event-a-0000001', sessionA, 'SESSION_START'))

    // Signing in as B on the same Windows install must not inherit or delete
    // A's pending work.
    queue.bindOwner(ORG_A, USER_B)
    expect(queue.count()).toBe(0)
    queue.append(event('event-b-0000001', sessionB, 'SESSION_START'))
    expect(queue.all().map((item) => item.eventId)).toEqual(['event-b-0000001'])

    queue.detachOwner()
    expect(queue.count()).toBe(0)

    const reloaded = new OfflineQueue(path)
    reloaded.bindOwner(ORG_A, USER_A)
    expect(reloaded.all().map((item) => item.eventId)).toEqual(['event-a-0000001'])

    reloaded.bindOwner(ORG_A, USER_B)
    expect(reloaded.all().map((item) => item.eventId)).toEqual(['event-b-0000001'])

    // Different organizations with the same employee ID stay isolated too.
    reloaded.bindOwner(ORG_B, USER_A)
    expect(reloaded.count()).toBe(0)
  })

  it('adopts a legacy single-user queue only for the matching employee', () => {
    const directory = mkdtempSync(join(tmpdir(), 'temponest-queue-legacy-'))
    directories.push(directory)
    const path = join(directory, 'queue.json')
    const legacyEvent = event(
      'event-legacy-001',
      '9e743d59-3e42-4e3e-8e0d-8a4d6f8b1c11',
      'SESSION_STOP'
    )
    writeFileSync(
      path,
      JSON.stringify({ version: 1, userId: USER_A, events: [legacyEvent] }),
      'utf8'
    )

    const queue = new OfflineQueue(path)
    queue.bindOwner(ORG_A, USER_B)
    expect(queue.count()).toBe(0)

    queue.bindOwner(ORG_A, USER_A)
    expect(queue.all()).toEqual([legacyEvent])
  })

  it('requires a bound owner before accepting events', () => {
    const { queue } = createQueue()
    expect(() =>
      queue.append(event('event-00000009', '9e743d59-3e42-4e3e-8e0d-8a4d6f8b1c11', 'SESSION_STOP'))
    ).toThrow('No offline queue owner is bound')
  })
})
