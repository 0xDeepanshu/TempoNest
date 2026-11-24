import { createHash, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { expect } from 'vitest';
import { IntegrationClient, ScreenLiveSession } from '../src/database';
import { hashIntegrationValue } from '../src/modules/integrations/integration.crypto';
import {
  API,
  app,
  createOwner,
  desktopAuth,
  enableEmployeeMonitoring,
  inviteAndAccept,
  registerAgent,
  uniqueEmail,
} from './helpers';

/** Shared fixtures for the integration viewer-link and live-screen suites. */
export const REDIRECT_URI = 'https://flowtrium.test/api/workzen/callback';
export const LIVE_SCOPES = ['attendance:read', 'employees:read', 'screens:live'];
export const EXTERNAL_USER_ID = 'flowtrium-user-7f3a';
export const EXTERNAL_USER_LABEL = 'Priya Sharma (priya@flowtrium.test)';
export const EXTERNAL_ORG_LABEL = 'Flowtrium Demo Studio';

export type Owner = Awaited<ReturnType<typeof createOwner>>;

export function pkcePair() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url');
  return { verifier, challenge };
}

export function inputValue(html: string, name: string): string {
  const match = new RegExp(`name="${name}" value="([^"]+)"`).exec(html);
  if (!match?.[1]) throw new Error(`Could not find input ${name} in hosted page`);
  return match[1];
}

export async function createClient(allowedScopes: string[] = LIVE_SCOPES) {
  const clientId = `wzc_test_${randomUUID().replace(/-/g, '')}`;
  const clientSecret = `wzcs_test_${randomBytes(24).toString('base64url')}`;
  await IntegrationClient.create({
    clientId,
    name: 'Flowtrium Test Client',
    description: null,
    redirectUris: [REDIRECT_URI],
    allowedScopes,
    secretHash: hashIntegrationValue(clientSecret),
    status: 'ACTIVE',
    createdByUserId: null,
    lastSecretRotatedAt: null,
  });
  return { clientId, clientSecret };
}

export async function enablePolicy(ownerAuth: { headers: Record<string, string> }, orgId: string, enabled = true) {
  const response = await request(app)
    .patch(`${API}/admin/screenshot-policy`)
    .set({ ...ownerAuth.headers, 'x-organization-id': orgId })
    .send({
      enabled,
      requestRoles: ['OWNER', 'ADMIN'],
      viewRoles: ['OWNER', 'ADMIN'],
      retentionDays: 1,
      auditRetentionDays: 30,
      disclosureVersion: 'v1',
      disclosureText: 'Authorized owners may view an active desktop session live.',
    });
  expect(response.status).toBe(200);
}

/** Runs the real hosted OAuth flow as `approver` and returns the connection's integration token. */
export async function connect(options: {
  approver: { agent: Owner['agent']; csrf: string };
  organizationId: string;
  client: { clientId: string; clientSecret: string };
  scopes: string[];
  externalOrganizationId: string;
}) {
  const pkce = pkcePair();
  const start = await options.approver.agent.get(`${API}/integrations/oauth/authorize`).query({
    response_type: 'code',
    client_id: options.client.clientId,
    redirect_uri: REDIRECT_URI,
    scope: options.scopes.join(' '),
    state: randomBytes(16).toString('hex'),
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    external_organization_id: options.externalOrganizationId,
  });
  if (start.status !== 200) return { start, decision: null as request.Response | null };
  const requestId = inputValue(start.text, 'authorization_request_id');
  const decision = await options.approver.agent
    .post(`${API}/integrations/oauth/authorize/decision`)
    .type('form')
    .send({
      _csrf: options.approver.csrf,
      authorization_request_id: requestId,
      organization_id: options.organizationId,
      decision: 'approve',
    });
  if (decision.status !== 302) return { start, decision };

  const code = new URL(decision.headers.location as string).searchParams.get('code');
  const token = await request(app)
    .post(`${API}/integrations/oauth/token`)
    .send({
      grant_type: 'authorization_code',
      client_id: options.client.clientId,
      client_secret: options.client.clientSecret,
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: pkce.verifier,
      external_organization_id: options.externalOrganizationId,
    });
  expect(token.status).toBe(200);
  return {
    start,
    decision,
    accessToken: token.body.access_token as string,
    refreshToken: token.body.refresh_token as string,
    connectionId: token.body.connection.id as string,
  };
}

export async function createTeam(label: string) {
  const owner = await createOwner(uniqueEmail(`${label}-owner`), `${label} Org`);
  const ownerAuth = await desktopAuth(owner.email);
  await enablePolicy(ownerAuth, owner.organization.id);
  const client = await createClient();
  const connected = await connect({
    approver: owner,
    organizationId: owner.organization.id,
    client,
    scopes: LIVE_SCOPES,
    externalOrganizationId: `flowtrium-org-${label}`,
  });
  if (!('accessToken' in connected)) throw new Error('connection failed');
  return {
    owner,
    ownerAuth,
    client,
    orgId: owner.organization.id as string,
    token: connected.accessToken as string,
    connectionId: connected.connectionId as string,
    externalOrganizationId: `flowtrium-org-${label}`,
  };
}

