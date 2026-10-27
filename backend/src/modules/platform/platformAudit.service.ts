import { Op, type Transaction, type WhereOptions } from 'sequelize';
import { PlatformAuditEvent, User } from '../../database';
import { paginate } from '../../utils/pagination';
import type {
  PlatformAuditAction,
  PlatformAuditEvent as PlatformAuditEventModel,
} from './platformAuditEvent.model';
import type { PlatformAuditListQuery } from './platform.schemas';

export type PlatformAuditContext = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

export async function recordPlatformAuditEvent(
  input: {
    actorUserId: string;
    targetOrganizationId: string | null;
    targetOrganizationName: string;
    action: PlatformAuditAction;
    metadata?: Record<string, unknown>;
  },
  options: { transaction?: Transaction; context?: PlatformAuditContext } = {},
): Promise<PlatformAuditEventModel> {
  return PlatformAuditEvent.create(
    {
      actorUserId: input.actorUserId,
      targetOrganizationId: input.targetOrganizationId,
      targetOrganizationName: input.targetOrganizationName,
      action: input.action,
      metadata: input.metadata ?? {},
      ipAddress: options.context?.ipAddress ?? null,
      userAgent: options.context?.userAgent ?? null,
    },
    { transaction: options.transaction },
  );
}

export function toPlatformAuditEventSummary(event: PlatformAuditEventModel) {
  return {
    id: event.id,
    action: event.action,
    actor: event.actor
      ? { id: event.actor.id, name: event.actor.name, email: event.actor.email }
      : event.actorUserId
        ? { id: event.actorUserId, name: null, email: null }
        : null,
    organization: {
      id: event.targetOrganizationId,
      name: event.targetOrganizationName,
    },
    metadata: event.metadata,
    ipAddress: event.ipAddress,
    userAgent: event.userAgent,
    createdAt: event.createdAt,
  };
}

export async function listPlatformAuditEvents(query: PlatformAuditListQuery) {
  const where: WhereOptions = {
    ...(query.organizationId ? { targetOrganizationId: query.organizationId } : {}),
    ...(query.action ? { action: query.action } : {}),
  };

  const { rows, count } = await PlatformAuditEvent.findAndCountAll({
    where,
    include: [
      {
        model: User,
        as: 'actor',
        required: false,
        attributes: ['id', 'name', 'email'],
      },
    ],
    order: [
      ['createdAt', 'DESC'],
      ['id', 'ASC'],
    ],
    limit: query.limit,
    offset: (query.page - 1) * query.limit,
  });

  return paginate(rows.map(toPlatformAuditEventSummary), count, query.page, query.limit);
}
