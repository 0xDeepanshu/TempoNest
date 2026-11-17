import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { UpdateNoticeView } from '@/components/UpdateNotice'
import type { UpdateStatus } from '@/types/electron'

const noop = () => undefined

function status(overrides: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    phase: 'idle',
    supported: true,
    currentVersion: '0.2.0',
    availableVersion: null,
    progressPercent: null,
    message: null,
    lastCheckedAt: null,
    ...overrides
  }
}

function render(
  overrides: Partial<UpdateStatus> = {},
  props: {
    pendingAction?: 'check' | 'download' | 'install' | null
    actionError?: string | null
  } = {}
): string {
  return renderToStaticMarkup(
    createElement(UpdateNoticeView, {
      status: status(overrides),
      onCheck: noop,
      onDownload: noop,
      onInstall: noop,
      ...props
    })
  )
}

describe('UpdateNoticeView', () => {
  it('renders nothing for idle, checking, no-update and unsupported states', () => {
    expect(render()).toBe('')
    expect(render({ phase: 'checking' })).toBe('')
    expect(render({ phase: 'not-available' })).toBe('')
    expect(render({ supported: false, phase: 'available', availableVersion: '0.2.1' })).toBe('')
  })

  it('offers a manual download when an update is available', () => {
    const html = render({ phase: 'available', availableVersion: '0.2.1' })

    expect(html).toContain('A new WorkZen update is available.')
    expect(html).toContain('Version 0.2.1 is ready to download.')
    expect(html).toContain('Download update')
    expect(html).not.toContain('progressbar')
  })

  it('shows download progress without any action button', () => {
    const html = render({ phase: 'downloading', availableVersion: '0.2.1', progressPercent: 43 })

    expect(html).toContain('Downloading the WorkZen update')
    expect(html).toContain('43% downloaded.')
    expect(html).toContain('role="progressbar"')
    expect(html).toContain('aria-valuenow="43"')
    expect(html).not.toContain('Download update')
  })

  it('asks the employee to restart once the download is ready', () => {
    const html = render({
      phase: 'downloaded',
      availableVersion: '0.2.1',
      progressPercent: 100
    })

    expect(html).toContain('Update downloaded. Restart WorkZen to install.')
    expect(html).toContain('Your sign-in, timer, and queued tracking data will be kept.')
    expect(html).toContain('Restart &amp; install')
  })

  it('shows a retryable error and prefers the latest action error', () => {
    const html = render(
      {
        phase: 'error',
        message: 'Could not reach the update server. Check your connection and try again.'
      },
      { actionError: 'The update could not be started. Restart WorkZen and try again.' }
    )

    expect(html).toContain('The update could not be completed.')
    expect(html).toContain('The update could not be started. Restart WorkZen and try again.')
    expect(html).not.toContain('Could not reach the update server')
    expect(html).toContain('Retry')
  })

  it('disables actions while one is in flight', () => {
    const html = render({ phase: 'available', availableVersion: '0.2.1' }, { pendingAction: 'download' })

    expect(html).toContain('Starting…')
    expect(html).toContain('disabled')
  })
})
