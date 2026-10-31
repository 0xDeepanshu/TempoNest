import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { Membership } from '../src/database';
import {
  API,
  app,
  createOwner,
  inviteAndAccept,
  resetDatabase,
  type OwnerContext,
} from './helpers';

beforeEach(async () => {
  await resetDatabase();
});

function memberPath(organizationId: string, membershipId: string): string {
  return `${API}/organizations/${organizationId}/members/${membershipId}`;
}

function rolesPath(organizationId: string): string {
  return `${API}/organizations/${organizationId}/roles`;
}

type Actor = Pick<OwnerContext, 'agent' | 'csrf'>;

async function changeRole(
  actor: Actor,
  organizationId: string,
  membershipId: string,
  body: Record<string, unknown>,
) {
  return actor.agent
    .patch(memberPath(organizationId, membershipId))
    .set('x-csrf-token', actor.csrf)
    .send(body);
}

async function createRole(owner: OwnerContext, body: Record<string, unknown>) {
  const response = await owner.agent
    .post(rolesPath(owner.organization.id))
    .set('x-csrf-token', owner.csrf)
    .send(body);
  expect(response.status).toBe(201);
  return response.body.data.role as { id: string; name: string };
}

async function storedMembership(membershipId: string) {
  const membership = await Membership.findByPk(membershipId);
  expect(membership).not.toBeNull();
  return membership!;
}

