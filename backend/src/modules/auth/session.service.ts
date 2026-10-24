import type { Request } from 'express';
import { Op } from 'sequelize';
import { config } from '../../config/env';
import { logger } from '../../config/logger';
import { Membership, Organization, Session, User } from '../../database';
import { generateOpaqueToken, hashOpaqueToken } from '../../utils/crypto';
import { AppError } from '../../utils/errors';
import { getClientIp, getUserAgent } from '../../utils/pagination';
import { toMembershipSummary } from '../memberships/membership.mapper';
import type { User as UserModel } from '../users/user.model';
import type { Session as SessionModel } from './session.model';

export type IssuedTokens = {
  session: SessionModel;
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
};

function buildTokenHashes() {
  const accessToken = generateOpaqueToken();
  const refreshToken = generateOpaqueToken();
  const csrfToken = generateOpaqueToken();
  const now = Date.now();

  return {
    accessToken,
    refreshToken,
    csrfToken,
    accessTokenHash: hashOpaqueToken(accessToken, config.auth.tokenPepper),
    refreshTokenHash: hashOpaqueToken(refreshToken, config.auth.tokenPepper),
    csrfTokenHash: hashOpaqueToken(csrfToken, config.auth.tokenPepper),
    accessExpiresAt: new Date(now + config.auth.accessTokenTtlSeconds * 1000),
    refreshExpiresAt: new Date(now + config.auth.refreshTokenTtlSeconds * 1000),
  };
}

async function enforceSessionLimit(userId: string): Promise<void> {
  const active = await Session.findAll({
    where: { userId, revokedAt: null, refreshExpiresAt: { [Op.gt]: new Date() } },
    order: [
      ['createdAt', 'ASC'],
      ['id', 'ASC'],
    ],
    attributes: ['id'],
  });

  const overflow = active.length - config.auth.maxActiveSessionsPerUser + 1;
  if (overflow <= 0) return;

  const ids = active.slice(0, overflow).map((session) => session.id);
  await Session.update({ revokedAt: new Date() }, { where: { id: { [Op.in]: ids } } });
  logger.info({ userId, revokedCount: ids.length }, 'revoked oldest sessions after session limit');
}

export async function createSession(user: UserModel, req: Request): Promise<IssuedTokens> {
  await enforceSessionLimit(user.id);

  const tokens = buildTokenHashes();
  const session = await Session.create({
    userId: user.id,
    accessTokenHash: tokens.accessTokenHash,
    accessExpiresAt: tokens.accessExpiresAt,
    refreshTokenHash: tokens.refreshTokenHash,
    refreshExpiresAt: tokens.refreshExpiresAt,
    csrfTokenHash: tokens.csrfTokenHash,
    userAgent: getUserAgent(req),
    ipAddress: getClientIp(req),
    lastUsedAt: new Date(),
  });

  return {
    session,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    csrfToken: tokens.csrfToken,
    accessExpiresAt: tokens.accessExpiresAt,
    refreshExpiresAt: tokens.refreshExpiresAt,
  };
}

/**
 * Rotate a refresh token. The update is conditional on the presented hash so
 * that a token can only be redeemed once even under concurrent requests.
 */
