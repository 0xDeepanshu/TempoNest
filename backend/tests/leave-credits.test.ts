import request from 'supertest';
import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it } from 'vitest';
import { LeaveLedgerEntry } from '../src/database';
import {
  API,
  app,
  createOwner,
  desktopAuth,
  inviteAndAccept,
  resetDatabase,
  uniqueEmail,
} from './helpers';

type Auth = { headers: Record<string, string> };

function api(orgId: string, path: string): string {
  return `${API}/organizations/${orgId}${path}`;
}

let typeCounter = 0;

async function createLeaveType(
  orgId: string,
  auth: Auth,
  overrides: Record<string, unknown> = {},
) {
  typeCounter += 1;
  const name =
    (overrides.name as string | undefined) ??
    `Credit Leave ${typeCounter}-${Math.random().toString(36).slice(2, 7)}`;
  const response = await request(app)
    .post(api(orgId, '/leave/types'))
    .set(auth.headers)
    .send({ name, ...overrides });
  expect(response.status).toBe(201);
  return response.body.data.leaveType;
}

async function configurePolicy(
  orgId: string,
  auth: Auth,
  policyId: string,
  overrides: Record<string, unknown> = {},
) {
  const response = await request(app)
    .put(api(orgId, `/leave/policies/${policyId}`))
    .set(auth.headers)
    .send({
      balancePeriodStartMonth: DateTime.utc().month,
      balancePeriodStartDay: 1,
      ...overrides,
    });
  expect(response.status).toBe(200);
  return response.body.data.policy;
}

function currentMonthStart(): string {
  return DateTime.utc().startOf('month').toISODate()!;
}

async function getEmployeeBalance(
  orgId: string,
  auth: Auth,
  leaveTypeId: string,
) {
  const response = await request(app)
    .get(
      api(
        orgId,
        `/leave/balances/me?leaveTypeId=${leaveTypeId}&periodStart=${currentMonthStart()}`,
      ),
    )
    .set(auth.headers);
  expect(response.status).toBe(200);
  return response.body.data.balances[0];
}

async function createTeam() {
  const owner = await createOwner(uniqueEmail('credit-owner'), 'Credit Org');
  const ownerAuth = await desktopAuth(owner.email);
  const employee = await inviteAndAccept(owner, {
    role: 'EMPLOYEE',
    name: 'Credit Employee',
    email: uniqueEmail('credit-employee'),
  });
  const employeeAuth = await desktopAuth(employee.email);
  const manager = await inviteAndAccept(owner, {
    role: 'MANAGER',
    name: 'Credit Manager',
    email: uniqueEmail('credit-manager'),
  });
  const otherEmployee = await inviteAndAccept(owner, {
    role: 'EMPLOYEE',
    name: 'Credit Other',
    email: uniqueEmail('credit-other'),
  });

  return {
    owner,
    ownerAuth,
    employee,
    employeeAuth,
    manager,
    otherEmployee,
    orgId: owner.organization.id,
  };
}

function previewCredits(orgId: string, auth: Auth, body: Record<string, unknown>) {
  return request(app)
    .post(api(orgId, '/leave/credits/preview'))
    .set(auth.headers)
    .send(body);
}

function assignCredits(orgId: string, auth: Auth, body: Record<string, unknown>) {
  return request(app)
    .post(api(orgId, '/leave/credits'))
    .set(auth.headers)
    .send({ confirm: true, ...body });
}