describe('role transitions', () => {
  it('assigns every built-in role to an existing employee and persists it', async () => {
    const owner = await createOwner();
    const orgId = owner.organization.id;
    const employee = await inviteAndAccept(owner, { role: 'EMPLOYEE' });
    const membershipId = employee.membership.id as string;

    const toAdmin = await changeRole(owner, orgId, membershipId, { role: 'ADMIN' });
    expect(toAdmin.status).toBe(200);
    expect(toAdmin.body.data.membership).toMatchObject({
      id: membershipId,
      role: 'ADMIN',
      customRoleId: null,
      dataScope: 'ORGANIZATION',
    });
    expect(toAdmin.body.data.membership.permissions).toContain('member:update');
    expect((await storedMembership(membershipId)).role).toBe('ADMIN');

    const toManager = await changeRole(owner, orgId, membershipId, { role: 'MANAGER' });
    expect(toManager.status).toBe(200);
    expect(toManager.body.data.membership).toMatchObject({
      id: membershipId,
      role: 'MANAGER',
      customRoleId: null,
    });
    expect((await storedMembership(membershipId)).role).toBe('MANAGER');

    const toEmployee = await changeRole(owner, orgId, membershipId, { role: 'EMPLOYEE' });
    expect(toEmployee.status).toBe(200);
    expect(toEmployee.body.data.membership).toMatchObject({
      id: membershipId,
      role: 'EMPLOYEE',
      customRoleId: null,
      dataScope: 'SELF',
    });
    expect(toEmployee.body.data.membership.permissions).not.toContain('member:update');
    expect((await storedMembership(membershipId)).role).toBe('EMPLOYEE');
  });

  it('moves between custom roles and built-in roles without conflicting fields', async () => {
    const owner = await createOwner();
    const orgId = owner.organization.id;
    const employee = await inviteAndAccept(owner, { role: 'EMPLOYEE' });
    const membershipId = employee.membership.id as string;

    const reader = await createRole(owner, {
      name: 'Time Reader',
      permissions: ['time:read'],
      dataScope: 'SELF',
    });
    const reporter = await createRole(owner, {
      name: 'Org Reporter',
      permissions: ['report:read'],
      dataScope: 'ORGANIZATION',
    });

    const custom = await changeRole(owner, orgId, membershipId, { customRoleId: reader.id });
    expect(custom.status).toBe(200);
    expect(custom.body.data.membership).toMatchObject({
      id: membershipId,
      role: 'EMPLOYEE',
      customRoleId: reader.id,
      permissions: ['time:read'],
      dataScope: 'SELF',
    });

    const otherCustom = await changeRole(owner, orgId, membershipId, { customRoleId: reporter.id });
    expect(otherCustom.status).toBe(200);
    expect(otherCustom.body.data.membership).toMatchObject({
      role: 'EMPLOYEE',
      customRoleId: reporter.id,
      permissions: ['report:read'],
      dataScope: 'ORGANIZATION',
    });

    const toManager = await changeRole(owner, orgId, membershipId, { role: 'MANAGER' });
    expect(toManager.status).toBe(200);
    expect(toManager.body.data.membership).toMatchObject({
      role: 'MANAGER',
      customRoleId: null,
      dataScope: 'ORGANIZATION',
    });
    expect(toManager.body.data.membership.permissions).toContain('correction:review');

    const managerToCustom = await changeRole(owner, orgId, membershipId, { customRoleId: reader.id });
    expect(managerToCustom.status).toBe(200);
    expect(managerToCustom.body.data.membership).toMatchObject({
      role: 'EMPLOYEE',
      customRoleId: reader.id,
      permissions: ['time:read'],
    });

    const backToEmployee = await changeRole(owner, orgId, membershipId, { role: 'EMPLOYEE' });
    expect(backToEmployee.status).toBe(200);
    expect(backToEmployee.body.data.membership).toMatchObject({
      role: 'EMPLOYEE',
      customRoleId: null,
    });
    expect(backToEmployee.body.data.membership.permissions).toContain('time:write');

    const stored = await storedMembership(membershipId);
    expect(stored.role).toBe('EMPLOYEE');
    expect(stored.customRoleId).toBeNull();
    expect(stored.id).toBe(membershipId);
  });

  it('applies the new effective permissions to an existing session without re-login', async () => {
    const owner = await createOwner();
    const orgId = owner.organization.id;
    const employee = await inviteAndAccept(owner, { role: 'EMPLOYEE' });
    const membershipId = employee.membership.id as string;

    const reader = await createRole(owner, {
      name: 'Directory Reader',
      permissions: ['member:read'],
      dataScope: 'SELF',
    });

    const assigned = await changeRole(owner, orgId, membershipId, { customRoleId: reader.id });
    expect(assigned.status).toBe(200);

    const membersAfterCustom = await employee.agent.get(
      `${API}/organizations/${owner.organization.id}/members`,
    );
    expect(membersAfterCustom.status).toBe(200);

    const promoted = await changeRole(owner, orgId, membershipId, { role: 'MANAGER' });
    expect(promoted.status).toBe(200);

    const employeeSession = await employee.agent.get(`${API}/organizations`);
    expect(employeeSession.status).toBe(200);
    expect(employeeSession.body.data[0].membership).toMatchObject({
      id: membershipId,
      role: 'MANAGER',
      customRoleId: null,
      dataScope: 'ORGANIZATION',
    });

    const demoted = await changeRole(owner, orgId, membershipId, { role: 'EMPLOYEE' });
    expect(demoted.status).toBe(200);

    const membersAfterDemotion = await employee.agent.get(
      `${API}/organizations/${owner.organization.id}/members`,
    );
    expect(membersAfterDemotion.status).toBe(403);
    expect(membersAfterDemotion.body.error.code).toBe('PERMISSION_DENIED');
  });

  it('enforces the role hierarchy and rejects malformed or foreign assignments', async () => {
    const owner = await createOwner();
    const orgId = owner.organization.id;
    const admin = await inviteAndAccept(owner, { role: 'ADMIN' });
    const manager = await inviteAndAccept(owner, { role: 'MANAGER' });
    const employee = await inviteAndAccept(owner, { role: 'EMPLOYEE' });
    const otherOrganization = await createOwner(undefined, 'Other Org');
    const outsider = await inviteAndAccept(otherOrganization, { role: 'EMPLOYEE' });

    const adminGrantsAdmin = await changeRole(admin, orgId, employee.membership.id, {
      role: 'ADMIN',
    });
    expect(adminGrantsAdmin.status).toBe(403);
    expect(adminGrantsAdmin.body.error.code).toBe('ROLE_ASSIGNMENT_FORBIDDEN');

    const adminGrantsOwner = await changeRole(admin, orgId, employee.membership.id, {
      role: 'OWNER',
    });
    expect(adminGrantsOwner.status).toBe(403);

    const adminToManager = await changeRole(admin, orgId, employee.membership.id, {
      role: 'MANAGER',
    });
    expect(adminToManager.status).toBe(200);

    const managerCannotManage = await changeRole(manager, orgId, employee.membership.id, {
      role: 'EMPLOYEE',
    });
    expect(managerCannotManage.status).toBe(403);
    expect(managerCannotManage.body.error.code).toBe('PERMISSION_DENIED');

    const employeeCannotManage = await changeRole(employee, orgId, manager.membership.id, {
      role: 'EMPLOYEE',
    });
    expect(employeeCannotManage.status).toBe(403);

    const selfChange = await changeRole(owner, orgId, owner.membership.id, { role: 'ADMIN' });
    expect(selfChange.status).toBe(403);
    expect(selfChange.body.error.code).toBe('CANNOT_MODIFY_SELF');

    const mixedPayload = await changeRole(owner, orgId, employee.membership.id, {
      role: 'ADMIN',
      customRoleId: '00000000-0000-4000-8000-000000000000',
    });
    expect(mixedPayload.status).toBe(422);

    const foreignMembership = await owner.agent
      .patch(memberPath(owner.organization.id, outsider.membership.id))
      .set('x-csrf-token', owner.csrf)
      .send({ role: 'MANAGER' });
    expect(foreignMembership.status).toBe(404);
    expect(foreignMembership.body.error.code).toBe('MEMBERSHIP_NOT_FOUND');

    const foreignRole = await owner.agent
      .post(rolesPath(otherOrganization.organization.id))
      .set('x-csrf-token', owner.csrf)
      .send({ name: 'Not Yours', permissions: ['time:read'] });
    expect(foreignRole.status).toBe(404);

    const outsiderRole = await otherOrganization.agent
      .post(rolesPath(otherOrganization.organization.id))
      .set('x-csrf-token', otherOrganization.csrf)
      .send({ name: 'Foreign Role', permissions: ['time:read'] });
    expect(outsiderRole.status).toBe(201);

    const crossRole = await changeRole(owner, orgId, employee.membership.id, {
      customRoleId: outsiderRole.body.data.role.id,
    });
    expect(crossRole.status).toBe(404);
    expect(crossRole.body.error.code).toBe('ROLE_NOT_FOUND');

    const unauthenticated = await request(app).patch(
      memberPath(owner.organization.id, employee.membership.id),
    );
    expect(unauthenticated.status).toBe(401);
  });
});
