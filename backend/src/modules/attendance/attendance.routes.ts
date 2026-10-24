import express, { Router } from 'express';
import { config } from '../../config/env';
import { requireAuth } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { requirePermission } from '../memberships/permissions';
import { loadOrganizationContext } from '../memberships/organizationContext';
import { resolveCurrentOrganization } from '../organizations/currentOrganization';
import { organizationIdParamsSchema } from '../organizations/organization.schemas';
import { requireDesktopAgent } from '../desktopAgents/desktopAgent.service';
import { requireMobileAgent } from './attendanceEvidence.service';
import {
  approveAttendanceCorrectionSchema,
  attendanceCheckInSchema,
  attendanceCorrectionIdParamsSchema,
  attendanceCorrectionListQuerySchema,
  attendanceEvidenceFileTokenParamsSchema,
  attendanceEvidenceIdParamsSchema,
  attendanceEvidenceUploadTokenParamsSchema,
  attendanceSummaryQuerySchema,
  createAttendanceCorrectionSchema,
  createAttendanceEvidenceSchema,
  rejectAttendanceCorrectionSchema,
} from './attendance.schemas';
import {
  accessEvidence,
  approveCorrection,
  checkInAttendance,
  createCorrection,
  createEvidence,
  currentCheckIn,
  downloadEvidenceFile,
  getCorrection,
  listCorrections,
  reauthorizeEvidence,
  rejectCorrection,
  summary,
  uploadEvidence,
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

  router.post(
    '/:organizationId/attendance/check-ins',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('time:write'),
    requireDesktopAgent,
    requireMobileAgent,
    validate({ body: attendanceCheckInSchema }),
    checkInAttendance,
  );

  router.get(
    '/:organizationId/attendance/check-ins/current',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('time:read'),
    currentCheckIn,
  );

  router.post(
    '/:organizationId/attendance/evidence',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('time:write'),
    requireDesktopAgent,
    requireMobileAgent,
    validate({ body: createAttendanceEvidenceSchema }),
    createEvidence,
  );

  router.post(
    '/:organizationId/attendance/evidence/:evidenceId/upload-authorization',
    requireAuth,
    validate({ params: attendanceEvidenceIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('time:write'),
    requireDesktopAgent,
    requireMobileAgent,
    reauthorizeEvidence,
  );

  router.post(
    '/:organizationId/attendance/evidence/:evidenceId/access',
    requireAuth,
    validate({ params: attendanceEvidenceIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('time:read'),
    accessEvidence,
  );

  return router;
}

/** Raw attendance photo uploads use the same agent authorization as screenshots. */
export function createAgentAttendanceRouter(): Router {
  const router = Router();

  router.put(
    '/attendance-evidence/:token',
    requireAuth,
    resolveCurrentOrganization,
    requireDesktopAgent,
    requireMobileAgent,
    validate({ params: attendanceEvidenceUploadTokenParamsSchema }),
    express.raw({
      type: [...config.screenshots.allowedContentTypes],
      limit: config.screenshots.maxBytes,
    }),
    uploadEvidence,
  );

  return router;
}

/** Short-lived signed downloads. No authentication headers are required. */
export function createAttendanceFileRouter(): Router {
  const router = Router();

  router.get(
    '/:token',
    validate({ params: attendanceEvidenceFileTokenParamsSchema }),
    downloadEvidenceFile,
  );

  return router;
}
