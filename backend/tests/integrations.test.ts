import { createHash, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IntegrationAuthorizationCode,
  IntegrationAuthorizationRequest,
  IntegrationClient,
  IntegrationConnection,
  IntegrationCredential,
  IntegrationEmployeeMapping,
  IntegrationWebhookDelivery,
  IntegrationWebhookEvent,
  IntegrationWebhookSubscription,
} from '../src/database';
import { hashIntegrationValue, signWebhookPayload } from '../src/modules/integrations/integration.crypto';
import {
  dispatchPendingWebhooks,
  publishIntegrationEvent,
} from '../src/modules/integrations/integration.webhook.service';
import {
  WebhookDestinationError,
  webhookTransport,
} from '../src/modules/integrations/integration.webhookTransport';
import {
  API,
  app,
  createOwner,
  desktopAuth,
  inviteAndAccept,
  loginBrowser,
  registerAgent,
  resetDatabase,
  uniqueEmail,
} from './helpers';

const REDIRECT_URI = 'https://flowtrium.test/api/workzen/callback';
const ALL_SCOPES = ['attendance:read', 'employees:read', 'webhooks:manage'];

type TestClient = {
  clientId: string;
  clientSecret: string;
  redirectUris: string[];
  allowedScopes: string[];
};

async function createTestClient(options: {
  redirectUris?: string[];
  allowedScopes?: string[];
} = {}): Promise<TestClient> {
  const clientId = `wzc_test_${randomUUID().replace(/-/g, '')}`;
  const clientSecret = `wzcs_test_${randomBytes(24).toString('base64url')}`;
  const redirectUris = options.redirectUris ?? [REDIRECT_URI];
  const allowedScopes = options.allowedScopes ?? ALL_SCOPES;

  await IntegrationClient.create({
    clientId,
    name: 'Flowtrium Test Client',
    description: null,
    redirectUris,
    allowedScopes,
    secretHash: hashIntegrationValue(clientSecret),
    status: 'ACTIVE',
    createdByUserId: null,
    lastSecretRotatedAt: null,
  });

  return { clientId, clientSecret, redirectUris, allowedScopes };
}

async function createTeam(organizationName = 'Integration Test Org') {
  const owner = await createOwner(uniqueEmail('owner'), organizationName);
  const employee = await inviteAndAccept(owner, {
    role: 'EMPLOYEE',
    name: 'Mapped Employee',
    email: uniqueEmail('employee'),
  });
  const employeeAuth = await desktopAuth(employee.email);
  const agent = await registerAgent(employeeAuth, owner.organization.id, {
    name: 'Integration Employee Desktop',
  });
  return { owner, employee, employeeAuth, agent, orgId: owner.organization.id };
}

function pkcePair() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url');
  return { verifier, challenge };
}

function inputValue(html: string, name: string): string {
  const match = new RegExp(`name="${name}" value="([^"]+)"`).exec(html);
  if (!match?.[1]) throw new Error(`Could not find input ${name} in hosted page`);
  return match[1];
}

async function startAuthorization(options: {
  owner: Awaited<ReturnType<typeof createOwner>>;
  client: TestClient;
  scopes?: string;
  externalOrganizationId?: string;
  redirectUri?: string;
  state?: string;
  codeChallenge?: string;
}) {
  const state = options.state ?? randomBytes(16).toString('hex');
  const response = await options.owner.agent
    .get(`${API}/integrations/oauth/authorize`)
    .query({
      response_type: 'code',
      client_id: options.client.clientId,
      redirect_uri: options.redirectUri ?? REDIRECT_URI,
      scope: options.scopes ?? ALL_SCOPES.join(' '),
      state,
      code_challenge: options.codeChallenge ?? pkcePair().challenge,
      code_challenge_method: 'S256',
      external_organization_id: options.externalOrganizationId ?? 'flowtrium-org-test',
    });
  return { response, state };
}

async function approveAuthorization(options: {
  owner: Awaited<ReturnType<typeof createOwner>>;
  client: TestClient;
  scopes?: string;
  externalOrganizationId?: string;
  redirectUri?: string;
  codeChallenge: string;
  requestId: string;
}) {
  return options.owner.agent
    .post(`${API}/integrations/oauth/authorize/decision`)
    .type('form')
    .send({
      _csrf: options.owner.csrf,
      authorization_request_id: options.requestId,
      organization_id: options.owner.organization.id,
      decision: 'approve',
    });
}

function exchangeToken(body: Record<string, unknown>) {
  return request(app).post(`${API}/integrations/oauth/token`).send(body);
}

async function connectOrganization(options: {
  owner: Awaited<ReturnType<typeof createOwner>>;
  client: TestClient;
  scopes?: string[];
  externalOrganizationId?: string;
  redirectUri?: string;
}) {
  const scopes = options.scopes ?? ALL_SCOPES;
  const externalOrganizationId = options.externalOrganizationId ?? 'flowtrium-org-test';
  const redirectUri = options.redirectUri ?? REDIRECT_URI;
  const pkce = pkcePair();

  const { response } = await startAuthorization({
    owner: options.owner,
    client: options.client,
    scopes: scopes.join(' '),
    externalOrganizationId,
    redirectUri,
    codeChallenge: pkce.challenge,
  });
  expect(response.status).toBe(200);
  const requestId = inputValue(response.text, 'authorization_request_id');

  const decision = await approveAuthorization({
    owner: options.owner,
    client: options.client,
    codeChallenge: pkce.challenge,
    requestId,
  });
  expect(decision.status).toBe(302);
  const location = new URL(decision.headers.location as string);
  const code = location.searchParams.get('code');
  expect(code).toBeTruthy();

  const token = await exchangeToken({
    grant_type: 'authorization_code',
    client_id: options.client.clientId,
    client_secret: options.client.clientSecret,
    code,
    redirect_uri: redirectUri,
    code_verifier: pkce.verifier,
    external_organization_id: externalOrganizationId,
  });
  expect(token.status).toBe(200);

  return {
    accessToken: token.body.access_token as string,
    refreshToken: token.body.refresh_token as string,
    connectionId: token.body.connection.id as string,
    organizationId: options.owner.organization.id,
    code: code as string,
    requestId,
    pkce,
    redirectUri,
    externalOrganizationId,
  };
}

