import { beforeEach, describe, expect, it } from 'vitest';
import {
  API,
  createOwner,
  inviteAndAccept,
  resetDatabase,
  uniqueEmail,
} from './helpers';

beforeEach(async () => {
  await resetDatabase();
});

describe('organizations', () => {
  it('creates an organization and makes the creator the owner', async () => {
    const owner = await createOwner();

    expect(owner.membership.role).toBe('OWNER');
    expect(owner.membership.status).toBe('ACTIVE');

    const list = await owner.agent.get(`${API}/organizations`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].id).toBe(owner.organization.id);
    expect(list.body.data[0].membership.role).toBe('OWNER');
  });

  it('retrieves and updates the current organization via X-Organization-Id', async () => {
    const owner = await createOwner();

    const current = await owner.agent
      .get(`${API}/organizations/current`)
      .set('x-organization-id', owner.organization.id);
    expect(current.status).toBe(200);
    expect(current.body.data.organization.name).toBe('Acme Corp');
    expect(current.body.data.memberCount).toBe(1);

    const updated = await owner.agent
      .patch(`${API}/organizations/current`)
      .set('x-organization-id', owner.organization.id)
      .set('x-csrf-token', owner.csrf)
      .send({ name: 'Acme International' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.organization.name).toBe('Acme International');

    const missingHeader = await owner.agent.get(`${API}/organizations/current`);
    expect(missingHeader.status).toBe(400);
    expect(missingHeader.body.error.code).toBe('ORGANIZATION_CONTEXT_REQUIRED');
  });

  it('allows employees to read the organization but not update it', async () => {
    const owner = await createOwner();
    const employee = await inviteAndAccept(owner, { role: 'EMPLOYEE' });

    const read = await employee.agent.get(`${API}/organizations/${owner.organization.id}`);
    expect(read.status).toBe(200);

    const update = await employee.agent
      .patch(`${API}/organizations/${owner.organization.id}`)
      .set('x-csrf-token', employee.csrf)
      .send({ name: 'Employee Rename' });
    expect(update.status).toBe(403);
    expect(update.body.error.code).toBe('PERMISSION_DENIED');
  });

  it('does not leak organizations to non-members', async () => {
    const ownerA = await createOwner(uniqueEmail('owner-a'), 'Alpha');
    const ownerB = await createOwner(uniqueEmail('owner-b'), 'Beta');

    const get = await ownerB.agent.get(`${API}/organizations/${ownerA.organization.id}`);
    expect(get.status).toBe(404);
    expect(get.body.error.code).toBe('ORGANIZATION_NOT_FOUND');

    const members = await ownerB.agent.get(
      `${API}/organizations/${ownerA.organization.id}/members`,
    );
    expect(members.status).toBe(404);

    const patch = await ownerB.agent
      .patch(`${API}/organizations/${ownerA.organization.id}`)
      .set('x-csrf-token', ownerB.csrf)
      .send({ name: 'Hijacked' });
    expect(patch.status).toBe(404);

    const invite = await ownerB.agent
      .post(`${API}/organizations/${ownerA.organization.id}/invitations`)
      .set('x-csrf-token', ownerB.csrf)
      .send({ name: 'Invited Person', email: uniqueEmail(), role: 'EMPLOYEE' });
    expect(invite.status).toBe(404);

    const roleChange = await ownerB.agent
      .patch(`${API}/organizations/${ownerA.organization.id}/members/${ownerA.membership.id}`)
      .set('x-csrf-token', ownerB.csrf)
      .send({ role: 'EMPLOYEE' });
    expect(roleChange.status).toBe(404);

    const remove = await ownerB.agent
      .delete(`${API}/organizations/${ownerA.organization.id}/members/${ownerA.membership.id}`)
      .set('x-csrf-token', ownerB.csrf);
    expect(remove.status).toBe(404);
  });

  it('lists members with pagination, filters and search', async () => {
    const owner = await createOwner();
    await inviteAndAccept(owner, { role: 'MANAGER', name: 'Morgan Manager' });
    await inviteAndAccept(owner, { role: 'EMPLOYEE', name: 'Elliot Employee' });

    const all = await owner.agent.get(`${API}/organizations/${owner.organization.id}/members`);
    expect(all.status).toBe(200);
    expect(all.body.meta.total).toBe(3);
    expect(all.body.meta.page).toBe(1);

    const filtered = await owner.agent.get(
      `${API}/organizations/${owner.organization.id}/members?role=EMPLOYEE`,
    );
    expect(filtered.body.data).toHaveLength(1);
    expect(filtered.body.data[0].role).toBe('EMPLOYEE');

    const searched = await owner.agent.get(
      `${API}/organizations/${owner.organization.id}/members?q=Morgan`,
    );
    expect(searched.body.data).toHaveLength(1);
    expect(searched.body.data[0].user.name).toBe('Morgan Manager');

    const paged = await owner.agent.get(
      `${API}/organizations/${owner.organization.id}/members?page=2&limit=2`,
    );
    expect(paged.body.data).toHaveLength(1);
    expect(paged.body.meta.totalPages).toBe(2);

    const invalid = await owner.agent.get(
      `${API}/organizations/${owner.organization.id}/members?limit=500`,
    );
    expect(invalid.status).toBe(422);

    // Search results must not expose password hashes.
    expect(JSON.stringify(all.body)).not.toContain('passwordHash');
  });
});

