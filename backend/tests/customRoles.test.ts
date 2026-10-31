import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuditEvent } from '../src/database';
import {
  API,
  app,
  createOwner,
  inviteAndAccept,
  resetDatabase,
} from './helpers';

beforeEach(async () => {
  await resetDatabase();
});

function rolesPath(organizationId: string, suffix = ''): string {
  return `${API}/organizations/${organizationId}/roles${suffix}`;
}

async function createRole(
  owner: Awaited<ReturnType<typeof createOwner>>,
  body: Record<string, unknown>,
) {
  return owner.agent
    .post(rolesPath(owner.organization.id))
    .set('x-csrf-token', owner.csrf)
    .send(body);
}

async function assignRole(
  owner: Awaited<ReturnType<typeof createOwner>>,
  membershipId: string,
  body: Record<string, unknown>,
) {
  return owner.agent
    .patch(`${API}/organizations/${owner.organization.id}/members/${membershipId}`)
    .set('x-csrf-token', owner.csrf)
    .send(body);
}

describe('custom roles', () => {
  it('lists built-in roles and creates an organization-scoped custom role', async () => {
    const owner = await createOwner();

    const initial = await owner.agent.get(rolesPath(owner.organization.id));
    expect(initial.status).toBe(200);
    const builtIns = initial.body.data as Array<Record<string, unknown>>;
    expect(builtIns.map((role) => role.key)).toEqual([
      'OWNER',
      'ADMIN',
      'MANAGER',
      'EMPLOYEE',
    ]);
    expect(builtIns.every((role) => role.builtIn === true)).toBe(true);

    const created = await createRole(owner, {
      name: 'Team Lead Lite',
      description: 'Reads team reports without administration',
      permissions: ['time:read', 'report:read'],
      dataScope: 'SELF',
    });

    expect(created.status).toBe(201);
    expect(created.body.data.role).toMatchObject({
      name: 'Team Lead Lite',
      description: 'Reads team reports without administration',
      builtIn: false,
      permissionCount: 2,
      assignedUserCount: 0,
      dataScope: 'SELF',
    });
    expect(created.body.data.role.permissions).toEqual(['time:read', 'report:read']);

    const listed = await owner.agent.get(rolesPath(owner.organization.id));
    expect(listed.body.data).toHaveLength(5);

    const detail = await owner.agent.get(
      rolesPath(owner.organization.id, `/${created.body.data.role.id}`),
    );
    expect(detail.status).toBe(200);
    expect(detail.body.data.role.name).toBe('Team Lead Lite');
  });

  it('exposes only grantable permissions in the catalog', async () => {
    const owner = await createOwner();

    const catalog = await owner.agent.get(rolesPath(owner.organization.id, '/permissions'));
    expect(catalog.status).toBe(200);

    const grantable = catalog.body.data.grantable as string[];
    const protectedPermissions = catalog.body.data.protected as string[];
    expect(grantable).toContain('time:read');
    expect(grantable).toContain('correction:review');
    expect(grantable).not.toContain('member:update');
    expect(grantable).not.toContain('screenshot:read');
    expect(protectedPermissions).toEqual(
      expect.arrayContaining(['role:manage', 'member:invite', 'screenshot:live', 'leave:approve']),
    );

    const groups = catalog.body.data.groups as Array<{ permissions: string[] }>;
    for (const group of groups) {
      expect(group.permissions.length).toBeGreaterThan(0);
      for (const permission of group.permissions) {
        expect(grantable).toContain(permission);
      }
    }
  });

  it('rejects duplicate names, unknown permissions, and administrator-only permissions', async () => {
    const owner = await createOwner();

    const first = await createRole(owner, {
      name: 'Support Lead',
      permissions: ['time:read'],
    });
    expect(first.status).toBe(201);

    const duplicate = await createRole(owner, {
      name: '  support lead  ',
      permissions: ['time:read'],
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('DUPLICATE_ROLE_NAME');

    const unknown = await createRole(owner, {
      name: 'Mystery Role',
      permissions: ['time:teleport'],
    });
    expect(unknown.status).toBe(422);
    expect(unknown.body.error.code).toBe('VALIDATION_ERROR');

    for (const permission of ['role:manage', 'member:update', 'screenshot:read', 'leave:approve']) {
      const escalation = await createRole(owner, {
        name: `Escalation ${permission}`,
        permissions: [permission],
      });
      expect(escalation.status).toBe(422);
      expect(escalation.body.error.code).toBe('VALIDATION_ERROR');
    }

    const empty = await createRole(owner, { name: 'Nothing Role', permissions: [] });
    expect(empty.status).toBe(422);
  });

  it('restricts role management to owners and admins and protects built-in roles', async () => {
    const owner = await createOwner();
    const admin = await inviteAndAccept(owner, { role: 'ADMIN' });
    const manager = await inviteAndAccept(owner, { role: 'MANAGER' });
    const employee = await inviteAndAccept(owner, { role: 'EMPLOYEE' });

    const adminCreate = await admin.agent
      .post(rolesPath(owner.organization.id))
      .set('x-csrf-token', admin.csrf)
      .send({ name: 'Admin Made', permissions: ['time:read'] });
    expect(adminCreate.status).toBe(201);

    const managerList = await manager.agent.get(rolesPath(owner.organization.id));
    expect(managerList.status).toBe(403);
    expect(managerList.body.error.code).toBe('PERMISSION_DENIED');

    const employeeList = await employee.agent.get(rolesPath(owner.organization.id));
    expect(employeeList.status).toBe(403);

    const employeeCreate = await employee.agent
      .post(rolesPath(owner.organization.id))
      .set('x-csrf-token', employee.csrf)
      .send({ name: 'Employee Made', permissions: ['time:read'] });
    expect(employeeCreate.status).toBe(403);

    const editBuiltIn = await owner.agent
      .patch(rolesPath(owner.organization.id, '/EMPLOYEE'))
      .set('x-csrf-token', owner.csrf)
      .send({ permissions: ['time:read'] });
    expect(editBuiltIn.status).toBe(422);

    const unauthenticated = await request(app).get(rolesPath(owner.organization.id));
    expect(unauthenticated.status).toBe(401);
  });

  it('assigns a custom role, stores it with an EMPLOYEE base role, and lists assigned users', async () => {
    const owner = await createOwner();
    const employee = await inviteAndAccept(owner, { role: 'EMPLOYEE' });

    const created = await createRole(owner, {
      name: 'Time Reader',
      permissions: ['time:read', 'leave:read'],
      dataScope: 'SELF',
    });
    const roleId = created.body.data.role.id as string;

    const assigned = await assignRole(owner, employee.membership.id, { customRoleId: roleId });
    expect(assigned.status).toBe(200);
    expect(assigned.body.data.membership).toMatchObject({
      role: 'EMPLOYEE',
      customRoleId: roleId,
      dataScope: 'SELF',
      permissions: ['time:read', 'leave:read'],
      customRole: { id: roleId, name: 'Time Reader' },
    });

    const users = await owner.agent.get(rolesPath(owner.organization.id, `/${roleId}/users`));
    expect(users.status).toBe(200);
    expect(users.body.data).toHaveLength(1);
    expect(users.body.data[0].user.email).toBe(employee.email);

    const roleDetail = await owner.agent.get(rolesPath(owner.organization.id, `/${roleId}`));
    expect(roleDetail.body.data.role.assignedUserCount).toBe(1);

    const session = await employee.agent.get(`${API}/organizations`);
    expect(session.body.data[0].membership.customRoleId).toBe(roleId);
    expect(session.body.data[0].membership.permissions).toEqual(['time:read', 'leave:read']);
  });

  it('enforces custom permissions on every request and revokes removed permissions immediately', async () => {
    const owner = await createOwner();
    const employee = await inviteAndAccept(owner, { role: 'EMPLOYEE' });

    const created = await createRole(owner, {
      name: 'Auditor',
      permissions: ['time:read', 'report:read'],
      dataScope: 'SELF',
    });
    const roleId = created.body.data.role.id as string;
    await assignRole(owner, employee.membership.id, { customRoleId: roleId });

    const sessions = await employee.agent.get(
      `${API}/organizations/${owner.organization.id}/time-sessions`,
    );
    expect(sessions.status).toBe(200);

    const startSession = await employee.agent
      .post(`${API}/organizations/${owner.organization.id}/time-sessions/start`)
      .set('x-csrf-token', employee.csrf);
    expect(startSession.status).toBe(403);
    expect(startSession.body.error.code).toBe('PERMISSION_DENIED');

    const adminAttempt = await employee.agent
      .post(rolesPath(owner.organization.id))
      .set('x-csrf-token', employee.csrf)
      .send({ name: 'Bypass', permissions: ['time:read'] });
    expect(adminAttempt.status).toBe(403);

    const tightened = await owner.agent
      .patch(rolesPath(owner.organization.id, `/${roleId}`))
      .set('x-csrf-token', owner.csrf)
      .send({ permissions: ['leave:read'] });
    expect(tightened.status).toBe(200);

    const revoked = await employee.agent.get(
      `${API}/organizations/${owner.organization.id}/time-sessions`,
    );
    expect(revoked.status).toBe(403);
    expect(revoked.body.error.code).toBe('PERMISSION_DENIED');

    const leave = await employee.agent.get(
      `${API}/organizations/${owner.organization.id}/leave/requests`,
    );
    expect(leave.status).toBe(200);
  });

  it('keeps SELF data scope separate from report:read and honors ORGANIZATION scope', async () => {
    const owner = await createOwner();
    const first = await inviteAndAccept(owner, { role: 'EMPLOYEE' });
    const second = await inviteAndAccept(owner, { role: 'EMPLOYEE' });

    const created = await createRole(owner, {
      name: 'Self Reporter',
      permissions: ['report:read'],
      dataScope: 'SELF',
    });
    const roleId = created.body.data.role.id as string;
    await assignRole(owner, first.membership.id, { customRoleId: roleId });

    const range = 'from=2026-10-01&to=2026-10-30';
    const ownReport = await first.agent.get(
      `${API}/organizations/${owner.organization.id}/reports/daily?${range}&employeeId=${first.user.id}`,
    );
    expect(ownReport.status).toBe(200);

    const otherReport = await first.agent.get(
      `${API}/organizations/${owner.organization.id}/reports/daily?${range}&employeeId=${second.user.id}`,
    );
    expect(otherReport.status).toBe(403);
    expect(otherReport.body.error.code).toBe('PERMISSION_DENIED');

    const widened = await owner.agent
      .patch(rolesPath(owner.organization.id, `/${roleId}`))
      .set('x-csrf-token', owner.csrf)
      .send({ dataScope: 'ORGANIZATION' });
    expect(widened.status).toBe(200);

    const orgReport = await first.agent.get(
      `${API}/organizations/${owner.organization.id}/reports/daily?${range}&employeeId=${second.user.id}`,
    );
    expect(orgReport.status).toBe(200);
  });

  it('prevents assignment to a role from another organization', async () => {
    const ownerA = await createOwner(undefined, 'Org A');
    const ownerB = await createOwner(undefined, 'Org B');
    const employeeA = await inviteAndAccept(ownerA, { role: 'EMPLOYEE' });

    const roleB = await createRole(ownerB, {
      name: 'Foreign Role',
      permissions: ['time:read'],
    });
    const roleBId = roleB.body.data.role.id as string;

    const crossAssign = await assignRole(ownerA, employeeA.membership.id, {
      customRoleId: roleBId,
    });
    expect(crossAssign.status).toBe(404);
    expect(crossAssign.body.error.code).toBe('ROLE_NOT_FOUND');

    const crossRead = await ownerB.agent.get(
      rolesPath(ownerA.organization.id, `/${roleBId}`),
    );
    expect(crossRead.status).toBe(404);
  });

  it('prevents privilege escalation through assignment or manipulated payloads', async () => {
    const owner = await createOwner();
    const admin = await inviteAndAccept(owner, { role: 'ADMIN' });
    const employee = await inviteAndAccept(owner, { role: 'EMPLOYEE' });
    const otherEmployee = await inviteAndAccept(owner, { role: 'EMPLOYEE' });

    const created = await createRole(owner, {
      name: 'Directory Reader',
      permissions: ['member:read'],
    });
    const roleId = created.body.data.role.id as string;
    await assignRole(owner, employee.membership.id, { customRoleId: roleId });

    const manageMember = await employee.agent
      .patch(
        `${API}/organizations/${owner.organization.id}/members/${otherEmployee.membership.id}`,
      )
      .set('x-csrf-token', employee.csrf)
      .send({ role: 'ADMIN' });
    expect(manageMember.status).toBe(403);

    const mixedPayload = await assignRole(owner, employee.membership.id, {
      role: 'ADMIN',
      customRoleId: roleId,
    });
    expect(mixedPayload.status).toBe(422);

    const adminAssignsAdmin = await admin.agent
      .patch(
        `${API}/organizations/${owner.organization.id}/members/${owner.membership.id}`,
      )
      .set('x-csrf-token', admin.csrf)
      .send({ customRoleId: roleId });
    expect(adminAssignsAdmin.status).toBe(403);

    const roleManageAttempt = await employee.agent
      .patch(rolesPath(owner.organization.id, `/${roleId}`))
      .set('x-csrf-token', employee.csrf)
      .send({ permissions: ['role:manage'] });
    expect(roleManageAttempt.status).toBe(403);
  });

  it('requires reassignment before deletion and audits role lifecycle changes', async () => {
    const owner = await createOwner();
    const employee = await inviteAndAccept(owner, { role: 'EMPLOYEE' });

    const created = await createRole(owner, {
      name: 'Temporary Reviewer',
      permissions: ['correction:review'],
      dataScope: 'SELF',
    });
    const roleId = created.body.data.role.id as string;
    await assignRole(owner, employee.membership.id, { customRoleId: roleId });

    const inUse = await owner.agent
      .delete(rolesPath(owner.organization.id, `/${roleId}`))
      .set('x-csrf-token', owner.csrf);
    expect(inUse.status).toBe(409);
    expect(inUse.body.error.code).toBe('ROLE_IN_USE');

    const unassign = await assignRole(owner, employee.membership.id, { role: 'EMPLOYEE' });
    expect(unassign.status).toBe(200);
    expect(unassign.body.data.membership.customRoleId).toBeNull();
    expect(unassign.body.data.membership.permissions).toContain('time:write');

    const removed = await owner.agent
      .delete(rolesPath(owner.organization.id, `/${roleId}`))
      .set('x-csrf-token', owner.csrf);
    expect(removed.status).toBe(204);

    const missing = await owner.agent.get(rolesPath(owner.organization.id, `/${roleId}`));
    expect(missing.status).toBe(404);

    const actions = (
      await AuditEvent.findAll({
        where: { organizationId: owner.organization.id },
        attributes: ['action'],
        raw: true,
      })
    ).map((event) => event.action as string);
    expect(actions).toEqual(
      expect.arrayContaining([
        'CUSTOM_ROLE_CREATED',
        'CUSTOM_ROLE_ASSIGNED',
        'CUSTOM_ROLE_UNASSIGNED',
        'CUSTOM_ROLE_DELETED',
      ]),
    );
  });

  it('lets a correction reviewer read the queue without time:read while keeping self-service separate', async () => {
    const owner = await createOwner();
    const employee = await inviteAndAccept(owner, { role: 'EMPLOYEE' });
    const reviewer = await inviteAndAccept(owner, { role: 'EMPLOYEE' });

    const created = await createRole(owner, {
      name: 'Correction Reviewer',
      permissions: ['correction:review'],
      dataScope: 'ORGANIZATION',
    });
    await assignRole(owner, reviewer.membership.id, {
      customRoleId: created.body.data.role.id,
    });

    const submitted = await employee.agent
      .post(`${API}/organizations/${owner.organization.id}/attendance/corrections`)
      .set('x-csrf-token', employee.csrf)
      .send({
        workDate: '2026-03-10',
        startedAt: '2026-03-10T09:00:00.000Z',
        endedAt: '2026-03-10T10:00:00.000Z',
        breaks: [],
        reason: 'Forgot to start the tracker.',
      });
    expect(submitted.status).toBe(201);
    const correctionId = submitted.body.data.correction.id as string;

    const reviewList = await reviewer.agent.get(
      `${API}/organizations/${owner.organization.id}/attendance/corrections`,
    );
    expect(reviewList.status).toBe(200);
    expect(reviewList.body.meta.total).toBe(1);
    expect(reviewList.body.data[0].employee.id).toBe(employee.user.id);

    const reviewDetail = await reviewer.agent.get(
      `${API}/organizations/${owner.organization.id}/attendance/corrections/${correctionId}`,
    );
    expect(reviewDetail.status).toBe(200);

    // Reviewing never implies attendance reading or self-service submission.
    const summaries = await reviewer.agent.get(
      `${API}/organizations/${owner.organization.id}/attendance/summaries?from=2026-03-10&to=2026-03-10`,
    );
    expect(summaries.status).toBe(403);
    expect(summaries.body.error.code).toBe('PERMISSION_DENIED');

    const sessions = await reviewer.agent.get(
      `${API}/organizations/${owner.organization.id}/time-sessions`,
    );
    expect(sessions.status).toBe(403);

    const submit = await reviewer.agent
      .post(`${API}/organizations/${owner.organization.id}/attendance/corrections`)
      .set('x-csrf-token', reviewer.csrf)
      .send({
        workDate: '2026-03-11',
        startedAt: '2026-03-11T09:00:00.000Z',
        endedAt: '2026-03-11T10:00:00.000Z',
        breaks: [],
        reason: 'Attempting to request a correction.',
      });
    expect(submit.status).toBe(403);
  });

  it('limits organization-scoped non-reviewers to their own correction history', async () => {
    const owner = await createOwner();
    const reader = await inviteAndAccept(owner, { role: 'EMPLOYEE' });
    const colleague = await inviteAndAccept(owner, { role: 'EMPLOYEE' });

    const created = await createRole(owner, {
      name: 'Time Reader',
      permissions: ['time:read'],
      dataScope: 'ORGANIZATION',
    });
    await assignRole(owner, reader.membership.id, {
      customRoleId: created.body.data.role.id,
    });

    const submitted = await colleague.agent
      .post(`${API}/organizations/${owner.organization.id}/attendance/corrections`)
      .set('x-csrf-token', colleague.csrf)
      .send({
        workDate: '2026-03-12',
        startedAt: '2026-03-12T09:00:00.000Z',
        endedAt: '2026-03-12T10:00:00.000Z',
        breaks: [],
        reason: 'Colleague correction.',
      });
    expect(submitted.status).toBe(201);

    const list = await reader.agent.get(
      `${API}/organizations/${owner.organization.id}/attendance/corrections`,
    );
    expect(list.status).toBe(200);
    expect(list.body.meta.total).toBe(0);

    const detail = await reader.agent.get(
      `${API}/organizations/${owner.organization.id}/attendance/corrections/${submitted.body.data.correction.id}`,
    );
    expect(detail.status).toBe(404);
    expect(detail.body.error.code).toBe('CORRECTION_NOT_FOUND');

    const approve = await reader.agent
      .post(
        `${API}/organizations/${owner.organization.id}/attendance/corrections/${submitted.body.data.correction.id}/approve`,
      )
      .set('x-csrf-token', reader.csrf)
      .send({});
    expect(approve.status).toBe(403);
    expect(approve.body.error.code).toBe('PERMISSION_DENIED');
  });

  it('keeps app tracking settings behind time:read while team tracking needs report:read', async () => {
    const owner = await createOwner();
    const analyst = await inviteAndAccept(owner, { role: 'EMPLOYEE' });

    const created = await createRole(owner, {
      name: 'Report Analyst',
      permissions: ['report:read'],
      dataScope: 'ORGANIZATION',
    });
    await assignRole(owner, analyst.membership.id, {
      customRoleId: created.body.data.role.id,
    });

    const settings = await analyst.agent.get(
      `${API}/organizations/${owner.organization.id}/activity/settings`,
    );
    expect(settings.status).toBe(403);
    expect(settings.body.error.code).toBe('PERMISSION_DENIED');

    const tracking = await analyst.agent.get(
      `${API}/organizations/${owner.organization.id}/reports/tracking-status`,
    );
    expect(tracking.status).toBe(200);
  });

  it('keeps built-in roles unchanged for existing members', async () => {
    const owner = await createOwner();
    const manager = await inviteAndAccept(owner, { role: 'MANAGER' });

    const managerSessions = await manager.agent.get(
      `${API}/organizations/${owner.organization.id}/time-sessions?employeeId=${owner.user.id}`,
    );
    expect(managerSessions.status).toBe(200);

    const managerRoles = await manager.agent.get(rolesPath(owner.organization.id));
    expect(managerRoles.status).toBe(403);

    const ownerSessions = await owner.agent.get(
      `${API}/organizations/${owner.organization.id}/time-sessions`,
    );
    expect(ownerSessions.status).toBe(200);

    const ownerRoles = await owner.agent.get(rolesPath(owner.organization.id));
    expect(ownerRoles.body.data.find((role: { key: string }) => role.key === 'OWNER')).toMatchObject({
      builtIn: true,
      dataScope: 'ORGANIZATION',
    });
  });
});
