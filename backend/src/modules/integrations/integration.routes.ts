import { Router } from 'express';
import { validate } from '../../middleware/validate';
import {
  attendanceSummary,
  employeeStatus,
  idleSummary,
  listEmployees,
  matchIntegrationEmployees,
  sessionHistory,
} from './integration.attendance.controller';
import {
  createIntegrationWebhook,
  deleteIntegrationWebhook,
  listIntegrationDeliveries,
  listIntegrationWebhooks,
  retryIntegrationDelivery,
  rotateIntegrationWebhookSecret,
  updateIntegrationWebhook,
} from './integration.webhook.controller';
import { requireIntegrationAuth } from './integrationAuth.middleware';
import {
  createWebhookSubscriptionSchema,
  integrationEmployeeListQuerySchema,
  integrationEmployeeMatchBatchSchema,
  integrationIdleQuerySchema,
  integrationSessionHistoryQuerySchema,
  integrationStatusQuerySchema,
  integrationSummaryQuerySchema,
  integrationWebhookDeliveryParamsSchema,
  integrationWebhookListQuerySchema,
  integrationWebhookParamsSchema,
  updateWebhookSubscriptionSchema,
  webhookDeliveryListQuerySchema,
} from './integration.schemas';

/**
 * Read-only partner data API.
 *
 * Every route authenticates an integration access token, not a WorkZen session,
 * and enforces the OAuth scopes granted to that connection. Responses are
 * limited to employees the organisation has explicitly mapped.
 */
export function createIntegrationDataRouter(): Router {
  const router = Router();

  router.get(
    '/employees',
    requireIntegrationAuth(['employees:read']),
    validate({ query: integrationEmployeeListQuerySchema }),
    listEmployees,
  );

  router.post(
    '/employees/match',
    requireIntegrationAuth(['employees:read']),
    validate({ body: integrationEmployeeMatchBatchSchema }),
    matchIntegrationEmployees,
  );

  router.get(
    '/attendance/status',
    requireIntegrationAuth(['attendance:read']),
    validate({ query: integrationStatusQuerySchema }),
    employeeStatus,
  );

  router.get(
    '/attendance/sessions',
    requireIntegrationAuth(['attendance:read']),
    validate({ query: integrationSessionHistoryQuerySchema }),
    sessionHistory,
  );

  router.get(
    '/attendance/summary',
    requireIntegrationAuth(['attendance:read']),
    validate({ query: integrationSummaryQuerySchema }),
    attendanceSummary,
  );

  router.get(
    '/attendance/idle',
    requireIntegrationAuth(['attendance:read']),
    validate({ query: integrationIdleQuerySchema }),
    idleSummary,
  );

  // Webhook configuration is optional and gated behind its own scope. It never
  // exposes attendance data or WorkZen management capabilities.
  router.get(
    '/webhooks',
    requireIntegrationAuth(['webhooks:manage']),
    validate({ query: integrationWebhookListQuerySchema }),
    listIntegrationWebhooks,
  );

  router.post(
    '/webhooks',
    requireIntegrationAuth(['webhooks:manage']),
    validate({ body: createWebhookSubscriptionSchema }),
    createIntegrationWebhook,
  );

  router.patch(
    '/webhooks/:subscriptionId',
    requireIntegrationAuth(['webhooks:manage']),
    validate({ params: integrationWebhookParamsSchema }),
    validate({ body: updateWebhookSubscriptionSchema }),
    updateIntegrationWebhook,
  );

  router.delete(
    '/webhooks/:subscriptionId',
    requireIntegrationAuth(['webhooks:manage']),
    validate({ params: integrationWebhookParamsSchema }),
    deleteIntegrationWebhook,
  );

  router.post(
    '/webhooks/:subscriptionId/rotate',
    requireIntegrationAuth(['webhooks:manage']),
    validate({ params: integrationWebhookParamsSchema }),
    rotateIntegrationWebhookSecret,
  );

  router.get(
    '/webhook-deliveries',
    requireIntegrationAuth(['webhooks:manage']),
    validate({ query: webhookDeliveryListQuerySchema }),
    listIntegrationDeliveries,
  );

  router.post(
    '/webhook-deliveries/:deliveryId/retry',
    requireIntegrationAuth(['webhooks:manage']),
    validate({ params: integrationWebhookDeliveryParamsSchema }),
    retryIntegrationDelivery,
  );

  return router;
}
