import { config } from '../../config/env';
import { isAgentOnline } from '../desktopAgents/desktopAgent.mapper';
import type { AuditEvent } from './auditEvent.model';
import type { Screenshot } from './screenshot.model';
import type { ScreenshotPolicy } from './screenshotPolicy.model';
import type { ScreenshotRequest } from './screenshotRequest.model';

function userSummary(user: ScreenshotRequest['employee'] | undefined | null) {
  return user
    ? { id: user.id, name: user.name, email: user.email }
    : undefined;
}

export function toScreenshotSummary(screenshot: Screenshot) {
  return {
    id: screenshot.id,
    organizationId: screenshot.organizationId,
    employeeId: screenshot.employeeId,
    timeSessionId: screenshot.timeSessionId,
    screenshotRequestId: screenshot.screenshotRequestId,
    requestingAdminId: screenshot.requestingAdminId,
    capturedAt: screenshot.capturedAt,
    contentType: screenshot.contentType,
    fileSizeBytes: screenshot.fileSizeBytes,
    retentionExpiresAt: screenshot.retentionExpiresAt,
    createdAt: screenshot.createdAt,
    updatedAt: screenshot.updatedAt,
    ...(screenshot.employee
      ? { employee: userSummary(screenshot.employee) }
      : {}),
    ...(screenshot.requestingAdmin
      ? { requestingAdmin: userSummary(screenshot.requestingAdmin) }
      : {}),
  };
}

export type ScreenshotSummary = ReturnType<typeof toScreenshotSummary>;

export function toScreenshotRequestSummary(request: ScreenshotRequest, now = new Date()) {
  const agent = request.desktopAgent;
  return {
    id: request.id,
    organizationId: request.organizationId,
    employeeId: request.employeeId,
    requestingAdminId: request.requestingAdminId,
    desktopAgentId: request.desktopAgentId,
    timeSessionId: request.timeSessionId,
    status: request.status,
    requestedAt: request.requestedAt,
    expiresAt: request.expiresAt,
    acknowledgedAt: request.acknowledgedAt,
    claimedAt: request.claimedAt,
    completedAt: request.completedAt,
    cancelledAt: request.cancelledAt,
    failure: request.failureCode
      ? { code: request.failureCode, message: request.failureMessage }
      : null,
    canCancel: request.status === 'PENDING' || request.status === 'CLAIMED',
    ...(request.employee ? { employee: userSummary(request.employee) } : {}),
    ...(request.requestingAdmin
      ? { requestingAdmin: userSummary(request.requestingAdmin) }
      : {}),
    ...(agent
      ? {
          desktopAgent: {
            id: agent.id,
            name: agent.name,
            platform: agent.platform,
            status: agent.revokedAt ? ('REVOKED' as const) : ('ACTIVE' as const),
            online: isAgentOnline(agent, now),
          },
        }
      : {}),
    ...(request.screenshot
      ? { screenshot: toScreenshotSummary(request.screenshot) }
      : {}),
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

export type ScreenshotRequestSummary = ReturnType<typeof toScreenshotRequestSummary>;

/**
 * Server -> agent delivery payload. It contains no storage key, upload token,
 * other employees, or admin identity: the agent only needs to identify and
 * claim its own request.
 */
export function toScreenshotRequestCommand(request: ScreenshotRequest) {
  return {
    type: 'screenshot.request' as const,
    requestId: request.id,
    sessionId: request.timeSessionId,
    requestedAt: request.requestedAt.toISOString(),
    expiresAt: request.expiresAt.toISOString(),
    maxBytes: config.screenshots.maxBytes,
    allowedContentTypes: config.screenshots.allowedContentTypes,
    requiresClaim: true,
  };
}

export function toScreenshotPendingSummary(request: ScreenshotRequest) {
  return {
    requestId: request.id,
    sessionId: request.timeSessionId,
    status: request.status,
    requestedAt: request.requestedAt,
    expiresAt: request.expiresAt,
    claimedAt: request.claimedAt,
    expectedContentType: request.expectedContentType,
    uploadedAt: request.uploadedAt,
  };
}

/** Employee-facing disclosure. Never includes role lists or retention overrides. */
export function toScreenshotPolicyDisclosure(
  policy: ScreenshotPolicy,
  acknowledgedAt: Date | null,
) {
  return {
    enabled: policy.enabled,
    retentionDays: policy.retentionDays,
    disclosure: {
      version: policy.disclosureVersion,
      text: policy.disclosureText,
      acknowledgementRequired: policy.employeeAcknowledgementRequired,
      acknowledged: acknowledgedAt !== null,
      acknowledgedAt,
    },
    updatedAt: policy.updatedAt,
  };
}

/**
 * Admin-facing audit row. Metadata is already sanitized when it is written;
 * storage keys, upload tokens, and image bytes are never part of this shape.
 */
export function toScreenshotAuditEventSummary(event: AuditEvent) {
  return {
    id: event.id,
    action: event.action,
    actorUserId: event.actorUserId,
    ...(event.actor ? { actor: userSummary(event.actor) } : {}),
    targetEmployeeId: event.targetEmployeeId,
    ...(event.targetEmployee ? { targetEmployee: userSummary(event.targetEmployee) } : {}),
    entityType: event.entityType,
    entityId: event.entityId,
    screenshotRequestId: event.screenshotRequestId,
    screenshotId: event.screenshotId,
    metadata: event.metadata,
    createdAt: event.createdAt,
  };
}

export type ScreenshotAuditEventSummary = ReturnType<typeof toScreenshotAuditEventSummary>;

/** Admin-facing policy representation. */
export function toScreenshotPolicySummary(policy: ScreenshotPolicy) {
  return {
    organizationId: policy.organizationId,
    enabled: policy.enabled,
    requestRoles: policy.requestRoles,
    viewRoles: policy.viewRoles,
    requestCooldownSeconds: policy.requestCooldownSeconds,
    retentionDays: policy.retentionDays,
    auditRetentionDays: policy.auditRetentionDays,
    employeeAcknowledgementRequired: policy.employeeAcknowledgementRequired,
    disclosureVersion: policy.disclosureVersion,
    disclosureText: policy.disclosureText,
    createdAt: policy.createdAt,
    updatedAt: policy.updatedAt,
  };
}
