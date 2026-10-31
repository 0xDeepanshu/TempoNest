import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ActivityIdleInterval,
  ApplicationActivity,
  ApplicationClassification,
  AuditEvent,
  Break,
  OrganizationTrackingSettings,
  TimeSession,
} from '../src/database';
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
import { purgeActivityHistory } from '../src/modules/activity/activity.maintenance';

async function createTeam(organizationName = 'Activity Analytics Org') {
  const owner = await createOwner(uniqueEmail('owner'), organizationName);
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

function startSession(orgId: string, agent: { headers: Record<string, string> }) {
  return request(app)
    .post(`${API}/organizations/${orgId}/time-sessions/start`)
    .set(agent.headers)
    .send({});
}

function stopSession(orgId: string, sessionId: string, agent: { headers: Record<string, string> }) {
  return request(app)
    .post(`${API}/organizations/${orgId}/time-sessions/${sessionId}/stop`)
    .set(agent.headers)
    .send({});
}

function postActivity(
  orgId: string,
  agent: { headers: Record<string, string> },
  events: unknown[],
) {
  return request(app)
    .post(`${API}/organizations/${orgId}/application-activities/batch`)
    .set(agent.headers)
    .send({ events });
}

function postIdle(orgId: string, agent: { headers: Record<string, string> }, intervals: unknown[]) {
  return request(app)
    .post(`${API}/organizations/${orgId}/activity/idle-intervals/batch`)
    .set(agent.headers)
    .send({ intervals });
}

function patchSettings(orgId: string, auth: { headers: Record<string, string> }, body: unknown) {
  return request(app)
    .patch(`${API}/organizations/${orgId}/activity/settings`)
    .set(auth.headers)
    .send(body as object);
}

function getSummary(
  orgId: string,
  auth: { headers: Record<string, string> },
  query: string,
) {
  return request(app)
    .get(`${API}/organizations/${orgId}/reports/activity-summary?${query}`)
    .set(auth.headers);
}

function getOverview(
  orgId: string,
  auth: { headers: Record<string, string> },
  query: string,
) {
  return request(app)
    .get(`${API}/organizations/${orgId}/reports/activity-overview?${query}`)
    .set(auth.headers);
}

async function createStoppedSession(options: {
  orgId: string;
  employeeId: string;
  agentId: string;
  agentHeaders: Record<string, string>;
  startedAt: Date;
  endedAt: Date;
}) {
  const started = await startSession(options.orgId, { headers: options.agentHeaders });
  expect(started.status).toBe(201);
  const sessionId = started.body.data.session.id as string;
  await stopSession(options.orgId, sessionId, { headers: options.agentHeaders });
  await TimeSession.update(
    {
      startedAt: options.startedAt,
      endedAt: options.endedAt,
      lastHeartbeatAt: options.endedAt,
      status: 'STOPPED',
    },
    { where: { id: sessionId } },
  );
  return sessionId;
}

async function insertActivity(options: {
  orgId: string;
  employeeId: string;
  sessionId: string;
  agentId: string;
  identifier: string;
  name: string;
  startedAt: Date;
  endedAt: Date;
}) {
  const seconds = Math.floor((options.endedAt.getTime() - options.startedAt.getTime()) / 1000);
  return ApplicationActivity.create({
    organizationId: options.orgId,
    employeeId: options.employeeId,
    timeSessionId: options.sessionId,
    desktopAgentId: options.agentId,
    applicationIdentifier: options.identifier,
    applicationName: options.name,
    startedAt: options.startedAt,
    endedAt: options.endedAt,
    durationSeconds: seconds,
    idempotencyKey: randomUUID(),
  });
}

async function insertIdle(options: {
  orgId: string;
  employeeId: string;
  sessionId: string;
  agentId: string;
  startedAt: Date;
  endedAt: Date;
  thresholdSeconds?: number;
}) {
  const seconds = Math.floor((options.endedAt.getTime() - options.startedAt.getTime()) / 1000);
  return ActivityIdleInterval.create({
    organizationId: options.orgId,
    employeeId: options.employeeId,
    timeSessionId: options.sessionId,
    desktopAgentId: options.agentId,
    idempotencyKey: randomUUID(),
    startedAt: options.startedAt,
    endedAt: options.endedAt,
    durationSeconds: seconds,
    thresholdSeconds: options.thresholdSeconds ?? 300,
    platform: 'win32',
  });
}

async function createClassification(
  orgId: string,
  auth: { headers: Record<string, string> },
  body: Record<string, unknown>,
) {
  return request(app)
    .post(`${API}/organizations/${orgId}/application-classifications`)
    .set(auth.headers)
    .send(body);
}

describe('desktop tracking policy', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('returns defaults and applies validated policy updates with versioning and audit', async () => {
    const { owner, ownerAuth, orgId } = await createTeam();

    const initial = await request(app)
      .get(`${API}/organizations/${orgId}/activity/settings`)
      .set(ownerAuth.headers);
    expect(initial.status).toBe(200);
    expect(initial.body.data.settings).toMatchObject({
      appTrackingEnabled: true,
      idleDetectionEnabled: true,
      idleThresholdMinutes: 5,
      productivityClassificationEnabled: true,
      activityRetentionDays: 90,
      policyVersion: 1,
    });

    const invalidThreshold = await patchSettings(orgId, ownerAuth, { idleThresholdMinutes: 0 });
    expect(invalidThreshold.status).toBe(422);

    const unknownField = await patchSettings(orgId, ownerAuth, { appTrackingEnabled: true, extra: 1 });
    expect(unknownField.status).toBe(422);

    const empty = await patchSettings(orgId, ownerAuth, {});
    expect(empty.status).toBe(422);

    const updated = await patchSettings(orgId, ownerAuth, {
      appTrackingEnabled: false,
      idleThresholdMinutes: 10,
      activityRetentionDays: 30,
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data.settings).toMatchObject({
      appTrackingEnabled: false,
      idleDetectionEnabled: true,
      idleThresholdMinutes: 10,
      activityRetentionDays: 30,
      policyVersion: 2,
    });

    const audit = await AuditEvent.findAll({
      where: { organizationId: orgId, action: 'APP_TRACKING_POLICY_UPDATED' },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actorUserId).toBe(owner.user.id);
    expect(audit[0]!.metadata).toMatchObject({
      changedFields: expect.arrayContaining(['appTrackingEnabled', 'idleThresholdMinutes']),
      policyVersion: 2,
    });
  });

  it('restricts policy administration to owners and admins while employees can read it', async () => {
    const { owner, orgId } = await createTeam();
    const manager = await inviteAndAccept(owner, {
      role: 'MANAGER',
      email: uniqueEmail('manager'),
    });
    const managerAuth = await desktopAuth(manager.email);
    const employee = await inviteAndAccept(owner, {
      role: 'EMPLOYEE',
      email: uniqueEmail('employee2'),
    });
    const employeeAuth = await desktopAuth(employee.email);

    const managerUpdate = await patchSettings(orgId, managerAuth, { idleThresholdMinutes: 10 });
    expect(managerUpdate.status).toBe(403);
    expect(managerUpdate.body.error.code).toBe('PERMISSION_DENIED');

    const employeeUpdate = await patchSettings(orgId, employeeAuth, { idleThresholdMinutes: 10 });
    expect(employeeUpdate.status).toBe(403);

    const employeeRead = await request(app)
      .get(`${API}/organizations/${orgId}/activity/settings`)
      .set(employeeAuth.headers);
    expect(employeeRead.status).toBe(200);
    expect(employeeRead.body.data.settings.idleThresholdMinutes).toBe(5);
  });
});

describe('activity and idle ingestion policy', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('stops app tracking when disabled without deleting history, while idle remains independent', async () => {
    const { employee, agent, ownerAuth, orgId } = await createTeam();
    const started = await startSession(orgId, agent);
    const sessionId = started.body.data.session.id as string;
    const now = Date.now();
    await TimeSession.update(
      {
        startedAt: new Date(now - 60 * 60_000),
        lastHeartbeatAt: new Date(now),
      },
      { where: { id: sessionId } },
    );

    const event = (offsetMs: number) => ({
      idempotencyKey: randomUUID(),
      sessionId,
      applicationIdentifier: 'code',
      applicationName: 'Code',
      startedAt: new Date(now + offsetMs).toISOString(),
      endedAt: new Date(now + offsetMs + 5_000).toISOString(),
    });

    const first = await postActivity(orgId, agent, [event(-20_000)]);
    expect(first.status).toBe(200);
    expect(first.body.data.accepted).toBe(1);

    await patchSettings(orgId, ownerAuth, { appTrackingEnabled: false });

    const blocked = await postActivity(orgId, agent, [event(-10_000)]);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('APP_TRACKING_DISABLED');
    expect(await ApplicationActivity.count({ where: { organizationId: orgId } })).toBe(1);

    const idleInterval = () => ({
      idempotencyKey: randomUUID(),
      sessionId,
      startedAt: new Date(now - 360_000).toISOString(),
      endedAt: new Date(now - 60_000).toISOString(),
    });
    const idleOk = await postIdle(orgId, agent, [idleInterval()]);
    expect(idleOk.status).toBe(200);
    expect(idleOk.body.data.accepted).toBe(1);

    await patchSettings(orgId, ownerAuth, { idleDetectionEnabled: false });
    const idleBlocked = await postIdle(orgId, agent, [idleInterval()]);
    expect(idleBlocked.status).toBe(403);
    expect(idleBlocked.body.error.code).toBe('IDLE_DETECTION_DISABLED');

    await patchSettings(orgId, ownerAuth, { appTrackingEnabled: true });
    const reenabled = await postActivity(orgId, agent, [event(10_000)]);
    expect(reenabled.body.data.accepted).toBe(1);
    expect(await ApplicationActivity.count({ where: { organizationId: orgId } })).toBe(2);
    expect(employee.user.id).toBeTruthy();
  });

  it('enforces the idle threshold, deduplicates retries, and merges overlapping intervals in reports', async () => {
    const { employee, agent, ownerAuth, orgId } = await createTeam();
    await patchSettings(orgId, ownerAuth, { idleThresholdMinutes: 1 });

    const now = Date.now();
    const anchor = new Date(now - 24 * 60 * 60_000);
    anchor.setUTCHours(10, 0, 0, 0);
    const sessionId = await createStoppedSession({
      orgId,
      employeeId: employee.user.id,
      agentId: agent.id,
      agentHeaders: agent.headers,
      startedAt: new Date(anchor.getTime() - 60 * 60_000),
      endedAt: new Date(anchor.getTime() + 3 * 60 * 60_000),
    });

    const below = await postIdle(orgId, agent, [
      {
        idempotencyKey: randomUUID(),
        sessionId,
        startedAt: anchor.toISOString(),
        endedAt: new Date(anchor.getTime() + 59_000).toISOString(),
      },
    ]);
    expect(below.body.data.results[0].status).toBe('rejected');
    expect(below.body.data.results[0].code).toBe('IDLE_BELOW_THRESHOLD');

    const atThreshold = {
      idempotencyKey: randomUUID(),
      sessionId,
      startedAt: anchor.toISOString(),
      endedAt: new Date(anchor.getTime() + 60_000).toISOString(),
    };
    const accepted = await postIdle(orgId, agent, [atThreshold]);
    expect(accepted.body.data.accepted).toBe(1);
    expect(accepted.body.data.thresholdSeconds).toBe(60);

    const duplicate = await postIdle(orgId, agent, [atThreshold]);
    expect(duplicate.body.data.duplicated).toBe(1);

    const overlapping = await postIdle(orgId, agent, [
      {
        idempotencyKey: randomUUID(),
        sessionId,
        startedAt: new Date(anchor.getTime() + 30_000).toISOString(),
        endedAt: new Date(anchor.getTime() + 150_000).toISOString(),
      },
    ]);
    expect(overlapping.body.data.accepted).toBe(1);

    const foreignSession = await postIdle(orgId, agent, [
      {
        idempotencyKey: randomUUID(),
        sessionId: randomUUID(),
        startedAt: new Date(anchor.getTime() + 240_000).toISOString(),
        endedAt: new Date(anchor.getTime() + 300_000).toISOString(),
      },
    ]);
    expect(foreignSession.body.data.results[0].status).toBe('rejected');
    expect(foreignSession.body.data.results[0].code).toBe('SESSION_NOT_FOUND');

    const day = anchor.toISOString().slice(0, 10);
    const summary = await getSummary(
      orgId,
      ownerAuth,
      `from=${day}&to=${day}&employeeId=${employee.user.id}`,
    );
    expect(summary.status).toBe(200);
    // [10:00, 10:01] and [10:00:30, 10:02:30] merge into one 150s interval.
    expect(summary.body.data.totals.idleSeconds).toBe(150);
    expect(summary.body.data.totals.hasIdleData).toBe(true);
  });

  it('rejects malformed batches and client-supplied classifications', async () => {
    const { agent, orgId } = await createTeam();
    const started = await startSession(orgId, agent);
    const sessionId = started.body.data.session.id as string;
    const base = Date.parse(started.body.data.session.startedAt as string);
    const interval = {
      idempotencyKey: randomUUID(),
      sessionId,
      applicationIdentifier: 'code',
      applicationName: 'Code',
      startedAt: new Date(base + 100).toISOString(),
      endedAt: new Date(base + 5_100).toISOString(),
    };

    const missingName = await postActivity(orgId, agent, [
      {
        idempotencyKey: randomUUID(),
        sessionId,
        applicationIdentifier: 'code',
        startedAt: interval.startedAt,
        endedAt: interval.endedAt,
      },
    ]);
    expect(missingName.status).toBe(422);

    const clientCategory = await postActivity(orgId, agent, [
      { ...interval, idempotencyKey: randomUUID(), category: 'PRODUCTIVE' },
    ]);
    expect(clientCategory.status).toBe(422);

    const duplicateKeys = await postActivity(orgId, agent, [interval, interval]);
    expect(duplicateKeys.status).toBe(422);

    const badInterval = await postIdle(orgId, agent, [
      {
        idempotencyKey: randomUUID(),
        sessionId,
        startedAt: interval.startedAt,
        endedAt: interval.startedAt,
      },
    ]);
    expect(badInterval.status).toBe(422);

    const tooManyIdle = await postIdle(
      orgId,
      agent,
      Array.from({ length: 201 }, () => ({
        idempotencyKey: randomUUID(),
        sessionId,
        startedAt: interval.startedAt,
        endedAt: interval.endedAt,
      })),
    );
    expect(tooManyIdle.status).toBe(422);
  });
});

describe('application classification', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('creates, lists, and updates classifications with audit history and tenant isolation', async () => {
    const { employee, ownerAuth, agent, orgId } = await createTeam();
    const employeeAuth = await desktopAuth(employee.email);
    const started = await startSession(orgId, agent);
    const sessionId = started.body.data.session.id as string;
    const base = Date.parse(started.body.data.session.startedAt as string);

    await postActivity(orgId, agent, [
      {
        idempotencyKey: randomUUID(),
        sessionId,
        applicationIdentifier: 'com.example.code',
        applicationName: 'Code',
        startedAt: new Date(base + 100).toISOString(),
        endedAt: new Date(base + 5_100).toISOString(),
      },
    ]);

    const created = await createClassification(orgId, ownerAuth, {
      applicationIdentifier: 'com.example.code',
      applicationName: 'Code',
      category: 'PRODUCTIVE',
      notes: 'Primary editor',
    });
    expect(created.status).toBe(201);
    expect(created.body.data.classification).toMatchObject({
      applicationIdentifier: 'com.example.code',
      category: 'PRODUCTIVE',
      classified: true,
    });
    const classificationId = created.body.data.classification.id as string;

    const duplicate = await createClassification(orgId, ownerAuth, {
      applicationIdentifier: 'COM.EXAMPLE.CODE',
      category: 'NEUTRAL',
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('CLASSIFICATION_EXISTS');

    const list = await request(app)
      .get(`${API}/organizations/${orgId}/application-classifications`)
      .set(ownerAuth.headers);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.summary).toMatchObject({ total: 1, classified: 1, unclassified: 0 });

    const observedList = await request(app)
      .get(`${API}/organizations/${orgId}/application-classifications?includeObserved=true`)
      .set(ownerAuth.headers);
    expect(observedList.body.data).toHaveLength(1);

    const updated = await request(app)
      .patch(`${API}/organizations/${orgId}/application-classifications/${classificationId}`)
      .set(ownerAuth.headers)
      .send({ category: 'UNPRODUCTIVE' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.classification.category).toBe('UNPRODUCTIVE');

    const audit = await AuditEvent.findAll({
      where: { organizationId: orgId },
      order: [['createdAt', 'ASC']],
    });
    const actions = audit.map((event) => event.action);
    expect(actions).toContain('APPLICATION_CLASSIFICATION_CREATED');
    expect(actions).toContain('APPLICATION_CLASSIFICATION_UPDATED');
    const updateAudit = audit.find((event) => event.action === 'APPLICATION_CLASSIFICATION_UPDATED');
    expect(updateAudit?.metadata).toMatchObject({
      previousCategory: 'PRODUCTIVE',
      category: 'UNPRODUCTIVE',
    });

    const employeeCreate = await createClassification(orgId, employeeAuth, {
      applicationIdentifier: 'x',
    });
    expect(employeeCreate.status).toBe(403);
    expect(employeeCreate.body.error.code).toBe('PERMISSION_DENIED');

    const that = await createTeam('Other Org');
    const crossTenantUpdate = await request(app)
      .patch(`${API}/organizations/${that.orgId}/application-classifications/${classificationId}`)
      .set(that.ownerAuth.headers)
      .send({ category: 'NEUTRAL' });
    expect(crossTenantUpdate.status).toBe(404);
    expect(crossTenantUpdate.body.error.code).toBe('CLASSIFICATION_NOT_FOUND');

    const otherList = await request(app)
      .get(`${API}/organizations/${that.orgId}/application-classifications`)
      .set(that.ownerAuth.headers);
    expect(otherList.body.data).toHaveLength(0);
  });
});

describe('activity analytics', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function seedAnalyticsScenario() {
    const team = await createTeam();
    const day = '2026-02-10';
    const at = (hour: number, minute = 0) =>
      new Date(`2026-02-10T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`);

    const sessionId = await createStoppedSession({
      orgId: team.orgId,
      employeeId: team.employee.user.id,
      agentId: team.agent.id,
      agentHeaders: team.agent.headers,
      startedAt: at(9),
      endedAt: at(17),
    });
    await Break.create({
      organizationId: team.orgId,
      timeSessionId: sessionId,
      startedAt: at(12),
      endedAt: at(13),
      status: 'ENDED',
    });
    await insertIdle({
      orgId: team.orgId,
      employeeId: team.employee.user.id,
      sessionId,
      agentId: team.agent.id,
      startedAt: at(15),
      endedAt: at(15, 30),
    });

    await insertActivity({
      orgId: team.orgId,
      employeeId: team.employee.user.id,
      sessionId,
      agentId: team.agent.id,
      identifier: 'com.example.code',
      name: 'Code',
      startedAt: at(9, 30),
      endedAt: at(11, 30),
    });
    await insertActivity({
      orgId: team.orgId,
      employeeId: team.employee.user.id,
      sessionId,
      agentId: team.agent.id,
      identifier: 'com.example.browser',
      name: 'Browser',
      startedAt: at(11, 30),
      endedAt: at(12, 30),
    });
    await insertActivity({
      orgId: team.orgId,
      employeeId: team.employee.user.id,
      sessionId,
      agentId: team.agent.id,
      identifier: 'com.example.code',
      name: 'Code',
      startedAt: at(13),
      endedAt: at(14, 30),
    });
    await insertActivity({
      orgId: team.orgId,
      employeeId: team.employee.user.id,
      sessionId,
      agentId: team.agent.id,
      identifier: 'com.example.chat',
      name: 'Chat',
      startedAt: at(14, 30),
      endedAt: at(15, 30),
    });

    await createClassification(team.orgId, team.ownerAuth, {
      applicationIdentifier: 'com.example.code',
      applicationName: 'Code',
      category: 'PRODUCTIVE',
    });
    await createClassification(team.orgId, team.ownerAuth, {
      applicationIdentifier: 'com.example.browser',
      applicationName: 'Browser',
      category: 'NEUTRAL',
    });

    return { ...team, day };
  }

  it('computes active time and category ratios excluding breaks and idle', async () => {
    const { employee, ownerAuth, day, orgId } = await seedAnalyticsScenario();

    const summary = await getSummary(
      orgId,
      ownerAuth,
      `from=${day}&to=${day}&employeeId=${employee.user.id}`,
    );
    expect(summary.status).toBe(200);

    const totals = summary.body.data.totals;
    expect(totals).toMatchObject({
      sessionCount: 1,
      trackedSeconds: 28_800,
      workingSeconds: 25_200,
      breakSeconds: 3_600,
      idleSeconds: 1_800,
      activeSeconds: 23_400,
      applicationSeconds: 16_200,
      unaccountedActiveSeconds: 7_200,
      activityCoveragePercent: 69.2,
      productiveSeconds: 12_600,
      neutralSeconds: 1_800,
      unproductiveSeconds: 0,
      unclassifiedSeconds: 1_800,
      productivePercentOfActive: 53.8,
      unclassifiedPercentOfActive: 7.7,
      hasActivityData: true,
      hasIdleData: true,
    });

    const categories = Object.fromEntries(
      (summary.body.data.categories as { category: string; seconds: number }[]).map((row) => [
        row.category,
        row.seconds,
      ]),
    );
    expect(categories).toEqual({
      PRODUCTIVE: 12_600,
      NEUTRAL: 1_800,
      UNPRODUCTIVE: 0,
      UNCLASSIFIED: 1_800,
    });

    const applications = summary.body.data.applications as {
      applicationIdentifier: string;
      category: string;
      totalSeconds: number;
      percentageOfActiveTime: number;
    }[];
    expect(applications[0]).toMatchObject({
      applicationIdentifier: 'com.example.code',
      category: 'PRODUCTIVE',
      totalSeconds: 12_600,
      percentageOfActiveTime: 53.8,
    });
    expect(applications).toHaveLength(3);
    expect(summary.body.data.days).toHaveLength(1);
    expect(summary.body.data.days[0]).toMatchObject({
      date: day,
      activeSeconds: 23_400,
      applicationSeconds: 16_200,
    });
    expect(summary.body.data.disclaimer).toContain('not a definitive');
  });

  it('applies classification retroactively without rewriting stored activity', async () => {
    const { employee, ownerAuth, orgId, day } = await seedAnalyticsScenario();

    const classification = await ApplicationClassification.findOne({
      where: { organizationId: orgId, applicationIdentifier: 'com.example.chat' },
    });
    expect(classification).toBeNull();

    await createClassification(orgId, ownerAuth, {
      applicationIdentifier: 'com.example.chat',
      applicationName: 'Chat',
      category: 'UNPRODUCTIVE',
    });

    const summary = await getSummary(
      orgId,
      ownerAuth,
      `from=${day}&to=${day}&employeeId=${employee.user.id}`,
    );
    expect(summary.body.data.totals.productiveSeconds).toBe(12_600);
    expect(summary.body.data.totals.unproductiveSeconds).toBe(1_800);
    expect(summary.body.data.totals.unclassifiedSeconds).toBe(0);
    const chat = (summary.body.data.applications as { applicationIdentifier: string; category: string }[]).find(
      (row) => row.applicationIdentifier === 'com.example.chat',
    );
    expect(chat?.category).toBe('UNPRODUCTIVE');

    // The raw event still references no classification; only the catalog changed.
    const raw = await ApplicationActivity.findOne({
      where: { organizationId: orgId, applicationIdentifier: 'com.example.chat' },
    });
    expect(raw).not.toBeNull();
  });

  it('treats unknown applications as unclassified and suppresses ratios when classification is disabled', async () => {
    const { employee, ownerAuth, orgId, day } = await seedAnalyticsScenario();

    await patchSettings(orgId, ownerAuth, { productivityClassificationEnabled: false });

    const summary = await getSummary(
      orgId,
      ownerAuth,
      `from=${day}&to=${day}&employeeId=${employee.user.id}`,
    );
    expect(summary.body.data.totals.productivePercentOfActive).toBeNull();
    expect(summary.body.data.totals.unclassifiedPercentOfActive).toBeNull();
    expect(summary.body.data.totals.productiveSeconds).toBe(0);
    expect(summary.body.data.totals.unclassifiedSeconds).toBe(16_200);
    const applications = summary.body.data.applications as { category: string }[];
    expect(applications.every((row) => row.category === 'UNCLASSIFIED')).toBe(true);
  });

  it('returns empty, non-invented results and enforces self-access', async () => {
    const { employee, auth, owner, ownerAuth, orgId } = await createTeam();
    const other = await inviteAndAccept(owner, {
      role: 'EMPLOYEE',
      email: uniqueEmail('other'),
    });

    const day = '2026-02-10';
    const summary = await getSummary(
      orgId,
      auth,
      `from=${day}&to=${day}&employeeId=${employee.user.id}`,
    );
    expect(summary.status).toBe(200);
    expect(summary.body.data.totals).toMatchObject({
      trackedSeconds: 0,
      activeSeconds: 0,
      applicationSeconds: 0,
      hasActivityData: false,
      hasIdleData: false,
      productivePercentOfActive: null,
      unclassifiedPercentOfActive: null,
    });
    expect(summary.body.data.applications).toEqual([]);
    expect(summary.body.data.days).toHaveLength(1);

    const crossEmployee = await getSummary(
      orgId,
      auth,
      `from=${day}&to=${day}&employeeId=${other.user.id}`,
    );
    expect(crossEmployee.status).toBe(403);
    expect(crossEmployee.body.error.code).toBe('PERMISSION_DENIED');

    const manager = await inviteAndAccept(owner, {
      role: 'MANAGER',
      email: uniqueEmail('manager-reader'),
    });
    const managerAuth = await desktopAuth(manager.email);
    const managerReadsEmployee = await getSummary(
      orgId,
      managerAuth,
      `from=${day}&to=${day}&employeeId=${employee.user.id}`,
    );
    expect(managerReadsEmployee.status).toBe(200);

    const ownerReadsOther = await getSummary(
      orgId,
      ownerAuth,
      `from=${day}&to=${day}&employeeId=${other.user.id}`,
    );
    expect(ownerReadsOther.status).toBe(200);
  });

  it('aggregates per-employee overview rows for administrators and rejects employees', async () => {
    const { employee, owner, ownerAuth, orgId } = await seedAnalyticsScenario();

    const second = await inviteAndAccept(owner, {
      role: 'EMPLOYEE',
      email: uniqueEmail('second'),
    });
    const secondAuth = await desktopAuth(second.email);
    const secondAgent = await registerAgent(secondAuth, orgId, { name: 'Second Desktop' });
    const secondSession = await createStoppedSession({
      orgId,
      employeeId: second.user.id,
      agentId: secondAgent.id,
      agentHeaders: secondAgent.headers,
      startedAt: new Date('2026-02-10T10:00:00.000Z'),
      endedAt: new Date('2026-02-10T12:00:00.000Z'),
    });
    await insertActivity({
      orgId,
      employeeId: second.user.id,
      sessionId: secondSession,
      agentId: secondAgent.id,
      identifier: 'com.example.editor',
      name: 'Editor',
      startedAt: new Date('2026-02-10T10:00:00.000Z'),
      endedAt: new Date('2026-02-10T11:00:00.000Z'),
    });

    const overview = await getOverview(orgId, ownerAuth, 'from=2026-02-10&to=2026-02-10');
    expect(overview.status).toBe(200);
    const rows = overview.body.data as {
      employee: { id: string };
      activeSeconds: number;
      applicationSeconds: number;
      productiveSeconds: number;
      topApplications: unknown[];
    }[];
    const firstRow = rows.find((row) => row.employee.id === employee.user.id);
    expect(firstRow).toMatchObject({
      activeSeconds: 23_400,
      applicationSeconds: 16_200,
      productiveSeconds: 12_600,
    });
    expect(firstRow?.topApplications).toHaveLength(3);
    const secondRow = rows.find((row) => row.employee.id === second.user.id);
    expect(secondRow).toMatchObject({ activeSeconds: 7_200, applicationSeconds: 3_600 });

    expect(overview.body.totals.activeSeconds).toBe(30_600);
    expect(overview.body.totals.applicationSeconds).toBe(19_800);
    expect(overview.body.disclaimer).toContain('not a definitive');

    const employeeOverview = await getOverview(
      orgId,
      { headers: { Authorization: `Bearer ${secondAuth.token}` } },
      'from=2026-02-10&to=2026-02-10',
    );
    expect(employeeOverview.status).toBe(403);
  });

  it('uses organization-local day boundaries for summaries', async () => {
    const { employee, ownerAuth, orgId, agent } = await createTeam();
    const orgUpdate = await request(app)
      .patch(`${API}/organizations/${orgId}`)
      .set(ownerAuth.headers)
      .send({ timezone: 'America/Los_Angeles' });
    expect(orgUpdate.status).toBe(200);

    const sessionId = await createStoppedSession({
      orgId,
      employeeId: employee.user.id,
      agentId: agent.id,
      agentHeaders: agent.headers,
      startedAt: new Date('2026-03-01T07:00:00.000Z'),
      endedAt: new Date('2026-03-01T08:00:00.000Z'),
    });
    await insertActivity({
      orgId,
      employeeId: employee.user.id,
      sessionId,
      agentId: agent.id,
      identifier: 'com.example.code',
      name: 'Code',
      startedAt: new Date('2026-03-01T07:30:00.000Z'),
      endedAt: new Date('2026-03-01T08:00:00.000Z'),
    });

    const feb28 = await getSummary(
      orgId,
      ownerAuth,
      `from=2026-02-28&to=2026-02-28&employeeId=${employee.user.id}`,
    );
    expect(feb28.body.data.timezone).toBe('America/Los_Angeles');
    // 07:00–08:00Z on Mar 1 is 23:00–24:00 local on Feb 28 (PST).
    expect(feb28.body.data.totals.activeSeconds).toBe(3_600);
    expect(feb28.body.data.totals.applicationSeconds).toBe(1_800);

    const mar1 = await getSummary(
      orgId,
      ownerAuth,
      `from=2026-03-01&to=2026-03-01&employeeId=${employee.user.id}`,
    );
    expect(mar1.body.data.totals.activeSeconds).toBe(0);
    expect(mar1.body.data.totals.applicationSeconds).toBe(0);
  });

  it('purges expired raw data while keeping recent rows and classifications', async () => {
    const { employee, ownerAuth, orgId, agent } = await createTeam();
    await patchSettings(orgId, ownerAuth, { activityRetentionDays: 7 });

    const now = new Date();
    const sessionId = await createStoppedSession({
      orgId,
      employeeId: employee.user.id,
      agentId: agent.id,
      agentHeaders: agent.headers,
      startedAt: new Date(now.getTime() - 20 * 86_400_000),
      endedAt: now,
    });

    const oldActivity = await insertActivity({
      orgId,
      employeeId: employee.user.id,
      sessionId,
      agentId: agent.id,
      identifier: 'com.example.old',
      name: 'Old',
      startedAt: new Date(now.getTime() - 10 * 86_400_000),
      endedAt: new Date(now.getTime() - 10 * 86_400_000 + 60_000),
    });
    const recentActivity = await insertActivity({
      orgId,
      employeeId: employee.user.id,
      sessionId,
      agentId: agent.id,
      identifier: 'com.example.recent',
      name: 'Recent',
      startedAt: new Date(now.getTime() - 2 * 86_400_000),
      endedAt: new Date(now.getTime() - 2 * 86_400_000 + 60_000),
    });
    const oldIdle = await insertIdle({
      orgId,
      employeeId: employee.user.id,
      sessionId,
      agentId: agent.id,
      startedAt: new Date(now.getTime() - 10 * 86_400_000),
      endedAt: new Date(now.getTime() - 10 * 86_400_000 + 120_000),
    });
    const recentIdle = await insertIdle({
      orgId,
      employeeId: employee.user.id,
      sessionId,
      agentId: agent.id,
      startedAt: new Date(now.getTime() - 2 * 86_400_000),
      endedAt: new Date(now.getTime() - 2 * 86_400_000 + 120_000),
    });
    await createClassification(orgId, ownerAuth, {
      applicationIdentifier: 'com.example.recent',
      category: 'PRODUCTIVE',
    });

    const result = await purgeActivityHistory(now);
    expect(result.activitiesDeleted).toBeGreaterThanOrEqual(1);
    expect(result.idleIntervalsDeleted).toBeGreaterThanOrEqual(1);
    expect(await ApplicationActivity.findByPk(oldActivity.id)).toBeNull();
    expect(await ApplicationActivity.findByPk(recentActivity.id)).not.toBeNull();
    expect(await ActivityIdleInterval.findByPk(oldIdle.id)).toBeNull();
    expect(await ActivityIdleInterval.findByPk(recentIdle.id)).not.toBeNull();
    expect(await ApplicationClassification.count({ where: { organizationId: orgId } })).toBe(1);
    expect(
      await OrganizationTrackingSettings.findOne({ where: { organizationId: orgId } }),
    ).not.toBeNull();
  });
});
