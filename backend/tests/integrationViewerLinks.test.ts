import { createHash, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AuditEvent,
  IntegrationClient,
  IntegrationViewerLink,
  IntegrationViewerLinkRequest,
  Membership,
  ScreenLiveSession,
} from '../src/database';
import { hashIntegrationValue } from '../src/modules/integrations/integration.crypto';
import { resolveVerifiedViewer } from '../src/modules/integrations/integration.viewerLink.service';
import {
  API,
  app,
  createOwner,
  desktopAuth,
  enableEmployeeMonitoring,
  inviteAndAccept,
  loginBrowser,
  registerAgent,
  resetDatabase,
  uniqueEmail,
} from './helpers';

import {
  REDIRECT_URI,
  LIVE_SCOPES,
  EXTERNAL_USER_ID,
  EXTERNAL_USER_LABEL,
  EXTERNAL_ORG_LABEL,
  type Owner,
  pkcePair,
  inputValue,
  createClient,
  enablePolicy,
  connect,
  createTeam,
  integrationPost,
  integrationGet,
  integrationDelete,
  requestLink,
  nonceOf,
  type Browser,
  openApproval,
  decide,
  linkOwner,
  createEmployeeSession,
  insertSession,
} from './integrationLinkHelpers';

beforeEach(async () => {
  await resetDatabase();
});

describe('screens:live scope', () => {
  it('is only granted to clients explicitly allowed to request it', async () => {
    const owner = await createOwner(uniqueEmail('scope-owner'), 'Scope Org');
    const client = await createClient(['attendance:read', 'employees:read']);
    const result = await connect({
      approver: owner,
      organizationId: owner.organization.id,
      client,
      scopes: ['attendance:read', 'screens:live'],
      externalOrganizationId: 'flowtrium-org-scope',
    });
    expect(result.start.status).toBe(400);
    expect(result.start.text).toContain('not allowed to request');
  });

  it('cannot be approved by an Admin, even though Admins manage integrations', async () => {
    const owner = await createOwner(uniqueEmail('adm-owner'), 'Admin Org');
    const admin = await inviteAndAccept(owner, { role: 'ADMIN', name: 'Ada Admin', email: uniqueEmail('admin') });
    const adminSession = await loginBrowser(admin.email);
    const client = await createClient();
    const result = await connect({
      approver: adminSession,
      organizationId: owner.organization.id,
      client,
      scopes: LIVE_SCOPES,
      externalOrganizationId: 'flowtrium-org-admin',
    });
    expect(result.decision?.status).toBe(400);
    expect(result.decision?.text).toContain('Only a WorkZen owner');
  });

  it('keeps attendance-only connections away from the viewer-link API', async () => {
    const owner = await createOwner(uniqueEmail('att-owner'), 'Attendance Org');
    const client = await createClient();
    const connected = await connect({
      approver: owner,
      organizationId: owner.organization.id,
      client,
      scopes: ['attendance:read', 'employees:read'],
      externalOrganizationId: 'flowtrium-org-att',
    });
    if (!('accessToken' in connected)) throw new Error('connection failed');
    const { response } = await requestLink(connected.accessToken);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('INTEGRATION_SCOPE_DENIED');
    expect((await integrationGet(connected.accessToken, `/viewer-links/users/${EXTERNAL_USER_ID}`)).status).toBe(
      403,
    );
  });

  it('does not accept a WorkZen session on the integration API', async () => {
    const team = await createTeam('session');
    const response = await team.owner.agent
      .post(`${API}/integration/v1/viewer-links/requests`)
      .set('x-csrf-token', team.owner.csrf)
      .send({ externalUserId: 'x', externalUserLabel: 'x', externalOrganizationLabel: 'x', codeChallenge: 'x' });
    expect(response.status).toBe(401);
  });
});

