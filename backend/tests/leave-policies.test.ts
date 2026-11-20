import request from 'supertest';
import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  LeaveBalance,
  LeaveCreditTranche,
  LeaveLedgerEntry,
  LeaveRequestCreditAllocation,
  Organization,
} from '../src/database';
import { runLeaveAccrualSweep } from '../src/modules/leave/leaveAccrual.service';
import { balancePeriodFor, policyPeriodConfig } from '../src/modules/leave/leaveCalendar';
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

let typeCounter = 0;

function api(orgId: string, path: string): string {
  return `${API}/organizations/${orgId}${path}`;
}

/**
 * Tests run against a future month so "past date" validation and month
 * boundaries never make the suite flaky. The balance period is driven by the
 * policy reset mode rather than the real calendar.
 */
const target = DateTime.utc().plus({ months: 2 }).startOf('month');
const TARGET_MONTH = target.month;
const firstMonday = (() => {
  let day = target;
  while (day.weekday !== 1) day = day.plus({ days: 1 });
  return day;
})();
const MONDAY = firstMonday.toISODate()!;
const TUESDAY = firstMonday.plus({ days: 1 }).toISODate()!;
const WEDNESDAY = firstMonday.plus({ days: 2 }).toISODate()!;
const THURSDAY = firstMonday.plus({ days: 3 }).toISODate()!;
const FRIDAY = firstMonday.plus({ days: 4 }).toISODate()!;
const NEXT_MONDAY = firstMonday.plus({ days: 7 }).toISODate()!;
const TARGET_START = target.toISODate()!;
const TARGET_INSTANT = new Date(Date.UTC(target.year, TARGET_MONTH - 1, 5, 12, 0, 0));
const AFTER_EXPIRY_INSTANT = new Date(
  Date.UTC(target.year, TARGET_MONTH - 1, 5, 12, 0, 0) + 45 * 86_400_000,
);

async function createTeam() {
  const owner = await createOwner(uniqueEmail('policy-owner'), 'Policy Org');
  await Organization.update(
    { timezone: 'UTC' },
    { where: { id: owner.organization.id } },
  );
  const employee = await inviteAndAccept(owner, {
    role: 'EMPLOYEE',
    name: 'Policy Employee',
    email: uniqueEmail('policy-employee'),
  });
  const ownerAuth = await desktopAuth(owner.email);
  const employeeAuth = await desktopAuth(employee.email);
  return { owner, ownerAuth, employee, employeeAuth, orgId: owner.organization.id };
}

async function createLeaveType(
  orgId: string,
  auth: Auth,
  overrides: Record<string, unknown> = {},
) {
  typeCounter += 1;
  const name =
    (overrides.name as string | undefined) ??
    `Policy Leave ${typeCounter}-${Math.random().toString(36).slice(2, 7)}`;
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
  return response;
}

function applyLeave(orgId: string, auth: Auth, body: Record<string, unknown>) {
  return request(app).post(api(orgId, '/leave/requests')).set(auth.headers).send(body);
}

function approve(orgId: string, auth: Auth, requestId: string) {
  return request(app)
    .post(api(orgId, `/leave/requests/${requestId}/approve`))
    .set(auth.headers)
    .send({});
}

function reject(orgId: string, auth: Auth, requestId: string) {
  return request(app)
    .post(api(orgId, `/leave/requests/${requestId}/reject`))
    .set(auth.headers)
    .send({ reason: 'Not needed' });
}

function cancel(orgId: string, auth: Auth, requestId: string) {
  return request(app)
    .post(api(orgId, `/leave/requests/${requestId}/cancel`))
    .set(auth.headers)
    .send({ reason: 'Changed plans' });
}

async function findBalance(employeeId: string, leaveTypeId: string) {
  const balance = await LeaveBalance.findOne({
    where: { employeeId, leaveTypeId },
    order: [['periodStart', 'DESC']],
  });
  expect(balance).not.toBeNull();
  return balance!;
}

