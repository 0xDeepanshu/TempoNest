import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { DesktopAgent, TimeSession } from '../src/database';
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

async function createTeam() {
  const owner = await createOwner(uniqueEmail('owner'), 'Agent Org');
  const ownerAuth = await desktopAuth(owner.email);
  const employee = await inviteAndAccept(owner, {
    role: 'EMPLOYEE',
    name: 'Agent Employee',
    email: uniqueEmail('employee'),
  });
  const auth = await desktopAuth(employee.email);
  const agent = await registerAgent(auth, owner.organization.id);
  return { owner, ownerAuth, employee, auth, agent, orgId: owner.organization.id };
}

describe('desktop agents', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('registers, authenticates, lists, and rotates a device key', async () => {
    const { orgId, auth, agent } = await createTeam();

    const stored = await DesktopAgent.findByPk(agent.id);
    expect(stored).toBeTruthy();
    expect(stored!.agentKeyHash).not.toBe(agent.key);
    expect(stored!.agentKeyHash).toHaveLength(64);
    expect(stored!.clientType).toBe('ELECTRON');

    const authenticated = await request(app)
      .post(`${API}/desktop-agents/authenticate`)
      .send({ agentId: agent.id, agentKey: agent.key });
    expect(authenticated.status).toBe(200);
    expect(authenticated.body.data.organization.id).toBe(orgId);
    expect(authenticated.body.data.user.id).toBe(auth.user.id);
    expect(authenticated.body.data.agent.status).toBe('ACTIVE');

    const wrongKey = await request(app)
      .post(`${API}/desktop-agents/authenticate`)
      .send({ agentId: agent.id, agentKey: 'tna_this-is-not-the-right-key' });
    expect(wrongKey.status).toBe(401);
    expect(wrongKey.body.error.code).toBe('AGENT_CREDENTIALS_INVALID');

    const listed = await request(app)
      .get(`${API}/organizations/${orgId}/desktop-agents`)
      .set(auth.headers);
    expect(listed.status).toBe(200);
    expect(listed.body.meta.total).toBe(1);
    expect(listed.body.data[0].id).toBe(agent.id);
    expect(listed.body.data[0].agentKey).toBeUndefined();
    expect(listed.body.data[0].user.id).toBe(auth.user.id);

    const rotated = await request(app)
      .post(`${API}/organizations/${orgId}/desktop-agents`)
      .set(auth.headers)
      .send({ deviceId: agent.deviceId, name: 'Renamed Desktop', platform: 'win32' });
    expect(rotated.status).toBe(200);
    expect(rotated.body.data.rotated).toBe(true);
    expect(rotated.body.data.agent.clientType).toBe('ELECTRON');
    const newKey = rotated.body.data.agentKey as string;
    expect(newKey).not.toBe(agent.key);

    const oldKey = await request(app)
      .post(`${API}/desktop-agents/authenticate`)
      .send({ agentId: agent.id, agentKey: agent.key });
    expect(oldKey.status).toBe(401);

    const newAuth = await request(app)
      .post(`${API}/desktop-agents/authenticate`)
      .send({ agentId: agent.id, agentKey: newKey });
    expect(newAuth.status).toBe(200);

    const start = await request(app)
      .post(`${API}/organizations/${orgId}/time-sessions/start`)
      .set({
        Authorization: `Bearer ${auth.token}`,
        'x-agent-id': agent.id,
        'x-agent-key': newKey,
      })
      .send({});
    expect(start.status).toBe(201);
  });

  it('scopes employee device lists and permits self-revocation but not another employee device', async () => {
    const { owner, ownerAuth, orgId, auth, agent } = await createTeam();

    await registerAgent(ownerAuth, orgId, { name: 'Owner Desktop' });
    const secondEmployee = await inviteAndAccept(owner, {
      role: 'EMPLOYEE',
      name: 'Second Employee',
      email: uniqueEmail('employee2'),
    });
    const secondAuth = await desktopAuth(secondEmployee.email);
    const secondAgent = await registerAgent(secondAuth, orgId, { name: 'Second Desktop' });

    const employeeList = await request(app)
      .get(`${API}/organizations/${orgId}/desktop-agents`)
      .set(auth.headers);
    expect(employeeList.status).toBe(200);
    expect(employeeList.body.meta.total).toBe(1);
    expect(employeeList.body.data[0].id).toBe(agent.id);

    const ownerList = await request(app)
      .get(`${API}/organizations/${orgId}/desktop-agents`)
      .set(ownerAuth.headers);
    expect(ownerList.status).toBe(200);
    expect(ownerList.body.meta.total).toBe(3);

    const forbiddenRevoke = await request(app)
      .delete(`${API}/organizations/${orgId}/desktop-agents/${secondAgent.id}`)
      .set(auth.headers);
    expect(forbiddenRevoke.status).toBe(403);
    expect(forbiddenRevoke.body.error.code).toBe('PERMISSION_DENIED');

    const start = await request(app)
      .post(`${API}/organizations/${orgId}/time-sessions/start`)
      .set(secondAgent.headers)
      .send({});
    expect(start.status).toBe(201);

    const revoked = await request(app)
      .delete(`${API}/organizations/${orgId}/desktop-agents/${secondAgent.id}`)
      .set(ownerAuth.headers);
    expect(revoked.status).toBe(200);
    expect(revoked.body.data.agent.status).toBe('REVOKED');
    expect(revoked.body.data.stoppedSessionIds).toContain(start.body.data.session.id);

    const stoppedSession = await TimeSession.findByPk(start.body.data.session.id);
    expect(stoppedSession!.status).toBe('STOPPED');
    expect(stoppedSession!.endedAt).toBeTruthy();

    const afterRevocation = await request(app)
      .post(`${API}/organizations/${orgId}/time-sessions/start`)
      .set(secondAgent.headers)
      .send({});
    expect(afterRevocation.status).toBe(403);
    expect(afterRevocation.body.error.code).toBe('AGENT_REVOKED');

    const selfRevoke = await request(app)
      .delete(`${API}/organizations/${orgId}/desktop-agents/${agent.id}`)
      .set(auth.headers);
    expect(selfRevoke.status).toBe(200);
    expect(selfRevoke.body.data.agent.status).toBe('REVOKED');

    const reRegisterRevoked = await request(app)
      .post(`${API}/organizations/${orgId}/desktop-agents`)
      .set(auth.headers)
      .send({ deviceId: agent.deviceId, name: 'Revived Desktop' });
    expect(reRegisterRevoked.status).toBe(409);
    expect(reRegisterRevoked.body.error.code).toBe('AGENT_REVOKED');
  });

  it('preserves device client type on re-registration and rejects type changes', async () => {
    const { orgId, auth, agent } = await createTeam();
    expect(agent.agent.clientType).toBe('ELECTRON');

    const mobile = await registerAgent(auth, orgId, {
      deviceId: 'immutable-mobile-device',
      name: 'Mobile phone',
      platform: 'android',
      clientType: 'MOBILE',
    });
    expect(mobile.agent.clientType).toBe('MOBILE');

    // Omitting clientType during ordinary key rotation preserves MOBILE.
    const rotated = await request(app)
      .post(`${API}/organizations/${orgId}/desktop-agents`)
      .set(auth.headers)
      .send({ deviceId: mobile.deviceId, name: 'Mobile phone renamed' });
    expect(rotated.status).toBe(200);
    expect(rotated.body.data.rotated).toBe(true);
    expect(rotated.body.data.agent.clientType).toBe('MOBILE');
    expect((await DesktopAgent.findByPk(mobile.id))!.clientType).toBe('MOBILE');

    // An explicit type change is rejected and does not modify the device.
    const mobileToElectron = await request(app)
      .post(`${API}/organizations/${orgId}/desktop-agents`)
      .set(auth.headers)
      .send({ deviceId: mobile.deviceId, name: 'Mobile phone', clientType: 'ELECTRON' });
    expect(mobileToElectron.status).toBe(409);
    expect(mobileToElectron.body.error.code).toBe('AGENT_CLIENT_TYPE_MISMATCH');
    expect((await DesktopAgent.findByPk(mobile.id))!.clientType).toBe('MOBILE');

    const electronToMobile = await request(app)
      .post(`${API}/organizations/${orgId}/desktop-agents`)
      .set(auth.headers)
      .send({ deviceId: agent.deviceId, name: 'Desktop', clientType: 'MOBILE' });
    expect(electronToMobile.status).toBe(409);
    expect(electronToMobile.body.error.code).toBe('AGENT_CLIENT_TYPE_MISMATCH');
    expect((await DesktopAgent.findByPk(agent.id))!.clientType).toBe('ELECTRON');
  });

  it('requires authentication and organization membership to register a device', async () => {
    const { orgId, auth } = await createTeam();
    const otherOwner = await createOwner(uniqueEmail('owner'), 'Other Device Org');

    const anonymous = await request(app)
      .post(`${API}/organizations/${orgId}/desktop-agents`)
      .send({ deviceId: 'anonymous-device', name: 'Anonymous' });
    expect(anonymous.status).toBe(401);

    const crossOrg = await request(app)
      .post(`${API}/organizations/${otherOwner.organization.id}/desktop-agents`)
      .set(auth.headers)
      .send({ deviceId: 'cross-org-device', name: 'Cross Org' });
    expect(crossOrg.status).toBe(404);
    expect(crossOrg.body.error.code).toBe('ORGANIZATION_NOT_FOUND');
  });
});
