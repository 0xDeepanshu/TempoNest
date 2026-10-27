import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApplicationActivity, Break, Organization, TimeSession } from '../src/database';
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
  const owner = await createOwner(uniqueEmail('owner'), 'Tempo Tracking Org');
  const ownerAuth = await desktopAuth(owner.email);
  const employee = await inviteAndAccept(owner, {
    role: 'EMPLOYEE',
    name: 'Tracked Employee',
    email: uniqueEmail('employee'),
  });
  const auth = await desktopAuth(employee.email);
  const agent = await registerAgent(auth, owner.organization.id, { name: 'Employee Desktop' });
  return { owner, ownerAuth, employee, auth, agent, orgId: owner.organization.id };
}

function startSession(orgId: string, agent: { headers: Record<string, string> }, body: unknown = {}) {
  return request(app)
    .post(`${API}/organizations/${orgId}/time-sessions/start`)
    .set(agent.headers)
    .send(body as object);
}

function stopSession(orgId: string, sessionId: string, agent: { headers: Record<string, string> }) {
  return request(app)
    .post(`${API}/organizations/${orgId}/time-sessions/${sessionId}/stop`)
    .set(agent.headers)
    .send({});
}

describe('time tracking', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('recovers a stale active session at its last heartbeat when current is read', async () => {
    const { orgId, agent } = await createTeam();
    const started = await startSession(orgId, agent);
    expect(started.status).toBe(201);
    const sessionId = started.body.data.session.id as string;

    const lastHeartbeat = new Date(Date.now() - 5 * 60 * 60_000);
    await TimeSession.update(
      {
        startedAt: new Date(Date.now() - 6 * 60 * 60_000),
        lastHeartbeatAt: lastHeartbeat,
      },
      { where: { id: sessionId } },
    );

    const current = await request(app)
      .get(`${API}/organizations/${orgId}/time-sessions/current`)
      .set(agent.headers);
    expect(current.status).toBe(200);
    expect(current.body.data.session).toBeNull();

    const record = await TimeSession.findByPk(sessionId);
    expect(record?.status).toBe('STOPPED');
    expect(record?.endedAt?.getTime()).toBe(lastHeartbeat.getTime());
    expect(record?.lastHeartbeatAt.getTime()).toBe(lastHeartbeat.getTime());

    const stop = await stopSession(orgId, sessionId, agent);
    expect(stop.status).toBe(409);
    expect(stop.body.error.code).toBe('SESSION_NOT_ACTIVE');
  });

  it('runs the session, break, and stop lifecycle with server timestamps', async () => {
    const { orgId, agent } = await createTeam();

    const started = await startSession(orgId, agent, {
      startedAt: '2000-01-01T00:00:00.000Z',
      durationSeconds: 999999,
    });
    expect(started.status).toBe(201);
    expect(started.body.data.session.status).toBe('ACTIVE');
    expect(started.body.data.session.endedAt).toBeNull();
    expect(started.body.data.session.source).toBe('ONLINE');
    expect(
      Math.abs(Date.now() - Date.parse(started.body.data.session.startedAt)),
    ).toBeLessThan(10_000);

    const sessionId = started.body.data.session.id as string;

    const duplicate = await startSession(orgId, agent);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('ACTIVE_SESSION_EXISTS');

    const current = await request(app)
      .get(`${API}/organizations/${orgId}/time-sessions/current`)
      .set(agent.headers);
    expect(current.status).toBe(200);
    expect(current.body.data.session.id).toBe(sessionId);

    const breakStarted = await request(app)
      .post(`${API}/organizations/${orgId}/time-sessions/${sessionId}/breaks`)
      .set(agent.headers)
      .send({});
    expect(breakStarted.status).toBe(201);
    expect(breakStarted.body.data.session.status).toBe('ON_BREAK');
    expect(breakStarted.body.data.session.activeBreak.id).toBeTruthy();

    const breakDuplicate = await request(app)
      .post(`${API}/organizations/${orgId}/time-sessions/${sessionId}/breaks`)
      .set(agent.headers)
      .send({});
    expect(breakDuplicate.status).toBe(409);
    expect(breakDuplicate.body.error.code).toBe('BREAK_ALREADY_ACTIVE');

    const resumed = await request(app)
      .post(`${API}/organizations/${orgId}/time-sessions/${sessionId}/breaks/end`)
      .set(agent.headers)
      .send({});
    expect(resumed.status).toBe(200);
    expect(resumed.body.data.session.status).toBe('ACTIVE');
    expect(resumed.body.data.session.breaks).toHaveLength(1);
    expect(resumed.body.data.session.breaks[0].endedAt).toBeTruthy();

    const resumedAgain = await request(app)
      .post(`${API}/organizations/${orgId}/time-sessions/${sessionId}/breaks/end`)
      .set(agent.headers)
      .send({});
    expect(resumedAgain.status).toBe(409);
    expect(resumedAgain.body.error.code).toBe('NO_ACTIVE_BREAK');

    const stopped = await stopSession(orgId, sessionId, agent);
    expect(stopped.status).toBe(200);
    expect(stopped.body.data.session.status).toBe('STOPPED');
    expect(stopped.body.data.session.endedAt).toBeTruthy();

    const stopAgain = await stopSession(orgId, sessionId, agent);
    expect(stopAgain.status).toBe(409);
    expect(stopAgain.body.error.code).toBe('SESSION_NOT_ACTIVE');

    const noCurrent = await request(app)
      .get(`${API}/organizations/${orgId}/time-sessions/current`)
      .set(agent.headers);
    expect(noCurrent.body.data.session).toBeNull();

    const history = await request(app)
      .get(`${API}/organizations/${orgId}/time-sessions`)
      .set(agent.headers);
    expect(history.status).toBe(200);
    expect(history.body.meta.total).toBe(1);
    expect(history.body.data[0].id).toBe(sessionId);

    const from = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    const to = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
    const rangedHistory = await request(app)
      .get(`${API}/organizations/${orgId}/time-sessions`)
      .query({ from, to })
      .set(agent.headers);
    expect(rangedHistory.status).toBe(200);
    expect(rangedHistory.body.meta.total).toBe(1);

    const emptyRange = await request(app)
      .get(`${API}/organizations/${orgId}/time-sessions`)
      .query({
        from: new Date(Date.now() + 48 * 60 * 60_000).toISOString(),
        to: new Date(Date.now() + 72 * 60 * 60_000).toISOString(),
      })
      .set(agent.headers);
    expect(emptyRange.status).toBe(200);
    expect(emptyRange.body.meta.total).toBe(0);

    const invertedRange = await request(app)
      .get(`${API}/organizations/${orgId}/time-sessions`)
      .query({ from: to, to: from })
      .set(agent.headers);
    expect(invertedRange.status).toBe(422);
  });

  it('rejects a second concurrent start and cross-organization access', async () => {
    const { orgId, agent, auth, employee } = await createTeam();

    const responses = await Promise.all([
      startSession(orgId, agent),
      startSession(orgId, agent),
    ]);
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([201, 409]);

    const winner = responses.find((response) => response.status === 201)!;
    await stopSession(orgId, winner.body.data.session.id, agent);

    const otherOwner = await createOwner(uniqueEmail('owner'), 'Other Org');
    const crossOrg = await startSession(otherOwner.organization.id, agent);
    expect(crossOrg.status).toBe(404);
    expect(crossOrg.body.error.code).toBe('ORGANIZATION_NOT_FOUND');

    const foreignHistory = await request(app)
      .get(`${API}/organizations/${otherOwner.organization.id}/time-sessions`)
      .set(auth.headers);
    expect(foreignHistory.status).toBe(404);

    const ownHistoryWithSpoofedEmployee = await request(app)
      .get(`${API}/organizations/${orgId}/time-sessions?employeeId=${otherOwner.user.id}`)
      .set(auth.headers);
    expect(ownHistoryWithSpoofedEmployee.status).toBe(200);
    expect(ownHistoryWithSpoofedEmployee.body.meta.total).toBe(1);
    expect(
      (ownHistoryWithSpoofedEmployee.body.data as Array<{ employeeId: string }>).every(
        (session) => session.employeeId === auth.user.id,
      ),
    ).toBe(true);
  });

  it('keeps employee history scoped while managers can list the organization', async () => {
    const { orgId, agent, owner, auth } = await createTeam();
    const started = await startSession(orgId, agent);
    await stopSession(orgId, started.body.data.session.id, agent);

    const manager = await inviteAndAccept(owner, {
      role: 'MANAGER',
      name: 'Manager',
      email: uniqueEmail('manager'),
    });
    const managerAuth = await desktopAuth(manager.email);
    const managerAgent = await registerAgent(managerAuth, orgId);
    const managerStarted = await startSession(orgId, managerAgent);
    await stopSession(orgId, managerStarted.body.data.session.id, managerAgent);

    const managerHistory = await request(app)
      .get(`${API}/organizations/${orgId}/time-sessions?employeeId=${auth.user.id}`)
      .set(managerAuth.headers);
    expect(managerHistory.status).toBe(200);
    expect(managerHistory.body.meta.total).toBe(1);

    const employeeHistory = await request(app)
      .get(`${API}/organizations/${orgId}/time-sessions`)
      .set(auth.headers);
    expect(employeeHistory.status).toBe(200);
    expect(employeeHistory.body.meta.total).toBe(1);

    const report = await request(app)
      .get(`${API}/organizations/${orgId}/reports/sessions?from=2026-01-01&to=2026-01-01`)
      .set(auth.headers);
    expect(report.status).toBe(403);
    expect(report.body.error.code).toBe('PERMISSION_DENIED');
  });

  it('supports offline sync, idempotency, ordering, and conflicts', async () => {
    const { orgId, agent } = await createTeam();
    const sessionId = randomUUID();
    const now = Date.now();

    const events = [
      {
        eventId: randomUUID(),
        type: 'SESSION_STOP',
        occurredAt: new Date(now - 30 * 60_000).toISOString(),
        sessionId,
      },
      {
        eventId: randomUUID(),
        type: 'SESSION_START',
        occurredAt: new Date(now - 120 * 60_000).toISOString(),
        sessionId,
      },
      {
        eventId: randomUUID(),
        type: 'BREAK_START',
        occurredAt: new Date(now - 90 * 60_000).toISOString(),
        sessionId,
      },
      {
        eventId: randomUUID(),
        type: 'BREAK_END',
        occurredAt: new Date(now - 60 * 60_000).toISOString(),
        sessionId,
      },
    ];

    const synced = await request(app)
      .post(`${API}/organizations/${orgId}/time-sessions/sync`)
      .set(agent.headers)
      .send({ deviceId: agent.deviceId, events });
    expect(synced.status).toBe(200);
    expect(synced.body.data.results.every((result: { status: string }) => result.status === 'applied')).toBe(true);

    const history = await request(app)
      .get(`${API}/organizations/${orgId}/time-sessions`)
      .set(agent.headers);
    expect(history.status).toBe(200);
    expect(history.body.meta.total).toBe(1);
    const session = history.body.data[0];
    expect(session.source).toBe('OFFLINE');
    expect(session.status).toBe('STOPPED');
    expect(session.breaks).toHaveLength(1);
    expect(session.durationSeconds).toBe(5400);
    expect(session.breaks[0].durationSeconds).toBe(1800);

    const repeated = await request(app)
      .post(`${API}/organizations/${orgId}/time-sessions/sync`)
      .set(agent.headers)
      .send({ deviceId: agent.deviceId, events });
    expect(repeated.status).toBe(200);
    expect(
      repeated.body.data.results.every(
        (result: { status: string; originalStatus: string }) =>
          result.status === 'duplicate' && result.originalStatus === 'APPLIED',
      ),
    ).toBe(true);

    const conflictEvent = {
      eventId: randomUUID(),
      type: 'SESSION_STOP',
      occurredAt: new Date(now - 20 * 60_000).toISOString(),
      sessionId,
    };
    const conflict = await request(app)
      .post(`${API}/organizations/${orgId}/time-sessions/sync`)
      .set(agent.headers)
      .send({ deviceId: agent.deviceId, events: [conflictEvent] });
    expect(conflict.status).toBe(200);
    expect(conflict.body.data.results[0].status).toBe('conflict');
    expect(conflict.body.data.results[0].code).toBe('SESSION_ALREADY_STOPPED');

    const conflictReplay = await request(app)
      .post(`${API}/organizations/${orgId}/time-sessions/sync`)
      .set(agent.headers)
      .send({ deviceId: agent.deviceId, events: [conflictEvent] });
    expect(conflictReplay.body.data.results[0].status).toBe('duplicate');
    expect(conflictReplay.body.data.results[0].originalStatus).toBe('CONFLICT');

    const future = await request(app)
      .post(`${API}/organizations/${orgId}/time-sessions/sync`)
      .set(agent.headers)
      .send({
        deviceId: agent.deviceId,
        events: [
          {
            eventId: randomUUID(),
            type: 'SESSION_START',
            occurredAt: new Date(now + 60 * 60_000).toISOString(),
            sessionId: randomUUID(),
          },
        ],
      });
    expect(future.body.data.results[0].status).toBe('conflict');
    expect(future.body.data.results[0].code).toBe('EVENT_IN_FUTURE');

    const wrongDevice = await request(app)
      .post(`${API}/organizations/${orgId}/time-sessions/sync`)
      .set(agent.headers)
      .send({ deviceId: 'another-device', events });
    expect(wrongDevice.status).toBe(403);
    expect(wrongDevice.body.error.code).toBe('DEVICE_MISMATCH');
  });

  it('ingests application metadata idempotently and rejects overlaps', async () => {
    const { orgId, agent, auth } = await createTeam();
    const started = await startSession(orgId, agent);
    const session = started.body.data.session as {
      id: string;
      startedAt: string;
    };
    const base = Date.parse(session.startedAt);

    const event = {
      idempotencyKey: randomUUID(),
      sessionId: session.id,
      applicationIdentifier: 'com.example.editor',
      applicationName: 'Editor',
      startedAt: new Date(base + 100).toISOString(),
      endedAt: new Date(base + 5_100).toISOString(),
      durationSeconds: 999_999,
    };

    const batch = await request(app)
      .post(`${API}/organizations/${orgId}/application-activities/batch`)
      .set(agent.headers)
      .send({ events: [event] });
    expect(batch.status).toBe(200);
    expect(batch.body.data.accepted).toBe(1);
    expect(batch.body.data.results[0].status).toBe('accepted');
    expect(batch.body.data.disclaimer).toContain('not a definitive');

    const duplicate = await request(app)
      .post(`${API}/organizations/${orgId}/application-activities/batch`)
      .set(agent.headers)
      .send({ events: [event] });
    expect(duplicate.body.data.duplicated).toBe(1);
    expect(duplicate.body.data.results[0].status).toBe('duplicate');

    const overlapping = await request(app)
      .post(`${API}/organizations/${orgId}/application-activities/batch`)
      .set(agent.headers)
      .send({
        events: [
          {
            ...event,
            idempotencyKey: randomUUID(),
            startedAt: new Date(base + 3_000).toISOString(),
            endedAt: new Date(base + 8_000).toISOString(),
          },
        ],
      });
    expect(overlapping.status).toBe(200);
    expect(overlapping.body.data.results[0].status).toBe('rejected');
    expect(overlapping.body.data.results[0].code).toBe('EVENT_OVERLAP');

    const foreignSession = await request(app)
      .post(`${API}/organizations/${orgId}/application-activities/batch`)
      .set(agent.headers)
      .send({
        events: [
          {
            ...event,
            idempotencyKey: randomUUID(),
            sessionId: randomUUID(),
          },
        ],
      });
    expect(foreignSession.body.data.results[0].code).toBe('SESSION_NOT_FOUND');

    const stored = await ApplicationActivity.findOne({ where: { timeSessionId: session.id } });
    expect(stored?.durationSeconds).toBe(5);
    expect(stored?.employeeId).toBe(auth.user.id);

    await stopSession(orgId, session.id, agent);
  });

  it('aggregates daily work, breaks, application usage, and timelines', async () => {
    const { owner, ownerAuth, employee, auth, agent, orgId } = await createTeam();
    const started = await startSession(orgId, agent);
    const sessionId = started.body.data.session.id as string;
    await stopSession(orgId, sessionId, agent);

    const session = (await TimeSession.findByPk(sessionId))!;
    const day = '2026-01-15';
    const at = (hour: number) => new Date(`2026-01-15T${String(hour).padStart(2, '0')}:00:00.000Z`);
    await session.update({
      startedAt: at(9),
      endedAt: at(17),
      status: 'STOPPED',
      lastHeartbeatAt: at(17),
    });
    await Break.create({
      organizationId: orgId,
      timeSessionId: sessionId,
      startedAt: at(12),
      endedAt: at(13),
      status: 'ENDED',
    });

    await ApplicationActivity.bulkCreate([
      {
        organizationId: orgId,
        employeeId: employee.user.id,
        timeSessionId: sessionId,
        desktopAgentId: agent.id,
        applicationIdentifier: 'com.example.code',
        applicationName: 'Code',
        startedAt: new Date('2026-01-15T09:30:00.000Z'),
        endedAt: new Date('2026-01-15T11:30:00.000Z'),
        durationSeconds: 7200,
        idempotencyKey: 'report-code',
      },
      {
        organizationId: orgId,
        employeeId: employee.user.id,
        timeSessionId: sessionId,
        desktopAgentId: agent.id,
        applicationIdentifier: 'com.example.browser',
        applicationName: 'Browser',
        startedAt: new Date('2026-01-15T11:30:00.000Z'),
        endedAt: new Date('2026-01-15T12:30:00.000Z'),
        durationSeconds: 3600,
        idempotencyKey: 'report-browser',
      },
      {
        organizationId: orgId,
        employeeId: employee.user.id,
        timeSessionId: sessionId,
        desktopAgentId: agent.id,
        applicationIdentifier: 'com.example.chat',
        applicationName: 'Chat',
        startedAt: at(13),
        endedAt: at(14),
        durationSeconds: 3600,
        idempotencyKey: 'report-chat',
      },
    ]);

    const daily = await request(app)
      .get(`${API}/organizations/${orgId}/reports/daily?from=${day}&to=${day}&employeeId=${employee.user.id}`)
      .set(ownerAuth.headers);
    expect(daily.status).toBe(200);
    expect(daily.body.data.timezone).toBe('UTC');
    expect(daily.body.data.days).toHaveLength(1);
    expect(daily.body.data.days[0].workedSeconds).toBe(25_200);
    expect(daily.body.data.days[0].breakSeconds).toBe(3_600);

    const sessions = await request(app)
      .get(`${API}/organizations/${orgId}/reports/sessions?from=${day}&to=${day}&employeeId=${employee.user.id}`)
      .set(ownerAuth.headers);
    expect(sessions.status).toBe(200);
    expect(sessions.body.meta.total).toBe(1);
    expect(sessions.body.data[0].workingSeconds).toBe(25_200);
    expect(sessions.body.data[0].breakSeconds).toBe(3_600);

    const usage = await request(app)
      .get(
        `${API}/organizations/${orgId}/reports/application-usage?from=${day}&to=${day}&employeeId=${employee.user.id}`,
      )
      .set(ownerAuth.headers);
    expect(usage.status).toBe(200);
    expect(usage.body.totalApplicationSeconds).toBe(12_600);
    expect(usage.body.trackedWorkingSeconds).toBe(25_200);
    expect(usage.body.disclaimer).toContain('not a definitive');
    const byName = Object.fromEntries(
      (usage.body.data as { applicationName: string; totalSeconds: number }[]).map((item) => [
        item.applicationName,
        item.totalSeconds,
      ]),
    );
    expect(byName.Code).toBe(7_200);
    expect(byName.Browser).toBe(1_800);
    expect(byName.Chat).toBe(3_600);

    const timeline = await request(app)
      .get(
        `${API}/organizations/${orgId}/reports/application-timeline?from=${day}&to=${day}&employeeId=${employee.user.id}`,
      )
      .set(ownerAuth.headers);
    expect(timeline.status).toBe(200);
    expect(timeline.body.meta.total).toBe(3);
    const browser = (timeline.body.data as { applicationName: string; durationSeconds: number }[]).find(
      (item) => item.applicationName === 'Browser',
    );
    expect(browser?.durationSeconds).toBe(1_800);

    const employeeReport = await request(app)
      .get(`${API}/organizations/${orgId}/reports/daily?from=${day}&to=${day}&employeeId=${employee.user.id}`)
      .set(auth.headers);
    expect(employeeReport.status).toBe(403);
    expect(employeeReport.body.error.code).toBe('PERMISSION_DENIED');

    const manager = await inviteAndAccept(owner, {
      role: 'MANAGER',
      name: 'Report Manager',
      email: uniqueEmail('manager'),
    });
    const managerAuth = await desktopAuth(manager.email);
    const managerReport = await request(app)
      .get(`${API}/organizations/${orgId}/reports/daily?from=${day}&to=${day}&employeeId=${employee.user.id}`)
      .set(managerAuth.headers);
    expect(managerReport.status).toBe(200);
    expect(managerReport.body.data.days[0].workedSeconds).toBe(25_200);

    const otherOwner = await createOwner(uniqueEmail('owner'), 'Foreign Org');
    const foreignEmployee = await request(app)
      .get(
        `${API}/organizations/${orgId}/reports/daily?from=${day}&to=${day}&employeeId=${otherOwner.user.id}`,
      )
      .set(ownerAuth.headers);
    expect(foreignEmployee.status).toBe(404);
    expect(foreignEmployee.body.error.code).toBe('EMPLOYEE_NOT_FOUND');
  });

  it('reports in the organization timezone', async () => {
    const { orgId, agent, ownerAuth, employee } = await createTeam();
    const started = await startSession(orgId, agent);
    const sessionId = started.body.data.session.id as string;
    await stopSession(orgId, sessionId, agent);

    await Organization.update({ timezone: 'Asia/Kolkata' }, { where: { id: orgId } });
    const session = (await TimeSession.findByPk(sessionId))!;
    await session.update({
      startedAt: new Date('2026-01-15T20:00:00.000Z'),
      endedAt: new Date('2026-01-15T22:00:00.000Z'),
      lastHeartbeatAt: new Date('2026-01-15T22:00:00.000Z'),
      status: 'STOPPED',
    });

    const localDay = await request(app)
      .get(
        `${API}/organizations/${orgId}/reports/daily?from=2026-01-16&to=2026-01-16&employeeId=${employee.user.id}`,
      )
      .set(ownerAuth.headers);
    expect(localDay.status).toBe(200);
    expect(localDay.body.data.timezone).toBe('Asia/Kolkata');
    expect(localDay.body.data.days[0].workedSeconds).toBe(7_200);

    const utcDay = await request(app)
      .get(
        `${API}/organizations/${orgId}/reports/daily?from=2026-01-15&to=2026-01-15&employeeId=${employee.user.id}`,
      )
      .set(ownerAuth.headers);
    expect(utcDay.body.data.days[0].workedSeconds).toBe(0);
  });

  it('derives working, on-break, online, and offline states from durable heartbeats', async () => {
    const { orgId, ownerAuth, agent, auth } = await createTeam();

    const started = await startSession(orgId, agent);
    const sessionId = started.body.data.session.id as string;
    const employeeStatus = (response: request.Response) =>
      (response.body.data as Array<{ employee: { id: string }; state: string }>).find(
        (row) => row.employee.id === auth.user.id,
      )!;

    let status = await request(app)
      .get(`${API}/organizations/${orgId}/reports/tracking-status`)
      .set(ownerAuth.headers);
    expect(status.status).toBe(200);
    expect(employeeStatus(status).state).toBe('WORKING');

    await request(app)
      .post(`${API}/organizations/${orgId}/time-sessions/${sessionId}/breaks`)
      .set(agent.headers)
      .send({});
    status = await request(app)
      .get(`${API}/organizations/${orgId}/reports/tracking-status`)
      .set(ownerAuth.headers);
    expect(employeeStatus(status).state).toBe('ON_BREAK');

    await stopSession(orgId, sessionId, agent);
    status = await request(app)
      .get(`${API}/organizations/${orgId}/reports/tracking-status`)
      .set(ownerAuth.headers);
    expect(employeeStatus(status).state).toBe('ONLINE');

    await Organization.update({ timezone: 'UTC' }, { where: { id: orgId } });
    const { DesktopAgent } = await import('../src/database');
    await DesktopAgent.update(
      { lastSeenAt: DateTime.utc().minus({ minutes: 10 }).toJSDate() },
      { where: { id: agent.id } },
    );
    status = await request(app)
      .get(`${API}/organizations/${orgId}/reports/tracking-status`)
      .set(ownerAuth.headers);
    expect(employeeStatus(status).state).toBe('OFFLINE');
  });
});