describe('flexible leave policy and credit tranches', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('stores and returns every new policy setting', async () => {
    const { ownerAuth, orgId } = await createTeam();
    const type = await createLeaveType(orgId, ownerAuth);

    const response = await configurePolicy(orgId, ownerAuth, type.policy.id, {
      initialEntitlement: 0,
      accrualFrequency: 'MONTHLY',
      accrualAmount: 3,
      accrualDayOfMonth: 1,
      accrualEffectiveFrom: TARGET_START,
      resetPeriod: 'CALENDAR_YEAR',
      carryForwardEnabled: true,
      carryForwardAllowance: 6,
      carryForwardExpiryMonths: 1,
      carryForwardOrder: 'EXPIRY_FIRST',
      maxBalance: 6,
      maxCreditsPerApplication: 2,
      monthlyUsageLimitEnabled: true,
      monthlyUsageLimit: 4,
    });
    expect(response.status).toBe(200);
    expect(response.body.data.policy).toMatchObject({
      carryForwardEnabled: true,
      carryForwardAllowance: 6,
      carryForwardExpiryMonths: 1,
      carryForwardOrder: 'EXPIRY_FIRST',
      resetPeriod: 'CALENDAR_YEAR',
      maxBalance: 6,
      maxCreditsPerApplication: 2,
      monthlyUsageLimitEnabled: true,
      monthlyUsageLimit: 4,
    });
  });

  it('validates impossible combinations and locks reset changes once balances exist', async () => {
    const { ownerAuth, orgId } = await createTeam();
    const type = await createLeaveType(orgId, ownerAuth);

    const missingLimit = await configurePolicy(orgId, ownerAuth, type.policy.id, {
      monthlyUsageLimitEnabled: true,
    });
    expect(missingLimit.status).toBe(422);
    expect(missingLimit.body.error.code).toBe('LEAVE_POLICY_MONTHLY_LIMIT_REQUIRED');

    const invalidCap = await configurePolicy(orgId, ownerAuth, type.policy.id, {
      maxCreditsPerApplication: 0,
    });
    expect(invalidCap.status).toBe(422);
    expect(invalidCap.body.error.code).toBe('LEAVE_POLICY_MAX_PER_APPLICATION_INVALID');

    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      resetPeriod: 'CALENDAR_YEAR',
      initialEntitlement: 1,
    });
    await runLeaveAccrualSweep({ now: TARGET_INSTANT, organizationId: orgId });

    const locked = await configurePolicy(orgId, ownerAuth, type.policy.id, {
      resetPeriod: 'NEVER',
    });
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe('LEAVE_POLICY_PERIOD_LOCKED');

    // A genuinely different schedule must stay locked too.
    const differentStart = await configurePolicy(orgId, ownerAuth, type.policy.id, {
      resetPeriod: 'CUSTOM',
      balancePeriodStartMonth: 4,
      balancePeriodStartDay: 1,
    });
    expect(differentStart.status).toBe(409);
    expect(differentStart.body.error.code).toBe('LEAVE_POLICY_PERIOD_LOCKED');
  });

  it('allows renaming an equivalent reset schedule while balances exist', async () => {
    const { ownerAuth, orgId } = await createTeam();
    const type = await createLeaveType(orgId, ownerAuth);

    // Default schedule is CUSTOM with a 1 January start, i.e. identical to
    // CALENDAR_YEAR. Owners must be able to select the named mode after
    // balances already exist.
    await configurePolicy(orgId, ownerAuth, type.policy.id, { initialEntitlement: 3 });
    await runLeaveAccrualSweep({ now: TARGET_INSTANT, organizationId: orgId });

    const balanced = await LeaveBalance.findAll({
      where: { organizationId: orgId, leaveTypeId: type.id },
    });
    expect(balanced.length).toBeGreaterThan(0);

    const equivalent = await configurePolicy(orgId, ownerAuth, type.policy.id, {
      resetPeriod: 'CALENDAR_YEAR',
    });
    expect(equivalent.status).toBe(200);
    expect(equivalent.body.data.policy.resetPeriod).toBe('CALENDAR_YEAR');

    // Re-saving the same schedule is a no-op, never a lock.
    const repeated = await configurePolicy(orgId, ownerAuth, type.policy.id, {
      resetPeriod: 'CALENDAR_YEAR',
      carryForwardEnabled: true,
      carryForwardAllowance: 6,
    });
    expect(repeated.status).toBe(200);
  });

  it('accrues a monthly tranche with an expiry and tracks reserve, consume, restore', async () => {
    const { ownerAuth, employeeAuth, employee, orgId } = await createTeam();
    const type = await createLeaveType(orgId, ownerAuth);
    const configured = await configurePolicy(orgId, ownerAuth, type.policy.id, {
      initialEntitlement: 0,
      accrualFrequency: 'MONTHLY',
      accrualAmount: 3,
      accrualDayOfMonth: 1,
      accrualEffectiveFrom: TARGET_START,
      resetPeriod: 'NEVER',
      carryForwardEnabled: true,
      carryForwardAllowance: 6,
      carryForwardExpiryMonths: 1,
      maxBalance: 6,
      maxCreditsPerApplication: 2,
    });
    expect(configured.status).toBe(200);

    await runLeaveAccrualSweep({ now: TARGET_INSTANT, organizationId: orgId });

    const balance = await findBalance(employee.user.id, type.id);
    expect(Number(balance.accruedBalance)).toBe(3);
    expect(Number(balance.availableBalance)).toBe(3);

    const tranches = await LeaveCreditTranche.findAll({ where: { balanceId: balance.id } });
    expect(tranches).toHaveLength(1);
    expect(tranches[0]!.sourceKind).toBe('ACCRUAL');
    expect(Number(tranches[0]!.allocated)).toBe(3);
    expect(tranches[0]!.expiryReason).toBe('MONTHLY_RESET');
    expect(tranches[0]!.expiresAt).toBe(
      DateTime.fromISO(TARGET_START).plus({ months: 1 }).toISODate(),
    );

    const applied = await applyLeave(orgId, employeeAuth, {
      leaveTypeId: type.id,
      startDate: MONDAY,
      endDate: MONDAY,
      startHalfDay: false,
      endHalfDay: false,
      reason: 'Family appointment',
    });
    expect(applied.status).toBe(201);
    const requestId = applied.body.data.request.id;

    const allocations = await LeaveRequestCreditAllocation.findAll({
      where: { requestId },
    });
    expect(allocations).toHaveLength(1);
    expect(allocations[0]!.trancheId).toBe(tranches[0]!.id);
    expect(Number(allocations[0]!.reservedUnits)).toBe(1);

    const approved = await approve(orgId, ownerAuth, requestId);
    expect(approved.status).toBe(200);
    const afterApprove = await LeaveCreditTranche.findByPk(tranches[0]!.id);
    expect(Number(afterApprove!.reserved)).toBe(0);
    expect(Number(afterApprove!.consumed)).toBe(1);

    const cancelled = await cancel(orgId, ownerAuth, requestId);
    expect(cancelled.status).toBe(200);
    const afterCancel = await LeaveCreditTranche.findByPk(tranches[0]!.id);
    expect(Number(afterCancel!.consumed)).toBe(0);
    expect(Number(afterCancel!.reserved)).toBe(0);

    const restoredBalance = await findBalance(employee.user.id, type.id);
    expect(Number(restoredBalance.approvedConsumed)).toBe(0);
    expect(Number(restoredBalance.availableBalance)).toBe(3);
  });

  it('enforces the maximum credits per application', async () => {
    const { ownerAuth, employeeAuth, orgId } = await createTeam();
    const type = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      initialEntitlement: 10,
      resetPeriod: 'NEVER',
      maxCreditsPerApplication: 2,
    });

    const response = await applyLeave(orgId, employeeAuth, {
      leaveTypeId: type.id,
      startDate: MONDAY,
      endDate: WEDNESDAY,
      startHalfDay: false,
      endHalfDay: false,
      reason: 'Long weekend',
    });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('LEAVE_MAX_CREDITS_PER_APPLICATION_EXCEEDED');
  });

  it('counts pending and approved requests against the monthly usage limit', async () => {
    const { ownerAuth, employeeAuth, orgId } = await createTeam();
    const type = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      initialEntitlement: 20,
      resetPeriod: 'NEVER',
      monthlyUsageLimitEnabled: true,
      monthlyUsageLimit: 4,
    });

    const first = await applyLeave(orgId, employeeAuth, {
      leaveTypeId: type.id,
      startDate: MONDAY,
      endDate: TUESDAY,
      startHalfDay: false,
      endHalfDay: false,
      reason: 'Trip',
    });
    expect(first.status).toBe(201);

    const second = await applyLeave(orgId, employeeAuth, {
      leaveTypeId: type.id,
      startDate: WEDNESDAY,
      endDate: THURSDAY,
      startHalfDay: false,
      endHalfDay: false,
      reason: 'Trip part two',
    });
    expect(second.status).toBe(201);

    const overLimit = await applyLeave(orgId, employeeAuth, {
      leaveTypeId: type.id,
      startDate: FRIDAY,
      endDate: FRIDAY,
      startHalfDay: false,
      endHalfDay: false,
      reason: 'Extra day',
    });
    expect(overLimit.status).toBe(409);
    expect(overLimit.body.error.code).toBe('LEAVE_MONTHLY_USAGE_LIMIT_EXCEEDED');

    // Rejected requests must stop counting.
    const rejected = await reject(orgId, ownerAuth, second.body.data.request.id);
    expect(rejected.status).toBe(200);

    const allowedAgain = await applyLeave(orgId, employeeAuth, {
      leaveTypeId: type.id,
      startDate: FRIDAY,
      endDate: FRIDAY,
      startHalfDay: false,
      endHalfDay: false,
      reason: 'Extra day retry',
    });
    expect(allowedAgain.status).toBe(201);
  });

  it('counts half days as 0.5 against the monthly usage limit', async () => {
    const { ownerAuth, employeeAuth, orgId } = await createTeam();
    const type = await createLeaveType(orgId, ownerAuth, { allowHalfDay: true });
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      initialEntitlement: 10,
      resetPeriod: 'NEVER',
      monthlyUsageLimitEnabled: true,
      monthlyUsageLimit: 1,
    });

    for (const date of [MONDAY, TUESDAY]) {
      const response = await applyLeave(orgId, employeeAuth, {
        leaveTypeId: type.id,
        startDate: date,
        endDate: date,
        startHalfDay: true,
        endHalfDay: false,
        reason: 'Half day',
      });
      expect(response.status).toBe(201);
    }

    const overLimit = await applyLeave(orgId, employeeAuth, {
      leaveTypeId: type.id,
      startDate: WEDNESDAY,
      endDate: WEDNESDAY,
      startHalfDay: true,
      endHalfDay: false,
      reason: 'Third half day',
    });
    expect(overLimit.status).toBe(409);
    expect(overLimit.body.error.code).toBe('LEAVE_MONTHLY_USAGE_LIMIT_EXCEEDED');
  });

  it('expires credits, writes an EXPIRY ledger entry, and reduces availability', async () => {
    const { ownerAuth, employee, orgId } = await createTeam();
    const type = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      initialEntitlement: 0,
      accrualFrequency: 'MONTHLY',
      accrualAmount: 3,
      accrualDayOfMonth: 1,
      accrualEffectiveFrom: TARGET_START,
      resetPeriod: 'NEVER',
      carryForwardEnabled: true,
      carryForwardAllowance: 6,
      carryForwardExpiryMonths: 1,
    });

    await runLeaveAccrualSweep({ now: TARGET_INSTANT, organizationId: orgId });
    const balance = await findBalance(employee.user.id, type.id);
    expect(Number(balance.availableBalance)).toBe(3);

    // Advance past the expiry date; the sweep is the lazy materializer.
    await runLeaveAccrualSweep({ now: AFTER_EXPIRY_INSTANT, organizationId: orgId });

    const expiredBalance = await findBalance(employee.user.id, type.id);
    expect(Number(expiredBalance.expiredBalance)).toBeGreaterThanOrEqual(3);

    const expiryEntry = await LeaveLedgerEntry.findOne({
      where: { balanceId: balance.id, kind: 'EXPIRY' },
    });
    expect(expiryEntry).not.toBeNull();
    expect(Number(expiryEntry!.expiredDelta)).toBe(3);

    const oldTranche = await LeaveCreditTranche.findOne({
      where: { balanceId: balance.id, sourceKind: 'ACCRUAL' },
      order: [['periodAllocated', 'ASC']],
    });
    expect(Number(oldTranche!.expired)).toBe(3);
  });

  it('consumes the earliest-expiring tranche first', async () => {
    const { ownerAuth, employeeAuth, employee, orgId } = await createTeam();
    const type = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      initialEntitlement: 6,
      resetPeriod: 'NEVER',
      carryForwardEnabled: true,
      carryForwardOrder: 'EXPIRY_FIRST',
    });

    await runLeaveAccrualSweep({ now: TARGET_INSTANT, organizationId: orgId });
    const balance = await findBalance(employee.user.id, type.id);

    const primary = await LeaveCreditTranche.findOne({ where: { balanceId: balance.id } });
    expect(primary).not.toBeNull();

    const later = DateTime.fromISO(TARGET_START, { zone: 'utc' }).plus({ days: 30 }).toISODate()!;
    const sooner = DateTime.fromISO(TARGET_START, { zone: 'utc' }).plus({ days: 10 }).toISODate()!;
    await primary!.update({ expiresAt: later, expiryReason: 'ANNUAL_RESET' });

    const preferred = await LeaveCreditTranche.create({
      organizationId: orgId,
      employeeId: employee.user.id,
      leaveTypeId: type.id,
      balanceId: balance.id,
      sourceKind: 'LEGACY',
      periodAllocated: TARGET_START,
      allocated: 6,
      expiresAt: sooner,
      expiryReason: 'ANNUAL_RESET',
    });

    const applied = await applyLeave(orgId, employeeAuth, {
      leaveTypeId: type.id,
      startDate: MONDAY,
      endDate: MONDAY,
      startHalfDay: false,
      endHalfDay: false,
      reason: 'Earliest expiry first',
    });
    expect(applied.status).toBe(201);

    const allocation = await LeaveRequestCreditAllocation.findOne({
      where: { requestId: applied.body.data.request.id },
    });
    expect(allocation!.trancheId).toBe(preferred.id);
  });

  it('resolves reset modes deterministically', () => {
    const calendar = policyPeriodConfig({
      balancePeriodStartMonth: 4,
      balancePeriodStartDay: 15,
      resetPeriod: 'CALENDAR_YEAR',
    });
    expect(balancePeriodFor('2026-11-20', calendar, 'UTC')).toEqual({
      periodStart: '2026-01-01',
      periodEnd: '2026-12-31',
    });

    const never = policyPeriodConfig({
      balancePeriodStartMonth: 4,
      balancePeriodStartDay: 15,
      resetPeriod: 'NEVER',
    });
    expect(balancePeriodFor('2026-11-20', never, 'UTC')).toEqual({
      periodStart: '1970-01-01',
      periodEnd: '9999-12-31',
    });

    const anniversary = policyPeriodConfig(
      { balancePeriodStartMonth: 1, balancePeriodStartDay: 1, resetPeriod: 'JOINING_ANNIVERSARY' },
      '2024-06-10',
    );
    expect(balancePeriodFor('2026-11-20', anniversary, 'UTC')).toEqual({
      periodStart: '2026-06-10',
      periodEnd: '2027-06-09',
    });

    const financial = policyPeriodConfig({
      balancePeriodStartMonth: 4,
      balancePeriodStartDay: 1,
      resetPeriod: 'FINANCIAL_YEAR',
    });
    expect(balancePeriodFor('2026-11-20', financial, 'UTC')).toEqual({
      periodStart: '2026-04-01',
      periodEnd: '2027-03-31',
    });

    const custom = policyPeriodConfig({
      balancePeriodStartMonth: 7,
      balancePeriodStartDay: 15,
      resetPeriod: 'CUSTOM',
    });
    expect(balancePeriodFor('2026-11-20', custom, 'UTC')).toEqual({
      periodStart: '2026-07-15',
      periodEnd: '2027-07-14',
    });
  });

  it('keeps legacy carry-forward behaviour and never expires old credits', async () => {
    const { ownerAuth, employeeAuth, employee, orgId } = await createTeam();
    const type = await createLeaveType(orgId, ownerAuth);
    const response = await configurePolicy(orgId, ownerAuth, type.policy.id, {
      balancePeriodStartMonth: 1,
      balancePeriodStartDay: 1,
      carryForwardAllowance: 3,
    });
    expect(response.status).toBe(200);
    expect(response.body.data.policy).toMatchObject({
      carryForwardEnabled: true,
      carryForwardAllowance: 3,
      carryForwardExpiryMonths: null,
      resetPeriod: 'CUSTOM',
      maxCreditsPerApplication: null,
      monthlyUsageLimitEnabled: false,
      monthlyUsageLimit: null,
    });

    const priorStart = DateTime.utc().minus({ years: 1 }).startOf('year').toISODate()!;
    const priorEnd = DateTime.utc().minus({ years: 1 }).endOf('year').toISODate()!;
    await LeaveBalance.create({
      organizationId: orgId,
      employeeId: employee.user.id,
      leaveTypeId: type.id,
      periodStart: priorStart,
      periodEnd: priorEnd,
      entitledBalance: 10,
      availableBalance: 10,
    });

    const balances = await request(app)
      .get(api(orgId, '/leave/balances/me'))
      .set(employeeAuth.headers);
    expect(balances.status).toBe(200);
    const carried = (balances.body.data.balances as Array<Record<string, unknown>>).find(
      (balance) => balance.leaveTypeId === type.id,
    );
    expect(carried!.carriedForwardBalance).toBe(3);

    const balance = await findBalance(employee.user.id, type.id);
    const tranches = await LeaveCreditTranche.findAll({ where: { balanceId: balance.id } });
    expect(tranches.length).toBeGreaterThan(0);
    expect(tranches.every((tranche) => tranche.expiresAt === null)).toBe(true);
    expect(tranches.every((tranche) => tranche.expiryReason === 'NONE')).toBe(true);
  });

  it('exposes monthly usage and expiring credits to the employee', async () => {
    const { ownerAuth, employeeAuth, orgId } = await createTeam();
    const type = await createLeaveType(orgId, ownerAuth);
    const currentMonthStart = DateTime.utc().startOf('month').toISODate()!;
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      initialEntitlement: 0,
      accrualFrequency: 'MONTHLY',
      accrualAmount: 3,
      accrualDayOfMonth: 1,
      accrualEffectiveFrom: currentMonthStart,
      resetPeriod: 'NEVER',
      carryForwardEnabled: true,
      carryForwardAllowance: 6,
      carryForwardExpiryMonths: 1,
      monthlyUsageLimitEnabled: true,
      monthlyUsageLimit: 4,
    });

    await runLeaveAccrualSweep({ now: new Date(), organizationId: orgId });

    const response = await request(app)
      .get(api(orgId, '/leave/balances/me'))
      .set(employeeAuth.headers);
    expect(response.status).toBe(200);
    const balance = (response.body.data.balances as Array<Record<string, unknown>>).find(
      (item) => item.leaveTypeId === type.id,
    );
    expect(balance).toBeDefined();
    expect(balance!.monthlyUsage).toMatchObject({
      enabled: true,
      limit: 4,
      total: 0,
      pending: 0,
      approved: 0,
      remaining: 4,
    });
    expect((balance!.credits as Record<string, unknown>).expiringSoon).toBe(3);
    expect((balance!.credits as Record<string, unknown>).earnedThisMonth).toBe(3);
  });

  it('serializes concurrent applications so the monthly limit cannot be exceeded', async () => {
    const { ownerAuth, employeeAuth, employee, orgId } = await createTeam();
    const type = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      initialEntitlement: 20,
      resetPeriod: 'NEVER',
      monthlyUsageLimitEnabled: true,
      monthlyUsageLimit: 3,
    });

    const [first, second] = await Promise.all([
      applyLeave(orgId, employeeAuth, {
        leaveTypeId: type.id,
        startDate: MONDAY,
        endDate: TUESDAY,
        startHalfDay: false,
        endHalfDay: false,
        reason: 'Concurrent request one',
      }),
      applyLeave(orgId, employeeAuth, {
        leaveTypeId: type.id,
        startDate: WEDNESDAY,
        endDate: THURSDAY,
        startHalfDay: false,
        endHalfDay: false,
        reason: 'Concurrent request two',
      }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);
    const rejected = first.status === 409 ? first : second;
    expect(rejected.body.error.code).toBe('LEAVE_MONTHLY_USAGE_LIMIT_EXCEEDED');

    // Only the winning request reserved credits; the loser wrote nothing.
    const balance = await findBalance(employee.user.id, type.id);
    expect(Number(balance.pendingReserved)).toBe(2);
  });

  it('evaluates a cross-month request against each month independently', async () => {
    const { ownerAuth, employeeAuth, orgId } = await createTeam();
    const type = await createLeaveType(orgId, ownerAuth);

    let lastWorkday = target.endOf('month');
    while (lastWorkday.weekday > 5) lastWorkday = lastWorkday.minus({ days: 1 });
    let firstWorkdayNext = target.plus({ months: 1 }).startOf('month');
    while (firstWorkdayNext.weekday > 5) firstWorkdayNext = firstWorkdayNext.plus({ days: 1 });

    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      initialEntitlement: 20,
      resetPeriod: 'NEVER',
      monthlyUsageLimitEnabled: true,
      monthlyUsageLimit: 1,
    });

    // One day in each calendar month: each month is at its limit, not over it.
    const spanning = await applyLeave(orgId, employeeAuth, {
      leaveTypeId: type.id,
      startDate: lastWorkday.toISODate()!,
      endDate: firstWorkdayNext.toISODate()!,
      startHalfDay: false,
      endHalfDay: false,
      reason: 'Cross-month break',
    });
    expect(spanning.status).toBe(201);

    const extraInFirstMonth = await applyLeave(orgId, employeeAuth, {
      leaveTypeId: type.id,
      startDate: MONDAY,
      endDate: MONDAY,
      startHalfDay: false,
      endHalfDay: false,
      reason: 'Extra day in the first month',
    });
    expect(extraInFirstMonth.status).toBe(409);
    expect(extraInFirstMonth.body.error.code).toBe('LEAVE_MONTHLY_USAGE_LIMIT_EXCEEDED');
  });
});
