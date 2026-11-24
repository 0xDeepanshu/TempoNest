import type { NextFunction, Request, Response } from 'express';
import { config } from '../config/env';
import { ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE } from '../utils/cookies';
import { hashOpaqueToken, safeEqualStrings } from '../utils/crypto';
import { AppError } from '../utils/errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Paths authenticated by a confidential client secret rather than a cookie. */
const CSRF_EXEMPT_PATHS = new Set([
  `${config.apiPrefix}/integrations/oauth/token`,
  `${config.apiPrefix}/integrations/oauth/revoke`,
]);

/** The only server-rendered consent form endpoints that may receive Origin: null (same-origin only). */
const HOSTED_CONSENT_PATHS = new Set([
  `${config.apiPrefix}/integrations/oauth/authorize/login`,
  `${config.apiPrefix}/integrations/oauth/authorize/decision`,
  `${config.apiPrefix}/integrations/viewer-links/open`,
  `${config.apiPrefix}/integrations/viewer-links/login`,
  `${config.apiPrefix}/integrations/viewer-links/decision`,
]);

/**
 * The hosted login POST is pre-authentication: no account has been resolved yet, so it is checked
 * against its own token (hostedLoginCsrfToken, bound to the one-time binding cookie), not a session.
 * It must never fall through to the session double-submit check below: a stale ACCESS_COOKIE left over
 * from an unrelated, possibly-expired WorkZen session in the same browser is still sent here (its path
 * is "/"), which would make that check compare this endpoint's distinct token against an unrelated
 * session's CSRF cookie and always fail. The decision endpoint is authenticated and deliberately keeps
 * using the session check below, since its form's token already is the real session CSRF cookie value.
 */
const HOSTED_LOGIN_PATHS = new Set([
  // The viewer-link open POST is authenticated by its one-time nonce in the body, not by a session.
  `${config.apiPrefix}/integrations/viewer-links/open`,
  `${config.apiPrefix}/integrations/oauth/authorize/login`,
  `${config.apiPrefix}/integrations/viewer-links/login`,
]);

/**
 * An unsafe cookie-authenticated request must come from an allowlisted origin
 * or from the same origin that served the request (the hosted integration
 * pages are rendered by this same backend).
 */
export function isOriginAllowed(origin: string, req?: Request): boolean {
  if (config.cors.origins.includes(origin)) return true;

  if (req) {
    try {
      const parsed = new URL(origin);
      const host = req.get('host');
      if (host && parsed.host === host) return true;
    } catch {
      return false;
    }
  }

  return false;
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

function bodyCsrfToken(req: Request): string | undefined {
  const body: unknown = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const value = (body as Record<string, unknown>)['_csrf'];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * CSRF protection for cookie-based browser sessions.
 *
 * - Bearer-token clients (Electron main process, partner integrations) are not
 *   vulnerable to CSRF because tokens are not sent automatically by the
 *   browser, so they skip it.
 * - Cookie sessions must send a token matching both the readable
 *   double-submit cookie and the hash stored on the server-side session. JSON
 *   clients use `X-CSRF-Token`; the server-rendered integration forms use a
 *   hidden `_csrf` field.
 * - Unsafe requests carrying an `Origin` header must come from an allowlisted
 *   or same origin.
 */
export function csrfProtection(req: Request, _res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) return next();
  if (req.auth?.transport === 'bearer') return next();

  const path = req.path;
  if (CSRF_EXEMPT_PATHS.has(path)) return next();

  const origin = req.get('origin');
  // Chrome sends Origin: null for these same-origin form posts, because the consent pages use
  // Referrer-Policy: no-referrer. Accept null only for these exact POST endpoints and only when the
  // browser reports Sec-Fetch-Site: same-origin. The token checks below and in the handlers still apply.
  const hostedSameOriginPost = req.method === 'POST'
    && origin === 'null'
    && HOSTED_CONSENT_PATHS.has(path)
    && req.get('sec-fetch-site') === 'same-origin';
  if (hostedSameOriginPost) {
    // Allowed: validated by the login token (login) or the session CSRF token (decision).
  } else if (origin) {
    if (!isOriginAllowed(origin, req)) {
      return next(AppError.forbidden('Request origin is not allowed', 'ORIGIN_NOT_ALLOWED'));
    }
  } else {
    // Some privacy-focused browsers omit Origin on same-origin form posts but
    // still send a Referer. Apply the same check when one is present.
    const refererOrigin = originFromReferer(req.get('referer'));
    if (refererOrigin && !isOriginAllowed(refererOrigin, req)) {
      return next(AppError.forbidden('Request origin is not allowed', 'ORIGIN_NOT_ALLOWED'));
    }
  }

  // Checked by its own token above (via authorizeLogin), never by a session that may not exist yet
  // or may be a stale leftover from an unrelated account in the same browser.
  if (HOSTED_LOGIN_PATHS.has(path)) return next();

  const hasSessionCookie =
    Boolean(req.cookies?.[ACCESS_COOKIE]) || Boolean(req.cookies?.[REFRESH_COOKIE]);

  // Unauthenticated requests without a session (login, register, public
  // invitation preview) do not have a server-side CSRF hash yet. The Origin
  // check above still applies when the browser supplies one.
  if (!req.auth && !hasSessionCookie) return next();

  const headerToken = req.get('x-csrf-token') ?? bodyCsrfToken(req);
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
