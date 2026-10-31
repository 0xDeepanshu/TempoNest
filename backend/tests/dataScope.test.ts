import { beforeEach, describe, expect, it } from 'vitest';
import { TimeSession } from '../src/database';
import {
  API,
  createOwner,
  inviteAndAccept,
  resetDatabase,
  type OwnerContext,
} from './helpers';

beforeEach(async () => {
  await resetDatabase();
});

const day = new Date().toISOString().slice(0, 10);

function rolesPath(organizationId: string): string {
  return `${API}/organizations/${organizationId}/roles`;
}

async function createRole(owner: OwnerContext, body: Record<string, unknown>) {
  const response = await owner.agent
    .post(rolesPath(owner.organization.id))
    .set('x-csrf-token', owner.csrf)
    .send(body);
  expect(response.status).toBe(201);
  return response.body.data.role as { id: string };
}

async function assignRole(owner: OwnerContext, membershipId: string, customRoleId: string) {
  const response = await owner.agent
    .patch(`${API}/organizations/${owner.organization.id}/members/${membershipId}`)
    .set('x-csrf-token', owner.csrf)
    .send({ customRoleId });
  expect(response.status).toBe(200);
}

async function seedSession(organizationId: string, employeeId: string) {
  const startedAt = new Date(Date.now() - 60 * 60 * 1000);
  const endedAt = new Date(Date.now() - 30 * 60 * 1000);
  return TimeSession.create({
    organizationId,
    employeeId,
    startedAt,
    endedAt,
    lastHeartbeatAt: endedAt,
    status: 'STOPPED',
  });
}

async function buildTeam(dataScope: 'SELF' | 'ORGANIZATION') {
  const owner = await createOwner();
  const first = await inviteAndAccept(owner, { role: 'EMPLOYEE' });
  const second = await inviteAndAccept(owner, { role: 'EMPLOYEE' });

  const role = await createRole(owner, {
    name: `${dataScope} Reader`,
    permissions: ['organization:read', 'time:read', 'report:read'],
    dataScope,
  });
  await assignRole(owner, first.membership.id, role.id);

  const firstSession = await seedSession(owner.organization.id, first.user.id);
  const secondSession = await seedSession(owner.organization.id, second.user.id);

  return { owner, first, second, role, firstSession, secondSession };
}

function reportQueries(employeeId: string) {
  return {
    daily: `from=${day}&to=${day}&employeeId=${employeeId}`,
    overview: `from=${day}&to=${day}&employeeId=${employeeId}`,
  };
}

