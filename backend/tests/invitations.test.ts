import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  API,
  PASSWORD,
  app,
  createOwner,
  inviteAndAccept,
  loginBrowser,
  registerUser,
  resetDatabase,
  uniqueEmail,
} from './helpers';
import { Invitation, User } from '../src/database';
import { getMemoryOutbox } from '../src/utils/mailer';

beforeEach(async () => {
  await resetDatabase();
});

async function createInvitation(
  owner: Awaited<ReturnType<typeof createOwner>>,
  email: string,
  role: 'ADMIN' | 'MANAGER' | 'EMPLOYEE' = 'EMPLOYEE',
  name = 'Invited Person',
) {
  return owner.agent
    .post(`${API}/organizations/${owner.organization.id}/invitations`)
    .set('x-csrf-token', owner.csrf)
    .send({ name, email, role });
}

describe('invitations', () => {
  it('stores the invited name, hashes the token, and e-mails the invitation', async () => {
    const owner = await createOwner();
    const email = uniqueEmail('invitee');

    const response = await createInvitation(owner, email, 'EMPLOYEE', 'Riley Recruit');
    expect(response.status).toBe(201);

    const { token, invitation, emailSent } = response.body.data as {
      token: string;
      emailSent: boolean;
      invitation: { id: string; name: string; email: string; role: string };
    };
    expect(token).toBeTruthy();
    expect(emailSent).toBe(true);
    expect(invitation).toMatchObject({ name: 'Riley Recruit', email, role: 'EMPLOYEE' });

    const stored = await Invitation.findByPk(invitation.id);
    expect(stored).toBeTruthy();
    expect(stored!.name).toBe('Riley Recruit');
    expect(stored!.tokenHash).toHaveLength(64);
    expect(stored!.tokenHash).not.toBe(token);
    expect(JSON.stringify(stored!.toJSON())).not.toContain(token);

    const outbox = getMemoryOutbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.to).toBe(email);
    expect(outbox[0]!.html).toContain('/invitations/accept?token=');

    const preview = await request(app).post(`${API}/invitations/preview`).send({ token });
    expect(preview.status).toBe(200);
    expect(preview.body.data.invitation).toMatchObject({
      name: 'Riley Recruit',
      email,
      existingAccount: false,
      signedInEmail: null,
      signedInMatches: false,
    });
    expect(preview.body.data.invitation.organization.id).toBe(owner.organization.id);
  });

  it('creates the account and membership, signs in, and accepts only once', async () => {
    const owner = await createOwner();
    const accepted = await inviteAndAccept(owner, {
      role: 'MANAGER',
      name: 'Morgan Manager',
    });

    expect(accepted.acceptResponse.status).toBe(200);
    expect(accepted.acceptResponse.body.data.accountCreated).toBe(true);
    expect(accepted.membership.role).toBe('MANAGER');
    expect(accepted.membership.status).toBe('ACTIVE');
    expect(accepted.csrf).toBeTruthy();

    const user = await User.findOne({ where: { email: accepted.email } });
    expect(user!.name).toBe('Morgan Manager');

    const orgs = await accepted.agent.get(`${API}/organizations`);
    expect(orgs.status).toBe(200);
    expect(orgs.body.data).toHaveLength(1);
    expect(orgs.body.data[0].id).toBe(owner.organization.id);

    // The same token cannot be used again.
    const reuse = await accepted.agent
      .post(`${API}/invitations/accept`)
      .set('x-csrf-token', accepted.csrf)
      .send({ token: accepted.token });
    expect(reuse.status).toBe(410);
    expect(reuse.body.error.code).toBe('INVITATION_ALREADY_USED');

    // Subsequent sign-ins are the normal email + password flow.
    const login = await loginBrowser(accepted.email);
    expect(login.response.status).toBe(200);
  });

  it('lets an existing account accept only after signing in and never rewrites its password', async () => {
    const owner = await createOwner();
    const email = uniqueEmail('existing');
    await registerUser(email, 'Existing Person');

    const created = await createInvitation(owner, email);
    const token = created.body.data.token as string;

    const anonymous = await request(app)
      .post(`${API}/invitations/accept`)
      .send({ token, password: 'AnotherStrongPassw0rd!' });
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error.code).toBe('ACCOUNT_EXISTS_SIGN_IN');

    const session = await loginBrowser(email);
    expect(session.response.status).toBe(200);

    const accepted = await session.agent
      .post(`${API}/invitations/accept`)
      .set('x-csrf-token', session.csrf)
      .send({ token });
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.accountCreated).toBe(false);
    expect(accepted.body.data.session).toBeNull();

    // The original password still works; acceptance did not change it.
    const relogin = await loginBrowser(email);
    expect(relogin.response.status).toBe(200);
    const wrongPassword = await loginBrowser(email, 'AnotherStrongPassw0rd!');
    expect(wrongPassword.response.status).toBe(401);
  });

  it('lets an existing user join a second organization without duplicating the account', async () => {
    const ownerA = await createOwner(uniqueEmail('owner-a'), 'Alpha');
    const ownerB = await createOwner(uniqueEmail('owner-b'), 'Beta');
    const email = uniqueEmail('multi-org');

    const first = await inviteAndAccept(ownerA, { email, name: 'Multi Org' });
    expect(first.acceptResponse.status).toBe(200);

    const inviteB = await ownerB.agent
      .post(`${API}/organizations/${ownerB.organization.id}/invitations`)
      .set('x-csrf-token', ownerB.csrf)
      .send({ name: 'Multi Org', email, role: 'EMPLOYEE' });
    expect(inviteB.status).toBe(201);

    const session = await loginBrowser(email);
    const accepted = await session.agent
      .post(`${API}/invitations/accept`)
      .set('x-csrf-token', session.csrf)
      .send({ token: inviteB.body.data.token });
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.accountCreated).toBe(false);
    expect(accepted.body.data.organization.id).toBe(ownerB.organization.id);

    const users = await User.findAll({ where: { email } });
    expect(users).toHaveLength(1);
  });

  it('rejects expired invitations', async () => {
    const owner = await createOwner();
    const response = await createInvitation(owner, uniqueEmail('expired'));
    const { token, invitation } = response.body.data;

    await Invitation.update(
      { expiresAt: new Date(Date.now() - 60_000) },
      { where: { id: invitation.id } },
    );

    const accept = await request(app)
      .post(`${API}/invitations/accept`)
      .send({ token, password: PASSWORD });

    expect(accept.status).toBe(410);
    expect(accept.body.error.code).toBe('INVITATION_EXPIRED');
  });

  it('rejects revoked invitations', async () => {
    const owner = await createOwner();
    const response = await createInvitation(owner, uniqueEmail('revoked'));
    const { token, invitation } = response.body.data;

    const revoke = await owner.agent
      .delete(`${API}/organizations/${owner.organization.id}/invitations/${invitation.id}`)
      .set('x-csrf-token', owner.csrf);
    expect(revoke.status).toBe(200);
    expect(revoke.body.data.invitation.revokedAt).toBeTruthy();

    const accept = await request(app)
      .post(`${API}/invitations/accept`)
      .send({ token, password: PASSWORD });

    expect(accept.status).toBe(410);
    expect(accept.body.error.code).toBe('INVITATION_REVOKED');
  });

  it('does not let a different signed-in account accept an invitation', async () => {
    const owner = await createOwner();
    const response = await createInvitation(owner, uniqueEmail('intended'));
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

    // The invitation is still usable by its intended recipient.
    const preview = await request(app).post(`${API}/invitations/preview`).send({ token });
    expect(preview.status).toBe(200);
  });

  it('requires a password for a new account and never accepts a client-supplied role', async () => {
    const owner = await createOwner();
    const response = await createInvitation(owner, uniqueEmail('role-attempt'));
    const { token } = response.body.data;

    const noPassword = await request(app)
      .post(`${API}/invitations/accept`)
      .send({ token });
    expect(noPassword.status).toBe(422);
    expect(noPassword.body.error.code).toBe('PASSWORD_REQUIRED');

    const withRole = await request(app)
      .post(`${API}/invitations/accept`)
      .send({ token, password: PASSWORD, role: 'OWNER' });
    expect(withRole.status).toBe(422);

    const agent = request.agent(app);
    const accepted = await agent
      .post(`${API}/invitations/accept`)
      .send({ token, password: PASSWORD });
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.membership.role).toBe('EMPLOYEE');
  });

  it('validates the password strength before creating an account', async () => {
    const owner = await createOwner();
    const email = uniqueEmail('weak-password');
    const response = await createInvitation(owner, email);
    const { token } = response.body.data;

    const weak = await request(app)
      .post(`${API}/invitations/accept`)
      .send({ token, password: 'short' });
    expect(weak.status).toBe(422);

    const unknown = await User.findOne({ where: { email } });
    expect(unknown).toBeNull();
  });

  it('resends an invitation by rotating the token and e-mailing a fresh link', async () => {
    const owner = await createOwner();
    const email = uniqueEmail('resend');
    const response = await createInvitation(owner, email);
    const { token, invitation } = response.body.data;

    const resend = await owner.agent
      .post(
        `${API}/organizations/${owner.organization.id}/invitations/${invitation.id}/resend`,
      )
      .set('x-csrf-token', owner.csrf);
    expect(resend.status).toBe(200);
    expect(resend.body.data.emailSent).toBe(true);
    expect(resend.body.data.token).not.toBe(token);

    const stale = await request(app)
      .post(`${API}/invitations/preview`)
      .send({ token });
    expect(stale.status).toBe(400);
    expect(stale.body.error.code).toBe('INVITATION_INVALID');

    const fresh = await request(app)
      .post(`${API}/invitations/preview`)
      .send({ token: resend.body.data.token });
    expect(fresh.status).toBe(200);

    expect(getMemoryOutbox()).toHaveLength(2);
  });

  it('refuses to resend accepted invitations', async () => {
    const owner = await createOwner();
    const accepted = await inviteAndAccept(owner);

    const resend = await owner.agent
      .post(
        `${API}/organizations/${owner.organization.id}/invitations/${accepted.invitation.id}/resend`,
      )
      .set('x-csrf-token', owner.csrf);
    expect(resend.status).toBe(409);
    expect(resend.body.error.code).toBe('INVITATION_ALREADY_ACCEPTED');
  });

  it('rejects public attempts to assign privileged invitation roles', async () => {
    const owner = await createOwner();
    const email = uniqueEmail('owner-invite');

    const ownerRole = await createInvitation(owner, email, 'OWNER' as never);
    expect(ownerRole.status).toBe(422);

    const unknownRole = await createInvitation(owner, email, 'SUPERUSER' as never);
    expect(unknownRole.status).toBe(422);
  });

  it('requires a name on the invitation', async () => {
    const owner = await createOwner();
    const response = await owner.agent
      .post(`${API}/organizations/${owner.organization.id}/invitations`)
      .set('x-csrf-token', owner.csrf)
      .send({ email: uniqueEmail('nameless'), role: 'EMPLOYEE' });
    expect(response.status).toBe(422);
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
