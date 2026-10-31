import { Op } from 'sequelize';
import { config } from '../../config/env';
import { logger } from '../../config/logger';
import { PasswordResetToken, Session, sequelize, User } from '../../database';
import { generateOpaqueToken, hashOpaqueToken } from '../../utils/crypto';
import { passwordResetEmail } from '../../utils/emailTemplates';
import { AppError } from '../../utils/errors';
import { sendMail } from '../../utils/mailer';
import { hashPassword } from '../../utils/password';

function hashResetToken(token: string): string {
  return hashOpaqueToken(token, config.auth.tokenPepper);
}

/**
 * Start a password reset. The response is always generic so callers cannot use
 * this endpoint to learn whether an address has an account.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await User.findOne({ where: { email } });

  // Disabled accounts cannot sign in, so a reset would only change a password
  // that cannot be used. The generic response is unchanged.
  if (!user || user.status !== 'ACTIVE') {
    logger.info({ emailPresent: Boolean(user) }, 'password reset requested');
    return;
  }

  const token = generateOpaqueToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.auth.passwordResetTtlSeconds * 1000);

  await sequelize.transaction(async (transaction) => {
    // Only the newest link works. Previously issued, unused links are burned.
    await PasswordResetToken.update(
      { usedAt: now },
      { where: { userId: user.id, usedAt: null }, transaction },
    );
    await PasswordResetToken.create(
      { userId: user.id, tokenHash: hashResetToken(token), expiresAt },
      { transaction },
    );
  });

  const resetUrl = `${config.mail.webAppUrl}/reset-password?token=${encodeURIComponent(token)}`;
  const template = passwordResetEmail({ name: user.name, resetUrl, expiresAt });

  try {
    await sendMail({ to: user.email, ...template });
  } catch (error) {
    // Delivery failure must not reveal account existence or fail the request.
    logger.error({ err: error, userId: user.id }, 'failed to send password reset e-mail');
  }

  logger.info({ userId: user.id }, 'password reset requested');
}

/**
 * Consume a reset token and replace the password. The token is claimed with a
 * conditional update so concurrent submissions cannot both succeed; every
 * existing session is revoked because the credential changed.
 */
export async function resetPassword(token: string, password: string): Promise<void> {
  const tokenHash = hashResetToken(token);

  const record = await PasswordResetToken.findOne({
    where: { tokenHash },
    include: [{ model: User, as: 'user', required: true }],
  });

  const invalid = AppError.badRequest(
    'This password reset link is invalid or has expired',
    'PASSWORD_RESET_INVALID',
  );

  if (!record || !record.user || record.usedAt) {
    throw invalid;
  }
  if (record.expiresAt.getTime() <= Date.now()) {
    throw invalid;
  }
  if (record.user.status !== 'ACTIVE') {
    throw AppError.forbidden('This account is disabled', 'ACCOUNT_DISABLED');
  }

  const passwordHash = await hashPassword(password);
  const now = new Date();

  await sequelize.transaction(async (transaction) => {
    const [claimed] = await PasswordResetToken.update(
      { usedAt: now },
      {
        where: {
          id: record.id,
          usedAt: null,
          expiresAt: { [Op.gt]: now },
        },
        transaction,
      },
    );

    if (claimed !== 1) {
      throw invalid;
    }

    await User.update(
      { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
      { where: { id: record.userId }, transaction },
    );

    await Session.update(
      { revokedAt: now },
      { where: { userId: record.userId, revokedAt: null }, transaction },
    );
  });

  logger.info({ userId: record.userId }, 'password reset completed');
}
