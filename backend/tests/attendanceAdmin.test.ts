import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  API,
  app,
  createOwner,
  desktopAuth,
  inviteAndAccept,
  mobileAuth,
  registerAgent,
  resetDatabase,
  uniqueEmail,
} from './helpers';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 0x11),
]);

function agentHeaders(agent: { headers: Record<string, string> }, organizationId: string) {
  return { ...agent.headers, 'x-organization-id': organizationId };
}

async function createTeam() {
  const owner = await createOwner(uniqueEmail('admin-att-owner'), 'Admin Attendance Org');
  const ownerAuth = await desktopAuth(owner.email);
  const employee = await inviteAndAccept(owner, {
    role: 'EMPLOYEE',
    name: 'Attendance Employee',
    email: uniqueEmail('admin-att-employee'),
  });
  const auth = await mobileAuth(employee.email);
  const agent = await registerAgent(auth, owner.organization.id, {
    name: 'Attendance Phone',
    platform: 'android',
    clientType: 'MOBILE',
  });

  return { owner, ownerAuth, employee, auth, agent, orgId: owner.organization.id };
}

function prepareEvidence(
  team: { orgId: string; agent: { headers: Record<string, string> } },
  kind: 'SELFIE' | 'SITE_PHOTO',
) {
  return request(app)
    .post(`${API}/organizations/${team.orgId}/attendance/evidence`)
    .set(team.agent.headers)
    .send({ kind, contentType: 'image/png' })
    .then(async (created) => {
      expect(created.status).toBe(201);
      const uploaded = await request(app)
        .put(new URL(created.body.data.upload.url as string).pathname)
        .set(agentHeaders(team.agent, team.orgId))
        .set('content-type', 'image/png')
        .send(PNG);
      expect(uploaded.status).toBe(201);
      return created.body.data.evidence.id as string;
    });
}

function checkIn(
  team: { orgId: string; agent: { headers: Record<string, string> } },
  body: Record<string, unknown>,
) {
  return request(app)
    .post(`${API}/organizations/${team.orgId}/attendance/check-ins`)
    .set(team.agent.headers)
    .send(body);
}

function listCheckIns(
  team: { orgId: string },
  headers: Record<string, string>,
  query: Record<string, string | number> = {},
) {
  return request(app)
    .get(`${API}/organizations/${team.orgId}/attendance/check-ins`)
    .set(headers)
    .query(query);
}

function stopSession(
  team: { orgId: string; agent: { headers: Record<string, string> } },
  sessionId: string,
) {
  return request(app)
    .post(`${API}/organizations/${team.orgId}/time-sessions/${sessionId}/stop`)
    .set(team.agent.headers)
    .send({});
}

function location() {
  return {
    latitude: 28.6139,
    longitude: 77.209,
    accuracyMeters: 20,
    recordedAt: new Date().toISOString(),
  };
}

