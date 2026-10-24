import type { ApplicationActivity } from './applicationActivity.model';

export function toApplicationActivitySummary(activity: ApplicationActivity) {
  return {
    id: activity.id,
    organizationId: activity.organizationId,
    employeeId: activity.employeeId,
    sessionId: activity.timeSessionId,
    desktopAgentId: activity.desktopAgentId,
    applicationIdentifier: activity.applicationIdentifier,
    applicationName: activity.applicationName,
    startedAt: activity.startedAt,
    endedAt: activity.endedAt,
    durationSeconds: activity.durationSeconds,
    idempotencyKey: activity.idempotencyKey,
    createdAt: activity.createdAt,
  };
}
