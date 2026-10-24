import { Router } from 'express';
import { requireAuth } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { requirePermission } from '../memberships/permissions';
import { loadOrganizationContext } from '../memberships/organizationContext';
import { requireDesktopAgent } from '../desktopAgents/desktopAgent.service';
import { organizationIdParamsSchema } from '../organizations/organization.schemas';
import { activityBatchSchema } from './activity.schemas';
import { ingest } from './activity.controller';

/**
 * Batch foreground-application metadata. This endpoint never requests,
 * receives, or stores screenshots or window contents.
 */
export function createOrganizationActivityRouter(): Router {
  const router = Router({ mergeParams: true });

  router.post(
    '/:organizationId/application-activities/batch',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('time:write'),
    requireDesktopAgent,
    validate({ body: activityBatchSchema }),
    ingest,
  );

  return router;
}
