import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AuditEvent,
  EmployeeMonitoringPolicy,
  ScreenshotRequest,
} from '../src/database';
import { runDueScheduledCaptures } from '../src/modules/screenshots/screenshot.scheduler';
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

async function createTeam(options: { startSession?: boolean } = {}) {
  const owner = await createOwner(uniqueEmail('sched-owner'), 'Scheduled Capture Org');
  const ownerAuth = await desktopAuth(owner.email);
  const orgId = owner.organization.id as string;
  const employee = await inviteAndAccept(owner, {
    role: 'EMPLOYEE',
    name: 'Scheduled Employee',
    email: uniqueEmail('sched-employee'),
  });
  const employeeAuth = await desktopAuth(employee.email);
  const agent = await registerAgent(employeeAuth, orgId);

  let sessionId: string | null = null;
  if (options.startSession !== false) {
    const started = await request(app)
      .post(`${API}/organizations/${orgId}/time-sessions/start`)
      .set(agent.headers)
      .send({});
    if (started.status !== 201) throw new Error(JSON.stringify(started.body));
    sessionId = started.body.data.session.id as string;
  }

  return {
    owner,
    ownerAuth,
    employee,
    employeeAuth,
    agent,
    orgId,
    sessionId,
  };
}

function ownerHeaders(auth: { headers: Record<string, string> }, organizationId: string) {
  return { ...auth.headers, 'x-organization-id': organizationId };
}

async function enableOrganizationPolicy(
  auth: { headers: Record<string, string> },
  organizationId: string,
) {
  const response = await request(app)
    .patch(`${API}/admin/screenshot-policy`)
    .set(ownerHeaders(auth, organizationId))
    .send({ enabled: true, requestCooldownSeconds: 0 });
  expect(response.status).toBe(200);
}

function patchPolicy(
  auth: { headers: Record<string, string> },
  organizationId: string,
  employeeId: string,
  body: Record<string, unknown>,
) {
  return request(app)
    .patch(`${API}/admin/employees/${employeeId}/monitoring-policy`)
    .set(ownerHeaders(auth, organizationId))
    .send(body);
}

async function policyFor(organizationId: string, employeeId: string) {
  return EmployeeMonitoringPolicy.findOne({ where: { organizationId, employeeId } });
}

async function makeDue(organizationId: string, employeeId: string) {
  await EmployeeMonitoringPolicy.update(
    { nextCaptureAt: new Date(Date.now() - 60_000) },
    { where: { organizationId, employeeId } },
  );
}

