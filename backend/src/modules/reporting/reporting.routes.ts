import { Router } from 'express';
import { requireAuth } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { requirePermission } from '../memberships/permissions';
import { loadOrganizationContext } from '../memberships/organizationContext';
import { organizationIdParamsSchema } from '../organizations/organization.schemas';
import {
  applicationTimelineQuerySchema,
  applicationUsageQuerySchema,
  dailyReportQuerySchema,
  sessionReportQuerySchema,
  trackingStatusQuerySchema,
} from './reporting.schemas';
import {
  applicationTimeline,
  applicationUsage,
  daily,
  sessions,
  trackingStatus,
} from './reporting.controller';

/**
 * Reporting dates are organization-local calendar dates (YYYY-MM-DD), while
 * stored timestamps remain UTC. Application reports carry a productivity
 * disclaimer and never imply screenshots were captured.
 */
export function createOrganizationReportingRouter(): Router {
  const router = Router({ mergeParams: true });

  router.get(
    '/:organizationId/reports/tracking-status',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('report:read'),
    validate({ query: trackingStatusQuerySchema }),
    trackingStatus,
  );

  router.get(
    '/:organizationId/reports/sessions',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('report:read'),
    validate({ query: sessionReportQuerySchema }),
    sessions,
  );

  router.get(
    '/:organizationId/reports/daily',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('report:read'),
    validate({ query: dailyReportQuerySchema }),
    daily,
  );

  router.get(
    '/:organizationId/reports/application-usage',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('report:read'),
    validate({ query: applicationUsageQuerySchema }),
    applicationUsage,
  );

  router.get(
    '/:organizationId/reports/application-timeline',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('report:read'),
    validate({ query: applicationTimelineQuerySchema }),
    applicationTimeline,
  );

  return router;
}
