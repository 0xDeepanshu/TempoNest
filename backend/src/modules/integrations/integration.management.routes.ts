import { Router } from 'express';
import { requireAuth } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { requirePermission } from '../memberships/permissions';
import { loadOrganizationContext } from '../memberships/organizationContext';
import { organizationIdParamsSchema } from '../organizations/organization.schemas';
import {
  createMapping,
  createWebhook,
  deleteWebhook,
  disconnect,
  getConnection,
  listConnections,
  listDeliveries,
  listMappings,
  listWebhooks,
  resolveConnectionMapping,
  retryDelivery,
  revoke,
  rotateWebhookSecrets,
  updateWebhook,
} from './integration.management.controller';
import {
  listViewerLinksHandler,
  revokeViewerLinkByManagerHandler,
} from './integration.viewerLink.controller';
import {
  createIntegrationMappingSchema,
  createWebhookSubscriptionSchema,
  integrationConnectionListQuerySchema,
  integrationConnectionParamsSchema,
  integrationViewerLinkManageParamsSchema,
  integrationMappingListQuerySchema,
  integrationMappingParamsSchema,
  resolveIntegrationMappingSchema,
  updateWebhookSubscriptionSchema,
  webhookDeliveryListQuerySchema,
  webhookDeliveryParamsSchema,
  webhookSubscriptionParamsSchema,
} from './integration.schemas';

/**
 * Organization-scoped integration management for WorkZen owners/admins.
 *
 * All routes are cookie/bearer session authenticated, use the existing
 * organization context and the protected `integration:manage` permission, and
 * never expose integration client secrets or token hashes.
 */
export function createOrganizationIntegrationRouter(): Router {
  const router = Router({ mergeParams: true });

  const organizationGuard = [
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('integration:manage'),
  ];

  const connectionGuard = [
    requireAuth,
    validate({ params: integrationConnectionParamsSchema }),
    loadOrganizationContext,
    requirePermission('integration:manage'),
  ];

  router.get(
    '/:organizationId/integrations/connections',
    ...organizationGuard,
    validate({ query: integrationConnectionListQuerySchema }),
    listConnections,
  );

  router.get(
    '/:organizationId/integrations/connections/:connectionId',
    ...connectionGuard,
    getConnection,
  );

  router.post(
    '/:organizationId/integrations/connections/:connectionId/disconnect',
    ...connectionGuard,
    disconnect,
  );

  router.post(
    '/:organizationId/integrations/connections/:connectionId/revoke',
    ...connectionGuard,
    revoke,
  );

  router.post(
    '/:organizationId/integrations/connections/:connectionId/rotate-webhook-secrets',
    ...connectionGuard,
    rotateWebhookSecrets,
  );

  router.get(
    '/:organizationId/integrations/connections/:connectionId/mappings',
    ...connectionGuard,
    validate({ query: integrationMappingListQuerySchema }),
    listMappings,
  );

  router.post(
    '/:organizationId/integrations/connections/:connectionId/mappings',
    ...connectionGuard,
    validate({ body: createIntegrationMappingSchema }),
    createMapping,
  );

  router.post(
    '/:organizationId/integrations/connections/:connectionId/mappings/:mappingId/resolve',
    requireAuth,
    validate({ params: integrationMappingParamsSchema }),
    loadOrganizationContext,
    requirePermission('integration:manage'),
    validate({ body: resolveIntegrationMappingSchema }),
    resolveConnectionMapping,
  );

  router.get(
    '/:organizationId/integrations/connections/:connectionId/webhooks',
    ...connectionGuard,
    listWebhooks,
  );

  router.post(
    '/:organizationId/integrations/connections/:connectionId/webhooks',
    ...connectionGuard,
    validate({ body: createWebhookSubscriptionSchema }),
    createWebhook,
  );

  router.patch(
    '/:organizationId/integrations/connections/:connectionId/webhooks/:subscriptionId',
    requireAuth,
    validate({ params: webhookSubscriptionParamsSchema }),
    loadOrganizationContext,
    requirePermission('integration:manage'),
    validate({ body: updateWebhookSubscriptionSchema }),
    updateWebhook,
  );

  router.delete(
    '/:organizationId/integrations/connections/:connectionId/webhooks/:subscriptionId',
    requireAuth,
    validate({ params: webhookSubscriptionParamsSchema }),
    loadOrganizationContext,
    requirePermission('integration:manage'),
    deleteWebhook,
  );

  router.get(
    '/:organizationId/integrations/connections/:connectionId/webhook-deliveries',
    ...connectionGuard,
    validate({ query: webhookDeliveryListQuerySchema }),
    listDeliveries,
  );

  router.post(
    '/:organizationId/integrations/connections/:connectionId/webhook-deliveries/:deliveryId/retry',
    requireAuth,
    validate({ params: webhookDeliveryParamsSchema }),
    loadOrganizationContext,
    requirePermission('integration:manage'),
    retryDelivery,
  );

  router.get(
    '/:organizationId/integrations/viewer-links',
    ...organizationGuard,
    listViewerLinksHandler,
  );

  router.post(
    '/:organizationId/integrations/viewer-links/:linkId/revoke',
    requireAuth,
    validate({ params: integrationViewerLinkManageParamsSchema }),
    loadOrganizationContext,
    requirePermission('integration:manage'),
    revokeViewerLinkByManagerHandler,
  );

  return router;
}
