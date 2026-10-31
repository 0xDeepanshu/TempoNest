import request from 'supertest';
import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  LeaveLedgerEntry,
  Membership,
  User,
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
    `Test Leave ${typeCounter}-${Math.random().toString(36).slice(2, 7)}`;
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
    .send(overrides);
  expect(response.status).toBe(200);
  return response.body.data.policy;
}

function monthsAheadMonday(minDaysAhead = 10) {
  let monday = DateTime.utc().plus({ days: minDaysAhead }).startOf('day');
  while (monday.weekday !== 1) monday = monday.plus({ days: 1 });
  return {
    monday: monday.toISODate()!,
    tuesday: monday.plus({ days: 1 }).toISODate()!,
    wednesday: monday.plus({ days: 2 }).toISODate()!,
    thursday: monday.plus({ days: 3 }).toISODate()!,
    friday: monday.plus({ days: 4 }).toISODate()!,
    nextMonday: monday.plus({ days: 7 }).toISODate()!,
    nextFriday: monday.plus({ days: 11 }).toISODate()!,
  };
}

/** Period start that contains both today and the next couple of weeks. */
function currentPeriodConfig() {
  return {
    balancePeriodStartMonth: DateTime.utc().month,
    balancePeriodStartDay: 1,
  };
}

function currentMonthStart(): string {
  return DateTime.utc().startOf('month').toISODate()!;
}

function applyLeave(
  orgId: string,
  auth: Auth,
  body: Record<string, unknown>,
  idempotencyKey?: string,
) {
  const req = request(app).post(api(orgId, '/leave/requests')).set(auth.headers);
  if (idempotencyKey) req.set('Idempotency-Key', idempotencyKey);
  return req.send(body);
}

function approve(orgId: string, auth: Auth, requestId: string, note?: string) {
  return request(app)
    .post(api(orgId, `/leave/requests/${requestId}/approve`))
    .set(auth.headers)
    .send(note ? { note } : {});
}

function reject(orgId: string, auth: Auth, requestId: string, reason = 'Not approved') {
  return request(app)
    .post(api(orgId, `/leave/requests/${requestId}/reject`))
    .set(auth.headers)
    .send({ reason });
}

function cancel(orgId: string, auth: Auth, requestId: string, reason?: string) {
  return request(app)
    .post(api(orgId, `/leave/requests/${requestId}/cancel`))
    .set(auth.headers)
    .send(reason ? { reason } : {});
}

async function getBalance(
  orgId: string,
  auth: Auth,
  leaveTypeId: string,
  periodStart: string,
) {
  const response = await request(app)
    .get(
      api(
        orgId,
        `/leave/balances/me?leaveTypeId=${leaveTypeId}&periodStart=${periodStart}`,
      ),
    )
    .set(auth.headers);
  expect(response.status).toBe(200);
  const balance = response.body.data.balances.find(
    (item: { leaveTypeId: string; periodStart: string }) =>
      item.leaveTypeId === leaveTypeId && item.periodStart === periodStart,
  );
  expect(balance).toBeDefined();
  return balance;
}

async function createTeam() {
  const owner = await createOwner(uniqueEmail('leave-owner'), 'Leave Org');
  const ownerAuth = await desktopAuth(owner.email);
  const employee = await inviteAndAccept(owner, {
    role: 'EMPLOYEE',
    name: 'Leave Employee',
    email: uniqueEmail('leave-employee'),
  });
  const employeeAuth = await desktopAuth(employee.email);
  const manager = await inviteAndAccept(owner, {
    role: 'MANAGER',
    name: 'Leave Manager',
    email: uniqueEmail('leave-manager'),
  });
  const managerAuth = await desktopAuth(manager.email);
  const otherEmployee = await inviteAndAccept(owner, {
    role: 'EMPLOYEE',
    name: 'Other Employee',
    email: uniqueEmail('leave-other'),
  });
  const otherEmployeeAuth = await desktopAuth(otherEmployee.email);

  return {
    owner,
    ownerAuth,
    employee,
    employeeAuth,
    manager,
    managerAuth,
    otherEmployee,
    otherEmployeeAuth,
    orgId: owner.organization.id,
  };
}

