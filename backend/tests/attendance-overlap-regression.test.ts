import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { Organization, TimeSession } from '../src/database';
import {
  API,
  createOwner,
  inviteAndAccept,
  resetDatabase,
  uniqueEmail,
} from './helpers';

async function createTeam(options: { timezone?: string } = {}) {
  const owner = await createOwner(uniqueEmail('owner'), 'Overlap Regression Org');
  if (options.timezone) {
    await Organization.update(
      { timezone: options.timezone },
      { where: { id: owner.organization.id } },
    );
  }
  const employee = await inviteAndAccept(owner, {
    role: 'EMPLOYEE',
    name: 'Overlap Regression Employee',
    email: uniqueEmail('employee'),
  });
  return { employee, orgId: owner.organization.id };
}

async function createSession(options: {
  organizationId: string;
  employeeId: string;
  startedAt: Date;
  endedAt: Date | null;
}) {
  return TimeSession.create({
    organizationId: options.organizationId,
    employeeId: options.employeeId,
    desktopAgentId: null,
    startedAt: options.startedAt,
    endedAt: options.endedAt,
    status: options.endedAt ? 'STOPPED' : 'ACTIVE',
    source: 'ONLINE',
    lastHeartbeatAt: options.endedAt ?? options.startedAt,
  });
}

function submitCorrection(
  employee: { agent: ReturnType<typeof request.agent>; csrf: string },
  organizationId: string,
  body: Record<string, unknown>,
) {
  return employee.agent
    .post(`${API}/organizations/${organizationId}/attendance/corrections`)
    .set('x-csrf-token', employee.csrf)
    .send(body);
}

describe('attendance correction overlap regression', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('rejects an UPDATE_SESSION correction that overlaps a second session', async () => {
    const { employee, orgId } = await createTeam();
    const target = await createSession({
      organizationId: orgId,
      employeeId: employee.user.id,
      startedAt: new Date('2026-06-01T09:00:00.000Z'),
      endedAt: new Date('2026-06-01T12:00:00.000Z'),
    });
    await createSession({
      organizationId: orgId,
      employeeId: employee.user.id,
      startedAt: new Date('2026-06-01T12:30:00.000Z'),
      endedAt: new Date('2026-06-01T16:00:00.000Z'),
    });

    const response = await submitCorrection(employee, orgId, {
      sessionId: target.id,
      workDate: '2026-06-01',
      startedAt: '2026-06-01T12:45:00.000Z',
      endedAt: '2026-06-01T13:30:00.000Z',
      breaks: [],
      reason: 'This correction overlaps the second session.',
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CORRECTION_OVERLAPS_EXISTING_SESSION');
    expect(response.body.error.message).toBe(
      'This correction overlaps with another recorded work session. Please adjust the start and end times.',
    );
  });

  it('rejects a CREATE_SESSION correction that overlaps an open session', async () => {
    const { employee, orgId } = await createTeam();
    await createSession({
      organizationId: orgId,
      employeeId: employee.user.id,
      startedAt: new Date('2026-06-02T09:00:00.000Z'),
      endedAt: null,
    });

    const response = await submitCorrection(employee, orgId, {
      workDate: '2026-06-02',
      startedAt: '2026-06-02T10:00:00.000Z',
      endedAt: '2026-06-02T11:00:00.000Z',
      breaks: [],
      reason: 'This missing session overlaps an open session.',
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CORRECTION_OVERLAPS_EXISTING_SESSION');
  });

  it('honors organization-local boundaries in Asia/Kolkata', async () => {
    const { employee, orgId } = await createTeam({ timezone: 'Asia/Kolkata' });
    await createSession({
      organizationId: orgId,
      employeeId: employee.user.id,
      startedAt: new Date('2026-10-22T03:30:00.000Z'),
      endedAt: new Date('2026-10-22T11:30:00.000Z'),
    });

    const overlapping = await submitCorrection(employee, orgId, {
      workDate: '2026-10-22',
      startedAt: '2026-10-22T04:00:00.000Z',
      endedAt: '2026-10-22T05:00:00.000Z',
      breaks: [],
      reason: 'This correction overlaps the Oct 22 session.',
    });
    expect(overlapping.status).toBe(409);
    expect(overlapping.body.error.code).toBe('CORRECTION_OVERLAPS_EXISTING_SESSION');

    const adjacent = await submitCorrection(employee, orgId, {
      workDate: '2026-10-22',
      startedAt: '2026-10-22T11:30:00.000Z',
      endedAt: '2026-10-22T12:30:00.000Z',
      breaks: [],
      reason: 'This correction starts when the Oct 22 session ends.',
    });
    expect(adjacent.status).toBe(201);
  });
});
