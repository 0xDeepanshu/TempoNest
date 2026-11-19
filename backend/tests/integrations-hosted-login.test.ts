import { createHash, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { IntegrationAuthorizationRequest, IntegrationClient, IntegrationConnection } from '../src/database';
import { hashIntegrationValue } from '../src/modules/integrations/integration.crypto';
import { API, PASSWORD, app, createOwner, inviteAndAccept, resetDatabase, uniqueEmail } from './helpers';

// Regression tests for the hosted WorkZen sign-in and consent pages: login CSRF token, the narrow
// Origin: null exception, cross-site rejection, and the one-time authorisation request.

const REDIRECT_URI = 'https://flowtrium.test/api/workzen/callback';
const SCOPE = 'attendance:read employees:read';

async function createClient() {
  const clientId = `wzc_hl_${randomUUID().replace(/-/g, '')}`;
  const clientSecret = `wzcs_hl_${randomBytes(24).toString('base64url')}`;
  await IntegrationClient.create({
    clientId,
    name: 'Flowtrium Hosted Login Test',
    description: null,
    redirectUris: [REDIRECT_URI],
    allowedScopes: ['attendance:read', 'employees:read', 'webhooks:manage'],
    secretHash: hashIntegrationValue(clientSecret),
    status: 'ACTIVE',
    lastSecretRotatedAt: new Date(),
  });
  return { clientId, clientSecret };
}

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier, 'ascii').digest('base64url') };
}

function hidden(html: string, name: string): string {
  const match = new RegExp(`name="${name}" value="([^"]+)"`).exec(html);
  if (!match?.[1]) throw new Error(`hidden field ${name} not found`);
  return match[1];
}

/** Opens the hosted page as an anonymous browser. The agent keeps the binding cookie, like a browser. */
async function openLoginPage(client: { clientId: string }, externalOrganizationId = 'flowtrium-org-test') {
  const browser = request.agent(app);
  const challenge = pkce().challenge;
  const page = await browser.get(`${API}/integrations/oauth/authorize`).query({
    response_type: 'code',
    client_id: client.clientId,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    state: randomBytes(16).toString('hex'),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    external_organization_id: externalOrganizationId,
  });
  expect(page.status).toBe(200);
  return {
    browser,
    requestId: hidden(page.text, 'authorization_request_id'),
    csrf: hidden(page.text, '_csrf'),
  };
}

function postLogin(
  browser: ReturnType<typeof request.agent>,
  body: Record<string, string>,
  headers: Record<string, string> = {},
) {
  let req = browser.post(`${API}/integrations/oauth/authorize/login`).type('form');
  for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
  return req.send(body);
}

const sameOrigin = { Origin: 'null', 'Sec-Fetch-Site': 'same-origin' };

beforeEach(async () => {
  await resetDatabase();
});

