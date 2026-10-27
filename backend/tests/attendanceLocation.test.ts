import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AttendanceLocationSample,
  AttendanceLocationTracking,
  AuditEvent,
  TimeSession,
} from '../src/database';
import { config } from '../src/config/env';
import { purgeAttendanceLocationHistory } from '../src/modules/attendance/attendanceLocation.service';
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

type MobileTeam = Awaited<ReturnType<typeof createMobileTeam>>;

function agentHeaders(agent: { headers: Record<string, string> }, organizationId: string) {
  return { ...agent.headers, 'x-organization-id': organizationId };
}

async function createMobileTeam() {
  const owner = await createOwner(uniqueEmail('loc-owner'), 'Location Test Org');
  const ownerAuth = await desktopAuth(owner.email);
  const employee = await inviteAndAccept(owner, {
    role: 'EMPLOYEE',
    name: 'Location Employee',
    email: uniqueEmail('loc-employee'),
  });
  const auth = await mobileAuth(employee.email);
  const agent = await registerAgent(auth, owner.organization.id, {
    name: 'Location Phone',
    platform: 'android',
    clientType: 'MOBILE',
  });

  return { owner, ownerAuth, employee, auth, agent, orgId: owner.organization.id };
}

async function addMobileEmployee(
  owner: Awaited<ReturnType<typeof createOwner>>,
  organizationId: string,
  role: 'EMPLOYEE' | 'MANAGER' | 'ADMIN' = 'EMPLOYEE',
) {
  const employee = await inviteAndAccept(owner, {
    role,
    name: `Location ${role}`,
    email: uniqueEmail(`loc-${role.toLowerCase()}`),
  });
  const auth = await mobileAuth(employee.email);
  const agent = await registerAgent(auth, organizationId, {
    name: `${role} Phone`,
    platform: 'android',
    clientType: 'MOBILE',
  });
  return { employee, auth, agent, orgId: organizationId };
}

function createEvidence(team: MobileTeam, body: Record<string, unknown>) {
  return request(app)
    .post(`${API}/organizations/${team.orgId}/attendance/evidence`)
    .set(team.agent.headers)
    .send(body);
}

function uploadEvidence(team: MobileTeam, url: string) {
  return request(app)
    .put(new URL(url).pathname)
    .set(agentHeaders(team.agent, team.orgId))
    .set('content-type', 'image/png')
    .send(PNG);
}

async function prepareEvidence(team: MobileTeam, kind: 'SELFIE' | 'SITE_PHOTO') {
  const created = await createEvidence(team, { kind, contentType: 'image/png' });
  expect(created.status).toBe(201);
  const uploaded = await uploadEvidence(team, created.body.data.upload.url);
  expect(uploaded.status).toBe(201);
  return created.body.data.evidence.id as string;
}

function location(overrides: Record<string, unknown> = {}) {
  return {
    latitude: 28.6139,
    longitude: 77.209,
    accuracyMeters: 20,
    recordedAt: new Date().toISOString(),
    ...overrides,
  };
}

function checkIn(team: MobileTeam, body: Record<string, unknown>) {
  return request(app)
    .post(`${API}/organizations/${team.orgId}/attendance/check-ins`)
    .set(team.agent.headers)
    .send(body);
}

async function startOnSite(team: MobileTeam) {
  const selfieEvidenceId = await prepareEvidence(team, 'SELFIE');
  const response = await checkIn(team, {
    checkInRequestId: randomUUID(),
    workMode: 'ON_SITE',
    selfieEvidenceId,
    location: location(),
  });
  expect(response.status).toBe(201);
  return {
    checkInId: response.body.data.checkIn.id as string,
    sessionId: response.body.data.session.id as string,
    startedAt: new Date(response.body.data.session.startedAt as string),
  };
}

async function startWorkMode(
  team: MobileTeam,
  workMode: 'WFH' | 'WFO',
) {
  const body: Record<string, unknown> = {
    checkInRequestId: randomUUID(),
    workMode,
  };
  if (workMode === 'WFO') body.selfieEvidenceId = await prepareEvidence(team, 'SELFIE');
  else body.location = undefined;
  const response = await checkIn(team, body);
  expect(response.status).toBe(201);
  return {
    checkInId: response.body.data.checkIn.id as string,
    sessionId: response.body.data.session.id as string,
  };
}

function getLocationStatus(team: MobileTeam) {
  return request(app)
    .get(`${API}/organizations/${team.orgId}/attendance/location/status`)
    .set(team.agent.headers);
}

