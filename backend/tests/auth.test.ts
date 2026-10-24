import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  API,
  PASSWORD,
  app,
  createOwner,
  loginBrowser,
  loginDesktop,
  loginMobile,
  registerAgent,
  registerUser,
  resetDatabase,
  uniqueEmail,
} from './helpers';
import { Session } from '../src/database';

beforeEach(async () => {
  await resetDatabase();
});

describe('health', () => {
  it('returns liveness and readiness information', async () => {
    const live = await request(app).get(`${API}/health`);
    expect(live.status).toBe(200);
    expect(live.body.data.status).toBe('ok');

    const ready = await request(app).get(`${API}/health/ready`);
    expect(ready.status).toBe(200);
    expect(ready.body.data.checks.database).toBe('ok');
  });

  it('sets a request ID header and returns it with errors', async () => {
    const response = await request(app).get(`${API}/does-not-exist`).set('x-request-id', 'test-request-1');
    expect(response.status).toBe(404);
    expect(response.headers['x-request-id']).toBe('test-request-1');
    expect(response.body.requestId).toBe('test-request-1');
    expect(response.body.error.code).toBe('ROUTE_NOT_FOUND');
  });
});

describe('registration', () => {
  it('creates a user and never returns the password hash', async () => {
    const email = uniqueEmail();
    const response = await registerUser(email, 'Ada Lovelace');

    expect(response.status).toBe(201);
    expect(response.body.data.user.email).toBe(email);
    expect(response.body.data.user.name).toBe('Ada Lovelace');
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain('argon2');
  });

  it('normalizes email addresses and rejects duplicate accounts', async () => {
    const email = uniqueEmail();
    const first = await registerUser(email.toUpperCase());
    expect(first.status).toBe(201);
    expect(first.body.data.user.email).toBe(email);

    const duplicate = await registerUser(email);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('EMAIL_ALREADY_EXISTS');
  });

  it('validates weak passwords and malformed emails', async () => {
    const weak = await registerUser(uniqueEmail(), 'Test', 'short');
    expect(weak.status).toBe(422);
    expect(weak.body.error.code).toBe('VALIDATION_ERROR');

    const badEmail = await registerUser('not-an-email');
    expect(badEmail.status).toBe(422);
  });
});

describe('login and browser sessions', () => {
  it('sets secure HttpOnly cookies and returns a CSRF token', async () => {
    const email = uniqueEmail();
    await registerUser(email);
    const login = await loginBrowser(email);

    expect(login.response.status).toBe(200);
    expect(login.csrf).toBeTruthy();
    expect(login.response.body.data.accessToken).toBeUndefined();
    expect(login.response.body.data.refreshToken).toBeUndefined();
    expect(JSON.stringify(login.response.body)).not.toContain('passwordHash');

    const cookies = login.response.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((cookie) => cookie.startsWith('tn_access=') && cookie.includes('HttpOnly'))).toBe(true);
    expect(cookies.some((cookie) => cookie.startsWith('tn_refresh=') && cookie.includes('HttpOnly'))).toBe(true);
    expect(cookies.some((cookie) => cookie.startsWith('tn_csrf=') && !cookie.includes('HttpOnly'))).toBe(true);
    expect(cookies.every((cookie) => cookie.includes('SameSite=Lax'))).toBe(true);

    const me = await login.agent.get(`${API}/auth/me`);
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe(email);
    expect(me.body.data.session.transport).toBe('cookie');
  });

  it('rejects wrong credentials without revealing whether the account exists', async () => {
    const email = uniqueEmail();
    await registerUser(email);

    const wrongPassword = await request(app)
      .post(`${API}/auth/login`)
      .send({ email, password: 'WrongPassword123!' });
    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');

    const unknownUser = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: 'nobody@example.com', password: PASSWORD });
    expect(unknownUser.status).toBe(401);
    expect(unknownUser.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknownUser.body.error.message).toBe(wrongPassword.body.error.message);
  });

  it('requires authentication for /auth/me', async () => {
    const response = await request(app).get(`${API}/auth/me`);
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('revokes the session on logout and clears cookies', async () => {
    const email = uniqueEmail();
    await registerUser(email);
    const session = await loginBrowser(email);

    const logout = await session.agent
      .post(`${API}/auth/logout`)
      .set('x-csrf-token', session.csrf)
      .send({});

    expect(logout.status).toBe(204);

    const me = await session.agent.get(`${API}/auth/me`);
    expect(me.status).toBe(401);

    const stored = await Session.findOne({ where: { userId: session.user.id } });
    expect(stored?.revokedAt).toBeInstanceOf(Date);
  });
});