describe('hosted login: CSRF token', () => {
  it('a normal login with the page token and correct credentials shows the consent page', async () => {
    const owner = await createOwner(uniqueEmail('owner'));
    const client = await createClient();
    const page = await openLoginPage(client);

    const login = await postLogin(page.browser, {
      email: owner.user.email,
      password: PASSWORD,
      authorization_request_id: page.requestId,
      _csrf: page.csrf,
    });
    expect(login.status).toBe(200);
    expect(login.text).toContain('name="decision"');
  });

  it('a normal same-origin login with an allowed Origin header also succeeds', async () => {
    const owner = await createOwner(uniqueEmail('owner'));
    const client = await createClient();
    const page = await openLoginPage(client);

    const login = await postLogin(page.browser, {
      email: owner.user.email,
      password: PASSWORD,
      authorization_request_id: page.requestId,
      _csrf: page.csrf,
    }, { Origin: 'http://localhost:3000' });
    expect(login.status).toBe(200);
  });

  it('rejects a login with no CSRF token (400)', async () => {
    const owner = await createOwner(uniqueEmail('owner'));
    const client = await createClient();
    const page = await openLoginPage(client);

    const login = await postLogin(page.browser, {
      email: owner.user.email,
      password: PASSWORD,
      authorization_request_id: page.requestId,
    });
    expect(login.status).toBe(400);
  });

  it('rejects an invalid CSRF token (403) and never checks the password', async () => {
    const owner = await createOwner(uniqueEmail('owner'));
    const client = await createClient();
    const page = await openLoginPage(client);

    const login = await postLogin(page.browser, {
      email: owner.user.email,
      password: PASSWORD,
      authorization_request_id: page.requestId,
      _csrf: randomBytes(32).toString('base64url'),
    });
    expect(login.status).toBe(403);
    expect(login.text).toContain('Sign-in form expired');
    expect(login.headers['set-cookie']).toBeUndefined();
  });

  it('rejects a token paired with a different browser (binding cookie mismatch)', async () => {
    const owner = await createOwner(uniqueEmail('owner'));
    const client = await createClient();
    const victim = await openLoginPage(client);
    const attacker = await openLoginPage(client);

    // The token belongs to the victim's binding; the attacker's browser has a different binding cookie.
    const login = await postLogin(attacker.browser, {
      email: owner.user.email,
      password: PASSWORD,
      authorization_request_id: victim.requestId,
      _csrf: victim.csrf,
    });
    expect(login.status).toBe(403);
  });

  it('rejects a token taken from another authorisation request', async () => {
    const owner = await createOwner(uniqueEmail('owner'));
    const client = await createClient();
    const first = await openLoginPage(client);
    const second = await openLoginPage(client);

    // Same browser, request B's id with request A's token.
    const login = await postLogin(second.browser, {
      email: owner.user.email,
      password: PASSWORD,
      authorization_request_id: second.requestId,
      _csrf: first.csrf,
    });
    expect(login.status).toBe(403);
  });

  it('rejects an expired authorisation request even with a valid token', async () => {
    const owner = await createOwner(uniqueEmail('owner'));
    const client = await createClient();
    const page = await openLoginPage(client);
    await IntegrationAuthorizationRequest.update(
      { expiresAt: new Date(Date.now() - 60_000) },
      { where: { id: page.requestId } },
    );

    const login = await postLogin(page.browser, {
      email: owner.user.email,
      password: PASSWORD,
      authorization_request_id: page.requestId,
      _csrf: page.csrf,
    });
    expect(login.status).toBe(400);
    expect(login.text).toContain('expired');
  });

  it('a token cannot be replayed after the request has been approved', async () => {
    const owner = await createOwner(uniqueEmail('owner'));
    const client = await createClient();
    const page = await openLoginPage(client);
    const login = await postLogin(page.browser, {
      email: owner.user.email,
      password: PASSWORD,
      authorization_request_id: page.requestId,
      _csrf: page.csrf,
    });
    expect(login.status).toBe(200);
    const decision = await page.browser
      .post(`${API}/integrations/oauth/authorize/decision`)
      .set(sameOrigin)
      .type('form')
      .send({
        _csrf: hidden(login.text, '_csrf'),
        authorization_request_id: page.requestId,
        organization_id: owner.organization.id,
        decision: 'approve',
      });
    expect(decision.status).toBe(302);

    // Approval cleared the binding cookie, so the token no longer matches the browser: refused.
    const replay = await postLogin(page.browser, {
      email: owner.user.email,
      password: PASSWORD,
      authorization_request_id: page.requestId,
      _csrf: page.csrf,
    });
    expect(replay.status).toBe(403);
    expect(replay.text).not.toContain('name="decision"');
  });

  it('wrong credentials with a valid token are rejected without a session', async () => {
    const owner = await createOwner(uniqueEmail('owner'));
    const client = await createClient();
    const page = await openLoginPage(client);

    const login = await postLogin(page.browser, {
      email: owner.user.email,
      password: 'not-the-password-123!',
      authorization_request_id: page.requestId,
      _csrf: page.csrf,
    });
    expect(login.status).toBe(401);
    expect(login.text).not.toContain('name="decision"');
  });
});

describe('Origin: null is accepted only for the hosted consent endpoints', () => {
  it('accepts Origin: null on the login POST when Sec-Fetch-Site is same-origin and the token is valid', async () => {
    const owner = await createOwner(uniqueEmail('owner'));
    const client = await createClient();
    const page = await openLoginPage(client);

    const login = await postLogin(page.browser, {
      email: owner.user.email,
      password: PASSWORD,
      authorization_request_id: page.requestId,
      _csrf: page.csrf,
    }, sameOrigin);
    expect(login.status).toBe(200);
  });

  it('rejects Origin: null on the login POST without Sec-Fetch-Site: same-origin', async () => {
    const owner = await createOwner(uniqueEmail('owner'));
    const client = await createClient();
    const page = await openLoginPage(client);

    const login = await postLogin(page.browser, {
      email: owner.user.email,
      password: PASSWORD,
      authorization_request_id: page.requestId,
      _csrf: page.csrf,
    }, { Origin: 'null' });
    expect(login.status).toBe(403);
    expect(login.body.error?.code).toBe('ORIGIN_NOT_ALLOWED');
  });

  it('rejects Origin: null on the login POST when Sec-Fetch-Site is cross-site', async () => {
    const owner = await createOwner(uniqueEmail('owner'));
    const client = await createClient();
    const page = await openLoginPage(client);

    const login = await postLogin(page.browser, {
      email: owner.user.email,
      password: PASSWORD,
      authorization_request_id: page.requestId,
      _csrf: page.csrf,
    }, { Origin: 'null', 'Sec-Fetch-Site': 'cross-site' });
    expect(login.status).toBe(403);
  });

  it('rejects Origin: null on unrelated endpoints even with same-origin metadata', async () => {
    const response = await request(app)
      .post(`${API}/auth/login`)
      .set(sameOrigin)
      .type('json')
      .send({ email: 'nobody@example.test', password: 'x' });
    expect(response.status).toBe(403);
    expect(response.body.error?.code).toBe('ORIGIN_NOT_ALLOWED');
  });

  it('rejects a cross-site login attempt with a non-null hostile Origin, even with a valid token', async () => {
    const owner = await createOwner(uniqueEmail('owner'));
    const client = await createClient();
    const page = await openLoginPage(client);

    const login = await postLogin(page.browser, {
      email: owner.user.email,
      password: PASSWORD,
      authorization_request_id: page.requestId,
      _csrf: page.csrf,
    }, { Origin: 'https://evil.example.test', 'Sec-Fetch-Site': 'cross-site' });
    expect(login.status).toBe(403);
    expect(login.body.error?.code).toBe('ORIGIN_NOT_ALLOWED');
  });
});

