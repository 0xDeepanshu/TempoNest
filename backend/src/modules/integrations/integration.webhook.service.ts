import { Op, UniqueConstraintError } from 'sequelize';
import { config } from '../../config/env';
import { logger } from '../../config/logger';
import {
  sequelize,
  IntegrationConnection,
  IntegrationEmployeeMapping,
  IntegrationWebhookDelivery,
  IntegrationWebhookEvent,
  IntegrationWebhookSubscription,
} from '../../database';
import { AppError } from '../../utils/errors';
import { paginate } from '../../utils/pagination';
import { serializeByKey } from '../../utils/serialize';
import { recordAuditEvent, type AuditContext } from '../screenshots/audit.service';
import {
  assertIntegrationWebhookUrl,
  decryptIntegrationValue,
  encryptIntegrationValue,
  generateWebhookSecret,
  signWebhookPayload,
} from './integration.crypto';
import {
  WebhookDestinationError,
  webhookTransport,
} from './integration.webhookTransport';
import type {
  IntegrationWebhookEventType,
  IntegrationWebhookEventStatus,
} from './integration.constants';
import type { IntegrationConnection as IntegrationConnectionModel } from './integrationConnection.model';
import type { IntegrationWebhookDelivery as DeliveryModel } from './integrationWebhookDelivery.model';
import type { IntegrationWebhookSubscription as SubscriptionModel } from './integrationWebhookSubscription.model';
import type {
  CreateWebhookSubscriptionInput,
  UpdateWebhookSubscriptionInput,
} from './integration.schemas';

const ACTIVE_DELIVERY_STATUSES = ['PENDING', 'PROCESSING', 'FAILED'] as const;

export type PublishIntegrationEventInput = {
  organizationId: string;
  employeeId: string;
  eventType: IntegrationWebhookEventType;
  payload?: Record<string, unknown>;
  occurredAt?: Date;
};

export type PublishIntegrationEventResult = {
  eventsCreated: number;
  deliveriesCreated: number;
};

function toSubscriptionView(subscription: SubscriptionModel) {
  return {
    id: subscription.id,
    connectionId: subscription.connectionId,
    url: subscription.url,
    description: subscription.description,
    eventTypes: subscription.eventTypes,
    status: subscription.status,
    secretVersion: subscription.secretVersion,
    lastSuccessAt: subscription.lastSuccessAt,
    lastFailureAt: subscription.lastFailureAt,
    failureCount: subscription.failureCount,
    disabledAt: subscription.disabledAt,
    createdAt: subscription.createdAt,
    updatedAt: subscription.updatedAt,
  };
}

export { toSubscriptionView as toWebhookSubscriptionView };

function eventPayloadFor(options: {
  eventId: string;
  eventType: string;
  sequence: number;
  occurredAt: Date;
  organizationId: string;
  connectionId: string;
  payload: Record<string, unknown>;
}) {
  return {
    id: options.eventId,
    type: options.eventType,
    sequence: options.sequence,
    occurredAt: options.occurredAt.toISOString(),
    organizationId: options.organizationId,
    connectionId: options.connectionId,
    data: options.payload,
  };
}

async function createEventForConnection(options: {
  connection: IntegrationConnectionModel;
  subscriptions: SubscriptionModel[];
  eventType: IntegrationWebhookEventType;
  payload: Record<string, unknown>;
  occurredAt: Date;
}): Promise<{ deliveries: number }> {
  const { connection, subscriptions, eventType, payload, occurredAt } = options;
  if (subscriptions.length === 0) return { deliveries: 0 };

  return serializeByKey(`integration-webhook-sequence:${connection.id}`, () =>
    sequelize.transaction(async (transaction) => {
      const locked = await IntegrationConnection.findByPk(connection.id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!locked || locked.status !== 'ACTIVE') return { deliveries: 0 };

      const sequence = locked.webhookSequence + 1;
      const eventId = crypto.randomUUID();

      await locked.update({ webhookSequence: sequence }, { transaction });

      const event = await IntegrationWebhookEvent.create(
        {
          connectionId: locked.id,
          organizationId: locked.organizationId,
          eventId,
          eventType,
          sequence,
          payload: eventPayloadFor({
            eventId,
            eventType,
            sequence,
            occurredAt,
            organizationId: locked.organizationId,
            connectionId: locked.id,
            payload,
          }),
          occurredAt,
          status: 'PENDING',
        },
        { transaction },
      );

      await IntegrationWebhookDelivery.bulkCreate(
        subscriptions.map((subscription) => ({
          eventId: event.id,
          subscriptionId: subscription.id,
          organizationId: locked.organizationId,
          status: 'PENDING' as const,
          attemptCount: 0,
          nextAttemptAt: new Date(),
        })),
        { transaction },
      );

      return { deliveries: subscriptions.length };
    }),
  );
}

