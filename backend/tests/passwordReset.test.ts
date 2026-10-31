import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  API,
  PASSWORD,
  app,
  loginBrowser,
  registerUser,
  resetDatabase,
  uniqueEmail,
} from './helpers';
import { PasswordResetToken, User } from '../src/database';
import { getMemoryOutbox } from '../src/utils/mailer';

const NEW_PASSWORD = 'BrandNewPassw0rdForTests!';

beforeEach(async () => {
  await resetDatabase();
});

function extractResetToken(html: string): string {
  const match = html.match(/reset-password\?token=([^"&\s<]+)/);
  if (!match?.[1]) {
    throw new Error('Reset link was not present in the e-mail body');
  }
  return decodeURIComponent(match[1]);
}

async function requestReset(email: string) {
  const response = await request(app).post(`${API}/auth/forgot-password`).send({ email });
  return response;
}

async function resetWith(token: string, password = NEW_PASSWORD) {
  return request(app).post(`${API}/auth/reset-password`).send({ token, password });
}

describe('password reset', () => {
  it('e-mails a hashed, single-use link, revokes sessions, and changes the password only', async () => {
    const email = uniqueEmail('reset');
    await registerUser(email);
    const session = await loginBrowser(email);

    const forgot = await requestReset(email);
    expect(forgot.status).toBe(202);

    const outbox = getMemoryOutbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.to).toBe(email);
    const token = extractResetToken(outbox[0]!.html);

    const stored = await PasswordResetToken.findOne({
      where: { userId: session.user.id },
    });
    expect(stored).toBeTruthy();
    expect(stored!.tokenHash).toHaveLength(64);
    expect(stored!.tokenHash).not.toBe(token);
    expect(JSON.stringify(stored!.toJSON())).not.toContain(token);

    const reset = await resetWith(token);
    expect(reset.status).toBe(200);

    // The credential change invalidates every existing sign-in.
    const me = await session.agent.get(`${API}/auth/me`);
    expect(me.status).toBe(401);

    const oldPassword = await loginBrowser(email);
    expect(oldPassword.response.status).toBe(401);

    const newPassword = await loginBrowser(email, NEW_PASSWORD);
    expect(newPassword.response.status).toBe(200);

    const reuse = await resetWith(token);
    expect(reuse.status).toBe(400);
    expect(reuse.body.error.code).toBe('PASSWORD_RESET_INVALID');
  });

  it('responds identically whether or not the address has an account', async () => {
    const email = uniqueEmail('known');
    await registerUser(email);

    const known = await requestReset(email);
    const unknown = await requestReset(uniqueEmail('missing'));

    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.body.data.message).toBe(unknown.body.data.message);
    expect(getMemoryOutbox()).toHaveLength(1);
  });

  it('invalidates superseded and expired links', async () => {
    const email = uniqueEmail('superseded');
    await registerUser(email);
    const user = await User.findOne({ where: { email } });

    await requestReset(email);
    const firstToken = extractResetToken(getMemoryOutbox()[0]!.html);
    await requestReset(email);
    const secondToken = extractResetToken(getMemoryOutbox()[1]!.html);

    const superseded = await resetWith(firstToken);
    expect(superseded.status).toBe(400);
    expect(superseded.body.error.code).toBe('PASSWORD_RESET_INVALID');

    await PasswordResetToken.update(
      { expiresAt: new Date(Date.now() - 60_000) },
      { where: { userId: user!.id, usedAt: null } },
    );

    const expired = await resetWith(secondToken);
    expect(expired.status).toBe(400);
    expect(expired.body.error.code).toBe('PASSWORD_RESET_INVALID');
  });

  it('validates password strength before consuming the token', async () => {
    const email = uniqueEmail('weak-reset');
    await registerUser(email);
    await requestReset(email);
    const token = extractResetToken(getMemoryOutbox()[0]!.html);

    const weak = await resetWith(token, 'short');
    expect(weak.status).toBe(422);

    // The token is still usable after a rejected submission.
    const valid = await resetWith(token);
    expect(valid.status).toBe(200);
  });

  it('clears an active login lockout when the password is reset', async () => {
    const email = uniqueEmail('locked-reset');
    await registerUser(email);
    const user = await User.findOne({ where: { email } });
    await User.update(
      {
        failedLoginAttempts: 10,
        lockedUntil: new Date(Date.now() + 10 * 60_000),
      },
      { where: { id: user!.id } },
    );

    await requestReset(email);
    const token = extractResetToken(getMemoryOutbox()[0]!.html);
    expect((await resetWith(token)).status).toBe(200);

    const login = await loginBrowser(email, NEW_PASSWORD);
    expect(login.response.status).toBe(200);

    const stored = await User.findOne({ where: { email } });
    expect(stored!.failedLoginAttempts).toBe(0);
    expect(stored!.lockedUntil).toBeNull();
  });

  it('does not issue links for disabled accounts', async () => {
    const email = uniqueEmail('disabled-reset');
    await registerUser(email);
    const user = await User.findOne({ where: { email } });
    await User.update({ status: 'DISABLED' }, { where: { id: user!.id } });

    const forgot = await requestReset(email);
    expect(forgot.status).toBe(202);
    expect(getMemoryOutbox()).toHaveLength(0);

    // A link minted before disabling also stops working.
    await User.update({ status: 'ACTIVE' }, { where: { id: user!.id } });
    await requestReset(email);
    const token = extractResetToken(getMemoryOutbox()[0]!.html);
    await User.update({ status: 'DISABLED' }, { where: { id: user!.id } });

    const reset = await resetWith(token);
    expect(reset.status).toBe(403);
    expect(reset.body.error.code).toBe('ACCOUNT_DISABLED');

    // The password was not changed.
    const unchanged = await loginBrowser(email, PASSWORD);
    expect(unchanged.response.status).toBe(403);
    expect(unchanged.response.body.error.code).toBe('ACCOUNT_DISABLED');
  });
});
