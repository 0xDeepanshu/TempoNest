import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { OfflineQueue } from '../electron/offlineQueue'

const directories: string[] = []

function createQueue(): { queue: OfflineQueue; path: string } {
  const directory = mkdtempSync(join(tmpdir(), 'temponest-queue-'))
  directories.push(directory)
  const path = join(directory, 'queue.json')
  return { queue: new OfflineQueue(path), path }
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('OfflineQueue', () => {
  it('persists events, de-duplicates IDs and removes acknowledgements', () => {
    const { queue, path } = createQueue()
    queue.bindUser('user-1')

    const event = {
      eventId: 'event-00000001',
      type: 'SESSION_START' as const,
      occurredAt: '2026-10-22T08:00:00.000Z',
      sessionId: '9e743d59-3e42-4e3e-8e0d-8a4d6f8b1c11'
    }
    queue.append(event)
    queue.append(event)
    expect(queue.count()).toBe(1)

    const reloaded = new OfflineQueue(path)
    expect(reloaded.all()).toEqual([event])

    reloaded.remove([event.eventId])
    expect(reloaded.count()).toBe(0)
  })

  it('drops another user’s queued events when the account changes', () => {
    const { queue, path } = createQueue()
    queue.bindUser('user-1')
    queue.append({
      eventId: 'event-00000002',
      type: 'SESSION_STOP' as const,
      occurredAt: '2026-10-22T08:10:00.000Z',
      sessionId: '9e743d59-3e42-4e3e-8e0d-8a4d6f8b1c11'
    })

    queue.bindUser('user-2')
    expect(queue.count()).toBe(0)
    expect(new OfflineQueue(path).count()).toBe(0)
  })
})