/**
 * Durable, non-blocking outbox write. Webhooks are supplementary to the REST
 * API: a delivery problem must never fail or roll back an attendance write.
 */
export async function publishIntegrationEvent(
  input: PublishIntegrationEventInput,
): Promise<PublishIntegrationEventResult> {
  if (!config.integrations.enabled) {
    return { eventsCreated: 0, deliveriesCreated: 0 };
  }

  let eventsCreated = 0;
  let deliveriesCreated = 0;

  try {
    const connections = await IntegrationConnection.findAll({
      where: { organizationId: input.organizationId, status: 'ACTIVE' },
    });

    for (const connection of connections) {
      const mapping = await IntegrationEmployeeMapping.findOne({
        where: {
          connectionId: connection.id,
          organizationId: input.organizationId,
          workzenUserId: input.employeeId,
          status: 'ACTIVE',
        },
        attributes: ['externalEmployeeId'],
      });
      // Only explicitly mapped employees may generate partner events.
      if (!mapping) continue;

      const subscriptions = await IntegrationWebhookSubscription.findAll({
        where: { connectionId: connection.id, status: 'ACTIVE' },
      });
      const matching = subscriptions.filter((subscription) =>
        subscription.eventTypes.includes(input.eventType),
      );
      if (matching.length === 0) continue;

      const occurredAt = input.occurredAt ?? new Date();
      const result = await createEventForConnection({
        connection,
        subscriptions: matching,
        eventType: input.eventType,
        payload: {
          ...(input.payload ?? {}),
          externalEmployeeId: mapping.externalEmployeeId,
        },
        occurredAt,
      });
      if (result.deliveries > 0) {
        eventsCreated += 1;
        deliveriesCreated += result.deliveries;
      }
    }
  } catch (error) {
    // Never propagate webhook bookkeeping failures into business operations.
    logger.error({ err: error, eventType: input.eventType }, 'failed to enqueue integration webhook');
  }

  return { eventsCreated, deliveriesCreated };
}

/** Fire-and-forget helper used by time tracking call sites. */
export function publishIntegrationEventSafely(input: PublishIntegrationEventInput): void {
  void publishIntegrationEvent(input).catch((error) => {
    logger.error({ err: error }, 'integration webhook publish failed');
  });
}

function webhookBackoffSeconds(attempt: number): number {
  const base = config.integrations.webhook.backoffBaseSeconds;
  const max = config.integrations.webhook.backoffMaxSeconds;
  const exponential = Math.min(max, base * 2 ** Math.max(0, attempt - 1));
  // Bounded jitter prevents a herd of retries against a recovering endpoint.
  const jitter = Math.floor(exponential * 0.2 * Math.random());
  return Math.min(max, exponential + jitter);
}

function isPermanentFailure(status: number): boolean {
  // Redirects are intentionally not followed, so a 3xx cannot become a
  // permitted destination and retrying it is pointless.
  if (status >= 300 && status < 400) return true;
  if (status === 408 || status === 425 || status === 429) return false;
  return status >= 400 && status < 500;
}

async function refreshEventStatus(eventId: string): Promise<void> {
  const deliveries = await IntegrationWebhookDelivery.findAll({
    where: { eventId },
    attributes: ['status'],
  });
  if (deliveries.length === 0) return;

  const statuses = new Set(deliveries.map((delivery) => delivery.status));
  let status: IntegrationWebhookEventStatus = 'PENDING';
  if ([...statuses].some((value) => (ACTIVE_DELIVERY_STATUSES as readonly string[]).includes(value))) {
    status = 'PENDING';
  } else if (statuses.size === 1 && statuses.has('DELIVERED')) {
    status = 'DELIVERED';
  } else if (statuses.has('DELIVERED')) {
    status = 'FAILED';
  } else {
    status = 'DEAD';
  }

  const event = await IntegrationWebhookEvent.findByPk(eventId);
  if (!event || event.status === status) return;
  await event.update({
    status,
    processedAt: status === 'PENDING' ? null : new Date(),
  });
}

