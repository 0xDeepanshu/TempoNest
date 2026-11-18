import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  createManualMapping,
  listConnectionMappings,
  resolveMapping,
} from './integration.employee.service';
import { integrationAuditContext } from './integration.http';
import {
  disconnectConnection,
  getConnectionDetail,
  listConnectionSummaries,
  listConnectionWebhooks,
  revokeConnection,
  rotateConnectionWebhookSecrets,
} from './integration.management.service';
import {
  createWebhookSubscription,
  deleteWebhookSubscription,
  listWebhookDeliveries,
  retryWebhookDelivery,
  updateWebhookSubscription,
} from './integration.webhook.service';
import type {
  CreateIntegrationMappingInput,
  CreateWebhookSubscriptionInput,
  ResolveIntegrationMappingInput,
  UpdateWebhookSubscriptionInput,
} from './integration.schemas';

function organizationId(req: Request): string {
  return req.organization!.organization.id;
}

function actorUserId(req: Request): string {
  return req.auth!.user.id;
}

export const listConnections = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as {
    page: number;
    limit: number;
    status?: 'ACTIVE' | 'DISCONNECTED' | 'REVOKED';
  };
  const result = await listConnectionSummaries({
    organizationId: organizationId(req),
    page: query.page,
    limit: query.limit,
    status: query.status,
  });
  res.status(200).json(result);
});

export const getConnection = asyncHandler(async (req: Request, res: Response) => {
  const result = await getConnectionDetail({
    organizationId: organizationId(req),
    connectionId: req.params.connectionId!,
  });
  res.status(200).json({ data: result });
});

export const disconnect = asyncHandler(async (req: Request, res: Response) => {
  const result = await disconnectConnection({
    organizationId: organizationId(req),
    connectionId: req.params.connectionId!,
    actorUserId: actorUserId(req),
    context: integrationAuditContext(req),
  });
  res.status(200).json({ data: result });
});

export const revoke = asyncHandler(async (req: Request, res: Response) => {
  const result = await revokeConnection({
    organizationId: organizationId(req),
    connectionId: req.params.connectionId!,
    actorUserId: actorUserId(req),
    context: integrationAuditContext(req),
  });
  res.status(200).json({ data: result });
});

/** Rotates every active webhook signing secret for this connection. */
export const rotateWebhookSecrets = asyncHandler(async (req: Request, res: Response) => {
  const result = await rotateConnectionWebhookSecrets({
    organizationId: organizationId(req),
    connectionId: req.params.connectionId!,
    actorUserId: actorUserId(req),
    context: integrationAuditContext(req),
  });
  res.status(200).json({ data: result });
});

export const listMappings = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as {
    page: number;
    limit: number;
    status?: string;
    externalEmployeeId?: string;
  };
  const result = await listConnectionMappings({
    organizationId: organizationId(req),
    connectionId: req.params.connectionId!,
    page: query.page,
    limit: query.limit,
    status: query.status,
    externalEmployeeId: query.externalEmployeeId,
  });
  res.status(200).json(result);
});

export const createMapping = asyncHandler(async (req: Request, res: Response) => {
  const result = await createManualMapping({
    organizationId: organizationId(req),
    connectionId: req.params.connectionId!,
    input: req.body as CreateIntegrationMappingInput,
    actorUserId: actorUserId(req),
    context: integrationAuditContext(req),
  });
  res.status(201).json({ data: result });
});

export const resolveConnectionMapping = asyncHandler(async (req: Request, res: Response) => {
  const result = await resolveMapping({
    organizationId: organizationId(req),
    connectionId: req.params.connectionId!,
    mappingId: req.params.mappingId!,
    input: req.body as ResolveIntegrationMappingInput,
    actorUserId: actorUserId(req),
    context: integrationAuditContext(req),
  });
  res.status(200).json({ data: result });
});

export const listWebhooks = asyncHandler(async (req: Request, res: Response) => {
  const result = await listConnectionWebhooks({
    organizationId: organizationId(req),
    connectionId: req.params.connectionId!,
  });
  res.status(200).json({ data: result });
});

export const createWebhook = asyncHandler(async (req: Request, res: Response) => {
  const organization = organizationId(req);
  const result = await createWebhookSubscription({
    organizationId: organization,
    connectionId: req.params.connectionId!,
    input: req.body as CreateWebhookSubscriptionInput,
    actorUserId: actorUserId(req),
    context: integrationAuditContext(req),
  });
  res.status(201).json({ data: result });
});

export const updateWebhook = asyncHandler(async (req: Request, res: Response) => {
  const result = await updateWebhookSubscription({
    organizationId: organizationId(req),
    connectionId: req.params.connectionId!,
    subscriptionId: req.params.subscriptionId!,
    input: req.body as UpdateWebhookSubscriptionInput,
    actorUserId: actorUserId(req),
    context: integrationAuditContext(req),
  });
  res.status(200).json({ data: result });
});

export const deleteWebhook = asyncHandler(async (req: Request, res: Response) => {
  const result = await deleteWebhookSubscription({
    organizationId: organizationId(req),
    connectionId: req.params.connectionId!,
    subscriptionId: req.params.subscriptionId!,
    actorUserId: actorUserId(req),
    context: integrationAuditContext(req),
  });
  res.status(200).json({ data: result });
});

export const listDeliveries = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as {
    page: number;
    limit: number;
    status?: string;
  };
  const result = await listWebhookDeliveries({
    organizationId: organizationId(req),
    connectionId: req.params.connectionId!,
    page: query.page,
    limit: query.limit,
    status: query.status,
  });
  res.status(200).json(result);
});

export const retryDelivery = asyncHandler(async (req: Request, res: Response) => {
  const result = await retryWebhookDelivery({
    organizationId: organizationId(req),
    connectionId: req.params.connectionId!,
    deliveryId: req.params.deliveryId!,
    actorUserId: actorUserId(req),
    context: integrationAuditContext(req),
  });
  res.status(200).json({ data: result });
});
