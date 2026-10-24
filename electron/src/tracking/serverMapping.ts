import type { ServerSessionSnapshot } from '@/types/electron'
import type { BreakInterval, WorkSession } from '@/types/tracking'

function timestamp(value: string | null): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function toWorkSession(session: ServerSessionSnapshot): WorkSession | null {
  const startedAt = timestamp(session.startedAt)
  if (startedAt === null) return null

  const endedAt = timestamp(session.endedAt)
  const breaks = session.breaks
    .map((brk): BreakInterval | null => {
      const breakStart = timestamp(brk.startedAt)
      if (breakStart === null) return null
      const breakEnd = timestamp(brk.endedAt)
      return {
        id: brk.id,
        startedAt: Math.max(startedAt, breakStart),
        endedAt: breakEnd === null ? null : Math.max(breakStart, breakEnd)
      }
    })
    .filter((brk): brk is BreakInterval => brk !== null)
    .sort((left, right) => left.startedAt - right.startedAt)

  return {
    id: session.id,
    startedAt,
    endedAt,
    breaks
  }
}
