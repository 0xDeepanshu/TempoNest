import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AuditEvent,
  DesktopAgent,
  Screenshot,
  ScreenshotPolicy,
  ScreenshotRequest,
} from '../src/database';
import {
  cancelScreenshotRequest as cancelScreenshotRequestService,
  createScreenshotAccess as createScreenshotAccessService,
  createScreenshotRequest as createScreenshotRequestService,
  listScreenshotRequestsForEmployee,
  runScreenshotMaintenance,
} from '../src/modules/screenshots/screenshot.service';
import { updateScreenshotPolicy } from '../src/modules/screenshots/screenshotPolicy.service';
import { screenshotStorage } from '../src/modules/screenshots/storage';
import {
  API,
  app,
  createOwner,
  desktopAuth,
  inviteAndAccept,
  registerAgent,
  resetDatabase,
  uniqueEmail,
} from './helpers';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 0x11),
]);
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(32, 0x22),
]);

function adminHeaders(auth: { headers: Record<string, string> }, organizationId: string) {
  return { ...auth.headers, 'x-organization-id': organizationId };
}

function agentHeaders(agent: { headers: Record<string, string> }, organizationId: string) {
  return { ...agent.headers, 'x-organization-id': organizationId };
}

async function createTeam(
  options: {
    startSession?: boolean;
    manager?: boolean;
    clientType?: 'ELECTRON' | 'MOBILE';
  } = {},
) {
  const owner = await createOwner(uniqueEmail('shot-owner'), 'Screenshot Test Org');
  const ownerAuth = await desktopAuth(owner.email);
  const employee = await inviteAndAccept(owner, {
    role: 'EMPLOYEE',
    name: 'Screenshot Employee',
    email: uniqueEmail('shot-employee'),
  });
  const employeeAuth = await desktopAuth(employee.email);
  const agent = await registerAgent(employeeAuth, owner.organization.id, {
    name: 'Screenshot Desktop',
    clientType: options.clientType,
  });

  let manager: Awaited<ReturnType<typeof inviteAndAccept>> | null = null;
  let managerAuth: Awaited<ReturnType<typeof desktopAuth>> | null = null;
  if (options.manager) {
    manager = await inviteAndAccept(owner, {
      role: 'MANAGER',
      name: 'Screenshot Manager',
      email: uniqueEmail('shot-manager'),
    });
    managerAuth = await desktopAuth(manager.email);
  }

  let sessionId: string | null = null;
  if (options.startSession !== false) {
    const started = await request(app)
      .post(`${API}/organizations/${owner.organization.id}/time-sessions/start`)
      .set(agent.headers)
      .send({});
    if (started.status !== 201) {
      throw new Error(`Failed to start session: ${JSON.stringify(started.body)}`);
    }
    sessionId = started.body.data.session.id as string;
  }

  return {
    owner,
    ownerAuth,
    employee,
    employeeAuth,
    agent,
    manager,
    managerAuth,
    orgId: owner.organization.id,
    sessionId,
  };
}

async function enablePolicy(
  ownerAuth: { headers: Record<string, string> },
  orgId: string,
  overrides: Record<string, unknown> = {},
) {
  const response = await request(app)
    .patch(`${API}/admin/screenshot-policy`)
    .set(adminHeaders(ownerAuth, orgId))
    .send({
      enabled: true,
      requestCooldownSeconds: 0,
      retentionDays: 2,
      auditRetentionDays: 365,
      disclosureVersion: 'v1',
      disclosureText:
        'Authorized administrators may request individual screenshots during active work sessions.',
      ...overrides,
    });
  if (response.status !== 200) {
    throw new Error(`Failed to enable policy: ${JSON.stringify(response.body)}`);
  }
  return response;
}

function createRequest(
  ownerAuth: { headers: Record<string, string> },
  orgId: string,
  employeeId: string,
  idempotencyKey?: string,
) {
  let call = request(app)
    .post(`${API}/admin/employees/${employeeId}/screenshot-requests`)
    .set(adminHeaders(ownerAuth, orgId));
  if (idempotencyKey) call = call.set('Idempotency-Key', idempotencyKey);
  return call.send({});
}

function claim(
  agent: { headers: Record<string, string> },
  orgId: string,
  requestId: string,
  contentType = 'image/png',
) {
  return request(app)
    .post(`${API}/agent/screenshot-requests/${requestId}/claim`)
    .set(agentHeaders(agent, orgId))
    .send({ contentType });
}

function upload(
  agent: { headers: Record<string, string> },
  orgId: string,
  url: string,
  body: Buffer,
  contentType = 'image/png',
) {
  const path = new URL(url).pathname;
  return request(app)
    .put(path)
    .set(agentHeaders(agent, orgId))
    .set('content-type', contentType)
    .send(body);
}

function complete(
  agent: { headers: Record<string, string> },
  orgId: string,
  requestId: string,
  body: Record<string, unknown> = {},
) {
  return request(app)
    .post(`${API}/agent/screenshot-requests/${requestId}/complete`)
    .set(agentHeaders(agent, orgId))
    .send(body);
}

