import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { holidayUnitsForEmployee } from '../src/modules/leave/holiday.service';
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

type PreviewEntry = {
  sourceId: string;
  name: string;
  holidayDate: string;
  category: string;
  status: 'AVAILABLE' | 'IMPORTED' | 'DUPLICATE_NAME';
};

function holidaysPath(orgId: string, suffix = ''): string {
  return `${API}/organizations/${orgId}/holidays${suffix}`;
}

async function preview(
  orgId: string,
  auth: Auth,
  query: { country?: string; region?: string; year: number },
) {
  const params = new URLSearchParams({
    country: query.country ?? 'IN',
    region: query.region ?? 'NATIONAL',
    year: String(query.year),
  });
  return request(app)
    .get(holidaysPath(orgId, `/government/preview?${params.toString()}`))
    .set(auth.headers);
}

async function importHolidays(
  orgId: string,
  auth: Auth & { agent?: ReturnType<typeof request.agent>; csrf?: string },
  body: {
    country?: string;
    region?: string;
    year: number;
    sourceIds: string[];
  },
) {
  return request(app)
    .post(holidaysPath(orgId, '/government/import'))
    .set(auth.headers)
    .send({
      country: body.country ?? 'IN',
      region: body.region ?? 'NATIONAL',
      year: body.year,
      sourceIds: body.sourceIds,
    });
}

function byName(entries: PreviewEntry[], name: string): PreviewEntry {
  const entry = entries.find((candidate) => candidate.name === name);
  if (!entry) throw new Error(`Catalog entry ${name} not found`);
  return entry;
}