describe('admin attendance check-in listing', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('returns employee, session, evidence, and location with no private storage data', async () => {
    const team = await createTeam();
    const selfieId = await prepareEvidence(team, 'SELFIE');
    const sitePhotoId = await prepareEvidence(team, 'SITE_PHOTO');

    const created = await checkIn(team, {
      checkInRequestId: randomUUID(),
      workMode: 'ON_SITE',
      selfieEvidenceId: selfieId,
      sitePhotoEvidenceId: sitePhotoId,
      location: location(),
    });
    expect(created.status).toBe(201);
    const checkInId = created.body.data.checkIn.id as string;

    const response = await listCheckIns(team, team.ownerAuth.headers);
    expect(response.status).toBe(200);
    expect(response.body.meta).toMatchObject({ page: 1, limit: 20, total: 1, totalPages: 1 });
    expect(response.body.timezone).toBeTruthy();

    const row = response.body.data[0];
    expect(row.id).toBe(checkInId);
    expect(row.workMode).toBe('ON_SITE');
    expect(row.employee).toMatchObject({
      id: created.body.data.session.employeeId,
      name: 'Attendance Employee',
      email: team.employee.email,
    });
    expect(row.session).toMatchObject({
      id: created.body.data.session.id,
      status: 'ACTIVE',
    });
    expect(row.selfie.id).toBe(selfieId);
    expect(row.selfie.kind).toBe('SELFIE');
    expect(row.sitePhoto.id).toBe(sitePhotoId);
    expect(row.sitePhoto.kind).toBe('SITE_PHOTO');
    expect(row.location).toMatchObject({
      latitude: 28.6139,
      longitude: 77.209,
      accuracyMeters: 20,
    });

    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('storageKey');
    expect(serialized).not.toContain('storage_key');
    expect(serialized).not.toContain('uploadToken');
  });

  it('returns null location for WFO and filters by employee, work mode, and local date', async () => {
    const team = await createTeam();
    const selfieId = await prepareEvidence(team, 'SELFIE');

    const wfh = await checkIn(team, {
      checkInRequestId: randomUUID(),
      workMode: 'WFH',
    });
    expect(wfh.status).toBe(201);
    expect((await stopSession(team, wfh.body.data.session.id)).status).toBe(200);

    const wfo = await checkIn(team, {
      checkInRequestId: randomUUID(),
      workMode: 'WFO',
      selfieEvidenceId: selfieId,
    });
    expect(wfo.status).toBe(201);
    expect((await stopSession(team, wfo.body.data.session.id)).status).toBe(200);

    const all = await listCheckIns(team, team.ownerAuth.headers);
    expect(all.status).toBe(200);
    expect(all.body.meta.total).toBe(2);
    expect(all.body.data[0].workMode).toBe('WFO');
    expect(all.body.data[0].location).toBeNull();
    expect(all.body.data[0].selfie.id).toBe(selfieId);
    expect(all.body.data[0].sitePhoto).toBeNull();
    expect(all.body.data[1].workMode).toBe('WFH');
    expect(all.body.data[1].selfie).toBeNull();
    expect(all.body.data[1].sitePhoto).toBeNull();
    expect(all.body.data[1].location).toBeNull();

    const selfieOnly = await listCheckIns(team, team.ownerAuth.headers, {
      employeeId: team.auth.user.id,
      workMode: 'WFO',
    });
    expect(selfieOnly.status).toBe(200);
    expect(selfieOnly.body.meta.total).toBe(1);
    expect(selfieOnly.body.data[0].workMode).toBe('WFO');

    const inRange = await listCheckIns(team, team.ownerAuth.headers, {
      from: '2000-01-01',
      to: '2000-01-02',
    });
    expect(inRange.status).toBe(200);
    expect(inRange.body.meta.total).toBe(0);

    const fromOnly = await listCheckIns(team, team.ownerAuth.headers, {
      from: '2000-01-01',
    });
    expect(fromOnly.status).toBe(200);
    expect(fromOnly.body.meta.total).toBe(2);
  });

  it('allows owner, admin, and manager but denies employees and other organizations', async () => {
    const team = await createTeam();
    const created = await checkIn(team, {
      checkInRequestId: randomUUID(),
      workMode: 'WFH',
    });
    expect(created.status).toBe(201);

    const manager = await inviteAndAccept(team.owner, {
      role: 'MANAGER',
      name: 'Attendance Manager',
      email: uniqueEmail('admin-att-manager'),
    });
    const managerAuth = await desktopAuth(manager.email);
    const managerList = await listCheckIns(team, managerAuth.headers);
    expect(managerList.status).toBe(200);
    expect(managerList.body.meta.total).toBe(1);

    const admin = await inviteAndAccept(team.owner, {
      role: 'ADMIN',
      name: 'Attendance Admin',
      email: uniqueEmail('admin-att-admin'),
    });
    const adminAuth = await desktopAuth(admin.email);
    const adminList = await listCheckIns(team, adminAuth.headers);
    expect(adminList.status).toBe(200);

    const employeeList = await listCheckIns(team, team.auth.headers);
    expect(employeeList.status).toBe(403);
    expect(employeeList.body.error.code).toBe('PERMISSION_DENIED');

    const otherOwner = await createOwner(uniqueEmail('admin-att-other'), 'Other Admin Org');
    const otherAuth = await desktopAuth(otherOwner.email);
    const crossOrganization = await listCheckIns(team, otherAuth.headers);
    expect(crossOrganization.status).toBe(404);
    expect(crossOrganization.body.error.code).toBe('ORGANIZATION_NOT_FOUND');

    const unknownEmployee = await listCheckIns(team, team.ownerAuth.headers, {
      employeeId: randomUUID(),
    });
    expect(unknownEmployee.status).toBe(404);
    expect(unknownEmployee.body.error.code).toBe('EMPLOYEE_NOT_FOUND');
  });

  it('paginates and returns an empty page when nothing matches', async () => {
    const team = await createTeam();
    for (let index = 0; index < 3; index += 1) {
      const created = await checkIn(team, {
        checkInRequestId: randomUUID(),
        workMode: 'WFH',
      });
      expect(created.status).toBe(201);
      expect((await stopSession(team, created.body.data.session.id)).status).toBe(200);
    }

    const firstPage = await listCheckIns(team, team.ownerAuth.headers, { page: 1, limit: 2 });
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.data).toHaveLength(2);
    expect(firstPage.body.meta).toMatchObject({ page: 1, limit: 2, total: 3, totalPages: 2 });

    const secondPage = await listCheckIns(team, team.ownerAuth.headers, { page: 2, limit: 2 });
    expect(secondPage.body.data).toHaveLength(1);
    expect(secondPage.body.meta.page).toBe(2);

    const empty = await listCheckIns(team, team.ownerAuth.headers, { workMode: 'ON_SITE' });
    expect(empty.status).toBe(200);
    expect(empty.body.data).toEqual([]);
    expect(empty.body.meta.total).toBe(0);
    expect(empty.body.meta.totalPages).toBe(0);
  });
});