describe('leave credit assignment', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('adds credits to one employee and exposes the simplified totals', async () => {
    const { orgId, ownerAuth, employeeAuth, employee } = await createTeam();
    const type = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, type.policy.id, {});

    const response = await assignCredits(orgId, ownerAuth, {
      leaveTypeId: type.id,
      mode: 'ADD',
      credits: 12,
      employeeIds: [employee.user.id],
      reason: 'Annual allocation',
    });

    expect(response.status).toBe(200);
    expect(response.body.data.mode).toBe('ADD');
    expect(response.body.data.summary).toMatchObject({
      requested: 1,
      applied: 1,
      unchanged: 0,
      failed: 0,
    });
    const outcome = response.body.data.items[0];
    expect(outcome).toMatchObject({
      employeeId: employee.user.id,
      amount: 12,
      assignedBefore: 0,
      assignedAfter: 12,
      availableBefore: 0,
      availableAfter: 12,
      periodStart: currentMonthStart(),
    });

    const balance = await getEmployeeBalance(orgId, employeeAuth, type.id);
    expect(balance.assignedBalance).toBe(12);
    expect(balance.availableBalance).toBe(12);
    expect(balance.breakdown).toMatchObject({
      assigned: 12,
      adjustments: 12,
      approvedConsumed: 0,
      pendingReserved: 0,
      available: 12,
    });

    const ledger = await request(app)
      .get(api(orgId, '/leave/balances/ledger'))
      .query({ employeeId: employee.user.id, leaveTypeId: type.id })
      .set(ownerAuth.headers);
    expect(ledger.status).toBe(200);
    expect(ledger.body.data).toHaveLength(1);
    expect(ledger.body.data[0]).toMatchObject({
      kind: 'ADJUSTMENT',
      adjustmentDelta: 12,
      availableDelta: 12,
      reason: 'Annual allocation',
    });
    expect(ledger.body.data[0].metadata).toMatchObject({
      creditAssignment: true,
      mode: 'ADD',
    });

    const audit = await request(app)
      .get(api(orgId, '/leave/audit?action=LEAVE_CREDITS_ADDED'))
      .set(ownerAuth.headers);
    expect(audit.status).toBe(200);
    expect(audit.body.meta.total).toBe(1);
    expect(audit.body.data[0].metadata).toMatchObject({
      mode: 'ADD',
      credits: 12,
      assignedAfter: 12,
      reason: 'Annual allocation',
    });
  });

  it('sets the total assigned balance instead of adding to it', async () => {
    const { orgId, ownerAuth, employeeAuth, employee } = await createTeam();
    const type = await createLeaveType(orgId, ownerAuth);

    await assignCredits(orgId, ownerAuth, {
      leaveTypeId: type.id,
      mode: 'ADD',
      credits: 5,
      employeeIds: [employee.user.id],
      reason: 'Starting credits',
    });

    const set = await assignCredits(orgId, ownerAuth, {
      leaveTypeId: type.id,
      mode: 'SET',
      credits: 8,
      employeeIds: [employee.user.id],
      reason: 'Corrected allocation',
    });
    expect(set.status).toBe(200);
    expect(set.body.data.items[0]).toMatchObject({
      amount: 3,
      assignedBefore: 5,
      assignedAfter: 8,
      availableAfter: 8,
    });

    const balance = await getEmployeeBalance(orgId, employeeAuth, type.id);
    expect(balance.assignedBalance).toBe(8);
    expect(balance.availableBalance).toBe(8);

    const audit = await request(app)
      .get(api(orgId, '/leave/audit?action=LEAVE_CREDITS_SET'))
      .set(ownerAuth.headers);
    expect(audit.body.meta.total).toBe(1);

    const noop = await assignCredits(orgId, ownerAuth, {
      leaveTypeId: type.id,
      mode: 'SET',
      credits: 8,
      employeeIds: [employee.user.id],
      reason: 'Reconfirm allocation',
    });
    expect(noop.status).toBe(200);
    expect(noop.body.data.summary).toMatchObject({ applied: 0, unchanged: 1, failed: 0 });

    const ledgerCount = await LeaveLedgerEntry.count({ where: { leaveTypeId: type.id } });
    expect(ledgerCount).toBe(2);
  });

  it('assigns credits to every active member', async () => {
    const { orgId, ownerAuth } = await createTeam();
    const type = await createLeaveType(orgId, ownerAuth);

    const response = await assignCredits(orgId, ownerAuth, {
      leaveTypeId: type.id,
      mode: 'ADD',
      credits: 2,
      allActive: true,
      reason: 'Company-wide grant',
    });

    expect(response.status).toBe(200);
    expect(response.body.data.scope).toBe('ALL_ACTIVE');
    // Owner, employee, manager and other employee are all active members.
    expect(response.body.data.summary).toMatchObject({
      requested: 4,
      applied: 4,
      unchanged: 0,
      failed: 0,
    });

    const overview = await request(app)
      .get(api(orgId, '/leave/overview'))
      .set(ownerAuth.headers);
    expect(overview.status).toBe(200);
    expect(overview.body.data).toMatchObject({
      activeEmployees: 4,
      employeesWithBalances: 4,
      totalCreditsAssigned: 8,
      approvedConsumed: 0,
      pendingReserved: 0,
      availableCredits: 8,
      pendingApplications: 0,
      accrualConfigured: false,
    });
  });

  it('previews every employee without writing balances', async () => {
    const { orgId, ownerAuth, employeeAuth, employee } = await createTeam();
    const type = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, type.policy.id, {});

    const preview = await previewCredits(orgId, ownerAuth, {
      leaveTypeId: type.id,
      mode: 'ADD',
      credits: 4,
      employeeIds: [employee.user.id],
      reason: 'Preview grant',
    });

    expect(preview.status).toBe(200);
    expect(preview.body.data.summary).toMatchObject({
      selected: 1,
      previewed: 1,
      unchanged: 0,
      failed: 0,
    });
    expect(preview.body.data.items[0]).toMatchObject({
      employeeId: employee.user.id,
      assignedAfter: 4,
      availableAfter: 4,
      periodStart: currentMonthStart(),
    });

    const balance = await getEmployeeBalance(orgId, employeeAuth, type.id);
    expect(balance.assignedBalance).toBe(0);
    expect(balance.availableBalance).toBe(0);
    expect(await LeaveLedgerEntry.count({ where: { leaveTypeId: type.id } })).toBe(0);
  });

  it('reports per-employee failures without blocking the rest of the batch', async () => {
    const { orgId, ownerAuth, employee } = await createTeam();
    const type = await createLeaveType(orgId, ownerAuth);
    const missingId = '00000000-0000-4000-8000-000000000000';

    const response = await assignCredits(orgId, ownerAuth, {
      leaveTypeId: type.id,
      mode: 'ADD',
      credits: 3,
      employeeIds: [employee.user.id, missingId],
      reason: 'Partial batch',
    });

    expect(response.status).toBe(200);
    expect(response.body.data.summary).toMatchObject({ requested: 2, applied: 1, failed: 1 });
    const failed = response.body.data.items.find(
      (item: { employeeId: string }) => item.employeeId === missingId,
    );
    expect(failed).toMatchObject({ ok: false, code: 'EMPLOYEE_NOT_FOUND' });
  });

  it('validates the assignment scope and amount', async () => {
    const { orgId, ownerAuth, employee } = await createTeam();
    const type = await createLeaveType(orgId, ownerAuth);

    const bothScopes = await previewCredits(orgId, ownerAuth, {
      leaveTypeId: type.id,
      mode: 'ADD',
      credits: 1,
      employeeIds: [employee.user.id],
      allActive: true,
      reason: 'Bad scope',
    });
    expect(bothScopes.status).toBe(422);
    expect(bothScopes.body.error.code).toBe('VALIDATION_ERROR');

    const zeroAdd = await assignCredits(orgId, ownerAuth, {
      leaveTypeId: type.id,
      mode: 'ADD',
      credits: 0,
      allActive: true,
      reason: 'Bad amount',
    });
    expect(zeroAdd.status).toBe(422);
    expect(zeroAdd.body.error.code).toBe('VALIDATION_ERROR');

    const missingConfirm = await request(app)
      .post(api(orgId, '/leave/credits'))
      .set(ownerAuth.headers)
      .send({
        leaveTypeId: type.id,
        mode: 'ADD',
        credits: 1,
        allActive: true,
        reason: 'No confirm',
      });
    expect(missingConfirm.status).toBe(422);
  });

  it('requires a credit-based leave type and leave:manage permission', async () => {
    const { orgId, ownerAuth, employeeAuth, employee } = await createTeam();
    const type = await createLeaveType(orgId, ownerAuth);
    const unpaid = await createLeaveType(orgId, ownerAuth, {
      name: 'Unlimited Leave',
      requiresBalance: false,
    });

    const employeeAttempt = await previewCredits(orgId, employeeAuth, {
      leaveTypeId: type.id,
      mode: 'ADD',
      credits: 1,
      employeeIds: [employee.user.id],
      reason: 'Employee try',
    });
    expect(employeeAttempt.status).toBe(403);

    const unlimited = await previewCredits(orgId, ownerAuth, {
      leaveTypeId: unpaid.id,
      mode: 'ADD',
      credits: 1,
      employeeIds: [employee.user.id],
      reason: 'Not credit based',
    });
    expect(unlimited.status).toBe(422);
    expect(unlimited.body.error.code).toBe('LEAVE_BALANCE_NOT_APPLICABLE');
  });

  it('rejects half-day requests when the leave type disallows them', async () => {
    const { orgId, ownerAuth, employeeAuth, employee } = await createTeam();
    const type = await createLeaveType(orgId, ownerAuth, {
      allowHalfDay: false,
      requiresBalance: false,
    });
    expect(type.allowHalfDay).toBe(false);

    const today = DateTime.utc().toISODate()!;
    const response = await request(app)
      .post(api(orgId, '/leave/requests'))
      .set(employeeAuth.headers)
      .send({
        leaveTypeId: type.id,
        startDate: today,
        endDate: today,
        startHalfDay: true,
        reason: 'Half day attempt',
      });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('LEAVE_HALF_DAY_NOT_ALLOWED');

    const fullDay = await request(app)
      .post(api(orgId, '/leave/requests'))
      .set(employeeAuth.headers)
      .send({
        leaveTypeId: type.id,
        startDate: today,
        endDate: today,
        reason: 'Full day attempt',
      });
    expect(fullDay.status).toBe(201);
    expect(fullDay.body.data.request.employeeId).toBe(employee.user.id);
  });

  it('keeps available balance reduced by approved and pending requests', async () => {
    const { orgId, ownerAuth, employeeAuth, employee } = await createTeam();
    const type = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      initialEntitlement: 0,
      workingDays: [1, 2, 3, 4, 5, 6, 7],
    });

    // Any day inside the current balance period works for a one-day request.
    const date = DateTime.utc().toISODate()!;

    await assignCredits(orgId, ownerAuth, {
      leaveTypeId: type.id,
      mode: 'ADD',
      credits: 3,
      employeeIds: [employee.user.id],
      reason: 'Allocation',
    });

    const applied = await request(app)
      .post(api(orgId, '/leave/requests'))
      .set(employeeAuth.headers)
      .send({
        leaveTypeId: type.id,
        startDate: date,
        endDate: date,
        reason: 'Day off',
      });
    expect(applied.status).toBe(201);

    const pendingBalance = await getEmployeeBalance(orgId, employeeAuth, type.id);
    expect(pendingBalance).toMatchObject({
      assignedBalance: 3,
      approvedConsumed: 0,
      pendingReserved: 1,
      availableBalance: 2,
    });

    const approved = await request(app)
      .post(api(orgId, `/leave/requests/${applied.body.data.request.id}/approve`))
      .set(ownerAuth.headers)
      .send({});
    expect(approved.status).toBe(200);

    const approvedBalance = await getEmployeeBalance(orgId, employeeAuth, type.id);
    expect(approvedBalance).toMatchObject({
      assignedBalance: 3,
      approvedConsumed: 1,
      pendingReserved: 0,
      availableBalance: 2,
    });

    const overview = await request(app)
      .get(api(orgId, '/leave/overview'))
      .set(ownerAuth.headers);
    expect(overview.body.data).toMatchObject({
      totalCreditsAssigned: 3,
      approvedConsumed: 1,
      pendingReserved: 0,
      availableCredits: 2,
    });
  });
});
