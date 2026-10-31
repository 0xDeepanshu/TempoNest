import { beforeEach, describe, expect, it } from 'vitest';
import { AuditEvent, ManagerRoleOverride, Membership } from '../src/database';
import { ROLE_PERMISSIONS } from '../src/modules/memberships/permissions';
import {
  API,
  createOwner,
  inviteAndAccept,
  resetDatabase,
  uniqueEmail,
  type OwnerContext,
} from './helpers';

beforeEach(async () => {
  await resetDatabase();
});

function rolesPath(organizationId: string, suffix = ''): string {
  return `${API}/organizations/${organizationId}/roles${suffix}`;
}

async function updateManager(owner: OwnerContext, body: Record<string, unknown>) {
  return owner.agent
    .patch(rolesPath(owner.organization.id, '/MANAGER'))
    .set('x-csrf-token', owner.csrf)
    .send(body);
}

async function resetManager(owner: OwnerContext) {
  return owner.agent
    .delete(rolesPath(owner.organization.id, '/MANAGER'))
    .set('x-csrf-token', owner.csrf);
}

describe('organization-scoped Manager customization', () => {
  it('exposes MANAGER as built-in and customizable without touching other built-ins', async () => {
    const owner = await createOwner();

    const response = await owner.agent.get(rolesPath(owner.organization.id));
    expect(response.status).toBe(200);

    const roles = response.body.data as Array<Record<string, unknown>>;
    const manager = roles.find((role) => role.id === 'MANAGER')!;
    expect(manager).toMatchObject({
      key: 'MANAGER',
      builtIn: true,
      customizable: true,
      customized: false,
      dataScope: 'ORGANIZATION',
    });
    expect(manager.permissions).toEqual(ROLE_PERMISSIONS.MANAGER);

    for (const id of ['OWNER', 'ADMIN', 'EMPLOYEE']) {
      const role = roles.find((entry) => entry.id === id)!;
      expect(role).toMatchObject({ builtIn: true, customizable: false, customized: false });
    }

    const literal = await owner.agent.get(rolesPath(owner.organization.id, '/MANAGER'));
    expect(literal.status).toBe(200);
    expect(literal.body.data.role).toMatchObject({ id: 'MANAGER', customized: false });
  });

  it('lets the owner customize permissions and scope while preserving manager memberships', async () => {
    const owner = await createOwner();
    const manager = await inviteAndAccept(owner, { role: 'MANAGER' });
    const membershipId = manager.membership.id as string;

    const updated = await updateManager(owner, {
      description: 'Reviews attendance only',
      permissions: ['organization:read', 'member:read'],
      dataScope: 'SELF',
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data.role).toMatchObject({
      id: 'MANAGER',
      name: 'Manager',
      description: 'Reviews attendance only',
      builtIn: true,
      customizable: true,
      customized: true,
      permissions: ['organization:read', 'member:read'],
      dataScope: 'SELF',
      assignedUserCount: 1,
    });

    const stored = await Membership.findByPk(membershipId);
    expect(stored).toMatchObject({ id: membershipId, role: 'MANAGER', customRoleId: null });

    const override = await ManagerRoleOverride.findOne({
      where: { organizationId: owner.organization.id },
    });
    expect(override).not.toBeNull();
    expect(override!.permissions).toEqual(['organization:read', 'member:read']);

    // The existing session sees the new permissions without re-login.
    const session = await manager.agent.get(`${API}/organizations`);
    expect(session.status).toBe(200);
    expect(session.body.data[0].membership).toMatchObject({
      id: membershipId,
      role: 'MANAGER',
      customRoleId: null,
      permissions: ['organization:read', 'member:read'],
      dataScope: 'SELF',
    });

    const members = await manager.agent.get(
      `${API}/organizations/${owner.organization.id}/members`,
    );
    expect(members.status).toBe(200);

    const sessions = await manager.agent.get(
      `${API}/organizations/${owner.organization.id}/time-sessions`,
    );
    expect(sessions.status).toBe(403);
    expect(sessions.body.error.code).toBe('PERMISSION_DENIED');

    const audit = await AuditEvent.findOne({
      where: { organizationId: owner.organization.id, action: 'MANAGER_ROLE_UPDATED' },
    });
    expect(audit).not.toBeNull();
    expect(audit!.entityType).toBe('ROLE');
    expect(audit!.metadata).toMatchObject({ permissions: ['organization:read', 'member:read'] });
  });

  it('defaults unspecified fields and supports restoring the built-in defaults', async () => {
    const owner = await createOwner();
    await inviteAndAccept(owner, { role: 'MANAGER' });

    const updated = await updateManager(owner, { permissions: ['organization:read'] });
    expect(updated.status).toBe(200);
    expect(updated.body.data.role).toMatchObject({
      permissions: ['organization:read'],
      dataScope: 'ORGANIZATION',
      description: 'Reviews attendance and reads team reports without admin controls.',
      customized: true,
    });

    const reset = await resetManager(owner);
    expect(reset.status).toBe(200);
    expect(reset.body.data.role).toMatchObject({
      customized: false,
      permissions: ROLE_PERMISSIONS.MANAGER,
      dataScope: 'ORGANIZATION',
    });

    expect(
      await ManagerRoleOverride.count({ where: { organizationId: owner.organization.id } }),
    ).toBe(0);

    const resetAudit = await AuditEvent.findOne({
      where: { organizationId: owner.organization.id, action: 'MANAGER_ROLE_RESET' },
    });
    expect(resetAudit).not.toBeNull();
  });

  it('keeps customization organization-specific', async () => {
    const ownerA = await createOwner(uniqueEmail('owner'), 'Org A');
    const ownerB = await createOwner(uniqueEmail('owner'), 'Org B');
    const managerB = await inviteAndAccept(ownerB, { role: 'MANAGER' });

    const updated = await updateManager(ownerA, {
      permissions: ['organization:read', 'member:read'],
    });
    expect(updated.status).toBe(200);

    const listB = await ownerB.agent.get(rolesPath(ownerB.organization.id));
    const managerSummaryB = (listB.body.data as Array<Record<string, unknown>>).find(
      (role) => role.id === 'MANAGER',
    )!;
    expect(managerSummaryB).toMatchObject({ customized: false });
    expect(managerSummaryB.permissions).toEqual(ROLE_PERMISSIONS.MANAGER);

    const sessionB = await managerB.agent.get(`${API}/organizations`);
    expect(sessionB.body.data[0].membership.permissions).toEqual(ROLE_PERMISSIONS.MANAGER);
  });

  it('restricts customization to the owner and validates the payload', async () => {
    const owner = await createOwner();
    const admin = await inviteAndAccept(owner, { role: 'ADMIN' });
    const manager = await inviteAndAccept(owner, { role: 'MANAGER' });
    const employee = await inviteAndAccept(owner, { role: 'EMPLOYEE' });

    const adminEdit = await admin.agent
      .patch(rolesPath(owner.organization.id, '/MANAGER'))
      .set('x-csrf-token', admin.csrf)
      .send({ permissions: ['organization:read'] });
    expect(adminEdit.status).toBe(403);
    expect(adminEdit.body.error.code).toBe('OWNER_REQUIRED');

    const adminReset = await admin.agent
      .delete(rolesPath(owner.organization.id, '/MANAGER'))
      .set('x-csrf-token', admin.csrf);
    expect(adminReset.status).toBe(403);

    const managerEdit = await manager.agent
      .patch(rolesPath(owner.organization.id, '/MANAGER'))
      .set('x-csrf-token', manager.csrf)
      .send({ permissions: ['organization:read'] });
    expect(managerEdit.status).toBe(403);

    const employeeEdit = await employee.agent
      .patch(rolesPath(owner.organization.id, '/MANAGER'))
      .set('x-csrf-token', employee.csrf)
      .send({ permissions: ['organization:read'] });
    expect(employeeEdit.status).toBe(403);

    const protectedPermission = await updateManager(owner, { permissions: ['role:manage'] });
    expect(protectedPermission.status).toBe(422);

    const unknownPermission = await updateManager(owner, { permissions: ['billing:read'] });
    expect(unknownPermission.status).toBe(422);

    const emptyPermissions = await updateManager(owner, { permissions: [] });
    expect(emptyPermissions.status).toBe(422);

    const emptyBody = await updateManager(owner, {});
    expect(emptyBody.status).toBe(422);

    const unknownField = await updateManager(owner, { permissions: ['time:read'], role: 'ADMIN' });
    expect(unknownField.status).toBe(422);
  });

  it('lists managers through the literal route and applies the override to their summaries', async () => {
    const owner = await createOwner();
    const manager = await inviteAndAccept(owner, { role: 'MANAGER' });
    await inviteAndAccept(owner, { role: 'EMPLOYEE' });

    await updateManager(owner, { permissions: ['organization:read', 'member:read'] });

    const users = await owner.agent.get(rolesPath(owner.organization.id, '/MANAGER/users'));
    expect(users.status).toBe(200);
    expect(users.body.data).toHaveLength(1);
    expect(users.body.data[0]).toMatchObject({
      id: manager.membership.id,
      role: 'MANAGER',
      customRoleId: null,
      permissions: ['organization:read', 'member:read'],
    });
  });

  it('can delegate onboarding to managers without granting administrative invitations', async () => {
    const owner = await createOwner();
    const manager = await inviteAndAccept(owner, { role: 'MANAGER' });
    const orgId = owner.organization.id;

    const updated = await updateManager(owner, {
      permissions: ['organization:read', 'member:read', 'member:onboard'],
    });
    expect(updated.status).toBe(200);

    const employeeInvite = await manager.agent
      .post(`${API}/organizations/${orgId}/invitations`)
      .set('x-csrf-token', manager.csrf)
      .send({ name: 'Onboardee', email: uniqueEmail('onboardee'), role: 'EMPLOYEE' });
    expect(employeeInvite.status).toBe(201);
    expect(employeeInvite.body.data.invitation).toMatchObject({
      role: 'EMPLOYEE',
      customRoleId: null,
    });

    const adminInvite = await manager.agent
      .post(`${API}/organizations/${orgId}/invitations`)
      .set('x-csrf-token', manager.csrf)
      .send({ name: 'Admin Target', email: uniqueEmail('admin'), role: 'ADMIN' });
    expect(adminInvite.status).toBe(403);
    expect(adminInvite.body.error.code).toBe('ROLE_ASSIGNMENT_FORBIDDEN');

    const ownerInvite = await owner.agent
      .post(`${API}/organizations/${orgId}/invitations`)
      .set('x-csrf-token', owner.csrf)
      .send({ name: 'Owner Invitee', email: uniqueEmail('owner-invitee'), role: 'EMPLOYEE' });
    expect(ownerInvite.status).toBe(201);

    const list = await manager.agent.get(`${API}/organizations/${orgId}/invitations`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].id).toBe(employeeInvite.body.data.invitation.id);

    const revokeForeign = await manager.agent
      .delete(
        `${API}/organizations/${orgId}/invitations/${ownerInvite.body.data.invitation.id}`,
      )
      .set('x-csrf-token', manager.csrf);
    expect(revokeForeign.status).toBe(404);

    const revokeOwn = await manager.agent
      .delete(
        `${API}/organizations/${orgId}/invitations/${employeeInvite.body.data.invitation.id}`,
      )
      .set('x-csrf-token', manager.csrf);
    expect(revokeOwn.status).toBe(200);
  });
});
