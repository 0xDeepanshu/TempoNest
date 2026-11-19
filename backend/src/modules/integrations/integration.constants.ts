/**
 * WorkZen partner-integration contract.
 *
 * The integration is deliberately narrow: it can only read attendance data for
 * employees that an organisation has explicitly mapped, and it cannot mutate
 * attendance, roles, users, screenshots or organisation settings.
 */
export const INTEGRATION_SCOPES = [
  'attendance:read',
  'employees:read',
  // Read-only leave data, scoped the same way as attendance:read: only the
  // explicitly mapped employee's own balances and requests, never another
  // employee's and never catalog/policy administration.
  'leave:read',
  // Read-only holiday calendar, scoped the same way: only holidays published and applicable to the
  // one explicitly mapped employee (organisation-wide or on their own applicable-employee list),
  // never unpublished drafts, never holiday creation/edit/delete.
  'holidays:read',
  // Read-only attendance correction history for one explicitly mapped employee. Scoped by the same
  // self-only rule listAttendanceCorrections already applies to non-reviewers: never another
  // employee's requests, never evidence files, never approve/reject (no write endpoint exists).
  'corrections:read',
  // Managing the webhook endpoint is integration configuration, not access to
  // additional WorkZen business data. It is optional and separate from the two
  // read scopes above.
  'webhooks:manage',
] as const;
export type IntegrationScope = (typeof INTEGRATION_SCOPES)[number];

export const INTEGRATION_READ_SCOPES = [
  'attendance:read',
  'employees:read',
  'leave:read',
  'holidays:read',
  'corrections:read',
] as const;

export const INTEGRATION_SCOPE_DESCRIPTIONS: Record<IntegrationScope, string> = {
  'attendance:read':
    'Read attendance status, work sessions, breaks, daily/monthly summaries and idle time for mapped employees.',
  'employees:read':
    'Read the minimum employee identity needed to match accounts (WorkZen user id, name and email) for employees in the connected organisation.',
  'leave:read':
    'Read leave balances and leave request history for one explicitly mapped employee. Never exposes another employee’s leave data, and never allows applying, cancelling, approving or rejecting leave.',
  'holidays:read':
    'Read the published holiday calendar applicable to one explicitly mapped employee. Never exposes unpublished holidays, and never allows creating, editing or deleting holidays.',
  'corrections:read':
    'Read attendance correction request history (type, requested times, reason, status) for one explicitly mapped employee. Never exposes evidence files or another employee’s requests, and never allows submitting, approving or rejecting a correction.',
  'webhooks:manage':
    'Create, update, rotate and inspect this integration’s webhook subscriptions and delivery logs.',
};

export const INTEGRATION_CLIENT_STATUSES = ['ACTIVE', 'DISABLED'] as const;
export type IntegrationClientStatus = (typeof INTEGRATION_CLIENT_STATUSES)[number];

export const INTEGRATION_AUTHORIZATION_REQUEST_STATUSES = [
  'PENDING',
  'APPROVED',
  'DENIED',
  'CONSUMED',
  'EXPIRED',
] as const;
export type IntegrationAuthorizationRequestStatus =
  (typeof INTEGRATION_AUTHORIZATION_REQUEST_STATUSES)[number];

export const INTEGRATION_CONNECTION_STATUSES = ['ACTIVE', 'DISCONNECTED', 'REVOKED'] as const;
export type IntegrationConnectionStatus = (typeof INTEGRATION_CONNECTION_STATUSES)[number];

export const INTEGRATION_EMPLOYEE_MAPPING_STATUSES = [
  'ACTIVE',
  'PENDING',
  'CONFLICT',
  'REVOKED',
] as const;
export type IntegrationEmployeeMappingStatus =
  (typeof INTEGRATION_EMPLOYEE_MAPPING_STATUSES)[number];

export const INTEGRATION_MATCH_METHODS = ['AUTO_EMAIL', 'MANUAL'] as const;
export type IntegrationMatchMethod = (typeof INTEGRATION_MATCH_METHODS)[number];

/** Reasons a mapping needs an organisation owner to resolve it. */
export const INTEGRATION_MAPPING_CONFLICT_REASONS = [
  'EMAIL_NOT_VERIFIED',
  'EMAIL_MISMATCH',
  'ALREADY_MAPPED',
  'EMPLOYEE_NOT_FOUND',
  'EXTERNAL_ACCOUNT_ALREADY_MAPPED',
  // Partner-submitted matches never activate on their own: WorkZen has no
  // authoritative mailbox proof, so an owner/admin must approve every link.
  'MANUAL_APPROVAL_REQUIRED',
] as const;
export type IntegrationMappingConflictReason =
  (typeof INTEGRATION_MAPPING_CONFLICT_REASONS)[number];

export const INTEGRATION_WEBHOOK_SUBSCRIPTION_STATUSES = ['ACTIVE', 'PAUSED', 'DISABLED'] as const;
export type IntegrationWebhookSubscriptionStatus =
  (typeof INTEGRATION_WEBHOOK_SUBSCRIPTION_STATUSES)[number];

export const INTEGRATION_WEBHOOK_EVENT_TYPES = [
  'attendance.started',
  'attendance.stopped',
  'attendance.paused',
  'attendance.resumed',
  'attendance.updated',
  'break.started',
  'break.ended',
] as const;
export type IntegrationWebhookEventType = (typeof INTEGRATION_WEBHOOK_EVENT_TYPES)[number];

export const INTEGRATION_WEBHOOK_EVENT_STATUSES = [
  'PENDING',
  'PROCESSING',
  'DELIVERED',
  'FAILED',
  'DEAD',
] as const;
export type IntegrationWebhookEventStatus =
  (typeof INTEGRATION_WEBHOOK_EVENT_STATUSES)[number];

export const INTEGRATION_WEBHOOK_DELIVERY_STATUSES = [
  'PENDING',
  'PROCESSING',
  'DELIVERED',
  'FAILED',
  'DEAD',
] as const;
export type IntegrationWebhookDeliveryStatus =
  (typeof INTEGRATION_WEBHOOK_DELIVERY_STATUSES)[number];

export const INTEGRATION_AUTHORIZATION_CODE_CHALLENGE_METHOD = 'S256' as const;
