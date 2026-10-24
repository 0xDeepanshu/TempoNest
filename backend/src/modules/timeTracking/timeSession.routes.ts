import { Router } from 'express';
import { requireAuth } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { requirePermission } from '../memberships/permissions';
import { loadOrganizationContext } from '../memberships/organizationContext';
import { requireDesktopAgent } from '../desktopAgents/desktopAgent.service';
import { organizationIdParamsSchema } from '../organizations/organization.schemas';
import {
  offlineSyncSchema,
  sessionIdParamsSchema,
  sessionListQuerySchema,
} from './timeSession.schemas';
import {
  breakEnd,
  breakStart,
  current,
  detail,
  heartbeatController,
  list,
  start,
  stop,
  sync,
} from './timeSession.controller';

/**
 * Time tracking state lives on the server. Online timestamps are generated
 * here; offline events are accepted through the explicit /sync protocol.
 */
export function createOrganizationTimeTrackingRouter(): Router {
  const router = Router({ mergeParams: true });

  router.post(
    '/:organizationId/time-sessions/start',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('time:write'),
    requireDesktopAgent,
    start,
  );

  router.get(
    '/:organizationId/time-sessions/current',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('time:read'),
    current,
  );

  router.post(
    '/:organizationId/time-sessions/sync',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('time:write'),
    requireDesktopAgent,
    validate({ body: offlineSyncSchema }),
    sync,
  );

  router.get(
    '/:organizationId/time-sessions',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('time:read'),
    validate({ query: sessionListQuerySchema }),
    list,
  );

  router.get(
    '/:organizationId/time-sessions/:sessionId',
    requireAuth,
    validate({ params: sessionIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('time:read'),
    detail,
  );

  router.post(
    '/:organizationId/time-sessions/:sessionId/stop',
    requireAuth,
    validate({ params: sessionIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('time:write'),
    requireDesktopAgent,
    stop,
  );

  router.post(
    '/:organizationId/time-sessions/:sessionId/breaks',
    requireAuth,
    validate({ params: sessionIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('time:write'),
    requireDesktopAgent,
    breakStart,
  );

  router.post(
    '/:organizationId/time-sessions/:sessionId/breaks/end',
    requireAuth,
    validate({ params: sessionIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('time:write'),
    requireDesktopAgent,
    breakEnd,
  );

  router.post(
    '/:organizationId/time-sessions/:sessionId/heartbeat',
    requireAuth,
    validate({ params: sessionIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('time:write'),
    requireDesktopAgent,
    heartbeatController,
  );

  return router;
}