async function markDeliveryDead(
  delivery: DeliveryModel,
  reason: string,
): Promise<void> {
  await delivery.update({
    status: 'DEAD',
    error: reason.slice(0, 1000),
    nextAttemptAt: new Date(),
  });
  await refreshEventStatus(delivery.eventId);
}

async function deliverOne(deliveryId: string): Promise<'delivered' | 'failed' | 'dead' | 'skipped'> {
  const now = new Date();
  const [claimed] = await IntegrationWebhookDelivery.update(
    { status: 'PROCESSING', lastAttemptAt: now },
    {
      where: {
        id: deliveryId,
        status: { [Op.in]: ['PENDING', 'FAILED'] },
      },
    },
  );
  if (claimed !== 1) return 'skipped';

  const delivery = await IntegrationWebhookDelivery.findByPk(deliveryId, {
    include: [
      { model: IntegrationWebhookEvent, as: 'event', required: true },
      {
        model: IntegrationWebhookSubscription,
        as: 'subscription',
        required: true,
        include: [{ model: IntegrationConnection, as: 'connection', required: true }],
      },
    ],
  });
  if (!delivery?.event || !delivery.subscription) {
    return 'skipped';
  }

  const subscription = delivery.subscription;
  const connection = subscription.connection;
  if (subscription.status !== 'ACTIVE' || !connection || connection.status !== 'ACTIVE') {
    await markDeliveryDead(delivery, 'Webhook subscription or connection is not active');
    return 'dead';
  }

  const body = JSON.stringify(delivery.event.payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const secrets: string[] = [];
  try {
    secrets.push(decryptIntegrationValue(subscription.secretCiphertext));
    if (
      subscription.previousSecretCiphertext &&
      subscription.previousSecretExpiresAt &&
      subscription.previousSecretExpiresAt.getTime() > Date.now()
    ) {
      secrets.push(decryptIntegrationValue(subscription.previousSecretCiphertext));
    }
  } catch (error) {
    logger.error({ err: error, subscriptionId: subscription.id }, 'webhook secret could not be read');
    await markDeliveryDead(delivery, 'Webhook signing secret is unavailable');
    return 'dead';
  }

  const signatures = secrets
    .map((secret) => `v1=${signWebhookPayload(secret, timestamp, body)}`)
    .join(',');
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': 'WorkZen-Webhooks/1.0',
    'x-workzen-signature': `t=${timestamp},${signatures}`,
    'x-workzen-event-id': delivery.event.eventId,
    'x-workzen-event-type': delivery.event.eventType,
    'x-workzen-event-sequence': String(delivery.event.sequence),
    'x-workzen-delivery-id': delivery.id,
  };

  let responseStatus: number | null = null;
  let error: string | null = null;
  let succeeded = false;
  let blockedDestination = false;

  try {
    const response = await webhookTransport.deliver({
      url: subscription.url,
      headers,
      body,
      timeoutMs: config.integrations.webhook.timeoutMs,
    });
    responseStatus = response.status;
    succeeded = response.status >= 200 && response.status < 300;
    if (!succeeded) error = `Endpoint responded with HTTP ${response.status}`;
  } catch (caught) {
    blockedDestination = caught instanceof WebhookDestinationError;
    error = caught instanceof Error ? caught.message : 'Webhook request failed';
  }

  const attemptCount = delivery.attemptCount + 1;

  if (succeeded) {
    await delivery.update({
      status: 'DELIVERED',
      attemptCount,
      responseStatus,
      error: null,
      deliveredAt: new Date(),
      nextAttemptAt: new Date(),
    });
    await subscription.update({
      lastSuccessAt: new Date(),
      failureCount: 0,
    });
    await refreshEventStatus(delivery.eventId);
    return 'delivered';
  }

  const permanent =
    blockedDestination || (responseStatus !== null && isPermanentFailure(responseStatus));
  const exhausted = attemptCount >= config.integrations.webhook.maxAttempts;

  if (permanent || exhausted) {
    await delivery.update({
      status: 'DEAD',
      attemptCount,
      responseStatus,
      error: error ?? 'Delivery permanently failed',
      nextAttemptAt: new Date(),
    });
    await subscription.update({
      lastFailureAt: new Date(),
      failureCount: subscription.failureCount + 1,
    });
    await refreshEventStatus(delivery.eventId);
    return 'dead';
  }

  const nextAttemptAt = new Date(Date.now() + webhookBackoffSeconds(attemptCount) * 1000);
  await delivery.update({
    status: 'FAILED',
    attemptCount,
    responseStatus,
    error: error ?? 'Delivery failed',
    nextAttemptAt,
  });
  await subscription.update({
    lastFailureAt: new Date(),
    failureCount: subscription.failureCount + 1,
  });
  await refreshEventStatus(delivery.eventId);
  return 'failed';
}