describe('CSRF protection', () => {
  it('rejects cookie-authenticated unsafe requests without a valid CSRF token', async () => {
    const email = uniqueEmail();
    await registerUser(email);
    const session = await loginBrowser(email);

    const missing = await session.agent.post(`${API}/organizations`).send({ name: 'No CSRF' });
    expect(missing.status).toBe(403);
    expect(missing.body.error.code).toBe('CSRF_INVALID');

    const mismatched = await session.agent
      .post(`${API}/organizations`)
      .set('x-csrf-token', 'not-the-right-token')
      .send({ name: 'Bad CSRF' });
    expect(mismatched.status).toBe(403);

    const valid = await session.agent
      .post(`${API}/organizations`)
      .set('x-csrf-token', session.csrf)
      .send({ name: 'Good CSRF' });
    expect(valid.status).toBe(201);
  });

  it('rejects unsafe requests from non-allowlisted origins', async () => {
    const email = uniqueEmail();
    await registerUser(email);
    const session = await loginBrowser(email);

    const response = await session.agent
      .post(`${API}/organizations`)
      .set('origin', 'https://evil.example.com')
      .set('x-csrf-token', session.csrf)
      .send({ name: 'Evil Corp' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
  });
});

describe('desktop (bearer) sessions', () => {
  it('issues tokens in the response body and authenticates via Authorization header', async () => {
    const email = uniqueEmail();
    await registerUser(email);

    const login = await loginDesktop(email);
    expect(login.status).toBe(200);
    expect(login.body.data.accessToken).toBeTruthy();
    expect(login.body.data.refreshToken).toBeTruthy();
    expect(login.body.data.tokenType).toBe('Bearer');
    expect(login.headers['set-cookie']).toBeUndefined();

    const me = await request(app)
      .get(`${API}/auth/me`)
      .set('authorization', `Bearer ${login.body.data.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.session.transport).toBe('bearer');

    // Bearer clients are not subject to CSRF checks.
    const org = await request(app)
      .post(`${API}/organizations`)
      .set('authorization', `Bearer ${login.body.data.accessToken}`)
      .send({ name: 'Desktop Org' });
    expect(org.status).toBe(201);
  });

  it('rotates refresh tokens and detects refresh-token reuse', async () => {
    const email = uniqueEmail();
    await registerUser(email);
    const login = await loginDesktop(email);

    const firstAccess = login.body.data.accessToken as string;
    const firstRefresh = login.body.data.refreshToken as string;

    const refresh = await request(app)
      .post(`${API}/auth/refresh`)
      .send({ refreshToken: firstRefresh, client: 'desktop' });

    expect(refresh.status).toBe(200);
    const secondAccess = refresh.body.data.accessToken as string;
    const secondRefresh = refresh.body.data.refreshToken as string;
    expect(secondRefresh).not.toBe(firstRefresh);

    // Access tokens are rotated in place; the old one stops working.
    const oldAccess = await request(app)
      .get(`${API}/auth/me`)
      .set('authorization', `Bearer ${firstAccess}`);
    expect(oldAccess.status).toBe(401);

    const newAccess = await request(app)
      .get(`${API}/auth/me`)
      .set('authorization', `Bearer ${secondAccess}`);
    expect(newAccess.status).toBe(200);

    // Reusing the old refresh token is treated as theft and revokes the session.
    const replay = await request(app)
      .post(`${API}/auth/refresh`)
      .send({ refreshToken: firstRefresh, client: 'desktop' });
    expect(replay.status).toBe(401);

    const afterReplay = await request(app)
      .get(`${API}/auth/me`)
      .set('authorization', `Bearer ${secondAccess}`);
    expect(afterReplay.status).toBe(401);
  });

  it('supports listing and revoking individual sessions', async () => {
    const email = uniqueEmail();
    await registerUser(email);
    const first = await loginDesktop(email);
    const second = await loginDesktop(email);

    const firstToken = first.body.data.accessToken as string;
    const secondToken = second.body.data.accessToken as string;

    const sessions = await request(app)
      .get(`${API}/auth/sessions`)
      .set('authorization', `Bearer ${firstToken}`);

    expect(sessions.status).toBe(200);
    expect(sessions.body.data).toHaveLength(2);
    const current = sessions.body.data.find((session: { current: boolean }) => session.current);
    expect(current).toBeTruthy();
    expect(current.id).toBeTruthy();

    const other = sessions.body.data.find((session: { current: boolean }) => !session.current);
    const revoke = await request(app)
      .delete(`${API}/auth/sessions/${other.id}`)
      .set('authorization', `Bearer ${firstToken}`);
    expect(revoke.status).toBe(204);

    const revokedSession = await request(app)
      .get(`${API}/auth/me`)
      .set('authorization', `Bearer ${secondToken}`);
    expect(revokedSession.status).toBe(401);
  });
});

describe('mobile (bearer) sessions', () => {
  it('issues bearer tokens without cookies and keeps the mobile label', async () => {
    const email = uniqueEmail();
    await registerUser(email);

    const login = await loginMobile(email);
    expect(login.status).toBe(200);
    expect(login.body.data.client).toBe('mobile');
    expect(login.body.data.accessToken).toBeTruthy();
    expect(login.body.data.refreshToken).toBeTruthy();
    expect(login.body.data.tokenType).toBe('Bearer');
    expect(login.headers['set-cookie']).toBeUndefined();
    expect(JSON.stringify(login.body)).not.toContain('passwordHash');

    const me = await request(app)
      .get(`${API}/auth/me`)
      .set('authorization', `Bearer ${login.body.data.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.session.transport).toBe('bearer');
  });

  it('restores a mobile session by rotating the refresh token', async () => {
    const email = uniqueEmail();
    await registerUser(email);
    const login = await loginMobile(email);

    const firstAccess = login.body.data.accessToken as string;
    const firstRefresh = login.body.data.refreshToken as string;

    const missingBodyToken = await request(app)
      .post(`${API}/auth/refresh`)
      .send({ client: 'mobile' });
    expect(missingBodyToken.status).toBe(401);
    expect(missingBodyToken.body.error.code).toBe('REFRESH_TOKEN_REQUIRED');

    const refresh = await request(app)
      .post(`${API}/auth/refresh`)
      .send({ refreshToken: firstRefresh, client: 'mobile' });
    expect(refresh.status).toBe(200);
    expect(refresh.body.data.client).toBe('mobile');
    expect(refresh.body.data.accessToken).toBeTruthy();
    expect(refresh.body.data.refreshToken).not.toBe(firstRefresh);
    expect(refresh.headers['set-cookie']).toBeUndefined();

    const oldAccess = await request(app)
      .get(`${API}/auth/me`)
      .set('authorization', `Bearer ${firstAccess}`);
    expect(oldAccess.status).toBe(401);

    const newAccess = await request(app)
      .get(`${API}/auth/me`)
      .set('authorization', `Bearer ${refresh.body.data.accessToken}`);
    expect(newAccess.status).toBe(200);
  });

  it('logs out and revokes the mobile session', async () => {
    const email = uniqueEmail();
    await registerUser(email);
    const login = await loginMobile(email);
    const accessToken = login.body.data.accessToken as string;

    const logout = await request(app)
      .post(`${API}/auth/logout`)
      .set('authorization', `Bearer ${accessToken}`)
      .send({});
    expect(logout.status).toBe(204);

    const me = await request(app)
      .get(`${API}/auth/me`)
      .set('authorization', `Bearer ${accessToken}`);
    expect(me.status).toBe(401);

    const stored = await Session.findOne({ where: { userId: login.body.data.user.id } });
    expect(stored?.revokedAt).toBeInstanceOf(Date);
  });

  it('does not grant time-session writes without registered device credentials', async () => {
    const owner = await createOwner(uniqueEmail('mobile-owner'), 'Mobile Owner Org');
    const login = await loginMobile(owner.email);
    const accessToken = login.body.data.accessToken as string;
    const orgId = owner.organization.id;

    // Reads already require only the bearer session and existing permissions.
    const current = await request(app)
      .get(`${API}/organizations/${orgId}/time-sessions/current`)
      .set('authorization', `Bearer ${accessToken}`);
    expect(current.status).toBe(200);
    expect(current.body.data.session).toBeNull();

    const noAgent = await request(app)
      .post(`${API}/organizations/${orgId}/time-sessions/start`)
      .set('authorization', `Bearer ${accessToken}`)
      .send({});
    expect(noAgent.status).toBe(401);
    expect(noAgent.body.error.code).toBe('AGENT_AUTH_REQUIRED');

    const invalidAgent = await request(app)
      .post(`${API}/organizations/${orgId}/time-sessions/start`)
      .set({
        authorization: `Bearer ${accessToken}`,
        'x-agent-id': '00000000-0000-4000-8000-000000000000',
        'x-agent-key': 'tna_this-is-not-a-real-key',
      })
      .send({});
    expect(invalidAgent.status).toBe(401);
    expect(invalidAgent.body.error.code).toBe('AGENT_CREDENTIALS_INVALID');

    // A registered mobile device still passes the existing agent gate.
    const agent = await registerAgent(
      { token: accessToken },
      orgId,
      { name: 'Mobile phone', platform: 'android', clientType: 'MOBILE' },
    );
    expect(agent.agent.clientType).toBe('MOBILE');

    const started = await request(app)
      .post(`${API}/organizations/${orgId}/time-sessions/start`)
      .set(agent.headers)
      .send({});
    expect(started.status).toBe(201);
  });

  it('keeps organization boundaries for mobile tokens', async () => {
    const owner = await createOwner(uniqueEmail('mobile-owner'), 'Mobile Org A');
    const otherOwner = await createOwner(uniqueEmail('owner'), 'Mobile Org B');
    const login = await loginMobile(owner.email);

    const response = await request(app)
      .get(`${API}/organizations/${otherOwner.organization.id}/time-sessions/current`)
      .set('authorization', `Bearer ${login.body.data.accessToken}`);
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ORGANIZATION_NOT_FOUND');
  });

  it('rejects unsupported client values', async () => {
    const email = uniqueEmail();
    await registerUser(email);

    const login = await request(app)
      .post(`${API}/auth/login`)
      .send({ email, password: PASSWORD, client: 'tablet' });
    expect(login.status).toBe(422);
    expect(login.body.error.code).toBe('VALIDATION_ERROR');
  });
});
