import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AttendanceCheckIn,
  AttendanceEvidence,
  AuditEvent,
  TimeSession,
} from '../src/database';
import { screenshotStorage } from '../src/modules/screenshots/storage';
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
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(32, 0x22),
]);

function agentHeaders(agent: { headers: Record<string, string> }, organizationId: string) {
  return { ...agent.headers, 'x-organization-id': organizationId };
}

async function createMobileTeam() {
  const owner = await createOwner(uniqueEmail('att-owner'), 'Attendance Test Org');
  const ownerAuth = await desktopAuth(owner.email);
  const employee = await inviteAndAccept(owner, {
    role: 'EMPLOYEE',
    name: 'Attendance Employee',
    email: uniqueEmail('att-employee'),
  });
  const auth = await mobileAuth(employee.email);
  const agent = await registerAgent(auth, owner.organization.id, {
    name: 'Attendance Phone',
    platform: 'android',
    clientType: 'MOBILE',
  });

  return {
    owner,
    ownerAuth,
    employee,
    auth,
    agent,
    orgId: owner.organization.id,
  };
}

async function addEmployee(
  owner: Awaited<ReturnType<typeof createOwner>>,
  organizationId: string,
) {
  const employee = await inviteAndAccept(owner, {
    role: 'EMPLOYEE',
    name: 'Second Mobile Employee',
    email: uniqueEmail('att-second'),
  });
  const auth = await mobileAuth(employee.email);
  const agent = await registerAgent(auth, organizationId, {
    name: 'Second Phone',
    platform: 'android',
    clientType: 'MOBILE',
  });
  return { employee, auth, agent, orgId: organizationId };
}

function createEvidence(
  team: { orgId: string; agent: { headers: Record<string, string> } },
  body: Record<string, unknown>,
) {
  return request(app)
    .post(`${API}/organizations/${team.orgId}/attendance/evidence`)
    .set(team.agent.headers)
    .send(body);
}

