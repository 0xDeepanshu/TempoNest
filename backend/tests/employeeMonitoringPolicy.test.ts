import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AuditEvent,
  EmployeeMonitoringPolicy,
  Membership,
  Screenshot,
  ScreenshotRequest,
  User,
} from '../src/database';
import {
  ScreenshotPolicy,
  ScreenshotPolicyAcknowledgement,
} from '../src/database';
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

function headers(auth: { headers: Record<string, string> }, organizationId: string) {
  return { ...auth.headers, 'x-organization-id': organizationId };
}

async function createTeam(options: { extraEmployee?: boolean } = {}) {
  const owner = await createOwner(uniqueEmail('mon-owner'), 'Monitoring Policy Org');
  const ownerAuth = await desktopAuth(owner.email);
  const employee = await inviteAndAccept(owner, {
    role: 'EMPLOYEE',
    name: 'Monitored Employee',
    email: uniqueEmail('mon-employee'),
  });
  const employeeAuth = await desktopAuth(employee.email);
  const agent = await registerAgent(employeeAuth, owner.organization.id);
  const started = await request(app)
    .post(`${API}/organizations/${owner.organization.id}/time-sessions/start`)
    .set(agent.headers)
    .send({});
  if (started.status !== 201) throw new Error(JSON.stringify(started.body));

  let secondEmployee: Awaited<ReturnType<typeof inviteAndAccept>> | null = null;
  if (options.extraEmployee) {
    secondEmployee = await inviteAndAccept(owner, {
      role: 'EMPLOYEE',
      name: 'Other Employee',
      email: uniqueEmail('mon-other'),
    });
  }

  return {
    owner,
    ownerAuth,
    employee,
    employeeAuth,
    agent,
    secondEmployee,
    orgId: owner.organization.id as string,
    sessionId: started.body.data.session.id as string,
  };
}

async function enableOrganizationPolicy(
  ownerAuth: { headers: Record<string, string> },
  orgId: string,
) {
  const response = await request(app)
    .patch(`${API}/admin/screenshot-policy`)
    .set(headers(ownerAuth, orgId))
    .send({
      enabled: true,
      requestCooldownSeconds: 0,
      retentionDays: 1,
      auditRetentionDays: 30,
      disclosureVersion: 'v1',
      disclosureText: 'Authorized administrators may capture screenshots and view the live screen.',
    });
  expect(response.status).toBe(200);
}

function setEmployeePolicy(
  ownerAuth: { headers: Record<string, string> },
  orgId: string,
  employeeId: string,
  enabled: boolean,
) {
  return request(app)
    .patch(`${API}/admin/employees/${employeeId}/monitoring-policy`)
    .set(headers(ownerAuth, orgId))
    .send({ enabled });
}

function getEmployeePolicy(
  auth: { headers: Record<string, string> },
  orgId: string,
  employeeId: string,
) {
  return request(app)
    .get(`${API}/admin/employees/${employeeId}/monitoring-policy`)
    .set(headers(auth, orgId));
}

function createRequest(
  auth: { headers: Record<string, string> },
  orgId: string,
  employeeId: string,
) {
  return request(app)
    .post(`${API}/admin/employees/${employeeId}/screenshot-requests`)
    .set(headers(auth, orgId))
    .send({});
}

async function createCompletedScreenshot(team: Awaited<ReturnType<typeof createTeam>>) {
  const screenshotRequestId = randomUUID();
  await ScreenshotRequest.create({
    id: screenshotRequestId,
    organizationId: team.orgId,
    employeeId: team.employee.user.id,
    requestingAdminId: team.owner.user.id,
    desktopAgentId: team.agent.id,
    timeSessionId: team.sessionId,
    status: 'COMPLETED',
    requestedAt: new Date(Date.now() - 60_000),
    expiresAt: new Date(Date.now() + 60_000),
    claimedAt: new Date(Date.now() - 50_000),
    completedAt: new Date(Date.now() - 40_000),
    storageKey: `organizations/${team.orgId}/screenshots/${screenshotRequestId}/capture.png`,
    uploadedAt: new Date(Date.now() - 40_000),
    uploadedSize: 128,
    uploadedContentType: 'image/png',
    expectedContentType: 'image/png',
  });
  const screenshot = await Screenshot.create({
    organizationId: team.orgId,
    employeeId: team.employee.user.id,
    timeSessionId: team.sessionId,
    screenshotRequestId,
    requestingAdminId: team.owner.user.id,
    capturedAt: new Date(Date.now() - 40_000),
    storageKey: `organizations/${team.orgId}/screenshots/${screenshotRequestId}/capture.png`,
    contentType: 'image/png',
    fileSizeBytes: 128,
    retentionExpiresAt: new Date(Date.now() + 86_400_000),
  });
  return screenshot;
}