describe('government holiday catalog', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('exposes only verified jurisdictions and years', async () => {
    const owner = await createOwner(uniqueEmail('gov-owner'), 'Government Org');
    const ownerAuth = await desktopAuth(owner.email);
    const orgId = owner.organization.id;

    const jurisdictions = await request(app)
      .get(holidaysPath(orgId, '/government/jurisdictions'))
      .set(ownerAuth.headers);
    expect(jurisdictions.status).toBe(200);
    const india = jurisdictions.body.data.countries.find(
      (country: { code: string }) => country.code === 'IN',
    );
    expect(india.regions.map((region: { code: string }) => region.code)).toEqual([
      'NATIONAL',
      'UTTARAKHAND',
    ]);
    const national = india.regions.find((region: { code: string }) => region.code === 'NATIONAL');
    expect(national.years).toHaveLength(1);
    expect(national.years[0]).toMatchObject({ year: 2026, holidayCount: 51 });
    expect(national.years[0].source.reference).toContain('12/2/2023-JCA');
    const state = india.regions.find((region: { code: string }) => region.code === 'UTTARAKHAND');
    expect(state.years[0]).toMatchObject({ year: 2026, holidayCount: 45 });
    expect(state.years[0].source.reference).toContain('GAD-GEN/GEN/28/2025');

    const nationalPreview = await preview(orgId, ownerAuth, { year: 2026 });
    expect(nationalPreview.status).toBe(200);
    expect(nationalPreview.body.data.available).toBe(true);
    expect(nationalPreview.body.data.counts).toMatchObject({
      total: 51,
      available: 51,
      imported: 0,
    });
    expect(nationalPreview.body.data.source.retrievedOn).toBe('2026-10-30');

    const statePreview = await preview(orgId, ownerAuth, { region: 'UTTARAKHAND', year: 2026 });
    expect(statePreview.status).toBe(200);
    expect(statePreview.body.data.counts.total).toBe(45);
    const categories = new Set(
      (statePreview.body.data.entries as PreviewEntry[]).map((entry) => entry.category),
    );
    expect(categories).toEqual(new Set(['NATIONAL', 'STATE', 'RESTRICTED']));

    const unavailable = await preview(orgId, ownerAuth, { year: 2027 });
    expect(unavailable.status).toBe(200);
    expect(unavailable.body.data.available).toBe(false);
    expect(unavailable.body.data.entries).toEqual([]);
    expect(unavailable.body.data.availableYears).toEqual([2026]);
    expect(unavailable.body.data.message).toContain('No verified');

    const unsupported = await preview(orgId, ownerAuth, { region: 'ATLANTIS', year: 2026 });
    expect(unsupported.status).toBe(422);
    expect(unsupported.body.error.code).toBe('HOLIDAY_JURISDICTION_UNSUPPORTED');

    const blockedImport = await importHolidays(orgId, ownerAuth, {
      year: 2027,
      sourceIds: ['in-national-2027-gaz-01'],
    });
    expect(blockedImport.status).toBe(422);
    expect(blockedImport.body.error.code).toBe('HOLIDAY_SOURCE_UNAVAILABLE');
  });

  it('imports national holidays as unpublished drafts until an admin publishes them', async () => {
    const owner = await createOwner(uniqueEmail('gov-owner'), 'Government Org');
    const employee = await inviteAndAccept(owner, {
      role: 'EMPLOYEE',
      name: 'Government Employee',
      email: uniqueEmail('gov-employee'),
    });
    const employeeAuth = await desktopAuth(employee.email);
    const ownerAuth = await desktopAuth(owner.email);
    const orgId = owner.organization.id;

    const nationalPreview = await preview(orgId, ownerAuth, { year: 2026 });
    const entries = nationalPreview.body.data.entries as PreviewEntry[];
    const republicDay = byName(entries, 'Republic Day');
    const independenceDay = byName(entries, 'Independence Day');
    const christmas = byName(entries, 'Christmas Day');

    const imported = await importHolidays(orgId, ownerAuth, {
      year: 2026,
      sourceIds: [republicDay.sourceId, independenceDay.sourceId, christmas.sourceId],
    });
    expect(imported.status).toBe(201);
    expect(imported.body.data.imported).toHaveLength(3);
    expect(imported.body.data.imported[0]).toMatchObject({
      category: 'NATIONAL',
      published: false,
      source: 'GOVERNMENT',
      sourceYear: 2026,
      jurisdictionCountry: 'IN',
      jurisdictionRegion: 'NATIONAL',
    });
    expect(imported.body.data.imported[0].sourceReference).toContain('12/2/2023-JCA');
    expect(imported.body.data.skipped).toEqual([]);
    const importedIds = imported.body.data.imported.map(
      (holiday: { id: string }) => holiday.id,
    ) as string[];

    const adminList = await request(app)
      .get(holidaysPath(orgId, '?year=2026'))
      .set(ownerAuth.headers);
    expect(adminList.status).toBe(200);
    expect(adminList.body.data.total).toBe(3);
    expect(
      adminList.body.data.holidays.every(
        (holiday: { published: boolean }) => holiday.published === false,
      ),
    ).toBe(true);

    const employeeList = await request(app)
      .get(holidaysPath(orgId, '?year=2026'))
      .set(employeeAuth.headers);
    expect(employeeList.status).toBe(200);
    expect(employeeList.body.data.total).toBe(0);

    const draftDetail = await request(app)
      .get(holidaysPath(orgId, `/${importedIds[0]}`))
      .set(employeeAuth.headers);
    expect(draftDetail.status).toBe(404);

    // Publishing a past holiday changes historical classification, so it must
    // be confirmed explicitly.
    const blockedPublish = await request(app)
      .post(holidaysPath(orgId, '/publication'))
      .set(ownerAuth.headers)
      .send({ holidayIds: importedIds, published: true });
    expect(blockedPublish.status).toBe(409);
    expect(blockedPublish.body.error.code).toBe('HOLIDAY_HISTORICAL_LOCKED');

    const published = await request(app)
      .post(holidaysPath(orgId, '/publication'))
      .set(ownerAuth.headers)
      .send({ holidayIds: importedIds, published: true, confirmHistorical: true });
    expect(published.status).toBe(200);
    expect(published.body.data.changed).toBe(3);
    expect(
      published.body.data.holidays.every(
        (holiday: { published: boolean }) => holiday.published === true,
      ),
    ).toBe(true);

    const employeeListAfter = await request(app)
      .get(holidaysPath(orgId, '?year=2026'))
      .set(employeeAuth.headers);
    expect(employeeListAfter.body.data.total).toBe(3);

    const republished = await request(app)
      .post(holidaysPath(orgId, '/publication'))
      .set(ownerAuth.headers)
      .send({ holidayIds: importedIds, published: true, confirmHistorical: true });
    expect(republished.status).toBe(200);
    expect(republished.body.data.changed).toBe(0);
  });

  it('prevents duplicate imports and never overwrites company holidays', async () => {
    const owner = await createOwner(uniqueEmail('gov-owner'), 'Government Org');
    const ownerAuth = await desktopAuth(owner.email);
    const orgId = owner.organization.id;

    const companyHoliday = await request(app)
      .post(holidaysPath(orgId))
      .set(ownerAuth.headers)
      .send({
        name: 'Christmas Day',
        holidayDate: '2026-12-25',
        category: 'COMPANY',
        description: 'Office closure',
      });
    expect(companyHoliday.status).toBe(201);

    const nationalPreview = await preview(orgId, ownerAuth, { year: 2026 });
    const entries = nationalPreview.body.data.entries as PreviewEntry[];
    const christmas = byName(entries, 'Christmas Day');
    expect(christmas.status).toBe('DUPLICATE_NAME');

    const skippedImport = await importHolidays(orgId, ownerAuth, {
      year: 2026,
      sourceIds: [christmas.sourceId],
    });
    expect(skippedImport.status).toBe(201);
    expect(skippedImport.body.data.imported).toEqual([]);
    expect(skippedImport.body.data.skipped).toEqual([
      expect.objectContaining({ sourceId: christmas.sourceId, reason: 'DUPLICATE_NAME' }),
    ]);

    const listed = await request(app)
      .get(holidaysPath(orgId, '?from=2026-12-01&to=2026-12-31'))
      .set(ownerAuth.headers);
    expect(listed.body.data.holidays).toHaveLength(1);
    expect(listed.body.data.holidays[0]).toMatchObject({
      name: 'Christmas Day',
      category: 'COMPANY',
      published: true,
      source: 'MANUAL',
    });

    const holi = byName(entries, 'Holi');
    const diwali = byName(entries, 'Diwali (Deepavali)');
    const firstImport = await importHolidays(orgId, ownerAuth, {
      year: 2026,
      sourceIds: [holi.sourceId, diwali.sourceId],
    });
    expect(firstImport.status).toBe(201);
    expect(firstImport.body.data.imported).toHaveLength(2);

    const secondImport = await importHolidays(orgId, ownerAuth, {
      year: 2026,
      sourceIds: [holi.sourceId, diwali.sourceId],
    });
    expect(secondImport.status).toBe(201);
    expect(secondImport.body.data.imported).toEqual([]);
    expect(
      secondImport.body.data.skipped.every(
        (entry: { reason: string }) => entry.reason === 'ALREADY_IMPORTED',
      ),
    ).toBe(true);

    const after = await request(app)
      .get(holidaysPath(orgId, '?year=2026'))
      .set(ownerAuth.headers);
    expect(after.body.data.total).toBe(3);
  });

  it('imports Uttarakhand state holidays into their own jurisdiction', async () => {
    const owner = await createOwner(uniqueEmail('gov-owner'), 'Government Org');
    const ownerAuth = await desktopAuth(owner.email);
    const orgId = owner.organization.id;

    const statePreview = await preview(orgId, ownerAuth, { region: 'UTTARAKHAND', year: 2026 });
    const stateEntries = statePreview.body.data.entries as PreviewEntry[];
    const harela = byName(stateEntries, 'Harela');
    const igas = byName(stateEntries, 'Igas-Bagwal');
    expect(harela.category).toBe('STATE');

    const imported = await importHolidays(orgId, ownerAuth, {
      country: 'IN',
      region: 'UTTARAKHAND',
      year: 2026,
      sourceIds: [harela.sourceId, igas.sourceId],
    });
    expect(imported.status).toBe(201);
    expect(imported.body.data.imported).toHaveLength(2);
    expect(imported.body.data.imported[0]).toMatchObject({
      name: 'Harela',
      category: 'STATE',
      published: false,
      jurisdictionRegion: 'UTTARAKHAND',
    });
    expect(imported.body.data.imported[0].sourceReference).toContain('GAD-GEN/GEN/28/2025');

    const nationalPreview = await preview(orgId, ownerAuth, { year: 2026 });
    const nationalIds = new Set(
      (nationalPreview.body.data.entries as PreviewEntry[]).map((entry) => entry.sourceId),
    );
    expect(nationalIds.has(harela.sourceId)).toBe(false);
  });

  it('keeps restricted holidays informational and out of attendance and leave', async () => {
    const owner = await createOwner(uniqueEmail('gov-owner'), 'Government Org');
    const employee = await inviteAndAccept(owner, {
      role: 'EMPLOYEE',
      name: 'Restricted Employee',
      email: uniqueEmail('gov-restricted'),
    });
    const employeeAuth = await desktopAuth(employee.email);
    const ownerAuth = await desktopAuth(owner.email);
    const orgId = owner.organization.id;

    const nationalPreview = await preview(orgId, ownerAuth, { year: 2026 });
    const entries = nationalPreview.body.data.entries as PreviewEntry[];
    const newYear = byName(entries, "New Year's Day");
    const republicDay = byName(entries, 'Republic Day');
    expect(newYear.category).toBe('RESTRICTED');

    const imported = await importHolidays(orgId, ownerAuth, {
      year: 2026,
      sourceIds: [newYear.sourceId, republicDay.sourceId],
    });
    expect(imported.status).toBe(201);
    const importedIds = imported.body.data.imported.map(
      (holiday: { id: string }) => holiday.id,
    ) as string[];

    const beforePublish = await holidayUnitsForEmployee({
      organizationId: orgId,
      employeeId: employee.user.id,
      from: '2026-01-01',
      to: '2026-01-31',
    });
    expect(beforePublish.size).toBe(0);

    const published = await request(app)
      .post(holidaysPath(orgId, '/publication'))
      .set(ownerAuth.headers)
      .send({ holidayIds: importedIds, published: true, confirmHistorical: true });
    expect(published.status).toBe(200);

    const units = await holidayUnitsForEmployee({
      organizationId: orgId,
      employeeId: employee.user.id,
      from: '2026-01-01',
      to: '2026-01-31',
    });
    expect(units.get('2026-01-20') ?? null).toBeNull();
    expect(units.get('2026-01-26')).toBe(1);
    expect(units.has('2026-01-01')).toBe(false);

    const dayStatus = await request(app)
      .get(
        `${API}/organizations/${orgId}/attendance/day-status?from=2026-01-01&to=2026-01-26`,
      )
      .set(employeeAuth.headers);
    expect(dayStatus.status).toBe(200);
    const days = new Map<string, { status: string; holidays: Array<{ category: string }> }>(
      (dayStatus.body.data.days as Array<{ date: string; status: string; holidays: Array<{ category: string }> }>).map(
        (day) => [day.date, day],
      ),
    );
    expect(days.get('2026-01-01')?.status).not.toBe('HOLIDAY');
    expect(days.get('2026-01-01')?.holidays[0]?.category).toBe('RESTRICTED');
    expect(days.get('2026-01-26')?.status).toBe('HOLIDAY');

    const disableOptional = await request(app)
      .put(holidaysPath(orgId, '/settings'))
      .set(ownerAuth.headers)
      .send({ optionalHolidaysEnabled: false });
    expect(disableOptional.status).toBe(200);

    const makarSankranti = byName(entries, 'Makar Sankranti');
    const blocked = await importHolidays(orgId, ownerAuth, {
      year: 2026,
      sourceIds: [makarSankranti.sourceId],
    });
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe('HOLIDAY_OPTIONAL_DISABLED');
  });

  it('enforces holiday permissions and organization isolation', async () => {
    const owner = await createOwner(uniqueEmail('gov-owner'), 'Government Org');
    const employee = await inviteAndAccept(owner, {
      role: 'EMPLOYEE',
      name: 'Blocked Employee',
      email: uniqueEmail('gov-blocked'),
    });
    const manager = await inviteAndAccept(owner, {
      role: 'MANAGER',
      name: 'Blocked Manager',
      email: uniqueEmail('gov-manager'),
    });
    const employeeAuth = await desktopAuth(employee.email);
    const managerAuth = await desktopAuth(manager.email);
    const ownerAuth = await desktopAuth(owner.email);
    const orgId = owner.organization.id;

    const employeePreview = await preview(orgId, employeeAuth, { year: 2026 });
    expect(employeePreview.status).toBe(403);

    const employeeImport = await importHolidays(orgId, employeeAuth, {
      year: 2026,
      sourceIds: ['in-national-2026-gaz-01'],
    });
    expect(employeeImport.status).toBe(403);

    const managerImport = await importHolidays(orgId, managerAuth, {
      year: 2026,
      sourceIds: ['in-national-2026-gaz-01'],
    });
    expect(managerImport.status).toBe(403);

    const employeePublish = await request(app)
      .post(holidaysPath(orgId, '/publication'))
      .set(employeeAuth.headers)
      .send({ holidayIds: [randomUUID()], published: true });
    expect(employeePublish.status).toBe(403);

    const nationalPreview = await preview(orgId, ownerAuth, { year: 2026 });
    const republicDay = byName(
      nationalPreview.body.data.entries as PreviewEntry[],
      'Republic Day',
    );
    const imported = await importHolidays(orgId, ownerAuth, {
      year: 2026,
      sourceIds: [republicDay.sourceId],
    });
    const importedId = imported.body.data.imported[0].id as string;

    const outsider = await createOwner(uniqueEmail('gov-outsider'), 'Other Org');
    const outsiderAuth = await desktopAuth(outsider.email);
    const outsiderList = await request(app)
      .get(holidaysPath(outsider.organization.id, '?year=2026'))
      .set(outsiderAuth.headers);
    expect(outsiderList.body.data.total).toBe(0);

    const crossOrgPublish = await request(app)
      .post(holidaysPath(outsider.organization.id, '/publication'))
      .set(outsiderAuth.headers)
      .send({ holidayIds: [importedId], published: true, confirmHistorical: true });
    expect(crossOrgPublish.status).toBe(404);
  });

  it('validates manual categories and protects imported holidays from duplication', async () => {
    const owner = await createOwner(uniqueEmail('gov-owner'), 'Government Org');
    const ownerAuth = await desktopAuth(owner.email);
    const orgId = owner.organization.id;

    const manualGovernmentCategory = await request(app)
      .post(holidaysPath(orgId))
      .set(ownerAuth.headers)
      .send({ name: 'Fake National Day', holidayDate: '2026-11-03', category: 'NATIONAL' });
    expect(manualGovernmentCategory.status).toBe(422);

    const nationalPreview = await preview(orgId, ownerAuth, { year: 2026 });
    const republicDay = byName(
      nationalPreview.body.data.entries as PreviewEntry[],
      'Republic Day',
    );
    const imported = await importHolidays(orgId, ownerAuth, {
      year: 2026,
      sourceIds: [republicDay.sourceId],
    });
    const importedId = imported.body.data.imported[0].id as string;

    const renamed = await request(app)
      .patch(holidaysPath(orgId, `/${importedId}`))
      .set(ownerAuth.headers)
      .send({ name: 'Republic Day (Observed)', confirmHistorical: true });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.holiday).toMatchObject({
      name: 'Republic Day (Observed)',
      category: 'NATIONAL',
      source: 'GOVERNMENT',
      sourceId: republicDay.sourceId,
      published: false,
    });

    const duplicated = await request(app)
      .post(holidaysPath(orgId, `/${importedId}/duplicate`))
      .set(ownerAuth.headers)
      .send({ holidayDate: '2027-01-26' });
    expect(duplicated.status).toBe(409);
    expect(duplicated.body.error.code).toBe('HOLIDAY_GOVERNMENT_DUPLICATE_UNSUPPORTED');
  });

  it('stores the organization government jurisdiction defaults in holiday settings', async () => {
    const owner = await createOwner(uniqueEmail('gov-owner'), 'Government Org');
    const ownerAuth = await desktopAuth(owner.email);
    const orgId = owner.organization.id;

    const defaults = await request(app)
      .get(holidaysPath(orgId, '/settings'))
      .set(ownerAuth.headers);
    expect(defaults.status).toBe(200);
    expect(defaults.body.data.settings).toMatchObject({
      governmentCountry: 'IN',
      governmentRegion: null,
      governmentYear: null,
    });

    const updated = await request(app)
      .put(holidaysPath(orgId, '/settings'))
      .set(ownerAuth.headers)
      .send({ governmentCountry: 'IN', governmentRegion: 'UTTARAKHAND', governmentYear: 2026 });
    expect(updated.status).toBe(200);
    expect(updated.body.data.settings).toMatchObject({
      governmentCountry: 'IN',
      governmentRegion: 'UTTARAKHAND',
      governmentYear: 2026,
    });

    const employee = await inviteAndAccept(owner, {
      role: 'EMPLOYEE',
      name: 'Read Only Settings',
      email: uniqueEmail('gov-settings'),
    });
    const employeeAuth = await desktopAuth(employee.email);
    const blocked = await request(app)
      .put(holidaysPath(orgId, '/settings'))
      .set(employeeAuth.headers)
      .send({ governmentRegion: 'NATIONAL' });
    expect(blocked.status).toBe(403);
  });
});
