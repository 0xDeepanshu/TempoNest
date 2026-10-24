import { Router } from 'express';
import { createAuthRouter } from '../modules/auth/auth.routes';
import { createOrganizationRouter } from '../modules/organizations/organization.routes';
import { createPublicInvitationRouter } from '../modules/invitations/invitation.routes';
import { createHealthRouter } from '../modules/health/health.routes';
import { createDesktopAgentPublicRouter } from '../modules/desktopAgents/desktopAgent.routes';
import {
  createAdminScreenshotRouter,
  createAgentScreenshotRouter,
  createScreenshotFileRouter,
  createScreenshotPolicyRouter,
} from '../modules/screenshots/screenshot.routes';

export function createApiRouter(): Router {
  const router = Router();

  router.use('/health', createHealthRouter());
  router.use('/auth', createAuthRouter());
  router.use('/organizations', createOrganizationRouter());
  router.use('/invitations', createPublicInvitationRouter());
  router.use('/desktop-agents', createDesktopAgentPublicRouter());
  router.use('/admin', createAdminScreenshotRouter());
  router.use('/agent', createAgentScreenshotRouter());
  router.use('/screenshot-policy', createScreenshotPolicyRouter());
  router.use('/screenshot-files', createScreenshotFileRouter());

  return router;
}
