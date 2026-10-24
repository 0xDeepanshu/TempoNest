import type { NextFunction, Request, Response } from 'express';
import { config } from '../config/env';
import { ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE } from '../utils/cookies';
import { hashOpaqueToken, safeEqualStrings } from '../utils/crypto';
import { AppError } from '../utils/errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isOriginAllowed(origin: string): boolean {
  return config.cors.origins.includes(origin);
}

function originFromReferer(referer: string | undefined): string | undefined {
  if (!referer) return undefined;
  try {
    const url = new URL(referer);
    return url.origin;
  } catch {
    return undefined;
  }
}

/**
 * CSRF protection for cookie-based browser sessions.
 *
 * - Bearer-token clients (Electron main process) are not vulnerable to CSRF
 *   because tokens are not sent automatically by the browser, so they skip it.
 * - Cookie sessions must send `X-CSRF-Token` matching both the readable
 *   double-submit cookie and the hash stored on the server-side session.
 * - Unsafe requests carrying an `Origin` header must come from an allowlisted
 *   origin.
 */
export function csrfProtection(req: Request, _res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) return next();
  if (req.auth?.transport === 'bearer') return next();

  const origin = req.get('origin');
  if (origin) {
    if (!isOriginAllowed(origin)) {
      return next(AppError.forbidden('Request origin is not allowed', 'ORIGIN_NOT_ALLOWED'));
    }
  }

  const hasSessionCookie =
    Boolean(req.cookies?.[ACCESS_COOKIE]) || Boolean(req.cookies?.[REFRESH_COOKIE]);

  // Unauthenticated requests without a session (login, register, public
  // invitation preview) do not have a server-side CSRF hash yet. The Origin
  // check above still applies when the browser supplies one.
  if (!req.auth && !hasSessionCookie) return next();

  const headerToken = req.get('x-csrf-token');
  const cookieToken: unknown = req.cookies?.[CSRF_COOKIE];

  if (
    typeof headerToken !== 'string' ||
    typeof cookieToken !== 'string' ||
    headerToken.length === 0 ||
    !safeEqualStrings(headerToken, cookieToken)
  ) {
    return next(AppError.forbidden('CSRF token is missing or invalid', 'CSRF_INVALID'));
  }

  if (
    req.auth &&
    !safeEqualStrings(
      hashOpaqueToken(headerToken, config.auth.tokenPepper),
      req.auth.session.csrfTokenHash,
    )
  ) {
    return next(AppError.forbidden('CSRF token is invalid', 'CSRF_INVALID'));
  }

  next();
}