function integrationGet(token: string, path: string, query: Record<string, string | number> = {}) {
  return request(app)
    .get(`${API}/integration/v1${path}`)
    .set('Authorization', `Bearer ${token}`)
    .query(query);
}

function integrationPost(token: string, path: string, body: unknown) {
  return request(app)
    .post(`${API}/integration/v1${path}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body as object);
}

function matchEmployee(
  token: string,
  employee: { externalEmployeeId: string; email: string; emailVerified: boolean; displayName?: string },
) {
  return integrationPost(token, '/employees/match', { employees: [employee] });
}

async function linkMapping(options: {
  owner: Awaited<ReturnType<typeof createOwner>>;
  connectionId: string;
  organizationId: string;
  externalEmployeeId: string;
  workzenUserId: string;
}) {
  const list = await options.owner.agent
    .get(
      `${API}/organizations/${options.organizationId}/integrations/connections/${options.connectionId}/mappings`,
    )
    .set('x-csrf-token', options.owner.csrf);
  expect(list.status).toBe(200);
  const mapping = list.body.data.find(
    (row: { externalEmployeeId: string }) =>
      row.externalEmployeeId === options.externalEmployeeId,
  );
  expect(mapping).toBeTruthy();

  const linked = await options.owner.agent
    .post(
      `${API}/organizations/${options.organizationId}/integrations/connections/${options.connectionId}/mappings/${mapping.id}/resolve`,
    )
    .set('x-csrf-token', options.owner.csrf)
    .send({ action: 'LINK', workzenUserId: options.workzenUserId });
  expect(linked.status).toBe(200);
  expect(linked.body.data).toMatchObject({ status: 'ACTIVE', matchMethod: 'MANUAL' });
  return linked.body.data;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

beforeEach(async () => {
  await resetDatabase();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('integration OAuth authorization', () => {
  it('renders the hosted sign-in page for anonymous visitors and rejects unauthenticated data access', async () => {
    const client = await createTestClient();
    const { challenge } = pkcePair();

    const page = await request(app)
      .get(`${API}/integrations/oauth/authorize`)
      .query({
        response_type: 'code',
        client_id: client.clientId,
        redirect_uri: REDIRECT_URI,
        scope: 'attendance:read',
        state: randomBytes(16).toString('hex'),
        code_challenge: challenge,
        code_challenge_method: 'S256',
        external_organization_id: 'flowtrium-org-test',
      });
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.text).toContain('authorize/login');

    const anonymousDecision = await request(app)
      .post(`${API}/integrations/oauth/authorize/decision`)
      .type('form')
      .send({
        authorization_request_id: randomUUID(),
        organization_id: randomUUID(),
        decision: 'approve',
      });
    expect(anonymousDecision.status).toBe(400);
    expect(anonymousDecision.text).toContain('session has expired');

    const missingToken = await request(app).get(`${API}/integration/v1/attendance/status`).query({
      externalEmployeeId: 'ext-1',
    });
    expect(missingToken.status).toBe(401);
    expect(missingToken.body.error.code).toBe('INTEGRATION_TOKEN_REQUIRED');

    const badToken = await request(app)
      .get(`${API}/integration/v1/attendance/status`)
      .set('Authorization', 'Bearer not-a-real-token')
      .query({ externalEmployeeId: 'ext-1' });
    expect(badToken.status).toBe(401);
    expect(badToken.body.error.code).toBe('INTEGRATION_TOKEN_INVALID');
  });

  it('denies authorization to a member without integration:manage and blocks management routes', async () => {
    const { owner, employee } = await createTeam();
    const client = await createTestClient();
    const { challenge } = pkcePair();

    const employeePage = await employee.agent
      .get(`${API}/integrations/oauth/authorize`)
      .query({
        response_type: 'code',
        client_id: client.clientId,
        redirect_uri: REDIRECT_URI,
        scope: 'attendance:read',
        state: randomBytes(16).toString('hex'),
        code_challenge: challenge,
        code_challenge_method: 'S256',
        external_organization_id: 'flowtrium-org-test',
      });
    expect(employeePage.status).toBe(403);
    expect(employeePage.text).toContain('No eligible organization');

    const management = await employee.agent
      .get(`${API}/organizations/${owner.organization.id}/integrations/connections`)
      .set('x-csrf-token', employee.csrf);
    expect(management.status).toBe(403);

    const ownerManagement = await owner.agent
      .get(`${API}/organizations/${owner.organization.id}/integrations/connections`)
      .set('x-csrf-token', owner.csrf);
    expect(ownerManagement.status).toBe(200);
  });

  it('completes the authorization-code + PKCE flow and returns scoped tokens', async () => {
    const { owner } = await createTeam();
    const client = await createTestClient();

    const connection = await connectOrganization({ owner, client });
    expect(connection.accessToken).toMatch(/^wziat_/);
    expect(connection.refreshToken).toMatch(/^wzirt_/);

    const record = await IntegrationConnection.findByPk(connection.connectionId);
    expect(record?.status).toBe('ACTIVE');
    expect(record?.organizationId).toBe(owner.organization.id);
    expect(record?.externalOrganizationId).toBe('flowtrium-org-test');
    expect(record?.scopes).toEqual(ALL_SCOPES);

    const credential = await IntegrationCredential.findOne({
      where: { connectionId: connection.connectionId },
    });
    expect(credential?.accessTokenHash).not.toBe(connection.accessToken);
    expect(credential?.refreshTokenHash).not.toBe(connection.refreshToken);

    const employees = await integrationGet(connection.accessToken, '/employees');
    expect(employees.status).toBe(200);
    expect(employees.body.data).toEqual([]);
  });

  it('rejects an unregistered redirect URI without creating an authorization request', async () => {
    const { owner } = await createTeam();
    const client = await createTestClient();
    const { challenge } = pkcePair();

    const response = await owner.agent
      .get(`${API}/integrations/oauth/authorize`)
      .query({
        response_type: 'code',
        client_id: client.clientId,
        redirect_uri: 'https://evil.example/callback',
        scope: 'attendance:read',
        state: randomBytes(16).toString('hex'),
        code_challenge: challenge,
        code_challenge_method: 'S256',
        external_organization_id: 'flowtrium-org-test',
      });

    expect(response.status).toBe(400);
    expect(response.text).toContain('redirect_uri is not registered');
    expect(await IntegrationAuthorizationRequest.count()).toBe(0);
  });

  it('rejects a short state and a replayed state', async () => {
    const { owner } = await createTeam();
    const client = await createTestClient();
    const { challenge } = pkcePair();

    const shortState = await owner.agent
      .get(`${API}/integrations/oauth/authorize`)
      .query({
        response_type: 'code',
        client_id: client.clientId,
        redirect_uri: REDIRECT_URI,
        scope: 'attendance:read',
        state: 'short',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        external_organization_id: 'flowtrium-org-test',
      });
    expect(shortState.status).toBe(400);
    expect(shortState.text).toContain('Invalid authorization request');

    const state = randomBytes(16).toString('hex');
    const first = await startAuthorization({ owner, client, state });
    expect(first.response.status).toBe(200);

    const replayed = await startAuthorization({ owner, client, state });
    expect(replayed.response.status).toBe(400);
    expect(replayed.response.text).toContain('state is already in use');
  });

  it('rejects approval from a different browser (binding cookie mismatch)', async () => {
    const { owner } = await createTeam();
    const client = await createTestClient();
    const { challenge } = pkcePair();
    const state = randomBytes(16).toString('hex');

    const started = await startAuthorization({ owner, client, state, codeChallenge: challenge });
    const requestId = inputValue(started.response.text, 'authorization_request_id');

    const otherBrowser = await loginBrowser(owner.email);
    const decision = await otherBrowser.agent
      .post(`${API}/integrations/oauth/authorize/decision`)
      .type('form')
      .send({
        _csrf: otherBrowser.csrf,
        authorization_request_id: requestId,
        organization_id: owner.organization.id,
        decision: 'approve',
      });

    expect(decision.status).toBe(400);
    expect(decision.text).toContain('not started in this browser');
    expect(await IntegrationAuthorizationCode.count()).toBe(0);
  });

  it('rejects an expired authorization request', async () => {
    const { owner } = await createTeam();
    const client = await createTestClient();
    const { challenge } = pkcePair();

    const started = await startAuthorization({ owner, client, codeChallenge: challenge });
    const requestId = inputValue(started.response.text, 'authorization_request_id');
    await IntegrationAuthorizationRequest.update(
      { expiresAt: new Date(Date.now() - 60_000) },
      { where: { id: requestId } },
    );

    const decision = await approveAuthorization({
      owner,
      client,
      codeChallenge: challenge,
      requestId,
    });
    expect(decision.status).toBe(400);
    expect(decision.text).toContain('expired');
    expect(await IntegrationAuthorizationCode.count()).toBe(0);
  });

  it('rejects a wrong PKCE verifier and bad client credentials', async () => {
    const { owner } = await createTeam();
    const client = await createTestClient();
    const connection = await connectOrganization({ owner, client });

    const wrongVerifier = await exchangeToken({
      grant_type: 'authorization_code',
      client_id: client.clientId,
      client_secret: client.clientSecret,
      code: connection.code,
      redirect_uri: connection.redirectUri,
      code_verifier: randomBytes(32).toString('base64url'),
      external_organization_id: connection.externalOrganizationId,
    });
    expect(wrongVerifier.status).toBe(400);
    expect(wrongVerifier.body.error.code).toBe('INVALID_GRANT');

    const wrongSecret = await exchangeToken({
      grant_type: 'refresh_token',
      client_id: client.clientId,
      client_secret: `wzcs_wrong_${randomBytes(16).toString('base64url')}`,
      refresh_token: connection.refreshToken,
    });
    expect(wrongSecret.status).toBe(401);
    expect(wrongSecret.body.error.code).toBe('INVALID_CLIENT');
  });

  it('rejects an expired authorization code', async () => {
    const { owner } = await createTeam();
    const client = await createTestClient();
    const redirectUri = REDIRECT_URI;
    const pkce = pkcePair();

    const started = await startAuthorization({
      owner,
      client,
      redirectUri,
      codeChallenge: pkce.challenge,
    });
    const requestId = inputValue(started.response.text, 'authorization_request_id');
    const decision = await approveAuthorization({
      owner,
      client,
      codeChallenge: pkce.challenge,
      requestId,
    });
    const code = new URL(decision.headers.location as string).searchParams.get('code') as string;

    await IntegrationAuthorizationCode.update(
      { expiresAt: new Date(Date.now() - 1_000) },
      { where: { codeHash: hashIntegrationValue(code) } },
    );

    const exchange = await exchangeToken({
      grant_type: 'authorization_code',
      client_id: client.clientId,
      client_secret: client.clientSecret,
      code,
      redirect_uri: redirectUri,
      code_verifier: pkce.verifier,
      external_organization_id: 'flowtrium-org-test',
    });
    expect(exchange.status).toBe(400);
    expect(exchange.body.error.message).toContain('expired');
  });

  it('rejects a replayed authorization code and revokes the issued credential', async () => {
    const { owner } = await createTeam();
    const client = await createTestClient();
    const connection = await connectOrganization({ owner, client });

    const replay = await exchangeToken({
      grant_type: 'authorization_code',
      client_id: client.clientId,
      client_secret: client.clientSecret,
      code: connection.code,
      redirect_uri: connection.redirectUri,
      code_verifier: connection.pkce.verifier,
      external_organization_id: connection.externalOrganizationId,
    });
    expect(replay.status).toBe(400);
    expect(replay.body.error.message).toContain('already been used');

    const credential = await IntegrationCredential.findOne({
      where: { connectionId: connection.connectionId },
    });
    expect(credential?.revokedAt).not.toBeNull();
    expect(credential?.revokedReason).toBe('AUTHORIZATION_CODE_REPLAYED');

    const data = await integrationGet(connection.accessToken, '/employees');
    expect(data.status).toBe(401);
  });

  it('rejects an external_organization_id that differs from the approved request', async () => {
    const { owner } = await createTeam();
    const client = await createTestClient();
    const redirectUri = REDIRECT_URI;
    const pkce = pkcePair();

    const started = await startAuthorization({
      owner,
      client,
      redirectUri,
      externalOrganizationId: 'flowtrium-org-a',
      codeChallenge: pkce.challenge,
    });
    const requestId = inputValue(started.response.text, 'authorization_request_id');
    const decision = await approveAuthorization({
      owner,
      client,
      externalOrganizationId: 'flowtrium-org-a',
      codeChallenge: pkce.challenge,
      requestId,
    });
    const code = new URL(decision.headers.location as string).searchParams.get('code') as string;

    const mismatch = await exchangeToken({
      grant_type: 'authorization_code',
      client_id: client.clientId,
      client_secret: client.clientSecret,
      code,
      redirect_uri: redirectUri,
      code_verifier: pkce.verifier,
      external_organization_id: 'flowtrium-org-b',
    });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error.message).toContain('does not match');

    const correct = await exchangeToken({
      grant_type: 'authorization_code',
      client_id: client.clientId,
      client_secret: client.clientSecret,
      code,
      redirect_uri: redirectUri,
      code_verifier: pkce.verifier,
      external_organization_id: 'flowtrium-org-a',
    });
    expect(correct.status).toBe(200);
    expect(correct.body.connection.external_organization_id).toBe('flowtrium-org-a');
  });
});

describe('integration token lifecycle', () => {
  it('rejects expired access tokens', async () => {
    const { owner } = await createTeam();
    const client = await createTestClient();
    const connection = await connectOrganization({ owner, client });

    await IntegrationCredential.update(
      { accessExpiresAt: new Date(Date.now() - 60_000) },
      { where: { connectionId: connection.connectionId } },
    );

    const response = await integrationGet(connection.accessToken, '/employees');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INTEGRATION_TOKEN_EXPIRED');
  });

  it('rotates refresh tokens and revokes the family when a rotated token is reused', async () => {
    const { owner } = await createTeam();
    const client = await createTestClient();
    const connection = await connectOrganization({ owner, client });

    const rotated = await exchangeToken({
      grant_type: 'refresh_token',
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: connection.refreshToken,
    });
    expect(rotated.status).toBe(200);
    expect(rotated.body.access_token).not.toBe(connection.accessToken);
    expect(rotated.body.refresh_token).not.toBe(connection.refreshToken);

    const oldAccess = await integrationGet(connection.accessToken, '/employees');
    expect(oldAccess.status).toBe(401);

    const reuse = await exchangeToken({
      grant_type: 'refresh_token',
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: connection.refreshToken,
    });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('REFRESH_TOKEN_REUSED');

    const rotatedAccess = await integrationGet(rotated.body.access_token as string, '/employees');
    expect(rotatedAccess.status).toBe(401);

    const credential = await IntegrationCredential.findOne({
      where: { connectionId: connection.connectionId },
    });
    expect(credential?.revokedReason).toBe('REFRESH_TOKEN_REUSE');
  });

  it('revokes a token through the revocation endpoint', async () => {
    const { owner } = await createTeam();
    const client = await createTestClient();
    const connection = await connectOrganization({ owner, client });

    const revoke = await request(app).post(`${API}/integrations/oauth/revoke`).send({
      token: connection.accessToken,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      token_type_hint: 'access_token',
    });
    expect(revoke.status).toBe(200);
    expect(revoke.body.data.revoked).toBe(true);

    const response = await integrationGet(connection.accessToken, '/employees');
    expect(response.status).toBe(401);
  });

  it('revoking a token closes the connection: the record is kept, API access and webhooks stop, and a repeat revoke changes nothing', async () => {
    const { owner } = await createTeam();
    const client = await createTestClient();
    const connection = await connectOrganization({ owner, client });
    const subscription = await integrationPost(connection.accessToken, '/webhooks', {
      url: 'https://flowtrium.test/api/workzen/webhooks',
      eventTypes: ['attendance.started'],
    });
    expect(subscription.status).toBe(201);

    const revokeWith = (token: string) => request(app).post(`${API}/integrations/oauth/revoke`).send({
      token,
      client_id: client.clientId,
      client_secret: client.clientSecret,
    });
    const first = await revokeWith(connection.accessToken);
    expect(first.status).toBe(200);

    const row = await IntegrationConnection.findByPk(connection.connectionId);
    expect(row?.status).toBe('REVOKED');
    expect(row?.revokedAt).toBeInstanceOf(Date);
    const revokedAt = row!.revokedAt!.getTime();

    const sub = await IntegrationWebhookSubscription.findByPk(subscription.body.data.subscription.id);
    expect(sub?.status).toBe('DISABLED');
    expect((await integrationGet(connection.accessToken, '/employees')).status).toBe(401);

    // Revoking again is safe and keeps the first timestamp and audit entry.
    const second = await revokeWith(connection.accessToken);
    expect(second.status).toBe(200);
    const again = await IntegrationConnection.findByPk(connection.connectionId);
    expect(again?.status).toBe('REVOKED');
    expect(again?.revokedAt?.getTime()).toBe(revokedAt);
  });

  it('closes the connection when only the refresh token is revoked, which is how a rejected binding is cleaned up', async () => {
    const { owner } = await createTeam();
    const client = await createTestClient();
    const connection = await connectOrganization({ owner, client });

    const revoke = await request(app).post(`${API}/integrations/oauth/revoke`).send({
      token: connection.refreshToken,
      client_id: client.clientId,
      client_secret: client.clientSecret,
    });
    expect(revoke.status).toBe(200);

    const row = await IntegrationConnection.findByPk(connection.connectionId);
    expect(row?.status).toBe('REVOKED');
    const refresh = await exchangeToken({
      grant_type: 'refresh_token',
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: connection.refreshToken,
    });
    expect(refresh.status).toBe(400);
  });

  it('refresh token reuse closes the connection, so no credential stays active', async () => {
    const { owner } = await createTeam();
    const client = await createTestClient();
    const connection = await connectOrganization({ owner, client });
    const rotated = await exchangeToken({
      grant_type: 'refresh_token',
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: connection.refreshToken,
    });
    expect(rotated.status).toBe(200);

    const reuse = await exchangeToken({
      grant_type: 'refresh_token',
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: connection.refreshToken,
    });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('REFRESH_TOKEN_REUSED');

    const row = await IntegrationConnection.findByPk(connection.connectionId);
    expect(row?.status).toBe('REVOKED');
    const access = await integrationGet(rotated.body.access_token as string, '/employees');
    expect(access.status).toBe(401);
  });

  it('a revoked connection is reactivated in place when the same organisation authorises again', async () => {
    const { owner } = await createTeam();
    const client = await createTestClient();
    const connection = await connectOrganization({ owner, client });
    await request(app).post(`${API}/integrations/oauth/revoke`).send({
      token: connection.accessToken,
      client_id: client.clientId,
      client_secret: client.clientSecret,
    });

    const reconnected = await connectOrganization({ owner, client });
    expect(reconnected.connectionId).toBe(connection.connectionId);
    const row = await IntegrationConnection.findByPk(connection.connectionId);
    expect(row?.status).toBe('ACTIVE');
    expect(row?.revokedAt).toBeNull();
  });

  it('revokes the whole credential family when a rotated-out refresh token is revoked', async () => {
    const { owner } = await createTeam();
    const client = await createTestClient();
    const connection = await connectOrganization({ owner, client });

    const rotated = await exchangeToken({
      grant_type: 'refresh_token',
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: connection.refreshToken,
    });
    expect(rotated.status).toBe(200);

    // The original refresh token was rotated out; it still identifies the
    // credential family and must not be silently ignored.
    const revoke = await request(app).post(`${API}/integrations/oauth/revoke`).send({
      token: connection.refreshToken,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      token_type_hint: 'refresh_token',
    });
    expect(revoke.status).toBe(200);
    expect(revoke.body.data.revoked).toBe(true);

    const revokedAccess = await integrationGet(rotated.body.access_token as string, '/employees');
    expect(revokedAccess.status).toBe(401);
  });

  it('enforces granted scopes on the data API', async () => {
    const { owner } = await createTeam();
    const client = await createTestClient({ allowedScopes: ['attendance:read'] });
    const connection = await connectOrganization({ owner, client, scopes: ['attendance:read'] });

    const employees = await integrationGet(connection.accessToken, '/employees');
    expect(employees.status).toBe(403);
    expect(employees.body.error.code).toBe('INTEGRATION_SCOPE_DENIED');

    const webhooks = await integrationGet(connection.accessToken, '/webhooks');
    expect(webhooks.status).toBe(403);
    expect(webhooks.body.error.code).toBe('INTEGRATION_SCOPE_DENIED');
  });

  it('refuses scopes the client is not provisioned for', async () => {
    const { owner } = await createTeam();
    const client = await createTestClient({ allowedScopes: ['attendance:read'] });
    const { challenge } = pkcePair();

    const response = await owner.agent
      .get(`${API}/integrations/oauth/authorize`)
      .query({
        response_type: 'code',
        client_id: client.clientId,
        redirect_uri: REDIRECT_URI,
        scope: 'attendance:read employees:read',
        state: randomBytes(16).toString('hex'),
        code_challenge: challenge,
        code_challenge_method: 'S256',
        external_organization_id: 'flowtrium-org-test',
      });

    expect(response.status).toBe(400);
    expect(response.text).toContain('not allowed to request');
    expect(await IntegrationAuthorizationRequest.count()).toBe(0);
  });
});

describe('integration employee matching', () => {
  it('never activates a partner match without owner approval, even when the partner marks the email verified', async () => {
    const { owner, employee } = await createTeam();
    const client = await createTestClient();
    const connection = await connectOrganization({ owner, client });

    const suggested = await matchEmployee(connection.accessToken, {
      externalEmployeeId: 'flowtrium-employee-1',
      email: employee.email,
      emailVerified: true,
      displayName: employee.name,
    });
    expect(suggested.status).toBe(200);
    expect(suggested.body.data[0]).toMatchObject({
      externalEmployeeId: 'flowtrium-employee-1',
      status: 'PENDING',
      conflictReason: 'MANUAL_APPROVAL_REQUIRED',
      matchMethod: null,
      employee: null,
    });

    // The partner's own "not verified" assertion is equally unable to activate.
    const partnerUnverified = await matchEmployee(connection.accessToken, {
      externalEmployeeId: 'flowtrium-employee-2',
      email: employee.email,
      emailVerified: false,
    });
    expect(partnerUnverified.body.data[0]).toMatchObject({
      status: 'PENDING',
      conflictReason: 'MANUAL_APPROVAL_REQUIRED',
      employee: null,
    });

    const unknown = await matchEmployee(connection.accessToken, {
      externalEmployeeId: 'flowtrium-unknown-1',
      email: 'nobody@example.com',
      emailVerified: true,
    });
    expect(unknown.body.data[0]).toMatchObject({
      status: 'PENDING',
      conflictReason: 'EMPLOYEE_NOT_FOUND',
    });

    const linked = await linkMapping({
      owner,
      connectionId: connection.connectionId,
      organizationId: connection.organizationId,
      externalEmployeeId: 'flowtrium-employee-1',
      workzenUserId: employee.user.id,
    });
    expect(linked.employee.email).toBe(employee.email);

    const stored = await IntegrationEmployeeMapping.findOne({
      where: { connectionId: connection.connectionId, externalEmployeeId: 'flowtrium-employee-1' },
    });
    expect(stored?.resolvedByUserId).toBe(owner.user.id);
  });

  it('reports a conflict when a WorkZen employee is already mapped under another external id', async () => {
    const { owner, employee } = await createTeam();
    const client = await createTestClient();
    const connection = await connectOrganization({ owner, client });

    const first = await matchEmployee(connection.accessToken, {
      externalEmployeeId: 'flowtrium-employee-1',
      email: employee.email,
      emailVerified: true,
    });
    expect(first.body.data[0].status).toBe('PENDING');

    await linkMapping({
      owner,
      connectionId: connection.connectionId,
      organizationId: connection.organizationId,
      externalEmployeeId: 'flowtrium-employee-1',
      workzenUserId: employee.user.id,
    });

    const second = await matchEmployee(connection.accessToken, {
      externalEmployeeId: 'flowtrium-employee-2',
      email: employee.email,
      emailVerified: true,
    });
    expect(second.body.data[0]).toMatchObject({
      status: 'CONFLICT',
      conflictReason: 'ALREADY_MAPPED',
      employee: null,
    });
  });

  it('keeps organizations isolated for management and matching', async () => {
    const { owner, employee } = await createTeam('Integration Org A');
    const other = await createTeam('Integration Org B');
    const client = await createTestClient();
    const connection = await connectOrganization({ owner, client });

    const foreignManagement = await other.owner.agent
      .get(`${API}/organizations/${owner.organization.id}/integrations/connections`)
      .set('x-csrf-token', other.owner.csrf);
    expect([403, 404]).toContain(foreignManagement.status);

    const foreignDisconnect = await other.owner.agent
      .post(
        `${API}/organizations/${owner.organization.id}/integrations/connections/${connection.connectionId}/disconnect`,
      )
      .set('x-csrf-token', other.owner.csrf);
    expect([403, 404]).toContain(foreignDisconnect.status);

    const foreignMatch = await matchEmployee(connection.accessToken, {
      externalEmployeeId: 'org-b-employee',
      email: other.employee.email,
      emailVerified: true,
    });
    expect(foreignMatch.body.data[0]).toMatchObject({
      status: 'PENDING',
      conflictReason: 'EMPLOYEE_NOT_FOUND',
    });

    const ownMatch = await matchEmployee(connection.accessToken, {
      externalEmployeeId: 'org-a-employee',
      email: employee.email,
      emailVerified: true,
    });
    expect(ownMatch.body.data[0]).toMatchObject({
      status: 'PENDING',
      conflictReason: 'MANUAL_APPROVAL_REQUIRED',
    });

    const ownList = await owner.agent
      .get(
        `${API}/organizations/${owner.organization.id}/integrations/connections/${connection.connectionId}/mappings`,
      )
      .set('x-csrf-token', owner.csrf);
    const foreignRow = ownList.body.data.find(
      (row: { externalEmployeeId: string }) => row.externalEmployeeId === 'org-b-employee',
    );
    // The suggestion row belongs to this connection, but it must not expose any
    // information about the other organisation's employee.
    expect(foreignRow).toMatchObject({
      status: 'PENDING',
      conflictReason: 'EMPLOYEE_NOT_FOUND',
      employee: null,
    });
  });

  it('lets an owner resolve a pending mapping manually and keeps a revoked mapping revoked', async () => {
    const { owner, employee } = await createTeam();
    const client = await createTestClient();
    const connection = await connectOrganization({ owner, client });

    const pending = await matchEmployee(connection.accessToken, {
      externalEmployeeId: 'manual-employee',
      email: 'not-a-workzen-account@example.com',
      emailVerified: true,
    });
    expect(pending.body.data[0].status).toBe('PENDING');

    const list = await owner.agent
      .get(
        `${API}/organizations/${owner.organization.id}/integrations/connections/${connection.connectionId}/mappings`,
      )
      .set('x-csrf-token', owner.csrf);
    expect(list.status).toBe(200);
    const mapping = list.body.data.find(
      (row: { externalEmployeeId: string }) => row.externalEmployeeId === 'manual-employee',
    );
    expect(mapping).toBeTruthy();

    const linked = await owner.agent
      .post(
        `${API}/organizations/${owner.organization.id}/integrations/connections/${connection.connectionId}/mappings/${mapping.id}/resolve`,
      )
      .set('x-csrf-token', owner.csrf)
      .send({ action: 'LINK', workzenUserId: employee.user.id });
    expect(linked.status).toBe(200);
    expect(linked.body.data.status).toBe('ACTIVE');
    expect(linked.body.data.matchMethod).toBe('MANUAL');

    const revoked = await owner.agent
      .post(
        `${API}/organizations/${owner.organization.id}/integrations/connections/${connection.connectionId}/mappings/${mapping.id}/resolve`,
      )
      .set('x-csrf-token', owner.csrf)
      .send({ action: 'REVOKE' });
    expect(revoked.status).toBe(200);
    expect(revoked.body.data.status).toBe('REVOKED');

    const resurrect = await matchEmployee(connection.accessToken, {
      externalEmployeeId: 'manual-employee',
      email: employee.email,
      emailVerified: true,
    });
    expect(resurrect.body.data[0].status).toBe('REVOKED');

    const stored = await IntegrationEmployeeMapping.findOne({ where: { id: mapping.id } });
    expect(stored?.status).toBe('REVOKED');
    expect(stored?.workzenUserId).toBeNull();
  });
});

describe('integration attendance reads', () => {
  it('serves status, session history, summaries and idle time for mapped employees', async () => {
    const { owner, employee, agent, orgId } = await createTeam();
    const client = await createTestClient();
    const connection = await connectOrganization({ owner, client });

    const matched = await matchEmployee(connection.accessToken, {
      externalEmployeeId: 'flowtrium-employee-1',
      email: employee.email,
      emailVerified: true,
    });
    expect(matched.body.data[0].status).toBe('PENDING');
    await linkMapping({
      owner,
      connectionId: connection.connectionId,
      organizationId: connection.organizationId,
      externalEmployeeId: 'flowtrium-employee-1',
      workzenUserId: employee.user.id,
    });

    const started = await request(app)
      .post(`${API}/organizations/${orgId}/time-sessions/start`)
      .set(agent.headers)
      .send({});
    expect(started.status).toBe(201);

    const status = await integrationGet(connection.accessToken, '/attendance/status', {
      externalEmployeeId: 'flowtrium-employee-1',
    });
    expect(status.status).toBe(200);
    expect(status.body.data).toMatchObject({
      externalEmployeeId: 'flowtrium-employee-1',
      status: 'WORKING',
    });
    expect(status.body.data.session.startedAt).toBeTruthy();
    expect(status.body.data.session.durationSeconds).toBeGreaterThanOrEqual(0);

    const history = await integrationGet(connection.accessToken, '/attendance/sessions', {
      externalEmployeeId: 'flowtrium-employee-1',
      from: today(),
      to: today(),
    });
    expect(history.status).toBe(200);
    expect(history.body.meta.total).toBeGreaterThanOrEqual(1);
    expect(history.body.data[0].externalEmployeeId).toBe('flowtrium-employee-1');

    const summary = await integrationGet(connection.accessToken, '/attendance/summary', {
      externalEmployeeId: 'flowtrium-employee-1',
      from: today(),
      to: today(),
      period: 'daily',
    });
    expect(summary.status).toBe(200);
    expect(summary.body.data.periods).toHaveLength(1);
    expect(summary.body.data.totals.sessionCount).toBeGreaterThanOrEqual(1);
    expect(summary.body.data.totals.workedSeconds).toBeGreaterThanOrEqual(0);

    const idle = await integrationGet(connection.accessToken, '/attendance/idle', {
      externalEmployeeId: 'flowtrium-employee-1',
      from: today(),
      to: today(),
    });
    expect(idle.status).toBe(200);
    expect(idle.body.data.employees[0].externalEmployeeId).toBe('flowtrium-employee-1');
    expect(idle.body.data.totalIdleSeconds).toBeGreaterThanOrEqual(0);

    const unmapped = await integrationGet(connection.accessToken, '/attendance/status', {
      externalEmployeeId: 'not-mapped',
    });
    expect(unmapped.status).toBe(404);
    expect(unmapped.body.error.code).toBe('EMPLOYEE_NOT_MAPPED');
  });
});

describe('integration webhooks', () => {
  async function setupWebhook() {
    const { owner, employee } = await createTeam();
    const client = await createTestClient();
    const connection = await connectOrganization({ owner, client });

    const matched = await matchEmployee(connection.accessToken, {
      externalEmployeeId: 'flowtrium-employee-1',
      email: employee.email,
      emailVerified: true,
    });
    expect(matched.body.data[0].status).toBe('PENDING');
    await linkMapping({
      owner,
      connectionId: connection.connectionId,
      organizationId: connection.organizationId,
      externalEmployeeId: 'flowtrium-employee-1',
      workzenUserId: employee.user.id,
    });

    const subscription = await integrationPost(connection.accessToken, '/webhooks', {
      url: 'https://flowtrium.test/api/workzen/webhooks',
      description: 'Flowtrium test endpoint',
      eventTypes: ['attendance.started', 'attendance.stopped'],
    });
    expect(subscription.status).toBe(201);
    const secret = subscription.body.data.secret as string;
    const subscriptionId = subscription.body.data.subscription.id as string;

    return { owner, employee, connection, secret, subscriptionId, organizationId: owner.organization.id };
  }

  it('signs deliveries with HMAC and never duplicates an event across dispatch passes', async () => {
    const { employee, connection, secret, organizationId } = await setupWebhook();
    const deliverMock = vi
      .spyOn(webhookTransport, 'deliver')
      .mockResolvedValue({ status: 200 });

    const first = await publishIntegrationEvent({
      organizationId,
      employeeId: employee.user.id,
      eventType: 'attendance.started',
      payload: { sessionId: randomUUID() },
    });
    expect(first.eventsCreated).toBe(1);
    expect(first.deliveriesCreated).toBe(1);

    const second = await publishIntegrationEvent({
      organizationId,
      employeeId: employee.user.id,
      eventType: 'attendance.started',
      payload: { sessionId: randomUUID() },
    });
    expect(second.eventsCreated).toBe(1);

    const pass = await dispatchPendingWebhooks(new Date(), 50);
    expect(pass.delivered).toBe(2);
    expect(deliverMock).toHaveBeenCalledTimes(2);

    const eventIds = new Set<string>();
    for (const call of deliverMock.mock.calls) {
      const { headers, body } = call[0];
      const signature = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(headers['x-workzen-signature']!);
      expect(signature).toBeTruthy();
      expect(signWebhookPayload(secret, Number(signature![1]), body)).toBe(signature![2]);
      eventIds.add(headers['x-workzen-event-id']!);
      expect(headers['x-workzen-event-type']).toBe('attendance.started');
    }
    expect(eventIds.size).toBe(2);

    const deliveries = await IntegrationWebhookDelivery.findAll();
    expect(deliveries).toHaveLength(2);
    expect(deliveries.every((delivery) => delivery.status === 'DELIVERED')).toBe(true);

    const secondPass = await dispatchPendingWebhooks(new Date(), 50);
    expect(secondPass.attempted).toBe(0);
    expect(deliverMock).toHaveBeenCalledTimes(2);

    const events = await IntegrationWebhookEvent.findAll({ order: [['sequence', 'ASC']] });
    expect(events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(events.every((event) => event.status === 'DELIVERED')).toBe(true);
  });

  it('retries transient failures with backoff and stops on permanent 4xx responses', async () => {
    const { employee, organizationId } = await setupWebhook();

    const deliverMock = vi
      .spyOn(webhookTransport, 'deliver')
      .mockResolvedValueOnce({ status: 500 })
      .mockResolvedValueOnce({ status: 200 });

    await publishIntegrationEvent({
      organizationId,
      employeeId: employee.user.id,
      eventType: 'attendance.started',
      payload: { sessionId: randomUUID() },
    });

    const firstPass = await dispatchPendingWebhooks(new Date(), 50);
    expect(firstPass.failed).toBe(1);

    let delivery = await IntegrationWebhookDelivery.findOne();
    expect(delivery?.status).toBe('FAILED');
    expect(delivery?.attemptCount).toBe(1);
    expect(delivery?.responseStatus).toBe(500);
    expect(delivery?.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    await IntegrationWebhookDelivery.update(
      { nextAttemptAt: new Date(Date.now() - 1_000) },
      { where: { id: delivery!.id } },
    );

    const secondPass = await dispatchPendingWebhooks(new Date(), 50);
    expect(secondPass.delivered).toBe(1);
    delivery = await IntegrationWebhookDelivery.findOne();
    expect(delivery?.status).toBe('DELIVERED');
    expect(delivery?.attemptCount).toBe(2);

    deliverMock.mockResolvedValue({ status: 400 });

    await publishIntegrationEvent({
      organizationId,
      employeeId: employee.user.id,
      eventType: 'attendance.stopped',
      payload: { sessionId: randomUUID() },
    });

    const permanentPass = await dispatchPendingWebhooks(new Date(), 50);
    expect(permanentPass.dead).toBe(1);

    const dead = await IntegrationWebhookDelivery.findOne({
      where: { status: 'DEAD' },
    });
    expect(dead?.responseStatus).toBe(400);
    expect(dead?.attemptCount).toBe(1);
  });

  it('rejects literal internal destinations when a subscription is created', async () => {
    const { owner } = await createTeam();
    const client = await createTestClient();
    const connection = await connectOrganization({ owner, client });

    for (const url of [
      'http://169.254.169.254/latest/meta-data/',
      'http://127.0.0.1:9000/hook',
      'https://[::1]/hook',
      'https://metadata.google.internal/computeMetadata/v1/',
      'https://printer.local/hook',
    ]) {
      const response = await integrationPost(connection.accessToken, '/webhooks', {
        url,
        eventTypes: ['attendance.started'],
      });
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('INVALID_WEBHOOK_URL');
    }
  });

  it('dead-letters blocked or redirecting destinations instead of following them', async () => {
    const { employee, organizationId } = await setupWebhook();

    // Simulate a destination that was acceptable at subscription time but is
    // only caught by the delivery-time revalidation, plus a redirect response.
    const subscription = await IntegrationWebhookSubscription.findOne();
    await subscription!.update({ url: 'http://10.0.0.5/hook' });

    await publishIntegrationEvent({
      organizationId,
      employeeId: employee.user.id,
      eventType: 'attendance.started',
      payload: { sessionId: randomUUID() },
    });
    const blockedPass = await dispatchPendingWebhooks(new Date(), 50);
    expect(blockedPass.dead).toBe(1);

    const blockedDelivery = await IntegrationWebhookDelivery.findOne();
    expect(blockedDelivery?.status).toBe('DEAD');
    expect(blockedDelivery?.attemptCount).toBe(1);
    expect(blockedDelivery?.error).toContain('not permitted');

    await subscription!.update({ url: 'https://flowtrium.test/hooks' });
    vi.spyOn(webhookTransport, 'deliver').mockRejectedValue(
      new WebhookDestinationError('Webhook destination resolves to a blocked address'),
    );

    await publishIntegrationEvent({
      organizationId,
      employeeId: employee.user.id,
      eventType: 'attendance.stopped',
      payload: { sessionId: randomUUID() },
    });
    const rebindingPass = await dispatchPendingWebhooks(new Date(), 50);
    expect(rebindingPass.dead).toBe(1);

    const redirectMock = vi
      .spyOn(webhookTransport, 'deliver')
      .mockResolvedValue({ status: 302 });
    await publishIntegrationEvent({
      organizationId,
      employeeId: employee.user.id,
      eventType: 'attendance.stopped',
      payload: { sessionId: randomUUID() },
    });
    const redirectPass = await dispatchPendingWebhooks(new Date(), 50);
    expect(redirectPass.dead).toBe(1);
    expect(redirectMock).toHaveBeenCalled();
  });

  it('rejects webhook management without the webhooks:manage scope', async () => {
    const { owner } = await createTeam();
    const client = await createTestClient({ allowedScopes: ['attendance:read'] });
    const connection = await connectOrganization({ owner, client, scopes: ['attendance:read'] });

    const response = await integrationPost(connection.accessToken, '/webhooks', {
      url: 'https://flowtrium.test/hooks',
      eventTypes: ['attendance.started'],
    });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('INTEGRATION_SCOPE_DENIED');
  });
});

describe('integration management', () => {
  it('disconnects a connection from the owner UI and immediately revokes tokens and webhooks', async () => {
    const { owner, employee } = await createTeam();
    const client = await createTestClient();
    const connection = await connectOrganization({ owner, client });

    await matchEmployee(connection.accessToken, {
      externalEmployeeId: 'flowtrium-employee-1',
      email: employee.email,
      emailVerified: true,
    });
    const subscription = await integrationPost(connection.accessToken, '/webhooks', {
      url: 'https://flowtrium.test/hooks',
      eventTypes: ['attendance.started'],
    });
    expect(subscription.status).toBe(201);

    const disconnect = await owner.agent
      .post(
        `${API}/organizations/${owner.organization.id}/integrations/connections/${connection.connectionId}/disconnect`,
      )
      .set('x-csrf-token', owner.csrf);
    expect(disconnect.status).toBe(200);
    expect(disconnect.body.data.status).toBe('DISCONNECTED');

    const data = await integrationGet(connection.accessToken, '/employees');
    expect(data.status).toBe(401);

    const refresh = await exchangeToken({
      grant_type: 'refresh_token',
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: connection.refreshToken,
    });
    expect(refresh.status).toBe(400);
    expect(refresh.body.error.code).toBe('INVALID_GRANT');

    const connectionRow = await IntegrationConnection.findByPk(connection.connectionId);
    expect(connectionRow?.status).toBe('DISCONNECTED');

    const credentials = await IntegrationCredential.findAll({
      where: { connectionId: connection.connectionId },
    });
    expect(credentials.every((credential) => credential.revokedAt !== null)).toBe(true);

    const subscriptionRow = await IntegrationWebhookSubscription.findByPk(
      subscription.body.data.subscription.id as string,
    );
    expect(subscriptionRow?.status).toBe('DISABLED');
  });
});
