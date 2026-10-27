import { rateLimit } from 'express-rate-limit';
import { config } from '../config/env';

/** Broad per-IP limit for the whole API. */
export function createApiRateLimiter(options?: { windowMs?: number; max?: number }) {
  return rateLimit({
    windowMs: options?.windowMs ?? config.rateLimit.windowMs,
    limit: options?.max ?? config.rateLimit.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please try again later.',
        },
        requestId: req.requestId,
      });
    },
  });
}

/**
 * Counts failed step-up confirmations (for example password re-entry before a
 * destructive platform action) without penalizing successful operations.
 */
export function createSensitiveActionRateLimiter(options?: { windowMs?: number; max?: number }) {
  return rateLimit({
    windowMs: options?.windowMs ?? 15 * 60_000,
    limit: options?.max ?? 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    handler: (req, res) => {
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many confirmation attempts. Please try again later.',
        },
        requestId: req.requestId,
      });
    },
  });
}
