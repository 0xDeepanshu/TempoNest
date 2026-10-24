/**
 * Single source of truth for user-facing product branding and storage keys.
 * Keep this module free of Node.js and browser-only APIs.
 */
export const BRANDING = {
  name: 'TempoNest',
  productLabel: 'Employee time tracker',
  tagline: 'A calmer way to track your workday.',
  shortDescription:
    'A focused desktop time tracker for employees, with separate work and break time.',
  supportEmail: 'support@temponest.app',
  copyright: 'Copyright © 2026 TempoNest',
  appId: 'app.temponest.desktop',
  storageKeys: {
    /** Current timestamp-based timer state. */
    timerState: 'temponest.timer.v2',
    /** Owner-scoped timer cache, keyed by organization and employee. */
    timerStateByOwner: 'temponest.timer.v3',
    /** Read-only migration shim for timer data created by the earlier app. */
    legacyTimerState: 'teamlogger.tracking.v1',
    /** Mock auth stores only demo identifiers, never a password or token. */
    mockAuthSession: 'temponest.mock-auth.v1'
  },
  monitoring: {
    mode: 'policy-governed',
    label: 'Monitoring controlled by your organization',
    notice:
      'Screenshots are captured only after an explicit administrator request and only when your organization enables its disclosed monitoring policy. Every capture is shown on screen; there is no periodic or hidden capture.',
    policySummary:
      'Capture runs once per authorized request, is visible in the app, and is uploaded only to private storage under your organization policy.'
  },
  adminPortalNote:
    'Organization admins manage people, monitoring policies, screenshots, and reports in the TempoNest web portal.'
} as const

export type Branding = typeof BRANDING
