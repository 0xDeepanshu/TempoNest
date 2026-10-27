import { Router } from 'express';
import { config } from '../../config/env';
import { requireAuth } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { createApiRateLimiter } from '../../middleware/rateLimit';
import { requirePermission } from '../memberships/permissions';
import { resolveCurrentOrganization } from '../organizations/currentOrganization';
import { createViewerTicket, startLiveSession, stopLiveSession } from './screenLive.controller';
import {
  screenLiveSessionIdParamsSchema,
  screenLiveStopSchema,
  screenLiveTicketSchema,
} from './screenLive.schemas';
import { employeeIdParamsSchema } from './screenshot.schemas';

/**
 * Admin-only live viewing controls. The media itself never travels over these
 * routes; they only create the session and issue short-lived connect tickets.
 */
export function createAdminScreenLiveRouter(): Router {
  const router = Router();
  const ticketLimiter = createApiRateLimiter({ windowMs: 60_000, max: 60 });

  router.post(
    '/employees/:employeeId/screen-live-sessions',
    requireAuth,
    resolveCurrentOrganization,
    requirePermission('screenshot:live'),
    validate({ params: employeeIdParamsSchema }),
    ...(config.rateLimit.enabled ? [ticketLimiter] : []),
    startLiveSession,
  );

  router.post(
    '/screen-live-sessions/:sessionId/viewer-tickets',
    requireAuth,
    resolveCurrentOrganization,
    requirePermission('screenshot:live'),
    validate({ params: screenLiveSessionIdParamsSchema }),
    validate({ body: screenLiveTicketSchema }),
    ...(config.rateLimit.enabled ? [ticketLimiter] : []),
    createViewerTicket,
  );

  router.post(
    '/screen-live-sessions/:sessionId/stop',
    requireAuth,
    resolveCurrentOrganization,
    requirePermission('screenshot:live'),
    validate({ params: screenLiveSessionIdParamsSchema }),
    validate({ body: screenLiveStopSchema }),
    stopLiveSession,
  );

  return router;
}
