import type { Transaction } from 'sequelize';
import { AuditEvent } from '../../database';
import type { AuditAction, AuditEvent as AuditEventModel } from './auditEvent.model';

export type AuditContext = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

export async function recordAuditEvent(
  input: {
    organizationId: string;
    actorUserId?: string | null;
    targetEmployeeId?: string | null;
    action: AuditAction;
    entityType?: string;
    entityId?: string | null;
    screenshotRequestId?: string | null;
    screenshotId?: string | null;
    metadata?: Record<string, unknown>;
  },
  options: { transaction?: Transaction; context?: AuditContext } = {},
): Promise<AuditEventModel> {
  return AuditEvent.create(
    {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId ?? null,
      targetEmployeeId: input.targetEmployeeId ?? null,
      action: input.action,
      entityType: input.entityType ?? 'SCREENSHOT_REQUEST',
      entityId: input.entityId ?? input.screenshotRequestId ?? null,
      screenshotRequestId: input.screenshotRequestId ?? null,
      screenshotId: input.screenshotId ?? null,
      metadata: input.metadata ?? {},
      ipAddress: options.context?.ipAddress ?? null,
      userAgent: options.context?.userAgent ?? null,
    },
    { transaction: options.transaction },
  );
}