describe('per-employee screen monitoring policy', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('enables monitoring by default and leaves scheduled capture on Never', async () => {
    const team = await createTeam();
    await enableOrganizationPolicy(team.ownerAuth, team.orgId);

    const response = await getEmployeePolicy(team.ownerAuth, team.orgId, team.employee.user.id);
    expect(response.status).toBe(200);
    expect(response.body.data.policy).toMatchObject({
      employeeId: team.employee.user.id,
      enabled: true,
      scheduledCaptureEnabled: false,
      scheduledCaptureActive: false,
      captureIntervalMinutes: 30,
      nextCaptureAt: null,
      organizationEnabled: true,
      effectiveEnabled: true,
      lastCaptureAt: null,
      updatedBy: null,
    });
    const row = await EmployeeMonitoringPolicy.findOne({
      where: { organizationId: team.orgId, employeeId: team.employee.user.id },
    });
    expect(row?.enabled).toBe(true);
    expect(row?.scheduledCaptureEnabled).toBe(false);
    expect(row?.captureIntervalMinutes).toBe(30);
    expect(row?.nextCaptureAt).toBeNull();

    const disclosure = await request(app)
      .get(`${API}/screenshot-policy`)
      .set(headers(team.employeeAuth, team.orgId));
    expect(disclosure.status).toBe(200);
    expect(disclosure.body.data.policy.enabled).toBe(true);
  });

  it('lets an owner enable scheduled capture and records the actor, target, organization, and change', async () => {
    const team = await createTeam();
    await enableOrganizationPolicy(team.ownerAuth, team.orgId);

    const updated = await request(app)
      .patch(`${API}/admin/employees/${team.employee.user.id}/monitoring-policy`)
      .set(headers(team.ownerAuth, team.orgId))
      .send({ scheduledCaptureEnabled: true, captureIntervalMinutes: 15 });
    expect(updated.status).toBe(200);
    expect(updated.body.data.policy).toMatchObject({
      enabled: true,
      scheduledCaptureEnabled: true,
      scheduledCaptureActive: true,
      captureIntervalMinutes: 15,
      organizationEnabled: true,
      effectiveEnabled: true,
      updatedBy: {
        id: team.owner.user.id,
        email: team.owner.email,
      },
    });
    expect(updated.body.data.policy.updatedAt).toBeTruthy();
    expect(updated.body.data.policy.nextCaptureAt).toBeTruthy();

    const audit = await AuditEvent.findOne({
      where: {
        organizationId: team.orgId,
        action: 'EMPLOYEE_MONITORING_POLICY_UPDATED',
        targetEmployeeId: team.employee.user.id,
      },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorUserId).toBe(team.owner.user.id);
    expect(audit?.entityType).toBe('EMPLOYEE_MONITORING_POLICY');
    expect(audit?.metadata).toMatchObject({
      employeeId: team.employee.user.id,
      previousValue: true,
      newValue: true,
      previousScheduledCaptureEnabled: false,
      scheduledCaptureEnabled: true,
      previousCaptureIntervalMinutes: 30,
      captureIntervalMinutes: 15,
      updatedByUserId: team.owner.user.id,
    });
    expect(typeof audit?.metadata.timestamp).toBe('string');

    const disabled = await setEmployeePolicy(
      team.ownerAuth,
      team.orgId,
      team.employee.user.id,
      false,
    );
    expect(disabled.body.data.policy).toMatchObject({
      enabled: false,
      nextCaptureAt: null,
    });

    const disclosure = await request(app)
      .get(`${API}/screenshot-policy`)
      .set(headers(team.employeeAuth, team.orgId));
    expect(disclosure.body.data.policy.enabled).toBe(false);
  });

  it('does not duplicate the audit row when the value is unchanged', async () => {
    const team = await createTeam();
    await enableOrganizationPolicy(team.ownerAuth, team.orgId);
    for (let index = 0; index < 2; index += 1) {
      await request(app)
        .patch(`${API}/admin/employees/${team.employee.user.id}/monitoring-policy`)
        .set(headers(team.ownerAuth, team.orgId))
        .send({ captureIntervalMinutes: 15 });
    }

    expect(
      await AuditEvent.count({
        where: {
          organizationId: team.orgId,
          action: 'EMPLOYEE_MONITORING_POLICY_UPDATED',
          targetEmployeeId: team.employee.user.id,
        },
      }),
    ).toBe(1);
  });

  it('lets authorized administrators and managers change the policy but never employees', async () => {
    const team = await createTeam();
    await enableOrganizationPolicy(team.ownerAuth, team.orgId);
    const admin = await inviteAndAccept(team.owner, {
      role: 'ADMIN',
      name: 'Monitoring Admin',
      email: uniqueEmail('mon-admin'),
    });
    const adminAuth = await desktopAuth(admin.email);
    const manager = await inviteAndAccept(team.owner, {
      role: 'MANAGER',
      name: 'Monitoring Manager',
      email: uniqueEmail('mon-manager'),
    });
    const managerAuth = await desktopAuth(manager.email);

    expect((await getEmployeePolicy(adminAuth, team.orgId, team.employee.user.id)).status).toBe(200);
    expect(
      (await setEmployeePolicy(adminAuth, team.orgId, team.employee.user.id, false)).status,
    ).toBe(200);

    expect((await getEmployeePolicy(managerAuth, team.orgId, team.employee.user.id)).status).toBe(
      403,
    );
    const managerAttempt = await setEmployeePolicy(
      managerAuth,
      team.orgId,
      team.employee.user.id,
      true,
    );
    expect(managerAttempt.status).toBe(403);

    const employeeAttempt = await setEmployeePolicy(
      team.employeeAuth,
      team.orgId,
      team.employee.user.id,
      true,
    );
    expect(employeeAttempt.status).toBe(403);

    // The owner can delegate only this monitoring capability to MANAGER
    // without granting the organization-wide policy permission.
    const grant = await team.owner.agent
      .patch(`${API}/organizations/${team.orgId}/roles/MANAGER`)
      .set('x-csrf-token', team.owner.csrf)
      .send({
        permissions: ['organization:read', 'screenshot:read', 'screenshot:monitoring'],
      });
    expect(grant.status).toBe(200);

    const authorizedManager = await setEmployeePolicy(
      managerAuth,
      team.orgId,
      team.employee.user.id,
      true,
    );
    expect(authorizedManager.status).toBe(200);
    expect(authorizedManager.body.data.policy.enabled).toBe(true);
  });

  it('never changes roles, account status, or membership status', async () => {
    const team = await createTeam();
    await enableOrganizationPolicy(team.ownerAuth, team.orgId);
    const before = await Membership.findOne({
      where: { organizationId: team.orgId, userId: team.employee.user.id },
    });
    const userBefore = await User.findByPk(team.employee.user.id);

    await setEmployeePolicy(team.ownerAuth, team.orgId, team.employee.user.id, true);
    await setEmployeePolicy(team.ownerAuth, team.orgId, team.employee.user.id, false);

    const after = await Membership.findOne({
      where: { organizationId: team.orgId, userId: team.employee.user.id },
    });
    const userAfter = await User.findByPk(team.employee.user.id);
    expect(after?.role).toBe(before?.role);
    expect(after?.status).toBe(before?.status);
    expect(userAfter?.status).toBe(userBefore?.status);
  });

  it('blocks screenshot requests for a disabled employee', async () => {
    const team = await createTeam();
    await enableOrganizationPolicy(team.ownerAuth, team.orgId);
    await setEmployeePolicy(team.ownerAuth, team.orgId, team.employee.user.id, false);

    const blocked = await createRequest(team.ownerAuth, team.orgId, team.employee.user.id);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('EMPLOYEE_MONITORING_POLICY_DISABLED');

    await setEmployeePolicy(team.ownerAuth, team.orgId, team.employee.user.id, true);
    const allowed = await createRequest(team.ownerAuth, team.orgId, team.employee.user.id);
    expect(allowed.status).toBe(201);
  });

  it('cancels a pending request, clears upload state, and blocks the agent when disabled', async () => {
    const team = await createTeam();
    await enableOrganizationPolicy(team.ownerAuth, team.orgId);
    await setEmployeePolicy(team.ownerAuth, team.orgId, team.employee.user.id, true);
    const created = await createRequest(team.ownerAuth, team.orgId, team.employee.user.id);
    expect(created.status).toBe(201);
    const requestId = created.body.data.request.id as string;

    const claimed = await request(app)
      .post(`${API}/agent/screenshot-requests/${requestId}/claim`)
      .set(headers(team.agent, team.orgId))
      .send({});
    expect(claimed.status).toBe(200);
    expect(claimed.body.data.upload).toBeTruthy();

    const disabled = await setEmployeePolicy(
      team.ownerAuth,
      team.orgId,
      team.employee.user.id,
      false,
    );
    expect(disabled.status).toBe(200);

    const record = await ScreenshotRequest.findByPk(requestId);
    expect(record?.status).toBe('CANCELLED');
    expect(record?.failureCode).toBe('EMPLOYEE_MONITORING_DISABLED');
    expect(record?.uploadTokenHash).toBeNull();
    expect(record?.uploadExpiresAt).toBeNull();

    const pending = await request(app)
      .get(`${API}/agent/screenshot-requests/pending`)
      .set(headers(team.agent, team.orgId));
    expect(pending.status).toBe(200);
    expect(pending.body.data.requests).toEqual([]);

    const acknowledge = await request(app)
      .post(`${API}/agent/screenshot-requests/${requestId}/ack`)
      .set(headers(team.agent, team.orgId))
      .send({});
    expect(acknowledge.status).toBe(403);
    expect(acknowledge.body.error.code).toBe('EMPLOYEE_MONITORING_POLICY_DISABLED');
  });

  it('excludes disabled employees from request and screenshot review while retaining history', async () => {
    const team = await createTeam();
    await enableOrganizationPolicy(team.ownerAuth, team.orgId);
    await setEmployeePolicy(team.ownerAuth, team.orgId, team.employee.user.id, true);
    const screenshot = await createCompletedScreenshot(team);
    const auditBefore = await AuditEvent.count({ where: { organizationId: team.orgId } });

    const before = await request(app)
      .get(`${API}/admin/screenshots`)
      .set(headers(team.ownerAuth, team.orgId));
    expect(before.body.meta.total).toBe(1);

    await setEmployeePolicy(team.ownerAuth, team.orgId, team.employee.user.id, false);

    const organizationList = await request(app)
      .get(`${API}/admin/screenshots`)
      .set(headers(team.ownerAuth, team.orgId));
    expect(organizationList.status).toBe(200);
    expect(organizationList.body.meta.total).toBe(0);

    const employeeList = await request(app)
      .get(`${API}/admin/screenshots?employeeId=${team.employee.user.id}`)
      .set(headers(team.ownerAuth, team.orgId));
    expect(employeeList.status).toBe(200);
    expect(employeeList.body.meta.total).toBe(0);

    const requests = await request(app)
      .get(`${API}/admin/screenshot-requests?employeeId=${team.employee.user.id}`)
      .set(headers(team.ownerAuth, team.orgId));
    expect(requests.status).toBe(200);
    expect(requests.body.meta.total).toBe(0);

    const employeeRequests = await request(app)
      .get(`${API}/admin/employees/${team.employee.user.id}/screenshot-requests`)
      .set(headers(team.ownerAuth, team.orgId));
    expect(employeeRequests.status).toBe(403);
    expect(employeeRequests.body.error.code).toBe('EMPLOYEE_MONITORING_POLICY_DISABLED');

    expect(await Screenshot.count({ where: { id: screenshot.id } })).toBe(1);
    expect(await AuditEvent.count({ where: { organizationId: team.orgId } })).toBeGreaterThanOrEqual(
      auditBefore,
    );
  });

  it('blocks direct screenshot metadata and access for a disabled employee', async () => {
    const team = await createTeam();
    await enableOrganizationPolicy(team.ownerAuth, team.orgId);
    await setEmployeePolicy(team.ownerAuth, team.orgId, team.employee.user.id, true);
    const screenshot = await createCompletedScreenshot(team);

    const allowed = await request(app)
      .get(`${API}/admin/screenshots/${screenshot.id}`)
      .set(headers(team.ownerAuth, team.orgId));
    expect(allowed.status).toBe(200);

    await setEmployeePolicy(team.ownerAuth, team.orgId, team.employee.user.id, false);

    const metadata = await request(app)
      .get(`${API}/admin/screenshots/${screenshot.id}`)
      .set(headers(team.ownerAuth, team.orgId));
    expect(metadata.status).toBe(403);
    expect(metadata.body.error.code).toBe('EMPLOYEE_MONITORING_POLICY_DISABLED');

    const access = await request(app)
      .post(`${API}/admin/screenshots/${screenshot.id}/access`)
      .set(headers(team.ownerAuth, team.orgId))
      .send({});
    expect(access.status).toBe(403);
    expect(access.body.error.code).toBe('EMPLOYEE_MONITORING_POLICY_DISABLED');
  });

  it('restores review access and keeps the disclosure acknowledgement when re-enabled', async () => {
    const team = await createTeam();
    await enableOrganizationPolicy(team.ownerAuth, team.orgId);
    await setEmployeePolicy(team.ownerAuth, team.orgId, team.employee.user.id, true);

    const acknowledged = await request(app)
      .post(`${API}/screenshot-policy/acknowledge`)
      .set(headers(team.employeeAuth, team.orgId))
      .send({});
    expect(acknowledged.status).toBe(200);
    expect(await ScreenshotPolicyAcknowledgement.count({ where: { organizationId: team.orgId } })).toBe(1);

    const screenshot = await createCompletedScreenshot(team);
    await setEmployeePolicy(team.ownerAuth, team.orgId, team.employee.user.id, false);
    await setEmployeePolicy(team.ownerAuth, team.orgId, team.employee.user.id, true);

    const metadata = await request(app)
      .get(`${API}/admin/screenshots/${screenshot.id}`)
      .set(headers(team.ownerAuth, team.orgId));
    expect(metadata.status).toBe(200);

    const disclosure = await request(app)
      .get(`${API}/screenshot-policy`)
      .set(headers(team.employeeAuth, team.orgId));
    expect(disclosure.body.data.policy.enabled).toBe(true);
    expect(disclosure.body.data.policy.disclosure.acknowledged).toBe(true);
  });

  it('isolates policies by organization and employee', async () => {
    const first = await createTeam({ extraEmployee: true });
    const second = await createTeam();
    await enableOrganizationPolicy(first.ownerAuth, first.orgId);
    await enableOrganizationPolicy(second.ownerAuth, second.orgId);

    const firstDefault = await getEmployeePolicy(
      first.ownerAuth,
      first.orgId,
      first.employee.user.id,
    );
    expect(firstDefault.body.data.policy.enabled).toBe(true);

    await setEmployeePolicy(first.ownerAuth, first.orgId, first.employee.user.id, false);

    const other = await getEmployeePolicy(
      first.ownerAuth,
      first.orgId,
      first.secondEmployee!.user.id,
    );
    expect(other.body.data.policy.enabled).toBe(true);

    const secondPolicy = await getEmployeePolicy(
      second.ownerAuth,
      second.orgId,
      second.employee.user.id,
    );
    expect(secondPolicy.body.data.policy.enabled).toBe(true);

    const crossOrganization = await getEmployeePolicy(
      second.ownerAuth,
      second.orgId,
      first.employee.user.id,
    );
    expect(crossOrganization.status).toBe(404);
    expect(crossOrganization.body.error.code).toBe('EMPLOYEE_NOT_FOUND');

    const crossUpdate = await setEmployeePolicy(
      second.ownerAuth,
      second.orgId,
      first.employee.user.id,
      true,
    );
    expect(crossUpdate.status).toBe(404);
  });

  it('reports per-employee monitoring state in live tracking without hiding the employee', async () => {
    const team = await createTeam({ extraEmployee: true });
    await enableOrganizationPolicy(team.ownerAuth, team.orgId);
    await setEmployeePolicy(team.ownerAuth, team.orgId, team.employee.user.id, true);
    await setEmployeePolicy(team.ownerAuth, team.orgId, team.secondEmployee!.user.id, false);

    const response = await request(app)
      .get(`${API}/organizations/${team.orgId}/reports/tracking-status`)
      .set(headers(team.ownerAuth, team.orgId));
    expect(response.status).toBe(200);

    const rows = response.body.data as Array<{
      employee: { id: string };
      monitoringEnabled: boolean;
    }>;
    const firstRow = rows.find((row) => row.employee.id === team.employee.user.id);
    const secondRow = rows.find((row) => row.employee.id === team.secondEmployee!.user.id);
    expect(firstRow?.monitoringEnabled).toBe(true);
    expect(secondRow?.monitoringEnabled).toBe(false);
  });

  it('leaves the organization policy disabled until an owner enables it', async () => {
    const team = await createTeam();
    expect(await ScreenshotPolicy.findOne({ where: { organizationId: team.orgId } })).toBeNull();

    const response = await getEmployeePolicy(team.ownerAuth, team.orgId, team.employee.user.id);
    expect(response.body.data.policy.enabled).toBe(true);
    expect(response.body.data.policy.scheduledCaptureEnabled).toBe(false);
    expect(response.body.data.policy.organizationEnabled).toBe(false);
    expect(response.body.data.policy.effectiveEnabled).toBe(false);
  });

  it('treats disabling an already-disabled employee as idempotent', async () => {
    const team = await createTeam();
    await enableOrganizationPolicy(team.ownerAuth, team.orgId);

    const first = await setEmployeePolicy(team.ownerAuth, team.orgId, team.employee.user.id, false);
    const second = await setEmployeePolicy(team.ownerAuth, team.orgId, team.employee.user.id, false);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const rows = await EmployeeMonitoringPolicy.findAll({
      where: { organizationId: team.orgId, employeeId: team.employee.user.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].enabled).toBe(false);
  });
});
