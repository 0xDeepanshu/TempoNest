import { Router } from 'express';
import { requireAuth } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { requirePermission } from '../memberships/permissions';
import { loadOrganizationContext } from '../memberships/organizationContext';
import { organizationIdParamsSchema } from '../organizations/organization.schemas';
import {
  approveAttendanceCorrectionSchema,
  attendanceCorrectionIdParamsSchema,
  attendanceCorrectionListQuerySchema,
  attendanceSummaryQuerySchema,
  createAttendanceCorrectionSchema,
  rejectAttendanceCorrectionSchema,
} from './attendance.schemas';
import {
  approveCorrection,
  createCorrection,
  getCorrection,
  listCorrections,
  rejectCorrection,
  summary,
} from './attendance.controller';

/**
 * Employee self-service attendance. Summaries and correction history are
 * always forced to the authenticated employee; review routes use the explicit
 * correction:review permission and never allow self-review.
 */
export function createOrganizationAttendanceRouter(): Router {
  const router = Router({ mergeParams: true });

  router.get(
    '/:organizationId/attendance/summaries',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('time:read'),
    validate({ query: attendanceSummaryQuerySchema }),
    summary,
  );

  router.get(
    '/:organizationId/attendance/corrections',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('time:read'),
    validate({ query: attendanceCorrectionListQuerySchema }),
    listCorrections,
  );

  router.post(
    '/:organizationId/attendance/corrections',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('time:write'),
    validate({ body: createAttendanceCorrectionSchema }),
    createCorrection,
  );

  router.get(
    '/:organizationId/attendance/corrections/:correctionId',
    requireAuth,
    validate({ params: attendanceCorrectionIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('time:read'),
    getCorrection,
  );

  router.post(
    '/:organizationId/attendance/corrections/:correctionId/approve',
    requireAuth,
    validate({ params: attendanceCorrectionIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('correction:review'),
    validate({ body: approveAttendanceCorrectionSchema }),
    approveCorrection,
  );

  router.post(
    '/:organizationId/attendance/corrections/:correctionId/reject',
    requireAuth,
    validate({ params: attendanceCorrectionIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('correction:review'),
    validate({ body: rejectAttendanceCorrectionSchema }),
    rejectCorrection,
  );

  return router;
}
