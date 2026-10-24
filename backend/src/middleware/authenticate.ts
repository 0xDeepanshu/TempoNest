import type { NextFunction, Request, Response } from 'express';
import { getClientIp, getUserAgent } from '../utils/pagination';
import { hashOpaqueToken } from '../utils/crypto';
import { AppError } from '../utils/errors';
import { config } from '../config/env';
import { Session, User } from '../database';
import { ACCESS_COOKIE } from '../utils/cookies';

/**
 * Optional authentication. Populates `req.auth` when valid credentials are
 * present. Invalid/expired credentials do not fail the request here; protected
 * routes reject via `requireAuth` with a specific error code so clients can
 * distinguish "refresh needed" from "not logged in".
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const authorization = req.get('authorization');
    let rawToken: string | undefined;
    let transport: 'cookie' | 'bearer' = 'cookie';

    if (authorization !== undefined) {
      const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
      if (!match?.[1]) {
        req.authError = AppError.unauthorized('Invalid authorization header', 'AUTH_TOKEN_INVALID');
        return next();
      }
      rawToken = match[1];
      transport = 'bearer';
    } else {
      const cookieToken: unknown = req.cookies?.[ACCESS_COOKIE];
      if (typeof cookieToken === 'string' && cookieToken.length > 0) {
        rawToken = cookieToken;
      }
    }

    if (!rawToken) return next();

    const session = await Session.findOne({
      where: {
        accessTokenHash: hashOpaqueToken(rawToken, config.auth.tokenPepper),
        revokedAt: null,
      },
      include: [{ model: User, as: 'user' }],
    });

    if (!session || !session.user) {
      req.authError = AppError.unauthorized('Invalid access token', 'AUTH_TOKEN_INVALID');
      return next();
    }

    if (session.accessExpiresAt.getTime() <= Date.now()) {
      req.authError = AppError.unauthorized('Access token expired', 'AUTH_TOKEN_EXPIRED');
      return next();
    }

    if (session.user.status !== 'ACTIVE') {
      req.authError = AppError.forbidden('This account is disabled', 'ACCOUNT_DISABLED');
      return next();
    }

    req.auth = { user: session.user, session, transport };

    // Throttle writes: update last-used at most once per five minutes.
    if (Date.now() - session.lastUsedAt.getTime() > 5 * 60_000) {
      void session
        .update({
          lastUsedAt: new Date(),
          userAgent: getUserAgent(req) ?? session.userAgent,
          ipAddress: getClientIp(req) ?? session.ipAddress,
        })
        .catch(() => undefined);
    }

    next();
  } catch (error) {
    next(error);
  }
}

/** Reject requests without a valid authenticated session. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (req.auth) return next();
  if (req.authError) return next(req.authError);
  next(AppError.unauthorized('Authentication required', 'UNAUTHENTICATED'));
}
