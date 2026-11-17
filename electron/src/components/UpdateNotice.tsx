import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Download, Loader2, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { updateService } from '@/services'
import type { UpdateStatus } from '@/types/electron'

type PendingAction = 'check' | 'download' | 'install' | null

const PRESENTATION = {
  available: { tone: 'border-brand-200 bg-brand-50', icon: 'text-brand-600' },
  downloading: { tone: 'border-sky-200 bg-sky-50', icon: 'text-sky-600' },
  downloaded: { tone: 'border-emerald-200 bg-emerald-50', icon: 'text-emerald-600' },
  error: { tone: 'border-amber-200 bg-amber-50', icon: 'text-amber-600' }
} as const

/**
 * Minimal, non-blocking update notice. It renders nothing while idle, while a
 * quiet check runs, or when the installed version is current.
 */
export function UpdateNotice() {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    let receivedEvent = false
    const unsubscribe = updateService.onStatusChanged((next) => {
      if (!active) return
      receivedEvent = true
      setStatus(next)
      if (next.phase !== 'error') setActionError(null)
    })

    void updateService
      .getStatus()
      .then((next) => {
        // A broadcast that arrived while the initial status was in flight is
        // newer than the fetched snapshot.
        if (active && !receivedEvent) setStatus(next)
      })
      .catch(() => undefined)

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const run = useCallback(
    async (
      action: Exclude<PendingAction, null>,
      operation: () => Promise<UpdateStatus | void>
    ) => {
      if (pendingAction) return
      setPendingAction(action)
      setActionError(null)
      try {
        const next = await operation()
        if (next) setStatus(next)
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : 'The update action could not be completed.'
        )
      } finally {
        setPendingAction(null)
      }
    },
    [pendingAction]
  )

  return (
    <UpdateNoticeView
      status={status}
      pendingAction={pendingAction}
      actionError={actionError}
      onCheck={() => void run('check', updateService.check)}
      onDownload={() => void run('download', updateService.download)}
      onInstall={() => void run('install', updateService.install)}
    />
  )
}

export function UpdateNoticeView({
  status,
  pendingAction = null,
  actionError = null,
  onCheck,
  onDownload,
  onInstall
}: {
  status: UpdateStatus | null
  pendingAction?: PendingAction
  actionError?: string | null
  onCheck: () => void
  onDownload: () => void
  onInstall: () => void
}) {
  if (!status || !status.supported) return null
  if (status.phase === 'idle' || status.phase === 'checking' || status.phase === 'not-available') {
    return null
  }

  const presentation = PRESENTATION[status.phase]
  const percent = status.progressPercent
  const actionBusy = pendingAction !== null

  return (
    <section
      className={cn('mt-4 rounded-xl border px-4 py-3', presentation.tone)}
      role="status"
      aria-live="polite"
      aria-label="Application update"
    >
      <div className="flex flex-wrap items-start gap-2.5">
        <UpdateIcon phase={status.phase} className={presentation.icon} />

        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold leading-5 text-ink">{titleFor(status)}</p>
          <p className="mt-0.5 text-[11px] leading-4 text-ink-soft">
            {detailFor(status, actionError)}
          </p>

          {status.phase === 'downloading' ? (
            <div
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-sky-100"
              role="progressbar"
              aria-label="Update download progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent ?? 0}
            >
              <div
                className="h-full rounded-full bg-sky-500 transition-[width] duration-300"
                style={{ width: `${percent ?? 0}%` }}
              />
            </div>
          ) : null}
        </div>

        {status.phase === 'available' ? (
          <Button
            size="sm"
            variant="secondary"
            className="shrink-0"
            disabled={actionBusy}
            onClick={onDownload}
          >
            {pendingAction === 'download' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {pendingAction === 'download' ? 'Starting…' : 'Download update'}
          </Button>
        ) : null}

        {status.phase === 'downloaded' ? (
          <Button size="sm" className="shrink-0" disabled={actionBusy} onClick={onInstall}>
            {pendingAction === 'install' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {pendingAction === 'install' ? 'Restarting…' : 'Restart & install'}
          </Button>
        ) : null}

        {status.phase === 'error' ? (
          <Button
            size="sm"
            variant="secondary"
            className="shrink-0"
            disabled={actionBusy}
            onClick={onCheck}
          >
            {pendingAction === 'check' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Retry
          </Button>
        ) : null}
      </div>
    </section>
  )
}

function UpdateIcon({
  phase,
  className
}: {
  phase: UpdateStatus['phase']
  className: string
}) {
  if (phase === 'downloading' || phase === 'checking') {
    return (
      <Loader2
        className={cn('mt-0.5 h-4 w-4 shrink-0 animate-spin', className)}
        aria-hidden="true"
      />
    )
  }
  if (phase === 'error') {
    return <AlertTriangle className={cn('mt-0.5 h-4 w-4 shrink-0', className)} aria-hidden="true" />
  }
  if (phase === 'downloaded') {
    return <RotateCw className={cn('mt-0.5 h-4 w-4 shrink-0', className)} aria-hidden="true" />
  }
  return <Download className={cn('mt-0.5 h-4 w-4 shrink-0', className)} aria-hidden="true" />
}

function titleFor(status: UpdateStatus): string {
  switch (status.phase) {
    case 'available':
      return 'A new WorkZen update is available.'
    case 'downloading':
      return 'Downloading the WorkZen update…'
    case 'downloaded':
      return 'Update downloaded. Restart WorkZen to install.'
    case 'error':
      return 'The update could not be completed.'
    default:
      return ''
  }
}

function detailFor(status: UpdateStatus, actionError: string | null): string {
  if (actionError) return actionError

  switch (status.phase) {
    case 'available':
      return status.availableVersion
        ? `Version ${status.availableVersion} is ready to download.`
        : 'A newer version is ready to download.'
    case 'downloading':
      return status.progressPercent === null
        ? 'Starting the download…'
        : `${status.progressPercent}% downloaded.`
    case 'downloaded':
      return 'Your sign-in, timer, and queued tracking data will be kept.'
    case 'error':
      return status.message ?? 'Check your connection and try again.'
    default:
      return ''
  }
}
