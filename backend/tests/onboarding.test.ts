import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuditEvent, Invitation, Membership } from '../src/database';
import {
  API,
  PASSWORD,
  app,
  createOwner,
  inviteAndAccept,
  resetDatabase,
  uniqueEmail,
  type OwnerContext,
} from './helpers';

beforeEach(async () => {
  await resetDatabase();
});

function rolesPath(organizationId: string): string {
  return `${API}/organizations/${organizationId}/roles`;
}

function invitationsPath(organizationId: string): string {
  return `${API}/organizations/${organizationId}/invitations`;
}

async function createRole(owner: OwnerContext, body: Record<string, unknown>) {
  const response = await owner.agent
    .post(rolesPath(owner.organization.id))
    .set('x-csrf-token', owner.csrf)
    .send(body);
  expect(response.status).toBe(201);
  return response.body.data.role as { id: string; name: string };
}

async function assignRole(owner: OwnerContext, membershipId: string, customRoleId: string) {
  const response = await owner.agent
    .patch(`${API}/organizations/${owner.organization.id}/members/${membershipId}`)
    .set('x-csrf-token', owner.csrf)
    .send({ customRoleId });
  expect(response.status).toBe(200);
}

async function invite(actor: { agent: OwnerContext['agent']; csrf: string }, organizationId: string, body: Record<string, unknown>) {
  return actor.agent
    .post(invitationsPath(organizationId))
    .set('x-csrf-token', actor.csrf)
    .send({ name: 'Invited Person', ...body });
}

/** First-time acceptance creates the account and signs it in. */
async function acceptInvitation(token: string) {
  const agent = request.agent(app);
  const accepted = await agent.post(`${API}/invitations/accept`).send({
    token,
    password: PASSWORD,
  });
  return {
    session: {
      agent,
      csrf: accepted.body.data.session?.csrfToken as string,
      user: accepted.body.data.user as { id: string },
    },
    accepted,
  };
}

async function onboardingHost(owner: OwnerContext) {
  const host = await inviteAndAccept(owner, { role: 'EMPLOYEE' });
  const role = await createRole(owner, {
    name: 'Onboarding Host',
    permissions: ['organization:read', 'member:read', 'member:onboard'],
    dataScope: 'SELF',
    onboardingEligible: true,
  });
  await assignRole(owner, host.membership.id, role.id);
  return { host, role };
}

