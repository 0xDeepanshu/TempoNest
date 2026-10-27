import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { Membership, Organization, User } from '../src/database';
import {
  API,
  PASSWORD,
  app,
  createOwner,
  desktopAuth,
  inviteAndAccept,
  registerAgent,
  resetDatabase,
  uniqueEmail,
} from './helpers';

beforeEach(async () => {
  await resetDatabase();
});

async function setPlatformRole(email: string, role: 'SUPERADMIN' | null) {
  const [updated] = await User.update({ platformRole: role }, { where: { email } });
  expect(updated).toBe(1);
}

async function elevate(email: string) {
  await setPlatformRole(email, 'SUPERADMIN');
}

describe('platform authorization', () => {
  it('requires authentication and rejects organization owners', async () => {
    const anonymous = await request(app).get(`${API}/platform/organizations`);
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error.code).toBe('UNAUTHENTICATED');

    const owner = await createOwner();
    const list = await owner.agent.get(`${API}/platform/organizations`);
    expect(list.status).toBe(403);
    expect(list.body.error.code).toBe('PLATFORM_ACCESS_REQUIRED');

    const rename = await owner.agent
      .patch(`${API}/platform/organizations/${owner.organization.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ name: 'Owner Takeover' });
    expect(rename.status).toBe(403);
    expect(rename.body.error.code).toBe('PLATFORM_ACCESS_REQUIRED');

    const suspend = await owner.agent
      .post(`${API}/platform/organizations/${owner.organization.id}/suspend`)
      .set('x-csrf-token', owner.csrf);
    expect(suspend.status).toBe(403);

    const audit = await owner.agent.get(`${API}/platform/audit-events`);
    expect(audit.status).toBe(403);
  });

  it('applies platform role changes to an existing session immediately', async () => {
    const owner = await createOwner();

    await elevate(owner.email);
    const granted = await owner.agent.get(`${API}/platform/overview`);
    expect(granted.status).toBe(200);

    await setPlatformRole(owner.email, null);
    const revoked = await owner.agent.get(`${API}/platform/overview`);
    expect(revoked.status).toBe(403);
    expect(revoked.body.error.code).toBe('PLATFORM_ACCESS_REQUIRED');
  });
});

describe('platform organization listing', () => {
  it('returns real overview counts and supports search, filters and pagination', async () => {
    const alpha = await createOwner(uniqueEmail('alpha-owner'), 'Alpha Studio');
    await createOwner(uniqueEmail('beta-owner'), 'Beta Works');
    await elevate(alpha.email);

    const overview = await alpha.agent.get(`${API}/platform/overview`);
    expect(overview.status).toBe(200);
    expect(overview.body.data).toEqual({ total: 2, active: 2, suspended: 0, deleted: 0 });

    const all = await alpha.agent.get(`${API}/platform/organizations`);
    expect(all.status).toBe(200);
    expect(all.body.meta.total).toBe(2);
    expect(all.body.data).toHaveLength(2);
    expect(JSON.stringify(all.body)).not.toContain('passwordHash');
    expect(JSON.stringify(all.body)).not.toContain('platformRole');

    const searched = await alpha.agent.get(`${API}/platform/organizations?q=alpha`);
    expect(searched.body.data).toHaveLength(1);
    expect(searched.body.data[0].name).toBe('Alpha Studio');

    const bySlug = await alpha.agent.get(`${API}/platform/organizations?q=${alpha.organization.slug}`);
    expect(bySlug.body.data).toHaveLength(1);
    expect(bySlug.body.data[0].id).toBe(alpha.organization.id);

    const paged = await alpha.agent.get(`${API}/platform/organizations?page=2&limit=1`);
    expect(paged.body.data).toHaveLength(1);
    expect(paged.body.meta.totalPages).toBe(2);

    const invalid = await alpha.agent.get(`${API}/platform/organizations/not-a-uuid`);
    expect(invalid.status).toBe(422);
  });

  it('lets a platform admin inspect any organization without tenant access', async () => {
    const alpha = await createOwner(uniqueEmail('alpha-owner'), 'Alpha Studio');
    const beta = await createOwner(uniqueEmail('beta-owner'), 'Beta Works');
    await elevate(alpha.email);

    const detail = await alpha.agent.get(
      `${API}/platform/organizations/${beta.organization.id}`,
    );
    expect(detail.status).toBe(200);
    expect(detail.body.data.name).toBe('Beta Works');
    expect(detail.body.data.memberCount).toBe(1);
    expect(detail.body.data.slug).toBe(beta.organization.slug);

    // Platform authority does not create organization membership.
    const tenantRead = await alpha.agent.get(`${API}/organizations/${beta.organization.id}`);
    expect(tenantRead.status).toBe(404);
    expect(tenantRead.body.error.code).toBe('ORGANIZATION_NOT_FOUND');
  });
});

describe('platform organization operations', () => {
  it('renames only the display name and records an audit trail', async () => {
    const owner = await createOwner(uniqueEmail('owner'), 'Alpha Studio');
    const employee = await inviteAndAccept(owner, { role: 'EMPLOYEE' });
    const originalId = owner.organization.id;
    const originalSlug = owner.organization.slug;
    await elevate(owner.email);

    const renamed = await owner.agent
      .patch(`${API}/platform/organizations/${originalId}`)
      .set('x-csrf-token', owner.csrf)
      .send({ name: 'Alpha Holdings' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.name).toBe('Alpha Holdings');
    expect(renamed.body.data.id).toBe(originalId);
    expect(renamed.body.data.slug).toBe(originalSlug);

    const ownerRead = await owner.agent.get(`${API}/organizations/${originalId}`);
    expect(ownerRead.status).toBe(200);
    expect(ownerRead.body.data.organization.name).toBe('Alpha Holdings');

    const employeeRead = await employee.agent.get(`${API}/organizations/${originalId}`);
    expect(employeeRead.status).toBe(200);
    expect(employeeRead.body.data.organization.name).toBe('Alpha Holdings');

    const unchanged = await owner.agent
      .patch(`${API}/platform/organizations/${originalId}`)
      .set('x-csrf-token', owner.csrf)
      .send({ name: 'Alpha Holdings' });
    expect(unchanged.status).toBe(409);
    expect(unchanged.body.error.code).toBe('ORGANIZATION_NAME_UNCHANGED');

    const audit = await owner.agent.get(
      `${API}/platform/audit-events?organizationId=${originalId}`,
    );
    expect(audit.status).toBe(200);
    expect(audit.body.meta.total).toBe(1);
    expect(audit.body.data[0].action).toBe('ORGANIZATION_RENAMED');
    expect(audit.body.data[0].actor.email).toBe(owner.email);
    expect(audit.body.data[0].organization.name).toBe('Alpha Holdings');
    expect(audit.body.data[0].metadata.before.name).toBe('Alpha Studio');
    expect(audit.body.data[0].metadata.after.name).toBe('Alpha Holdings');
  });

  it('suspends all tenant access immediately and restores it on reactivation', async () => {
    const owner = await createOwner(uniqueEmail('owner'), 'Alpha Studio');
    const employee = await inviteAndAccept(owner, { role: 'EMPLOYEE' });
    const other = await createOwner(uniqueEmail('other-owner'), 'Beta Works');
    await elevate(owner.email);

    const suspended = await owner.agent
      .post(`${API}/platform/organizations/${owner.organization.id}/suspend`)
      .set('x-csrf-token', owner.csrf);
    expect(suspended.status).toBe(200);
    expect(suspended.body.data.status).toBe('SUSPENDED');

    const ownerRead = await owner.agent.get(
      `${API}/organizations/${owner.organization.id}`,
    );
    expect(ownerRead.status).toBe(403);
    expect(ownerRead.body.error.code).toBe('ORGANIZATION_SUSPENDED');

    const employeeRead = await employee.agent.get(
      `${API}/organizations/${owner.organization.id}`,
    );
    expect(employeeRead.status).toBe(403);
    expect(employeeRead.body.error.code).toBe('ORGANIZATION_SUSPENDED');

    // Non-org-scoped endpoints still work, and other tenants are unaffected.
    const memberships = await employee.agent.get(`${API}/organizations`);
    expect(memberships.status).toBe(200);
    expect(memberships.body.data[0].status).toBe('SUSPENDED');
    const otherRead = await other.agent.get(`${API}/organizations/${other.organization.id}`);
    expect(otherRead.status).toBe(200);

    const duplicate = await owner.agent
      .post(`${API}/platform/organizations/${owner.organization.id}/suspend`)
      .set('x-csrf-token', owner.csrf);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('ORGANIZATION_ALREADY_SUSPENDED');

    const reactivated = await owner.agent
      .post(`${API}/platform/organizations/${owner.organization.id}/reactivate`)
      .set('x-csrf-token', owner.csrf);
    expect(reactivated.status).toBe(200);
    expect(reactivated.body.data.status).toBe('ACTIVE');

    const restored = await employee.agent.get(
      `${API}/organizations/${owner.organization.id}`,
    );
    expect(restored.status).toBe(200);

    const duplicateReactivate = await owner.agent
      .post(`${API}/platform/organizations/${owner.organization.id}/reactivate`)
      .set('x-csrf-token', owner.csrf);
    expect(duplicateReactivate.status).toBe(409);
    expect(duplicateReactivate.body.error.code).toBe('ORGANIZATION_ALREADY_ACTIVE');

    const audit = await owner.agent.get(
      `${API}/platform/audit-events?organizationId=${owner.organization.id}`,
    );
    expect(audit.body.data.map((event: { action: string }) => event.action)).toEqual([
      'ORGANIZATION_REACTIVATED',
      'ORGANIZATION_SUSPENDED',
    ]);
  });

  it('requires both the typed name and password, preserving tenant data on soft delete', async () => {
    const owner = await createOwner(uniqueEmail('owner'), 'Alpha Studio');
    await inviteAndAccept(owner, { role: 'EMPLOYEE' });
    await elevate(owner.email);

    const membershipCount = await Membership.count({
      where: { organizationId: owner.organization.id },
    });
    const userCount = await User.count();
    expect(membershipCount).toBe(2);

    const wrongName = await owner.agent
      .delete(`${API}/platform/organizations/${owner.organization.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ confirmationName: 'Not Alpha', password: PASSWORD });
    expect(wrongName.status).toBe(400);
    expect(wrongName.body.error.code).toBe('ORGANIZATION_NAME_MISMATCH');

    const wrongPassword = await owner.agent
      .delete(`${API}/platform/organizations/${owner.organization.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ confirmationName: 'Alpha Studio', password: 'definitely-wrong' });
    expect(wrongPassword.status).toBe(403);
    expect(wrongPassword.body.error.code).toBe('REAUTH_FAILED');

    const stillThere = await owner.agent.get(
      `${API}/organizations/${owner.organization.id}`,
    );
    expect(stillThere.status).toBe(200);

    const deleted = await owner.agent
      .delete(`${API}/platform/organizations/${owner.organization.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ confirmationName: 'Alpha Studio', password: PASSWORD });
    expect(deleted.status).toBe(200);
    expect(deleted.body.data.status).toBe('DELETED');
    expect(deleted.body.data.deletedAt).toBeTruthy();
    expect(deleted.body.data.memberCount).toBe(2);

    const tenantRead = await owner.agent.get(
      `${API}/organizations/${owner.organization.id}`,
    );
    expect(tenantRead.status).toBe(404);
    expect(tenantRead.body.error.code).toBe('ORGANIZATION_NOT_FOUND');

    const membershipList = await owner.agent.get(`${API}/organizations`);
    expect(membershipList.status).toBe(200);
    expect(
      membershipList.body.data.some(
        (item: { id: string }) => item.id === owner.organization.id,
      ),
    ).toBe(false);

    // Soft deletion retains every tenant row and user account.
    const organizationRow = await Organization.findByPk(owner.organization.id);
    expect(organizationRow).toBeTruthy();
    expect(organizationRow!.deletedAt).toBeInstanceOf(Date);
    expect(await Membership.count({ where: { organizationId: owner.organization.id } })).toBe(
      membershipCount,
    );
    expect(await User.count()).toBe(userCount);

    const deletedFilter = await owner.agent.get(
      `${API}/platform/organizations?status=DELETED`,
    );
    expect(deletedFilter.body.data).toHaveLength(1);
    expect(deletedFilter.body.data[0].id).toBe(owner.organization.id);

    const activeFilter = await owner.agent.get(
      `${API}/platform/organizations?status=ACTIVE`,
    );
    expect(activeFilter.body.data).toHaveLength(0);

    const renameDeleted = await owner.agent
      .patch(`${API}/platform/organizations/${owner.organization.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ name: 'Ghost Org' });
    expect(renameDeleted.status).toBe(409);
    expect(renameDeleted.body.error.code).toBe('ORGANIZATION_DELETED');

    const suspendDeleted = await owner.agent
      .post(`${API}/platform/organizations/${owner.organization.id}/suspend`)
      .set('x-csrf-token', owner.csrf);
    expect(suspendDeleted.status).toBe(409);
    expect(suspendDeleted.body.error.code).toBe('ORGANIZATION_DELETED');

    const deleteAgain = await owner.agent
      .delete(`${API}/platform/organizations/${owner.organization.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ confirmationName: 'Alpha Studio', password: PASSWORD });
    expect(deleteAgain.status).toBe(409);
    expect(deleteAgain.body.error.code).toBe('ORGANIZATION_ALREADY_DELETED');

    const audit = await owner.agent.get(`${API}/platform/audit-events`);
    expect(audit.body.data).toHaveLength(1);
    expect(audit.body.data[0].action).toBe('ORGANIZATION_SOFT_DELETED');
    expect(audit.body.data[0].metadata.retention).toBe('tenant_data_preserved');
    expect(audit.body.data[0].metadata.before.name).toBe('Alpha Studio');
    expect(JSON.stringify(audit.body)).not.toContain(PASSWORD);
    expect(JSON.stringify(audit.body)).not.toContain('passwordHash');
  });

  it('filters platform audit events by organization and action', async () => {
    const first = await createOwner(uniqueEmail('first-owner'), 'First Org');
    const second = await createOwner(uniqueEmail('second-owner'), 'Second Org');
    await elevate(first.email);

    await first.agent
      .patch(`${API}/platform/organizations/${first.organization.id}`)
      .set('x-csrf-token', first.csrf)
      .send({ name: 'First Org Renamed' });
    await first.agent
      .post(`${API}/platform/organizations/${second.organization.id}/suspend`)
      .set('x-csrf-token', first.csrf);

    const all = await first.agent.get(`${API}/platform/audit-events`);
    expect(all.status).toBe(200);
    expect(all.body.meta.total).toBe(2);

    const firstOrgEvents = await first.agent.get(
      `${API}/platform/audit-events?organizationId=${first.organization.id}`,
    );
    expect(firstOrgEvents.body.data).toHaveLength(1);
    expect(firstOrgEvents.body.data[0].action).toBe('ORGANIZATION_RENAMED');

    const suspensions = await first.agent.get(
      `${API}/platform/audit-events?action=ORGANIZATION_SUSPENDED`,
    );
    expect(suspensions.body.data).toHaveLength(1);
    expect(suspensions.body.data[0].organization.id).toBe(second.organization.id);
    expect(suspensions.body.data[0].metadata.before.status).toBe('ACTIVE');
    expect(suspensions.body.data[0].metadata.after.status).toBe('SUSPENDED');
    expect(JSON.stringify(suspensions.body)).not.toContain('accessToken');
    expect(JSON.stringify(suspensions.body)).not.toContain('csrfToken');
  });

  it('rejects device credential checks for a suspended organization', async () => {
    const owner = await createOwner();
    const desktop = await desktopAuth(owner.email);
    const agent = await registerAgent(desktop, owner.organization.id);
    await elevate(owner.email);

    const before = await request(app)
      .post(`${API}/desktop-agents/authenticate`)
      .send({ agentId: agent.id, agentKey: agent.key });
    expect(before.status).toBe(200);

    await owner.agent
      .post(`${API}/platform/organizations/${owner.organization.id}/suspend`)
      .set('x-csrf-token', owner.csrf);

    const after = await request(app)
      .post(`${API}/desktop-agents/authenticate`)
      .send({ agentId: agent.id, agentKey: agent.key });
    expect(after.status).toBe(403);
    expect(after.body.error.code).toBe('ORGANIZATION_SUSPENDED');
  });
});
