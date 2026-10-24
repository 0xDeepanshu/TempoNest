import { useState } from 'react'
import {
  AlertTriangle,
  CloudOff,
  Coffee,
  Loader2,
  LogOut,
  Play,
  RotateCw,
  Square
} from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Logo } from '@/components/Logo'
import { cn } from '@/lib/cn'
import { formatClock, formatDuration, formatTime } from '@/lib/time'
import { useTimer } from '@/tracking/TimerProvider'
import type { TrackingStatus } from '@/types/tracking'

const STATUS_META: Record<
  TrackingStatus,
  { label: string; pill: string; dot: string; pulse: boolean }
> = {
  idle: {
    label: 'Not tracking',
    pill: 'border-slate-200 bg-slate-50 text-slate-600',
    dot: 'bg-slate-400',
    pulse: false
  },
  working: {
    label: 'Tracking',
    pill: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    dot: 'bg-emerald-500',
    pulse: true
  },
  on_break: {
    label: 'On break',
    pill: 'border-amber-200 bg-amber-50 text-amber-700',
    dot: 'bg-amber-500',
    pulse: false
  }
}

export function TrackerScreen() {
  const { session, signOut } = useAuth()
  const {
    status,
    activeSessionStartedAt,
    activeBreakStartedAt,
    workElapsedMs,
    breakElapsedMs,
    todayTotals,
    totalsState,
    totalsError,
    retryTotals,
    connection,
    syncMessage,
    pendingEvents,
    startWork,
    stopWork,
    startBreak,
    resumeWork
  } = useTimer()
  const [isSigningOut, setIsSigningOut] = useState(false)

  const employee = session?.employee
  const organization = session?.membership.organization

  if (!employee || !organization) return null

  const statusMeta = STATUS_META[status]
  const isOnBreak = status === 'on_break'
  const totalsVerified = totalsState === 'ready'
  const totalsPlaceholder = '—'
  const roundedWork = formatDuration(todayTotals.workMs)
  const roundedBreak = formatDuration(todayTotals.breakMs)
  const hint =
    status === 'working' && activeSessionStartedAt !== null
      ? `Running since ${formatTime(activeSessionStartedAt)} · Work time is recording.`
      : isOnBreak && activeBreakStartedAt !== null
        ? `Break began at ${formatTime(activeBreakStartedAt)} · Your work timer is paused.`
        : 'Start a session when you are ready.'

  async function handleSignOut() {
    if (isSigningOut) return
    setIsSigningOut(true)

    try {
      await signOut()
    } catch {
      // AuthProvider clears local state even if the adapter fails to sign out.
    } finally {
      setIsSigningOut(false)
    }
  }

  return (
    <div className="flex h-full flex-col bg-canvas">
      <header className="shrink-0 border-b border-line/80 bg-white/80 backdrop-blur-sm">
        <div className="mx-auto flex h-[70px] w-full max-w-5xl items-center justify-between gap-4 px-5 sm:px-8">
          <Logo />

          <div className="flex min-w-0 items-center gap-3.5">
            <div className="hidden min-w-0 text-right sm:block">
              <p className="truncate text-sm font-semibold leading-5 text-ink">{employee.name}</p>
              <p className="truncate text-[11px] leading-4 text-ink-muted">
                {[employee.jobTitle, organization.name].filter(Boolean).join(' · ')}
              </p>
            </div>
            <Avatar initials={employee.initials} />
            <span className="hidden h-7 w-px bg-line sm:block" aria-hidden="true" />
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSignOut}
              disabled={isSigningOut}
              aria-label="Log out"
              className="text-ink-muted"
            >
              {isSigningOut ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <LogOut className="h-4 w-4" aria-hidden="true" />
              )}
              <span className="hidden md:inline">Log out</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex flex-1 overflow-y-auto px-5 py-7 sm:px-8 sm:py-9">
        <div className="m-auto w-full max-w-[620px]">
          <section
            className="animate-rise rounded-[22px] border border-line/90 bg-white px-6 py-8 shadow-raised sm:px-10 sm:py-9"
            aria-label="Work timer"
          >
            <div className="flex justify-center">
              <span
                className={cn(
                  'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold',
                  statusMeta.pill
                )}
                role="status"
              >
                <span className="relative flex h-2 w-2" aria-hidden="true">
                  {statusMeta.pulse ? (
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  ) : null}
                  <span
                    className={cn('relative inline-flex h-2 w-2 rounded-full', statusMeta.dot)}
                  />
                </span>
                {statusMeta.label}
              </span>
            </div>

            <div className="mt-7 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
                {isOnBreak ? 'Work timer · Paused' : 'Working time'}
              </p>
              <p
                role="timer"
                aria-label={`Work time ${formatClock(workElapsedMs)}`}
                className={cn(
                  'mt-3 font-mono text-[58px] font-semibold leading-none tracking-[-0.055em] tabular-nums sm:text-[72px]',
                  status === 'idle' ? 'text-slate-300' : isOnBreak ? 'text-slate-400' : 'text-ink'
                )}
              >
                {formatClock(workElapsedMs)}
              </p>

              <div className="mt-4 flex min-h-7 items-center justify-center">
                {isOnBreak ? (
                  <span className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800">
                    <Coffee className="h-3.5 w-3.5" aria-hidden="true" />
                    Break {formatClock(breakElapsedMs)}
                  </span>
                ) : null}
              </div>

              <p className="mx-auto mt-1 max-w-[380px] text-xs leading-5 text-ink-muted" aria-live="polite">
                {hint}
              </p>
            </div>

            <div className="mt-7 flex flex-col items-stretch justify-center gap-2.5 sm:flex-row">
              {status === 'idle' ? (
                <Button size="lg" onClick={startWork} className="sm:min-w-[210px]">
                  <Play className="h-4 w-4 fill-current" aria-hidden="true" />
                  Start working
                </Button>
              ) : null}

              {status === 'working' ? (
                <>
                  <Button
                    variant="secondary"
                    size="lg"
                    onClick={startBreak}
                    className="sm:min-w-[160px]"
                  >
                    <Coffee className="h-4 w-4" aria-hidden="true" />
                    Take a break
                  </Button>
                  <Button
                    variant="danger"
                    size="lg"
                    onClick={stopWork}
                    className="sm:min-w-[130px]"
                  >
                    <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                    Stop
                  </Button>
                </>
              ) : null}

              {isOnBreak ? (
                <>
                  <Button size="lg" onClick={resumeWork} className="sm:min-w-[170px]">
                    <Play className="h-4 w-4 fill-current" aria-hidden="true" />
                    Resume work
                  </Button>
                  <Button
                    variant="danger"
                    size="lg"
                    onClick={stopWork}
                    className="sm:min-w-[130px]"
                  >
                    <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                    Stop
                  </Button>
                </>
              ) : null}
            </div>

            <div
              className="mt-8 grid grid-cols-3 divide-x divide-line/80 rounded-xl border border-line/80 bg-slate-50/70 py-3.5"
              aria-busy={!totalsVerified}
              aria-label="Today's totals"
            >
              <div className="px-2 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
                  Worked today
                </p>
                <p className="mt-1 text-sm font-semibold tabular-nums text-ink">
                  {totalsVerified ? roundedWork : totalsPlaceholder}
                </p>
              </div>
              <div className="px-2 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
                  Break today
                </p>
                <p className="mt-1 text-sm font-semibold tabular-nums text-ink">
                  {totalsVerified ? roundedBreak : totalsPlaceholder}
                </p>
              </div>
              <div className="px-2 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
                  Sessions
                </p>
                <p className="mt-1 text-sm font-semibold tabular-nums text-ink">
                  {totalsVerified ? todayTotals.sessionCount : totalsPlaceholder}
                </p>
              </div>
            </div>
          </section>

          {syncMessage || pendingEvents > 0 || connection === 'blocked' ? (
            <div
              className={cn(
                'mt-4 flex items-start justify-center gap-2 rounded-xl border px-3.5 py-2.5 text-left text-[11px] leading-5',
                connection === 'blocked'
                  ? 'border-rose-200 bg-rose-50 text-rose-700'
                  : 'border-amber-200 bg-amber-50 text-amber-800'
              )}
              role="status"
              aria-live="polite"
            >
              {connection === 'blocked' ? (
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <CloudOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              )}
              <span>
                {syncMessage ??
                  'Offline: timer events are stored locally and will sync automatically.'}
                {pendingEvents > 0
                  ? ` ${pendingEvents} pending event${pendingEvents === 1 ? '' : 's'}.`
                  : ''}
              </span>
            </div>
          ) : null}

          {totalsState === 'error' ? (
            <div
              className="mt-4 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-left text-[11px] leading-5 text-rose-700"
              role="alert"
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                {totalsError ?? "Today's totals could not be loaded."}
              </span>
              <button
                type="button"
                onClick={retryTotals}
                className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 font-semibold text-rose-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
              >
                <RotateCw className="h-3 w-3" aria-hidden="true" />
                Retry
              </button>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  )
}
