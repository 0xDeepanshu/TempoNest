import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AttendanceCorrectionRequest,
  AuditEvent,
  Break,
  Organization,
  TimeSession,
} from '../src/database';
import {
  API,
  app,
  createOwner,
  desktopAuth,
  inviteAndAccept,
  resetDatabase,
  uniqueEmail,
} from './helpers';

const MINUTE = 60_000;

async function createTeam(options: { timezone?: string } = {}) {
  const owner = await createOwner(uniqueEmail('owner'), 'Attendance Org');
  if (options.timezone) {
    await Organization.update(
      { timezone: options.timezone },
      { where: { id: owner.organization.id } },
    );
  }
  const ownerAuth = await desktopAuth(owner.email);
  const employee = await inviteAndAccept(owner, {
    role: 'EMPLOYEE',
    name: 'Attendance Employee',
    email: uniqueEmail('employee'),
  });
  const manager = await inviteAndAccept(owner, {
    role: 'MANAGER',
    name: 'Attendance Manager',
    email: uniqueEmail('manager'),
  });
  const employeeAuth = await desktopAuth(employee.email);
  const managerAuth = await desktopAuth(manager.email);
  return {
    owner,
    ownerAuth,
    employee,
    employeeAuth,
    manager,
    managerAuth,
    orgId: owner.organization.id,
  };
}

async function createSession(options: {
  organizationId: string;
  employeeId: string;
  startedAt: Date;
  endedAt: Date;
  breaks?: Array<{ startedAt: Date; endedAt: Date }>;
}) {
  const session = await TimeSession.create({
    organizationId: options.organizationId,
    employeeId: options.employeeId,
    desktopAgentId: null,
    startedAt: options.startedAt,
    endedAt: options.endedAt,
    status: 'STOPPED',
    source: 'ONLINE',
    lastHeartbeatAt: options.endedAt,
  });
  for (const brk of options.breaks ?? []) {
    await Break.create({
      organizationId: options.organizationId,
      timeSessionId: session.id,
      startedAt: brk.startedAt,
      endedAt: brk.endedAt,
      status: 'ENDED',
    });
  }
  return session;
}

function createCorrection(
  session: { agent: ReturnType<typeof request.agent>; csrf: string },
  organizationId: string,
  body: Record<string, unknown>,
) {
  return session.agent
    .post(`${API}/organizations/${organizationId}/attendance/corrections`)
    .set('x-csrf-token', session.csrf)
    .send(body);
}

function approve(orgId: string, correctionId: string, auth: { headers: Record<string, string> }) {
  return request(app)
    .post(`${API}/organizations/${orgId}/attendance/corrections/${correctionId}/approve`)
    .set(auth.headers)
    .send({});
}

