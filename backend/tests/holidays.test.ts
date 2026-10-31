import request from 'supertest';
import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it } from 'vitest';
import { TimeSession } from '../src/database';
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

function nextWeekday(weekday: number, minDaysAhead = 14): string {
  let cursor = DateTime.utc().plus({ days: minDaysAhead }).startOf('day');
  while (cursor.weekday !== weekday) cursor = cursor.plus({ days: 1 });
  return cursor.toISODate()!;
}

function previousWeekday(weekday: number, minDaysBack = 14): string {
  let cursor = DateTime.utc().minus({ days: minDaysBack }).startOf('day');
  while (cursor.weekday !== weekday) cursor = cursor.minus({ days: 1 });
  return cursor.toISODate()!;
}

async function createHoliday(
  orgId: string,
  auth: Auth,
  body: Record<string, unknown>,
) {
  return request(app)
    .post(api(orgId, '/holidays'))
    .set(auth.headers)
    .send(body);
}

async function listHolidays(
  orgId: string,
  auth: Auth,
  query = '',
) {
  return request(app)
    .get(api(orgId, `/holidays${query}`))
    .set(auth.headers);
}

async function createLeaveType(orgId: string, auth: Auth, name: string) {
  const response = await request(app)
    .post(api(orgId, '/leave/types'))
    .set(auth.headers)
    .send({ name });
  expect(response.status).toBe(201);
  return response.body.data.leaveType as { id: string; policy: { id: string } };
}

async function configurePolicy(
  orgId: string,
  auth: Auth,
  policyId: string,
  initialEntitlement: number,
) {
  const response = await request(app)
    .put(api(orgId, `/leave/policies/${policyId}`))
    .set(auth.headers)
    .send({
      initialEntitlement,
      balancePeriodStartMonth: DateTime.utc().month,
      balancePeriodStartDay: 1,
    });
  expect(response.status).toBe(200);
}

async function createTeam() {
  const owner = await createOwner(uniqueEmail('holiday-owner'), 'Holiday Org');
  const ownerAuth = await desktopAuth(owner.email);
  const employee = await inviteAndAccept(owner, {
    role: 'EMPLOYEE',
    name: 'Holiday Employee',
    email: uniqueEmail('holiday-employee'),
  });
  const employeeAuth = await desktopAuth(employee.email);
  const otherEmployee = await inviteAndAccept(owner, {
    role: 'EMPLOYEE',
    name: 'Other Employee',
    email: uniqueEmail('holiday-other'),
  });
  const otherEmployeeAuth = await desktopAuth(otherEmployee.email);
  const manager = await inviteAndAccept(owner, {
    role: 'MANAGER',
    name: 'Holiday Manager',
    email: uniqueEmail('holiday-manager'),
  });
  const managerAuth = await desktopAuth(manager.email);

  return {
    owner,
    ownerAuth,
    employee,
    employeeAuth,
    otherEmployee,
    otherEmployeeAuth,
    manager,
    managerAuth,
    orgId: owner.organization.id,
  };
}

