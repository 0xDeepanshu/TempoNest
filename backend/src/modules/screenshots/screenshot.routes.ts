import express, { Router } from 'express';
import { config } from '../../config/env';
import { requireAuth } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { createApiRateLimiter } from '../../middleware/rateLimit';
import { requirePermission } from '../memberships/permissions';
import { resolveCurrentOrganization } from '../organizations/currentOrganization';
import { requireDesktopAgent } from '../desktopAgents/desktopAgent.service';
import {
  agentAcknowledge,
  agentClaim,
  agentComplete,
  agentFail,
  agentPending,
  agentUpload,
  agentUploadAuthorization,
  accessScreenshot,
  acknowledgeMyPolicy,
  cancelRequest,
  createRequest,
  downloadFile,
  getMyPolicy,
  getPolicy,
  getRequest,
  getScreenshot,
  listAuditEvents,
  listEmployeeRequests,
  listRequests,
  listScreenshots,
  updatePolicy,
} from './screenshot.controller';
import {
  employeeIdParamsSchema,
  organizationScreenshotRequestListQuerySchema,
  screenshotAuditQuerySchema,
  screenshotClaimSchema,
  screenshotCompleteSchema,
  screenshotFailSchema,
  screenshotFileTokenParamsSchema,
  screenshotIdParamsSchema,
  screenshotListQuerySchema,
  screenshotPolicyUpdateSchema,
  screenshotRequestIdParamsSchema,
  screenshotRequestListQuerySchema,
  screenshotUploadAuthorizationSchema,
  screenshotUploadTokenParamsSchema,
} from './screenshot.schemas';

export function createAdminScreenshotRouter(): Router {
  const router = Router();
  const requestLimiter = createApiRateLimiter({ windowMs: 60_000, max: 30 });

  router.post(
    '/employees/:employeeId/screenshot-requests',
    requireAuth,
    resolveCurrentOrganization,
    requirePermission('screenshot:request'),
    validate({ params: employeeIdParamsSchema }),
    ...(config.rateLimit.enabled ? [requestLimiter] : []),
    createRequest,
  );

  router.get(
    '/employees/:employeeId/screenshot-requests',
    requireAuth,
    resolveCurrentOrganization,
    requirePermission('screenshot:read'),
    validate({ params: employeeIdParamsSchema }),
    validate({ query: screenshotRequestListQuerySchema }),
    listEmployeeRequests,
  );

  router.get(
    '/screenshot-requests',
    requireAuth,
    resolveCurrentOrganization,
    requirePermission('screenshot:read'),
    validate({ query: organizationScreenshotRequestListQuerySchema }),
    listRequests,
  );

  router.get(
    '/screenshot-requests/:requestId',
    requireAuth,
    resolveCurrentOrganization,
    requirePermission('screenshot:read'),
    validate({ params: screenshotRequestIdParamsSchema }),
    getRequest,
  );

  router.post(
    '/screenshot-requests/:requestId/cancel',
    requireAuth,
    resolveCurrentOrganization,
    requirePermission('screenshot:manage'),
    validate({ params: screenshotRequestIdParamsSchema }),
    cancelRequest,
  );

  router.get(
    '/screenshot-audit-events',
    requireAuth,
    resolveCurrentOrganization,
    requirePermission('screenshot:read'),
    validate({ query: screenshotAuditQuerySchema }),
    listAuditEvents,
  );

  router.get(
    '/screenshots',
    requireAuth,
    resolveCurrentOrganization,
    requirePermission('screenshot:read'),
    validate({ query: screenshotListQuerySchema }),
    listScreenshots,
  );

  router.get(
    '/screenshots/:screenshotId',
    requireAuth,
    resolveCurrentOrganization,
    requirePermission('screenshot:read'),
    validate({ params: screenshotIdParamsSchema }),
    getScreenshot,
  );

  router.post(
    '/screenshots/:screenshotId/access',
    requireAuth,
    resolveCurrentOrganization,
    requirePermission('screenshot:read'),
    validate({ params: screenshotIdParamsSchema }),
    accessScreenshot,
  );

  router.get(
    '/screenshot-policy',
    requireAuth,
    resolveCurrentOrganization,
    requirePermission('screenshot:policy'),
    getPolicy,
  );

  router.patch(
    '/screenshot-policy',
    requireAuth,
    resolveCurrentOrganization,
    requirePermission('screenshot:policy'),
    validate({ body: screenshotPolicyUpdateSchema }),
    updatePolicy,
  );

  return router;
}

export function createAgentScreenshotRouter(): Router {
  const router = Router();

  router.get(
    '/screenshot-requests/pending',
    requireAuth,
    resolveCurrentOrganization,
    requireDesktopAgent,
    agentPending,
  );

  router.post(
    '/screenshot-requests/:requestId/ack',
    requireAuth,
    resolveCurrentOrganization,
    requireDesktopAgent,
    validate({ params: screenshotRequestIdParamsSchema }),
    agentAcknowledge,
  );

  router.post(
    '/screenshot-requests/:requestId/claim',
    requireAuth,
    resolveCurrentOrganization,
    requireDesktopAgent,
    validate({ params: screenshotRequestIdParamsSchema }),
    validate({ body: screenshotClaimSchema }),
    agentClaim,
  );

  router.post(
    '/screenshot-requests/:requestId/upload-authorization',
    requireAuth,
    resolveCurrentOrganization,
    requireDesktopAgent,
    validate({ params: screenshotRequestIdParamsSchema }),
    validate({ body: screenshotUploadAuthorizationSchema }),
    agentUploadAuthorization,
  );

  router.post(
    '/screenshot-requests/:requestId/complete',
    requireAuth,
    resolveCurrentOrganization,
    requireDesktopAgent,
    validate({ params: screenshotRequestIdParamsSchema }),
    validate({ body: screenshotCompleteSchema }),
    agentComplete,
  );

  router.post(
    '/screenshot-requests/:requestId/fail',
    requireAuth,
    resolveCurrentOrganization,
    requireDesktopAgent,
    validate({ params: screenshotRequestIdParamsSchema }),
    validate({ body: screenshotFailSchema }),
    agentFail,
  );

  router.put(
    '/screenshot-uploads/:token',
    requireAuth,
    resolveCurrentOrganization,
    requireDesktopAgent,
    validate({ params: screenshotUploadTokenParamsSchema }),
    express.raw({
      type: [...config.screenshots.allowedContentTypes],
      limit: config.screenshots.maxBytes,
    }),
    agentUpload,
  );

  return router;
}

export function createScreenshotPolicyRouter(): Router {
  const router = Router();

  router.get('/', requireAuth, resolveCurrentOrganization, getMyPolicy);
  router.post('/acknowledge', requireAuth, resolveCurrentOrganization, acknowledgeMyPolicy);

  return router;
}

export function createScreenshotFileRouter(): Router {
  const router = Router();

  router.get(
    '/:token',
    validate({ params: screenshotFileTokenParamsSchema }),
    downloadFile,
  );

  return router;
}