describe('membership management and role permissions', () => {
  it('lets an owner change roles and enforces the role hierarchy', async () => {
    const owner = await createOwner();
    const employee = await inviteAndAccept(owner, { role: 'EMPLOYEE' });

    const promote = await owner.agent
      .patch(`${API}/organizations/${owner.organization.id}/members/${employee.membership.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ role: 'MANAGER' });
    expect(promote.status).toBe(200);
    expect(promote.body.data.membership.role).toBe('MANAGER');

    const manager = await inviteAndAccept(owner, { role: 'MANAGER' });
    const managerInvite = await manager.agent
      .post(`${API}/organizations/${owner.organization.id}/invitations`)
      .set('x-csrf-token', manager.csrf)
      .send({ name: 'Invited Person', email: uniqueEmail(), role: 'EMPLOYEE' });
    expect(managerInvite.status).toBe(403);
    expect(managerInvite.body.error.code).toBe('PERMISSION_DENIED');

    const managerRoleChange = await manager.agent
      .patch(`${API}/organizations/${owner.organization.id}/members/${employee.membership.id}`)
      .set('x-csrf-token', manager.csrf)
      .send({ role: 'ADMIN' });
    expect(managerRoleChange.status).toBe(403);

    const managerList = await manager.agent.get(
      `${API}/organizations/${owner.organization.id}/members`,
    );
    expect(managerList.status).toBe(200);
  });

  it('allows admins to manage employees but not admins or owners', async () => {
    const owner = await createOwner();
    const admin = await inviteAndAccept(owner, { role: 'ADMIN' });
    const employee = await inviteAndAccept(owner, { role: 'EMPLOYEE' });

    const adminInvitesEmployee = await admin.agent
      .post(`${API}/organizations/${owner.organization.id}/invitations`)
      .set('x-csrf-token', admin.csrf)
      .send({ name: 'Invited Person', email: uniqueEmail(), role: 'EMPLOYEE' });
    expect(adminInvitesEmployee.status).toBe(201);

    const adminInvitesAdmin = await admin.agent
      .post(`${API}/organizations/${owner.organization.id}/invitations`)
      .set('x-csrf-token', admin.csrf)
      .send({ name: 'Admin Target', email: uniqueEmail(), role: 'ADMIN' });
    expect(adminInvitesAdmin.status).toBe(403);
    expect(adminInvitesAdmin.body.error.code).toBe('ROLE_ASSIGNMENT_FORBIDDEN');

    const suspendEmployee = await admin.agent
      .post(`${API}/organizations/${owner.organization.id}/members/${employee.membership.id}/suspend`)
      .set('x-csrf-token', admin.csrf);
    expect(suspendEmployee.status).toBe(200);
    expect(suspendEmployee.body.data.membership.status).toBe('SUSPENDED');

    const employeeAccess = await employee.agent.get(
      `${API}/organizations/${owner.organization.id}`,
    );
    expect(employeeAccess.status).toBe(403);
    expect(employeeAccess.body.error.code).toBe('MEMBERSHIP_INACTIVE');

    const reactivate = await admin.agent
      .post(`${API}/organizations/${owner.organization.id}/members/${employee.membership.id}/reactivate`)
      .set('x-csrf-token', admin.csrf);
    expect(reactivate.status).toBe(200);
    expect(reactivate.body.data.membership.status).toBe('ACTIVE');

    const employeeAccessAfter = await employee.agent.get(
      `${API}/organizations/${owner.organization.id}`,
    );
    expect(employeeAccessAfter.status).toBe(200);

    const suspendOwner = await admin.agent
      .post(`${API}/organizations/${owner.organization.id}/members/${owner.membership.id}/suspend`)
      .set('x-csrf-token', admin.csrf);
    expect(suspendOwner.status).toBe(403);
    expect(suspendOwner.body.error.code).toBe('ROLE_MANAGEMENT_FORBIDDEN');

    const suspendAdmin = await admin.agent
      .post(`${API}/organizations/${owner.organization.id}/members/${admin.membership.id}/suspend`)
      .set('x-csrf-token', admin.csrf);
    expect(suspendAdmin.status).toBe(403);
    expect(suspendAdmin.body.error.code).toBe('CANNOT_MODIFY_SELF');
  });

  it('prevents employees from listing members or mutating memberships', async () => {
    const owner = await createOwner();
    const employee = await inviteAndAccept(owner, { role: 'EMPLOYEE' });

    const list = await employee.agent.get(
      `${API}/organizations/${owner.organization.id}/members`,
    );
    expect(list.status).toBe(403);
    expect(list.body.error.code).toBe('PERMISSION_DENIED');

    const change = await employee.agent
      .patch(`${API}/organizations/${owner.organization.id}/members/${owner.membership.id}`)
      .set('x-csrf-token', employee.csrf)
      .send({ role: 'EMPLOYEE' });
    expect(change.status).toBe(403);
  });

  it('prevents self-modification and protects the last owner', async () => {
    const owner = await createOwner();

    const selfRoleChange = await owner.agent
      .patch(`${API}/organizations/${owner.organization.id}/members/${owner.membership.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ role: 'EMPLOYEE' });
    expect(selfRoleChange.status).toBe(403);
    expect(selfRoleChange.body.error.code).toBe('CANNOT_MODIFY_SELF');

    const selfRemove = await owner.agent
      .delete(`${API}/organizations/${owner.organization.id}/members/${owner.membership.id}`)
      .set('x-csrf-token', owner.csrf);
    expect(selfRemove.status).toBe(403);

    const promoteSecondOwner = await inviteAndAccept(owner, { role: 'ADMIN' });
    const promote = await owner.agent
      .patch(`${API}/organizations/${owner.organization.id}/members/${promoteSecondOwner.membership.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ role: 'OWNER' });
    expect(promote.status).toBe(200);
    expect(promote.body.data.membership.role).toBe('OWNER');

    // An owner may manage another owner when one owner remains.
    const demote = await owner.agent
      .patch(`${API}/organizations/${owner.organization.id}/members/${promoteSecondOwner.membership.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ role: 'ADMIN' });
    expect(demote.status).toBe(200);
  });

  it('removes memberships and denies further organization access', async () => {
    const owner = await createOwner();
    const employee = await inviteAndAccept(owner, { role: 'EMPLOYEE' });

    const remove = await owner.agent
      .delete(`${API}/organizations/${owner.organization.id}/members/${employee.membership.id}`)
      .set('x-csrf-token', owner.csrf);
    expect(remove.status).toBe(200);
    expect(remove.body.data.membership.status).toBe('REMOVED');

    const access = await employee.agent.get(`${API}/organizations/${owner.organization.id}`);
    expect(access.status).toBe(403);
    expect(access.body.error.code).toBe('MEMBERSHIP_INACTIVE');

    const list = await owner.agent.get(
      `${API}/organizations/${owner.organization.id}/members?status=REMOVED`,
    );
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);

    const listActive = await owner.agent.get(
      `${API}/organizations/${owner.organization.id}/members?status=ACTIVE`,
    );
    expect(listActive.body.data).toHaveLength(1);
  });

  it('rejects invalid role values', async () => {
    const owner = await createOwner();
    const employee = await inviteAndAccept(owner, { role: 'EMPLOYEE' });

    const invalid = await owner.agent
      .patch(`${API}/organizations/${owner.organization.id}/members/${employee.membership.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ role: 'SUPERUSER' });
    expect(invalid.status).toBe(422);
  });

  it('denies cross-organization membership mutation using foreign IDs', async () => {
    const ownerA = await createOwner(uniqueEmail('owner-a'), 'Alpha');
    const ownerB = await createOwner(uniqueEmail('owner-b'), 'Beta');

    const crossOrg = await ownerB.agent
      .patch(`${API}/organizations/${ownerA.organization.id}/members/${ownerA.membership.id}`)
      .set('x-csrf-token', ownerB.csrf)
      .send({ role: 'EMPLOYEE' });
    expect(crossOrg.status).toBe(404);

    const crossOrgDelete = await ownerB.agent
      .delete(`${API}/organizations/${ownerA.organization.id}/members/${ownerA.membership.id}`)
      .set('x-csrf-token', ownerB.csrf);
    expect(crossOrgDelete.status).toBe(404);
  });
});
