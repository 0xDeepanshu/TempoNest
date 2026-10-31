import { Router } from 'express';
import { requireAuth } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { requirePermission } from '../memberships/permissions';
import { loadOrganizationContext } from '../memberships/organizationContext';
import {
  createOrganizationSchema,
  organizationIdParamsSchema,
  updateOrganizationSchema,
} from './organization.schemas';
import { create, getById, getCurrent, list, updateById, updateCurrent } from './organization.controller';
import { resolveCurrentOrganization } from './currentOrganization';
import { createOrganizationMembersRouter } from './organization.routes.members';
import { createOrganizationDesktopAgentsRouter } from '../desktopAgents/desktopAgent.routes';
import { createOrganizationTimeTrackingRouter } from '../timeTracking/timeSession.routes';
import { createOrganizationActivityRouter } from '../activity/activity.routes';
import { createOrganizationReportingRouter } from '../reporting/reporting.routes';
import { createOrganizationAttendanceRouter } from '../attendance/attendance.routes';
import { createOrganizationLeaveRouter } from '../leave/leave.routes';
import { createOrganizationHolidayRouter } from '../leave/holiday.routes';
import { createOrganizationRolesRouter } from '../roles/customRole.routes';

/**
 * Organization and nested membership/invitation routes. Every nested route
 * loads the caller's membership and checks permissions server-side.
 */
export function createOrganizationRouter(): Router {
  const router = Router();
  const members = createOrganizationMembersRouter();

  router.post('/', requireAuth, validate({ body: createOrganizationSchema }), create);
  router.get('/', requireAuth, list);

  // "Current organization" aliases selected via X-Organization-Id.
  router.get(
    '/current',
    requireAuth,
    resolveCurrentOrganization,
    requirePermission('organization:read'),
    getCurrent,
  );
  router.patch(
    '/current',
    requireAuth,
    resolveCurrentOrganization,
    requirePermission('organization:update'),
    validate({ body: updateOrganizationSchema }),
    updateCurrent,
  );

  router.get(
    '/:organizationId',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('organization:read'),
    getById,
  );

  router.patch(
    '/:organizationId',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('organization:update'),
    validate({ body: updateOrganizationSchema }),
    updateById,
  );

  router.use(members);
  router.use(createOrganizationDesktopAgentsRouter());
  router.use(createOrganizationTimeTrackingRouter());
  router.use(createOrganizationActivityRouter());
  router.use(createOrganizationReportingRouter());
  router.use(createOrganizationAttendanceRouter());
  router.use(createOrganizationLeaveRouter());
  router.use(createOrganizationHolidayRouter());
  router.use(createOrganizationRolesRouter());

  return router;
}