describe('approval link exposure', () => {
  it('keeps the nonce out of the query string, the page and the logs', async () => {
    const team = await createTeam('exposure');
    const { response } = await requestLink(team.token);
    const { requestId, approvalUrl } = response.body.data as { requestId: string; approvalUrl: string };
    const parsed = new URL(approvalUrl);
    const nonce = nonceOf(approvalUrl);

    // Only the request id is in the part of the URL that browsers send, log and forward as Referer.
    expect(parsed.search).toBe(`?request=${requestId}`);
    expect(parsed.hash).toBe(`#n=${nonce}`);
    expect(parsed.pathname + parsed.search).not.toContain(nonce);

    // The page the link opens holds no secret and loads its script from this origin.
    const shell = await request(app).get(`${parsed.pathname}${parsed.search}`);
    expect(shell.status).toBe(200);
    expect(shell.text).not.toContain(nonce);
    expect(shell.text).toContain('approve.js');
    expect(shell.text).not.toMatch(/<script>/); // no inline script
    expect(shell.headers['cache-control']).toContain('no-store');

    // The script removes the fragment from the history entry before it posts.
    const script = await request(app).get(`${API}/integrations/viewer-links/approve.js`);
    expect(script.status).toBe(200);
    expect(script.headers['content-type']).toContain('javascript');
    expect(script.text).toContain('replaceState');
    expect(script.text).toContain('/integrations/viewer-links/open');
  });

  it('does not accept a nonce in the query string', async () => {
    const team = await createTeam('query-nonce');
    const { response } = await requestLink(team.token);
    const { requestId, approvalUrl } = response.body.data as { requestId: string; approvalUrl: string };
    const page = await team.owner.agent.get(
      `${API}/integrations/viewer-links/approve?request=${requestId}&nonce=${nonceOf(approvalUrl)}`,
    );
    // It is the same secret-free shell: nothing was opened or bound.
    expect(page.status).toBe(200);
    expect(page.text).not.toContain('Approve link');
    expect((await IntegrationViewerLinkRequest.findByPk(requestId))?.browserBindingHash).toBeNull();
  });

  it('spends the nonce on first use, and the first browser keeps working', async () => {
    const team = await createTeam('spent');
    const { response } = await requestLink(team.token);
    const { requestId, approvalUrl } = response.body.data as { requestId: string; approvalUrl: string };

    const first = await openApproval(team.owner, approvalUrl);
    expect(first.status).toBe(200);
    const second = await loginBrowser(team.owner.email);
    const replay = await openApproval(second, approvalUrl);
    expect(replay.status).toBe(404);

    // Binding stays with the browser that exchanged the nonce.
    expect((await decide(second, requestId)).status).toBe(403);
    expect((await decide(team.owner, requestId)).status).toBe(200);
  });
});

