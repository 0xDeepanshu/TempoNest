import request from 'supertest';
import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AuditEvent,
  LeaveBalance,
  LeaveLedgerEntry,
  Membership,
  Organization,
} from '../src/database';
import { runLeaveAccrualSweep } from '../src/modules/leave/leaveAccrual.service';
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

const now = DateTime.utc();
const YEAR = now.year;
const CURRENT_MONTH_START = now.startOf('month').toISODate()!;
const CURRENT_PERIOD = {
  balancePeriodStartMonth: now.month,
  balancePeriodStartDay: 1,
};
const ANNUAL_PERIOD = { balancePeriodStartMonth: 1, balancePeriodStartDay: 1 };

let typeCounter = 0;

function api(orgId: string, path: string): string {
  return `${API}/organizations/${orgId}${path}`;
}

function instant(month: number, day: number, hour = 12): Date {
  return new Date(Date.UTC(YEAR, month - 1, day, hour, 0, 0, 0));
}

async function createTeam(options: { timezone?: string; employeeName?: string } = {}) {
  const owner = await createOwner(uniqueEmail('accrual-owner'), 'Accrual Org');
  if (options.timezone) {
    await Organization.update(
      { timezone: options.timezone },
      { where: { id: owner.organization.id } },
    );
  }
  const employee = await inviteAndAccept(owner, {
    role: 'EMPLOYEE',
    name: options.employeeName ?? 'Accrual Employee',
    email: uniqueEmail('accrual-employee'),
  });
  const ownerAuth = await desktopAuth(owner.email);
  const employeeAuth = await desktopAuth(employee.email);
  return {
    owner,
    ownerAuth,
    employee,
    employeeAuth,
    orgId: owner.organization.id,
  };
}

