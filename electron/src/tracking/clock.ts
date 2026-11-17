/**
 * Session timestamps come from the server, while the renderer ticks with the
 * device clock. On a machine whose clock lags the server, a freshly started
 * session has a `startedAt` in the future, so every elapsed calculation clamps
 * to zero until the local clock catches up. Measuring the server offset with
 * each authoritative response keeps the displayed timer correct without
 * replacing the timestamp-based state machine.
 */

/** Ignore absurd offsets (for example an unset clock) instead of freezing the timer. */
export const MAX_SERVER_CLOCK_OFFSET_MS = 24 * 60 * 60 * 1000

/**
 * Difference between the server clock and this device's clock, in milliseconds.
 * Returns `null` when the server did not provide a usable timestamp so callers
 * keep the previously measured offset instead of resetting it.
 */
export function serverClockOffset(
  serverTime: string | null | undefined,
  receivedAtMs: number
): number | null {
  if (!serverTime || !Number.isFinite(receivedAtMs)) return null

  const parsed = Date.parse(serverTime)
  if (!Number.isFinite(parsed)) return null

  const offset = parsed - receivedAtMs
  if (!Number.isFinite(offset)) return null
  return Math.max(-MAX_SERVER_CLOCK_OFFSET_MS, Math.min(MAX_SERVER_CLOCK_OFFSET_MS, offset))
}

/**
 * Snapshots carry a monotonic revision from the main process. A response that
 * was produced before a newer state must not overwrite it, even when the IPC
 * messages arrive out of order.
 */
export function acceptsSnapshotRevision(
  incoming: number | undefined,
  lastApplied: number
): boolean {
  if (typeof incoming !== 'number' || !Number.isFinite(incoming)) return true
  return incoming > lastApplied
}

/** Apply the measured offset to a local timestamp used for optimistic state. */
export function serverAdjustedNow(localNowMs: number, offsetMs: number): number {
  const adjusted = localNowMs + (Number.isFinite(offsetMs) ? offsetMs : 0)
  return Number.isFinite(adjusted) ? adjusted : localNowMs
}