describe('holiday calendar', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('creates, lists, updates, duplicates, and deletes holidays with duplicate validation', async () => {
    const { orgId, ownerAuth } = await createTeam();
    const holidayDate = nextWeekday(1);

    const created = await createHoliday(orgId, ownerAuth, {
      name: 'Founders Day',
      holidayDate,
      category: 'COMPANY',
      duration: 'FULL_DAY',
      description: 'Company anniversary',
      appliesToAll: true,
    });
    expect(created.status).toBe(201);
    expect(created.body.data.holiday).toMatchObject({
      name: 'Founders Day',
      holidayDate,
      category: 'COMPANY',
      duration: 'FULL_DAY',
      appliesToAll: true,
      applicableEmployeeIds: [],
    });

    const duplicate = await createHoliday(orgId, ownerAuth, {
      name: 'founders day',
      holidayDate,
      category: 'COMPANY',
      duration: 'FULL_DAY',
      appliesToAll: true,
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('HOLIDAY_DUPLICATE');

    // A different holiday on the same date is allowed.
    const second = await createHoliday(orgId, ownerAuth, {
      name: 'Team Lunch',
      holidayDate,
      category: 'OPTIONAL',
      duration: 'SECOND_HALF',
      appliesToAll: true,
    });
    expect(second.status).toBe(201);

    const year = holidayDate.slice(0, 4);
    const listed = await listHolidays(orgId, ownerAuth, `?year=${year}`);
    expect(listed.status).toBe(200);
    expect(listed.body.data.holidays).toHaveLength(2);
    expect(listed.body.data.year).toBe(Number(year));

    const updated = await request(app)
      .patch(api(orgId, `/holidays/${created.body.data.holiday.id}`))
      .set(ownerAuth.headers)
      .send({ name: 'Founders Day (Observed)', category: 'PUBLIC' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.holiday).toMatchObject({
      name: 'Founders Day (Observed)',
      category: 'PUBLIC',
    });

    const duplicated = await request(app)
      .post(api(orgId, `/holidays/${created.body.data.holiday.id}/duplicate`))
      .set(ownerAuth.headers)
      .send({ holidayDate: nextWeekday(2) });
    expect(duplicated.status).toBe(201);
    expect(duplicated.body.data.holiday.name).toBe('Founders Day (Observed)');

    const deleted = await request(app)
      .delete(api(orgId, `/holidays/${duplicated.body.data.holiday.id}`))
      .set(ownerAuth.headers);
    expect(deleted.status).toBe(204);
  });

  it('guards past holidays until the historical change is confirmed', async () => {
    const { orgId, ownerAuth } = await createTeam();
    const pastDate = previousWeekday(2);

    const blockedCreate = await createHoliday(orgId, ownerAuth, {
      name: 'Past Holiday',
      holidayDate: pastDate,
      category: 'COMPANY',
      duration: 'FULL_DAY',
      appliesToAll: true,
    });
    expect(blockedCreate.status).toBe(409);
    expect(blockedCreate.body.error.code).toBe('HOLIDAY_HISTORICAL_LOCKED');

    const created = await createHoliday(orgId, ownerAuth, {
      name: 'Past Holiday',
      holidayDate: pastDate,
      category: 'COMPANY',
      duration: 'FULL_DAY',
      appliesToAll: true,
      confirmHistorical: true,
    });
    expect(created.status).toBe(201);
    const holidayId = created.body.data.holiday.id as string;

    const blockedUpdate = await request(app)
      .patch(api(orgId, `/holidays/${holidayId}`))
      .set(ownerAuth.headers)
      .send({ name: 'Renamed Past Holiday' });
    expect(blockedUpdate.status).toBe(409);
    expect(blockedUpdate.body.error.code).toBe('HOLIDAY_HISTORICAL_LOCKED');

    const confirmedUpdate = await request(app)
      .patch(api(orgId, `/holidays/${holidayId}`))
      .set(ownerAuth.headers)
      .send({ name: 'Renamed Past Holiday', confirmHistorical: true });
    expect(confirmedUpdate.status).toBe(200);

    const blockedDelete = await request(app)
      .delete(api(orgId, `/holidays/${holidayId}`))
      .set(ownerAuth.headers);
    expect(blockedDelete.status).toBe(409);

    const confirmedDelete = await request(app)
      .delete(api(orgId, `/holidays/${holidayId}?confirmHistorical=true`))
      .set(ownerAuth.headers);
    expect(confirmedDelete.status).toBe(204);
  });

  it('filters employee-specific holidays and enforces holiday permissions', async () => {
    const {
      orgId,
      ownerAuth,
      employee,
      employeeAuth,
      otherEmployeeAuth,
      managerAuth,
    } = await createTeam();
    const holidayDate = nextWeekday(3);

    const created = await createHoliday(orgId, ownerAuth, {
      name: 'Employee Only Holiday',
      holidayDate,
      category: 'COMPANY',
      duration: 'FULL_DAY',
      appliesToAll: false,
      applicableEmployeeIds: [employee.user.id],
    });
    expect(created.status).toBe(201);
    expect(created.body.data.holiday.appliesToAll).toBe(false);

    const ownList = await listHolidays(orgId, employeeAuth);
    expect(ownList.status).toBe(200);
    expect(ownList.body.data.holidays.map((holiday: { id: string }) => holiday.id)).toContain(
      created.body.data.holiday.id,
    );

    const otherList = await listHolidays(orgId, otherEmployeeAuth);
    expect(otherList.status).toBe(200);
    expect(otherList.body.data.holidays).toHaveLength(0);

    const otherDetail = await request(app)
      .get(api(orgId, `/holidays/${created.body.data.holiday.id}`))
      .set(otherEmployeeAuth.headers);
    expect(otherDetail.status).toBe(404);

    // Managers can read the organization calendar but cannot manage it.
    const managerList = await listHolidays(orgId, managerAuth);
    expect(managerList.status).toBe(200);
    expect(managerList.body.data.holidays).toHaveLength(1);

    // The employee directory is available only to holiday editors.
    const managerEmployees = await request(app)
      .get(api(orgId, '/holidays/employees'))
      .set(managerAuth.headers);
    expect(managerEmployees.status).toBe(403);

    const employeeEmployees = await request(app)
      .get(api(orgId, '/holidays/employees'))
      .set(employeeAuth.headers);
    expect(employeeEmployees.status).toBe(403);

    const ownerEmployees = await request(app)
      .get(api(orgId, '/holidays/employees'))
      .set(ownerAuth.headers);
    expect(ownerEmployees.status).toBe(200);
    expect(ownerEmployees.body.data.map((member: { id: string }) => member.id)).toContain(
      employee.user.id,
    );

    const managerCreate = await createHoliday(orgId, managerAuth, {
      name: 'Manager Holiday',
      holidayDate: nextWeekday(4),
      category: 'COMPANY',
      duration: 'FULL_DAY',
      appliesToAll: true,
    });
    expect(managerCreate.status).toBe(403);

    const employeeCreate = await createHoliday(orgId, employeeAuth, {
      name: 'Employee Holiday',
      holidayDate: nextWeekday(4),
      category: 'COMPANY',
      duration: 'FULL_DAY',
      appliesToAll: true,
    });
    expect(employeeCreate.status).toBe(403);

    const employeeUpdate = await request(app)
      .patch(api(orgId, `/holidays/${created.body.data.holiday.id}`))
      .set(employeeAuth.headers)
      .send({ name: 'Hacked' });
    expect(employeeUpdate.status).toBe(403);

    const employeeDelete = await request(app)
      .delete(api(orgId, `/holidays/${created.body.data.holiday.id}`))
      .set(employeeAuth.headers);
    expect(employeeDelete.status).toBe(403);
  });

  it('prevents cross-organization access and supports custom holiday permissions', async () => {
    const { orgId, owner, employee, employeeAuth } = await createTeam();
    const outsider = await createOwner(uniqueEmail('holiday-outsider'), 'Other Org');
    const outsiderAuth = await desktopAuth(outsider.email);
    const holidayDate = nextWeekday(5);

    const created = await createHoliday(orgId, await desktopAuth(owner.email), {
      name: 'Private Holiday',
      holidayDate,
      category: 'COMPANY',
      duration: 'FULL_DAY',
      appliesToAll: true,
    });
    expect(created.status).toBe(201);

    const crossOrgList = await listHolidays(outsider.organization.id, outsiderAuth);
    expect(crossOrgList.status).toBe(200);
    expect(crossOrgList.body.data.holidays).toHaveLength(0);

    const crossOrgDetail = await request(app)
      .get(api(outsider.organization.id, `/holidays/${created.body.data.holiday.id}`))
      .set(outsiderAuth.headers);
    expect(crossOrgDetail.status).toBe(404);

    const role = await owner.agent
      .post(`${API}/organizations/${orgId}/roles`)
      .set('x-csrf-token', owner.csrf)
      .send({
        name: 'Holiday Coordinator',
        permissions: [
          'holiday:view',
          'holiday:create',
          'holiday:update',
          'holiday:delete',
          'holiday:settings:manage',
        ],
        dataScope: 'ORGANIZATION',
      });
    expect(role.status).toBe(201);

    const assigned = await owner.agent
      .patch(`${API}/organizations/${orgId}/members/${employee.membership.id}`)
      .set('x-csrf-token', owner.csrf)
      .send({ customRoleId: role.body.data.role.id });
    expect(assigned.status).toBe(200);

    // The existing session reflects the new custom role immediately.
    const customCreate = await createHoliday(orgId, employeeAuth, {
      name: 'Coordinator Holiday',
      holidayDate: nextWeekday(6),
      category: 'COMPANY',
      duration: 'FULL_DAY',
      appliesToAll: true,
    });
    expect(customCreate.status).toBe(201);

    const settings = await request(app)
      .put(api(orgId, '/holidays/settings'))
      .set(employeeAuth.headers)
      .send({ workingDays: [1, 2, 3, 4, 5, 6], optionalHolidaysEnabled: false });
    expect(settings.status).toBe(200);
    expect(settings.body.data.settings.workingDays).toEqual([1, 2, 3, 4, 5, 6]);

    const disabled = await request(app)
      .put(api(orgId, '/holidays/settings'))
      .set(employeeAuth.headers)
      .send({ enabled: false });
    expect(disabled.status).toBe(200);

    const blockedCreate = await createHoliday(orgId, employeeAuth, {
      name: 'Blocked Holiday',
      holidayDate: nextWeekday(7),
      category: 'COMPANY',
      duration: 'FULL_DAY',
      appliesToAll: true,
    });
    expect(blockedCreate.status).toBe(409);
    expect(blockedCreate.body.error.code).toBe('HOLIDAY_MANAGEMENT_DISABLED');
  });

  it('charges leave around full-day and half-day holidays for the actual employee', async () => {
    const { orgId, ownerAuth, employeeAuth, otherEmployeeAuth } = await createTeam();
    const monday = nextWeekday(1);
    const wednesday = DateTime.fromISO(monday).plus({ days: 2 }).toISODate()!;
    const thursday = DateTime.fromISO(monday).plus({ days: 3 }).toISODate()!;
    const friday = DateTime.fromISO(monday).plus({ days: 4 }).toISODate()!;

    const type = await createLeaveType(orgId, ownerAuth, 'Holiday Leave');
    await configurePolicy(orgId, ownerAuth, type.policy.id, 20);

    await createHoliday(orgId, ownerAuth, {
      name: 'Midweek Holiday',
      holidayDate: wednesday,
      category: 'COMPANY',
      duration: 'FULL_DAY',
      appliesToAll: true,
    });

    const fullWeek = await request(app)
      .post(api(orgId, '/leave/requests'))
      .set(employeeAuth.headers)
      .send({
        leaveTypeId: type.id,
        startDate: monday,
        endDate: friday,
        reason: 'Family trip',
      });
    expect(fullWeek.status).toBe(201);
    expect(fullWeek.body.data.request.units).toBe(4);
    expect(
      fullWeek.body.data.request.chargedDates.map((day: { date: string }) => day.date),
    ).not.toContain(wednesday);

    const halfDayHoliday = await createHoliday(orgId, ownerAuth, {
      name: 'Half Day Holiday',
      holidayDate: thursday,
      category: 'COMPANY',
      duration: 'FIRST_HALF',
      appliesToAll: false,
      applicableEmployeeIds: [otherEmployeeAuth.user.id],
    });
    expect(halfDayHoliday.status).toBe(201);

    const halfWeek = await request(app)
      .post(api(orgId, '/leave/requests'))
      .set(otherEmployeeAuth.headers)
      .send({
        leaveTypeId: type.id,
        startDate: thursday,
        endDate: friday,
        reason: 'Long weekend',
      });
    expect(halfWeek.status).toBe(201);
    expect(halfWeek.body.data.request.units).toBe(1.5);
    const thursdayCharge = halfWeek.body.data.request.chargedDates.find(
      (day: { date: string }) => day.date === thursday,
    );
    expect(thursdayCharge.units).toBe(0.5);

    // A holiday scoped to another employee must not reduce this employee's leave.
    const cancelled = await request(app)
      .post(api(orgId, `/leave/requests/${fullWeek.body.data.request.id}/cancel`))
      .set(employeeAuth.headers)
      .send({ reason: 'Replanning' });
    expect(cancelled.status).toBe(200);

    const unaffected = await request(app)
      .post(api(orgId, '/leave/requests'))
      .set(employeeAuth.headers)
      .send({
        leaveTypeId: type.id,
        startDate: thursday,
        endDate: thursday,
        reason: 'Single day',
      });
    expect(unaffected.status).toBe(201);
    expect(unaffected.body.data.request.units).toBe(1);
  });

  it('classifies attendance without converting actual work on a holiday', async () => {
    const { orgId, ownerAuth, employee, employeeAuth } = await createTeam();
    const nextMonday = nextWeekday(1);
    const nextTuesday = DateTime.fromISO(nextMonday).plus({ days: 1 }).toISODate()!;
    const nextWednesday = DateTime.fromISO(nextMonday).plus({ days: 2 }).toISODate()!;
    const nextSaturday = DateTime.fromISO(nextMonday).plus({ days: 5 }).toISODate()!;
    const pastMonday = previousWeekday(1);
    const pastTuesday = DateTime.fromISO(pastMonday).plus({ days: 1 }).toISODate()!;

    const type = await createLeaveType(orgId, ownerAuth, 'Attendance Leave');
    await configurePolicy(orgId, ownerAuth, type.policy.id, 20);

    const applied = await request(app)
      .post(api(orgId, '/leave/requests'))
      .set(employeeAuth.headers)
      .send({
        leaveTypeId: type.id,
        startDate: nextMonday,
        endDate: nextMonday,
        reason: 'Appointment',
      });
    expect(applied.status).toBe(201);
    const approved = await request(app)
      .post(api(orgId, `/leave/requests/${applied.body.data.request.id}/approve`))
      .set(ownerAuth.headers)
      .send({});
    expect(approved.status).toBe(200);

    await createHoliday(orgId, ownerAuth, {
      name: 'Full Holiday',
      holidayDate: nextTuesday,
      category: 'COMPANY',
      duration: 'FULL_DAY',
      appliesToAll: true,
    });
    await createHoliday(orgId, ownerAuth, {
      name: 'Half Holiday',
      holidayDate: nextWednesday,
      category: 'COMPANY',
      duration: 'SECOND_HALF',
      appliesToAll: true,
    });

    // Actual work on a full-day holiday must remain visible as holiday work.
    await TimeSession.create({
      organizationId: orgId,
      employeeId: employee.user.id,
      desktopAgentId: null,
      startedAt: DateTime.fromISO(nextTuesday, { zone: 'utc' }).set({ hour: 9 }).toJSDate(),
      endedAt: DateTime.fromISO(nextTuesday, { zone: 'utc' }).set({ hour: 12 }).toJSDate(),
      status: 'STOPPED',
      source: 'ONLINE',
      lastHeartbeatAt: DateTime.fromISO(nextTuesday, { zone: 'utc' }).set({ hour: 12 }).toJSDate(),
    });

    // A normal past working day with tracked time is Present.
    await TimeSession.create({
      organizationId: orgId,
      employeeId: employee.user.id,
      desktopAgentId: null,
      startedAt: DateTime.fromISO(pastTuesday, { zone: 'utc' }).set({ hour: 9 }).toJSDate(),
      endedAt: DateTime.fromISO(pastTuesday, { zone: 'utc' }).set({ hour: 17 }).toJSDate(),
      status: 'STOPPED',
      source: 'ONLINE',
      lastHeartbeatAt: DateTime.fromISO(pastTuesday, { zone: 'utc' }).set({ hour: 17 }).toJSDate(),
    });

    const from = pastMonday;
    const to = nextSaturday;
    const response = await request(app)
      .get(api(orgId, `/attendance/day-status?from=${from}&to=${to}`))
      .set(employeeAuth.headers);
    expect(response.status).toBe(200);
    const days = response.body.data.days as Array<{
      date: string;
      status: string;
      workedSeconds: number;
      holidayUnits: number;
      leaveUnits: number;
    }>;
    const byDate = new Map(days.map((day) => [day.date, day]));

    expect(byDate.get(pastMonday)?.status).toBe('ABSENT');
    expect(byDate.get(pastTuesday)?.status).toBe('PRESENT');
    expect(byDate.get(nextMonday)?.status).toBe('ON_LEAVE');
    expect(byDate.get(nextTuesday)?.status).toBe('HOLIDAY_WORKED');
    expect(byDate.get(nextTuesday)?.workedSeconds).toBeGreaterThan(0);
    expect(byDate.get(nextWednesday)?.status).toBe('HALF_DAY_HOLIDAY');
    expect(byDate.get(nextWednesday)?.holidayUnits).toBe(0.5);
    expect(byDate.get(nextSaturday)?.status).toBe('WEEKLY_OFF');
    expect(response.body.data.summary.HOLIDAY_WORKED).toBe(1);
    expect(response.body.data.summary.ON_LEAVE).toBe(1);
  });
});