describe('scheduled screenshot capture', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('enrols new employees with monitoring enabled and scheduled capture on Never', async () => {
    const team = await createTeam();
    const policy = await policyFor(team.orgId, team.employee.user.id);

    expect(policy).not.toBeNull();
    expect(policy!.enabled).toBe(true);
    expect(policy!.scheduledCaptureEnabled).toBe(false);
    expect(policy!.captureIntervalMinutes).toBe(30);
    expect(policy!.nextCaptureAt).toBeNull();

    const response = await request(app)
      .get(`${API}/admin/scheduled-capture`)
      .set(ownerHeaders(team.ownerAuth, team.orgId));
    expect(response.status).toBe(200);
    expect(response.body.data.employees).toContainEqual(
      expect.objectContaining({
        employeeId: team.employee.user.id,
        email: team.employee.email,
        scheduledCaptureEnabled: false,
        captureIntervalMinutes: 30,
      }),
    );
  });

  it('never captures an employee whose scheduled capture is disabled', async () => {
    const team = await createTeam();
    await enableOrganizationPolicy(team.ownerAuth, team.orgId);
    await makeDue(team.orgId, team.employee.user.id);

    const sweep = await runDueScheduledCaptures();
    expect(sweep.captured).toBe(0);
    expect(
      await ScreenshotRequest.count({
        where: { organizationId: team.orgId, employeeId: team.employee.user.id },
      }),
    ).toBe(0);
  });

  it('never captures while general monitoring is disabled', async () => {
    const team = await createTeam();
    await enableOrganizationPolicy(team.ownerAuth, team.orgId);
    await EmployeeMonitoringPolicy.update(
      {
        enabled: false,
        scheduledCaptureEnabled: true,
        nextCaptureAt: new Date(Date.now() - 60_000),
      },
      { where: { organizationId: team.orgId, employeeId: team.employee.user.id } },
    );

    const sweep = await runDueScheduledCaptures();
    expect(sweep.captured).toBe(0);
    expect(
      await ScreenshotRequest.count({
        where: { organizationId: team.orgId, employeeId: team.employee.user.id },
      }),
    ).toBe(0);
  });

  it('enables scheduled capture at 30 minutes and captures the due slot once', async () => {
    const team = await createTeam();
    await enableOrganizationPolicy(team.ownerAuth, team.orgId);

    const enabled = await patchPolicy(team.ownerAuth, team.orgId, team.employee.user.id, {
      scheduledCaptureEnabled: true,
      captureIntervalMinutes: 30,
    });
    expect(enabled.status).toBe(200);
    expect(enabled.body.data.policy).toMatchObject({
      enabled: true,
      scheduledCaptureEnabled: true,
      scheduledCaptureActive: true,
      captureIntervalMinutes: 30,
    });
    const next = new Date(enabled.body.data.policy.nextCaptureAt as string).getTime();
    expect(next).toBeGreaterThan(Date.now() + 25 * 60_000);
    expect(next).toBeLessThan(Date.now() + 35 * 60_000);

    await makeDue(team.orgId, team.employee.user.id);
    const first = await runDueScheduledCaptures();
    expect(first.captured).toBe(1);
    expect(first.deferred).toBe(0);

    const requests = await ScreenshotRequest.findAll({
      where: { organizationId: team.orgId, employeeId: team.employee.user.id },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].status).toBe('PENDING');
    expect(requests[0].requestingAdminId).toBe(team.employee.user.id);
    expect(requests[0].idempotencyKey).toMatch(/^scheduled:/);

    const audit = await AuditEvent.findOne({
      where: {
        organizationId: team.orgId,
        action: 'SCREENSHOT_REQUEST_CREATED',
        screenshotRequestId: requests[0].id,
      },
    });
    expect(audit?.metadata).toMatchObject({ scheduled: true });

    const advanced = await policyFor(team.orgId, team.employee.user.id);
    expect(advanced!.nextCaptureAt!.getTime()).toBeGreaterThan(Date.now() + 25 * 60_000);

    const second = await runDueScheduledCaptures();
    expect(second.captured).toBe(0);
    expect(
      await ScreenshotRequest.count({
        where: { organizationId: team.orgId, employeeId: team.employee.user.id },
      }),
    ).toBe(1);
  });

  it('disabling scheduled capture clears the slot and cancels pending scheduled requests', async () => {
    const team = await createTeam();
    await enableOrganizationPolicy(team.ownerAuth, team.orgId);
    const employeeId = team.employee.user.id;

    const scheduled = await ScreenshotRequest.create({
      id: randomUUID(),
      organizationId: team.orgId,
      employeeId,
      requestingAdminId: employeeId,
      desktopAgentId: team.agent.id,
      timeSessionId: team.sessionId,
      status: 'PENDING',
      requestedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      idempotencyKey: `scheduled:${employeeId}:${new Date().toISOString()}`,
    });
    await EmployeeMonitoringPolicy.update(
      { scheduledCaptureEnabled: true, nextCaptureAt: new Date(Date.now() + 30 * 60_000) },
      { where: { organizationId: team.orgId, employeeId } },
    );

    const disabled = await patchPolicy(team.ownerAuth, team.orgId, employeeId, {
      scheduledCaptureEnabled: false,
    });
    expect(disabled.status).toBe(200);
    expect(disabled.body.data.policy).toMatchObject({
      enabled: true,
      scheduledCaptureEnabled: false,
      scheduledCaptureActive: false,
      nextCaptureAt: null,
    });

    const scheduledAfter = await ScreenshotRequest.findByPk(scheduled.id);
    expect(scheduledAfter?.status).toBe('CANCELLED');
    expect(scheduledAfter?.failureCode).toBe('SCHEDULED_CAPTURE_DISABLED');
  });

  it('disabling scheduled capture leaves a pending manual request untouched', async () => {
    const team = await createTeam();
    await enableOrganizationPolicy(team.ownerAuth, team.orgId);
    const employeeId = team.employee.user.id;

    const manual = await request(app)
      .post(`${API}/admin/employees/${employeeId}/screenshot-requests`)
      .set(ownerHeaders(team.ownerAuth, team.orgId))
      .send({});
    expect(manual.status).toBe(201);

    await EmployeeMonitoringPolicy.update(
      { scheduledCaptureEnabled: true, nextCaptureAt: new Date(Date.now() + 30 * 60_000) },
      { where: { organizationId: team.orgId, employeeId } },
    );

    const disabled = await patchPolicy(team.ownerAuth, team.orgId, employeeId, {
      scheduledCaptureEnabled: false,
    });
    expect(disabled.status).toBe(200);

    const manualAfter = await ScreenshotRequest.findByPk(manual.body.data.request.id as string);
    expect(manualAfter?.status).toBe('PENDING');
  });

  it('keeps manual screenshot requests working while scheduled capture is disabled', async () => {
    const team = await createTeam();
    await enableOrganizationPolicy(team.ownerAuth, team.orgId);

    expect((await policyFor(team.orgId, team.employee.user.id))!.scheduledCaptureEnabled).toBe(false);

    const manual = await request(app)
      .post(`${API}/admin/employees/${team.employee.user.id}/screenshot-requests`)
      .set(ownerHeaders(team.ownerAuth, team.orgId))
      .send({});
    expect(manual.status).toBe(201);
    expect(manual.body.data.request.status).toBe('PENDING');
  });

  it('rejects enabling scheduled capture while general monitoring is disabled', async () => {
    const team = await createTeam();
    const disabled = await patchPolicy(team.ownerAuth, team.orgId, team.employee.user.id, {
      enabled: false,
    });
    expect(disabled.status).toBe(200);

    const rejected = await patchPolicy(team.ownerAuth, team.orgId, team.employee.user.id, {
      scheduledCaptureEnabled: true,
    });
    expect(rejected.status).toBe(422);

    const policy = await policyFor(team.orgId, team.employee.user.id);
    expect(policy?.scheduledCaptureEnabled).toBe(false);
    expect(policy?.nextCaptureAt).toBeNull();
  });

  it('never captures while the organization policy is disabled', async () => {
    const team = await createTeam();
    await EmployeeMonitoringPolicy.update(
      {
        scheduledCaptureEnabled: true,
        nextCaptureAt: new Date(Date.now() - 60_000),
      },
      { where: { organizationId: team.orgId, employeeId: team.employee.user.id } },
    );

    const sweep = await runDueScheduledCaptures();
    expect(sweep.captured).toBe(0);
    expect(sweep.deferred).toBe(1);
    expect(
      await ScreenshotRequest.count({
        where: { organizationId: team.orgId, employeeId: team.employee.user.id },
      }),
    ).toBe(0);
  });

  it('defers without a burst when the employee has no eligible session', async () => {
    const team = await createTeam({ startSession: false });
    await enableOrganizationPolicy(team.ownerAuth, team.orgId);
    await EmployeeMonitoringPolicy.update(
      {
        scheduledCaptureEnabled: true,
        nextCaptureAt: new Date(Date.now() - 60_000),
      },
      { where: { organizationId: team.orgId, employeeId: team.employee.user.id } },
    );

    const sweep = await runDueScheduledCaptures();
    expect(sweep.captured).toBe(0);
    expect(sweep.deferred).toBe(1);
    expect(
      await ScreenshotRequest.count({
        where: { organizationId: team.orgId, employeeId: team.employee.user.id },
      }),
    ).toBe(0);

    const policy = await policyFor(team.orgId, team.employee.user.id);
    expect(policy!.nextCaptureAt!.getTime()).toBeGreaterThan(Date.now() + 4 * 60_000);
    expect(policy!.nextCaptureAt!.getTime()).toBeLessThan(Date.now() + 6 * 60_000);
  });

  it('claims a due slot once when two sweeps run concurrently', async () => {
    const team = await createTeam();
    await enableOrganizationPolicy(team.ownerAuth, team.orgId);
    await EmployeeMonitoringPolicy.update(
      {
        scheduledCaptureEnabled: true,
        nextCaptureAt: new Date(Date.now() - 60_000),
      },
      { where: { organizationId: team.orgId, employeeId: team.employee.user.id } },
    );

    const [first, second] = await Promise.all([
      runDueScheduledCaptures(),
      runDueScheduledCaptures(),
    ]);
    expect(first.captured + second.captured).toBe(1);
    expect(
      await ScreenshotRequest.count({
        where: { organizationId: team.orgId, employeeId: team.employee.user.id },
      }),
    ).toBe(1);
  });

  it('does not let a scheduled capture consume an administrator request cooldown', async () => {
    const team = await createTeam();
    await enableOrganizationPolicy(team.ownerAuth, team.orgId);
    const admin = await inviteAndAccept(team.owner, {
      role: 'ADMIN',
      name: 'Scheduled Admin',
      email: uniqueEmail('sched-admin'),
    });
    const adminAuth = await desktopAuth(admin.email);
    const adminAgent = await registerAgent(adminAuth, team.orgId);
    const started = await request(app)
      .post(`${API}/organizations/${team.orgId}/time-sessions/start`)
      .set(adminAgent.headers)
      .send({});
    expect(started.status).toBe(201);

    await EmployeeMonitoringPolicy.update(
      {
        scheduledCaptureEnabled: true,
        nextCaptureAt: new Date(Date.now() - 60_000),
      },
      { where: { organizationId: team.orgId, employeeId: admin.user.id } },
    );

    const sweep = await runDueScheduledCaptures();
    expect(sweep.captured).toBe(1);

    const manual = await request(app)
      .post(`${API}/admin/employees/${team.employee.user.id}/screenshot-requests`)
      .set(ownerHeaders(adminAuth, team.orgId))
      .send({});
    expect(manual.status).toBe(201);
  });

  it('recomputes the next slot only while scheduled capture is active', async () => {
    const team = await createTeam();

    const disabled = await patchPolicy(team.ownerAuth, team.orgId, team.employee.user.id, {
      captureIntervalMinutes: 15,
    });
    expect(disabled.status).toBe(200);
    expect(disabled.body.data.policy.captureIntervalMinutes).toBe(15);
    expect(disabled.body.data.policy.nextCaptureAt).toBeNull();

    const enabled = await patchPolicy(team.ownerAuth, team.orgId, team.employee.user.id, {
      scheduledCaptureEnabled: true,
    });
    expect(enabled.body.data.policy.nextCaptureAt).toBeTruthy();

    const updated = await patchPolicy(team.ownerAuth, team.orgId, team.employee.user.id, {
      captureIntervalMinutes: 10,
    });
    expect(updated.status).toBe(200);
    const next = new Date(updated.body.data.policy.nextCaptureAt as string).getTime();
    expect(next).toBeGreaterThan(Date.now() + 8 * 60_000);
    expect(next).toBeLessThan(Date.now() + 12 * 60_000);
  });

  it('rejects unsupported intervals', async () => {
    const team = await createTeam();

    const response = await patchPolicy(team.ownerAuth, team.orgId, team.employee.user.id, {
      captureIntervalMinutes: 7,
    });
    expect(response.status).toBe(422);
  });

  it('gates the scheduled capture overview by permission and organization', async () => {
    const team = await createTeam();
    const manager = await inviteAndAccept(team.owner, {
      role: 'MANAGER',
      name: 'Overview Manager',
      email: uniqueEmail('sched-manager'),
    });
    const managerAuth = await desktopAuth(manager.email);

    const denied = await request(app)
      .get(`${API}/admin/scheduled-capture`)
      .set(ownerHeaders(managerAuth, team.orgId));
    expect(denied.status).toBe(403);

    const grant = await team.owner.agent
      .patch(`${API}/organizations/${team.orgId}/roles/MANAGER`)
      .set('x-csrf-token', team.owner.csrf)
      .send({ permissions: ['organization:read', 'screenshot:monitoring'] });
    expect(grant.status).toBe(200);

    const allowed = await request(app)
      .get(`${API}/admin/scheduled-capture`)
      .set(ownerHeaders(managerAuth, team.orgId));
    expect(allowed.status).toBe(200);
    expect(allowed.body.data.employees).toContainEqual(
      expect.objectContaining({
        employeeId: manager.user.id,
        scheduledCaptureEnabled: false,
      }),
    );

    const other = await createTeam();
    const ownList = await request(app)
      .get(`${API}/admin/scheduled-capture`)
      .set(ownerHeaders(other.ownerAuth, other.orgId));
    expect(ownList.status).toBe(200);
    const ids = ownList.body.data.employees.map((row: { employeeId: string }) => row.employeeId);
    expect(ids).toContain(other.employee.user.id);
    expect(ids).not.toContain(team.employee.user.id);
  });
});