/**
 * Delivers due webhook attempts. Failures never escape: the dispatcher is a
 * background maintenance loop and REST recovery remains authoritative.
 */
export async function dispatchPendingWebhooks(now = new Date(), limit?: number) {
  const batchSize = limit ?? config.integrations.webhook.batchSize;

  // A crashed worker can leave a delivery claimed in PROCESSING forever. Those
  // rows are never due again, so recover them before selecting the next batch.
  const staleBefore = new Date(
    now.getTime() - Math.max(60_000, config.integrations.webhook.timeoutMs * 2),
  );
  await IntegrationWebhookDelivery.update(
    {
      status: 'FAILED',
      nextAttemptAt: now,
      error: 'Previous delivery attempt was interrupted',
    },
    {
      where: {
        status: 'PROCESSING',
        lastAttemptAt: { [Op.lt]: staleBefore },
      },
    },
  );

  const due = await IntegrationWebhookDelivery.findAll({
    where: {
      status: { [Op.in]: ['PENDING', 'FAILED'] },
      nextAttemptAt: { [Op.lte]: now },
    },
    attributes: ['id'],
    order: [
      ['nextAttemptAt', 'ASC'],
      ['id', 'ASC'],
    ],
    limit: batchSize,
  });

  const result = { attempted: due.length, delivered: 0, failed: 0, dead: 0, skipped: 0 };
  for (const delivery of due) {
    try {
      const outcome = await deliverOne(delivery.id);
      if (outcome === 'delivered') result.delivered += 1;
      else if (outcome === 'failed') result.failed += 1;
      else if (outcome === 'dead') result.dead += 1;
      else result.skipped += 1;
    } catch (error) {
      logger.error({ err: error, deliveryId: delivery.id }, 'webhook delivery attempt crashed');
      result.failed += 1;
    }
  }
  return result;
}

export async function listWebhookSubscriptions(options: {
  organizationId: string;
  connectionId: string;
}) {
  const subscriptions = await IntegrationWebhookSubscription.findAll({
    where: { organizationId: options.organizationId, connectionId: options.connectionId },
    order: [
      ['createdAt', 'ASC'],
      ['id', 'ASC'],
    ],
  });
  return subscriptions.map((subscription) => toSubscriptionView(subscription));
}

export async function createWebhookSubscription(options: {
  organizationId: string;
  connectionId: string;
  input: CreateWebhookSubscriptionInput;
  actorUserId: string | null;
  context?: AuditContext;
}) {
  const { organizationId, connectionId, input, actorUserId, context } = options;
  assertIntegrationWebhookUrl(input.url);

  const secret = generateWebhookSecret();

  try {
    const subscription = await IntegrationWebhookSubscription.create({
      connectionId,
      organizationId,
      url: input.url,
      description: input.description ?? null,
      eventTypes: input.eventTypes,
      status: 'ACTIVE',
      secretCiphertext: encryptIntegrationValue(secret),
      secretVersion: 1,
      createdByUserId: actorUserId,
    });

    await recordAuditEvent(
      {
        organizationId,
        actorUserId,
        action: 'INTEGRATION_WEBHOOK_CREATED',
        entityType: 'INTEGRATION_WEBHOOK_SUBSCRIPTION',
        entityId: subscription.id,
        metadata: { connectionId, url: subscription.url, eventTypes: subscription.eventTypes },
      },
      { context },
    );

    return { subscription: toSubscriptionView(subscription), secret };
  } catch (error) {
    if (error instanceof UniqueConstraintError) {
      throw AppError.conflict(
        'A webhook with this URL already exists for this connection',
        'WEBHOOK_URL_ALREADY_REGISTERED',
      );
    }
    throw error;
  }
}

