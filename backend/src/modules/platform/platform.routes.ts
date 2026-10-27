import { Router } from 'express';
import { config } from '../../config/env';
import { requireAuth } from '../../middleware/authenticate';
import { createSensitiveActionRateLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validate';
import { requirePlatformAdmin } from './platform.middleware';
import {
  deleteOrganization,
  getOrganization,
  listAuditEvents,
  listOrganizations,
  overview,
  reactivateOrganization,
  renameOrganization,
  suspendOrganization,
} from './platform.controller';
import {
  platformAuditListQuerySchema,
  platformDeleteOrganizationSchema,
  platformOrganizationIdParamsSchema,
  platformOrganizationListQuerySchema,
  platformRenameOrganizationSchema,
} from './platform.schemas';

/**
 * Platform administration. Every route requires both a valid user session and
 * the SUPERADMIN platform role loaded from the database; organization ownership
 * never satisfies this check.
 */
export function createPlatformRouter(): Router {
  const router = Router();
  const confirmationLimiter = config.rateLimit.enabled
    ? createSensitiveActionRateLimiter()
    : null;

  router.use(requireAuth, requirePlatformAdmin);

  router.get('/overview', overview);

  router.get(
    '/organizations',
    validate({ query: platformOrganizationListQuerySchema }),
    listOrganizations,
  );

  router.get(
    '/organizations/:organizationId',
    validate({ params: platformOrganizationIdParamsSchema }),
    getOrganization,
  );

  router.patch(
    '/organizations/:organizationId',
    validate({ params: platformOrganizationIdParamsSchema, body: platformRenameOrganizationSchema }),
    renameOrganization,
  );

  router.post(
    '/organizations/:organizationId/suspend',
    validate({ params: platformOrganizationIdParamsSchema }),
    suspendOrganization,
  );

  router.post(
    '/organizations/:organizationId/reactivate',
    validate({ params: platformOrganizationIdParamsSchema }),
    reactivateOrganization,
  );

  router.delete(
    '/organizations/:organizationId',
    validate({
      params: platformOrganizationIdParamsSchema,
      body: platformDeleteOrganizationSchema,
    }),
    ...(confirmationLimiter ? [confirmationLimiter] : []),
    deleteOrganization,
  );

  router.get(
    '/audit-events',
    validate({ query: platformAuditListQuerySchema }),
    listAuditEvents,
  );

  return router;
}
