import type { Request } from 'express';
import type { User } from '../users/user.model';
import { config } from '../../config/env';
import { logger } from '../../config/logger';
import { User as UserModel } from '../../database';
import { AppError } from '../../utils/errors';
import { hashPassword, getDummyPasswordHash, verifyPassword } from '../../utils/password';
import { toPublicUser } from '../memberships/membership.mapper';
import {
  createSession,
  getUserMemberships,
  type IssuedTokens,
} from './session.service';
import type { LoginInput, RegisterInput } from './auth.schemas';

export type AuthenticatedLogin = {
  user: User;
  memberships: Awaited<ReturnType<typeof getUserMemberships>>;
  issued: IssuedTokens;
};

export async function registerUser(input: RegisterInput) {
  const existing = await UserModel.findOne({ where: { email: input.email } });
  if (existing) {
    throw AppError.conflict('An account with this email already exists', 'EMAIL_ALREADY_EXISTS');
  }

  const passwordHash = await hashPassword(input.password);

  try {
    const user = await UserModel.create({
      name: input.name,
      email: input.email,
      passwordHash,
    });
    return toPublicUser(user);
  } catch (error) {
    // Handle the race between the uniqueness check and the insert.
    if (error instanceof Error && error.name === 'SequelizeUniqueConstraintError') {
      throw AppError.conflict('An account with this email already exists', 'EMAIL_ALREADY_EXISTS');
    }
    throw error;
  }
}

export async function loginUser(input: LoginInput, req: Request): Promise<AuthenticatedLogin> {
  const user = await UserModel.unscoped().findOne({ where: { email: input.email } });

  // Always perform a hash verification to reduce user-enumeration timing leaks.
  const hashToCheck = user?.passwordHash ?? (await getDummyPasswordHash());
  const passwordMatches = await verifyPassword(hashToCheck, input.password);
  const now = new Date();

  if (!user || !passwordMatches) {
    if (user) {
      await recordFailedLogin(user, now);
    }
    throw AppError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  // The lockout is only surfaced after a correct password, so it cannot be
  // used to discover whether an arbitrary address has an account.
  if (user.lockedUntil && user.lockedUntil.getTime() > now.getTime()) {
    logger.warn({ userId: user.id }, 'sign-in rejected while account lockout is active');
    throw AppError.tooManyRequests(
      'Too many failed sign-in attempts. Please try again later.',
      'ACCOUNT_LOCKED',
    );
  }

  if (user.status !== 'ACTIVE') {
    throw AppError.forbidden('This account is disabled', 'ACCOUNT_DISABLED');
  }

  if (user.failedLoginAttempts !== 0 || user.lockedUntil) {
    await user.update({ failedLoginAttempts: 0, lockedUntil: null });
  }

  const issued = await createSession(user, req);
  await user.update({ lastLoginAt: new Date() });

  return {
    user,
    memberships: await getUserMemberships(user.id),
    issued,
  };
}

/**
 * Increment the per-account failure counter and lock the account once the
 * threshold is reached. Wrong guesses during an active lock never extend it.
 */
async function recordFailedLogin(user: User, now: Date): Promise<void> {
  if (user.lockedUntil && user.lockedUntil.getTime() > now.getTime()) {
    return;
  }

  const attempts = user.failedLoginAttempts + 1;
  const shouldLock = attempts >= config.auth.loginMaxFailedAttempts;

  await user.update({
    failedLoginAttempts: shouldLock ? 0 : attempts,
    lockedUntil: shouldLock
      ? new Date(now.getTime() + config.auth.loginLockoutSeconds * 1000)
      : null,
  });

  if (shouldLock) {
    logger.warn({ userId: user.id }, 'account locked after repeated failed sign-ins');
  }
}

export async function getAuthenticatedUser(user: User) {
  return {
    user: toPublicUser(user),
    memberships: await getUserMemberships(user.id),
  };
}