async function captureOne(
  team: Awaited<ReturnType<typeof createTeam>>,
  options: { complete?: boolean } = {},
) {
  const created = await createRequest(team.ownerAuth, team.orgId, team.employee.user.id);
  expect(created.status).toBe(201);
  const requestId = created.body.data.request.id as string;

  const claimed = await claim(team.agent, team.orgId, requestId);
  expect(claimed.status).toBe(200);
  const uploadUrl = claimed.body.data.upload.url as string;

  const uploaded = await upload(team.agent, team.orgId, uploadUrl, PNG);
  expect(uploaded.status).toBe(201);

  if (options.complete !== false) {
    const completed = await complete(team.agent, team.orgId, requestId, {
      captureTimestamp: new Date().toISOString(),
    });
    expect(completed.status).toBe(200);
  }

  return { requestId, uploadUrl };
}

describe('admin-initiated screenshots', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('rejects capture when the policy is disabled and enforces roles and organization scope', async () => {
    const team = await createTeam({ manager: true });

    const disabled = await createRequest(team.ownerAuth, team.orgId, team.employee.user.id);
    expect(disabled.status).toBe(403);
    expect(disabled.body.error.code).toBe('SCREENSHOT_POLICY_DISABLED');

    await enablePolicy(team.ownerAuth, team.orgId);

    const employeeAttempt = await request(app)
      .post(`${API}/admin/employees/${team.employee.user.id}/screenshot-requests`)
      .set(adminHeaders(team.employeeAuth, team.orgId))
      .send({});
    expect(employeeAttempt.status).toBe(403);
    expect(employeeAttempt.body.error.code).toBe('PERMISSION_DENIED');

    const managerAttempt = await request(app)
      .post(`${API}/admin/employees/${team.employee.user.id}/screenshot-requests`)
      .set(adminHeaders(team.managerAuth!, team.orgId))
      .send({});
    expect(managerAttempt.status).toBe(403);
    expect(managerAttempt.body.error.code).toBe('PERMISSION_DENIED');

    const otherOwner = await createOwner(uniqueEmail('other-owner'), 'Other Screenshot Org');
    const otherAuth = await desktopAuth(otherOwner.email);
    const crossOrg = await request(app)
      .get(`${API}/admin/employees/${team.employee.user.id}/screenshot-requests`)
      .set({
        ...otherAuth.headers,
        'x-organization-id': team.orgId,
      });
    expect(crossOrg.status).toBe(404);

    const policy = await ScreenshotPolicy.findOne({ where: { organizationId: team.orgId } });
    expect(policy?.enabled).toBe(true);

    await expect(
      createScreenshotRequestService({
        organizationId: team.orgId,
        employeeId: team.employee.user.id,
        actorUserId: team.manager!.user.id,
        actorRole: 'MANAGER',
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    await expect(
      listScreenshotRequestsForEmployee({
        organizationId: team.orgId,
        employeeId: team.employee.user.id,
        actorRole: 'MANAGER',
        page: 1,
        limit: 20,
      }),
    ).rejects.toMatchObject({ code: 'SCREENSHOT_ROLE_NOT_ALLOWED' });
  });

  it('creates idempotently, blocks duplicate pending requests, and exposes no storage secrets', async () => {
    const team = await createTeam();
    await enablePolicy(team.ownerAuth, team.orgId);

    const first = await createRequest(
      team.ownerAuth,
      team.orgId,
      team.employee.user.id,
      'request-key-0001',
    );
    expect(first.status).toBe(201);
    expect(first.body.data.request.status).toBe('PENDING');
    expect(first.body.data.request.screenshot).toBeUndefined();
    expect(first.body.data.delivery.agentOnline).toBe(true);
    expect(JSON.stringify(first.body)).not.toContain('storageKey');
    expect(JSON.stringify(first.body)).not.toContain('uploadToken');

    const requestId = first.body.data.request.id as string;

    const replay = await createRequest(
      team.ownerAuth,
      team.orgId,
      team.employee.user.id,
      'request-key-0001',
    );
    expect(replay.status).toBe(200);
    expect(replay.body.data.replayed).toBe(true);
    expect(replay.body.data.request.id).toBe(requestId);

    const duplicate = await createRequest(team.ownerAuth, team.orgId, team.employee.user.id);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('SCREENSHOT_REQUEST_PENDING');

    const reused = await createRequest(
      team.ownerAuth,
      team.orgId,
      randomUUID(),
      'request-key-0001',
    );
    // The service rejects reuse before it even resolves the target employee,
    // so a valid-looking-but-different employee ID must not return the first
    // request.
    expect(reused.status).toBe(409);
    expect(reused.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');

    expect(await ScreenshotRequest.count()).toBe(1);
    expect(await AuditEvent.count({ where: { action: 'SCREENSHOT_REQUEST_CREATED' } })).toBe(1);
  });

  it('serializes concurrent retries with the same idempotency key', async () => {
    const team = await createTeam();
    await enablePolicy(team.ownerAuth, team.orgId);

    const responses = await Promise.all([
      createRequest(team.ownerAuth, team.orgId, team.employee.user.id, 'concurrent-key-1'),
      createRequest(team.ownerAuth, team.orgId, team.employee.user.id, 'concurrent-key-1'),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    expect(responses[0].body.data.request.id).toBe(responses[1].body.data.request.id);
    expect(await ScreenshotRequest.count()).toBe(1);
    expect(await AuditEvent.count({ where: { action: 'SCREENSHOT_REQUEST_CREATED' } })).toBe(1);
  });

  it('requires an eligible active session and a valid non-revoked agent', async () => {
    const noSession = await createTeam({ startSession: false });
    await enablePolicy(noSession.ownerAuth, noSession.orgId);
    const noSessionResponse = await createRequest(
      noSession.ownerAuth,
      noSession.orgId,
      noSession.employee.user.id,
    );
    expect(noSessionResponse.status).toBe(409);
    expect(noSessionResponse.body.error.code).toBe('NO_ELIGIBLE_SCREENSHOT_SESSION');

    const revokedTeam = await createTeam();
    await enablePolicy(revokedTeam.ownerAuth, revokedTeam.orgId);
    await DesktopAgent.update(
      { revokedAt: new Date() },
      { where: { id: revokedTeam.agent.id } },
    );
    const revoked = await createRequest(
      revokedTeam.ownerAuth,
      revokedTeam.orgId,
      revokedTeam.employee.user.id,
    );
    expect(revoked.status).toBe(409);
    expect(revoked.body.error.code).toBe('INVALID_SCREENSHOT_AGENT');
  });

  it('defaults to the Electron client type and never targets mobile agents', async () => {
    const electronTeam = await createTeam();
    await enablePolicy(electronTeam.ownerAuth, electronTeam.orgId);

    expect(electronTeam.agent.agent.clientType).toBe('ELECTRON');
    const electronRequest = await createRequest(
      electronTeam.ownerAuth,
      electronTeam.orgId,
      electronTeam.employee.user.id,
    );
    expect(electronRequest.status).toBe(201);
    expect(electronRequest.body.data.request.desktopAgentId).toBe(electronTeam.agent.id);

    const mobileTeam = await createTeam({ clientType: 'MOBILE' });
    await enablePolicy(mobileTeam.ownerAuth, mobileTeam.orgId);
    expect(mobileTeam.agent.agent.clientType).toBe('MOBILE');

    const mobileRequest = await createRequest(
      mobileTeam.ownerAuth,
      mobileTeam.orgId,
      mobileTeam.employee.user.id,
    );
    expect(mobileRequest.status).toBe(409);
    expect(mobileRequest.body.error.code).toBe('NO_ELIGIBLE_SCREENSHOT_SESSION');
    expect(
      await ScreenshotRequest.count({ where: { organizationId: mobileTeam.orgId } }),
    ).toBe(0);

    const listed = await request(app)
      .get(`${API}/organizations/${mobileTeam.orgId}/desktop-agents`)
      .set(adminHeaders(mobileTeam.ownerAuth, mobileTeam.orgId));
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0].clientType).toBe('MOBILE');
    expect(listed.body.data[0].agentKeyHash).toBeUndefined();
  });

  it('refuses to claim after the linked time session has stopped', async () => {
    const team = await createTeam();
    await enablePolicy(team.ownerAuth, team.orgId);

    const created = await createRequest(team.ownerAuth, team.orgId, team.employee.user.id);
    expect(created.status).toBe(201);
    const requestId = created.body.data.request.id as string;

    const stopped = await request(app)
      .post(`${API}/organizations/${team.orgId}/time-sessions/${team.sessionId}/stop`)
      .set(team.agent.headers)
      .send({});
    expect(stopped.status).toBe(200);

    const claimAfterStop = await claim(team.agent, team.orgId, requestId);
    expect(claimAfterStop.status).toBe(409);
    expect(claimAfterStop.body.error.code).toBe('SCREENSHOT_SESSION_NOT_ACTIVE');
    expect((await ScreenshotRequest.findByPk(requestId))?.status).toBe('PENDING');
  });

  it('requires the employee to acknowledge the current disclosure when configured', async () => {
    const team = await createTeam();
    await enablePolicy(team.ownerAuth, team.orgId, {
      employeeAcknowledgementRequired: true,
      disclosureVersion: 'v2',
      disclosureText: 'This organization monitors individual desktop screenshots on request.',
    });

    const before = await createRequest(team.ownerAuth, team.orgId, team.employee.user.id);
    expect(before.status).toBe(409);
    expect(before.body.error.code).toBe('SCREENSHOT_POLICY_ACKNOWLEDGEMENT_REQUIRED');

    const disclosure = await request(app)
      .get(`${API}/screenshot-policy`)
      .set(adminHeaders(team.employeeAuth, team.orgId));
    expect(disclosure.status).toBe(200);
    expect(disclosure.body.data.policy.disclosure.version).toBe('v2');
    expect(disclosure.body.data.policy.disclosure.acknowledged).toBe(false);

    const acknowledged = await request(app)
      .post(`${API}/screenshot-policy/acknowledge`)
      .set(adminHeaders(team.employeeAuth, team.orgId))
      .send({});
    expect(acknowledged.status).toBe(200);
    expect(acknowledged.body.data.policy.disclosure.acknowledged).toBe(true);

    const after = await createRequest(team.ownerAuth, team.orgId, team.employee.user.id);
    expect(after.status).toBe(201);
    expect(
      await AuditEvent.count({ where: { action: 'SCREENSHOT_POLICY_ACKNOWLEDGED' } }),
    ).toBe(1);

    const staleVersion = await request(app)
      .patch(`${API}/admin/screenshot-policy`)
      .set(adminHeaders(team.ownerAuth, team.orgId))
      .send({ disclosureVersion: 'v2', disclosureText: 'Updated disclosure text.' });
    expect(staleVersion.status).toBe(422);
    expect(staleVersion.body.error.code).toBe('SCREENSHOT_DISCLOSURE_VERSION_REQUIRED');

    const newVersion = await request(app)
      .patch(`${API}/admin/screenshot-policy`)
      .set(adminHeaders(team.ownerAuth, team.orgId))
      .send({ disclosureVersion: 'v3', disclosureText: 'Updated disclosure text.' });
    expect(newVersion.status).toBe(200);

    const needsNewAck = await request(app)
      .get(`${API}/screenshot-policy`)
      .set(adminHeaders(team.employeeAuth, team.orgId));
    expect(needsNewAck.body.data.policy.disclosure.acknowledged).toBe(false);
  });

  it('runs claim, private upload, completion, metadata, signed access, and audit flow', async () => {
    const team = await createTeam();
    await enablePolicy(team.ownerAuth, team.orgId);

    const created = await createRequest(team.ownerAuth, team.orgId, team.employee.user.id);
    expect(created.status).toBe(201);
    const requestId = created.body.data.request.id as string;

    const claimed = await claim(team.agent, team.orgId, requestId);
    expect(claimed.status).toBe(200);
    expect(claimed.body.data.status).toBe('CLAIMED');
    expect(claimed.body.data.upload.method).toBe('PUT');
    expect(claimed.body.data.upload.requiresAgentAuth).toBe(true);
    expect(claimed.body.data.upload.requiredHeaders['X-Organization-Id']).toBe(team.orgId);

    const acknowledged = await request(app)
      .post(`${API}/agent/screenshot-requests/${requestId}/ack`)
      .set(agentHeaders(team.agent, team.orgId))
      .send({});
    expect(acknowledged.status).toBe(200);
    expect(acknowledged.body.data.status).toBe('CLAIMED');
    const acknowledgedAgain = await request(app)
      .post(`${API}/agent/screenshot-requests/${requestId}/ack`)
      .set(agentHeaders(team.agent, team.orgId))
      .send({});
    expect(acknowledgedAgain.status).toBe(200);
    expect(
      await AuditEvent.count({
        where: { action: 'SCREENSHOT_REQUEST_ACKNOWLEDGED', screenshotRequestId: requestId },
      }),
    ).toBe(1);

    const earlyCompletion = await complete(team.agent, team.orgId, requestId);
    expect(earlyCompletion.status).toBe(409);
    expect(earlyCompletion.body.error.code).toBe('SCREENSHOT_UPLOAD_NOT_FOUND');

    const uploaded = await upload(
      team.agent,
      team.orgId,
      claimed.body.data.upload.url as string,
      PNG,
    );
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.data.sizeBytes).toBe(PNG.length);
    expect(uploaded.body.data.contentType).toBe('image/png');

    const replayUpload = await upload(
      team.agent,
      team.orgId,
      claimed.body.data.upload.url as string,
      PNG,
    );
    expect(replayUpload.status).toBe(404);
    expect(replayUpload.body.error.code).toBe('UPLOAD_AUTHORIZATION_INVALID');

    const spoofedKey = await complete(team.agent, team.orgId, requestId, {
      storageKey: '../../etc/passwd',
    });
    expect(spoofedKey.status).toBe(422);
    expect(spoofedKey.body.error.code).toBe('VALIDATION_ERROR');

    const completed = await complete(team.agent, team.orgId, requestId, {
      captureTimestamp: new Date().toISOString(),
    });
    expect(completed.status).toBe(200);
    expect(completed.body.data.screenshot.contentType).toBe('image/png');
    expect(completed.body.data.screenshot.fileSizeBytes).toBe(PNG.length);
    expect(JSON.stringify(completed.body)).not.toContain('storageKey');

    const screenshotId = completed.body.data.screenshot.id as string;

    const duplicateComplete = await complete(team.agent, team.orgId, requestId);
    expect(duplicateComplete.status).toBe(409);
    expect(duplicateComplete.body.error.code).toBe('SCREENSHOT_ALREADY_COMPLETED');

    const status = await request(app)
      .get(`${API}/admin/screenshot-requests/${requestId}`)
      .set(adminHeaders(team.ownerAuth, team.orgId));
    expect(status.status).toBe(200);
    expect(status.body.data.request.status).toBe('COMPLETED');
    expect(status.body.data.request.screenshot.id).toBe(screenshotId);

    const employeeRequests = await request(app)
      .get(`${API}/admin/employees/${team.employee.user.id}/screenshot-requests`)
      .set(adminHeaders(team.ownerAuth, team.orgId));
    expect(employeeRequests.status).toBe(200);
    expect(employeeRequests.body.meta.total).toBe(1);
    expect(employeeRequests.body.data[0].id).toBe(requestId);

    const organizationRequests = await request(app)
      .get(`${API}/admin/screenshot-requests`)
      .query({ employeeId: team.employee.user.id, status: 'COMPLETED' })
      .set(adminHeaders(team.ownerAuth, team.orgId));
    expect(organizationRequests.status).toBe(200);
    expect(organizationRequests.body.meta.total).toBe(1);
    expect(organizationRequests.body.data[0].id).toBe(requestId);

    const list = await request(app)
      .get(`${API}/admin/screenshots`)
      .set(adminHeaders(team.ownerAuth, team.orgId));
    expect(list.status).toBe(200);
    expect(list.body.meta.total).toBe(1);
    expect(list.body.data[0].id).toBe(screenshotId);

    const access = await request(app)
      .post(`${API}/admin/screenshots/${screenshotId}/access`)
      .set(adminHeaders(team.ownerAuth, team.orgId))
      .send({});
    expect(access.status).toBe(200);
    const downloadUrl = access.body.data.url as string;
    expect(downloadUrl).toContain('/api/v1/screenshot-files/');

    const downloadPath = new URL(downloadUrl).pathname;
    const downloaded = await request(app).get(downloadPath);
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers['content-type']).toBe('image/png');
    expect(downloaded.headers['cache-control']).toContain('no-store');
    expect(downloaded.headers['x-request-id']).toBeTruthy();

    const tampered = await request(app).get(`${downloadPath}x`);
    expect(tampered.status).toBe(404);

    const actions = await AuditEvent.findAll({ order: [['createdAt', 'ASC']] });
    const actionNames = actions.map((event) => event.action);
    expect(actionNames).toContain('SCREENSHOT_REQUEST_CREATED');
    expect(actionNames).toContain('SCREENSHOT_REQUEST_ACKNOWLEDGED');
    expect(actionNames).toContain('SCREENSHOT_REQUEST_CLAIMED');
    expect(actionNames).toContain('SCREENSHOT_REQUEST_COMPLETED');
    expect(actionNames).toContain('SCREENSHOT_ACCESS_GRANTED');
    expect(actionNames).toContain('SCREENSHOT_VIEWED');

    await new Promise((resolve) => setTimeout(resolve, 2_200));
    const expired = await request(app).get(downloadPath);
    expect(expired.status).toBe(404);
    expect(expired.body.error.code).toBe('SCREENSHOT_LINK_INVALID');
  });

  it('exposes organization-scoped screenshot audit history without storage secrets', async () => {
    const team = await createTeam();
    await enablePolicy(team.ownerAuth, team.orgId);

    const created = await createRequest(team.ownerAuth, team.orgId, team.employee.user.id);
    expect(created.status).toBe(201);
    const requestId = created.body.data.request.id as string;

    const claimed = await claim(team.agent, team.orgId, requestId);
    expect(claimed.status).toBe(200);
    const uploaded = await upload(
      team.agent,
      team.orgId,
      claimed.body.data.upload.url as string,
      PNG,
    );
    expect(uploaded.status).toBe(201);
    const completed = await complete(team.agent, team.orgId, requestId);
    expect(completed.status).toBe(200);

    const history = await request(app)
      .get(`${API}/admin/screenshot-audit-events`)
      .set(adminHeaders(team.ownerAuth, team.orgId));
    expect(history.status).toBe(200);
    const actions = (history.body.data as Array<{ action: string }>).map((row) => row.action);
    expect(actions).toContain('SCREENSHOT_REQUEST_CREATED');
    expect(actions).toContain('SCREENSHOT_REQUEST_CLAIMED');
    expect(actions).toContain('SCREENSHOT_REQUEST_COMPLETED');
    const createdEvent = (
      history.body.data as Array<{ action: string; actor?: { email: string } }>
    ).find((row) => row.action === 'SCREENSHOT_REQUEST_CREATED');
    expect(createdEvent?.actor?.email).toBe(team.owner.email);
    expect(JSON.stringify(history.body)).not.toContain('storageKey');
    expect(JSON.stringify(history.body)).not.toContain('uploadToken');
    expect(JSON.stringify(history.body)).not.toContain('organizations/');

    const filtered = await request(app)
      .get(`${API}/admin/screenshot-audit-events`)
      .query({ requestId, action: 'SCREENSHOT_REQUEST_CLAIMED' })
      .set(adminHeaders(team.ownerAuth, team.orgId));
    expect(filtered.status).toBe(200);
    expect(filtered.body.meta.total).toBe(1);
    expect(filtered.body.data[0].screenshotRequestId).toBe(requestId);
    expect(filtered.body.data[0].targetEmployee.id).toBe(team.employee.user.id);

    const outsider = await createOwner(uniqueEmail('shot-outsider'), 'Other Audit Org');
    const outsiderAuth = await desktopAuth(outsider.email);
    const crossOrganization = await request(app)
      .get(`${API}/admin/screenshot-audit-events`)
      .set(adminHeaders(outsiderAuth, team.orgId));
    expect([403, 404]).toContain(crossOrganization.status);

    const managerTeam = await createTeam({ manager: true });
    await enablePolicy(managerTeam.ownerAuth, managerTeam.orgId);
    const managerDenied = await request(app)
      .get(`${API}/admin/screenshot-audit-events`)
      .set(adminHeaders(managerTeam.managerAuth!, managerTeam.orgId));
    expect(managerDenied.status).toBe(403);
    expect(managerDenied.body.error.code).toBe('SCREENSHOT_ROLE_NOT_ALLOWED');
  });

  it('rejects claims and uploads from a different authenticated agent', async () => {
    const team = await createTeam();
    await enablePolicy(team.ownerAuth, team.orgId);

    const secondEmployee = await inviteAndAccept(team.owner, {
      role: 'EMPLOYEE',
      name: 'Second Employee',
      email: uniqueEmail('second-employee'),
    });
    const secondAuth = await desktopAuth(secondEmployee.email);
    const secondAgent = await registerAgent(secondAuth, team.orgId, { name: 'Second Desktop' });
    const secondSession = await request(app)
      .post(`${API}/organizations/${team.orgId}/time-sessions/start`)
      .set(secondAgent.headers)
      .send({});
    expect(secondSession.status).toBe(201);

    const created = await createRequest(team.ownerAuth, team.orgId, team.employee.user.id);
    const requestId = created.body.data.request.id as string;

    const wrongClaim = await claim(secondAgent, team.orgId, requestId);
    expect(wrongClaim.status).toBe(404);

    const claimed = await claim(team.agent, team.orgId, requestId);
    expect(claimed.status).toBe(200);

    const wrongUpload = await upload(
      secondAgent,
      team.orgId,
      claimed.body.data.upload.url as string,
      PNG,
    );
    expect(wrongUpload.status).toBe(404);
    expect(wrongUpload.body.error.code).toBe('UPLOAD_AUTHORIZATION_INVALID');

    const otherOwner = await createOwner(uniqueEmail('other-owner'), 'Other Org');
    const otherAuth = await desktopAuth(otherOwner.email);
    const crossOrg = await request(app)
      .get(`${API}/admin/screenshot-requests/${requestId}`)
      .set(adminHeaders(otherAuth, otherOwner.organization.id));
    expect(crossOrg.status).toBe(404);
  });

  it('validates content type, image signature, size, and expired upload authorization', async () => {
    const team = await createTeam();
    await enablePolicy(team.ownerAuth, team.orgId);
    const created = await createRequest(team.ownerAuth, team.orgId, team.employee.user.id);
    const requestId = created.body.data.request.id as string;
    const claimed = await claim(team.agent, team.orgId, requestId, 'image/png');
    const uploadUrl = claimed.body.data.upload.url as string;

    const wrongType = await upload(team.agent, team.orgId, uploadUrl, PNG, 'text/plain');
    expect(wrongType.status).toBe(415);

    const invalidSignature = await upload(
      team.agent,
      team.orgId,
      uploadUrl,
      Buffer.from('this is definitely not a png'),
    );
    expect(invalidSignature.status).toBe(422);
    expect(invalidSignature.body.error.code).toBe('INVALID_SCREENSHOT_FILE');

    const mismatch = await upload(team.agent, team.orgId, uploadUrl, JPEG, 'image/jpeg');
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.error.code).toBe('SCREENSHOT_CONTENT_TYPE_MISMATCH');

    const oversized = await upload(
      team.agent,
      team.orgId,
      uploadUrl,
      Buffer.concat([PNG, Buffer.alloc(5_000, 0x33)]),
    );
    expect(oversized.status).toBe(413);

    const empty = await upload(team.agent, team.orgId, uploadUrl, Buffer.alloc(0));
    expect(empty.status).toBe(422);

    await ScreenshotRequest.update(
      { uploadExpiresAt: new Date(Date.now() - 1_000) },
      { where: { id: requestId } },
    );
    const expiredUpload = await upload(team.agent, team.orgId, uploadUrl, PNG);
    expect(expiredUpload.status).toBe(410);
    expect(expiredUpload.body.error.code).toBe('UPLOAD_AUTHORIZATION_EXPIRED');

    const maintenance = await runScreenshotMaintenance();
    expect(maintenance.abandonedUploads).toBeGreaterThanOrEqual(1);
    const request = await ScreenshotRequest.findByPk(requestId);
    expect(request?.status).toBe('EXPIRED');
    expect(request?.failureCode).toBe('UPLOAD_TIMEOUT');
  });

  it('reissues an expired upload authorization without allowing a completed upload to be overwritten', async () => {
    const team = await createTeam();
    await enablePolicy(team.ownerAuth, team.orgId);
    const created = await createRequest(team.ownerAuth, team.orgId, team.employee.user.id);
    const requestId = created.body.data.request.id as string;
    const claimed = await claim(team.agent, team.orgId, requestId);
    expect(claimed.status).toBe(200);
    const originalUrl = claimed.body.data.upload.url as string;

    await ScreenshotRequest.update(
      { uploadExpiresAt: new Date(Date.now() - 1_000) },
      { where: { id: requestId } },
    );
    const expired = await upload(team.agent, team.orgId, originalUrl, PNG);
    expect(expired.status).toBe(410);
    expect(expired.body.error.code).toBe('UPLOAD_AUTHORIZATION_EXPIRED');

    const reauthorized = await request(app)
      .post(`${API}/agent/screenshot-requests/${requestId}/upload-authorization`)
      .set(agentHeaders(team.agent, team.orgId))
      .send({ contentType: 'image/png' });
    expect(reauthorized.status).toBe(200);
    const replacementUrl = reauthorized.body.data.upload.url as string;
    expect(replacementUrl).not.toBe(originalUrl);

    const uploaded = await upload(team.agent, team.orgId, replacementUrl, PNG);
    expect(uploaded.status).toBe(201);

    const afterUpload = await request(app)
      .post(`${API}/agent/screenshot-requests/${requestId}/upload-authorization`)
      .set(agentHeaders(team.agent, team.orgId))
      .send({ contentType: 'image/png' });
    expect(afterUpload.status).toBe(409);
    expect(afterUpload.body.error.code).toBe('SCREENSHOT_ALREADY_UPLOADED');
  });

  it('reports offline delivery truthfully and expires overdue requests', async () => {
    const team = await createTeam();
    await enablePolicy(team.ownerAuth, team.orgId);
    await DesktopAgent.update(
      { lastSeenAt: new Date(Date.now() - 10 * 60_000) },
      { where: { id: team.agent.id } },
    );

    const created = await createRequest(team.ownerAuth, team.orgId, team.employee.user.id);
    expect(created.status).toBe(201);
    expect(created.body.data.delivery.agentOnline).toBe(false);
    expect(created.body.data.delivery.delivered).toBe(false);
    expect(created.body.data.request.status).toBe('PENDING');

    const requestId = created.body.data.request.id as string;
    await ScreenshotRequest.update(
      { expiresAt: new Date(Date.now() - 1_000) },
      { where: { id: requestId } },
    );

    const status = await request(app)
      .get(`${API}/admin/screenshot-requests/${requestId}`)
      .set(adminHeaders(team.ownerAuth, team.orgId));
    expect(status.status).toBe(200);
    expect(status.body.data.request.status).toBe('EXPIRED');
    expect(status.body.data.request.failure.code).toBe('REQUEST_TIMEOUT');

    const claimAfterExpiry = await claim(team.agent, team.orgId, requestId);
    expect(claimAfterExpiry.status).toBe(409);
    expect(claimAfterExpiry.body.error.code).toBe('SCREENSHOT_REQUEST_EXPIRED');
  });

  it('cancels requests, blocks a second cancel, and applies the request cooldown', async () => {
    const team = await createTeam({ manager: true });
    await enablePolicy(team.ownerAuth, team.orgId, { requestCooldownSeconds: 60 });

    const created = await createRequest(team.ownerAuth, team.orgId, team.employee.user.id);
    expect(created.status).toBe(201);
    const requestId = created.body.data.request.id as string;

    const cancelled = await request(app)
      .post(`${API}/admin/screenshot-requests/${requestId}/cancel`)
      .set(adminHeaders(team.ownerAuth, team.orgId))
      .send({});
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.request.status).toBe('CANCELLED');

    const cancelAgain = await request(app)
      .post(`${API}/admin/screenshot-requests/${requestId}/cancel`)
      .set(adminHeaders(team.ownerAuth, team.orgId))
      .send({});
    expect(cancelAgain.status).toBe(409);
    expect(cancelAgain.body.error.code).toBe('SCREENSHOT_REQUEST_NOT_CANCELLABLE');

    const claimCancelled = await claim(team.agent, team.orgId, requestId);
    expect(claimCancelled.status).toBe(409);
    expect(claimCancelled.body.error.code).toBe('SCREENSHOT_REQUEST_NOT_ACTIVE');

    const cooldown = await createRequest(team.ownerAuth, team.orgId, team.employee.user.id);
    expect(cooldown.status).toBe(429);
    expect(cooldown.body.error.code).toBe('SCREENSHOT_REQUEST_COOLDOWN');

    await expect(
      cancelScreenshotRequestService({
        organizationId: team.orgId,
        requestId,
        actorUserId: team.manager!.user.id,
        actorRole: 'MANAGER',
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('enforces service-level authorization for capture, policy, cancellation, and access', async () => {
    const team = await createTeam({ manager: true });
    await enablePolicy(team.ownerAuth, team.orgId);
    const created = await createRequest(team.ownerAuth, team.orgId, team.employee.user.id);
    const requestId = created.body.data.request.id as string;
    const claimed = await claim(team.agent, team.orgId, requestId);
    expect(claimed.status).toBe(200);
    const uploaded = await upload(
      team.agent,
      team.orgId,
      claimed.body.data.upload.url as string,
      PNG,
    );
    expect(uploaded.status).toBe(201);
    const completed = await complete(team.agent, team.orgId, requestId);
    const screenshotId = completed.body.data.screenshot.id as string;

    await expect(
      createScreenshotRequestService({
        organizationId: team.orgId,
        employeeId: team.employee.user.id,
        actorUserId: team.manager!.user.id,
        actorRole: 'MANAGER',
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    await expect(
      updateScreenshotPolicy({
        organizationId: team.orgId,
        actorUserId: team.manager!.user.id,
        actorRole: 'MANAGER',
        input: { enabled: false },
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    await expect(
      createScreenshotAccessService({
        organizationId: team.orgId,
        screenshotId,
        actorUserId: team.employee.user.id,
        actorRole: 'EMPLOYEE',
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    await expect(
      listScreenshotRequestsForEmployee({
        organizationId: team.orgId,
        employeeId: team.employee.user.id,
        actorRole: 'MANAGER',
        page: 1,
        limit: 20,
      }),
    ).rejects.toMatchObject({ code: 'SCREENSHOT_ROLE_NOT_ALLOWED' });

    const policyUpdate = await enablePolicy(team.ownerAuth, team.orgId, {
      viewRoles: ['OWNER', 'ADMIN', 'MANAGER'],
    });
    expect(policyUpdate.status).toBe(200);
    const managerView = await listScreenshotRequestsForEmployee({
      organizationId: team.orgId,
      employeeId: team.employee.user.id,
      actorRole: 'MANAGER',
      page: 1,
      limit: 20,
    });
    expect(managerView.meta.total).toBe(1);
  });

  it('validates policy role containment and rejects invalid updates', async () => {
    const team = await createTeam();
    await enablePolicy(team.ownerAuth, team.orgId);

    const invalid = await request(app)
      .patch(`${API}/admin/screenshot-policy`)
      .set(adminHeaders(team.ownerAuth, team.orgId))
      .send({
        requestRoles: ['OWNER', 'ADMIN'],
        viewRoles: ['OWNER'],
      });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');

    const duplicateRoles = await request(app)
      .patch(`${API}/admin/screenshot-policy`)
      .set(adminHeaders(team.ownerAuth, team.orgId))
      .send({ requestRoles: ['OWNER', 'OWNER'] });
    expect(duplicateRoles.status).toBe(422);
  });

  it('deletes expired screenshots and audit rows during retention maintenance', async () => {
    const team = await createTeam();
    await enablePolicy(team.ownerAuth, team.orgId, { retentionDays: 1, auditRetentionDays: 1 });
    const { requestId } = await captureOne(team);

    const screenshot = await Screenshot.findOne({ where: { screenshotRequestId: requestId } });
    expect(screenshot).not.toBeNull();
    const storageKey = screenshot!.storageKey;
    expect(await screenshotStorage.statObject(storageKey)).not.toBeNull();

    await Screenshot.update(
      { retentionExpiresAt: new Date(Date.now() - 1_000) },
      { where: { id: screenshot!.id } },
    );

    const maintenance = await runScreenshotMaintenance();
    expect(maintenance.screenshotsDeleted).toBeGreaterThanOrEqual(1);
    expect(await Screenshot.findByPk(screenshot!.id)).toBeNull();
    expect(await screenshotStorage.statObject(storageKey)).toBeNull();

    const request = await ScreenshotRequest.findByPk(requestId);
    expect(request?.storageKey).toBeNull();
    expect(
      await AuditEvent.count({ where: { action: 'SCREENSHOT_DELETED' } }),
    ).toBeGreaterThanOrEqual(1);

    const policy = await ScreenshotPolicy.findOne({ where: { organizationId: team.orgId } });
    expect(policy).not.toBeNull();
    const oldAudit = await AuditEvent.findOne({
      where: { organizationId: team.orgId, action: 'SCREENSHOT_POLICY_UPDATED' },
    });
    expect(oldAudit).not.toBeNull();
    const oldTimestamp = new Date(Date.now() - 3 * 86_400_000);
    await AuditEvent.update(
      { createdAt: oldTimestamp },
      { where: { id: oldAudit!.id }, silent: true },
    );
    const foreignAudit = await AuditEvent.create({
      organizationId: team.orgId,
      actorUserId: null,
      targetEmployeeId: null,
      action: 'NON_SCREENSHOT_ACTION' as never,
      entityType: 'OTHER',
      entityId: null,
      screenshotRequestId: null,
      screenshotId: null,
      metadata: {},
      ipAddress: null,
      userAgent: null,
    });
    await AuditEvent.update(
      { createdAt: oldTimestamp },
      { where: { id: foreignAudit.id }, silent: true },
    );
    const reloadedAudit = await AuditEvent.findByPk(oldAudit!.id);
    expect(reloadedAudit!.createdAt.getTime()).toBe(oldTimestamp.getTime());
    expect(policy!.auditRetentionDays).toBe(1);
    const auditMaintenance = await runScreenshotMaintenance();
    expect(auditMaintenance.auditEventsDeleted).toBeGreaterThanOrEqual(1);
    expect(await AuditEvent.findByPk(oldAudit!.id)).toBeNull();
    expect(await AuditEvent.findByPk(foreignAudit.id)).not.toBeNull();
  });

  it('removes the private object when a request is cancelled after a claim', async () => {
    const team = await createTeam();
    await enablePolicy(team.ownerAuth, team.orgId);
    const { requestId } = await captureOne(team, { complete: false });

    const storedRequest = await ScreenshotRequest.findByPk(requestId);
    expect(storedRequest?.storageKey).toBeTruthy();
    expect(await screenshotStorage.statObject(storedRequest!.storageKey!)).not.toBeNull();

    const cancelled = await request(app)
      .post(`${API}/admin/screenshot-requests/${requestId}/cancel`)
      .set(adminHeaders(team.ownerAuth, team.orgId))
      .send({});
    expect(cancelled.status).toBe(200);
    expect(await screenshotStorage.statObject(storedRequest!.storageKey!)).toBeNull();
    expect((await ScreenshotRequest.findByPk(requestId))?.storageKey).toBeNull();
  });

  it('rejects completion if the request expires after a successful upload', async () => {
    const team = await createTeam();
    await enablePolicy(team.ownerAuth, team.orgId);
    const { requestId } = await captureOne(team, { complete: false });

    await ScreenshotRequest.update(
      { expiresAt: new Date(Date.now() - 1_000) },
      { where: { id: requestId } },
    );
    const expired = await complete(team.agent, team.orgId, requestId);
    expect(expired.status).toBe(409);
    expect(expired.body.error.code).toBe('SCREENSHOT_REQUEST_EXPIRED');

    const request = await ScreenshotRequest.findByPk(requestId);
    expect(request?.status).toBe('EXPIRED');
    expect(await Screenshot.count({ where: { screenshotRequestId: requestId } })).toBe(0);
  });

  it('does not expose screenshot objects through a forged storage key', async () => {
    const team = await createTeam();
    await enablePolicy(team.ownerAuth, team.orgId);
    const { requestId } = await captureOne(team);
    const screenshot = await Screenshot.findOne({ where: { screenshotRequestId: requestId } });

    const forgedAccess = await request(app)
      .post(`${API}/admin/screenshots/${screenshot!.id}/access`)
      .set(adminHeaders(team.ownerAuth, team.orgId))
      .send({ storageKey: 'organizations/other/secret.png' });
    // Access only needs the screenshot ID; arbitrary body fields are ignored.
    expect(forgedAccess.status).toBe(200);

    const otherOrg = await createOwner(uniqueEmail('other-org'), 'Yet Another Org');
    const otherAuth = await desktopAuth(otherOrg.email);
    const crossOrgAccess = await request(app)
      .post(`${API}/admin/screenshots/${screenshot!.id}/access`)
      .set(adminHeaders(otherAuth, otherOrg.organization.id))
      .send({});
    expect(crossOrgAccess.status).toBe(404);

    const badToken = await request(app).get(`${API}/screenshot-files/not-a-valid-signed-token`);
    expect(badToken.status).toBe(404);
    expect(badToken.body.error.code).toBe('SCREENSHOT_LINK_INVALID');
  });
});
