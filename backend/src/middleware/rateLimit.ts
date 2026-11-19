import { rateLimit } from 'express-rate-limit';
import { config } from '../config/env';

/**
 * express-rate-limit v7 attaches the limiter state to the request at runtime
 * but does not ship an Express type augmentation, so describe the slice needed.
 */
interface RateLimitedRequest {
  requestId: string;
  rateLimit?: { resetTime?: Date };
}

/** Seconds the client should wait before retrying, per the limiter window. */
function retryAfterSeconds(req: RateLimitedRequest, windowMs: number): number {
  const resetTime = req.rateLimit?.resetTime;
  if (!resetTime) return Math.ceil(windowMs / 1000);
  return Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000));
}

/** Broad per-IP limit for the whole API. */
export function createApiRateLimiter(options?: { windowMs?: number; max?: number }) {
  const windowMs = options?.windowMs ?? config.rateLimit.windowMs;
  return rateLimit({
    windowMs,
    limit: options?.max ?? config.rateLimit.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => {
      res.setHeader('Retry-After', String(retryAfterSeconds(req, windowMs)));
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
  const windowMs = options?.windowMs ?? 15 * 60_000;
  return rateLimit({
    windowMs,
    limit: options?.max ?? 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    handler: (req, res) => {
      res.setHeader('Retry-After', String(retryAfterSeconds(req, windowMs)));
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
