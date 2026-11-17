import { describe, expect, it } from 'vitest'
import {
  acceptsSnapshotRevision,
  MAX_SERVER_CLOCK_OFFSET_MS,
  serverAdjustedNow,
  serverClockOffset
} from '../src/tracking/clock'
import { workElapsedMs } from '../src/tracking/timerMachine'
import type { WorkSession } from '../src/types/tracking'

const MINUTE = 60_000

describe('serverClockOffset', () => {
  it('measures a server clock that is ahead of the device clock', () => {
    const receivedAt = Date.parse('2026-10-24T09:00:00.000Z')
    expect(serverClockOffset('2026-10-24T09:05:00.000Z', receivedAt)).toBe(5 * MINUTE)
  })

  it('measures a server clock that is behind the device clock', () => {
    const receivedAt = Date.parse('2026-10-24T09:05:00.000Z')
    expect(serverClockOffset('2026-10-24T09:00:00.000Z', receivedAt)).toBe(-5 * MINUTE)
  })

  it('returns null for a missing or invalid server time so the last offset survives', () => {
    expect(serverClockOffset(null, Date.now())).toBeNull()
    expect(serverClockOffset(undefined, Date.now())).toBeNull()
    expect(serverClockOffset('not-a-date', Date.now())).toBeNull()
  })

  it('clamps absurd offsets to a full day instead of freezing the timer', () => {
    const receivedAt = Date.parse('2026-10-24T09:00:00.000Z')
    expect(serverClockOffset('2200-01-01T00:00:00.000Z', receivedAt)).toBe(
      MAX_SERVER_CLOCK_OFFSET_MS
    )
    expect(serverClockOffset('1970-01-01T00:00:00.000Z', receivedAt)).toBe(
      -MAX_SERVER_CLOCK_OFFSET_MS
    )
  })
})

describe('acceptsSnapshotRevision', () => {
  it('rejects a snapshot that predates the state already applied', () => {
    expect(acceptsSnapshotRevision(3, 5)).toBe(false)
    expect(acceptsSnapshotRevision(5, 5)).toBe(false)
    expect(acceptsSnapshotRevision(6, 5)).toBe(true)
  })

  it('accepts snapshots without a revision for compatibility with older state events', () => {
    expect(acceptsSnapshotRevision(undefined, 5)).toBe(true)
  })
})

describe('server-adjusted elapsed time', () => {
  it('keeps a freshly started session above zero when the device clock lags the server', () => {
    const offset = 5 * MINUTE
    const localReceivedAt = Date.parse('2026-10-24T08:00:00.000Z')
    // The server authored this start time, so it is ahead of the local clock by
    // the same amount. Comparing it with the raw local clock used to clamp the
    // whole session to 00:00:00.
    const session: WorkSession = {
      id: 'skewed',
      startedAt: localReceivedAt + offset,
      endedAt: null,
      breaks: []
    }

    const rawNow = localReceivedAt + 30_000
    expect(workElapsedMs(session, rawNow)).toBe(0)
    expect(workElapsedMs(session, serverAdjustedNow(rawNow, offset))).toBe(30_000)
  })

  it('leaves timestamps untouched when no offset is known', () => {
    expect(serverAdjustedNow(1_234, 0)).toBe(1_234)
    expect(serverAdjustedNow(1_234, Number.NaN)).toBe(1_234)
  })
})
