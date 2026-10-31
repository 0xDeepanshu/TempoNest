import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  timer: {
    current: {} as Record<string, unknown>
  },
  auth: {
    session: {
      employee: {
        id: 'user-1',
        organizationId: 'org-1',
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        initials: 'AL',
        jobTitle: 'Engineer',
        team: ''
      },
      membership: {
        employeeId: 'user-1',
        organization: { id: 'org-1', name: 'Acme', slug: 'acme' },
        role: 'employee'
      },
      authenticatedAt: '2026-10-24T09:00:00.000Z'
    }
  }
}))

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({
    session: mocks.auth.session,
    signIn: async () => undefined,
    signOut: async () => undefined
  })
}))

vi.mock('@/tracking/TimerProvider', () => ({
  useTimer: () => mocks.timer.current
}))

import { LoginScreen } from '@/screens/LoginScreen'
import { TrackerScreen } from '@/screens/TrackerScreen'

function timer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ready: true,
    status: 'idle',
    activeSessionStartedAt: null,
    activeBreakStartedAt: null,
    workElapsedMs: 0,
    breakElapsedMs: 0,
    todayTotals: { workMs: 55 * 60_000, breakMs: 15 * 60_000, sessionCount: 1 },
    totalsState: 'ready',
    totalsError: null,
    connection: 'online',
    syncMessage: null,
    pendingEvents: 0,
    startWork: () => undefined,
    stopWork: () => undefined,
    startBreak: () => undefined,
    resumeWork: () => undefined,
    retryTotals: () => undefined,
    ...overrides
  }
}

function render(): string {
  return renderToStaticMarkup(createElement(TrackerScreen))
}

beforeEach(() => {
  mocks.timer.current = timer()
})

describe('TrackerScreen content', () => {
  it('shows identity, controls and verified totals without monitoring or footer text', () => {
    const html = render()

    expect(html).toContain('Ada Lovelace')
    expect(html).toContain('Log out')
    expect(html).toContain('Start working')
    expect(html).toContain('Worked today')
    expect(html).toContain('55m')
    expect(html).toContain('15m')

    expect(html.toLowerCase()).not.toContain('screenshot')
    expect(html).not.toContain('Monitoring controlled by your organization')
    expect(html).not.toContain('Screen monitoring is enabled')
    expect(html).not.toContain('Authorized administrators')
    expect(html).not.toContain('employee workspace')
  })

  it('does not present zero totals while reconciliation is still loading', () => {
    mocks.timer.current = timer({ todayTotals: { workMs: 0, breakMs: 0, sessionCount: 0 }, totalsState: 'loading' })
    const html = render()

    expect(html).toContain('—')
    expect(html).toContain('aria-busy="true"')
    expect(html).not.toContain('0m')
    expect(html).toContain('Start working')
  })

  it('shows a recoverable totals error instead of zero when loading fails', () => {
    mocks.timer.current = timer({
      todayTotals: { workMs: 0, breakMs: 0, sessionCount: 0 },
      totalsState: 'error',
      totalsError: "Today's totals could not be loaded. Check the connection and retry."
    })
    const html = render()

    expect(html).toContain("Today&#x27;s totals could not be loaded.")
    expect(html).toContain('Retry')
    expect(html).not.toContain('0m')
  })

  it('keeps stop and break controls available while tracking', () => {
    mocks.timer.current = timer({ status: 'working', activeSessionStartedAt: Date.now() })
    const html = render()

    expect(html).toContain('Take a break')
    expect(html).toContain('Stop')
  })

  it('shows the organization activity policy and what is collected', () => {
    mocks.timer.current = timer({
      activity: {
        policyKnown: true,
        appTrackingEnabled: true,
        idleDetectionEnabled: true,
        productivityClassificationEnabled: true,
        idleThresholdMinutes: 5,
        policyVersion: 12,
        foregroundDetection: 'supported',
        foregroundDetectionMessage: null,
        appCollectionActive: true,
        idleCollectionActive: false,
        pendingAppEvents: 2,
        pendingIdleIntervals: 1,
        lastUploadAt: null,
        message: null
      }
    })
    const html = render()

    expect(html).toContain('Activity tracking')
    expect(html).toContain('App activity')
    expect(html).toContain('Recording while you work')
    expect(html).toContain('Idle detection')
    expect(html).toContain('Idle after 5 min without input')
    expect(html).toContain('Policy v12')
    expect(html).toContain('3 activity records waiting to upload')
    expect(html).toContain('Window titles')
    expect(html.toLowerCase()).not.toContain('screenshot')
  })

  it('shows when the organization has disabled activity collection', () => {
    mocks.timer.current = timer({
      activity: {
        policyKnown: true,
        appTrackingEnabled: false,
        idleDetectionEnabled: false,
        productivityClassificationEnabled: false,
        idleThresholdMinutes: 5,
        policyVersion: 3,
        foregroundDetection: 'unavailable',
        foregroundDetectionMessage: null,
        appCollectionActive: false,
        idleCollectionActive: false,
        pendingAppEvents: 0,
        pendingIdleIntervals: 0,
        lastUploadAt: null,
        message: null
      }
    })
    const html = render()

    expect(html).toContain('Turned off by your organization')
    expect(html).not.toContain('Recording while you work')
  })
})

describe('LoginScreen content', () => {
  it('keeps sign-in available without the monitoring disclosure or decorative footer', () => {
    const html = renderToStaticMarkup(createElement(LoginScreen))

    expect(html).toContain('Sign in')
    expect(html).toContain('Work email')
    expect(html.toLowerCase()).not.toContain('screenshot')
    expect(html).not.toContain('Nothing hidden')
    expect(html).not.toContain('TempoNest · Employee desktop')
  })
})