export async function updateWebhookSubscription(options: {
  organizationId: string;
  connectionId: string;
  subscriptionId: string;
  input: UpdateWebhookSubscriptionInput;
  actorUserId: string | null;
  context?: AuditContext;
}) {
  const { organizationId, connectionId, subscriptionId, input, actorUserId, context } = options;
  const subscription = await IntegrationWebhookSubscription.findOne({
    where: { id: subscriptionId, organizationId, connectionId },
  });
  if (!subscription) {
    throw AppError.notFound('Webhook subscription not found', 'WEBHOOK_NOT_FOUND');
  }

  if (input.url && input.url !== subscription.url) {
    assertIntegrationWebhookUrl(input.url);
  }

  try {
    await subscription.update({
      ...(input.url !== undefined ? { url: input.url } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.eventTypes !== undefined ? { eventTypes: input.eventTypes } : {}),
      ...(input.status !== undefined
        ? {
            status: input.status,
            disabledAt: input.status === 'DISABLED' ? new Date() : null,
          }
        : {}),
    });
  } catch (error) {
    if (error instanceof UniqueConstraintError) {
      throw AppError.conflict(
        'A webhook with this URL already exists for this connection',
        'WEBHOOK_URL_ALREADY_REGISTERED',
      );
    }
    throw error;
  }

  await recordAuditEvent(
    {
      organizationId,
      actorUserId,
      action:
        input.status === 'DISABLED'
          ? 'INTEGRATION_WEBHOOK_DISABLED'
          : 'INTEGRATION_WEBHOOK_UPDATED',
      entityType: 'INTEGRATION_WEBHOOK_SUBSCRIPTION',
      entityId: subscription.id,
      metadata: { connectionId, url: subscription.url, status: subscription.status },
    },
    { context },
  );

  return toSubscriptionView(subscription);
}

export async function rotateWebhookSecret(options: {
  organizationId: string;
  connectionId: string;
  subscriptionId: string;
  actorUserId: string | null;
  context?: AuditContext;
}) {
  const { organizationId, connectionId, subscriptionId, actorUserId, context } = options;
  const subscription = await IntegrationWebhookSubscription.findOne({
    where: { id: subscriptionId, organizationId, connectionId },
  });
  if (!subscription) {
    throw AppError.notFound('Webhook subscription not found', 'WEBHOOK_NOT_FOUND');
  }

  const secret = generateWebhookSecret();
  const now = new Date();

  await subscription.update({
    previousSecretCiphertext: subscription.secretCiphertext,
    previousSecretExpiresAt: new Date(
      now.getTime() + config.integrations.webhook.secretGraceSeconds * 1000,
    ),
    secretCiphertext: encryptIntegrationValue(secret),
    secretVersion: subscription.secretVersion + 1,
  });

  await recordAuditEvent(
    {
      organizationId,
      actorUserId,
      action: 'INTEGRATION_WEBHOOK_SECRET_ROTATED',
      entityType: 'INTEGRATION_WEBHOOK_SUBSCRIPTION',
      entityId: subscription.id,
      metadata: { connectionId, secretVersion: subscription.secretVersion },
    },
    { context },
  );

  return { subscription: toSubscriptionView(subscription), secret };
}

export async function deleteWebhookSubscription(options: {
  organizationId: string;
  connectionId: string;
  subscriptionId: string;
  actorUserId: string | null;
  context?: AuditContext;
}) {
  const { organizationId, connectionId, subscriptionId, actorUserId, context } = options;
  const subscription = await IntegrationWebhookSubscription.findOne({
    where: { id: subscriptionId, organizationId, connectionId },
  });
  if (!subscription) {
    throw AppError.notFound('Webhook subscription not found', 'WEBHOOK_NOT_FOUND');
  }

  await subscription.update({ status: 'DISABLED', disabledAt: new Date() });

  await recordAuditEvent(
    {
      organizationId,
      actorUserId,
      action: 'INTEGRATION_WEBHOOK_DISABLED',
      entityType: 'INTEGRATION_WEBHOOK_SUBSCRIPTION',
      entityId: subscription.id,
      metadata: { connectionId, url: subscription.url },
    },
    { context },
  );

  return toSubscriptionView(subscription);
}