function uploadEvidence(
  team: { orgId: string; agent: { headers: Record<string, string> } },
  url: string,
  body: Buffer = PNG,
  contentType = 'image/png',
) {
  return request(app)
    .put(new URL(url).pathname)
    .set(agentHeaders(team.agent, team.orgId))
    .set('content-type', contentType)
    .send(body);
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

function currentCheckIn(team: { orgId: string; auth: { headers: Record<string, string> } }) {
  return request(app)
    .get(`${API}/organizations/${team.orgId}/attendance/check-ins/current`)
    .set(team.auth.headers);
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

async function prepareEvidence(
  team: { orgId: string; agent: { headers: Record<string, string> } },
  kind: 'SELFIE' | 'SITE_PHOTO',
  contentType = 'image/png',
  body: Buffer = PNG,
): Promise<{ evidenceId: string; uploadUrl: string }> {
  const created = await createEvidence(team, { kind, contentType });
  expect(created.status).toBe(201);
  const uploadUrl = created.body.data.upload.url as string;
  const evidenceId = created.body.data.evidence.id as string;

  const uploaded = await uploadEvidence(team, uploadUrl, body, contentType);
  expect(uploaded.status).toBe(201);
  return { evidenceId, uploadUrl };
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

describe('mobile attendance check-in', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('checks in with WFH, replays the same request, and refuses a second active session', async () => {
    const team = await createMobileTeam();
    const checkInRequestId = randomUUID();
    const before = Date.now();

    const response = await checkIn(team, { checkInRequestId, workMode: 'WFH' });
    expect(response.status).toBe(201);
    expect(response.body.data.replayed).toBe(false);
    expect(response.body.data.autoClosedSessionId).toBeNull();

    const summary = response.body.data.checkIn;
    expect(summary.workMode).toBe('WFH');
    expect(summary.selfie).toBeNull();
    expect(summary.sitePhoto).toBeNull();
    expect(summary.location).toBeNull();
    expect(summary.checkInRequestId).toBe(checkInRequestId);
    expect(summary.sessionId).toBe(response.body.data.session.id);

    const session = response.body.data.session;
    expect(session.status).toBe('ACTIVE');
    expect(session.source).toBe('ONLINE');
    expect(Date.parse(session.startedAt)).toBeGreaterThanOrEqual(before - 1_000);
    expect(Date.parse(session.startedAt)).toBeLessThanOrEqual(Date.now() + 1_000);

    const replay = await checkIn(team, { checkInRequestId, workMode: 'WFH' });
    expect(replay.status).toBe(200);
    expect(replay.body.data.replayed).toBe(true);
    expect(replay.body.data.checkIn.id).toBe(summary.id);
    expect(replay.body.data.session.id).toBe(session.id);

    const differentRequest = await checkIn(team, {
      checkInRequestId: randomUUID(),
      workMode: 'WFH',
    });
    expect(differentRequest.status).toBe(409);
    expect(differentRequest.body.error.code).toBe('ACTIVE_SESSION_EXISTS');

    const reusedWithDifferentPayload = await checkIn(team, {
      checkInRequestId,
      workMode: 'WFH',
      location: location(),
    });
    expect(reusedWithDifferentPayload.status).toBe(409);
    expect(reusedWithDifferentPayload.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');

    expect(await TimeSession.count()).toBe(1);
    expect(await AttendanceCheckIn.count()).toBe(1);
    expect(
      await AuditEvent.count({ where: { action: 'ATTENDANCE_CHECKED_IN' } }),
    ).toBe(1);

    const current = await currentCheckIn(team);
    expect(current.status).toBe(200);
    expect(current.body.data.checkIn.id).toBe(summary.id);
    expect(current.body.data.session.id).toBe(session.id);
    expect(JSON.stringify(current.body)).not.toContain('storageKey');
  });

  it('restores the check-in after an app restart and supports break, resume, and checkout', async () => {
    const team = await createMobileTeam();
    const response = await checkIn(team, {
      checkInRequestId: randomUUID(),
      workMode: 'WFH',
    });
    expect(response.status).toBe(201);
    const checkInId = response.body.data.checkIn.id as string;
    const sessionId = response.body.data.session.id as string;

    const restartedAuth = await mobileAuth(team.employee.email);
    const restored = await currentCheckIn({ orgId: team.orgId, auth: restartedAuth });
    expect(restored.status).toBe(200);
    expect(restored.body.data.checkIn.id).toBe(checkInId);
    expect(restored.body.data.session.id).toBe(sessionId);
    expect(restored.body.data.session.status).toBe('ACTIVE');

    const breakStart = await request(app)
      .post(`${API}/organizations/${team.orgId}/time-sessions/${sessionId}/breaks`)
      .set(team.agent.headers)
      .send({});
    expect(breakStart.status).toBe(201);
    expect(breakStart.body.data.session.status).toBe('ON_BREAK');

    const duringBreak = await currentCheckIn({ orgId: team.orgId, auth: restartedAuth });
    expect(duringBreak.body.data.session.status).toBe('ON_BREAK');
    expect(duringBreak.body.data.checkIn.id).toBe(checkInId);

    const breakEnd = await request(app)
      .post(`${API}/organizations/${team.orgId}/time-sessions/${sessionId}/breaks/end`)
      .set(team.agent.headers)
      .send({});
    expect(breakEnd.status).toBe(200);
    expect(breakEnd.body.data.session.status).toBe('ACTIVE');

    const stop = await stopSession(team, sessionId);
    expect(stop.status).toBe(200);
    expect(stop.body.data.session.status).toBe('STOPPED');

    const afterStop = await currentCheckIn({ orgId: team.orgId, auth: restartedAuth });
    expect(afterStop.body.data).toEqual({ checkIn: null, session: null });
    expect(await TimeSession.count()).toBe(1);
  });

  it('requires a selfie for WFO and never accepts or persists a location', async () => {
    const team = await createMobileTeam();

    const missing = await checkIn(team, { checkInRequestId: randomUUID(), workMode: 'WFO' });
    expect(missing.status).toBe(422);
    expect(missing.body.error.code).toBe('VALIDATION_ERROR');

    const { evidenceId } = await prepareEvidence(team, 'SELFIE');

    const withLocation = await checkIn(team, {
      checkInRequestId: randomUUID(),
      workMode: 'WFO',
      selfieEvidenceId: evidenceId,
      location: location(),
    });
    expect(withLocation.status).toBe(422);
    expect(withLocation.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(withLocation.body)).toContain('does not accept a location');
    expect(await TimeSession.count()).toBe(0);
    expect((await AttendanceEvidence.findByPk(evidenceId))?.status).toBe('UPLOADED');

    const wfoRequestId = randomUUID();
    const response = await checkIn(team, {
      checkInRequestId: wfoRequestId,
      workMode: 'WFO',
      selfieEvidenceId: evidenceId,
    });
    expect(response.status).toBe(201);
    expect(response.body.data.checkIn.selfie.id).toBe(evidenceId);
    expect(response.body.data.checkIn.selfie.status).toBe('ATTACHED');
    expect(response.body.data.checkIn.sitePhoto).toBeNull();
    expect(response.body.data.checkIn.location).toBeNull();
    expect(JSON.stringify(response.body)).not.toContain('storageKey');

    const storedEvidence = await AttendanceEvidence.findByPk(evidenceId);
    expect(storedEvidence?.status).toBe('ATTACHED');
    expect(storedEvidence?.attachedSessionId).toBe(response.body.data.session.id);

    const stored = await AttendanceCheckIn.findByPk(response.body.data.checkIn.id);
    expect(stored?.latitude).toBeNull();
    expect(stored?.longitude).toBeNull();
    expect(stored?.accuracyMeters).toBeNull();
    expect(stored?.locationRecordedAt).toBeNull();

    const replay = await checkIn(team, {
      checkInRequestId: wfoRequestId,
      workMode: 'WFO',
      selfieEvidenceId: evidenceId,
    });
    expect(replay.status).toBe(200);
    expect(replay.body.data.replayed).toBe(true);
    expect(replay.body.data.checkIn.id).toBe(response.body.data.checkIn.id);

    const sessionId = response.body.data.session.id as string;
    expect((await stopSession(team, sessionId)).status).toBe(200);

    const reuse = await checkIn(team, {
      checkInRequestId: randomUUID(),
      workMode: 'WFO',
      selfieEvidenceId: evidenceId,
    });
    expect(reuse.status).toBe(409);
    expect(reuse.body.error.code).toBe('ATTENDANCE_EVIDENCE_ALREADY_ATTACHED');
    expect(await TimeSession.count()).toBe(1);

    const currentAfterStop = await currentCheckIn(team);
    expect(currentAfterStop.body.data).toEqual({ checkIn: null, session: null });
  });

  it('enforces ON_SITE evidence, location presence, and location freshness', async () => {
    const team = await createMobileTeam();

    const empty = await checkIn(team, { checkInRequestId: randomUUID(), workMode: 'ON_SITE' });
    expect(empty.status).toBe(422);
    expect(empty.body.error.code).toBe('VALIDATION_ERROR');

    const selfie = await prepareEvidence(team, 'SELFIE');
    const site = await prepareEvidence(team, 'SITE_PHOTO');

    const missingSite = await checkIn(team, {
      checkInRequestId: randomUUID(),
      workMode: 'ON_SITE',
      selfieEvidenceId: selfie.evidenceId,
      location: location(),
    });
    expect(missingSite.status).toBe(422);
    expect(JSON.stringify(missingSite.body)).toContain('requires a site photo');

    const missingSelfie = await checkIn(team, {
      checkInRequestId: randomUUID(),
      workMode: 'ON_SITE',
      sitePhotoEvidenceId: site.evidenceId,
      location: location(),
    });
    expect(missingSelfie.status).toBe(422);
    expect(JSON.stringify(missingSelfie.body)).toContain('requires a selfie');

    const missingLocation = await checkIn(team, {
      checkInRequestId: randomUUID(),
      workMode: 'ON_SITE',
      selfieEvidenceId: selfie.evidenceId,
      sitePhotoEvidenceId: site.evidenceId,
    });
    expect(missingLocation.status).toBe(422);
    expect(JSON.stringify(missingLocation.body)).toContain('requires a location');

    const inaccurate = await checkIn(team, {
      checkInRequestId: randomUUID(),
      workMode: 'ON_SITE',
      selfieEvidenceId: selfie.evidenceId,
      sitePhotoEvidenceId: site.evidenceId,
      location: location({ accuracyMeters: 600 }),
    });
    expect(inaccurate.status).toBe(422);
    expect(inaccurate.body.error.code).toBe('LOCATION_ACCURACY_TOO_LOW');

    const stale = await checkIn(team, {
      checkInRequestId: randomUUID(),
      workMode: 'ON_SITE',
      selfieEvidenceId: selfie.evidenceId,
      sitePhotoEvidenceId: site.evidenceId,
      location: location({ recordedAt: new Date(Date.now() - 10 * 60_000).toISOString() }),
    });
    expect(stale.status).toBe(422);
    expect(stale.body.error.code).toBe('LOCATION_FIX_TOO_OLD');

    const future = await checkIn(team, {
      checkInRequestId: randomUUID(),
      workMode: 'ON_SITE',
      selfieEvidenceId: selfie.evidenceId,
      sitePhotoEvidenceId: site.evidenceId,
      location: location({ recordedAt: new Date(Date.now() + 5 * 60_000).toISOString() }),
    });
    expect(future.status).toBe(422);
    expect(future.body.error.code).toBe('LOCATION_FIX_IN_FUTURE');

    expect(await TimeSession.count()).toBe(0);
    expect((await AttendanceEvidence.findByPk(selfie.evidenceId))?.status).toBe('UPLOADED');
    expect((await AttendanceEvidence.findByPk(site.evidenceId))?.status).toBe('UPLOADED');

    const response = await checkIn(team, {
      checkInRequestId: randomUUID(),
      workMode: 'ON_SITE',
      selfieEvidenceId: selfie.evidenceId,
      sitePhotoEvidenceId: site.evidenceId,
      location: location(),
    });
    expect(response.status).toBe(201);
    expect(response.body.data.checkIn.location.accuracyMeters).toBe(20);
    expect(response.body.data.checkIn.selfie.id).toBe(selfie.evidenceId);
    expect(response.body.data.checkIn.sitePhoto.id).toBe(site.evidenceId);
  });

  it('requires distinct selfie and site photos for ON_SITE and rejects wrong evidence kinds', async () => {
    const team = await createMobileTeam();
    const selfie = await prepareEvidence(team, 'SELFIE');
    const site = await prepareEvidence(team, 'SITE_PHOTO');

    const duplicated = await checkIn(team, {
      checkInRequestId: randomUUID(),
      workMode: 'ON_SITE',
      selfieEvidenceId: selfie.evidenceId,
      sitePhotoEvidenceId: selfie.evidenceId,
      location: location(),
    });
    expect(duplicated.status).toBe(422);
    expect(duplicated.body.error.code).toBe('VALIDATION_ERROR');

    const swapped = await checkIn(team, {
      checkInRequestId: randomUUID(),
      workMode: 'ON_SITE',
      selfieEvidenceId: site.evidenceId,
      sitePhotoEvidenceId: selfie.evidenceId,
      location: location(),
    });
    expect(swapped.status).toBe(422);
    expect(swapped.body.error.code).toBe('ATTENDANCE_EVIDENCE_KIND_MISMATCH');

    const response = await checkIn(team, {
      checkInRequestId: randomUUID(),
      workMode: 'ON_SITE',
      selfieEvidenceId: selfie.evidenceId,
      sitePhotoEvidenceId: site.evidenceId,
      location: location(),
    });
    expect(response.status).toBe(201);
    expect(response.body.data.checkIn.selfie.id).toBe(selfie.evidenceId);
    expect(response.body.data.checkIn.sitePhoto.id).toBe(site.evidenceId);
    expect(response.body.data.checkIn.selfie.id).not.toBe(
      response.body.data.checkIn.sitePhoto.id,
    );

    const [selfieRow, siteRow] = await Promise.all([
      AttendanceEvidence.findByPk(selfie.evidenceId),
      AttendanceEvidence.findByPk(site.evidenceId),
    ]);
    expect(selfieRow?.status).toBe('ATTACHED');
    expect(siteRow?.status).toBe('ATTACHED');
    expect(selfieRow?.attachedSessionId).toBe(response.body.data.session.id);
    expect(siteRow?.attachedSessionId).toBe(response.body.data.session.id);
  });

  it('serializes concurrent retries and prevents duplicate sessions across request ids', async () => {
    const sameKeyTeam = await createMobileTeam();
    const requestId = randomUUID();
    const responses = await Promise.all([
      checkIn(sameKeyTeam, { checkInRequestId: requestId, workMode: 'WFH' }),
      checkIn(sameKeyTeam, { checkInRequestId: requestId, workMode: 'WFH' }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    expect(responses[0].body.data.checkIn.id).toBe(responses[1].body.data.checkIn.id);
    expect(await TimeSession.count()).toBe(1);
    expect(await AttendanceCheckIn.count()).toBe(1);

    await resetDatabase();

    const differentKeyTeam = await createMobileTeam();
    const concurrent = await Promise.all([
      checkIn(differentKeyTeam, { checkInRequestId: randomUUID(), workMode: 'WFH' }),
      checkIn(differentKeyTeam, { checkInRequestId: randomUUID(), workMode: 'WFH' }),
    ]);
    expect(concurrent.map((response) => response.status).sort()).toEqual([201, 409]);
    const rejected = concurrent.find((response) => response.status === 409)!;
    expect(rejected.body.error.code).toBe('ACTIVE_SESSION_EXISTS');
    expect(await TimeSession.count()).toBe(1);
    expect(await AttendanceCheckIn.count()).toBe(1);
  });

  it('allows a new check-in after checkout and keeps WFO evidence reusable only on failure', async () => {
    const team = await createMobileTeam();
    const wfh = await checkIn(team, { checkInRequestId: randomUUID(), workMode: 'WFH' });
    expect(wfh.status).toBe(201);
    const firstSessionId = wfh.body.data.session.id as string;
    expect((await stopSession(team, firstSessionId)).status).toBe(200);

    const selfie = await prepareEvidence(team, 'SELFIE');
    const wfo = await checkIn(team, {
      checkInRequestId: randomUUID(),
      workMode: 'WFO',
      selfieEvidenceId: selfie.evidenceId,
    });
    expect(wfo.status).toBe(201);
    expect(wfo.body.data.session.id).not.toBe(firstSessionId);
    expect(await TimeSession.count()).toBe(2);
    expect(await AttendanceCheckIn.count()).toBe(2);
  });

  it('rejects expired evidence, missing storage objects, and mismatched stored bytes', async () => {
    const team = await createMobileTeam();
    const expired = await prepareEvidence(team, 'SELFIE');
    await AttendanceEvidence.update(
      { expiresAt: new Date(Date.now() - 1_000) },
      { where: { id: expired.evidenceId } },
    );
    const expiredResponse = await checkIn(team, {
      checkInRequestId: randomUUID(),
      workMode: 'WFO',
      selfieEvidenceId: expired.evidenceId,
    });
    expect(expiredResponse.status).toBe(410);
    expect(expiredResponse.body.error.code).toBe('ATTENDANCE_EVIDENCE_EXPIRED');
    expect(await TimeSession.count()).toBe(0);

    const missing = await prepareEvidence(team, 'SELFIE');
    const missingRow = await AttendanceEvidence.findByPk(missing.evidenceId);
    await screenshotStorage.deleteObject(missingRow!.storageKey);
    const missingResponse = await checkIn(team, {
      checkInRequestId: randomUUID(),
      workMode: 'WFO',
      selfieEvidenceId: missing.evidenceId,
    });
    expect(missingResponse.status).toBe(409);
    expect(missingResponse.body.error.code).toBe('ATTENDANCE_EVIDENCE_STORAGE_MISSING');
    expect((await AttendanceEvidence.findByPk(missing.evidenceId))?.status).toBe('UPLOADED');
    expect(await TimeSession.count()).toBe(0);

    const mismatched = await prepareEvidence(team, 'SELFIE');
    const mismatchedRow = await AttendanceEvidence.findByPk(mismatched.evidenceId);
    await screenshotStorage.putObject({
      objectKey: mismatchedRow!.storageKey,
      body: Buffer.concat([PNG, Buffer.alloc(10, 0x55)]),
      contentType: 'image/png',
    });
    const mismatchedResponse = await checkIn(team, {
      checkInRequestId: randomUUID(),
      workMode: 'WFO',
      selfieEvidenceId: mismatched.evidenceId,
    });
    expect(mismatchedResponse.status).toBe(409);
    expect(mismatchedResponse.body.error.code).toBe('ATTENDANCE_EVIDENCE_STORAGE_MISMATCH');
    expect(await TimeSession.count()).toBe(0);
  });
});

describe('attendance evidence uploads and access', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('validates type, signature, size, expiry, and reauthorizes uploads', async () => {
    const team = await createMobileTeam();

    const unsupported = await createEvidence(team, { kind: 'SELFIE', contentType: 'text/plain' });
    expect(unsupported.status).toBe(415);
    expect(unsupported.body.error.code).toBe('UNSUPPORTED_ATTENDANCE_EVIDENCE_TYPE');

    const futureCapture = await createEvidence(team, {
      kind: 'SELFIE',
      contentType: 'image/png',
      capturedAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
    expect(futureCapture.status).toBe(422);
    expect(futureCapture.body.error.code).toBe('EVIDENCE_CAPTURED_AT_IN_FUTURE');

    const created = await createEvidence(team, { kind: 'SELFIE', contentType: 'image/png' });
    expect(created.status).toBe(201);
    expect(created.body.data.evidence.status).toBe('PENDING');
    expect(created.body.data.upload.method).toBe('PUT');
    expect(created.body.data.upload.url).toContain('/agent/attendance-evidence/');
    expect(JSON.stringify(created.body)).not.toContain('storageKey');
    expect(JSON.stringify(created.body)).not.toContain('uploadToken');
    const uploadUrl = created.body.data.upload.url as string;
    const evidenceId = created.body.data.evidence.id as string;

    const wrongType = await uploadEvidence(team, uploadUrl, PNG, 'text/plain');
    expect(wrongType.status).toBe(415);

    const mismatchedType = await uploadEvidence(team, uploadUrl, JPEG, 'image/jpeg');
    expect(mismatchedType.status).toBe(422);
    expect(mismatchedType.body.error.code).toBe(
      'ATTENDANCE_EVIDENCE_CONTENT_TYPE_MISMATCH',
    );

    const invalidSignature = await uploadEvidence(
      team,
      uploadUrl,
      Buffer.from('this is definitely not a png'),
    );
    expect(invalidSignature.status).toBe(422);
    expect(invalidSignature.body.error.code).toBe('INVALID_ATTENDANCE_EVIDENCE_FILE');

    const oversized = await uploadEvidence(
      team,
      uploadUrl,
      Buffer.concat([PNG, Buffer.alloc(5_000, 0x33)]),
    );
    expect(oversized.status).toBe(413);

    const empty = await uploadEvidence(team, uploadUrl, Buffer.alloc(0));
    expect(empty.status).toBe(422);

    await AttendanceEvidence.update(
      { uploadExpiresAt: new Date(Date.now() - 1_000) },
      { where: { id: evidenceId } },
    );
    const expired = await uploadEvidence(team, uploadUrl, PNG);
    expect(expired.status).toBe(410);
    expect(expired.body.error.code).toBe('ATTENDANCE_UPLOAD_AUTHORIZATION_EXPIRED');

    const reauthorized = await request(app)
      .post(
        `${API}/organizations/${team.orgId}/attendance/evidence/${evidenceId}/upload-authorization`,
      )
      .set(team.agent.headers);
    expect(reauthorized.status).toBe(200);
    const replacementUrl = reauthorized.body.data.upload.url as string;
    expect(replacementUrl).not.toBe(uploadUrl);

    const staleToken = await uploadEvidence(team, uploadUrl, PNG);
    expect(staleToken.status).toBe(404);
    expect(staleToken.body.error.code).toBe('ATTENDANCE_EVIDENCE_UPLOAD_INVALID');

    const uploaded = await uploadEvidence(team, replacementUrl, PNG);
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.data.evidence.status).toBe('UPLOADED');
    expect(uploaded.body.data.evidence.fileSizeBytes).toBe(PNG.length);

    const afterUpload = await request(app)
      .post(
        `${API}/organizations/${team.orgId}/attendance/evidence/${evidenceId}/upload-authorization`,
      )
      .set(team.agent.headers);
    expect(afterUpload.status).toBe(409);
    expect(afterUpload.body.error.code).toBe('ATTENDANCE_EVIDENCE_ALREADY_UPLOADED');
  });

  it('grants audited signed access to the owner, reviewers, and the employee only', async () => {
    const team = await createMobileTeam();
    const { evidenceId } = await prepareEvidence(team, 'SELFIE');

    const selfAccess = await request(app)
      .post(`${API}/organizations/${team.orgId}/attendance/evidence/${evidenceId}/access`)
      .set(team.auth.headers);
    expect(selfAccess.status).toBe(200);
    const attendanceUrl = selfAccess.body.data.url as string;
    expect(attendanceUrl).toContain('/api/v1/attendance-files/');
    expect(JSON.stringify(selfAccess.body)).not.toContain('storageKey');

    const downloadPath = new URL(attendanceUrl).pathname;
    const downloaded = await request(app).get(downloadPath);
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers['content-type']).toBe('image/png');
    expect(downloaded.headers['cache-control']).toContain('no-store');

    const tampered = await request(app).get(`${downloadPath}x`);
    expect(tampered.status).toBe(404);
    expect(tampered.body.error.code).toBe('ATTENDANCE_EVIDENCE_LINK_INVALID');

    const wrongRoute = await request(app).get(
      `${API}/screenshot-files/${attendanceUrl.split('/').pop()}`,
    );
    expect(wrongRoute.status).toBe(404);

    const ownerAccess = await request(app)
      .post(`${API}/organizations/${team.orgId}/attendance/evidence/${evidenceId}/access`)
      .set(team.ownerAuth.headers);
    expect(ownerAccess.status).toBe(200);

    const second = await addEmployee(team.owner, team.orgId);
    const otherEmployee = await request(app)
      .post(`${API}/organizations/${team.orgId}/attendance/evidence/${evidenceId}/access`)
      .set(second.auth.headers);
    expect(otherEmployee.status).toBe(404);

    const otherOwner = await createOwner(uniqueEmail('att-other-owner'), 'Other Attendance Org');
    const crossOrganization = await request(app)
      .post(`${API}/organizations/${team.orgId}/attendance/evidence/${evidenceId}/access`)
      .set((await desktopAuth(otherOwner.email)).headers);
    expect(crossOrganization.status).toBe(404);

    expect(
      await AuditEvent.count({
        where: { action: 'ATTENDANCE_EVIDENCE_ACCESS_GRANTED', entityId: evidenceId },
      }),
    ).toBe(2);
    expect(
      await AuditEvent.count({
        where: { action: 'ATTENDANCE_EVIDENCE_VIEWED', entityId: evidenceId },
      }),
    ).toBe(1);

    const pending = await createEvidence(team, { kind: 'SITE_PHOTO', contentType: 'image/png' });
    const pendingAccess = await request(app)
      .post(
        `${API}/organizations/${team.orgId}/attendance/evidence/${pending.body.data.evidence.id}/access`,
      )
      .set(team.ownerAuth.headers);
    expect(pendingAccess.status).toBe(409);
    expect(pendingAccess.body.error.code).toBe('ATTENDANCE_EVIDENCE_NOT_UPLOADED');
  });

  it('keeps evidence and check-in lookups scoped to the employee and device', async () => {
    const team = await createMobileTeam();
    const second = await addEmployee(team.owner, team.orgId);
    const secondEvidence = await prepareEvidence(second, 'SELFIE');

    const crossEmployee = await checkIn(team, {
      checkInRequestId: randomUUID(),
      workMode: 'WFO',
      selfieEvidenceId: secondEvidence.evidenceId,
    });
    expect(crossEmployee.status).toBe(404);
    expect(crossEmployee.body.error.code).toBe('ATTENDANCE_EVIDENCE_NOT_FOUND');
    expect(await TimeSession.count()).toBe(0);

    const crossUpload = await uploadEvidence(team, secondEvidence.uploadUrl, PNG);
    expect(crossUpload.status).toBe(404);
    expect(crossUpload.body.error.code).toBe('ATTENDANCE_EVIDENCE_UPLOAD_INVALID');

    const crossAuthorize = await request(app)
      .post(
        `${API}/organizations/${team.orgId}/attendance/evidence/${secondEvidence.evidenceId}/upload-authorization`,
      )
      .set(team.agent.headers);
    expect(crossAuthorize.status).toBe(404);
  });

  it('rejects Electron devices on new attendance writes but preserves the time-session contract', async () => {
    const team = await createMobileTeam();
    const electron = await registerAgent(team.auth, team.orgId, {
      name: 'Desktop Laptop',
      platform: 'win32',
      clientType: 'ELECTRON',
    });

    const evidenceAttempt = await request(app)
      .post(`${API}/organizations/${team.orgId}/attendance/evidence`)
      .set(electron.headers)
      .send({ kind: 'SELFIE', contentType: 'image/png' });
    expect(evidenceAttempt.status).toBe(403);
    expect(evidenceAttempt.body.error.code).toBe('MOBILE_AGENT_REQUIRED');

    const checkInAttempt = await request(app)
      .post(`${API}/organizations/${team.orgId}/attendance/check-ins`)
      .set(electron.headers)
      .send({ checkInRequestId: randomUUID(), workMode: 'WFH' });
    expect(checkInAttempt.status).toBe(403);
    expect(checkInAttempt.body.error.code).toBe('MOBILE_AGENT_REQUIRED');

    const withoutDevice = await request(app)
      .post(`${API}/organizations/${team.orgId}/attendance/evidence`)
      .set(team.auth.headers)
      .send({ kind: 'SELFIE', contentType: 'image/png' });
    expect(withoutDevice.status).toBe(401);
    expect(withoutDevice.body.error.code).toBe('AGENT_AUTH_REQUIRED');

    const electronStart = await request(app)
      .post(`${API}/organizations/${team.orgId}/time-sessions/start`)
      .set(electron.headers)
      .send({});
    expect(electronStart.status).toBe(201);
    expect(electronStart.body.data.session.source).toBe('ONLINE');

    const mobileCheckInWithElectronSession = await checkIn(team, {
      checkInRequestId: randomUUID(),
      workMode: 'WFH',
    });
    expect(mobileCheckInWithElectronSession.status).toBe(409);
    expect(mobileCheckInWithElectronSession.body.error.code).toBe('ACTIVE_SESSION_EXISTS');
    expect(await TimeSession.count()).toBe(1);

    const stop = await request(app)
      .post(
        `${API}/organizations/${team.orgId}/time-sessions/${electronStart.body.data.session.id}/stop`,
      )
      .set(electron.headers)
      .send({});
    expect(stop.status).toBe(200);
  });
});