describe('identity link flow', () => {
  it('shows the connected organization and the exact external account, then links the signed-in owner', async () => {
    const team = await createTeam('happy');
    const { response, pkce } = await requestLink(team.token);
    expect(response.status).toBe(201);
    const { requestId, approvalUrl } = response.body.data;

    const page = await openApproval(team.owner, approvalUrl);
    expect(page.status).toBe(200);
    expect(page.text).toContain('happy Org'); // WorkZen organization
    expect(page.text).toContain(EXTERNAL_ORG_LABEL);
    expect(page.text).toContain(team.externalOrganizationId);
    expect(page.text).toContain(EXTERNAL_USER_LABEL);
    expect(page.text).toContain(EXTERNAL_USER_ID);
    expect(page.text).toContain(team.owner.email);

    const approved = await decide(team.owner, requestId);
    expect(approved.status).toBe(200);

    // Nothing is linked until the integration completes with the verifier.
    const before = await integrationGet(team.token, `/viewer-links/users/${EXTERNAL_USER_ID}`);
    expect(before.body.data.linked).toBe(false);

    const done = await integrationPost(team.token, `/viewer-links/requests/${requestId}/complete`, {
      codeVerifier: pkce.verifier,
    });
    expect(done.status).toBe(200);
    expect(done.body.data).toMatchObject({
      externalUserId: EXTERNAL_USER_ID,
      status: 'ACTIVE',
      workzenUser: { id: team.owner.user.id },
    });

    const status = await integrationGet(team.token, `/viewer-links/users/${EXTERNAL_USER_ID}`);
    expect(status.body.data.linked).toBe(true);

    const actions = (await AuditEvent.findAll({ where: { organizationId: team.orgId } })).map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'INTEGRATION_VIEWER_LINK_REQUESTED',
        'INTEGRATION_VIEWER_LINK_APPROVED',
        'INTEGRATION_VIEWER_LINK_ACTIVATED',
      ]),
    );
    const activated = await AuditEvent.findOne({
      where: { organizationId: team.orgId, action: 'INTEGRATION_VIEWER_LINK_ACTIVATED' },
    });
    expect(activated?.actorUserId).toBe(team.owner.user.id);
  });

  it('never takes the person or organization from the browser', async () => {
    const team = await createTeam('forge');
    const { response } = await requestLink(team.token);
    const { requestId, approvalUrl } = response.body.data;
    await openApproval(team.owner, approvalUrl);
    const forged = await team.owner.agent
      .post(`${API}/integrations/viewer-links/decision`)
      .type('form')
      .send({
        _csrf: team.owner.csrf,
        request_id: requestId,
        decision: 'approve',
        user_id: randomUUID(),
        organization_id: randomUUID(),
        role: 'OWNER',
      });
    // The body schema is strict: extra identity fields are refused outright.
    expect(forged.status).toBe(400);
    expect((await IntegrationViewerLinkRequest.findByPk(requestId))?.status).toBe('PENDING');
  });

  it.each(['ADMIN', 'MANAGER', 'EMPLOYEE'] as const)('refuses a %s', async (role) => {
    const team = await createTeam(`role-${role.toLowerCase()}`);
    const person = await inviteAndAccept(team.owner, {
      role,
      name: `${role} Person`,
      email: uniqueEmail(role.toLowerCase()),
    });
    const session = await loginBrowser(person.email);
    const { response } = await requestLink(team.token);
    const { requestId, approvalUrl } = response.body.data;

    const page = await openApproval(session, approvalUrl);
    expect(page.status).toBe(403);
    expect(page.text).toContain('Only a WorkZen owner');

    const decision = await decide(session, requestId);
    expect(decision.status).toBe(403);
    expect((await IntegrationViewerLinkRequest.findByPk(requestId))?.status).toBe('PENDING');
    expect(await IntegrationViewerLink.count({ where: { connectionId: team.connectionId } })).toBe(0);
    const refused = await AuditEvent.findOne({
      where: { organizationId: team.orgId, action: 'INTEGRATION_VIEWER_LINK_REFUSED' },
    });
    expect(refused?.actorUserId).toBe(person.user.id);
  });

  it('refuses a decision from a browser that did not open the link', async () => {
    const team = await createTeam('binding');
    const { response } = await requestLink(team.token);
    const { requestId } = response.body.data;
    const other = await loginBrowser(team.owner.email);
    const decision = await decide(other, requestId);
    expect(decision.status).toBe(403);
    expect(decision.text).toContain('not started in this browser');
    expect((await IntegrationViewerLinkRequest.findByPk(requestId))?.status).toBe('PENDING');
  });

  it('rejects a wrong nonce and an unknown request the same way', async () => {
    const team = await createTeam('nonce');
    const { response } = await requestLink(team.token);
    const { requestId, approvalUrl } = response.body.data;
    expect(approvalUrl).toContain(requestId);
    const wrongNonce = await team.owner.agent
      .post(`${API}/integrations/viewer-links/open`)
      .type('form')
      .send({ request_id: requestId, nonce: randomBytes(32).toString('base64url') });
    const unknown = await team.owner.agent
      .post(`${API}/integrations/viewer-links/open`)
      .type('form')
      .send({ request_id: randomUUID(), nonce: randomBytes(32).toString('base64url') });
    expect(wrongNonce.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(wrongNonce.text).toBe(unknown.text);
    expect((await IntegrationViewerLinkRequest.findByPk(requestId))?.browserBindingHash).toBeNull();
  });

  it('refuses to link while the monitoring policy is disabled', async () => {
    const team = await createTeam('policy');
    await enablePolicy(team.ownerAuth, team.orgId, false);
    const { response } = await requestLink(team.token);
    const { requestId, approvalUrl } = response.body.data;
    const page = await openApproval(team.owner, approvalUrl);
    expect(page.status).toBe(403);
    expect(page.text).toContain('disabled by this organization');
    const decision = await decide(team.owner, requestId);
    expect(decision.status).toBe(403);
    expect(await IntegrationViewerLink.count({ where: { connectionId: team.connectionId } })).toBe(0);
  });

  it('consumes the nonce once: replay, re-decision and re-completion all fail', async () => {
    const team = await createTeam('replay');
    const { requestId, approvalUrl, pkce } = await linkOwner(team);

    const again = await integrationPost(team.token, `/viewer-links/requests/${requestId}/complete`, {
      codeVerifier: pkce.verifier,
    });
    expect(again.status).toBe(410);
    expect(again.body.error.code).toBe('VIEWER_LINK_REQUEST_USED');

    // The nonce was spent when the page was first opened.
    const reopen = await openApproval(team.owner, approvalUrl);
    expect(reopen.status).toBe(404);
    const redecide = await decide(team.owner, requestId);
    expect(redecide.status).toBe(410);
    expect(await IntegrationViewerLink.count({ where: { connectionId: team.connectionId } })).toBe(1);
  });

  it('decides exactly once when two approvals race', async () => {
    const team = await createTeam('race');
    const { response } = await requestLink(team.token);
    const { requestId, approvalUrl } = response.body.data;
    await openApproval(team.owner, approvalUrl);
    const results = await Promise.all([decide(team.owner, requestId), decide(team.owner, requestId)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 410]);
  });

  it('needs the PKCE verifier, and a wrong one does not burn the request', async () => {
    const team = await createTeam('pkce');
    const { response, pkce } = await requestLink(team.token);
    const { requestId, approvalUrl } = response.body.data;
    await openApproval(team.owner, approvalUrl);
    await decide(team.owner, requestId);

    const wrong = await integrationPost(team.token, `/viewer-links/requests/${requestId}/complete`, {
      codeVerifier: pkcePair().verifier,
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('INVALID_CODE_VERIFIER');
    expect((await IntegrationViewerLinkRequest.findByPk(requestId))?.status).toBe('APPROVED');

    const right = await integrationPost(team.token, `/viewer-links/requests/${requestId}/complete`, {
      codeVerifier: pkce.verifier,
    });
    expect(right.status).toBe(200);
  });

  it('cannot be completed before approval', async () => {
    const team = await createTeam('early');
    const { response, pkce } = await requestLink(team.token);
    const early = await integrationPost(
      team.token,
      `/viewer-links/requests/${response.body.data.requestId}/complete`,
      { codeVerifier: pkce.verifier },
    );
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('VIEWER_LINK_NOT_APPROVED');
  });

  it('expires: an old request cannot be opened, decided or completed', async () => {
    const team = await createTeam('expiry');
    const first = await requestLink(team.token);
    const second = await requestLink(team.token, pkcePair(), { externalUserId: 'flowtrium-user-other' });

    await IntegrationViewerLinkRequest.update(
      { expiresAt: new Date(Date.now() - 1000) },
      { where: { id: first.response.body.data.requestId } },
    );
    const page = await openApproval(team.owner, first.response.body.data.approvalUrl);
    expect(page.status).toBe(410);
    expect(page.text).toContain('expired');

    // Approved in time, but completion arrives after expiry.
    await openApproval(team.owner, second.response.body.data.approvalUrl);
    await decide(team.owner, second.response.body.data.requestId);
    await IntegrationViewerLinkRequest.update(
      { expiresAt: new Date(Date.now() - 1000) },
      { where: { id: second.response.body.data.requestId } },
    );
    const late = await integrationPost(
      team.token,
      `/viewer-links/requests/${second.response.body.data.requestId}/complete`,
      { codeVerifier: second.pkce.verifier },
    );
    expect(late.status).toBe(410);
    expect(await IntegrationViewerLink.count({ where: { connectionId: team.connectionId } })).toBe(0);
  });

  it('is bound to its own connection', async () => {
    const teamA = await createTeam('conn-a');
    const teamB = await createTeam('conn-b');
    const { response, pkce } = await requestLink(teamA.token);
    const { requestId, approvalUrl } = response.body.data;
    await openApproval(teamA.owner, approvalUrl);
    await decide(teamA.owner, requestId);
    const stolen = await integrationPost(teamB.token, `/viewer-links/requests/${requestId}/complete`, {
      codeVerifier: pkce.verifier,
    });
    expect(stolen.status).toBe(404);
    expect(await IntegrationViewerLink.count()).toBe(0);
  });

  it('does not let one WorkZen owner be bound to two external accounts', async () => {
    const team = await createTeam('twice');
    await linkOwner(team);
    const { response, pkce } = await requestLink(team.token, pkcePair(), {
      externalUserId: 'flowtrium-user-second',
    });
    const { requestId, approvalUrl } = response.body.data;
    await openApproval(team.owner, approvalUrl);
    await decide(team.owner, requestId);
    const conflict = await integrationPost(team.token, `/viewer-links/requests/${requestId}/complete`, {
      codeVerifier: pkce.verifier,
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('WORKZEN_USER_ALREADY_LINKED');
  });

  it('rejects an owner who stopped being eligible between approval and completion', async () => {
    const team = await createTeam('demoted');
    const { response, pkce } = await requestLink(team.token);
    const { requestId, approvalUrl } = response.body.data;
    await openApproval(team.owner, approvalUrl);
    await decide(team.owner, requestId);
    await Membership.update({ role: 'ADMIN' }, { where: { userId: team.owner.user.id, organizationId: team.orgId } });
    const done = await integrationPost(team.token, `/viewer-links/requests/${requestId}/complete`, {
      codeVerifier: pkce.verifier,
    });
    expect(done.status).toBe(403);
    expect(await IntegrationViewerLink.count()).toBe(0);
  });
});

describe('per-request identity verification', () => {
  it('resolves the verified owner for a linked account and refuses an unlinked one', async () => {
    const team = await createTeam('resolve');
    await linkOwner(team);
    const ok = await resolveVerifiedViewer({ connectionId: team.connectionId, externalUserId: EXTERNAL_USER_ID });
    expect(ok.link.workzenUserId).toBe(team.owner.user.id);
    expect(ok.membership.role).toBe('OWNER');

    await expect(
      resolveVerifiedViewer({ connectionId: team.connectionId, externalUserId: 'someone-else' }),
    ).rejects.toMatchObject({ code: 'VIEWER_LINK_REQUIRED' });
  });

  it('revokes the link as soon as the owner is no longer an owner', async () => {
    const team = await createTeam('lost-role');
    const { link } = await linkOwner(team);
    const target = await createEmployeeSession(team, 'Lost Role Employee');
    const session = await insertSession(team, target, {
      origin: 'INTEGRATION',
      integrationConnectionId: team.connectionId,
      integrationViewerLinkId: link.id,
    });

    await Membership.update({ role: 'ADMIN' }, { where: { userId: team.owner.user.id, organizationId: team.orgId } });
    await expect(
      resolveVerifiedViewer({ connectionId: team.connectionId, externalUserId: EXTERNAL_USER_ID }),
    ).rejects.toMatchObject({ code: 'VIEWER_LINK_OWNER_REQUIRED' });

    const row = await IntegrationViewerLink.findByPk(link.id);
    expect(row?.status).toBe('REVOKED');
    expect(row?.revokeReason).toBe('IDENTITY_NO_LONGER_ELIGIBLE');
    const ended = await ScreenLiveSession.findByPk(session.id);
    expect(ended?.status).toBe('ENDED');
    expect(ended?.terminationReason).toBe('VIEWER_LINK_REVOKED');
  });

  it('refuses while the monitoring policy is off without destroying the link', async () => {
    const team = await createTeam('policy-off');
    const { link } = await linkOwner(team);
    await enablePolicy(team.ownerAuth, team.orgId, false);
    await expect(
      resolveVerifiedViewer({ connectionId: team.connectionId, externalUserId: EXTERNAL_USER_ID }),
    ).rejects.toMatchObject({ code: 'SCREEN_LIVE_POLICY_DISABLED' });
    expect((await IntegrationViewerLink.findByPk(link.id))?.status).toBe('ACTIVE');
  });
});

describe('revocation', () => {
  it('ends the link and every live session started through it, and nothing else', async () => {
    const team = await createTeam('revoke');
    const { link } = await linkOwner(team);
    const viaLink = await createEmployeeSession(team, 'Viewed Employee');
    const native = await createEmployeeSession(team, 'Native Employee');
    const integrationSession = await insertSession(team, viaLink, {
      origin: 'INTEGRATION',
      integrationConnectionId: team.connectionId,
      integrationViewerLinkId: link.id,
    });
    const nativeSession = await insertSession(team, native, { origin: 'WORKZEN' });

    const revoked = await integrationDelete(team.token, `/viewer-links/users/${EXTERNAL_USER_ID}`);
    expect(revoked.status).toBe(200);
    expect(revoked.body.data.revoked).toBe(true);

    expect((await IntegrationViewerLink.findByPk(link.id))?.status).toBe('REVOKED');
    const ended = await ScreenLiveSession.findByPk(integrationSession.id);
    expect(ended?.status).toBe('ENDED');
    expect(ended?.terminationReason).toBe('VIEWER_LINK_REVOKED');
    // Existing WorkZen owner live screens are untouched.
    expect((await ScreenLiveSession.findByPk(nativeSession.id))?.status).toBe('ACTIVE');

    const status = await integrationGet(team.token, `/viewer-links/users/${EXTERNAL_USER_ID}`);
    expect(status.body.data.linked).toBe(false);
    await expect(
      resolveVerifiedViewer({ connectionId: team.connectionId, externalUserId: EXTERNAL_USER_ID }),
    ).rejects.toMatchObject({ code: 'VIEWER_LINK_REQUIRED' });

    const audit = await AuditEvent.findOne({
      where: { organizationId: team.orgId, action: 'INTEGRATION_VIEWER_LINK_REVOKED' },
    });
    expect(audit?.metadata).toMatchObject({ reason: 'EXTERNAL_REVOKED', externalUserId: EXTERNAL_USER_ID });
  });

  it('lets the organization revoke a link from WorkZen', async () => {
    const team = await createTeam('owner-revoke');
    const { link } = await linkOwner(team);
    const list = await team.owner.agent
      .get(`${API}/organizations/${team.orgId}/integrations/viewer-links`)
      .set('x-csrf-token', team.owner.csrf);
    expect(list.status).toBe(200);
    expect(list.body.data[0]).toMatchObject({ id: link.id, status: 'ACTIVE' });

    const revoked = await team.owner.agent
      .post(`${API}/organizations/${team.orgId}/integrations/viewer-links/${link.id}/revoke`)
      .set('x-csrf-token', team.owner.csrf);
    expect(revoked.status).toBe(200);
    const row = await IntegrationViewerLink.findByPk(link.id);
    expect(row?.status).toBe('REVOKED');
    expect(row?.revokeReason).toBe('OWNER_REVOKED');
    expect(row?.revokedByUserId).toBe(team.owner.user.id);
  });

  it('keeps one organization from revoking another organization\'s link', async () => {
    const teamA = await createTeam('iso-a');
    const teamB = await createTeam('iso-b');
    const { link } = await linkOwner(teamA);
    const attempt = await teamB.owner.agent
      .post(`${API}/organizations/${teamB.orgId}/integrations/viewer-links/${link.id}/revoke`)
      .set('x-csrf-token', teamB.owner.csrf);
    expect(attempt.status).toBe(404);
    expect((await IntegrationViewerLink.findByPk(link.id))?.status).toBe('ACTIVE');
  });

  it('disconnecting the integration invalidates its links, pending requests and live sessions', async () => {
    const team = await createTeam('disconnect');
    const { link } = await linkOwner(team);
    const pending = await requestLink(team.token, pkcePair(), { externalUserId: 'flowtrium-user-pending' });
    const target = await createEmployeeSession(team, 'Disconnect Employee');
    const session = await insertSession(team, target, {
      origin: 'INTEGRATION',
      integrationConnectionId: team.connectionId,
      integrationViewerLinkId: link.id,
    });

    const result = await team.owner.agent
      .post(`${API}/organizations/${team.orgId}/integrations/connections/${team.connectionId}/disconnect`)
      .set('x-csrf-token', team.owner.csrf);
    expect(result.status).toBe(200);

    const row = await IntegrationViewerLink.findByPk(link.id);
    expect(row?.status).toBe('REVOKED');
    expect(row?.revokeReason).toBe('CONNECTION_CLOSED');
    expect((await IntegrationViewerLinkRequest.findByPk(pending.response.body.data.requestId))?.status).toBe(
      'EXPIRED',
    );
    const ended = await ScreenLiveSession.findByPk(session.id);
    expect(ended?.status).toBe('ENDED');
    expect(ended?.terminationReason).toBe('INTEGRATION_DISCONNECTED');
    expect([401, 403]).toContain((await requestLink(team.token)).response.status);
  });

  it('revoking the OAuth token has the same effect', async () => {
    const team = await createTeam('token-revoke');
    const { link } = await linkOwner(team);
    const target = await createEmployeeSession(team, 'Token Revoke Employee');
    const session = await insertSession(team, target, {
      origin: 'INTEGRATION',
      integrationConnectionId: team.connectionId,
      integrationViewerLinkId: link.id,
    });
    const revoke = await request(app)
      .post(`${API}/integrations/oauth/revoke`)
      .send({ token: team.token, client_id: team.client.clientId, client_secret: team.client.clientSecret });
    expect(revoke.status).toBe(200);
    expect((await IntegrationViewerLink.findByPk(link.id))?.status).toBe('REVOKED');
    expect((await ScreenLiveSession.findByPk(session.id))?.terminationReason).toBe('INTEGRATION_DISCONNECTED');
  });

  it('relinking the same external account replaces the old link and ends its sessions', async () => {
    const team = await createTeam('relink');
    const first = await linkOwner(team);
    const target = await createEmployeeSession(team, 'Relink Employee');
    const session = await insertSession(team, target, {
      origin: 'INTEGRATION',
      integrationConnectionId: team.connectionId,
      integrationViewerLinkId: first.link.id,
    });
    const second = await linkOwner(team);
    expect(second.link.id).not.toBe(first.link.id);
    expect((await IntegrationViewerLink.findByPk(first.link.id))?.revokeReason).toBe('RELINKED');
    expect((await ScreenLiveSession.findByPk(session.id))?.terminationReason).toBe('VIEWER_LINK_REVOKED');
    expect(await IntegrationViewerLink.count({ where: { status: 'ACTIVE' } })).toBe(1);
  });
});