describe('employee attendance and corrections', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('returns self-scoped daily, weekly, and monthly summaries in the organization timezone', async () => {
    const { owner, ownerAuth, employee, employeeAuth, manager, managerAuth, orgId } =
      await createTeam({ timezone: 'Asia/Kolkata' });

    // Asia/Kolkata is UTC+05:30. All timestamps below are stored in UTC.
    const session = (localDate: string, hours: number, breakMinutes: number) => {
      const [year, month, day] = localDate.split('-').map(Number);
      const start = new Date(
        Date.UTC(year!, month! - 1, day!, 9 - 5, 30, 0, 0),
      );
      const end = new Date(start.getTime() + hours * 60 * MINUTE);
      const breaks =
        breakMinutes > 0
          ? [{ startedAt: new Date(start.getTime() + 60 * MINUTE), endedAt: new Date(start.getTime() + (60 + breakMinutes) * MINUTE) }]
          : [];
      return { start, end, breaks };
    };

    const first = session('2026-01-05', 4, 30);
    const second = session('2026-01-06', 3, 15);
    const third = session('2026-01-12', 2, 0);
    await createSession({
      organizationId: orgId,
      employeeId: employee.user.id,
      startedAt: first.start,
      endedAt: first.end,
      breaks: first.breaks,
    });
    await createSession({
      organizationId: orgId,
      employeeId: employee.user.id,
      startedAt: second.start,
      endedAt: second.end,
      breaks: second.breaks,
    });
    await createSession({
      organizationId: orgId,
      employeeId: employee.user.id,
      startedAt: third.start,
      endedAt: third.end,
    });

    const otherEmployee = await inviteAndAccept(owner, {
      role: 'EMPLOYEE',
      email: uniqueEmail('other-employee'),
    });
    await createSession({
      organizationId: orgId,
      employeeId: otherEmployee.user.id,
      startedAt: new Date('2026-01-05T00:00:00.000Z'),
      endedAt: new Date('2026-01-05T01:00:00.000Z'),
    });

    const daily = await request(app)
      .get(
        `${API}/organizations/${orgId}/attendance/summaries?from=2026-01-05&to=2026-01-12&period=daily&employeeId=${otherEmployee.user.id}`,
      )
      .set(employeeAuth.headers);
    expect(daily.status).toBe(200);
    expect(daily.body.data.employeeId).toBe(employee.user.id);
    expect(daily.body.data.timezone).toBe('Asia/Kolkata');
    expect(daily.body.data.periods).toHaveLength(8);
    expect(daily.body.data.periods[0]).toMatchObject({
      periodStart: '2026-01-05',
      workedSeconds: 12_600,
      breakSeconds: 1_800,
      sessionCount: 1,
      activeDays: 1,
    });
    expect(daily.body.data.periods[1]).toMatchObject({
      periodStart: '2026-01-06',
      workedSeconds: 9_900,
      breakSeconds: 900,
    });
    expect(daily.body.data.periods[7]).toMatchObject({
      periodStart: '2026-01-12',
      workedSeconds: 7_200,
      breakSeconds: 0,
    });
    expect(daily.body.data.totals).toMatchObject({
      workedSeconds: 29_700,
      breakSeconds: 2_700,
      sessionCount: 3,
      activeDays: 3,
    });

    const weekly = await request(app)
      .get(`${API}/organizations/${orgId}/attendance/summaries?from=2026-01-05&to=2026-01-18&period=weekly`)
      .set(employeeAuth.headers);
    expect(weekly.status).toBe(200);
    expect(weekly.body.data.periods).toHaveLength(2);
    expect(weekly.body.data.periods[0]).toMatchObject({
      periodStart: '2026-01-05',
      periodEnd: '2026-01-11',
      workedSeconds: 22_500,
      breakSeconds: 2_700,
      sessionCount: 2,
      activeDays: 2,
      daysIncluded: 7,
    });
    expect(weekly.body.data.periods[1]).toMatchObject({
      periodStart: '2026-01-12',
      periodEnd: '2026-01-18',
      workedSeconds: 7_200,
      sessionCount: 1,
      activeDays: 1,
      daysIncluded: 7,
    });
    expect(weekly.body.data.totals.sessionCount).toBe(3);

    const monthly = await request(app)
      .get(`${API}/organizations/${orgId}/attendance/summaries?from=2026-01-01&to=2026-01-31&period=monthly`)
      .set(employeeAuth.headers);
    expect(monthly.status).toBe(200);
    expect(monthly.body.data.periods).toHaveLength(1);
    expect(monthly.body.data.periods[0]).toMatchObject({
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      workedSeconds: 29_700,
      sessionCount: 3,
      activeDays: 3,
    });

    const managerView = await request(app)
      .get(
        `${API}/organizations/${orgId}/attendance/summaries?from=2026-01-05&to=2026-01-05&employeeId=${employee.user.id}`,
      )
      .set(managerAuth.headers);
    expect(managerView.status).toBe(200);
    expect(managerView.body.data.employeeId).toBe(employee.user.id);

    const managerWithoutEmployee = await request(app)
      .get(`${API}/organizations/${orgId}/attendance/summaries?from=2026-01-05&to=2026-01-05`)
      .set(managerAuth.headers);
    expect(managerWithoutEmployee.status).toBe(422);
    expect(managerWithoutEmployee.body.error.code).toBe('EMPLOYEE_ID_REQUIRED');

    const ownerView = await request(app)
      .get(
        `${API}/organizations/${orgId}/attendance/summaries?from=2026-01-05&to=2026-01-05&employeeId=${employee.user.id}`,
      )
      .set(ownerAuth.headers);
    expect(ownerView.status).toBe(200);

    const foreignOrg = await createOwner(uniqueEmail('owner'), 'Unrelated Org');
    const crossOrg = await request(app)
      .get(`${API}/organizations/${foreignOrg.organization.id}/attendance/summaries?from=2026-01-05&to=2026-01-05`)
      .set(employeeAuth.headers);
    expect(crossOrg.status).toBe(404);

    // The manager role exists in the same organization and is not part of the
    // employee's self-scoped result.
    expect(manager.user.id).not.toBe(employee.user.id);
  });

  it('submits a missing-session correction, reviews it, applies it atomically, and stays idempotent', async () => {
    const { employee, employeeAuth, managerAuth, orgId, ownerAuth } = await createTeam();
    const body = {
      workDate: '2026-02-02',
      startedAt: '2026-02-02T09:00:00.000Z',
      endedAt: '2026-02-02T17:00:00.000Z',
      breaks: [
        { startedAt: '2026-02-02T12:00:00.000Z', endedAt: '2026-02-02T13:00:00.000Z' },
      ],
      reason: 'Forgot to start tracking after the laptop update.',
    };

    const created = await createCorrection(employee, orgId, body);
    expect(created.status).toBe(201);
    const correction = created.body.data.correction;
    expect(correction.status).toBe('PENDING');
    expect(correction.requestType).toBe('CREATE_SESSION');
    expect(correction.original).toBeNull();
    expect(correction.requestedBreaks).toHaveLength(1);
    expect(correction.requestedBreakSeconds).toBe(3_600);
    expect(correction.employee.id).toBe(employee.user.id);

    const employeeList = await request(app)
      .get(`${API}/organizations/${orgId}/attendance/corrections`)
      .set(employeeAuth.headers);
    expect(employeeList.status).toBe(200);
    expect(employeeList.body.meta.total).toBe(1);
    expect(employeeList.body.data[0].id).toBe(correction.id);

    const managerList = await request(app)
      .get(`${API}/organizations/${orgId}/attendance/corrections?status=PENDING`)
      .set(managerAuth.headers);
    expect(managerList.status).toBe(200);
    expect(managerList.body.meta.total).toBe(1);

    const employeeApprove = await request(app)
      .post(`${API}/organizations/${orgId}/attendance/corrections/${correction.id}/approve`)
      .set(employeeAuth.headers)
      .send({});
    expect(employeeApprove.status).toBe(403);
    expect(employeeApprove.body.error.code).toBe('PERMISSION_DENIED');

    const [firstApproval, secondApproval] = await Promise.all([
      approve(orgId, correction.id, managerAuth),
      approve(orgId, correction.id, managerAuth),
    ]);
    expect([firstApproval.status, secondApproval.status]).toEqual([200, 200]);
    for (const response of [firstApproval, secondApproval]) {
      expect(response.body.data.correction.status).toBe('APPROVED');
      expect(response.body.data.correction.resultingSessionId).toBeTruthy();
    }
    const resultingSessionId = firstApproval.body.data.correction.resultingSessionId as string;

    const sessions = await TimeSession.findAll({
      where: { organizationId: orgId, employeeId: employee.user.id },
      include: [{ model: Break, as: 'breaks' }],
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.id).toBe(resultingSessionId);
    expect(sessions[0]!.status).toBe('STOPPED');
    expect(sessions[0]!.source).toBe('OFFLINE');
    expect(sessions[0]!.desktopAgentId).toBeNull();
    expect(sessions[0]!.startedAt.toISOString()).toBe(body.startedAt);
    expect(sessions[0]!.endedAt!.toISOString()).toBe(body.endedAt);
    expect(sessions[0]!.breaks).toHaveLength(1);

    const repeated = await approve(orgId, correction.id, managerAuth);
    expect(repeated.status).toBe(200);
    expect(repeated.body.data.correction.resultingSessionId).toBe(resultingSessionId);
    expect(await TimeSession.count({ where: { organizationId: orgId } })).toBe(1);

    const rejectApproved = await request(app)
      .post(`${API}/organizations/${orgId}/attendance/corrections/${correction.id}/reject`)
      .set(managerAuth.headers)
      .send({ reason: 'Too late' });
    expect(rejectApproved.status).toBe(409);
    expect(rejectApproved.body.error.code).toBe('CORRECTION_ALREADY_APPROVED');

    const daily = await request(app)
      .get(
        `${API}/organizations/${orgId}/attendance/summaries?from=2026-02-02&to=2026-02-02&period=daily`,
      )
      .set(employeeAuth.headers);
    expect(daily.status).toBe(200);
    expect(daily.body.data.periods[0]).toMatchObject({
      workedSeconds: 25_200,
      breakSeconds: 3_600,
      sessionCount: 1,
    });

    const report = await request(app)
      .get(
        `${API}/organizations/${orgId}/reports/daily?from=2026-02-02&to=2026-02-02&employeeId=${employee.user.id}`,
      )
      .set(ownerAuth.headers);
    expect(report.status).toBe(200);
    expect(report.body.data.days[0].workedSeconds).toBe(25_200);

    const auditRows = await AuditEvent.findAll({
      where: { organizationId: orgId, entityId: correction.id },
      order: [['createdAt', 'ASC']],
    });
    expect(auditRows.map((row) => row.action)).toEqual([
      'ATTENDANCE_CORRECTION_REQUESTED',
      'ATTENDANCE_CORRECTION_APPROVED',
    ]);
    expect(auditRows[0]!.metadata.original).toBeNull();
    expect(auditRows[1]!.metadata.after).toBeTruthy();
    expect(JSON.stringify(auditRows.map((row) => row.metadata))).not.toContain('token');
  });

  it('updates an existing session, preserves the original snapshot, and rolls back conflicts', async () => {
    const { employee, employeeAuth, managerAuth, orgId } = await createTeam();
    const original = await createSession({
      organizationId: orgId,
      employeeId: employee.user.id,
      startedAt: new Date('2026-03-02T09:00:00.000Z'),
      endedAt: new Date('2026-03-02T17:00:00.000Z'),
      breaks: [
        { startedAt: new Date('2026-03-02T12:00:00.000Z'), endedAt: new Date('2026-03-02T13:00:00.000Z') },
      ],
    });
    const originalBreaks = await Break.findAll({ where: { timeSessionId: original.id } });

    const rejectBody = {
      sessionId: original.id,
      workDate: '2026-03-02',
      startedAt: '2026-03-02T08:30:00.000Z',
      endedAt: '2026-03-02T16:30:00.000Z',
      breaks: [
        { startedAt: '2026-03-02T11:30:00.000Z', endedAt: '2026-03-02T12:00:00.000Z' },
        { startedAt: '2026-03-02T14:00:00.000Z', endedAt: '2026-03-02T14:30:00.000Z' },
      ],
      reason: 'The tracked times were shifted by an hour.',
    };
    const submitted = await createCorrection(employee, orgId, rejectBody);
    expect(submitted.status).toBe(201);
    const firstCorrection = submitted.body.data.correction;
    expect(firstCorrection.requestType).toBe('UPDATE_SESSION');
    expect(firstCorrection.original.sessionId).toBe(original.id);
    expect(firstCorrection.original.breaks[0].id).toBe(originalBreaks[0]!.id);

    const rejected = await request(app)
      .post(`${API}/organizations/${orgId}/attendance/corrections/${firstCorrection.id}/reject`)
      .set(managerAuth.headers)
      .send({ reason: 'Please attach the approved timesheet.' });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.correction.status).toBe('REJECTED');
    expect(rejected.body.data.correction.rejectionReason).toBe(
      'Please attach the approved timesheet.',
    );
    const unchanged = (await TimeSession.findByPk(original.id))!;
    expect(unchanged.startedAt.toISOString()).toBe('2026-03-02T09:00:00.000Z');
    expect(await TimeSession.count({ where: { id: original.id } })).toBe(1);

    const second = await createCorrection(employee, orgId, rejectBody);
    expect(second.status).toBe(201);
    const secondCorrection = second.body.data.correction;
    const approved = await approve(orgId, secondCorrection.id, managerAuth);
    expect(approved.status).toBe(200);
    expect(approved.body.data.correction.original.sessionId).toBe(original.id);
    expect(approved.body.data.correction.applied.startedAt).toBe(
      '2026-03-02T08:30:00.000Z',
    );

    const updated = (await TimeSession.findByPk(original.id))!;
    expect(updated.startedAt.toISOString()).toBe('2026-03-02T08:30:00.000Z');
    expect(updated.endedAt!.toISOString()).toBe('2026-03-02T16:30:00.000Z');
    const breaks = await Break.findAll({ where: { timeSessionId: original.id } });
    expect(breaks).toHaveLength(2);
    expect(breaks.map((brk) => brk.id)).not.toContain(originalBreaks[0]!.id);

    const audit = await AuditEvent.findOne({
      where: {
        organizationId: orgId,
        entityId: secondCorrection.id,
        action: 'ATTENDANCE_CORRECTION_APPROVED',
      },
    });
    expect(audit).toBeTruthy();
    expect((audit!.metadata.before as { startedAt: string }).startedAt).toBe(
      '2026-03-02T09:00:00.000Z',
    );
    expect((audit!.metadata.after as { startedAt: string }).startedAt).toBe(
      '2026-03-02T08:30:00.000Z',
    );

    // A correction can become stale while pending. Approval must re-check
    // overlaps and leave the request pending without changing attendance.
    const pending = await createCorrection(employee, orgId, {
      sessionId: original.id,
      workDate: '2026-03-02',
      startedAt: '2026-03-02T09:00:00.000Z',
      endedAt: '2026-03-02T12:00:00.000Z',
      breaks: [],
      reason: 'Trim the session to the worked portion.',
    });
    expect(pending.status).toBe(201);
    await createSession({
      organizationId: orgId,
      employeeId: employee.user.id,
      startedAt: new Date('2026-03-02T10:30:00.000Z'),
      endedAt: new Date('2026-03-02T11:00:00.000Z'),
    });
    const stale = await approve(orgId, pending.body.data.correction.id, managerAuth);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('CORRECTION_BEFORE_EXISTING_SESSION');
    expect(stale.body.error.message).toBe(
      'The requested time conflicts with an earlier work session. Please check your attendance history.',
    );
    const pendingRow = (await AttendanceCorrectionRequest.findByPk(
      pending.body.data.correction.id,
    ))!;
    expect(pendingRow.status).toBe('PENDING');
    expect((await TimeSession.findByPk(original.id))!.endedAt!.toISOString()).toBe(
      '2026-03-02T16:30:00.000Z',
    );
  });

  it('rechecks general overlaps when approving a pending correction', async () => {
    const { employee, managerAuth, orgId } = await createTeam();
    const pending = await createCorrection(employee, orgId, {
      workDate: '2026-05-02',
      startedAt: '2026-05-02T12:00:00.000Z',
      endedAt: '2026-05-02T13:00:00.000Z',
      reason: 'Missing session that becomes stale before approval.',
    });
    expect(pending.status).toBe(201);

    await createSession({
      organizationId: orgId,
      employeeId: employee.user.id,
      startedAt: new Date('2026-05-02T11:00:00.000Z'),
      endedAt: new Date('2026-05-02T12:30:00.000Z'),
    });

    const stale = await approve(orgId, pending.body.data.correction.id, managerAuth);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('CORRECTION_OVERLAPS_EXISTING_SESSION');
    expect(stale.body.error.message).toBe(
      'This correction overlaps with another recorded work session. Please adjust the start and end times.',
    );

    const pendingRow = (await AttendanceCorrectionRequest.findByPk(
      pending.body.data.correction.id,
    ))!;
    expect(pendingRow.status).toBe('PENDING');
    expect(await TimeSession.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it('validates requests, scopes review, and forbids self-review', async () => {
    const { employee, employeeAuth, manager, managerAuth, orgId, ownerAuth } =
      await createTeam();
    await createSession({
      organizationId: orgId,
      employeeId: employee.user.id,
      startedAt: new Date('2026-04-01T09:00:00.000Z'),
      endedAt: new Date('2026-04-01T17:00:00.000Z'),
    });

    const invalidInterval = await createCorrection(employee, orgId, {
      workDate: '2026-04-01',
      startedAt: '2026-04-01T10:00:00.000Z',
      endedAt: '2026-04-01T10:00:00.000Z',
      reason: 'Invalid interval',
    });
    expect(invalidInterval.status).toBe(422);
    expect(invalidInterval.body.error.code).toBe('VALIDATION_ERROR');

    const wrongWorkDate = await createCorrection(employee, orgId, {
      workDate: '2026-04-02',
      startedAt: '2026-04-01T10:00:00.000Z',
      endedAt: '2026-04-01T11:00:00.000Z',
      reason: 'Wrong day',
    });
    expect(wrongWorkDate.status).toBe(422);
    expect(wrongWorkDate.body.error.code).toBe('WORK_DATE_MISMATCH');

    const overlappingSession = await createCorrection(employee, orgId, {
      workDate: '2026-04-01',
      startedAt: '2026-04-01T12:00:00.000Z',
      endedAt: '2026-04-01T13:00:00.000Z',
      reason: 'Overlaps a tracked session',
    });
    expect(overlappingSession.status).toBe(409);
    expect(overlappingSession.body.error.code).toBe('CORRECTION_OVERLAPS_EXISTING_SESSION');
    expect(overlappingSession.body.error.message).toBe(
      'This correction overlaps with another recorded work session. Please adjust the start and end times.',
    );

    const startsBeforeSession = await createCorrection(employee, orgId, {
      workDate: '2026-04-01',
      startedAt: '2026-04-01T08:00:00.000Z',
      endedAt: '2026-04-01T10:00:00.000Z',
      reason: 'Starts before a tracked session',
    });
    expect(startsBeforeSession.status).toBe(409);
    expect(startsBeforeSession.body.error.code).toBe('CORRECTION_BEFORE_EXISTING_SESSION');
    expect(startsBeforeSession.body.error.message).toBe(
      'The requested time conflicts with an earlier work session. Please check your attendance history.',
    );

    const outsideBreak = await createCorrection(employee, orgId, {
      workDate: '2026-04-02',
      startedAt: '2026-04-02T09:00:00.000Z',
      endedAt: '2026-04-02T10:00:00.000Z',
      breaks: [
        { startedAt: '2026-04-02T08:30:00.000Z', endedAt: '2026-04-02T09:15:00.000Z' },
      ],
      reason: 'Break outside session',
    });
    expect(outsideBreak.status).toBe(422);
    expect(outsideBreak.body.error.code).toBe('INVALID_CORRECTION_BREAKS');

    const overlappingBreaks = await createCorrection(employee, orgId, {
      workDate: '2026-04-02',
      startedAt: '2026-04-02T09:00:00.000Z',
      endedAt: '2026-04-02T11:00:00.000Z',
      breaks: [
        { startedAt: '2026-04-02T09:15:00.000Z', endedAt: '2026-04-02T09:45:00.000Z' },
        { startedAt: '2026-04-02T09:30:00.000Z', endedAt: '2026-04-02T10:00:00.000Z' },
      ],
      reason: 'Overlapping breaks',
    });
    expect(overlappingBreaks.status).toBe(422);
    expect(overlappingBreaks.body.error.code).toBe('INVALID_CORRECTION_BREAKS');

    const nonOverlappingSession = await createCorrection(employee, orgId, {
      workDate: '2026-04-01',
      startedAt: '2026-04-01T17:00:00.000Z',
      endedAt: '2026-04-01T18:00:00.000Z',
      reason: 'Work after the recorded session',
    });
    expect(nonOverlappingSession.status).toBe(201);

    const firstValid = await createCorrection(employee, orgId, {
      sessionId: (await TimeSession.findOne({ where: { employeeId: employee.user.id } }))!.id,
      workDate: '2026-04-01',
      startedAt: '2026-04-01T09:30:00.000Z',
      endedAt: '2026-04-01T16:30:00.000Z',
      breaks: [],
      reason: 'Adjust the existing session',
    });
    expect(firstValid.status).toBe(201);

    const duplicatePending = await createCorrection(employee, orgId, {
      sessionId: (await TimeSession.findOne({ where: { employeeId: employee.user.id } }))!.id,
      workDate: '2026-04-01',
      startedAt: '2026-04-01T09:15:00.000Z',
      endedAt: '2026-04-01T16:45:00.000Z',
      breaks: [],
      reason: 'A second pending adjustment',
    });
    expect(duplicatePending.status).toBe(409);
    expect(duplicatePending.body.error.code).toBe('CORRECTION_ALREADY_PENDING');

    const ownCorrection = await createCorrection(manager, orgId, {
      workDate: '2026-04-03',
      startedAt: '2026-04-03T09:00:00.000Z',
      endedAt: '2026-04-03T10:00:00.000Z',
      reason: 'Manager missing session',
    });
    expect(ownCorrection.status).toBe(201);
    const selfReview = await approve(
      orgId,
      ownCorrection.body.data.correction.id,
      managerAuth,
    );
    expect(selfReview.status).toBe(403);
    expect(selfReview.body.error.code).toBe('SELF_REVIEW_FORBIDDEN');

    const employeeCannotSeeManager = await request(app)
      .get(
        `${API}/organizations/${orgId}/attendance/corrections/${ownCorrection.body.data.correction.id}`,
      )
      .set(employeeAuth.headers);
    expect(employeeCannotSeeManager.status).toBe(404);

    const rejectWithoutReason = await request(app)
      .post(
        `${API}/organizations/${orgId}/attendance/corrections/${firstValid.body.data.correction.id}/reject`,
      )
      .set(managerAuth.headers)
      .send({});
    expect(rejectWithoutReason.status).toBe(422);

    const ownerCanSeeAll = await request(app)
      .get(`${API}/organizations/${orgId}/attendance/corrections?employeeId=${manager.user.id}`)
      .set(ownerAuth.headers);
    expect(ownerCanSeeAll.status).toBe(200);
    expect(ownerCanSeeAll.body.meta.total).toBe(1);

    const foreignOwner = await createOwner(uniqueEmail('owner'), 'Other Review Org');
    const foreignOwnerAuth = await desktopAuth(foreignOwner.email);
    const foreignReview = await request(app)
      .post(
        `${API}/organizations/${foreignOwner.organization.id}/attendance/corrections/${firstValid.body.data.correction.id}/approve`,
      )
      .set(foreignOwnerAuth.headers)
      .send({});
    // The foreign owner is a member of a different organization, so the
    // correction is not found in that organization.
    expect(foreignReview.status).toBe(404);
    expect(foreignReview.body.error.code).toBe('CORRECTION_NOT_FOUND');
  });
});