describe('leave management', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('creates, updates, and lists leave types and their automatic policy', async () => {
    const { orgId, ownerAuth, employeeAuth, managerAuth } = await createTeam();

    const type = await createLeaveType(orgId, ownerAuth, {
      name: 'Casual Leave',
      description: 'Personal time off',
      requiresDocumentation: false,
    });

    expect(type.name).toBe('Casual Leave');
    expect(type.isActive).toBe(true);
    expect(type.isPaid).toBe(true);
    expect(type.requiresBalance).toBe(true);
    expect(type.allowNegativeBalance).toBe(false);
    expect(type.policy).toMatchObject({
      leaveTypeId: type.id,
      initialEntitlement: 0,
      accrualFrequency: 'NONE',
      workingDays: [1, 2, 3, 4, 5],
      isActive: true,
    });

    const duplicate = await request(app)
      .post(api(orgId, '/leave/types'))
      .set(ownerAuth.headers)
      .send({ name: 'casual leave' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('LEAVE_TYPE_NAME_CONFLICT');

    const employeeCreate = await request(app)
      .post(api(orgId, '/leave/types'))
      .set(employeeAuth.headers)
      .send({ name: 'Employee Type' });
    expect(employeeCreate.status).toBe(403);
    expect(employeeCreate.body.error.code).toBe('PERMISSION_DENIED');

    const managerCreate = await request(app)
      .post(api(orgId, '/leave/types'))
      .set(managerAuth.headers)
      .send({ name: 'Manager Type' });
    expect(managerCreate.status).toBe(403);

    const updated = await request(app)
      .patch(api(orgId, `/leave/types/${type.id}`))
      .set(ownerAuth.headers)
      .send({ description: 'Updated description', maxConsecutiveDays: 10 });
    expect(updated.status).toBe(200);
    expect(updated.body.data.leaveType.description).toBe('Updated description');
    expect(updated.body.data.leaveType.maxConsecutiveDays).toBe(10);

    const policy = await configurePolicy(orgId, ownerAuth, type.policy.id, {
      initialEntitlement: 20,
      carryForwardAllowance: 5,
      maxBalance: 30,
    });
    expect(policy.initialEntitlement).toBe(20);
    expect(policy.carryForwardAllowance).toBe(5);
    expect(policy.maxBalance).toBe(30);

    const managerPolicy = await request(app)
      .put(api(orgId, `/leave/policies/${type.policy.id}`))
      .set(managerAuth.headers)
      .send({ initialEntitlement: 100 });
    expect(managerPolicy.status).toBe(403);

    const employeeList = await request(app)
      .get(api(orgId, '/leave/types'))
      .set(employeeAuth.headers);
    expect(employeeList.status).toBe(200);
    expect(employeeList.body.data).toHaveLength(1);
    expect(employeeList.body.data[0].id).toBe(type.id);
    expect(employeeList.body.data[0].policy.initialEntitlement).toBe(20);
  });

  it('initializes an employee balance with a ledger breakdown', async () => {
    const { orgId, ownerAuth, employeeAuth, employee, managerAuth } = await createTeam();
    const type = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      ...currentPeriodConfig(),
      initialEntitlement: 20,
    });

    const response = await request(app)
      .get(api(orgId, `/leave/balances/me?leaveTypeId=${type.id}`))
      .set(employeeAuth.headers);
    expect(response.status).toBe(200);
    expect(response.body.data.timezone).toBe('UTC');
    expect(response.body.data.employeeId).toBe(employee.user.id);
    expect(response.body.data.balances).toHaveLength(1);

    const balance = response.body.data.balances[0];
    expect(balance.entitledBalance).toBe(20);
    expect(balance.availableBalance).toBe(20);
    expect(balance.pendingReserved).toBe(0);
    expect(balance.approvedConsumed).toBe(0);
    expect(balance.breakdown).toMatchObject({
      entitled: 20,
      accrued: 0,
      adjustments: 0,
      carriedForward: 0,
      approvedConsumed: 0,
      pendingReserved: 0,
      available: 20,
    });
    expect(balance.leaveType.id).toBe(type.id);
    expect(balance.ledger.map((entry: { kind: string }) => entry.kind)).toContain(
      'INITIAL_ENTITLEMENT',
    );

    const adminList = await request(app)
      .get(api(orgId, '/leave/balances?employeeId=' + employee.user.id))
      .set(ownerAuth.headers);
    expect(adminList.status).toBe(200);
    expect(adminList.body.meta.total).toBe(1);
    expect(adminList.body.data[0].employeeId).toBe(employee.user.id);

    const managerList = await request(app)
      .get(api(orgId, '/leave/balances'))
      .set(managerAuth.headers);
    expect(managerList.status).toBe(403);
  });

  it('lazily accrues the configured tranche on balance initialization', async () => {
    const { orgId, ownerAuth, employeeAuth } = await createTeam();
    const type = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      ...currentPeriodConfig(),
      initialEntitlement: 2,
      accrualFrequency: 'MONTHLY',
      accrualAmount: 1,
      accrualEffectiveFrom: currentMonthStart(),
      maxBalance: 10,
    });

    const response = await request(app)
      .get(api(orgId, `/leave/balances/me?leaveTypeId=${type.id}`))
      .set(employeeAuth.headers);
    expect(response.status).toBe(200);
    const balance = response.body.data.balances[0];
    expect(balance.accruedBalance).toBe(1);
    expect(balance.availableBalance).toBe(3);

    // Repeated reads must not double-credit.
    const again = await request(app)
      .get(api(orgId, `/leave/balances/me?leaveTypeId=${type.id}`))
      .set(employeeAuth.headers);
    expect(again.body.data.balances[0].accruedBalance).toBe(1);
    expect(again.body.data.balances[0].availableBalance).toBe(3);
  });

  it('reserves pending balance and converts it to consumption exactly once on approval', async () => {
    const { orgId, ownerAuth, employeeAuth, owner } = await createTeam();
    const { monday, friday } = monthsAheadMonday();
    const type = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      ...currentPeriodConfig(),
      initialEntitlement: 20,
    });

    const applied = await applyLeave(orgId, employeeAuth, {
      leaveTypeId: type.id,
      startDate: monday,
      endDate: friday,
      reason: 'Family trip',
    });
    expect(applied.status).toBe(201);
    const leave = applied.body.data.request;
    expect(leave.status).toBe('PENDING');
    expect(leave.units).toBe(5);
    expect(leave.balancePeriodStart).toMatch(/^\d{4}-\d{2}-01$/);

    let balance = await getBalance(orgId, employeeAuth, type.id, leave.balancePeriodStart);
    expect(balance.pendingReserved).toBe(5);
    expect(balance.availableBalance).toBe(15);
    expect(balance.approvedConsumed).toBe(0);

    const approved = await approve(orgId, ownerAuth, leave.id, 'Looks good');
    expect(approved.status).toBe(200);
    expect(approved.body.data.request.status).toBe('APPROVED');
    expect(approved.body.data.request.reviewedByUserId).toBe(owner.user.id);

    balance = await getBalance(orgId, employeeAuth, type.id, leave.balancePeriodStart);
    expect(balance.pendingReserved).toBe(0);
    expect(balance.approvedConsumed).toBe(5);
    expect(balance.availableBalance).toBe(15);

    // Re-approving returns the finalized request without deducting twice.
    const repeat = await approve(orgId, ownerAuth, leave.id);
    expect(repeat.status).toBe(200);
    expect(repeat.body.data.request.status).toBe('APPROVED');
    balance = await getBalance(orgId, employeeAuth, type.id, leave.balancePeriodStart);
    expect(balance.approvedConsumed).toBe(5);
    expect(balance.availableBalance).toBe(15);

    const kinds = balance.ledger.map((entry: { kind: string }) => entry.kind);
    expect(kinds).toContain('RESERVATION');
    expect(kinds).toContain('CONSUMPTION');
    expect(kinds.filter((kind: string) => kind === 'CONSUMPTION')).toHaveLength(1);
  });

  it('rejects applications that exceed the available balance', async () => {
    const { orgId, ownerAuth, employeeAuth } = await createTeam();
    const { monday, tuesday } = monthsAheadMonday();
    const type = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      ...currentPeriodConfig(),
      initialEntitlement: 1,
    });

    const insufficient = await applyLeave(orgId, employeeAuth, {
      leaveTypeId: type.id,
      startDate: monday,
      endDate: tuesday,
      reason: 'Two days requested',
    });
    expect(insufficient.status).toBe(409);
    expect(insufficient.body.error.code).toBe('INSUFFICIENT_LEAVE_BALANCE');

    const zeroType = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, zeroType.policy.id, {
      ...currentPeriodConfig(),
      initialEntitlement: 0,
    });
    const zero = await applyLeave(orgId, employeeAuth, {
      leaveTypeId: zeroType.id,
      startDate: monday,
      endDate: monday,
      reason: 'No balance available',
    });
    expect(zero.status).toBe(409);
    expect(zero.body.error.code).toBe('INSUFFICIENT_LEAVE_BALANCE');
  });

  it('prevents pending reservations from being overspent', async () => {
    const { orgId, ownerAuth, employeeAuth } = await createTeam();
    const { monday, tuesday, wednesday, thursday, friday, nextMonday } =
      monthsAheadMonday();
    const type = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      ...currentPeriodConfig(),
      initialEntitlement: 5,
    });

    const first = await applyLeave(orgId, employeeAuth, {
      leaveTypeId: type.id,
      startDate: monday,
      endDate: wednesday,
      reason: 'First block',
    });
    expect(first.status).toBe(201);
    const second = await applyLeave(orgId, employeeAuth, {
      leaveTypeId: type.id,
      startDate: thursday,
      endDate: friday,
      reason: 'Second block',
    });
    expect(second.status).toBe(201);

    const balance = await getBalance(
      orgId,
      employeeAuth,
      type.id,
      first.body.data.request.balancePeriodStart,
    );
    expect(balance.pendingReserved).toBe(5);
    expect(balance.availableBalance).toBe(0);

    const third = await applyLeave(orgId, employeeAuth, {
      leaveTypeId: type.id,
      startDate: nextMonday,
      endDate: nextMonday,
      reason: 'One day too many',
    });
    expect(third.status).toBe(409);
    expect(third.body.error.code).toBe('INSUFFICIENT_LEAVE_BALANCE');
  });

  it('releases reserved balance when a pending request is rejected', async () => {
    const { orgId, ownerAuth, employeeAuth } = await createTeam();
    const { monday, tuesday } = monthsAheadMonday();
    const type = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      ...currentPeriodConfig(),
      initialEntitlement: 10,
    });

    const applied = await applyLeave(orgId, employeeAuth, {
      leaveTypeId: type.id,
      startDate: monday,
      endDate: tuesday,
      reason: 'Short break',
    });
    const leave = applied.body.data.request;
    let balance = await getBalance(orgId, employeeAuth, type.id, leave.balancePeriodStart);
    expect(balance.pendingReserved).toBe(2);
    expect(balance.availableBalance).toBe(8);

    const rejected = await reject(orgId, ownerAuth, leave.id, 'Coverage required');
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.request.status).toBe('REJECTED');
    expect(rejected.body.data.request.rejectionReason).toBe('Coverage required');

    balance = await getBalance(orgId, employeeAuth, type.id, leave.balancePeriodStart);
    expect(balance.pendingReserved).toBe(0);
    expect(balance.availableBalance).toBe(10);
    expect(balance.approvedConsumed).toBe(0);

    const repeat = await reject(orgId, ownerAuth, leave.id);
    expect(repeat.status).toBe(200);
    balance = await getBalance(orgId, employeeAuth, type.id, leave.balancePeriodStart);
    expect(balance.availableBalance).toBe(10);

    const lateApproval = await approve(orgId, ownerAuth, leave.id);
    expect(lateApproval.status).toBe(409);
    expect(lateApproval.body.error.code).toBe('LEAVE_REQUEST_NOT_PENDING');
  });

  it('releases reserved balance when a pending request is cancelled', async () => {
    const { orgId, ownerAuth, employeeAuth } = await createTeam();
    const { monday, tuesday } = monthsAheadMonday();
    const type = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      ...currentPeriodConfig(),
      initialEntitlement: 10,
    });

    const applied = await applyLeave(orgId, employeeAuth, {
      leaveTypeId: type.id,
      startDate: monday,
      endDate: tuesday,
      reason: 'Planned break',
    });
    const leave = applied.body.data.request;

    const cancelled = await cancel(orgId, employeeAuth, leave.id, 'Plans changed');
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.request.status).toBe('CANCELLED');
    expect(cancelled.body.data.request.cancelledByUserId).toBe(
      applied.body.data.request.employeeId,
    );

    const balance = await getBalance(orgId, employeeAuth, type.id, leave.balancePeriodStart);
    expect(balance.pendingReserved).toBe(0);
    expect(balance.availableBalance).toBe(10);

    const repeat = await cancel(orgId, employeeAuth, leave.id);
    expect(repeat.status).toBe(409);
    expect(repeat.body.error.code).toBe('LEAVE_REQUEST_NOT_CANCELLABLE');
  });

  it('restores approved consumption exactly once when an approved request is cancelled', async () => {
    const { orgId, ownerAuth, employeeAuth } = await createTeam();
    const { monday, friday } = monthsAheadMonday();
    const type = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      ...currentPeriodConfig(),
      initialEntitlement: 20,
    });

    const applied = await applyLeave(orgId, employeeAuth, {
      leaveTypeId: type.id,
      startDate: monday,
      endDate: friday,
      reason: 'Vacation',
    });
    const leave = applied.body.data.request;
    await approve(orgId, ownerAuth, leave.id);

    let balance = await getBalance(orgId, employeeAuth, type.id, leave.balancePeriodStart);
    expect(balance.approvedConsumed).toBe(5);
    expect(balance.availableBalance).toBe(15);

    const cancelled = await cancel(orgId, employeeAuth, leave.id, 'Trip cancelled');
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.request.status).toBe('CANCELLED');

    balance = await getBalance(orgId, employeeAuth, type.id, leave.balancePeriodStart);
    expect(balance.approvedConsumed).toBe(0);
    expect(balance.pendingReserved).toBe(0);
    expect(balance.availableBalance).toBe(20);

    const restores = balance.ledger.filter(
      (entry: { kind: string; leaveRequestId: string | null }) =>
        entry.kind === 'CONSUMPTION_RESTORE' && entry.leaveRequestId === leave.id,
    );
    expect(restores).toHaveLength(1);

    const repeat = await cancel(orgId, employeeAuth, leave.id);
    expect(repeat.status).toBe(409);
    expect(repeat.body.error.code).toBe('LEAVE_REQUEST_NOT_CANCELLABLE');
  });

  it('supports cancellation approval flows and rejects cancellation requests', async () => {
    const { orgId, ownerAuth, employeeAuth } = await createTeam();
    const { monday, tuesday } = monthsAheadMonday();
    const type = await createLeaveType(orgId, ownerAuth, {
      cancellationRequiresApproval: true,
    });
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      ...currentPeriodConfig(),
      initialEntitlement: 10,
    });

    const applied = await applyLeave(orgId, employeeAuth, {
      leaveTypeId: type.id,
      startDate: monday,
      endDate: tuesday,
      reason: 'Planned break',
    });
    const leave = applied.body.data.request;
    await approve(orgId, ownerAuth, leave.id);

    const requested = await cancel(orgId, employeeAuth, leave.id, 'Need to work');
    expect(requested.status).toBe(200);
    expect(requested.body.data.request.status).toBe('CANCELLATION_REQUESTED');

    let balance = await getBalance(orgId, employeeAuth, type.id, leave.balancePeriodStart);
    expect(balance.approvedConsumed).toBe(2);
    expect(balance.availableBalance).toBe(8);

    // Repeating the request is idempotent for the employee.
    const repeat = await cancel(orgId, employeeAuth, leave.id);
    expect(repeat.status).toBe(200);
    expect(repeat.body.data.request.status).toBe('CANCELLATION_REQUESTED');

    const rejected = await reject(orgId, ownerAuth, leave.id, 'Cancellation denied');
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.request.status).toBe('APPROVED');
    expect(rejected.body.data.request.cancellationRequestedAt).toBeNull();

    balance = await getBalance(orgId, employeeAuth, type.id, leave.balancePeriodStart);
    expect(balance.approvedConsumed).toBe(2);

    const employeeCancel = await cancel(orgId, employeeAuth, leave.id, 'Trying again');
    expect(employeeCancel.status).toBe(200);
    expect(employeeCancel.body.data.request.status).toBe('CANCELLATION_REQUESTED');

    const finalized = await cancel(orgId, ownerAuth, leave.id, 'Approved by admin');
    expect(finalized.status).toBe(200);
    expect(finalized.body.data.request.status).toBe('CANCELLED');

    balance = await getBalance(orgId, employeeAuth, type.id, leave.balancePeriodStart);
    expect(balance.approvedConsumed).toBe(0);
    expect(balance.availableBalance).toBe(10);
  });

  it('refuses to cancel approved leave when the type disallows it', async () => {
    const { orgId, ownerAuth, employeeAuth } = await createTeam();
    const { monday } = monthsAheadMonday();
    const type = await createLeaveType(orgId, ownerAuth, {
      allowApprovedCancellation: false,
    });
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      ...currentPeriodConfig(),
      initialEntitlement: 5,
    });

    const applied = await applyLeave(orgId, employeeAuth, {
      leaveTypeId: type.id,
      startDate: monday,
      endDate: monday,
      reason: 'One day',
    });
    const leave = applied.body.data.request;
    await approve(orgId, ownerAuth, leave.id);

    const cancelled = await cancel(orgId, employeeAuth, leave.id);
    expect(cancelled.status).toBe(409);
    expect(cancelled.body.error.code).toBe('LEAVE_REQUEST_NOT_CANCELLABLE');
  });

  it('records audited administrator credit and debit adjustments', async () => {
    const { orgId, ownerAuth, employeeAuth, employee, managerAuth } = await createTeam();
    const type = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      ...currentPeriodConfig(),
      initialEntitlement: 10,
    });
    // Materialize the balance before adjusting.
    await request(app)
      .get(api(orgId, `/leave/balances/me?leaveTypeId=${type.id}`))
      .set(employeeAuth.headers);

    const credit = await request(app)
      .post(api(orgId, `/leave/balances/${employee.user.id}/adjustments`))
      .set(ownerAuth.headers)
      .send({ leaveTypeId: type.id, amount: 2.5, reason: 'Recognition day' });
    expect(credit.status).toBe(200);
    expect(credit.body.data.balance.adjustmentBalance).toBe(2.5);
    expect(credit.body.data.balance.availableBalance).toBe(12.5);

    const debit = await request(app)
      .post(api(orgId, `/leave/balances/${employee.user.id}/adjustments`))
      .set(ownerAuth.headers)
      .send({ leaveTypeId: type.id, amount: -3, reason: 'Correction' });
    expect(debit.status).toBe(200);
    expect(debit.body.data.balance.adjustmentBalance).toBe(-0.5);
    expect(debit.body.data.balance.availableBalance).toBe(9.5);

    const negative = await request(app)
      .post(api(orgId, `/leave/balances/${employee.user.id}/adjustments`))
      .set(ownerAuth.headers)
      .send({ leaveTypeId: type.id, amount: -50, reason: 'Too much' });
    expect(negative.status).toBe(409);
    expect(negative.body.error.code).toBe('LEAVE_BALANCE_NEGATIVE_NOT_ALLOWED');

    const employeeAdjust = await request(app)
      .post(api(orgId, `/leave/balances/${employee.user.id}/adjustments`))
      .set(employeeAuth.headers)
      .send({ leaveTypeId: type.id, amount: 1, reason: 'Self credit' });
    expect(employeeAdjust.status).toBe(403);

    const managerAdjust = await request(app)
      .post(api(orgId, `/leave/balances/${employee.user.id}/adjustments`))
      .set(managerAuth.headers)
      .send({ leaveTypeId: type.id, amount: 1, reason: 'Manager credit' });
    expect(managerAdjust.status).toBe(403);

    const audit = await request(app)
      .get(api(orgId, '/leave/audit?action=LEAVE_BALANCE_ADJUSTED'))
      .set(ownerAuth.headers);
    expect(audit.status).toBe(200);
    expect(audit.body.meta.total).toBe(2);
    expect(audit.body.data[0].metadata.leaveTypeId).toBe(type.id);

    const employeeAudit = await request(app)
      .get(api(orgId, '/leave/audit'))
      .set(employeeAuth.headers);
    expect(employeeAudit.status).toBe(403);
  });

  it('enforces the configured maximum balance on adjustments', async () => {
    const { orgId, ownerAuth, employeeAuth, employee } = await createTeam();
    const type = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      ...currentPeriodConfig(),
      initialEntitlement: 10,
      maxBalance: 10,
    });
    await request(app)
      .get(api(orgId, `/leave/balances/me?leaveTypeId=${type.id}`))
      .set(employeeAuth.headers);

    const capped = await request(app)
      .post(api(orgId, `/leave/balances/${employee.user.id}/adjustments`))
      .set(ownerAuth.headers)
      .send({ leaveTypeId: type.id, amount: 5, reason: 'Cap test' });
    expect(capped.status).toBe(409);
    expect(capped.body.error.code).toBe('LEAVE_BALANCE_CAP_EXCEEDED');
  });

  it('prevents overlapping requests and invalid date ranges', async () => {
    const { orgId, ownerAuth, employeeAuth } = await createTeam();
    const { monday, tuesday, wednesday, thursday } = monthsAheadMonday();
    const type = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      ...currentPeriodConfig(),
      initialEntitlement: 10,
    });

    const first = await applyLeave(orgId, employeeAuth, {
      leaveTypeId: type.id,
      startDate: monday,
      endDate: wednesday,
      reason: 'First',
    });
    expect(first.status).toBe(201);

    const overlap = await applyLeave(orgId, employeeAuth, {
      leaveTypeId: type.id,
      startDate: tuesday,
      endDate: thursday,
      reason: 'Overlapping',
    });
    expect(overlap.status).toBe(409);
    expect(overlap.body.error.code).toBe('LEAVE_REQUEST_OVERLAP');

    const backwards = await applyLeave(orgId, employeeAuth, {
      leaveTypeId: type.id,
      startDate: thursday,
      endDate: monday,
      reason: 'Backwards',
    });
    expect(backwards.status).toBe(422);
    expect(backwards.body.error.code).toBe('VALIDATION_ERROR');

    const halfDayConflict = await applyLeave(orgId, employeeAuth, {
      leaveTypeId: type.id,
      startDate: thursday,
      endDate: thursday,
      startHalfDay: true,
      endHalfDay: true,
      reason: 'Half twice',
    });
    expect(halfDayConflict.status).toBe(422);
    expect(halfDayConflict.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('calculates working days with holidays and half-days', async () => {
    const { orgId, ownerAuth, employeeAuth } = await createTeam();
    const { monday, tuesday, wednesday, friday } = monthsAheadMonday();
    const type = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      ...currentPeriodConfig(),
      initialEntitlement: 20,
    });

    const holiday = await request(app)
      .post(api(orgId, '/leave/holidays'))
      .set(ownerAuth.headers)
      .send({ holidayDate: wednesday, name: 'Company Holiday' });
    expect(holiday.status).toBe(201);

    const fullWeek = await applyLeave(orgId, employeeAuth, {
      leaveTypeId: type.id,
      startDate: monday,
      endDate: friday,
      reason: 'Week off',
    });
    expect(fullWeek.status).toBe(201);
    expect(fullWeek.body.data.request.units).toBe(4);
    expect(
      fullWeek.body.data.request.chargedDates.map((day: { date: string }) => day.date),
    ).not.toContain(wednesday);

    const halfDays = await applyLeave(orgId, employeeAuth, {
      leaveTypeId: type.id,
      startDate: monday,
      endDate: tuesday,
      startHalfDay: true,
      reason: 'Half Monday',
    });
    // Overlaps the first request, so this must be rejected before units matter.
    expect(halfDays.status).toBe(409);
    expect(halfDays.body.error.code).toBe('LEAVE_REQUEST_OVERLAP');

    const cancelled = await cancel(orgId, employeeAuth, fullWeek.body.data.request.id);
    expect(cancelled.status).toBe(200);

    const half = await applyLeave(orgId, employeeAuth, {
      leaveTypeId: type.id,
      startDate: monday,
      endDate: tuesday,
      startHalfDay: true,
      reason: 'Half Monday',
    });
    expect(half.status).toBe(201);
    expect(half.body.data.request.units).toBe(1.5);
  });

  it('supports leave types that do not require a balance', async () => {
    const { orgId, ownerAuth, employeeAuth } = await createTeam();
    const { monday, tuesday } = monthsAheadMonday();
    const type = await createLeaveType(orgId, ownerAuth, {
      name: 'Unpaid Leave',
      isPaid: false,
      requiresBalance: false,
    });
    expect(type.policy).toBeDefined();

    const applied = await applyLeave(orgId, employeeAuth, {
      leaveTypeId: type.id,
      startDate: monday,
      endDate: tuesday,
      reason: 'Personal matters',
    });
    expect(applied.status).toBe(201);
    const leave = applied.body.data.request;
    expect(leave.units).toBe(2);
    expect(leave.balancePeriodStart).toBeNull();
    expect(leave.leaveType.isPaid).toBe(false);
    expect(leave.leaveType.requiresBalance).toBe(false);

    const approved = await approve(orgId, ownerAuth, leave.id);
    expect(approved.status).toBe(200);
    expect(approved.body.data.request.status).toBe('APPROVED');

    const cancelled = await cancel(orgId, employeeAuth, leave.id);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.request.status).toBe('CANCELLED');

    const balances = await request(app)
      .get(api(orgId, `/leave/balances/me?leaveTypeId=${type.id}`))
      .set(employeeAuth.headers);
    expect(balances.status).toBe(200);
    expect(balances.body.data.balances).toHaveLength(0);

    const adjustment = await request(app)
      .post(api(orgId, `/leave/balances/${applied.body.data.request.employeeId}/adjustments`))
      .set(ownerAuth.headers)
      .send({ leaveTypeId: type.id, amount: 1, reason: 'Not applicable' });
    expect(adjustment.status).toBe(422);
    expect(adjustment.body.error.code).toBe('LEAVE_BALANCE_NOT_APPLICABLE');
  });

  it('rejects inactive leave types, inactive memberships, and inactive employees', async () => {
    const { orgId, ownerAuth, employeeAuth, employee, otherEmployee } = await createTeam();
    const { monday } = monthsAheadMonday();
    const type = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      ...currentPeriodConfig(),
      initialEntitlement: 5,
    });

    const deactivated = await request(app)
      .patch(api(orgId, `/leave/types/${type.id}`))
      .set(ownerAuth.headers)
      .send({ isActive: false });
    expect(deactivated.status).toBe(200);

    const employeeTypes = await request(app)
      .get(api(orgId, '/leave/types'))
      .set(employeeAuth.headers);
    expect(employeeTypes.body.data).toHaveLength(0);

    const inactiveType = await applyLeave(orgId, employeeAuth, {
      leaveTypeId: type.id,
      startDate: monday,
      endDate: monday,
      reason: 'Inactive type',
    });
    expect(inactiveType.status).toBe(409);
    expect(inactiveType.body.error.code).toBe('LEAVE_TYPE_INACTIVE');

    await Membership.update(
      { status: 'SUSPENDED' },
      { where: { organizationId: orgId, userId: employee.user.id } },
    );
    const inactiveMembership = await applyLeave(orgId, employeeAuth, {
      leaveTypeId: type.id,
      startDate: monday,
      endDate: monday,
      reason: 'Inactive membership',
    });
    expect(inactiveMembership.status).toBe(403);
    expect(inactiveMembership.body.error.code).toBe('MEMBERSHIP_INACTIVE');

    await User.update({ status: 'DISABLED' }, { where: { id: otherEmployee.user.id } });
    const inactiveEmployee = await request(app)
      .post(api(orgId, `/leave/balances/${otherEmployee.user.id}/adjustments`))
      .set(ownerAuth.headers)
      .send({ leaveTypeId: type.id, amount: 1, reason: 'Inactive employee' });
    expect(inactiveEmployee.status).toBe(403);
    expect(inactiveEmployee.body.error.code).toBe('EMPLOYEE_INACTIVE');
  });

  it('blocks switching the balance requirement while active requests exist', async () => {
    const { orgId, ownerAuth, employeeAuth } = await createTeam();
    const { monday } = monthsAheadMonday();
    const type = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      ...currentPeriodConfig(),
      initialEntitlement: 5,
    });

    const applied = await applyLeave(orgId, employeeAuth, {
      leaveTypeId: type.id,
      startDate: monday,
      endDate: monday,
      reason: 'Pending request',
    });
    expect(applied.status).toBe(201);

    const blocked = await request(app)
      .patch(api(orgId, `/leave/types/${type.id}`))
      .set(ownerAuth.headers)
      .send({ requiresBalance: false });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('LEAVE_TYPE_IN_USE');

    const deactivated = await request(app)
      .patch(api(orgId, `/leave/types/${type.id}`))
      .set(ownerAuth.headers)
      .send({ isActive: false, maxConsecutiveDays: 5 });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.data.leaveType.isActive).toBe(false);
  });

  it('enforces employee self-access and organization isolation', async () => {
    const {
      orgId,
      ownerAuth,
      employee,
      employeeAuth,
      otherEmployeeAuth,
    } = await createTeam();
    const { monday } = monthsAheadMonday();
    const type = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      ...currentPeriodConfig(),
      initialEntitlement: 5,
    });

    const applied = await applyLeave(orgId, employeeAuth, {
      leaveTypeId: type.id,
      startDate: monday,
      endDate: monday,
      reason: 'Personal day',
    });
    const leave = applied.body.data.request;

    const crossRequest = await request(app)
      .get(api(orgId, `/leave/requests/${leave.id}`))
      .set(otherEmployeeAuth.headers);
    expect(crossRequest.status).toBe(404);
    expect(crossRequest.body.error.code).toBe('LEAVE_REQUEST_NOT_FOUND');

    const crossBalance = await request(app)
      .get(api(orgId, `/leave/balances/${employee.user.id}`))
      .set(otherEmployeeAuth.headers);
    expect(crossBalance.status).toBe(404);
    expect(crossBalance.body.error.code).toBe('LEAVE_BALANCE_NOT_FOUND');

    const ownList = await request(app)
      .get(api(orgId, `/leave/requests?employeeId=${employee.user.id}`))
      .set(otherEmployeeAuth.headers);
    expect(ownList.status).toBe(200);
    expect(ownList.body.data).toHaveLength(0);

    const otherOwner = await createOwner(uniqueEmail('leave-other-owner'), 'Other Leave Org');
    const otherOwnerAuth = await desktopAuth(otherOwner.email);
    const otherOrgId = otherOwner.organization.id;

    const foreignRequest = await request(app)
      .get(api(otherOrgId, `/leave/requests/${leave.id}`))
      .set(otherOwnerAuth.headers);
    expect(foreignRequest.status).toBe(404);

    const foreignAdjustment = await request(app)
      .post(api(otherOrgId, `/leave/balances/${employee.user.id}/adjustments`))
      .set(otherOwnerAuth.headers)
      .send({ leaveTypeId: type.id, amount: 1, reason: 'Cross org' });
    expect(foreignAdjustment.status).toBe(404);
    expect(foreignAdjustment.body.error.code).toBe('EMPLOYEE_NOT_FOUND');

    const wrongOrgPath = await request(app)
      .get(api(otherOrgId, '/leave/types'))
      .set(employeeAuth.headers);
    expect(wrongOrgPath.status).toBe(404);
    expect(wrongOrgPath.body.error.code).toBe('ORGANIZATION_NOT_FOUND');
  });

  it('restricts review and management actions by role', async () => {
    const { orgId, ownerAuth, employeeAuth, managerAuth, owner } = await createTeam();
    const { monday } = monthsAheadMonday();
    const type = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      ...currentPeriodConfig(),
      initialEntitlement: 5,
    });

    const applied = await applyLeave(orgId, employeeAuth, {
      leaveTypeId: type.id,
      startDate: monday,
      endDate: monday,
      reason: 'Personal day',
    });
    const leave = applied.body.data.request;

    const employeeApprove = await approve(orgId, employeeAuth, leave.id);
    expect(employeeApprove.status).toBe(403);
    expect(employeeApprove.body.error.code).toBe('PERMISSION_DENIED');

    const managerApprove = await approve(orgId, managerAuth, leave.id);
    expect(managerApprove.status).toBe(403);

    const managerView = await request(app)
      .get(api(orgId, `/leave/requests/${leave.id}`))
      .set(managerAuth.headers);
    expect(managerView.status).toBe(404);

    const managerList = await request(app)
      .get(api(orgId, '/leave/requests'))
      .set(managerAuth.headers);
    expect(managerList.status).toBe(200);
    expect(managerList.body.data).toHaveLength(0);

    const ownerList = await request(app)
      .get(api(orgId, '/leave/requests'))
      .set(ownerAuth.headers);
    expect(ownerList.status).toBe(200);
    expect(ownerList.body.data).toHaveLength(1);

    const ownerApprove = await approve(orgId, ownerAuth, leave.id);
    expect(ownerApprove.status).toBe(200);
    expect(ownerApprove.body.data.request.reviewedByUserId).toBe(owner.user.id);
  });

  it('forbids self-approval', async () => {
    const { orgId, ownerAuth } = await createTeam();
    const { monday } = monthsAheadMonday();
    const type = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      ...currentPeriodConfig(),
      initialEntitlement: 5,
    });

    const applied = await applyLeave(orgId, ownerAuth, {
      leaveTypeId: type.id,
      startDate: monday,
      endDate: monday,
      reason: 'Owner leave',
    });
    expect(applied.status).toBe(201);

    const selfApprove = await approve(orgId, ownerAuth, applied.body.data.request.id);
    expect(selfApprove.status).toBe(403);
    expect(selfApprove.body.error.code).toBe('SELF_APPROVAL_FORBIDDEN');
  });

  it('validates notice periods, maximum consecutive days, and documentation', async () => {
    const { orgId, ownerAuth, employeeAuth } = await createTeam();
    const { monday, tuesday, wednesday } = monthsAheadMonday();

    const noticeType = await createLeaveType(orgId, ownerAuth, { minNoticeDays: 30 });
    await configurePolicy(orgId, ownerAuth, noticeType.policy.id, {
      ...currentPeriodConfig(),
      initialEntitlement: 10,
    });
    const shortNotice = await applyLeave(orgId, employeeAuth, {
      leaveTypeId: noticeType.id,
      startDate: monday,
      endDate: monday,
      reason: 'Short notice',
    });
    expect(shortNotice.status).toBe(422);
    expect(shortNotice.body.error.code).toBe('LEAVE_MIN_NOTICE_NOT_MET');

    const maxType = await createLeaveType(orgId, ownerAuth, { maxConsecutiveDays: 2 });
    await configurePolicy(orgId, ownerAuth, maxType.policy.id, {
      ...currentPeriodConfig(),
      initialEntitlement: 10,
    });
    const tooLong = await applyLeave(orgId, employeeAuth, {
      leaveTypeId: maxType.id,
      startDate: monday,
      endDate: wednesday,
      reason: 'Too long',
    });
    expect(tooLong.status).toBe(422);
    expect(tooLong.body.error.code).toBe('LEAVE_MAX_CONSECUTIVE_DAYS_EXCEEDED');

    const docType = await createLeaveType(orgId, ownerAuth, {
      requiresDocumentation: true,
    });
    await configurePolicy(orgId, ownerAuth, docType.policy.id, {
      ...currentPeriodConfig(),
      initialEntitlement: 10,
    });
    const missingDoc = await applyLeave(orgId, employeeAuth, {
      leaveTypeId: docType.id,
      startDate: tuesday,
      endDate: tuesday,
      reason: 'Sick day',
    });
    expect(missingDoc.status).toBe(422);
    expect(missingDoc.body.error.code).toBe('LEAVE_DOCUMENTATION_REQUIRED');

    const withDoc = await applyLeave(orgId, employeeAuth, {
      leaveTypeId: docType.id,
      startDate: tuesday,
      endDate: tuesday,
      reason: 'Sick day',
      documentationReference: 'medical-note-123',
    });
    expect(withDoc.status).toBe(201);
    expect(withDoc.body.data.request.documentationReference).toBe('medical-note-123');
  });

  it('makes retries safe with an idempotency key', async () => {
    const { orgId, ownerAuth, employeeAuth } = await createTeam();
    const { monday } = monthsAheadMonday();
    const type = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      ...currentPeriodConfig(),
      initialEntitlement: 10,
    });

    const body = {
      leaveTypeId: type.id,
      startDate: monday,
      endDate: monday,
      reason: 'Idempotent request',
    };
    const first = await applyLeave(orgId, employeeAuth, body, 'retry-key-1');
    expect(first.status).toBe(201);
    const second = await applyLeave(orgId, employeeAuth, body, 'retry-key-1');
    expect(second.status).toBe(201);
    expect(second.body.data.request.id).toBe(first.body.data.request.id);

    const balance = await getBalance(
      orgId,
      employeeAuth,
      type.id,
      first.body.data.request.balancePeriodStart,
    );
    expect(balance.pendingReserved).toBe(1);

    const mismatch = await applyLeave(
      orgId,
      employeeAuth,
      { ...body, reason: 'Different request' },
      'retry-key-1',
    );
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('serializes competing requests against the same balance', async () => {
    const { orgId, ownerAuth, employeeAuth } = await createTeam();
    const { monday, friday, nextMonday, nextFriday } = monthsAheadMonday();
    const type = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      ...currentPeriodConfig(),
      initialEntitlement: 5,
    });

    const [first, second] = await Promise.all([
      applyLeave(orgId, employeeAuth, {
        leaveTypeId: type.id,
        startDate: monday,
        endDate: friday,
        reason: 'Week one',
      }),
      applyLeave(orgId, employeeAuth, {
        leaveTypeId: type.id,
        startDate: nextMonday,
        endDate: nextFriday,
        reason: 'Week two',
      }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);
    const failed = first.status === 409 ? first : second;
    expect(failed.body.error.code).toBe('INSUFFICIENT_LEAVE_BALANCE');

    const success = first.status === 201 ? first : second;
    const balance = await getBalance(
      orgId,
      employeeAuth,
      type.id,
      success.body.data.request.balancePeriodStart,
    );
    expect(balance.pendingReserved).toBe(5);
    expect(balance.availableBalance).toBe(0);
    expect(
      await LeaveLedgerEntry.count({
        where: { balanceId: balance.id, kind: 'RESERVATION' },
      }),
    ).toBe(1);
  });

  it('returns only the employee own requests with status filters', async () => {
    const { orgId, ownerAuth, employeeAuth, otherEmployeeAuth } = await createTeam();
    const { monday, tuesday } = monthsAheadMonday();
    const type = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      ...currentPeriodConfig(),
      initialEntitlement: 10,
    });

    const applied = await applyLeave(orgId, employeeAuth, {
      leaveTypeId: type.id,
      startDate: monday,
      endDate: tuesday,
      reason: 'Two days',
    });
    expect(applied.status).toBe(201);

    const own = await request(app)
      .get(api(orgId, '/leave/requests?status=PENDING'))
      .set(employeeAuth.headers);
    expect(own.status).toBe(200);
    expect(own.body.data).toHaveLength(1);
    expect(own.body.data[0].id).toBe(applied.body.data.request.id);

    const others = await request(app)
      .get(api(orgId, '/leave/requests'))
      .set(otherEmployeeAuth.headers);
    expect(others.status).toBe(200);
    expect(others.body.data).toHaveLength(0);
  });
});