describe('member:onboard delegation', () => {
  it('lets an onboarding custom role invite only employee-level people and manage its own invitations', async () => {
    const owner = await createOwner();
    const orgId = owner.organization.id;
    const { host } = await onboardingHost(owner);

    const eligible = await createRole(owner, {
      name: 'New Hire',
      permissions: ['organization:read', 'time:read'],
      dataScope: 'SELF',
      onboardingEligible: true,
    });
    const ineligible = await createRole(owner, {
      name: 'Closed Role',
      permissions: ['organization:read'],
      dataScope: 'SELF',
    });

    const employeeInvite = await invite(host, orgId, {
      email: uniqueEmail('onboardee'),
      role: 'EMPLOYEE',
    });
    expect(employeeInvite.status).toBe(201);
    expect(employeeInvite.body.data.invitation).toMatchObject({
      role: 'EMPLOYEE',
      customRoleId: null,
    });

    const customInvite = await invite(host, orgId, {
      email: uniqueEmail('custom-onboardee'),
      customRoleId: eligible.id,
    });
    expect(customInvite.status).toBe(201);
    expect(customInvite.body.data.invitation).toMatchObject({
      role: 'EMPLOYEE',
      customRoleId: eligible.id,
      customRole: { id: eligible.id, name: 'New Hire' },
    });

    const adminInvite = await invite(host, orgId, {
      email: uniqueEmail('admin-target'),
      role: 'ADMIN',
    });
    expect(adminInvite.status).toBe(403);
    expect(adminInvite.body.error.code).toBe('ROLE_ASSIGNMENT_FORBIDDEN');

    const managerInvite = await invite(host, orgId, {
      email: uniqueEmail('manager-target'),
      role: 'MANAGER',
    });
    expect(managerInvite.status).toBe(403);

    const ineligibleInvite = await invite(host, orgId, {
      email: uniqueEmail('closed-target'),
      customRoleId: ineligible.id,
    });
    expect(ineligibleInvite.status).toBe(403);
    expect(ineligibleInvite.body.error.code).toBe('ROLE_NOT_ONBOARDING_ELIGIBLE');

    const mixedInvite = await invite(host, orgId, {
      email: uniqueEmail('mixed-target'),
      role: 'ADMIN',
      customRoleId: eligible.id,
    });
    expect(mixedInvite.status).toBe(403);

    const escalationPayload = await invite(host, orgId, {
      email: uniqueEmail('escalation'),
      role: 'EMPLOYEE',
      permissions: ['role:manage'],
    });
    expect(escalationPayload.status).toBe(422);

    const scopePayload = await invite(host, orgId, {
      email: uniqueEmail('escalation'),
      role: 'EMPLOYEE',
      dataScope: 'ORGANIZATION',
    });
    expect(scopePayload.status).toBe(422);

    const otherOrganization = await createOwner(uniqueEmail('owner'), 'Other Org');
    const foreignRole = await createRole(otherOrganization, {
      name: 'Foreign Onboarding',
      permissions: ['organization:read'],
      onboardingEligible: true,
    });
    const foreignInvite = await invite(host, orgId, {
      email: uniqueEmail('foreign-target'),
      customRoleId: foreignRole.id,
    });
    expect(foreignInvite.status).toBe(404);
    expect(foreignInvite.body.error.code).toBe('ROLE_NOT_FOUND');

    const ownerInvite = await invite(owner, orgId, {
      email: uniqueEmail('owner-created'),
      role: 'EMPLOYEE',
    });
    expect(ownerInvite.status).toBe(201);

    const list = await host.agent.get(invitationsPath(orgId));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(2);
    const listedIds = (list.body.data as Array<{ id: string }>).map((entry) => entry.id);
    expect(listedIds).not.toContain(ownerInvite.body.data.invitation.id);

    const revokeOwnerInvitation = await host.agent
      .delete(`${invitationsPath(orgId)}/${ownerInvite.body.data.invitation.id}`)
      .set('x-csrf-token', host.csrf);
    expect(revokeOwnerInvitation.status).toBe(404);

    const revokeOwn = await host.agent
      .delete(`${invitationsPath(orgId)}/${employeeInvite.body.data.invitation.id}`)
      .set('x-csrf-token', host.csrf);
    expect(revokeOwn.status).toBe(200);

    const createdAudit = await AuditEvent.findOne({
      where: {
        organizationId: orgId,
        action: 'INVITATION_CREATED',
        entityId: customInvite.body.data.invitation.id,
      },
    });
    expect(createdAudit).not.toBeNull();
    expect(createdAudit!.actorUserId).toBe(host.user.id);

    const revokedAudit = await AuditEvent.findOne({
      where: {
        organizationId: orgId,
        action: 'INVITATION_REVOKED',
        entityId: employeeInvite.body.data.invitation.id,
      },
    });
    expect(revokedAudit).not.toBeNull();
    expect(revokedAudit!.actorUserId).toBe(host.user.id);
  });

  it('grants only the employee-level custom role on acceptance and audits it', async () => {
    const owner = await createOwner();
    const orgId = owner.organization.id;
    const { host } = await onboardingHost(owner);

    const newHire = await createRole(owner, {
      name: 'New Hire',
      permissions: ['organization:read', 'time:read'],
      dataScope: 'SELF',
      onboardingEligible: true,
    });

    const email = uniqueEmail('onboarded');
    const created = await invite(host, orgId, { email, customRoleId: newHire.id });
    expect(created.status).toBe(201);

    const { session, accepted } = await acceptInvitation(created.body.data.token);
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.membership).toMatchObject({
      role: 'EMPLOYEE',
      customRoleId: newHire.id,
      permissions: ['organization:read', 'time:read'],
      dataScope: 'SELF',
      customRole: { id: newHire.id, name: 'New Hire' },
    });
    expect(accepted.body.data.membership.permissions).not.toContain('member:onboard');
    expect(accepted.body.data.membership.permissions).not.toContain('member:invite');

    const stored = await Membership.findOne({
      where: { organizationId: orgId, userId: session.user.id },
    });
    expect(stored).toMatchObject({ role: 'EMPLOYEE', customRoleId: newHire.id });

    const invitation = await Invitation.findOne({ where: { email } });
    expect(invitation!.acceptedAt).not.toBeNull();

    const audit = await AuditEvent.findOne({
      where: {
        organizationId: orgId,
        action: 'INVITATION_ACCEPTED',
        entityId: created.body.data.invitation.id,
      },
    });
    expect(audit).not.toBeNull();
    expect(audit!.metadata).toMatchObject({ customRoleId: newHire.id, role: 'EMPLOYEE' });
  });

  it('falls back to employee access when the custom role is no longer onboarding eligible', async () => {
    const owner = await createOwner();
    const orgId = owner.organization.id;
    const { host } = await onboardingHost(owner);

    const newHire = await createRole(owner, {
      name: 'New Hire',
      permissions: ['organization:read', 'time:read'],
      onboardingEligible: true,
    });

    const email = uniqueEmail('revoked-eligibility');
    const created = await invite(host, orgId, { email, customRoleId: newHire.id });
    expect(created.status).toBe(201);

    const toggled = await owner.agent
      .patch(`${rolesPath(orgId)}/${newHire.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ onboardingEligible: false });
    expect(toggled.status).toBe(200);

    const { accepted } = await acceptInvitation(created.body.data.token);
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.membership).toMatchObject({
      role: 'EMPLOYEE',
      customRoleId: null,
    });
    expect(accepted.body.data.membership.permissions).not.toContain('member:onboard');
  });

  it('rejects invitations from custom roles without member:onboard', async () => {
    const owner = await createOwner();
    const employee = await inviteAndAccept(owner, { role: 'EMPLOYEE' });
    const role = await createRole(owner, {
      name: 'Directory Only',
      permissions: ['organization:read', 'member:read'],
      onboardingEligible: true,
    });
    await assignRole(owner, employee.membership.id, role.id);

    const create = await invite(employee, owner.organization.id, {
      email: uniqueEmail('blocked'),
      role: 'EMPLOYEE',
    });
    expect(create.status).toBe(403);
    expect(create.body.error.code).toBe('PERMISSION_DENIED');

    const list = await employee.agent.get(invitationsPath(owner.organization.id));
    expect(list.status).toBe(403);

    const revoke = await employee.agent
      .delete(`${invitationsPath(owner.organization.id)}/00000000-0000-4000-8000-000000000000`)
      .set('x-csrf-token', employee.csrf);
    expect(revoke.status).toBe(403);
  });

  it('preserves owner and admin invitation boundaries for onboarding-eligible roles', async () => {
    const owner = await createOwner();
    const orgId = owner.organization.id;
    const admin = await inviteAndAccept(owner, { role: 'ADMIN' });

    const eligible = await createRole(owner, {
      name: 'New Hire',
      permissions: ['organization:read'],
      onboardingEligible: true,
    });
    const ineligible = await createRole(owner, {
      name: 'Closed Role',
      permissions: ['organization:read'],
    });

    const adminInvitesAdmin = await invite(admin, orgId, {
      email: uniqueEmail('admin-target'),
      role: 'ADMIN',
    });
    expect(adminInvitesAdmin.status).toBe(403);
    expect(adminInvitesAdmin.body.error.code).toBe('ROLE_ASSIGNMENT_FORBIDDEN');

    const adminInvitesEmployee = await invite(admin, orgId, {
      email: uniqueEmail('employee-target'),
      role: 'EMPLOYEE',
    });
    expect(adminInvitesEmployee.status).toBe(201);

    const adminInvitesEligible = await invite(admin, orgId, {
      email: uniqueEmail('eligible-target'),
      customRoleId: eligible.id,
    });
    expect(adminInvitesEligible.status).toBe(201);

    const adminInvitesIneligible = await invite(admin, orgId, {
      email: uniqueEmail('ineligible-target'),
      customRoleId: ineligible.id,
    });
    expect(adminInvitesIneligible.status).toBe(403);

    const ownerInvitesAdmin = await invite(owner, orgId, {
      email: uniqueEmail('owner-admin-target'),
      role: 'ADMIN',
    });
    expect(ownerInvitesAdmin.status).toBe(201);

    const ownerInvitesIneligible = await invite(owner, orgId, {
      email: uniqueEmail('owner-ineligible'),
      customRoleId: ineligible.id,
    });
    expect(ownerInvitesIneligible.status).toBe(403);
  });
});