export async function listWebhookDeliveries(options: {
  organizationId: string;
  connectionId: string;
  page: number;
  limit: number;
  status?: string;
}) {
  const subscriptionIds = await IntegrationWebhookSubscription.findAll({
    where: { organizationId: options.organizationId, connectionId: options.connectionId },
    attributes: ['id'],
  });

  if (subscriptionIds.length === 0) {
    return paginate([], 0, options.page, options.limit);
  }

  const where: Record<string, unknown> = {
    organizationId: options.organizationId,
    subscriptionId: { [Op.in]: subscriptionIds.map((row) => row.id) },
  };
  if (options.status) where.status = options.status;

  const result = await IntegrationWebhookDelivery.findAndCountAll({
    where,
    include: [
      {
        model: IntegrationWebhookEvent,
        as: 'event',
        required: true,
        attributes: ['eventId', 'eventType', 'sequence', 'occurredAt', 'status'],
      },
      {
        model: IntegrationWebhookSubscription,
        as: 'subscription',
        required: true,
        attributes: ['id', 'url', 'status'],
      },
    ],
    order: [
      ['createdAt', 'DESC'],
      ['id', 'ASC'],
    ],
    limit: options.limit,
    offset: (options.page - 1) * options.limit,
    distinct: true,
  });

  return {
    ...paginate(
      result.rows.map((delivery) => ({
        id: delivery.id,
        eventId: delivery.event?.eventId ?? null,
        eventType: delivery.event?.eventType ?? null,
        sequence: delivery.event?.sequence ?? null,
        occurredAt: delivery.event?.occurredAt ?? null,
        subscriptionId: delivery.subscriptionId,
        url: delivery.subscription?.url ?? null,
        status: delivery.status,
        attemptCount: delivery.attemptCount,
        nextAttemptAt: delivery.nextAttemptAt,
        lastAttemptAt: delivery.lastAttemptAt,
        responseStatus: delivery.responseStatus,
        error: delivery.error,
        deliveredAt: delivery.deliveredAt,
        createdAt: delivery.createdAt,
      })),
      result.count,
      options.page,
      options.limit,
    ),
  };
}

export async function retryWebhookDelivery(options: {
  organizationId: string;
  connectionId: string;
  deliveryId: string;
  actorUserId: string | null;
  context?: AuditContext;
}) {
  const { organizationId, connectionId, deliveryId, actorUserId, context } = options;

  const subscriptionIds = await IntegrationWebhookSubscription.findAll({
    where: { organizationId, connectionId },
    attributes: ['id'],
  });
  if (subscriptionIds.length === 0) {
    throw AppError.notFound('Webhook delivery not found', 'WEBHOOK_DELIVERY_NOT_FOUND');
  }

  const delivery = await IntegrationWebhookDelivery.findOne({
    where: {
      id: deliveryId,
      organizationId,
      subscriptionId: { [Op.in]: subscriptionIds.map((row) => row.id) },
    },
  });
  if (!delivery) {
    throw AppError.notFound('Webhook delivery not found', 'WEBHOOK_DELIVERY_NOT_FOUND');
  }
  if (delivery.status === 'DELIVERED') {
    throw AppError.conflict(
      'This delivery already succeeded and cannot be retried',
      'WEBHOOK_DELIVERY_ALREADY_DELIVERED',
    );
  }

  await delivery.update({
    status: 'PENDING',
    attemptCount: 0,
    nextAttemptAt: new Date(),
    responseStatus: null,
    error: null,
    deliveredAt: null,
  });
  await IntegrationWebhookEvent.update(
    { status: 'PENDING', processedAt: null },
    { where: { id: delivery.eventId } },
  );

  await recordAuditEvent(
    {
      organizationId,
      actorUserId,
      action: 'INTEGRATION_WEBHOOK_DELIVERY_RETRIED',
      entityType: 'INTEGRATION_WEBHOOK_DELIVERY',
      entityId: delivery.id,
      metadata: { connectionId },
    },
    { context },
  );

  return { retried: true };
}