export function integrationPost(token: string, path: string, body: unknown) {
  return request(app)
    .post(`${API}/integration/v1${path}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body as object);
}

export function integrationGet(token: string, path: string) {
  return request(app).get(`${API}/integration/v1${path}`).set('Authorization', `Bearer ${token}`);
}

export function integrationDelete(token: string, path: string) {
  return request(app).delete(`${API}/integration/v1${path}`).set('Authorization', `Bearer ${token}`);
}

export async function requestLink(
  token: string,
  pkce = pkcePair(),
  overrides: Record<string, unknown> = {},
) {
  const response = await integrationPost(token, '/viewer-links/requests', {
    externalUserId: EXTERNAL_USER_ID,
    externalUserLabel: EXTERNAL_USER_LABEL,
    externalOrganizationLabel: EXTERNAL_ORG_LABEL,
    codeChallenge: pkce.challenge,
    ...overrides,
  });
  return { response, pkce };
}

export function nonceOf(approvalUrl: string): string {
  const nonce = new URLSearchParams(new URL(approvalUrl).hash.slice(1)).get('n');
  if (!nonce) throw new Error('approval URL has no fragment nonce');
  return nonce;
}

export type Browser = { agent: Owner['agent']; csrf: string };

/** What the approval script does in a real browser: reads the fragment and POSTs the nonce in a body. */
export async function openApproval(browser: Browser, approvalUrl: string) {
  return browser.agent
    .post(`${API}/integrations/viewer-links/open`)
    .type('form')
    .send({ request_id: new URL(approvalUrl).searchParams.get('request'), nonce: nonceOf(approvalUrl) });
}

export async function decide(browser: Browser, requestId: string, decision: 'approve' | 'deny' = 'approve') {
  return browser.agent
    .post(`${API}/integrations/viewer-links/decision`)
    .type('form')
    .send({ _csrf: browser.csrf, request_id: requestId, decision });
}

/** Full happy path up to and including activation. */
export async function linkOwner(team: Awaited<ReturnType<typeof createTeam>>) {
  const { response, pkce } = await requestLink(team.token);
  expect(response.status).toBe(201);
  const { requestId, approvalUrl } = response.body.data as { requestId: string; approvalUrl: string };
  const page = await openApproval(team.owner, approvalUrl);
  expect(page.status).toBe(200);
  const approved = await decide(team.owner, requestId);
  expect(approved.status).toBe(200);
  expect(approved.text).toContain('Approved');
  const completed = await integrationPost(team.token, `/viewer-links/requests/${requestId}/complete`, {
    codeVerifier: pkce.verifier,
  });
  expect(completed.status).toBe(200);
  return { requestId, approvalUrl, pkce, link: completed.body.data as { id: string } };
}

/** An employee with a desktop agent and a running time session, so a live session row can exist. */
export async function createEmployeeSession(team: Awaited<ReturnType<typeof createTeam>>, name: string) {
  const employee = await inviteAndAccept(team.owner, {
    role: 'EMPLOYEE',
    name,
    email: uniqueEmail(name.toLowerCase().replace(/\W/g, '')),
  });
  const employeeAuth = await desktopAuth(employee.email);
  const agent = await registerAgent(employeeAuth, team.orgId, { name: `${name} Desktop` });
  const started = await request(app)
    .post(`${API}/organizations/${team.orgId}/time-sessions/start`)
    .set(agent.headers)
    .send({});
  if (started.status !== 201) throw new Error(JSON.stringify(started.body));
  await enableEmployeeMonitoring(team.orgId, employee.user.id, team.owner.user.id);
  return {
    employee,
    agentId: agent.id,
    agentHeaders: agent.headers,
    timeSessionId: started.body.data.session.id as string,
  };
}

export async function insertSession(
  team: Awaited<ReturnType<typeof createTeam>>,
  target: Awaited<ReturnType<typeof createEmployeeSession>>,
  extra: Partial<{
    origin: 'WORKZEN' | 'INTEGRATION';
    integrationConnectionId: string | null;
    integrationViewerLinkId: string | null;
    indicatorConfirmedAt: Date | null;
  }> = {},
) {
  return ScreenLiveSession.create({
    organizationId: team.orgId,
    employeeId: target.employee.user.id,
    desktopAgentId: target.agentId,
    timeSessionId: target.timeSessionId,
    startedByUserId: team.owner.user.id,
    startedAt: new Date(),
    expiresAt: new Date(Date.now() + 15 * 60_000),
    origin: extra.origin ?? 'WORKZEN',
    integrationConnectionId: extra.integrationConnectionId ?? null,
    integrationViewerLinkId: extra.integrationViewerLinkId ?? null,
    indicatorConfirmedAt: extra.indicatorConfirmedAt ?? null,
    externalOrganizationId: extra.origin === 'INTEGRATION' ? team.externalOrganizationId : null,
    externalUserId: extra.origin === 'INTEGRATION' ? EXTERNAL_USER_ID : null,
  });
}