function postLocationStatus(team: MobileTeam, body: Record<string, unknown>) {
  return request(app)
    .post(`${API}/organizations/${team.orgId}/attendance/location/status`)
    .set(team.agent.headers)
    .send(body);
}

function postSamples(team: MobileTeam, body: Record<string, unknown>) {
  return request(app)
    .post(`${API}/organizations/${team.orgId}/attendance/location/samples`)
    .set(team.agent.headers)
    .send(body);
}

function getHistory(
  team: MobileTeam,
  headers: Record<string, string>,
  checkInId: string,
  query = '',
) {
  return request(app)
    .get(
      `${API}/organizations/${team.orgId}/attendance/check-ins/${checkInId}/location-history${query}`,
    )
    .set(headers);
}

function sample(overrides: Record<string, unknown> = {}) {
  return {
    clientSampleId: randomUUID(),
    latitude: 28.6139,
    longitude: 77.209,
    accuracyMeters: 20,
    capturedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('ON_SITE location tracking', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('reconciles ON_SITE tracking and never enables it for WFH or WFO', async () => {
    const team = await createMobileTeam();
    const onSite = await startOnSite(team);

    const initial = await getLocationStatus(team);
    expect(initial.status).toBe(200);
    expect(initial.body.data.shouldTrack).toBe(true);
    expect(initial.body.data.workMode).toBe('ON_SITE');
    expect(initial.body.data.checkIn.id).toBe(onSite.checkInId);
    expect(initial.body.data.session.id).toBe(onSite.sessionId);
    expect(initial.body.data.tracking).toBeNull();
    expect(initial.body.data.locationState.state).toBe('STOPPED');
    expect(initial.body.data.locationState.reason).toBe('NOT_STARTED');

    const reported = await postLocationStatus(team, {
      sessionId: onSite.sessionId,
      state: 'ACTIVE',
      permission: 'ALWAYS',
      backgroundAllowed: true,
    });
    expect(reported.status).toBe(200);
    expect(reported.body.data.tracking.status).toBe('ACTIVE');
    expect(reported.body.data.tracking.backgroundAllowed).toBe(true);
    expect(reported.body.data.locationState.state).toBe('ACTIVE');

    const accepted = await postSamples(team, {
      sessionId: onSite.sessionId,
      samples: [sample()],
    });
    expect(accepted.status).toBe(201);
    expect(accepted.body.data.accepted).toBe(1);

    const reconciled = await getLocationStatus(team);
    expect(reconciled.body.data.tracking.lastSampleAt).not.toBeNull();
    expect(reconciled.body.data.locationState.state).toBe('ACTIVE');
    expect(reconciled.body.data.locationState.backgroundAllowed).toBe(true);

    await resetDatabase();
    const wfhTeam = await createMobileTeam();
    const wfh = await startWorkMode(wfhTeam, 'WFH');

    const wfhStatus = await getLocationStatus(wfhTeam);
    expect(wfhStatus.body.data.shouldTrack).toBe(false);
    expect(wfhStatus.body.data.reason).toBe('WORK_MODE_NOT_ON_SITE');
    expect(wfhStatus.body.data.workMode).toBe('WFH');

    const wfhSamples = await postSamples(wfhTeam, {
      sessionId: wfh.sessionId,
      samples: [sample()],
    });
    expect(wfhSamples.status).toBe(409);
    expect(wfhSamples.body.error.code).toBe('LOCATION_TRACKING_REQUIRES_ON_SITE');

    const wfhReport = await postLocationStatus(wfhTeam, {
      sessionId: wfh.sessionId,
      state: 'ACTIVE',
      permission: 'ALWAYS',
      backgroundAllowed: true,
    });
    expect(wfhReport.status).toBe(409);
    expect(wfhReport.body.error.code).toBe('LOCATION_TRACKING_REQUIRES_ON_SITE');

    await resetDatabase();
    const wfoTeam = await createMobileTeam();
    const wfo = await startWorkMode(wfoTeam, 'WFO');

    const wfoStatus = await getLocationStatus(wfoTeam);
    expect(wfoStatus.body.data.shouldTrack).toBe(false);
    expect(wfoStatus.body.data.reason).toBe('WORK_MODE_NOT_ON_SITE');
    expect(wfoStatus.body.data.workMode).toBe('WFO');

    expect(
      (
        await postSamples(wfoTeam, {
          sessionId: wfo.sessionId,
          samples: [sample()],
        })
      ).status,
    ).toBe(409);
  });

  it('deduplicates, orders, and rejects individual invalid samples without losing the batch', async () => {
    const team = await createMobileTeam();
    const onSite = await startOnSite(team);
    const base = onSite.startedAt.getTime();
    const at = (offsetMs: number) => new Date(base + offsetMs).toISOString();

    const first = sample({ capturedAt: at(1_000) });
    const second = sample({ capturedAt: at(3_000) });
    const third = sample({ capturedAt: at(2_000) });
    const inaccurate = sample({ accuracyMeters: 601, capturedAt: at(4_000) });
    const future = sample({ capturedAt: at(5 * 60_000) });
    const beforeSession = sample({ capturedAt: at(-2 * 60_000) });
    const duplicateInRequest = { ...first };

    const body = {
      sessionId: onSite.sessionId,
      samples: [first, second, third, inaccurate, future, beforeSession, duplicateInRequest],
    };
    const response = await postSamples(team, body);
    expect(response.status).toBe(201);
    expect(response.body.data.accepted).toBe(3);
    expect(response.body.data.rejected).toBe(3);
    expect(response.body.data.duplicates).toBe(1);
    expect(response.body.data.results.map((result: { code?: string }) => result.code)).toEqual([
      undefined,
      undefined,
      undefined,
      'ACCURACY_TOO_LOW',
      'SAMPLE_IN_FUTURE',
      'SAMPLE_BEFORE_SESSION',
      'DUPLICATE_IN_REQUEST',
    ]);

    const replay = await postSamples(team, body);
    expect(replay.status).toBe(201);
    expect(replay.body.data.accepted).toBe(0);
    expect(replay.body.data.duplicates).toBe(4);
    expect(replay.body.data.results[0].code).toBe('ALREADY_RECORDED');
    expect(replay.body.data.results[3].code).toBe('ACCURACY_TOO_LOW');
    expect(await AttendanceLocationSample.count()).toBe(3);

    const invalidCoordinates = await postSamples(team, {
      sessionId: onSite.sessionId,
      samples: [sample({ latitude: 200 })],
    });
    expect(invalidCoordinates.status).toBe(422);
    expect(invalidCoordinates.body.error.code).toBe('VALIDATION_ERROR');

    const tooMany = await postSamples(team, {
      sessionId: onSite.sessionId,
      samples: Array.from({ length: config.attendance.trackingMaxSamplesPerRequest + 1 }, () =>
        sample(),
      ),
    });
    expect(tooMany.status).toBe(422);
    expect(tooMany.body.error.code).toBe('VALIDATION_ERROR');

    const history = await getHistory(team, team.ownerAuth.headers, onSite.checkInId);
    expect(history.status).toBe(200);
    expect(history.body.data.samples).toHaveLength(3);
    expect(history.body.data.totalSamples).toBe(3);
    expect(history.body.data.truncated).toBe(false);
    const captured = history.body.data.samples.map((row: { capturedAt: string }) =>
      Date.parse(row.capturedAt),
    );
    expect(captured).toEqual([...captured].sort((a, b) => a - b));
    expect(history.body.data.checkIn.location.latitude).toBeCloseTo(28.6139);
    expect(history.body.data.session.breaks).toEqual([]);
    expect(history.body.data.retention.days).toBe(config.attendance.locationRetentionDays);
    expect(JSON.stringify(history.body)).not.toContain('storageKey');
  });

  it('pauses for breaks, rejects break samples, and stops on checkout', async () => {
    const team = await createMobileTeam();
    const onSite = await startOnSite(team);

    const breakStart = await request(app)
      .post(`${API}/organizations/${team.orgId}/time-sessions/${onSite.sessionId}/breaks`)
      .set(team.agent.headers)
      .send({});
    expect(breakStart.status).toBe(201);
    const breakStartedAt = new Date(breakStart.body.data.session.activeBreak.startedAt as string);

    const paused = await getLocationStatus(team);
    expect(paused.body.data.shouldTrack).toBe(false);
    expect(paused.body.data.reason).toBe('BREAK');
    expect(paused.body.data.locationState.state).toBe('PAUSED');
    expect(paused.body.data.locationState.reason).toBe('BREAK');

    const racingReport = await postLocationStatus(team, {
      sessionId: onSite.sessionId,
      state: 'ACTIVE',
      permission: 'ALWAYS',
      backgroundAllowed: true,
    });
    expect(racingReport.status).toBe(200);
    expect(racingReport.body.data.tracking.status).toBe('PAUSED');
    expect(racingReport.body.data.locationState.state).toBe('PAUSED');

    const duringBreak = await postSamples(team, {
      sessionId: onSite.sessionId,
      samples: [
        sample({ capturedAt: new Date(breakStartedAt.getTime() + 1_000).toISOString() }),
        sample({ capturedAt: new Date(onSite.startedAt.getTime() + 1).toISOString() }),
      ],
    });
    expect(duringBreak.status).toBe(201);
    expect(duringBreak.body.data.accepted).toBe(1);
    expect(duringBreak.body.data.rejected).toBe(1);
    expect(duringBreak.body.data.results[0].code).toBe('SAMPLE_DURING_BREAK');
    expect(duringBreak.body.data.results[1].status).toBe('ACCEPTED');

    const breakEnd = await request(app)
      .post(`${API}/organizations/${team.orgId}/time-sessions/${onSite.sessionId}/breaks/end`)
      .set(team.agent.headers)
      .send({});
    expect(breakEnd.status).toBe(200);

    const resumed = await postLocationStatus(team, {
      sessionId: onSite.sessionId,
      state: 'ACTIVE',
      permission: 'ALWAYS',
      backgroundAllowed: true,
    });
    expect(resumed.body.data.locationState.state).toBe('ACTIVE');

    const afterBreak = await getLocationStatus(team);
    expect(afterBreak.body.data.shouldTrack).toBe(true);
    expect(afterBreak.body.data.reason).toBeNull();

    const stop = await request(app)
      .post(`${API}/organizations/${team.orgId}/time-sessions/${onSite.sessionId}/stop`)
      .set(team.agent.headers)
      .send({});
    expect(stop.status).toBe(200);

    const stoppedStatus = await getLocationStatus(team);
    expect(stoppedStatus.status).toBe(200);
    expect(stoppedStatus.body.data.shouldTrack).toBe(false);
    expect(stoppedStatus.body.data.reason).toBe('NO_ACTIVE_SESSION');
    expect(stoppedStatus.body.data.session).toBeNull();

    const late = await postSamples(team, {
      sessionId: onSite.sessionId,
      samples: [sample()],
    });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('SESSION_NOT_ACTIVE');

    const lateActive = await postLocationStatus(team, {
      sessionId: onSite.sessionId,
      state: 'ACTIVE',
      permission: 'ALWAYS',
      backgroundAllowed: true,
    });
    expect(lateActive.status).toBe(409);
    expect(lateActive.body.error.code).toBe('SESSION_NOT_ACTIVE');

    const finalStop = await postLocationStatus(team, {
      sessionId: onSite.sessionId,
      state: 'STOPPED',
      permission: 'ALWAYS',
      backgroundAllowed: true,
    });
    expect(finalStop.status).toBe(200);
    expect(finalStop.body.data.tracking.status).toBe('STOPPED');
    expect(finalStop.body.data.locationState.state).toBe('STOPPED');

    const history = await getHistory(team, team.ownerAuth.headers, onSite.checkInId);
    expect(history.body.data.locationState.state).toBe('STOPPED');
    expect(history.body.data.locationState.reason).toBe('SESSION_ENDED');
    expect(history.body.data.session.status).toBe('STOPPED');
    expect(history.body.data.session.breaks).toHaveLength(1);
    expect(history.body.data.session.breaks[0].endedAt).not.toBeNull();
  });

  it('rejects stale sessions, revoked devices, and cross-device samples', async () => {
    const team = await createMobileTeam();
    const onSite = await startOnSite(team);

    await TimeSession.update(
      { lastHeartbeatAt: new Date(Date.now() - (config.timeTracking.sessionStaleSeconds + 60) * 1000) },
      { where: { id: onSite.sessionId } },
    );

    const stale = await postSamples(team, {
      sessionId: onSite.sessionId,
      samples: [sample()],
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('SESSION_STALE');

    const reconciliation = await getLocationStatus(team);
    expect(reconciliation.body.data.shouldTrack).toBe(false);
    expect(reconciliation.body.data.reason).toBe('NO_ACTIVE_SESSION');
    const closed = await TimeSession.findByPk(onSite.sessionId);
    expect(closed?.status).toBe('STOPPED');

    await resetDatabase();
    const revokedTeam = await createMobileTeam();
    const revokedSession = await startOnSite(revokedTeam);

    const revoke = await request(app)
      .delete(`${API}/organizations/${revokedTeam.orgId}/desktop-agents/${revokedTeam.agent.id}`)
      .set(revokedTeam.ownerAuth.headers);
    expect(revoke.status).toBe(200);

    const afterRevoke = await postSamples(revokedTeam, {
      sessionId: revokedSession.sessionId,
      samples: [sample()],
    });
    expect([401, 403]).toContain(afterRevoke.status);
    expect(await AttendanceLocationSample.count()).toBe(0);

    await resetDatabase();
    const crossTeam = await createMobileTeam();
    const crossSession = await startOnSite(crossTeam);
    const other = await addMobileEmployee(crossTeam.owner, crossTeam.orgId);
    const crossDevice = await postSamples(
      { ...crossTeam, agent: other.agent, auth: other.auth, employee: other.employee },
      { sessionId: crossSession.sessionId, samples: [sample()] },
    );
    expect(crossDevice.status).toBe(404);
    expect(crossDevice.body.error.code).toBe('SESSION_NOT_FOUND');
    expect(await AttendanceLocationSample.count()).toBe(0);
  });

  it('reports permission limitations and stale tracking honestly', async () => {
    const team = await createMobileTeam();
    const onSite = await startOnSite(team);

    const foregroundOnly = await postLocationStatus(team, {
      sessionId: onSite.sessionId,
      state: 'ACTIVE',
      permission: 'FOREGROUND_ONLY',
      backgroundAllowed: false,
    });
    expect(foregroundOnly.body.data.locationState.state).toBe('ACTIVE');
    expect(foregroundOnly.body.data.locationState.permission).toBe('FOREGROUND_ONLY');
    expect(foregroundOnly.body.data.locationState.backgroundAllowed).toBe(false);

    const denied = await postLocationStatus(team, {
      sessionId: onSite.sessionId,
      state: 'ACTIVE',
      permission: 'DENIED',
      backgroundAllowed: false,
    });
    expect(denied.body.data.tracking.status).toBe('STOPPED');
    expect(denied.body.data.tracking.reason).toBe('PERMISSION_DENIED');
    expect(denied.body.data.locationState.state).toBe('PERMISSION_UNAVAILABLE');

    const permissionReason = await postLocationStatus(team, {
      sessionId: onSite.sessionId,
      state: 'STOPPED',
      reason: 'OS_RESTRICTED',
      permission: 'ALWAYS',
      backgroundAllowed: true,
    });
    expect(permissionReason.body.data.tracking.status).toBe('STOPPED');
    expect(permissionReason.body.data.locationState.state).toBe('STOPPED');
    expect(permissionReason.body.data.locationState.reason).toBe('OS_RESTRICTED');

    await postSamples(team, { sessionId: onSite.sessionId, samples: [sample()] });
    await AttendanceLocationTracking.update(
      {
        status: 'ACTIVE',
        reason: null,
        permission: 'ALWAYS',
        backgroundAllowed: true,
        lastSampleAt: new Date(Date.now() - 10 * 60_000),
        lastReportedAt: new Date(Date.now() - 10 * 60_000),
      },
      { where: { timeSessionId: onSite.sessionId } },
    );
    const stale = await getLocationStatus(team);
    expect(stale.body.data.shouldTrack).toBe(true);
    expect(stale.body.data.locationState.state).toBe('STALE');
    expect(stale.body.data.locationState.staleAfterSeconds).toBe(
      config.attendance.trackingStaleSeconds,
    );

    const history = await getHistory(team, team.ownerAuth.headers, onSite.checkInId);
    expect(history.body.data.locationState.state).toBe('STALE');
    expect(history.body.data.tracking.permission).toBe('ALWAYS');
  });
});

describe('attendance location history access and retention', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('allows self and explicitly authorized roles, and audits non-self access', async () => {
    const team = await createMobileTeam();
    const onSite = await startOnSite(team);
    await postSamples(team, {
      sessionId: onSite.sessionId,
      samples: [
        sample({ capturedAt: new Date(onSite.startedAt.getTime() + 1_000).toISOString() }),
        sample({ capturedAt: new Date(onSite.startedAt.getTime() + 2_000).toISOString() }),
        sample({ capturedAt: new Date(onSite.startedAt.getTime() + 3_000).toISOString() }),
      ],
    });

    const self = await getHistory(team, team.auth.headers, onSite.checkInId);
    expect(self.status).toBe(200);
    expect(self.body.data.samples).toHaveLength(3);
    expect(await AuditEvent.count({ where: { action: 'ATTENDANCE_LOCATION_HISTORY_VIEWED' } })).toBe(
      0,
    );

    const owner = await getHistory(team, team.ownerAuth.headers, onSite.checkInId, '?limit=2');
    expect(owner.status).toBe(200);
    expect(owner.body.data.samples).toHaveLength(2);
    expect(owner.body.data.totalSamples).toBe(3);
    expect(owner.body.data.truncated).toBe(true);
    const audit = await AuditEvent.findOne({
      where: { action: 'ATTENDANCE_LOCATION_HISTORY_VIEWED' },
    });
    expect(audit?.actorUserId).toBe(team.owner.user.id);
    expect(audit?.targetEmployeeId).toBe(team.employee.user.id);
    expect(audit?.metadata).toMatchObject({ returnedSamples: 2, totalSamples: 3, truncated: true });
    expect(JSON.stringify(audit?.metadata)).not.toContain('latitude');

    const admin = await addMobileEmployee(team.owner, team.orgId, 'ADMIN');
    const adminAuth = await desktopAuth(admin.employee.email);
    const adminHistory = await getHistory(team, adminAuth.headers, onSite.checkInId);
    expect(adminHistory.status).toBe(200);

    const manager = await addMobileEmployee(team.owner, team.orgId, 'MANAGER');
    const managerAuth = await desktopAuth(manager.employee.email);
    const managerHistory = await getHistory(team, managerAuth.headers, onSite.checkInId);
    expect(managerHistory.status).toBe(403);
    expect(managerHistory.body.error.code).toBe('PERMISSION_DENIED');

    // Self-access is preserved for every role, including managers who cannot
    // view another employee's history without the dedicated permission.
    const managerTeam: MobileTeam = {
      ...team,
      employee: manager.employee,
      auth: manager.auth,
      agent: manager.agent,
    };
    const managerCheckIn = await startOnSite(managerTeam);
    const managerSelf = await getHistory(managerTeam, managerAuth.headers, managerCheckIn.checkInId);
    expect(managerSelf.status).toBe(200);
    expect(managerSelf.body.data.checkIn.employeeId).toBe(manager.employee.user.id);

    const otherEmployee = await addMobileEmployee(team.owner, team.orgId);
    const otherHistory = await getHistory(team, otherEmployee.auth.headers, onSite.checkInId);
    expect(otherHistory.status).toBe(404);
    expect(otherHistory.body.error.code).toBe('ATTENDANCE_CHECK_IN_NOT_FOUND');

    const otherOwner = await createOwner(uniqueEmail('loc-other-owner'), 'Other Location Org');
    const otherOwnerAuth = await desktopAuth(otherOwner.email);
    const crossTenant = await getHistory(team, otherOwnerAuth.headers, onSite.checkInId);
    expect(crossTenant.status).toBe(404);
    expect(crossTenant.body.error.code).toBe('ORGANIZATION_NOT_FOUND');

    const missing = await getHistory(team, team.ownerAuth.headers, randomUUID());
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('ATTENDANCE_CHECK_IN_NOT_FOUND');

    const invalidLimit = await getHistory(team, team.ownerAuth.headers, onSite.checkInId, '?limit=5000');
    expect(invalidLimit.status).toBe(422);

    const wfhTeam = await createMobileTeam();
    const wfh = await startWorkMode(wfhTeam, 'WFH');
    const wfhHistory = await getHistory(wfhTeam, wfhTeam.ownerAuth.headers, wfh.checkInId);
    expect(wfhHistory.status).toBe(422);
    expect(wfhHistory.body.error.code).toBe('LOCATION_HISTORY_NOT_AVAILABLE');
  });

  it('purges samples and tracking rows after the retention window', async () => {
    const team = await createMobileTeam();
    const onSite = await startOnSite(team);
    await postSamples(team, {
      sessionId: onSite.sessionId,
      samples: [sample(), sample()],
    });

    const rows = await AttendanceLocationSample.findAll({
      order: [['createdAt', 'ASC']],
    });
    const old = rows[0];
    await old.update({ capturedAt: new Date(Date.now() - 31 * 86_400_000) });
    expect(await AttendanceLocationTracking.count()).toBe(1);

    await TimeSession.update(
      {
        status: 'STOPPED',
        endedAt: new Date(Date.now() - 31 * 86_400_000),
      },
      { where: { id: onSite.sessionId } },
    );

    const summary = await purgeAttendanceLocationHistory();
    expect(summary.samplesDeleted).toBe(1);
    expect(summary.trackingDeleted).toBe(1);
    expect(await AttendanceLocationSample.count()).toBe(1);
    expect(await AttendanceLocationTracking.count()).toBe(0);
  });
});
