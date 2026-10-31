import { Router } from 'express';
import { requireAuth } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { requireAnyPermission, requirePermission } from '../memberships/permissions';
import { loadOrganizationContext } from '../memberships/organizationContext';
import { organizationIdParamsSchema } from '../organizations/organization.schemas';
import {
  createHolidaySchema,
  deleteHolidayQuerySchema,
  duplicateHolidaySchema,
  governmentHolidayImportSchema,
  governmentHolidayPreviewQuerySchema,
  holidayIdParamsSchema,
  holidayListQuerySchema,
  holidayPublicationSchema,
  holidaySettingsSchema,
  updateHolidaySchema,
} from './holiday.schemas';
import {
  create,
  duplicate,
  getOne,
  importGovernment,
  list,
  listEmployees,
  previewGovernment,
  readGovernmentJurisdictions,
  readSettings,
  remove,
  update,
  updatePublication,
  writeSettings,
} from './holiday.controller';

/**
 * Organization holiday calendar. Mounted next to the leave router but kept
 * separate so holiday permissions are enforced independently from leave
 * administration.
 */
export function createOrganizationHolidayRouter(): Router {
  const router = Router();

  router.get(
    '/:organizationId/holidays/settings',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('holiday:view'),
    readSettings,
  );

  router.put(
    '/:organizationId/holidays/settings',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('holiday:settings:manage'),
    validate({ body: holidaySettingsSchema }),
    writeSettings,
  );

  router.get(
    '/:organizationId/holidays',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('holiday:view'),
    validate({ query: holidayListQuerySchema }),
    list,
  );

  router.post(
    '/:organizationId/holidays',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('holiday:create'),
    validate({ body: createHolidaySchema }),
    create,
  );

  router.get(
    '/:organizationId/holidays/employees',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    // The member directory is only needed by the holiday editor, not by the
    // employee-facing calendar.
    requireAnyPermission(['holiday:create', 'holiday:update']),
    listEmployees,
  );

  router.get(
    '/:organizationId/holidays/government/jurisdictions',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('holiday:view'),
    readGovernmentJurisdictions,
  );

  router.get(
    '/:organizationId/holidays/government/preview',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('holiday:create'),
    validate({ query: governmentHolidayPreviewQuerySchema }),
    previewGovernment,
  );

  router.post(
    '/:organizationId/holidays/government/import',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('holiday:create'),
    validate({ body: governmentHolidayImportSchema }),
    importGovernment,
  );

  router.post(
    '/:organizationId/holidays/publication',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('holiday:update'),
    validate({ body: holidayPublicationSchema }),
    updatePublication,
  );

  router.get(
    '/:organizationId/holidays/:holidayId',
    requireAuth,
    validate({ params: holidayIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('holiday:view'),
    getOne,
  );

  router.patch(
    '/:organizationId/holidays/:holidayId',
    requireAuth,
    validate({ params: holidayIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('holiday:update'),
    validate({ body: updateHolidaySchema }),
    update,
  );

  router.delete(
    '/:organizationId/holidays/:holidayId',
    requireAuth,
    validate({ params: holidayIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('holiday:delete'),
    validate({ query: deleteHolidayQuerySchema }),
    remove,
  );

  router.post(
    '/:organizationId/holidays/:holidayId/duplicate',
    requireAuth,
    validate({ params: holidayIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('holiday:create'),
    validate({ body: duplicateHolidaySchema }),
    duplicate,
  );

  return router;
}