export async function rotateSession(refreshToken: string): Promise<{
  session: SessionModel;
  user: UserModel;
  tokens: IssuedTokens;
}> {
  const presentedHash = hashOpaqueToken(refreshToken, config.auth.tokenPepper);

  const session = await Session.findOne({
    where: { refreshTokenHash: presentedHash },
    include: [{ model: User, as: 'user' }],
  });

  if (!session || !session.user) {
    // If this token was already rotated, treat presentation as token theft and
    // revoke the whole session family.
    const reused = await Session.findOne({
      where: { previousRefreshTokenHash: presentedHash, revokedAt: null },
    });
    if (reused) {
      await reused.update({ revokedAt: new Date() });
      logger.warn({ sessionId: reused.id, userId: reused.userId }, 'refresh token reuse detected');
    }
    throw AppError.unauthorized('Refresh token is invalid or expired', 'REFRESH_TOKEN_INVALID');
  }

  if (session.revokedAt) {
    throw AppError.unauthorized('Session has been revoked', 'SESSION_REVOKED');
  }

  if (session.refreshExpiresAt.getTime() <= Date.now()) {
    await session.update({ revokedAt: new Date() });
    throw AppError.unauthorized('Refresh token has expired', 'REFRESH_TOKEN_EXPIRED');
  }

  if (session.user.status !== 'ACTIVE') {
    await session.update({ revokedAt: new Date() });
    throw AppError.forbidden('This account is disabled', 'ACCOUNT_DISABLED');
  }

  const tokens = buildTokenHashes();
  const now = new Date();

  const [updated] = await Session.update(
    {
      accessTokenHash: tokens.accessTokenHash,
      accessExpiresAt: tokens.accessExpiresAt,
      refreshTokenHash: tokens.refreshTokenHash,
      previousRefreshTokenHash: presentedHash,
      refreshExpiresAt: tokens.refreshExpiresAt,
      csrfTokenHash: tokens.csrfTokenHash,
      rotatedAt: now,
      lastUsedAt: now,
    },
    {
      where: {
        id: session.id,
        refreshTokenHash: presentedHash,
        revokedAt: null,
      },
    },
  );

  if (updated !== 1) {
    await session.update({ revokedAt: now });
    throw AppError.unauthorized('Refresh token has already been used', 'REFRESH_TOKEN_REUSED');
  }

  session.accessTokenHash = tokens.accessTokenHash;
  session.accessExpiresAt = tokens.accessExpiresAt;
  session.refreshTokenHash = tokens.refreshTokenHash;
  session.previousRefreshTokenHash = presentedHash;
  session.refreshExpiresAt = tokens.refreshExpiresAt;
  session.csrfTokenHash = tokens.csrfTokenHash;
  session.rotatedAt = now;
  session.lastUsedAt = now;

  return {
    session,
    user: session.user,
    tokens: {
      session,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      csrfToken: tokens.csrfToken,
      accessExpiresAt: tokens.accessExpiresAt,
      refreshExpiresAt: tokens.refreshExpiresAt,
    },
  };
}

export async function revokeSessionById(sessionId: string, userId: string): Promise<void> {
  const session = await Session.findOne({ where: { id: sessionId, userId } });
  if (!session) {
    throw AppError.notFound('Session not found', 'SESSION_NOT_FOUND');
  }
  if (!session.revokedAt) {
    await session.update({ revokedAt: new Date() });
  }
}

export async function revokeSessionByRefreshToken(refreshToken: string): Promise<void> {
  const hash = hashOpaqueToken(refreshToken, config.auth.tokenPepper);
  await Session.update(
    { revokedAt: new Date() },
    { where: { refreshTokenHash: hash, revokedAt: null } },
  );
}

export async function revokeOtherSessions(userId: string, currentSessionId: string): Promise<number> {
  const [count] = await Session.update(
    { revokedAt: new Date() },
    {
      where: {
        userId,
        revokedAt: null,
        id: { [Op.ne]: currentSessionId },
      },
    },
  );
  return count;
}

export function toSessionSummary(session: SessionModel, currentSessionId: string) {
  return {
    id: session.id,
    current: session.id === currentSessionId,
    userAgent: session.userAgent,
    ipAddress: session.ipAddress,
    createdAt: session.createdAt,
    lastUsedAt: session.lastUsedAt,
    expiresAt: session.refreshExpiresAt,
  };
}

export async function getUserMemberships(userId: string) {
  const memberships = await Membership.findAll({
    where: { userId, status: { [Op.in]: ['ACTIVE', 'SUSPENDED'] } },
    include: [{ model: Organization, as: 'organization', required: true }],
    order: [
      ['createdAt', 'ASC'],
      ['id', 'ASC'],
    ],
  });

  return memberships.map(toMembershipSummary);
}
