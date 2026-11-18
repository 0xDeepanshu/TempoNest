import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../utils/errors';
import { integrationAuditContext } from './integration.http';
import {
  createWebhookSubscription,
  deleteWebhookSubscription,
  listWebhookDeliveries,
  listWebhookSubscriptions,
  retryWebhookDelivery,
  rotateWebhookSecret,
  updateWebhookSubscription,
} from './integration.webhook.service';
import type {
  CreateWebhookSubscriptionInput,
  UpdateWebhookSubscriptionInput,
} from './integration.schemas';

function connection(req: Request) {
  const context = req.integration;
  if (!context) {
    throw AppError.unauthorized('Integration authentication is required', 'INTEGRATION_TOKEN_REQUIRED');
  }
  return { organizationId: context.organization.id, connectionId: context.connection.id };
}

/**
 * Webhook management on behalf of the integration itself. These routes require
 * the optional `webhooks:manage` scope and can only ever touch the connection
 * that owns the presented token.
 */
export const listIntegrationWebhooks = asyncHandler(async (req: Request, res: Response) => {
  const result = await listWebhookSubscriptions(connection(req));
  res.status(200).json({ data: result });
});

export const createIntegrationWebhook = asyncHandler(async (req: Request, res: Response) => {
  const result = await createWebhookSubscription({
    ...connection(req),
    input: req.body as CreateWebhookSubscriptionInput,
    actorUserId: null,
    context: integrationAuditContext(req),
  });
  res.status(201).json({ data: result });
});

export const updateIntegrationWebhook = asyncHandler(async (req: Request, res: Response) => {
  const result = await updateWebhookSubscription({
    ...connection(req),
    subscriptionId: req.params.subscriptionId!,
    input: req.body as UpdateWebhookSubscriptionInput,
    actorUserId: null,
    context: integrationAuditContext(req),
  });
  res.status(200).json({ data: result });
});

export const deleteIntegrationWebhook = asyncHandler(async (req: Request, res: Response) => {
  const result = await deleteWebhookSubscription({
    ...connection(req),
    subscriptionId: req.params.subscriptionId!,
    actorUserId: null,
    context: integrationAuditContext(req),
  });
  res.status(200).json({ data: result });
});

export const rotateIntegrationWebhookSecret = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await rotateWebhookSecret({
      ...connection(req),
      subscriptionId: req.params.subscriptionId!,
      actorUserId: null,
      context: integrationAuditContext(req),
    });
    res.status(200).json({ data: result });
  },
);

export const listIntegrationDeliveries = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as { page: number; limit: number; status?: string };
  const result = await listWebhookDeliveries({
    ...connection(req),
    page: query.page,
    limit: query.limit,
    status: query.status,
  });
  res.status(200).json(result);
});

export const retryIntegrationDelivery = asyncHandler(async (req: Request, res: Response) => {
  const result = await retryWebhookDelivery({
    ...connection(req),
    deliveryId: req.params.deliveryId!,
    actorUserId: null,
    context: integrationAuditContext(req),
  });
  res.status(200).json({ data: result });
});
