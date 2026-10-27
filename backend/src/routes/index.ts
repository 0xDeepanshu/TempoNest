import { Router } from 'express';
import { createAuthRouter } from '../modules/auth/auth.routes';
import { createOrganizationRouter } from '../modules/organizations/organization.routes';
import { createPublicInvitationRouter } from '../modules/invitations/invitation.routes';
import { createHealthRouter } from '../modules/health/health.routes';
import { createPlatformRouter } from '../modules/platform/platform.routes';
import { createDesktopAgentPublicRouter } from '../modules/desktopAgents/desktopAgent.routes';
import {
  createAdminScreenshotRouter,
  createAgentScreenshotRouter,
  createScreenshotFileRouter,
  createScreenshotPolicyRouter,
} from '../modules/screenshots/screenshot.routes';
import { createAdminScreenLiveRouter } from '../modules/screenshots/screenLive.routes';
import {
  createAgentAttendanceRouter,
  createAttendanceFileRouter,
} from '../modules/attendance/attendance.routes';

export function createApiRouter(): Router {
  const router = Router();

  router.use('/health', createHealthRouter());
  router.use('/auth', createAuthRouter());
  router.use('/platform', createPlatformRouter());
  router.use('/organizations', createOrganizationRouter());
  router.use('/invitations', createPublicInvitationRouter());
  router.use('/desktop-agents', createDesktopAgentPublicRouter());
  router.use('/admin', createAdminScreenshotRouter());
  router.use('/admin', createAdminScreenLiveRouter());
  router.use('/agent', createAgentScreenshotRouter());
  router.use('/agent', createAgentAttendanceRouter());
  router.use('/screenshot-policy', createScreenshotPolicyRouter());
  router.use('/screenshot-files', createScreenshotFileRouter());
  router.use('/attendance-files', createAttendanceFileRouter());

  return router;
}
