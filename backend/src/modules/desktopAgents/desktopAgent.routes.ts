import { Router } from 'express';
import { requireAuth } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { createApiRateLimiter } from '../../middleware/rateLimit';
import { requirePermission } from '../memberships/permissions';
import { loadOrganizationContext } from '../memberships/organizationContext';
import { organizationIdParamsSchema } from '../organizations/organization.schemas';
import {
  agentIdParamsSchema,
  agentListQuerySchema,
  authenticateAgentSchema,
  registerAgentSchema,
} from './desktopAgent.schemas';
import { authenticate, list, register, revoke } from './desktopAgent.controller';

/**
 * Public device credential check plus organization-scoped device management.
 * Registration still requires a signed-in user and active membership.
 */
export function createDesktopAgentPublicRouter(): Router {
  const router = Router();
  const limiter = createApiRateLimiter({ windowMs: 15 * 60_000, max: 30 });

  router.post('/authenticate', limiter, validate({ body: authenticateAgentSchema }), authenticate);

  return router;
}

export function createOrganizationDesktopAgentsRouter(): Router {
  const router = Router({ mergeParams: true });

  router.post(
    '/:organizationId/desktop-agents',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    validate({ body: registerAgentSchema }),
    register,
  );

  router.get(
    '/:organizationId/desktop-agents',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('agent:read'),
    validate({ query: agentListQuerySchema }),
    list,
  );

  router.delete(
    '/:organizationId/desktop-agents/:agentId',
    requireAuth,
    validate({ params: agentIdParamsSchema }),
    loadOrganizationContext,
    revoke,
  );

  return router;
}
