import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { config } from '../../config/env';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/authenticate';
import {
  forgotPassword,
  login,
  logout,
  me,
  refresh,
  register,
  resetPasswordController,
  revokeOtherSessionsController,
  revokeSession,
  listSessions,
} from './auth.controller';
import {
  forgotPasswordSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  sessionIdParamsSchema,
} from './auth.schemas';

/**
 * Login limiter: counts failed attempts per IP. Successful requests are
 * skipped so normal usage does not consume the budget.
 */
export function createLoginRateLimiter(options?: { windowMs?: number; max?: number }) {
  return rateLimit({
    windowMs: options?.windowMs ?? config.rateLimit.windowMs,
    limit: options?.max ?? config.rateLimit.loginMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    handler: (req, res) => {
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many login attempts. Please try again later.',
        },
        requestId: req.requestId,
      });
    },
  });
}

/**
 * Password reset endpoints count every request (successful or not), because a
 * successful call still sends an e-mail and must not become an abuse vector.
 */
export function createPasswordResetRateLimiter(options?: { windowMs?: number; max?: number }) {
  return rateLimit({
    windowMs: options?.windowMs ?? config.rateLimit.windowMs,
    limit: options?.max ?? config.rateLimit.loginMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many attempts. Please try again later.',
        },
        requestId: req.requestId,
      });
    },
  });
}

export function createAuthRouter(): Router {
  const router = Router();
  const loginLimiter = config.rateLimit.enabled ? createLoginRateLimiter() : null;
  const resetLimiter = config.rateLimit.enabled ? createPasswordResetRateLimiter() : null;

  router.post('/register', validate({ body: registerSchema }), register);

  router.post(
    '/login',
    ...(loginLimiter ? [loginLimiter] : []),
    validate({ body: loginSchema }),
    login,
  );

  router.post(
    '/forgot-password',
    ...(resetLimiter ? [resetLimiter] : []),
    validate({ body: forgotPasswordSchema }),
    forgotPassword,
  );

  router.post(
    '/reset-password',
    ...(resetLimiter ? [resetLimiter] : []),
    validate({ body: resetPasswordSchema }),
    resetPasswordController,
  );

  router.post('/refresh', validate({ body: refreshSchema }), refresh);
  router.post('/logout', validate({ body: logoutSchema }), logout);

  router.get('/me', requireAuth, me);
  router.get('/sessions', requireAuth, listSessions);

  router.delete(
    '/sessions/:sessionId',
    requireAuth,
    validate({ params: sessionIdParamsSchema }),
    revokeSession,
  );

  router.post('/sessions/revoke-all', requireAuth, revokeOtherSessionsController);

  return router;
}
