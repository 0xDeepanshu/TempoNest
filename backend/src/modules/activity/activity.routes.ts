import { Router } from 'express';
import { config } from '../../config/env';
import { requireAuth } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { createApiRateLimiter } from '../../middleware/rateLimit';
import { requirePermission } from '../memberships/permissions';
import { loadOrganizationContext } from '../memberships/organizationContext';
import { requireDesktopAgent } from '../desktopAgents/desktopAgent.service';
import { organizationIdParamsSchema } from '../organizations/organization.schemas';
import { activityBatchSchema } from './activity.schemas';
import { idleIntervalBatchSchema } from './idleInterval.schemas';
import { updateTrackingSettingsSchema } from './trackingSettings.schemas';
import {
  classificationIdParamsSchema,
  classificationListQuerySchema,
  createClassificationSchema,
  updateClassificationSchema,
} from './applicationClassification.schemas';
import { getSettings, updateSettings } from './trackingSettings.controller';
import { ingest, ingestIdle } from './activity.controller';
import {
  create as createClassification,
  list as listClassifications,
  update as updateClassification,
} from './applicationClassification.controller';

/**
 * Foreground-application and idle metadata. These endpoints never request,
 * receive, or store screenshots, window titles, keystrokes, clipboard data,
 * browser history, or pointer content.
 */
export function createOrganizationActivityRouter(): Router {
  const router = Router({ mergeParams: true });
  const ingestLimiter = createApiRateLimiter({ windowMs: 60_000, max: 120 });
  const ingestRateLimit = config.rateLimit.enabled ? [ingestLimiter] : [];

  router.post(
    '/:organizationId/application-activities/batch',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('time:write'),
    requireDesktopAgent,
    ...ingestRateLimit,
    validate({ body: activityBatchSchema }),
    ingest,
  );

  router.post(
    '/:organizationId/activity/idle-intervals/batch',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('time:write'),
    requireDesktopAgent,
    ...ingestRateLimit,
    validate({ body: idleIntervalBatchSchema }),
    ingestIdle,
  );

  router.get(
    '/:organizationId/activity/settings',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('time:read'),
    getSettings,
  );

  router.patch(
    '/:organizationId/activity/settings',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('activity:policy'),
    validate({ body: updateTrackingSettingsSchema }),
    updateSettings,
  );

  router.get(
    '/:organizationId/application-classifications',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('report:read'),
    validate({ query: classificationListQuerySchema }),
    listClassifications,
  );

  router.post(
    '/:organizationId/application-classifications',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('classification:manage'),
    validate({ body: createClassificationSchema }),
    createClassification,
  );

  router.patch(
    '/:organizationId/application-classifications/:classificationId',
    requireAuth,
    validate({ params: classificationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('classification:manage'),
    validate({ body: updateClassificationSchema }),
    updateClassification,
  );

  return router;
}
