import type { Request, Response } from 'express';
import { Op } from 'sequelize';
import { Session } from '../../database';
import { config } from '../../config/env';
import { clearAuthCookies, REFRESH_COOKIE, setAuthCookies } from '../../utils/cookies';
import { AppError } from '../../utils/errors';
import { asyncHandler } from '../../utils/asyncHandler';
import { toPublicUser } from '../memberships/membership.mapper';
import { getAuthenticatedUser, loginUser, registerUser } from './auth.service';
import {
  rotateSession,
  revokeOtherSessions,
  revokeSessionById,
  revokeSessionByRefreshToken,
  toSessionSummary,
} from './session.service';
import type { IssuedTokens } from './session.service';
import type { AuthClient, LoginInput, RefreshInput, RegisterInput } from './auth.schemas';

function sessionPayload(
  issued: IssuedTokens,
  user: { id: string },
  memberships: unknown[],
  client: AuthClient,
) {
  return {
    user,
    memberships,
    client,
    csrfToken: issued.csrfToken,
    accessTokenExpiresAt: issued.accessExpiresAt,
    refreshTokenExpiresAt: issued.refreshExpiresAt,
    expiresIn: config.auth.accessTokenTtlSeconds,
    ...(client !== 'browser'
      ? {
          accessToken: issued.accessToken,
          refreshToken: issued.refreshToken,
          tokenType: 'Bearer' as const,
        }
      : {}),
  };
}

export const register = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as RegisterInput;
  const user = await registerUser(input);
  res.status(201).json({ data: { user } });
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as LoginInput;
  const { user, memberships, issued } = await loginUser(input, req);
  const client = input.client;

  if (client === 'browser') {
    setAuthCookies(res, {
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      csrfToken: issued.csrfToken,
      accessExpiresAt: issued.accessExpiresAt,
      refreshExpiresAt: issued.refreshExpiresAt,
    });
  }

  res.status(200).json({
    data: sessionPayload(issued, toPublicUser(user), memberships, client),
  });
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as RefreshInput;
  const cookieToken: unknown = req.cookies?.[REFRESH_COOKIE];
  const bodyToken = input.refreshToken;
  const token = bodyToken ?? (typeof cookieToken === 'string' ? cookieToken : undefined);

  if (!token) {
    throw AppError.unauthorized('Refresh token is required', 'REFRESH_TOKEN_REQUIRED');
  }

  if ((input.client === 'desktop' || input.client === 'mobile') && !bodyToken) {
    throw AppError.badRequest(
      'Token clients must send the refresh token in the request body',
      'REFRESH_TOKEN_REQUIRED',
    );
  }

  // Explicit token clients keep their label. An omitted client with a body
  // token remains "desktop" for backward compatibility with existing clients.
  const client: AuthClient =
    input.client === 'mobile'
      ? 'mobile'
      : input.client === 'desktop'
        ? 'desktop'
        : bodyToken
          ? 'desktop'
          : 'browser';

  const { user, tokens } = await rotateSession(token);
  const { memberships } = await getAuthenticatedUser(user);

  if (client === 'browser') {
    setAuthCookies(res, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      csrfToken: tokens.csrfToken,
      accessExpiresAt: tokens.accessExpiresAt,
      refreshExpiresAt: tokens.refreshExpiresAt,
    });
  }

  res.status(200).json({
    data: sessionPayload(tokens, toPublicUser(user), memberships, client),
  });
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as { refreshToken?: string };

  if (req.auth) {
    await revokeSessionById(req.auth.session.id, req.auth.user.id);
  } else {
    const cookieToken: unknown = req.cookies?.[REFRESH_COOKIE];
    if (typeof cookieToken === 'string') {
      await revokeSessionByRefreshToken(cookieToken);
    } else if (body.refreshToken) {
      await revokeSessionByRefreshToken(body.refreshToken);
    }
  }

  clearAuthCookies(res);
  res.status(204).end();
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  if (!req.auth) {
    throw AppError.unauthorized('Authentication required', 'UNAUTHENTICATED');
  }

  const { user, memberships } = await getAuthenticatedUser(req.auth.user);
  res.status(200).json({
    data: {
      user,
      memberships,
      platformRole: req.auth.user.platformRole ?? null,
      session: {
        id: req.auth.session.id,
        transport: req.auth.transport,
        accessExpiresAt: req.auth.session.accessExpiresAt,
        refreshExpiresAt: req.auth.session.refreshExpiresAt,
      },
    },
  });
});

export const listSessions = asyncHandler(async (req: Request, res: Response) => {
  const auth = req.auth!;
  const sessions = await Session.findAll({
    where: {
      userId: auth.user.id,
      revokedAt: null,
      refreshExpiresAt: { [Op.gt]: new Date() },
    },
    order: [
      ['lastUsedAt', 'DESC'],
      ['id', 'ASC'],
    ],
  });

  res.status(200).json({
    data: sessions.map((session) => toSessionSummary(session, auth.session.id)),
  });
});

export const revokeSession = asyncHandler(async (req: Request, res: Response) => {
  const auth = req.auth!;
  await revokeSessionById(req.params.sessionId!, auth.user.id);
  res.status(204).end();
});

export const revokeOtherSessionsController = asyncHandler(async (req: Request, res: Response) => {
  const auth = req.auth!;
  const revoked = await revokeOtherSessions(auth.user.id, auth.session.id);
  res.status(200).json({ data: { revoked } });
});
