import { Op } from 'sequelize';
import { config } from '../../config/env';
import {
  IntegrationClient,
  IntegrationConnection,
  IntegrationCredential,
  IntegrationEmployeeMapping,
  IntegrationWebhookDelivery,
  IntegrationWebhookSubscription,
  Organization,
} from '../../database';
import { AppError } from '../../utils/errors';
import { paginate } from '../../utils/pagination';
import { recordAuditEvent, type AuditContext } from '../screenshots/audit.service';
import {
  rotateWebhookSecret,
  toWebhookSubscriptionView,
} from './integration.webhook.service';
import type { IntegrationConnection as IntegrationConnectionModel } from './integrationConnection.model';
import type { IntegrationConnectionStatus } from './integration.constants';

const connectionInclude = [
  {
    model: IntegrationClient,
    as: 'client',
    required: true,
    attributes: ['id', 'clientId', 'name', 'description', 'status'],
  },
  {
    model: Organization,
    as: 'organization',
    required: true,
    attributes: ['id', 'name', 'status', 'timezone'],
  },
];

function toConnectionView(connection: IntegrationConnectionModel) {
  return {
    id: connection.id,
    client: connection.client
      ? {
          id: connection.client.id,
          clientId: connection.client.clientId,
          name: connection.client.name,
          description: connection.client.description,
          status: connection.client.status,
        }
      : null,
    organization: connection.organization
      ? {
          id: connection.organization.id,
          name: connection.organization.name,
          status: connection.organization.status,
        }
      : { id: connection.organizationId },
    externalOrganizationId: connection.externalOrganizationId,
    status: connection.status,
    scopes: connection.scopes,
    connectedAt: connection.connectedAt,
    lastAuthorizedAt: connection.lastAuthorizedAt,
    disconnectedAt: connection.disconnectedAt,
    revokedAt: connection.revokedAt,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}

async function loadConnection(
  organizationId: string,
  connectionId: string,
): Promise<IntegrationConnectionModel> {
  const connection = await IntegrationConnection.findOne({
    where: { id: connectionId, organizationId },
    include: connectionInclude,
  });
  if (!connection) {
    throw AppError.notFound('Integration connection not found', 'CONNECTION_NOT_FOUND');
  }
  return connection;
}

export async function listConnectionSummaries(options: {
  organizationId: string;
  page: number;
  limit: number;
  status?: IntegrationConnectionStatus;
}) {
  const { organizationId, page, limit, status } = options;
  const result = await IntegrationConnection.findAndCountAll({
    where: {
      organizationId,
      ...(status ? { status } : {}),
    },
    include: connectionInclude,
    order: [
      ['createdAt', 'DESC'],
      ['id', 'ASC'],
    ],
    limit,
    offset: (page - 1) * limit,
    distinct: true,
  });

  return paginate(
    result.rows.map((connection) => toConnectionView(connection)),
    result.count,
    page,
    limit,
  );
}

async function mappingSummary(connectionId: string) {
  const counts = await IntegrationEmployeeMapping.findAll({
    where: { connectionId },
    attributes: ['status', [IntegrationEmployeeMapping.sequelize!.fn('COUNT', '*'), 'count']],
    group: ['status'],
    raw: true,
  });

  const summary = { active: 0, pending: 0, conflict: 0, revoked: 0, total: 0 };
  for (const row of counts as unknown as { status: string; count: string | number }[]) {
    const count = Number(row.count);
    summary.total += count;
    if (row.status === 'ACTIVE') summary.active = count;
    else if (row.status === 'PENDING') summary.pending = count;
    else if (row.status === 'CONFLICT') summary.conflict = count;
    else if (row.status === 'REVOKED') summary.revoked = count;
  }
  return summary;
}

async function webhookSummary(connectionId: string) {
  const subscriptions = await IntegrationWebhookSubscription.findAll({
    where: { connectionId },
    attributes: ['id', 'status', 'lastSuccessAt', 'lastFailureAt', 'failureCount'],
  });

  const subscriptionIds = subscriptions.map((subscription) => subscription.id);
  const deliveryCounts =
    subscriptionIds.length === 0
      ? { pending: 0, delivered: 0, failed: 0, dead: 0 }
      : await IntegrationWebhookDelivery.findAll({
          where: { subscriptionId: { [Op.in]: subscriptionIds } },
          attributes: ['status', [IntegrationWebhookDelivery.sequelize!.fn('COUNT', '*'), 'count']],
          group: ['status'],
          raw: true,
        }).then((rows) => {
          const result = { pending: 0, delivered: 0, failed: 0, dead: 0 };
          for (const row of rows as unknown as { status: string; count: string | number }[]) {
            const count = Number(row.count);
            if (row.status === 'DELIVERED') result.delivered = count;
            else if (row.status === 'DEAD') result.dead = count;
            else if (row.status === 'FAILED') result.failed = count;
            else result.pending = count;
          }
          return result;
        });

  return {
    subscriptions: subscriptions.length,
    activeSubscriptions: subscriptions.filter((subscription) => subscription.status === 'ACTIVE')
      .length,
    deliveries: deliveryCounts,
  };
}

export async function getConnectionDetail(options: {
  organizationId: string;
  connectionId: string;
}) {
  const connection = await loadConnection(options.organizationId, options.connectionId);
  const [mappings, webhooks] = await Promise.all([
    mappingSummary(connection.id),
    webhookSummary(connection.id),
  ]);

  return {
    ...toConnectionView(connection),
    mappings,
    webhooks,
  };
}

async function closeConnection(options: {
  organizationId: string;
  connectionId: string;
  nextStatus: 'DISCONNECTED' | 'REVOKED';
  actorUserId: string;
  context?: AuditContext;
}): Promise<IntegrationConnectionModel> {
  const { organizationId, connectionId, nextStatus, actorUserId, context } = options;
  const connection = await loadConnection(organizationId, connectionId);

  if (connection.status === nextStatus) {
    return connection;
  }
  if (connection.status === 'REVOKED') {
    throw AppError.conflict(
      'This integration was revoked and cannot be changed',
      'CONNECTION_REVOKED',
    );
  }

  const now = new Date();

  await IntegrationCredential.update(
    {
      revokedAt: now,
      revokedReason: nextStatus === 'REVOKED' ? 'CONNECTION_REVOKED' : 'CONNECTION_DISCONNECTED',
    },
    { where: { connectionId: connection.id, revokedAt: null } },
  );

  // Webhook subscriptions stop immediately; delivery logs are retained for audit.
  await IntegrationWebhookSubscription.update(
    { status: 'DISABLED', disabledAt: now },
    { where: { connectionId: connection.id, status: { [Op.ne]: 'DISABLED' } } },
  );

  await connection.update({
    status: nextStatus,
    disconnectedAt: now,
    ...(nextStatus === 'REVOKED' ? { revokedAt: now } : {}),
  });

  await recordAuditEvent(
    {
      organizationId,
      actorUserId,
      action:
        nextStatus === 'REVOKED' ? 'INTEGRATION_REVOKED' : 'INTEGRATION_DISCONNECTED',
      entityType: 'INTEGRATION_CONNECTION',
      entityId: connection.id,
      metadata: {
        clientId: connection.clientId,
        externalOrganizationId: connection.externalOrganizationId,
      },
    },
    { context },
  );

  return connection;
}

export async function disconnectConnection(options: {
  organizationId: string;
  connectionId: string;
  actorUserId: string;
  context?: AuditContext;
}) {
  const connection = await closeConnection({ ...options, nextStatus: 'DISCONNECTED' });
  return toConnectionView(connection);
}

export async function revokeConnection(options: {
  organizationId: string;
  connectionId: string;
  actorUserId: string;
  context?: AuditContext;
}) {
  const connection = await closeConnection({ ...options, nextStatus: 'REVOKED' });
  return toConnectionView(connection);
}

/**
 * Rotates every active webhook signing secret for a connection. Each new secret
 * is returned exactly once; the previous secret remains valid for the configured
 * grace period so a partner can deploy the new value without dropping events.
 */
export async function rotateConnectionWebhookSecrets(options: {
  organizationId: string;
  connectionId: string;
  actorUserId: string;
  context?: AuditContext;
}) {
  const connection = await loadConnection(options.organizationId, options.connectionId);
  if (connection.status !== 'ACTIVE') {
    throw AppError.conflict(
      'Only an active connection can rotate webhook secrets',
      'CONNECTION_INACTIVE',
    );
  }

  const subscriptions = await IntegrationWebhookSubscription.findAll({
    where: { connectionId: connection.id, status: 'ACTIVE' },
    order: [
      ['createdAt', 'ASC'],
      ['id', 'ASC'],
    ],
  });

  const rotated = [];
  for (const subscription of subscriptions) {
    const result = await rotateWebhookSecret({
      organizationId: options.organizationId,
      connectionId: connection.id,
      subscriptionId: subscription.id,
      actorUserId: options.actorUserId,
      context: options.context,
    });
    rotated.push({
      subscription: result.subscription,
      secret: result.secret,
      previousSecretValidForSeconds: config.integrations.webhook.secretGraceSeconds,
    });
  }

  return {
    connectionId: connection.id,
    rotated: rotated.length,
    graceSeconds: config.integrations.webhook.secretGraceSeconds,
    subscriptions: rotated,
  };
}

export async function listConnectionWebhooks(options: {
  organizationId: string;
  connectionId: string;
}) {
  await loadConnection(options.organizationId, options.connectionId);
  const subscriptions = await IntegrationWebhookSubscription.findAll({
    where: { organizationId: options.organizationId, connectionId: options.connectionId },
    order: [
      ['createdAt', 'ASC'],
      ['id', 'ASC'],
    ],
  });
  return subscriptions.map((subscription) => toWebhookSubscriptionView(subscription));
}
