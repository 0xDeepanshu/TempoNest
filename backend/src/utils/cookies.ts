import type { CookieOptions, Response } from 'express';
import { config } from '../config/env';

export const ACCESS_COOKIE = 'tn_access';
export const REFRESH_COOKIE = 'tn_refresh';
export const CSRF_COOKIE = 'tn_csrf';

export type AuthCookiePayload = {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
};

function baseCookieOptions(): CookieOptions {
  return {
    secure: config.auth.cookie.secure,
    sameSite: config.auth.cookie.sameSite,
    domain: config.auth.cookie.domain,
    path: '/',
  };
}

export function setAuthCookies(res: Response, payload: AuthCookiePayload): void {
  const base = baseCookieOptions();

  res.cookie(ACCESS_COOKIE, payload.accessToken, {
    ...base,
    httpOnly: true,
    expires: payload.accessExpiresAt,
  });

  res.cookie(REFRESH_COOKIE, payload.refreshToken, {
    ...base,
    httpOnly: true,
    // The refresh token is only ever sent to the auth endpoints.
    path: `${config.apiPrefix}/auth`,
    expires: payload.refreshExpiresAt,
  });

  res.cookie(CSRF_COOKIE, payload.csrfToken, {
    ...base,
    httpOnly: false,
    expires: payload.refreshExpiresAt,
  });
}

export function clearAuthCookies(res: Response): void {
  const base = baseCookieOptions();

  res.clearCookie(ACCESS_COOKIE, { ...base, httpOnly: true, path: '/' });
  res.clearCookie(REFRESH_COOKIE, {
    ...base,
    httpOnly: true,
    path: `${config.apiPrefix}/auth`,
  });
  res.clearCookie(CSRF_COOKIE, { ...base, httpOnly: false, path: '/' });
}
