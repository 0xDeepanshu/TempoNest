import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { config } from '../../config/env';
import { authorize, authorizeDecision, authorizeLogin, revoke, token } from './integration.oauth.controller';

/**
 * Public OAuth-style endpoints for the hosted Flowtrium connection flow.
 *
 * These routes are intentionally not behind `requireAuth`: the authorize entry
 * point must render the hosted sign-in page for anonymous visitors, and the
 * token/revoke endpoints are authenticated by the confidential client secret
 * (plus PKCE for the authorization-code exchange), not by a WorkZen session.
 */
function createOAuthRateLimiter() {
  return rateLimit({
    windowMs: 15 * 60_000,
    limit: Math.max(10, config.integrations.rateLimitMax),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many integration requests. Please try again later.',
        },
        requestId: req.requestId,
      });
    },
  });
}

export function createIntegrationOAuthRouter(): Router {
  const router = Router();
  const limiter = config.rateLimit.enabled ? createOAuthRateLimiter() : null;

  router.get('/authorize', authorize);
  router.post('/authorize/login', ...(limiter ? [limiter] : []), authorizeLogin);
  router.post('/authorize/decision', ...(limiter ? [limiter] : []), authorizeDecision);
  router.post('/token', ...(limiter ? [limiter] : []), token);
  router.post('/revoke', ...(limiter ? [limiter] : []), revoke);

  return router;
}