async function createLeaveType(
  orgId: string,
  auth: Auth,
  overrides: Record<string, unknown> = {},
) {
  typeCounter += 1;
  const name =
    (overrides.name as string | undefined) ??
    `Accrual Leave ${typeCounter}-${Math.random().toString(36).slice(2, 7)}`;
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

async function readMyBalances(orgId: string, auth: Auth) {
  const response = await request(app)
    .get(api(orgId, '/leave/balances/me'))
    .set(auth.headers);
  expect(response.status).toBe(200);
  return response.body.data.balances as Array<Record<string, unknown>>;
}

async function currentBalance(employeeId: string, leaveTypeId: string) {
  return LeaveBalance.findOne({ where: { employeeId, leaveTypeId } });
}

describe('leave accrual and balance administration', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('resolves employee names and initializes balances before the first request', async () => {
    const { owner, ownerAuth, employee, employeeAuth, orgId } = await createTeam({
      employeeName: 'Ada Lovelace',
    });
    const type = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      ...CURRENT_PERIOD,
      initialEntitlement: 12,
    });

    const ownBalances = await readMyBalances(orgId, employeeAuth);
    expect(ownBalances).toHaveLength(1);
    expect(ownBalances[0]!.employeeId).toBe(employee.user.id);
    expect((ownBalances[0]!.employee as { name: string }).name).toBe('Ada Lovelace');
    expect(ownBalances[0]!.availableBalance).toBe(12);

    const list = await request(app)
      .get(api(orgId, '/leave/balances'))
      .set(ownerAuth.headers);
    expect(list.status).toBe(200);
    expect(list.body.meta.total).toBe(2);
    const rows = list.body.data as Array<Record<string, unknown>>;
    for (const row of rows) {
      expect((row.employee as { name: string }).name).toBeTruthy();
      expect((row.employee as { id: string }).id).toBe(row.employeeId);
      expect(row.periodStart).toBe(CURRENT_MONTH_START);
    }
    expect(new Set(rows.map((row) => row.employeeId)).size).toBe(2);
    expect((rows[0]!.leaveType as { name: string }).name).toBe(type.name);

    const ownerBalance = await LeaveBalance.findOne({
      where: { employeeId: owner.user.id, leaveTypeId: type.id },
    });
    expect(ownerBalance).not.toBeNull();
    expect(
      await LeaveLedgerEntry.count({
        where: { balanceId: ownerBalance!.id, kind: 'INITIAL_ENTITLEMENT' },
      }),
    ).toBe(1);
  });

  it('does not materialize a historical period when it is only read', async () => {
    const { ownerAuth, employee, employeeAuth, orgId } = await createTeam();
    const type = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      ...CURRENT_PERIOD,
      initialEntitlement: 12,
    });

    await readMyBalances(orgId, employeeAuth);
    const currentRows = await LeaveBalance.findAll({
      where: { employeeId: employee.user.id },
    });
    expect(currentRows).toHaveLength(1);
    expect(currentRows[0]!.periodStart).toBe(CURRENT_MONTH_START);

    const historical = DateTime.utc(YEAR - 1, now.month, 15).toISODate()!;
    const detail = await request(app)
      .get(api(orgId, `/leave/balances/${employee.user.id}`))
      .query({ periodStart: historical })
      .set(ownerAuth.headers);
    expect(detail.status).toBe(200);
    expect(detail.body.data.balances).toHaveLength(0);

    const list = await request(app)
      .get(api(orgId, '/leave/balances'))
      .query({ periodStart: historical })
      .set(ownerAuth.headers);
    expect(list.status).toBe(200);
    expect(list.body.meta.total).toBe(0);

    const rows = await LeaveBalance.findAll({ where: { employeeId: employee.user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.periodStart).toBe(CURRENT_MONTH_START);
    expect(
      await LeaveLedgerEntry.count({
        where: { balanceId: rows[0]!.id, kind: 'INITIAL_ENTITLEMENT' },
      }),
    ).toBe(1);
  });

  it('accrues the current month exactly once on repeated reads', async () => {
    const { ownerAuth, employeeAuth, employee, orgId } = await createTeam();
    const type = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      ...CURRENT_PERIOD,
      initialEntitlement: 0,
      accrualFrequency: 'MONTHLY',
      accrualAmount: 1,
      accrualDayOfMonth: 1,
      accrualEffectiveFrom: CURRENT_MONTH_START,
    });

    const first = await readMyBalances(orgId, employeeAuth);
    expect(first[0]!.accruedBalance).toBe(1);
    expect(first[0]!.availableBalance).toBe(1);
    const accrualEntries = (first[0]!.ledger as Array<Record<string, unknown>>).filter(
      (entry) => entry.kind === 'ACCRUAL',
    );
    expect(accrualEntries).toHaveLength(1);
    expect(accrualEntries[0]!.accrualPeriod).toBe(CURRENT_MONTH_START);

    const second = await readMyBalances(orgId, employeeAuth);
    expect(second[0]!.accruedBalance).toBe(1);
    expect(second[0]!.availableBalance).toBe(1);

    const balance = await currentBalance(employee.user.id, type.id);
    expect(
      await LeaveLedgerEntry.count({
        where: { balanceId: balance!.id, kind: 'ACCRUAL' },
      }),
    ).toBe(1);
  });

  it('credits the configured accrual day once it is due', async () => {
    const { ownerAuth, employee, orgId } = await createTeam();
    const type = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      ...ANNUAL_PERIOD,
      initialEntitlement: 0,
      accrualFrequency: 'MONTHLY',
      accrualAmount: 2,
      accrualDayOfMonth: 15,
      accrualEffectiveFrom: `${YEAR}-10-01`,
    });

    const before = await runLeaveAccrualSweep({
      now: instant(10, 10),
      organizationId: orgId,
    });
    expect(before.failures).toBe(0);
    let balance = await currentBalance(employee.user.id, type.id);
    expect(balance).not.toBeNull();
    expect(Number(balance!.accruedBalance)).toBe(0);

    const onTime = await runLeaveAccrualSweep({
      now: instant(10, 15),
      organizationId: orgId,
    });
    expect(onTime.failures).toBe(0);
    balance = await currentBalance(employee.user.id, type.id);
    expect(Number(balance!.accruedBalance)).toBe(2);

    await runLeaveAccrualSweep({ now: instant(10, 20), organizationId: orgId });
    balance = await currentBalance(employee.user.id, type.id);
    expect(Number(balance!.accruedBalance)).toBe(2);
    expect(
      await LeaveLedgerEntry.count({
        where: { balanceId: balance!.id, kind: 'ACCRUAL' },
      }),
    ).toBe(1);
  });

  it('uses the organization timezone to decide when the accrual day arrives', async () => {
    const instantAt = new Date(Date.UTC(YEAR, 9, 31, 13, 0, 0, 0));

    const kiribati = await createOwner(uniqueEmail('kiri-owner'), 'Kiritimati Org');
    await Organization.update(
      { timezone: 'Pacific/Kiritimati' },
      { where: { id: kiribati.organization.id } },
    );
    const kiribatiAuth = await desktopAuth(kiribati.email);
    const kiribatiType = await createLeaveType(kiribati.organization.id, kiribatiAuth);
    await configurePolicy(kiribati.organization.id, kiribatiAuth, kiribatiType.policy.id, {
      ...ANNUAL_PERIOD,
      accrualFrequency: 'MONTHLY',
      accrualAmount: 1,
      accrualDayOfMonth: 1,
      accrualEffectiveFrom: `${YEAR}-10-01`,
    });

    const samoa = await createOwner(uniqueEmail('samoa-owner'), 'Pago Pago Org');
    await Organization.update(
      { timezone: 'Pacific/Pago_Pago' },
      { where: { id: samoa.organization.id } },
    );
    const samoaAuth = await desktopAuth(samoa.email);
    const samoaType = await createLeaveType(samoa.organization.id, samoaAuth);
    await configurePolicy(samoa.organization.id, samoaAuth, samoaType.policy.id, {
      ...ANNUAL_PERIOD,
      accrualFrequency: 'MONTHLY',
      accrualAmount: 1,
      accrualDayOfMonth: 1,
      accrualEffectiveFrom: `${YEAR}-10-01`,
    });

    await runLeaveAccrualSweep({
      now: instantAt,
      organizationId: kiribati.organization.id,
    });
    await runLeaveAccrualSweep({
      now: instantAt,
      organizationId: samoa.organization.id,
    });

    const kiribatiBalance = await currentBalance(kiribati.user.id, kiribatiType.id);
    const samoaBalance = await currentBalance(samoa.user.id, samoaType.id);
    // 2026-10-31T13:00Z is already 1 November in UTC+14 but still 31 October in UTC-11.
    expect(Number(kiribatiBalance!.accruedBalance)).toBe(2);
    expect(Number(samoaBalance!.accruedBalance)).toBe(1);
  });

  it('catches up missed tranches but never credits before the effective date', async () => {
    const { ownerAuth, employee, orgId } = await createTeam();
    const catchUp = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, catchUp.policy.id, {
      ...ANNUAL_PERIOD,
      accrualFrequency: 'MONTHLY',
      accrualAmount: 1,
      accrualDayOfMonth: 1,
      accrualEffectiveFrom: `${YEAR}-07-01`,
    });
    const future = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, future.policy.id, {
      ...ANNUAL_PERIOD,
      accrualFrequency: 'MONTHLY',
      accrualAmount: 1,
      accrualDayOfMonth: 1,
      accrualEffectiveFrom: `${YEAR}-12-01`,
    });

    const at = instant(10, 27);
    await Promise.all([
      runLeaveAccrualSweep({ now: at, organizationId: orgId }),
      runLeaveAccrualSweep({ now: at, organizationId: orgId }),
    ]);
    await runLeaveAccrualSweep({ now: at, organizationId: orgId });

    const catchUpBalance = await currentBalance(employee.user.id, catchUp.id);
    expect(Number(catchUpBalance!.accruedBalance)).toBe(4);
    const entries = await LeaveLedgerEntry.findAll({
      where: { balanceId: catchUpBalance!.id, kind: 'ACCRUAL' },
      order: [['accrualPeriod', 'ASC']],
    });
    expect(entries).toHaveLength(4);
    expect(entries.map((entry) => entry.accrualPeriod)).toEqual([
      `${YEAR}-07-01`,
      `${YEAR}-08-01`,
      `${YEAR}-09-01`,
      `${YEAR}-10-01`,
    ]);

    const futureBalance = await currentBalance(employee.user.id, future.id);
    expect(Number(futureBalance!.accruedBalance)).toBe(0);
    expect(
      await LeaveLedgerEntry.count({
        where: { balanceId: futureBalance!.id, kind: 'ACCRUAL' },
      }),
    ).toBe(0);
  });

  it('prorates the month in which the employee joined', async () => {
    const { ownerAuth, employee, orgId } = await createTeam();
    const membership = await Membership.findOne({
      where: { organizationId: orgId, userId: employee.user.id },
    });
    await Membership.update(
      { createdAt: new Date(`${YEAR}-10-16T12:00:00.000Z`) },
      { where: { id: membership!.id }, silent: true },
    );

    const type = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      ...ANNUAL_PERIOD,
      accrualFrequency: 'MONTHLY',
      accrualAmount: 31,
      accrualDayOfMonth: 1,
      accrualEffectiveFrom: `${YEAR}-10-01`,
      prorateAccrual: true,
    });

    await runLeaveAccrualSweep({ now: instant(10, 27), organizationId: orgId });
    const balance = await currentBalance(employee.user.id, type.id);
    // 16 remaining days in a 31-day month at 31 days per month = 16 days.
    expect(Number(balance!.accruedBalance)).toBe(16);

    const entry = await LeaveLedgerEntry.findOne({
      where: { balanceId: balance!.id, kind: 'ACCRUAL' },
    });
    expect(entry!.metadata).toMatchObject({
      joinDate: `${YEAR}-10-16`,
      configured: 31,
      prorated: 16,
      credited: 16,
    });
  });

  it('carries forward the allowed unused balance and respects the maximum', async () => {
    const { ownerAuth, employeeAuth, employee, orgId } = await createTeam();
    const limited = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, limited.policy.id, {
      ...CURRENT_PERIOD,
      accrualFrequency: 'NONE',
      carryForwardAllowance: 3,
    });
    const capped = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, capped.policy.id, {
      ...CURRENT_PERIOD,
      accrualFrequency: 'NONE',
      carryForwardAllowance: 10,
      maxBalance: 5,
    });

    const priorStart = DateTime.fromISO(CURRENT_MONTH_START).minus({ years: 1 }).toISODate()!;
    const priorEnd = DateTime.fromISO(CURRENT_MONTH_START).minus({ days: 1 }).toISODate()!;
    for (const type of [limited, capped]) {
      await LeaveBalance.create({
        organizationId: orgId,
        employeeId: employee.user.id,
        leaveTypeId: type.id,
        periodStart: priorStart,
        periodEnd: priorEnd,
        entitledBalance: 10,
        availableBalance: 10,
      });
    }

    const balances = await readMyBalances(orgId, employeeAuth);
    const limitedBalance = balances.find((balance) => balance.leaveTypeId === limited.id)!;
    const cappedBalance = balances.find((balance) => balance.leaveTypeId === capped.id)!;
    expect(limitedBalance.carriedForwardBalance).toBe(3);
    expect(limitedBalance.availableBalance).toBe(3);
    expect(cappedBalance.carriedForwardBalance).toBe(5);
    expect(cappedBalance.availableBalance).toBe(5);
    expect(
      (limitedBalance.ledger as Array<Record<string, unknown>>).some(
        (entry) => entry.kind === 'CARRY_FORWARD',
      ),
    ).toBe(true);
  });

  it('does not double-credit when the accrual day changes within the same month', async () => {
    const { ownerAuth, employee, orgId } = await createTeam();
    const type = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      ...ANNUAL_PERIOD,
      accrualFrequency: 'MONTHLY',
      accrualAmount: 1,
      accrualDayOfMonth: 1,
      accrualEffectiveFrom: `${YEAR}-10-01`,
    });

    await runLeaveAccrualSweep({ now: instant(10, 27), organizationId: orgId });
    await configurePolicy(orgId, ownerAuth, type.policy.id, { accrualDayOfMonth: 28 });
    await runLeaveAccrualSweep({ now: instant(10, 28), organizationId: orgId });

    const balance = await currentBalance(employee.user.id, type.id);
    expect(Number(balance!.accruedBalance)).toBe(1);
    const entries = await LeaveLedgerEntry.findAll({
      where: { balanceId: balance!.id, kind: 'ACCRUAL' },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.accrualPeriod).toBe(`${YEAR}-10-01`);
  });

  it('enforces one accrual per month at the database level', async () => {
    const { ownerAuth, employee, orgId } = await createTeam();
    const type = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      ...ANNUAL_PERIOD,
      accrualFrequency: 'MONTHLY',
      accrualAmount: 1,
      accrualDayOfMonth: 1,
      accrualEffectiveFrom: `${YEAR}-10-01`,
    });

    await runLeaveAccrualSweep({ now: instant(10, 27), organizationId: orgId });
    const balance = await currentBalance(employee.user.id, type.id);
    expect(balance).not.toBeNull();

    await expect(
      LeaveLedgerEntry.create({
        organizationId: orgId,
        balanceId: balance!.id,
        employeeId: employee.user.id,
        leaveTypeId: type.id,
        kind: 'ACCRUAL',
        accrualPeriod: `${YEAR}-10-01`,
        idempotencyKey: `manual-duplicate-${Date.now()}`,
      }),
    ).rejects.toThrow();
  });

  it('skips suspended employees and inactive leave types during a sweep', async () => {
    const { ownerAuth, employee, orgId } = await createTeam();
    const activeType = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, activeType.policy.id, {
      ...ANNUAL_PERIOD,
      accrualFrequency: 'MONTHLY',
      accrualAmount: 1,
      accrualDayOfMonth: 1,
      accrualEffectiveFrom: `${YEAR}-10-01`,
    });
    const inactiveType = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, inactiveType.policy.id, {
      ...ANNUAL_PERIOD,
      accrualFrequency: 'MONTHLY',
      accrualAmount: 1,
      accrualDayOfMonth: 1,
      accrualEffectiveFrom: `${YEAR}-10-01`,
      isActive: false,
    });
    const membership = await Membership.findOne({
      where: { organizationId: orgId, userId: employee.user.id },
    });
    await Membership.update(
      { status: 'SUSPENDED' },
      { where: { id: membership!.id } },
    );

    const summary = await runLeaveAccrualSweep({
      now: instant(10, 27),
      organizationId: orgId,
    });
    expect(summary.failures).toBe(0);
    expect(await currentBalance(employee.user.id, activeType.id)).toBeNull();
    expect(
      await LeaveBalance.count({ where: { leaveTypeId: inactiveType.id } }),
    ).toBe(0);
  });

  it('previews and applies an individual period-aware adjustment with a reason', async () => {
    const { owner, ownerAuth, employee, employeeAuth, orgId } = await createTeam();
    const type = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      ...CURRENT_PERIOD,
      initialEntitlement: 10,
      maxBalance: 12,
    });

    const preview = await request(app)
      .post(api(orgId, `/leave/balances/${employee.user.id}/adjustments/preview`))
      .set(ownerAuth.headers)
      .send({ leaveTypeId: type.id, amount: -2, reason: 'Data correction' });
    expect(preview.status).toBe(200);
    expect(preview.body.data.preview).toMatchObject({
      employeeId: employee.user.id,
      availableBefore: 10,
      availableAfter: 8,
      balanceExists: false,
      periodStart: CURRENT_MONTH_START,
    });
    expect(
      await LeaveBalance.count({ where: { employeeId: employee.user.id } }),
    ).toBe(0);

    const adjust = await request(app)
      .post(api(orgId, `/leave/balances/${employee.user.id}/adjustments`))
      .set(ownerAuth.headers)
      .send({ leaveTypeId: type.id, amount: -2, reason: 'Data correction' });
    expect(adjust.status).toBe(200);
    expect(adjust.body.data.balance.availableBalance).toBe(8);
    expect(adjust.body.data.balance.adjustmentBalance).toBe(-2);
    expect(
      await LeaveBalance.count({ where: { employeeId: employee.user.id } }),
    ).toBe(1);

    const ledger = await LeaveLedgerEntry.findOne({
      where: { organizationId: orgId, employeeId: employee.user.id, kind: 'ADJUSTMENT' },
    });
    expect(ledger).not.toBeNull();
    expect(ledger!.reason).toBe('Data correction');
    expect(ledger!.actorUserId).toBe(owner.user.id);
    expect(
      await AuditEvent.count({
        where: { organizationId: orgId, action: 'LEAVE_BALANCE_ADJUSTED' },
      }),
    ).toBe(1);

    const zero = await request(app)
      .post(api(orgId, `/leave/balances/${employee.user.id}/adjustments`))
      .set(ownerAuth.headers)
      .send({ leaveTypeId: type.id, amount: 0, reason: 'Zero is not allowed' });
    expect(zero.status).toBe(422);

    const noReason = await request(app)
      .post(api(orgId, `/leave/balances/${employee.user.id}/adjustments`))
      .set(ownerAuth.headers)
      .send({ leaveTypeId: type.id, amount: 1 });
    expect(noReason.status).toBe(422);

    const midPeriod = await request(app)
      .post(api(orgId, `/leave/balances/${employee.user.id}/adjustments`))
      .set(ownerAuth.headers)
      .send({
        leaveTypeId: type.id,
        amount: 1,
        reason: 'Bad period',
        periodStart: now.minus({ days: 1 }).toISODate()!,
      });
    expect(midPeriod.status).toBe(422);
    expect(midPeriod.body.error.code).toBe('LEAVE_ADJUSTMENT_PERIOD_INVALID');

    const nextPeriodStart = now.plus({ years: 1 }).startOf('month').toISODate()!;
    const missingPeriod = await request(app)
      .post(api(orgId, `/leave/balances/${employee.user.id}/adjustments`))
      .set(ownerAuth.headers)
      .send({
        leaveTypeId: type.id,
        amount: 1,
        reason: 'Future period',
        periodStart: nextPeriodStart,
      });
    expect(missingPeriod.status).toBe(409);
    expect(missingPeriod.body.error.code).toBe('LEAVE_BALANCE_NOT_FOUND');

    const capped = await request(app)
      .post(api(orgId, `/leave/balances/${employee.user.id}/adjustments`))
      .set(ownerAuth.headers)
      .send({ leaveTypeId: type.id, amount: 5, reason: 'Too much' });
    expect(capped.status).toBe(409);
    expect(capped.body.error.code).toBe('LEAVE_BALANCE_CAP_EXCEEDED');

    const negative = await request(app)
      .post(api(orgId, `/leave/balances/${employee.user.id}/adjustments`))
      .set(ownerAuth.headers)
      .send({ leaveTypeId: type.id, amount: -100, reason: 'Way too much' });
    expect(negative.status).toBe(409);
    expect(negative.body.error.code).toBe('LEAVE_BALANCE_NEGATIVE_NOT_ALLOWED');

    const before = await readMyBalances(orgId, employeeAuth);
    expect(before[0]!.availableBalance).toBe(8);

    const priorStart = DateTime.fromISO(CURRENT_MONTH_START).minus({ years: 1 }).toISODate()!;
    const priorEnd = DateTime.fromISO(CURRENT_MONTH_START).minus({ days: 1 }).toISODate()!;
    const prior = await LeaveBalance.create({
      organizationId: orgId,
      employeeId: employee.user.id,
      leaveTypeId: type.id,
      periodStart: priorStart,
      periodEnd: priorEnd,
      entitledBalance: 5,
      availableBalance: 5,
    });
    const priorAdjust = await request(app)
      .post(api(orgId, `/leave/balances/${employee.user.id}/adjustments`))
      .set(ownerAuth.headers)
      .send({
        leaveTypeId: type.id,
        amount: 2,
        reason: 'Prior period correction',
        periodStart: priorStart,
      });
    expect(priorAdjust.status).toBe(200);
    expect(priorAdjust.body.data.balance.periodStart).toBe(priorStart);
    expect(priorAdjust.body.data.balance.availableBalance).toBe(7);
    await prior.reload();
    expect(Number(prior.availableBalance)).toBe(7);
    const currentAfter = await currentBalance(employee.user.id, type.id);
    expect(Number(currentAfter!.availableBalance)).toBe(8);
  });

  it('previews and applies bulk adjustments with per-employee results and audit', async () => {
    const { owner, ownerAuth, employee, orgId } = await createTeam();
    const second = await inviteAndAccept(owner, {
      role: 'EMPLOYEE',
      name: 'Second Employee',
      email: uniqueEmail('accrual-second'),
    });
    const outsiderOwner = await createOwner(uniqueEmail('outside-owner'), 'Outside Org');
    const outsiderEmployee = await inviteAndAccept(outsiderOwner, {
      role: 'EMPLOYEE',
      name: 'Outside Employee',
      email: uniqueEmail('outside-employee'),
    });

    const type = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      ...CURRENT_PERIOD,
      initialEntitlement: 10,
    });

    const body = {
      employeeIds: [employee.user.id, second.user.id, outsiderEmployee.user.id],
      leaveTypeId: type.id,
      amount: 1.5,
      reason: 'Quarterly bonus',
    };
    const preview = await request(app)
      .post(api(orgId, '/leave/balances/bulk-adjustments/preview'))
      .set(ownerAuth.headers)
      .send(body);
    expect(preview.status).toBe(200);
    expect(preview.body.data.summary).toEqual({ requested: 3, previewed: 2, failed: 1 });
    const failedPreview = (
      preview.body.data.items as Array<Record<string, unknown>>
    ).find((item) => item.ok === false)!;
    expect(failedPreview.employeeId).toBe(outsiderEmployee.user.id);
    expect(failedPreview.code).toBe('EMPLOYEE_NOT_FOUND');
    expect(
      await LeaveBalance.count({ where: { leaveTypeId: type.id } }),
    ).toBe(0);

    const unconfirmed = await request(app)
      .post(api(orgId, '/leave/balances/bulk-adjustments'))
      .set(ownerAuth.headers)
      .send(body);
    expect(unconfirmed.status).toBe(422);

    const confirm = await request(app)
      .post(api(orgId, '/leave/balances/bulk-adjustments'))
      .set(ownerAuth.headers)
      .send({
        ...body,
        employeeIds: [employee.user.id, second.user.id, outsiderEmployee.user.id],
        confirm: true,
      });
    expect(confirm.status).toBe(200);
    expect(confirm.body.data.summary).toEqual({ requested: 3, adjusted: 2, failed: 1 });
    const batchId = confirm.body.data.batchId as string;
    expect(batchId).toBeTruthy();

    for (const employeeId of [employee.user.id, second.user.id]) {
      const balance = await currentBalance(employeeId, type.id);
      expect(balance).not.toBeNull();
      expect(Number(balance!.availableBalance)).toBe(11.5);
      expect(
        await LeaveLedgerEntry.count({
          where: { balanceId: balance!.id, kind: 'ADJUSTMENT' },
        }),
      ).toBe(1);
    }
    const adjustments = await LeaveLedgerEntry.findAll({
      where: { organizationId: orgId, kind: 'ADJUSTMENT' },
    });
    expect(adjustments).toHaveLength(2);
    for (const entry of adjustments) {
      expect(entry.metadata).toMatchObject({ batchId });
      expect(entry.reason).toBe('Quarterly bonus');
    }
    expect(
      await AuditEvent.count({
        where: { organizationId: orgId, action: 'LEAVE_BALANCE_ADJUSTED' },
      }),
    ).toBe(2);

    const employeeBulk = await request(app)
      .post(api(orgId, '/leave/balances/bulk-adjustments/preview'))
      .set((await desktopAuth(employee.email)).headers)
      .send(body);
    expect(employeeBulk.status).toBe(403);
    expect(await LeaveBalance.count({ where: { organizationId: outsiderOwner.organization.id } })).toBe(0);
  });

  it('provides a dry-run backfill preview and an idempotent confirmed backfill', async () => {
    const { ownerAuth, employee, orgId } = await createTeam();
    const type = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      ...CURRENT_PERIOD,
      initialEntitlement: 5,
      accrualFrequency: 'NONE',
    });

    const preview = await request(app)
      .get(
        api(
          orgId,
          `/leave/balances/backfill/preview?employeeId=${employee.user.id}&leaveTypeId=${type.id}`,
        ),
      )
      .set(ownerAuth.headers);
    expect(preview.status).toBe(200);
    expect(preview.body.data.summary).toMatchObject({
      employees: 1,
      leaveTypes: 1,
      candidates: 1,
      missing: 1,
      existing: 0,
    });
    expect(preview.body.data.items[0].employee.name).toBe('Accrual Employee');
    expect(preview.body.data.items[0].balanceExists).toBe(false);
    expect(
      await LeaveBalance.count({ where: { employeeId: employee.user.id } }),
    ).toBe(0);

    const apply = await request(app)
      .post(api(orgId, '/leave/balances/backfill'))
      .set(ownerAuth.headers)
      .send({
        confirm: true,
        employeeIds: [employee.user.id],
        leaveTypeIds: [type.id],
      });
    expect(apply.status).toBe(200);
    expect(apply.body.data.summary).toMatchObject({
      employees: 1,
      initialized: 1,
      alreadyPresent: 0,
      failed: 0,
    });
    expect(apply.body.data.employees[0].initialized[0].availableBalance).toBe(5);

    const balance = await currentBalance(employee.user.id, type.id);
    expect(Number(balance!.availableBalance)).toBe(5);
    expect(
      await LeaveLedgerEntry.count({
        where: { balanceId: balance!.id, kind: 'INITIAL_ENTITLEMENT' },
      }),
    ).toBe(1);
    expect(
      await AuditEvent.count({
        where: { organizationId: orgId, action: 'LEAVE_BALANCE_BACKFILLED' },
      }),
    ).toBe(1);

    const repeat = await request(app)
      .post(api(orgId, '/leave/balances/backfill'))
      .set(ownerAuth.headers)
      .send({
        confirm: true,
        employeeIds: [employee.user.id],
        leaveTypeIds: [type.id],
      });
    expect(repeat.status).toBe(200);
    expect(repeat.body.data.summary).toMatchObject({
      initialized: 0,
      alreadyPresent: 1,
      failed: 0,
    });
    expect(
      await LeaveLedgerEntry.count({
        where: { balanceId: balance!.id, kind: 'INITIAL_ENTITLEMENT' },
      }),
    ).toBe(1);
  });

  it('reports overlapping balances and only removes empty rows without history', async () => {
    const { ownerAuth, employee, employeeAuth, orgId } = await createTeam();
    const type = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      ...CURRENT_PERIOD,
      initialEntitlement: 4,
    });
    await readMyBalances(orgId, employeeAuth);

    const priorStart = DateTime.fromISO(CURRENT_MONTH_START).minus({ years: 1 }).toISODate()!;
    const priorEnd = DateTime.fromISO(CURRENT_MONTH_START).minus({ days: 1 }).toISODate()!;
    const emptyLegacy = await LeaveBalance.create({
      organizationId: orgId,
      employeeId: employee.user.id,
      leaveTypeId: type.id,
      periodStart: priorStart,
      periodEnd: priorEnd,
    });
    const withHistory = await LeaveBalance.create({
      organizationId: orgId,
      employeeId: employee.user.id,
      leaveTypeId: type.id,
      periodStart: DateTime.fromISO(priorStart).minus({ years: 1 }).toISODate()!,
      periodEnd: DateTime.fromISO(priorStart).minus({ days: 1 }).toISODate()!,
    });
    await LeaveLedgerEntry.create({
      organizationId: orgId,
      balanceId: withHistory.id,
      employeeId: employee.user.id,
      leaveTypeId: type.id,
      kind: 'ADJUSTMENT',
      reason: 'Legacy zero-delta record',
    });

    const report = await request(app)
      .get(api(orgId, '/leave/balances/reconciliation'))
      .set(ownerAuth.headers);
    expect(report.status).toBe(200);
    expect(report.body.data.summary.overlappingGroups).toBe(1);
    expect(report.body.data.summary.safeToRemoveBalances).toBe(1);
    const group = report.body.data.groups[0];
    expect(group.issues).toContain('OVERLAPPING_PERIODS');
    expect(group.employeeName).toBe('Accrual Employee');
    const emptyRow = group.balances.find(
      (balance: { id: string }) => balance.id === emptyLegacy.id,
    );
    const historyRow = group.balances.find(
      (balance: { id: string }) => balance.id === withHistory.id,
    );
    expect(emptyRow.safeToRemove).toBe(true);
    expect(historyRow.safeToRemove).toBe(false);

    const repairEmpty = await request(app)
      .post(api(orgId, '/leave/balances/reconciliation/repair'))
      .set(ownerAuth.headers)
      .send({ confirm: true, balanceIds: [emptyLegacy.id] });
    expect(repairEmpty.status).toBe(200);
    expect(repairEmpty.body.data.repaired).toBe(1);
    expect(await LeaveBalance.findByPk(emptyLegacy.id)).toBeNull();
    expect(
      await AuditEvent.count({
        where: { organizationId: orgId, action: 'LEAVE_BALANCE_RECONCILED' },
      }),
    ).toBe(1);

    const repairHistory = await request(app)
      .post(api(orgId, '/leave/balances/reconciliation/repair'))
      .set(ownerAuth.headers)
      .send({ confirm: true, balanceIds: [withHistory.id] });
    expect(repairHistory.status).toBe(200);
    expect(repairHistory.body.data.repaired).toBe(0);
    expect(repairHistory.body.data.results[0].code).toBe('LEAVE_BALANCE_HAS_LEDGER');
    expect(await LeaveBalance.findByPk(withHistory.id)).not.toBeNull();

    const canonical = await currentBalance(employee.user.id, type.id);
    const repairCanonical = await request(app)
      .post(api(orgId, '/leave/balances/reconciliation/repair'))
      .set(ownerAuth.headers)
      .send({ confirm: true, balanceIds: [canonical!.id] });
    expect(repairCanonical.body.data.results[0].code).toBe('LEAVE_BALANCE_CANONICAL');

    const outsider = await createOwner(uniqueEmail('reconcile-outsider'), 'Other Org');
    const outsiderAuth = await desktopAuth(outsider.email);
    const crossOrg = await request(app)
      .post(api(outsider.organization.id, '/leave/balances/reconciliation/repair'))
      .set(outsiderAuth.headers)
      .send({ confirm: true, balanceIds: [withHistory.id] });
    expect(crossOrg.status).toBe(200);
    expect(crossOrg.body.data.results[0].code).toBe('LEAVE_BALANCE_NOT_FOUND');
  });

  it('previews the next accrual without changing balances', async () => {
    const { ownerAuth, employee, employeeAuth, orgId } = await createTeam();
    const type = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      ...CURRENT_PERIOD,
      initialEntitlement: 0,
      accrualFrequency: 'MONTHLY',
      accrualAmount: 2,
      accrualDayOfMonth: 1,
      accrualEffectiveFrom: CURRENT_MONTH_START,
    });

    await readMyBalances(orgId, employeeAuth);
    const balanceBefore = await currentBalance(employee.user.id, type.id);
    const ledgerBefore = await LeaveLedgerEntry.count({
      where: { balanceId: balanceBefore!.id },
    });

    const preview = await request(app)
      .get(
        api(
          orgId,
          `/leave/balances/accrual-preview?employeeId=${employee.user.id}&leaveTypeId=${type.id}`,
        ),
      )
      .set(ownerAuth.headers);
    expect(preview.status).toBe(200);
    const item = preview.body.data.items[0];
    expect(item.employee.name).toBe('Accrual Employee');
    expect(item.balanceExists).toBe(true);
    expect(item.currentAvailable).toBe(2);
    expect(item.nextAccrualDate).toBe(now.startOf('month').plus({ months: 1 }).toISODate());
    expect(item.nextAccrualAmount).toBe(2);
    expect(item.projectedAvailable).toBe(4);

    expect(
      await LeaveLedgerEntry.count({ where: { balanceId: balanceBefore!.id } }),
    ).toBe(ledgerBefore);
    await balanceBefore!.reload();
    expect(Number(balanceBefore!.availableBalance)).toBe(2);
  });

  it('lists ledger entries with source, actor, and period filters', async () => {
    const { owner, ownerAuth, employee, employeeAuth, orgId } = await createTeam();
    const type = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      ...CURRENT_PERIOD,
      initialEntitlement: 5,
      accrualFrequency: 'MONTHLY',
      accrualAmount: 1,
      accrualDayOfMonth: 1,
      accrualEffectiveFrom: CURRENT_MONTH_START,
    });
    await readMyBalances(orgId, employeeAuth);
    const adjust = await request(app)
      .post(api(orgId, `/leave/balances/${employee.user.id}/adjustments`))
      .set(ownerAuth.headers)
      .send({ leaveTypeId: type.id, amount: 2, reason: 'Ledger inspection' });
    expect(adjust.status).toBe(200);

    const ledger = await request(app)
      .get(
        api(
          orgId,
          `/leave/balances/ledger?employeeId=${employee.user.id}&leaveTypeId=${type.id}&periodStart=${CURRENT_MONTH_START}`,
        ),
      )
      .set(ownerAuth.headers);
    expect(ledger.status).toBe(200);
    expect(ledger.body.meta.total).toBe(3);
    const entries = ledger.body.data as Array<Record<string, unknown>>;
    const kinds = entries.map((entry) => entry.kind);
    expect(kinds).toContain('INITIAL_ENTITLEMENT');
    expect(kinds).toContain('ACCRUAL');
    expect(kinds).toContain('ADJUSTMENT');

    const adjustment = entries.find((entry) => entry.kind === 'ADJUSTMENT')!;
    expect(adjustment.reason).toBe('Ledger inspection');
    expect((adjustment.employee as { name: string }).name).toBe('Accrual Employee');
    expect((adjustment.leaveType as { name: string }).name).toBe(type.name);
    expect((adjustment.actor as { name: string }).name).toBe(owner.user.name);
    expect(adjustment.createdAt).toBeTruthy();

    const accrual = entries.find((entry) => entry.kind === 'ACCRUAL')!;
    expect(accrual.accrualPeriod).toBe(CURRENT_MONTH_START);

    const employeeLedger = await request(app)
      .get(api(orgId, '/leave/balances/ledger'))
      .set(employeeAuth.headers);
    expect(employeeLedger.status).toBe(403);
  });

  it('defaults the accrual effective date to today and locks period changes', async () => {
    const { ownerAuth, employeeAuth, orgId } = await createTeam();
    const type = await createLeaveType(orgId, ownerAuth);
    const policy = await configurePolicy(orgId, ownerAuth, type.policy.id, {
      ...CURRENT_PERIOD,
      accrualFrequency: 'MONTHLY',
      accrualAmount: 2,
    });
    expect(policy.accrualEffectiveFrom).toBe(now.toISODate());

    await readMyBalances(orgId, employeeAuth);
    const nextMonth = now.month === 12 ? 1 : now.month + 1;
    const locked = await request(app)
      .put(api(orgId, `/leave/policies/${type.policy.id}`))
      .set(ownerAuth.headers)
      .send({ balancePeriodStartMonth: nextMonth });
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe('LEAVE_POLICY_PERIOD_LOCKED');

    const allowed = await request(app)
      .put(api(orgId, `/leave/policies/${type.policy.id}`))
      .set(ownerAuth.headers)
      .send({ accrualDayOfMonth: 5 });
    expect(allowed.status).toBe(200);
    expect(allowed.body.data.policy.accrualDayOfMonth).toBe(5);
  });

  it('restricts balance administration endpoints to managers', async () => {
    const { ownerAuth, employeeAuth, employee, orgId } = await createTeam();
    const type = await createLeaveType(orgId, ownerAuth);
    await configurePolicy(orgId, ownerAuth, type.policy.id, {
      ...CURRENT_PERIOD,
      initialEntitlement: 1,
    });

    const requests = await Promise.all([
      request(app)
        .get(api(orgId, '/leave/balances'))
        .set(employeeAuth.headers),
      request(app)
        .get(api(orgId, '/leave/balances/backfill/preview'))
        .set(employeeAuth.headers),
      request(app)
        .post(api(orgId, '/leave/balances/backfill'))
        .set(employeeAuth.headers)
        .send({ confirm: true }),
      request(app)
        .get(api(orgId, '/leave/balances/reconciliation'))
        .set(employeeAuth.headers),
      request(app)
        .post(api(orgId, '/leave/balances/reconciliation/repair'))
        .set(employeeAuth.headers)
        .send({ confirm: true, balanceIds: [employee.user.id] }),
      request(app)
        .get(api(orgId, '/leave/balances/accrual-preview'))
        .set(employeeAuth.headers),
      request(app)
        .post(api(orgId, '/leave/balances/bulk-adjustments/preview'))
        .set(employeeAuth.headers)
        .send({
          employeeIds: [employee.user.id],
          leaveTypeId: type.id,
          amount: 1,
          reason: 'Denied',
        }),
      request(app)
        .post(api(orgId, '/leave/balances/bulk-adjustments'))
        .set(employeeAuth.headers)
        .send({
          employeeIds: [employee.user.id],
          leaveTypeId: type.id,
          amount: 1,
          reason: 'Denied',
          confirm: true,
        }),
      request(app)
        .post(api(orgId, `/leave/balances/${employee.user.id}/adjustments/preview`))
        .set(employeeAuth.headers)
        .send({ leaveTypeId: type.id, amount: 1, reason: 'Denied' }),
      request(app)
        .post(api(orgId, `/leave/balances/${employee.user.id}/adjustments`))
        .set(employeeAuth.headers)
        .send({ leaveTypeId: type.id, amount: 1, reason: 'Denied' }),
    ]);
    for (const response of requests) {
      expect(response.status).toBe(403);
    }
  });
});
