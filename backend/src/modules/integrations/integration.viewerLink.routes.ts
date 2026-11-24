import { Router } from 'express';
import { config } from '../../config/env';
import { createApiRateLimiter } from '../../middleware/rateLimit';
import {
  viewerLinkApprovePage,
  viewerLinkApproveScript,
  viewerLinkDecision,
  viewerLinkLogin,
  viewerLinkOpen,
} from './integration.viewerLink.controller';

/**
 * Hosted approval pages for linking a partner user to a WorkZen owner. Public by design, like the
 * OAuth authorize pages: the one-time nonce, the browser binding cookie, the WorkZen sign-in and the
 * session CSRF token are what protect them.
 */
export function createViewerLinkHostedRouter(): Router {
  const router = Router();
  const limiter = config.rateLimit.enabled
    ? [createApiRateLimiter({ windowMs: 15 * 60_000, max: Math.max(10, config.integrations.rateLimitMax) })]
    : [];

  router.get('/approve', ...limiter, viewerLinkApprovePage);
  router.get('/approve.js', viewerLinkApproveScript);
  router.post('/open', ...limiter, viewerLinkOpen);
  router.post('/login', ...limiter, viewerLinkLogin);
  router.post('/decision', ...limiter, viewerLinkDecision);

  return router;
}