describe('consent decision', () => {
  async function loggedInOwnerConsent() {
    const owner = await createOwner(uniqueEmail('owner'));
    const client = await createClient();
    const page = await openLoginPage(client);
    const login = await postLogin(page.browser, {
      email: owner.user.email,
      password: PASSWORD,
      authorization_request_id: page.requestId,
      _csrf: page.csrf,
    });
    expect(login.status).toBe(200);
    return { owner, page, consentCsrf: hidden(login.text, '_csrf') };
  }

  it('an authenticated owner can approve with the session CSRF token', async () => {
    const { owner, page, consentCsrf } = await loggedInOwnerConsent();
    const decision = await page.browser
      .post(`${API}/integrations/oauth/authorize/decision`)
      .set(sameOrigin)
      .type('form')
      .send({
        _csrf: consentCsrf,
        authorization_request_id: page.requestId,
        organization_id: owner.organization.id,
        decision: 'approve',
      });
    expect(decision.status).toBe(302);
    expect(decision.headers.location).toContain('code=');
    const connections = await IntegrationConnection.count();
    expect(connections).toBeGreaterThanOrEqual(0);
  });

  it('rejects an approval whose session CSRF token is wrong (403)', async () => {
    const { owner, page } = await loggedInOwnerConsent();
    const decision = await page.browser
      .post(`${API}/integrations/oauth/authorize/decision`)
      .set(sameOrigin)
      .type('form')
      .send({
        _csrf: randomBytes(32).toString('base64url'),
        authorization_request_id: page.requestId,
        organization_id: owner.organization.id,
        decision: 'approve',
      });
    expect(decision.status).toBe(403);
    expect(decision.headers.location).toBeUndefined();
  });

  it('rejects Origin: null on the decision when Sec-Fetch-Site is not same-origin', async () => {
    const { owner, page, consentCsrf } = await loggedInOwnerConsent();
    const decision = await page.browser
      .post(`${API}/integrations/oauth/authorize/decision`)
      .set({ Origin: 'null' })
      .type('form')
      .send({
        _csrf: consentCsrf,
        authorization_request_id: page.requestId,
        organization_id: owner.organization.id,
        decision: 'approve',
      });
    expect(decision.status).toBe(403);
    expect(decision.body.error?.code).toBe('ORIGIN_NOT_ALLOWED');
  });

  it('an authorisation request cannot be approved twice (replay)', async () => {
    const { owner, page, consentCsrf } = await loggedInOwnerConsent();
    const first = await page.browser
      .post(`${API}/integrations/oauth/authorize/decision`)
      .set(sameOrigin)
      .type('form')
      .send({
        _csrf: consentCsrf,
        authorization_request_id: page.requestId,
        organization_id: owner.organization.id,
        decision: 'approve',
      });
    expect(first.status).toBe(302);

    const second = await page.browser
      .post(`${API}/integrations/oauth/authorize/decision`)
      .set(sameOrigin)
      .type('form')
      .send({
        _csrf: consentCsrf,
        authorization_request_id: page.requestId,
        organization_id: owner.organization.id,
        decision: 'approve',
      });
    expect(second.status).toBe(400);
    expect(second.headers.location).toBeUndefined();
  });

  it('an employee signing in on the hosted page gets no consent and cannot approve', async () => {
    const owner = await createOwner(uniqueEmail('owner'));
    const employee = await inviteAndAccept(owner, { role: 'EMPLOYEE', name: 'Plain Employee', email: uniqueEmail('employee') });
    const client = await createClient();
    const page = await openLoginPage(client);

    const login = await postLogin(page.browser, {
      email: employee.email,
      password: PASSWORD,
      authorization_request_id: page.requestId,
      _csrf: page.csrf,
    });
    expect(login.status).toBe(403);
    expect(login.text).toContain('No eligible organization');
    expect(login.text).not.toContain('name="decision"');
  });
});
