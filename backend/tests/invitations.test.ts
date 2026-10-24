import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  API,
  app,
  createOwner,
  inviteAndAccept,
  loginBrowser,
  registerUser,
  resetDatabase,
  uniqueEmail,
} from './helpers';
import { Invitation } from '../src/database';

beforeEach(async () => {
  await resetDatabase();
});

async function createInvitation(
  owner: Awaited<ReturnType<typeof createOwner>>,
  email: string,
  role: 'ADMIN' | 'MANAGER' | 'EMPLOYEE' = 'EMPLOYEE',
) {
  return owner.agent
    .post(`${API}/organizations/${owner.organization.id}/invitations`)
    .set('x-csrf-token', owner.csrf)
    .send({ email, role });
}

describe('invitations', () => {
  it('hashes invitation tokens at rest and returns the raw token only once', async () => {
    const owner = await createOwner();
    const email = uniqueEmail('invitee');

    const response = await createInvitation(owner, email, 'EMPLOYEE');
    expect(response.status).toBe(201);

    const { token, invitation } = response.body.data as {
      token: string;
      invitation: { id: string; email: string; role: string };
    };
    expect(token).toBeTruthy();
    expect(invitation.email).toBe(email);
    expect(invitation.role).toBe('EMPLOYEE');

    const stored = await Invitation.findByPk(invitation.id);
    expect(stored).toBeTruthy();
    expect(stored!.tokenHash).toHaveLength(64);
    expect(stored!.tokenHash).not.toBe(token);
    expect(JSON.stringify(stored!.toJSON())).not.toContain(token);

    const preview = await request(app).post(`${API}/invitations/preview`).send({ token });
    expect(preview.status).toBe(200);
    expect(preview.body.data.invitation.email).toBe(email);
    expect(preview.body.data.invitation.organization.id).toBe(owner.organization.id);
  });

  it('accepts an invitation once and creates a membership with the invited role', async () => {
    const owner = await createOwner();
    const accepted = await inviteAndAccept(owner, { role: 'MANAGER' });

    expect(accepted.acceptResponse.status).toBe(200);
    expect(accepted.membership.role).toBe('MANAGER');
    expect(accepted.membership.status).toBe('ACTIVE');

    const orgs = await accepted.agent.get(`${API}/organizations`);
    expect(orgs.body.data).toHaveLength(1);
    expect(orgs.body.data[0].id).toBe(owner.organization.id);

    // Second use of the same token is rejected.
    const reuse = await accepted.agent
      .post(`${API}/invitations/accept`)
      .set('x-csrf-token', accepted.csrf)
      .send({ token: accepted.token });
    expect(reuse.status).toBe(410);
    expect(reuse.body.error.code).toBe('INVITATION_ALREADY_USED');
  });

  it('rejects expired invitations', async () => {
    const owner = await createOwner();
    const email = uniqueEmail('expired');
    const response = await createInvitation(owner, email);
    const { token, invitation } = response.body.data;

    await Invitation.update(
      { expiresAt: new Date(Date.now() - 60_000) },
      { where: { id: invitation.id } },
    );

    await registerUser(email);
    const session = await loginBrowser(email);

    const accept = await session.agent
      .post(`${API}/invitations/accept`)
      .set('x-csrf-token', session.csrf)
      .send({ token });

    expect(accept.status).toBe(410);
    expect(accept.body.error.code).toBe('INVITATION_EXPIRED');
  });

  it('rejects revoked invitations', async () => {
    const owner = await createOwner();
    const email = uniqueEmail('revoked');
    const response = await createInvitation(owner, email);
    const { token, invitation } = response.body.data;

    const revoke = await owner.agent
      .delete(`${API}/organizations/${owner.organization.id}/invitations/${invitation.id}`)
      .set('x-csrf-token', owner.csrf);
    expect(revoke.status).toBe(200);
    expect(revoke.body.data.invitation.revokedAt).toBeTruthy();

    await registerUser(email);
    const session = await loginBrowser(email);

    const accept = await session.agent
      .post(`${API}/invitations/accept`)
      .set('x-csrf-token', session.csrf)
      .send({ token });

    expect(accept.status).toBe(410);
    expect(accept.body.error.code).toBe('INVITATION_REVOKED');
  });

  it('only lets the matching account accept an invitation', async () => {
    const owner = await createOwner();
    const email = uniqueEmail('intended');
    const response = await createInvitation(owner, email);
    const { token } = response.body.data;

    const otherEmail = uniqueEmail('someone-else');
    await registerUser(otherEmail);
    const other = await loginBrowser(otherEmail);

    const accept = await other.agent
      .post(`${API}/invitations/accept`)
      .set('x-csrf-token', other.csrf)
      .send({ token });

    expect(accept.status).toBe(403);
    expect(accept.body.error.code).toBe('INVITATION_EMAIL_MISMATCH');
  });

  it('requires authentication to accept and never accepts a client-supplied role', async () => {
    const owner = await createOwner();
    const email = uniqueEmail('role-attempt');
    const response = await createInvitation(owner, email, 'EMPLOYEE');
    const { token } = response.body.data;

    const unauthenticated = await request(app)
      .post(`${API}/invitations/accept`)
      .send({ token });
    expect(unauthenticated.status).toBe(401);

    await registerUser(email);
    const session = await loginBrowser(email);

    const withRole = await session.agent
      .post(`${API}/invitations/accept`)
      .set('x-csrf-token', session.csrf)
      .send({ token, role: 'OWNER' });
    expect(withRole.status).toBe(422);

    const accepted = await session.agent
      .post(`${API}/invitations/accept`)
      .set('x-csrf-token', session.csrf)
      .send({ token });
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.membership.role).toBe('EMPLOYEE');
  });

  it('rejects public attempts to assign privileged invitation roles', async () => {
    const owner = await createOwner();
    const email = uniqueEmail('owner-invite');

    const ownerRole = await createInvitation(owner, email, 'OWNER' as never);
    expect(ownerRole.status).toBe(422);

    const unknownRole = await createInvitation(owner, email, 'SUPERUSER' as never);
    expect(unknownRole.status).toBe(422);
  });

  it('keeps only one live invitation per email and rotates its token', async () => {
    const owner = await createOwner();
    const email = uniqueEmail('rotate');

    const first = await createInvitation(owner, email);
    const second = await createInvitation(owner, email);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.token).not.toBe(first.body.data.token);

    const firstPreview = await request(app)
      .post(`${API}/invitations/preview`)
      .send({ token: first.body.data.token });
    expect(firstPreview.status).toBe(410);
    expect(firstPreview.body.error.code).toBe('INVITATION_REVOKED');

    const secondPreview = await request(app)
      .post(`${API}/invitations/preview`)
      .send({ token: second.body.data.token });
    expect(secondPreview.status).toBe(200);

    const pending = await owner.agent.get(
      `${API}/organizations/${owner.organization.id}/invitations?status=pending`,
    );
    expect(pending.status).toBe(200);
    expect(pending.body.data).toHaveLength(1);
  });

  it('does not invite an existing active member', async () => {
    const owner = await createOwner();
    const employee = await inviteAndAccept(owner, { role: 'EMPLOYEE' });

    const response = await createInvitation(owner, employee.email);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('MEMBER_ALREADY_EXISTS');
  });

  it('does not allow cross-organization invitation revocation', async () => {
    const ownerA = await createOwner(uniqueEmail('owner-a'), 'Alpha');
    const ownerB = await createOwner(uniqueEmail('owner-b'), 'Beta');

    const response = await createInvitation(ownerA, uniqueEmail('target'));
    const invitationId = response.body.data.invitation.id as string;

    const crossRevoke = await ownerB.agent
      .delete(`${API}/organizations/${ownerA.organization.id}/invitations/${invitationId}`)
      .set('x-csrf-token', ownerB.csrf);
    expect(crossRevoke.status).toBe(404);
    expect(crossRevoke.body.error.code).toBe('ORGANIZATION_NOT_FOUND');

    const stillValid = await request(app)
      .post(`${API}/invitations/preview`)
      .send({ token: response.body.data.token });
    expect(stillValid.status).toBe(200);
  });

  it('rejects malformed or unknown tokens', async () => {
    const malformed = await request(app)
      .post(`${API}/invitations/preview`)
      .send({ token: 'short' });
    expect(malformed.status).toBe(422);

    const unknown = await request(app)
      .post(`${API}/invitations/preview`)
      .send({ token: 'a'.repeat(43) });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe('INVITATION_INVALID');
  });
});