describe('data access scope enforcement', () => {
  it('limits a SELF-scoped role to its own records in every supported surface', async () => {
    const { owner, first, second, firstSession, secondSession } = await buildTeam('SELF');
    const orgId = owner.organization.id;

    const sessions = await first.agent.get(
      `${API}/organizations/${orgId}/time-sessions?employeeId=${second.user.id}`,
    );
    expect(sessions.status).toBe(200);
    expect(
      (sessions.body.data as Array<{ employeeId: string }>).every(
        (session) => session.employeeId === first.user.id,
      ),
    ).toBe(true);

    const ownSession = await first.agent.get(
      `${API}/organizations/${orgId}/time-sessions/${firstSession.id}`,
    );
    expect(ownSession.status).toBe(200);

    const foreignSession = await first.agent.get(
      `${API}/organizations/${orgId}/time-sessions/${secondSession.id}`,
    );
    expect(foreignSession.status).toBe(404);
    expect(foreignSession.body.error.code).toBe('SESSION_NOT_FOUND');

    const summary = await first.agent.get(
      `${API}/organizations/${orgId}/attendance/summaries?from=${day}&to=${day}&employeeId=${second.user.id}`,
    );
    expect(summary.status).toBe(200);
    expect(summary.body.data.employeeId).toBe(first.user.id);

    const queries = reportQueries(second.user.id);
    const daily = await first.agent.get(
      `${API}/organizations/${orgId}/reports/daily?${queries.daily}`,
    );
    expect(daily.status).toBe(403);
    expect(daily.body.error.code).toBe('PERMISSION_DENIED');

    const overview = await first.agent.get(
      `${API}/organizations/${orgId}/reports/activity-overview?${queries.overview}`,
    );
    expect(overview.status).toBe(403);
    expect(overview.body.error.code).toBe('PERMISSION_DENIED');
  });

  it('lets an ORGANIZATION-scoped role read permitted records of other members only within its organization', async () => {
    const { owner, first, second, secondSession } = await buildTeam('ORGANIZATION');
    const orgId = owner.organization.id;

    const sessions = await first.agent.get(
      `${API}/organizations/${orgId}/time-sessions?employeeId=${second.user.id}`,
    );
    expect(sessions.status).toBe(200);
    expect(
      (sessions.body.data as Array<{ employeeId: string }>).every(
        (session) => session.employeeId === second.user.id,
      ),
    ).toBe(true);

    const foreignSession = await first.agent.get(
      `${API}/organizations/${orgId}/time-sessions/${secondSession.id}`,
    );
    expect(foreignSession.status).toBe(200);

    const summary = await first.agent.get(
      `${API}/organizations/${orgId}/attendance/summaries?from=${day}&to=${day}&employeeId=${second.user.id}`,
    );
    expect(summary.status).toBe(200);
    expect(summary.body.data.employeeId).toBe(second.user.id);

    const queries = reportQueries(second.user.id);
    const daily = await first.agent.get(
      `${API}/organizations/${orgId}/reports/daily?${queries.daily}`,
    );
    expect(daily.status).toBe(200);

    const overview = await first.agent.get(
      `${API}/organizations/${orgId}/reports/activity-overview?${queries.overview}`,
    );
    expect(overview.status).toBe(200);

    // Another organization's records never appear, even with a matching ID.
    const otherOrganization = await createOwner(undefined, 'Unrelated Org');
    const outsider = await inviteAndAccept(otherOrganization, { role: 'EMPLOYEE' });
    await seedSession(otherOrganization.organization.id, outsider.user.id);

    const crossQuery = await first.agent.get(
      `${API}/organizations/${orgId}/time-sessions?employeeId=${outsider.user.id}`,
    );
    expect(crossQuery.status).toBe(200);
    expect(crossQuery.body.data).toHaveLength(0);

    const crossPath = await first.agent.get(
      `${API}/organizations/${otherOrganization.organization.id}/time-sessions`,
    );
    expect(crossPath.status).toBe(404);
    expect(crossPath.body.error.code).toBe('ORGANIZATION_NOT_FOUND');
  });

  it('does not let data scope grant write access or sensitive resource access', async () => {
    const { owner, first, second } = await buildTeam('ORGANIZATION');
    const orgId = owner.organization.id;

    const leaveForOther = await first.agent
      .post(`${API}/organizations/${orgId}/leave/requests`)
      .set('x-csrf-token', first.csrf)
      .send({ leaveTypeId: '00000000-0000-4000-8000-000000000000', employeeId: second.user.id });
    expect(leaveForOther.status).toBe(403);

    const changeMember = await first.agent
      .patch(`${API}/organizations/${orgId}/members/${second.membership.id}`)
      .set('x-csrf-token', first.csrf)
      .send({ role: 'MANAGER' });
    expect(changeMember.status).toBe(403);

    const screenshots = await first.agent
      .get(`${API}/admin/employees/${second.user.id}/screenshot-requests`)
      .set('x-organization-id', orgId);
    expect(screenshots.status).toBe(403);

    const createRole = await first.agent
      .post(rolesPath(orgId))
      .set('x-csrf-token', first.csrf)
      .send({ name: 'Escalated', permissions: ['role:manage'] });
    expect(createRole.status).toBe(403);
  });
});
