import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app';
import { sequelize } from '../src/database';

const API = '/api/v1';
const app = createApp();
const MINUTE = 60_000;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Smoke check failed: ${message}`);
}

function utcDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

async function main() {
  const ready = await request(app).get(`${API}/health/ready`);
  assert(ready.status === 200, `readiness returned ${ready.status}`);

  const email = `smoke-${Date.now()}@example.com`;
  const inviteeEmail = `smoke-invitee-${Date.now()}@example.com`;
  const password = 'SmokeTestPassword123!';

  const registered = await request(app)
    .post(`${API}/auth/register`)
    .send({ name: 'Smoke Owner', email, password });
  assert(registered.status === 201, `register returned ${registered.status}`);

  const login = await request(app)
    .post(`${API}/auth/login`)
    .send({ email, password, client: 'desktop' });
  assert(login.status === 200, `login returned ${login.status}`);
  const bearer = { Authorization: `Bearer ${login.body.data.accessToken}` };
  const ownerId = login.body.data.user.id as string;

  const org = await request(app)
    .post(`${API}/organizations`)
    .set(bearer)
    .send({ name: 'Smoke Organization', timezone: 'UTC' });
  assert(org.status === 201, `create organization returned ${org.status}`);
  assert(org.body.data.membership.role === 'OWNER', 'creator must be OWNER');
  const organizationId = org.body.data.organization.id as string;

  const invitation = await request(app)
    .post(`${API}/organizations/${organizationId}/invitations`)
    .set(bearer)
    .send({ email: inviteeEmail, role: 'EMPLOYEE' });
  assert(invitation.status === 201, `invite returned ${invitation.status}`);

  const inviteeRegistered = await request(app)
    .post(`${API}/auth/register`)
    .send({ name: 'Smoke Invitee', email: inviteeEmail, password });
  assert(inviteeRegistered.status === 201, `invitee register returned ${inviteeRegistered.status}`);

  const inviteeLogin = await request(app)
    .post(`${API}/auth/login`)
    .send({ email: inviteeEmail, password, client: 'desktop' });
  assert(inviteeLogin.status === 200, `invitee login returned ${inviteeLogin.status}`);

  const accepted = await request(app)
    .post(`${API}/invitations/accept`)
    .set({ Authorization: `Bearer ${inviteeLogin.body.data.accessToken}` })
    .send({ token: invitation.body.data.token });
  assert(accepted.status === 200, `accept returned ${accepted.status}`);
  assert(accepted.body.data.membership.role === 'EMPLOYEE', 'invited role must be applied');

  const members = await request(app)
    .get(`${API}/organizations/${organizationId}/members`)
    .set(bearer);
  assert(members.status === 200, `member list returned ${members.status}`);
  assert(members.body.meta.total === 2, `expected 2 members, got ${members.body.meta.total}`);

  // --- Step 2: desktop agent, online session, break, activity, reports -------
  const deviceId = `smoke-device-${Date.now()}`;
  const registration = await request(app)
    .post(`${API}/organizations/${organizationId}/desktop-agents`)
    .set(bearer)
    .send({ deviceId, name: 'Smoke Desktop', platform: 'win32', appVersion: 'smoke' });
  assert(registration.status === 201, `agent registration returned ${registration.status}`);
  const agentId = registration.body.data.agent.id as string;
  const agentKey = registration.body.data.agentKey as string;
  assert(agentKey.startsWith('tna_'), 'agent key must be one-time and prefixed');
  const agentHeaders = {
    ...bearer,
    'x-agent-id': agentId,
    'x-agent-key': agentKey,
  };

  const agentAuth = await request(app)
    .post(`${API}/desktop-agents/authenticate`)
    .send({ agentId, agentKey });
  assert(agentAuth.status === 200, `agent authentication returned ${agentAuth.status}`);

  const agentList = await request(app)
    .get(`${API}/organizations/${organizationId}/desktop-agents`)
    .set(bearer);
  assert(agentList.status === 200, `agent list returned ${agentList.status}`);
  assert(agentList.body.meta.total === 1, `expected 1 agent, got ${agentList.body.meta.total}`);

  const started = await request(app)
    .post(`${API}/organizations/${organizationId}/time-sessions/start`)
    .set(agentHeaders)
    .send({});
  assert(started.status === 201, `session start returned ${started.status}`);
  const onlineSessionId = started.body.data.session.id as string;
  assert(started.body.data.session.status === 'ACTIVE', 'new session must be ACTIVE');

  const current = await request(app)
    .get(`${API}/organizations/${organizationId}/time-sessions/current`)
    .set(bearer);
  assert(current.status === 200, `current session returned ${current.status}`);
  assert(current.body.data.session?.id === onlineSessionId, 'current session must match');

  const heartbeat = await request(app)
    .post(`${API}/organizations/${organizationId}/time-sessions/${onlineSessionId}/heartbeat`)
    .set(agentHeaders)
    .send({});
  assert(heartbeat.status === 200, `heartbeat returned ${heartbeat.status}`);

  const breakStarted = await request(app)
    .post(`${API}/organizations/${organizationId}/time-sessions/${onlineSessionId}/breaks`)
    .set(agentHeaders)
    .send({});
  assert(breakStarted.status === 201, `break start returned ${breakStarted.status}`);
  assert(breakStarted.body.data.session.status === 'ON_BREAK', 'break must set ON_BREAK');

  const onBreakStatus = await request(app)
    .get(`${API}/organizations/${organizationId}/reports/tracking-status`)
    .query({ employeeId: ownerId })
    .set(bearer);
  assert(onBreakStatus.status === 200, `tracking status returned ${onBreakStatus.status}`);
  assert(onBreakStatus.body.data[0]?.state === 'ON_BREAK', 'tracking status must be ON_BREAK');

  const breakEnded = await request(app)
    .post(`${API}/organizations/${organizationId}/time-sessions/${onlineSessionId}/breaks/end`)
    .set(agentHeaders)
    .send({});
  assert(breakEnded.status === 200, `break end returned ${breakEnded.status}`);
  assert(breakEnded.body.data.session.status === 'ACTIVE', 'break end must restore ACTIVE');

  const stopped = await request(app)
    .post(`${API}/organizations/${organizationId}/time-sessions/${onlineSessionId}/stop`)
    .set(agentHeaders)
    .send({});
  assert(stopped.status === 200, `session stop returned ${stopped.status}`);
  assert(stopped.body.data.session.status === 'STOPPED', 'stopped session must be STOPPED');

  // Offline reconciliation: a client-generated session applied chronologically.
  const offlineSessionId = randomUUID();
  const offlineStart = new Date(Date.now() - 10 * MINUTE);
  const breakStartAt = new Date(Date.now() - 8 * MINUTE);
  const breakEndAt = new Date(Date.now() - 7 * MINUTE);
  const offlineStop = new Date(Date.now() - 5 * MINUTE);
  const offlineEvents = [
    {
      eventId: `smoke-start-${randomUUID()}`,
      type: 'SESSION_START',
      occurredAt: offlineStart.toISOString(),
      sessionId: offlineSessionId,
    },
    {
      eventId: `smoke-break-start-${randomUUID()}`,
      type: 'BREAK_START',
      occurredAt: breakStartAt.toISOString(),
      sessionId: offlineSessionId,
    },
    {
      eventId: `smoke-break-end-${randomUUID()}`,
      type: 'BREAK_END',
      occurredAt: breakEndAt.toISOString(),
      sessionId: offlineSessionId,
    },
    {
      eventId: `smoke-stop-${randomUUID()}`,
      type: 'SESSION_STOP',
      occurredAt: offlineStop.toISOString(),
      sessionId: offlineSessionId,
    },
  ];

  const sync = await request(app)
    .post(`${API}/organizations/${organizationId}/time-sessions/sync`)
    .set(agentHeaders)
    .send({ deviceId, events: [...offlineEvents].reverse() });
  assert(sync.status === 200, `offline sync returned ${sync.status}`);
  assert(
    sync.body.data.results.every((result: { status: string }) => result.status === 'applied'),
    'all offline events must apply in chronological order',
  );

  const replay = await request(app)
    .post(`${API}/organizations/${organizationId}/time-sessions/sync`)
    .set(agentHeaders)
    .send({ deviceId, events: offlineEvents });
  assert(replay.status === 200, `offline replay returned ${replay.status}`);
  assert(
    replay.body.data.results.every((result: { status: string }) => result.status === 'duplicate'),
    'offline replay must be idempotent',
  );

  const activityStart = new Date(Date.now() - 6 * MINUTE);
  const activityEnd = new Date(Date.now() - 5.5 * MINUTE);
  const activity = await request(app)
    .post(`${API}/organizations/${organizationId}/application-activities/batch`)
    .set(agentHeaders)
    .send({
      events: [
        {
          idempotencyKey: `smoke-app-${randomUUID()}`,
          sessionId: offlineSessionId,
          applicationIdentifier: 'code',
          applicationName: 'Visual Studio Code',
          startedAt: activityStart.toISOString(),
          endedAt: activityEnd.toISOString(),
          durationSeconds: 999_999,
        },
      ],
    });
  assert(activity.status === 200, `activity batch returned ${activity.status}`);
  assert(activity.body.data.accepted === 1, `expected 1 accepted activity, got ${activity.body.data.accepted}`);

  const reportFrom = utcDate(offlineStart);
  const reportTo = utcDate(new Date());

  const sessions = await request(app)
    .get(`${API}/organizations/${organizationId}/reports/sessions`)
    .query({ from: reportFrom, to: reportTo, employeeId: ownerId })
    .set(bearer);
  assert(sessions.status === 200, `session report returned ${sessions.status}`);
  assert(
    sessions.body.data.some((session: { id: string }) => session.id === offlineSessionId),
    'session report must include the synced offline session',
  );

  const daily = await request(app)
    .get(`${API}/organizations/${organizationId}/reports/daily`)
    .query({ from: reportFrom, to: reportTo, employeeId: ownerId })
    .set(bearer);
  assert(daily.status === 200, `daily report returned ${daily.status}`);
  const workedSeconds = daily.body.data.days.reduce(
    (total: number, day: { workedSeconds: number }) => total + day.workedSeconds,
    0,
  );
  const breakSeconds = daily.body.data.days.reduce(
    (total: number, day: { breakSeconds: number }) => total + day.breakSeconds,
    0,
  );
  assert(workedSeconds >= 230, `expected >=230 worked seconds, got ${workedSeconds}`);
  assert(breakSeconds >= 50, `expected >=50 break seconds, got ${breakSeconds}`);

  const usage = await request(app)
    .get(`${API}/organizations/${organizationId}/reports/application-usage`)
    .query({ from: reportFrom, to: reportTo, employeeId: ownerId })
    .set(bearer);
  assert(usage.status === 200, `application usage report returned ${usage.status}`);
  assert(usage.body.data.length === 1, 'expected one application usage row');
  assert(usage.body.data[0].totalSeconds === 30, `expected 30 app seconds, got ${usage.body.data[0].totalSeconds}`);
  assert(usage.body.data[0].percentageOfTrackedTime > 0, 'app usage percentage must be positive');
  assert(typeof usage.body.disclaimer === 'string', 'application usage requires a disclaimer');

  const timeline = await request(app)
    .get(`${API}/organizations/${organizationId}/reports/application-timeline`)
    .query({ from: reportFrom, to: reportTo, employeeId: ownerId })
    .set(bearer);
  assert(timeline.status === 200, `application timeline returned ${timeline.status}`);
  assert(timeline.body.data.length === 1, 'expected one application timeline segment');
  assert(timeline.body.data[0].durationSeconds === 30, 'timeline must use server-derived duration');

  const revoked = await request(app)
    .delete(`${API}/organizations/${organizationId}/desktop-agents/${agentId}`)
    .set(bearer);
  assert(revoked.status === 200, `agent revocation returned ${revoked.status}`);
  assert(revoked.body.data.agent.status === 'REVOKED', 'agent must be REVOKED');

  const afterRevoke = await request(app)
    .post(`${API}/desktop-agents/authenticate`)
    .send({ agentId, agentKey });
  assert(afterRevoke.status === 403, `revoked agent auth returned ${afterRevoke.status}`);

  const logout = await request(app).post(`${API}/auth/logout`).set(bearer).send({});
  assert(logout.status === 204, `logout returned ${logout.status}`);

  // eslint-disable-next-line no-console
  console.log(
    'Smoke test passed: health, auth, org, invite, agents, sessions, breaks, heartbeat, offline sync, activity, reports, revoke, logout.',
  );
}

main()
  .then(async () => {
    await sequelize.close();
  })
  .catch(async (error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    await sequelize.close();
    process.exit(1);
  });
