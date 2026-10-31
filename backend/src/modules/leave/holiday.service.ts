import { Op, Transaction, UniqueConstraintError } from 'sequelize';
import {
  LeaveHoliday,
  Membership,
  OrganizationHolidaySettings,
  User,
  sequelize,
} from '../../database';
import { AppError } from '../../utils/errors';
import { recordAuditEvent, type AuditContext } from '../screenshots/audit.service';
import { todayInTimezone } from './leaveCalendar';
import { DEFAULT_WORKING_DAYS } from './leavePolicy.model';
import type { Organization as OrganizationModel } from '../organizations/organization.model';
import type {
  LeaveHoliday as LeaveHolidayModel,
  HolidayCategory,
  HolidayDuration,
} from './leaveHoliday.model';
import { GOVERNMENT_HOLIDAY_CATEGORIES } from './leaveHoliday.model';
import type { OrganizationHolidaySettings as HolidaySettingsModel } from './holidaySettings.model';
import type {
  CreateHolidayInput,
  DeleteHolidayQuery,
  DuplicateHolidayInput,
  GovernmentHolidayImportInput,
  GovernmentHolidayPreviewQuery,
  HolidayListQuery,
  HolidayPublicationInput,
  HolidaySettingsInput,
  UpdateHolidayInput,
} from './holiday.schemas';
import {
  GOVERNMENT_COUNTRIES,
  GOVERNMENT_JURISDICTIONS,
  availableGovernmentYears,
  findGovernmentJurisdiction,
  findGovernmentYear,
  type GovernmentHolidayEntry,
} from './governmentHoliday.catalog';

const HOLIDAY_INCLUDES = [
  { model: User, as: 'createdBy', attributes: ['id', 'name', 'email'], required: false },
  { model: User, as: 'updatedBy', attributes: ['id', 'name', 'email'], required: false },
];

export type HolidayAudience = {
  /** When true, only holidays applicable to this employee are returned. */
  restrictToEmployee: boolean;
  employeeId: string;
};

function userSummary(user: { id: string; name: string; email: string } | undefined) {
  return user ? { id: user.id, name: user.name, email: user.email } : null;
}

export function toHolidaySummary(holiday: LeaveHolidayModel) {
  return {
    id: holiday.id,
    organizationId: holiday.organizationId,
    holidayDate: holiday.holidayDate,
    name: holiday.name,
    category: holiday.category,
    duration: holiday.duration,
    description: holiday.description,
    appliesToAll: holiday.appliesToAll,
    applicableEmployeeIds: holiday.applicableEmployeeIds ?? [],
    departmentIds: holiday.departmentIds ?? [],
    locationIds: holiday.locationIds ?? [],
    published: holiday.published,
    source: holiday.source,
    sourceId: holiday.sourceId,
    sourceYear: holiday.sourceYear,
    sourceName: holiday.sourceName,
    sourceUrl: holiday.sourceUrl,
    sourceReference: holiday.sourceReference,
    jurisdictionCountry: holiday.jurisdictionCountry,
    jurisdictionRegion: holiday.jurisdictionRegion,
    importedAt: holiday.importedAt,
    createdByUserId: holiday.createdByUserId,
    updatedByUserId: holiday.updatedByUserId,
    createdBy: userSummary(holiday.createdBy),
    updatedBy: userSummary(holiday.updatedBy),
    createdAt: holiday.createdAt,
    updatedAt: holiday.updatedAt,
  };
}

export function toHolidaySettingsSummary(settings: HolidaySettingsModel) {
  return {
    id: settings.id,
    organizationId: settings.organizationId,
    enabled: settings.enabled,
    optionalHolidaysEnabled: settings.optionalHolidaysEnabled,
    allowHalfDayHolidays: settings.allowHalfDayHolidays,
    defaultCalendarYear: settings.defaultCalendarYear,
    defaultApplicability: settings.defaultApplicability,
    workingDays: settings.workingDays ?? [...DEFAULT_WORKING_DAYS],
    governmentCountry: settings.governmentCountry,
    governmentRegion: settings.governmentRegion ?? null,
    governmentYear: settings.governmentYear ?? null,
    updatedByUserId: settings.updatedByUserId,
    updatedBy: userSummary(settings.updatedBy),
    updatedAt: settings.updatedAt,
  };
}

export async function ensureHolidaySettings(
  organizationId: string,
  options: { transaction?: Transaction } = {},
): Promise<HolidaySettingsModel> {
  const existing = await OrganizationHolidaySettings.findOne({
    where: { organizationId },
    transaction: options.transaction,
  });
  if (existing) return existing;

  try {
    return await OrganizationHolidaySettings.create(
      { organizationId },
      { transaction: options.transaction },
    );
  } catch (error) {
    if (error instanceof UniqueConstraintError) {
      const raced = await OrganizationHolidaySettings.findOne({
        where: { organizationId },
        transaction: options.transaction,
      });
      if (raced) return raced;
    }
    throw error;
  }
}

export function isHolidayApplicable(holiday: LeaveHolidayModel, employeeId: string): boolean {
  if (holiday.appliesToAll) return true;
  return (holiday.applicableEmployeeIds ?? []).includes(employeeId);
}

function holidayUnitsForDuration(duration: HolidayDuration): number {
  return duration === 'FULL_DAY' ? 1 : 0.5;
}

/**
 * Applicable holiday rows for one employee. Only published holidays are
 * returned so imported government drafts never reach attendance or leave
 * calculations. Optional and restricted holidays are included because they
 * belong on the employee calendar, but callers that classify attendance or
 * charge leave must exclude them so such a day stays a normal working day.
 */
export async function loadApplicableHolidays(options: {
  organizationId: string;
  employeeId: string;
  from: string;
  to: string;
  transaction?: Transaction;
}): Promise<LeaveHolidayModel[]> {
  const rows = await LeaveHoliday.findAll({
    where: {
      organizationId: options.organizationId,
      published: true,
      holidayDate: { [Op.between]: [options.from, options.to] },
    },
    order: [
      ['holidayDate', 'ASC'],
      ['name', 'ASC'],
    ],
    transaction: options.transaction,
  });
  return rows.filter((holiday) => isHolidayApplicable(holiday, options.employeeId));
}

/**
 * Number of holiday units (0, 0.5, or 1) that apply to the employee on each
 * date. Multiple holidays on the same date are combined and capped at one full
 * day. Optional and restricted holidays are intentionally excluded.
 */
export async function holidayUnitsForEmployee(options: {
  organizationId: string;
  employeeId: string;
  from: string;
  to: string;
  transaction?: Transaction;
}): Promise<Map<string, number>> {
  const rows = await loadApplicableHolidays(options);
  const units = new Map<string, number>();
  for (const holiday of rows) {
    if (holiday.category === 'OPTIONAL' || holiday.category === 'RESTRICTED') continue;
    const current = units.get(holiday.holidayDate) ?? 0;
    units.set(
      holiday.holidayDate,
      Math.min(1, Math.round((current + holidayUnitsForDuration(holiday.duration)) * 100) / 100),
    );
  }
  return units;
}

/** Full-day holiday dates for an employee, used by legacy leave callers. */
export async function holidayDatesForEmployee(options: {
  organizationId: string;
  employeeId: string;
  from: string;
  to: string;
  transaction?: Transaction;
}): Promise<Set<string>> {
  const units = await holidayUnitsForEmployee(options);
  return new Set([...units.entries()].filter(([, value]) => value >= 1).map(([date]) => date));
}

export async function organizationWorkingDays(organizationId: string): Promise<number[]> {
  const settings = await OrganizationHolidaySettings.findOne({ where: { organizationId } });
  const days = settings?.workingDays ?? [...DEFAULT_WORKING_DAYS];
  return days.length > 0 ? days : [...DEFAULT_WORKING_DAYS];
}

function holidayRange(query: HolidayListQuery, timezone: string): { from: string; to: string; year: number } {
  if (query.from || query.to) {
    const from = query.from ?? query.to!;
    const to = query.to ?? query.from!;
    return { from, to, year: Number(from.slice(0, 4)) };
  }
  const year = query.year ?? Number(todayInTimezone(timezone).slice(0, 4));
  return { from: `${year}-01-01`, to: `${year}-12-31`, year };
}

export async function listHolidays(options: {
  organization: OrganizationModel;
  query: HolidayListQuery;
  audience: HolidayAudience;
}) {
  const { organization, query, audience } = options;
  const settings = await ensureHolidaySettings(organization.id);
  const { from, to, year } = holidayRange(query, organization.timezone);

  const where: Record<string, unknown> = {
    organizationId: organization.id,
    holidayDate: { [Op.between]: [from, to] },
  };
  if (query.category) {
    where.category = query.category;
  } else if (query.includeOptional === false) {
    where.category = { [Op.notIn]: ['OPTIONAL', 'RESTRICTED'] };
  }
  if (query.duration) where.duration = query.duration;
  if (audience.restrictToEmployee || query.mine === true) {
    where.published = true;
  }

  const rows = await LeaveHoliday.findAll({
    where,
    include: HOLIDAY_INCLUDES,
    order: [
      ['holidayDate', 'ASC'],
      ['name', 'ASC'],
    ],
  });

  const holidays = audience.restrictToEmployee || query.mine === true
    ? rows.filter((holiday) => isHolidayApplicable(holiday, audience.employeeId))
    : rows;

  return {
    holidays: holidays.map(toHolidaySummary),
    settings: toHolidaySettingsSummary(settings),
    year,
    from,
    to,
    total: holidays.length,
  };
}

export async function getHoliday(options: {
  organization: OrganizationModel;
  holidayId: string;
  audience: HolidayAudience;
}) {
  const holiday = await LeaveHoliday.findOne({
    where: { id: options.holidayId, organizationId: options.organization.id },
    include: HOLIDAY_INCLUDES,
  });
  if (!holiday) {
    throw AppError.notFound('Holiday not found', 'HOLIDAY_NOT_FOUND');
  }
  if (
    options.audience.restrictToEmployee &&
    (!holiday.published || !isHolidayApplicable(holiday, options.audience.employeeId))
  ) {
    // Do not reveal that a non-applicable or unpublished holiday exists.
    throw AppError.notFound('Holiday not found', 'HOLIDAY_NOT_FOUND');
  }
  return toHolidaySummary(holiday);
}

function assertGroupApplicabilitySupported(input: {
  departmentIds?: string[];
  locationIds?: string[];
}): void {
  if ((input.departmentIds?.length ?? 0) > 0) {
    throw AppError.unprocessable(
      'Department-specific holidays are not supported yet because the organization has no department model',
      'HOLIDAY_DEPARTMENT_APPLICABILITY_UNSUPPORTED',
    );
  }
  if ((input.locationIds?.length ?? 0) > 0) {
    throw AppError.unprocessable(
      'Location-specific holidays are not supported yet because the organization has no location model',
      'HOLIDAY_LOCATION_APPLICABILITY_UNSUPPORTED',
    );
  }
}

async function assertEmployeesBelongToOrganization(
  organizationId: string,
  employeeIds: string[],
  transaction: Transaction,
): Promise<void> {
  const unique = [...new Set(employeeIds)];
  if (unique.length === 0) return;
  const count = await Membership.count({
    where: {
      organizationId,
      userId: { [Op.in]: unique },
      status: 'ACTIVE',
    },
    transaction,
  });
  if (count !== unique.length) {
    throw AppError.unprocessable(
      'Every selected employee must be an active member of this organization',
      'HOLIDAY_EMPLOYEE_NOT_FOUND',
    );
  }
}

async function assertNoDuplicateHoliday(options: {
  organizationId: string;
  holidayDate: string;
  name: string;
  excludeId?: string;
  transaction?: Transaction;
}): Promise<void> {
  const rows = await LeaveHoliday.findAll({
    where: {
      organizationId: options.organizationId,
      holidayDate: options.holidayDate,
      ...(options.excludeId ? { id: { [Op.ne]: options.excludeId } } : {}),
    },
    transaction: options.transaction,
  });
  const normalized = options.name.trim().toLowerCase();
  if (rows.some((row) => row.name.trim().toLowerCase() === normalized)) {
    throw AppError.conflict(
      'A holiday with this name already exists on the selected date',
      'HOLIDAY_DUPLICATE',
    );
  }
}

function assertHistoricalChangeAllowed(options: {
  organization: OrganizationModel;
  holidayDate: string;
  confirmHistorical: boolean;
}): void {
  const today = todayInTimezone(options.organization.timezone);
  if (options.holidayDate < today && !options.confirmHistorical) {
    throw AppError.conflict(
      'This holiday is in the past. Confirm the historical change to protect attendance history.',
      'HOLIDAY_HISTORICAL_LOCKED',
    );
  }
}

function assertManagementEnabled(settings: HolidaySettingsModel): void {
  if (!settings.enabled) {
    throw AppError.conflict(
      'Holiday management is disabled for this organization',
      'HOLIDAY_MANAGEMENT_DISABLED',
    );
  }
}

function assertHalfDayAllowed(settings: HolidaySettingsModel, duration: HolidayDuration): void {
  if (duration !== 'FULL_DAY' && !settings.allowHalfDayHolidays) {
    throw AppError.unprocessable(
      'Half-day holidays are disabled in the organization holiday settings',
      'HOLIDAY_HALF_DAY_DISABLED',
    );
  }
}

function assertCategoryAllowed(settings: HolidaySettingsModel, category: HolidayCategory): void {
  if (
    (category === 'OPTIONAL' || category === 'RESTRICTED') &&
    !settings.optionalHolidaysEnabled
  ) {
    throw AppError.unprocessable(
      'Optional and restricted holidays are disabled in the organization holiday settings',
      'HOLIDAY_OPTIONAL_DISABLED',
    );
  }
}

function holidaySnapshot(holiday: LeaveHolidayModel) {
  return {
    holidayDate: holiday.holidayDate,
    name: holiday.name,
    category: holiday.category,
    duration: holiday.duration,
    description: holiday.description,
    appliesToAll: holiday.appliesToAll,
    applicableEmployeeIds: holiday.applicableEmployeeIds ?? [],
    published: holiday.published,
    source: holiday.source,
    sourceId: holiday.sourceId,
  };
}

export async function createHoliday(options: {
  organization: OrganizationModel;
  actorUserId: string;
  input: CreateHolidayInput;
  context?: AuditContext;
}) {
  const { organization, actorUserId, input, context } = options;
  assertGroupApplicabilitySupported(input);

  const holiday = await sequelize.transaction(async (transaction) => {
    const settings = await ensureHolidaySettings(organization.id, { transaction });
    assertManagementEnabled(settings);
    assertHalfDayAllowed(settings, input.duration);
    assertCategoryAllowed(settings, input.category);
    assertHistoricalChangeAllowed({
      organization,
      holidayDate: input.holidayDate,
      confirmHistorical: input.confirmHistorical,
    });
    await assertEmployeesBelongToOrganization(
      organization.id,
      input.appliesToAll ? [] : input.applicableEmployeeIds,
      transaction,
    );
    await assertNoDuplicateHoliday({
      organizationId: organization.id,
      holidayDate: input.holidayDate,
      name: input.name,
      transaction,
    });

    const created = await LeaveHoliday.create(
      {
        organizationId: organization.id,
        holidayDate: input.holidayDate,
        name: input.name,
        category: input.category,
        duration: input.duration,
        description: input.description ?? null,
        appliesToAll: input.appliesToAll,
        applicableEmployeeIds: input.appliesToAll ? [] : input.applicableEmployeeIds,
        departmentIds: [],
        locationIds: [],
        published: true,
        source: 'MANUAL',
        createdByUserId: actorUserId,
        updatedByUserId: actorUserId,
      },
      { transaction },
    );

    await recordAuditEvent(
      {
        organizationId: organization.id,
        actorUserId,
        action: 'LEAVE_HOLIDAY_CREATED',
        entityType: 'LEAVE_HOLIDAY',
        entityId: created.id,
        metadata: holidaySnapshot(created),
      },
      { transaction, context },
    );
    return created;
  });

  return getHoliday({
    organization,
    holidayId: holiday.id,
    audience: { restrictToEmployee: false, employeeId: actorUserId },
  });
}

export async function updateHoliday(options: {
  organization: OrganizationModel;
  actorUserId: string;
  holidayId: string;
  input: UpdateHolidayInput;
  context?: AuditContext;
}) {
  const { organization, actorUserId, holidayId, input, context } = options;
  assertGroupApplicabilitySupported(input);

  const updated = await sequelize.transaction(async (transaction) => {
    const holiday = await LeaveHoliday.findOne({
      where: { id: holidayId, organizationId: organization.id },
      transaction,
      lock: Transaction.LOCK.UPDATE,
    });
    if (!holiday) {
      throw AppError.notFound('Holiday not found', 'HOLIDAY_NOT_FOUND');
    }

    const settings = await ensureHolidaySettings(organization.id, { transaction });
    assertManagementEnabled(settings);

    const nextDate = input.holidayDate ?? holiday.holidayDate;
    assertHistoricalChangeAllowed({
      organization,
      holidayDate: holiday.holidayDate,
      confirmHistorical: input.confirmHistorical,
    });
    assertHistoricalChangeAllowed({
      organization,
      holidayDate: nextDate,
      confirmHistorical: input.confirmHistorical,
    });

    const nextDuration = input.duration ?? holiday.duration;
    const nextCategory = input.category ?? holiday.category;
    const nextAppliesToAll = input.appliesToAll ?? holiday.appliesToAll;
    const nextEmployeeIds =
      input.applicableEmployeeIds ??
      (nextAppliesToAll ? [] : holiday.applicableEmployeeIds ?? []);
    const nextName = input.name ?? holiday.name;

    if (
      input.category &&
      holiday.source !== 'GOVERNMENT' &&
      (GOVERNMENT_HOLIDAY_CATEGORIES as readonly string[]).includes(input.category)
    ) {
      throw AppError.unprocessable(
        'Government holiday categories can only be set through a government holiday import',
        'HOLIDAY_CATEGORY_MANAGED',
      );
    }

    assertHalfDayAllowed(settings, nextDuration);
    assertCategoryAllowed(settings, nextCategory);

    if (!nextAppliesToAll && nextEmployeeIds.length === 0) {
      throw AppError.unprocessable(
        'Select at least one employee when the holiday is not organization-wide',
        'HOLIDAY_APPLICABILITY_REQUIRED',
      );
    }
    if (nextAppliesToAll && nextEmployeeIds.length > 0) {
      throw AppError.unprocessable(
        'Clear employee selections when the holiday applies to everyone',
        'HOLIDAY_APPLICABILITY_INVALID',
      );
    }

    await assertEmployeesBelongToOrganization(
      organization.id,
      nextAppliesToAll ? [] : nextEmployeeIds,
      transaction,
    );
    await assertNoDuplicateHoliday({
      organizationId: organization.id,
      holidayDate: nextDate,
      name: nextName,
      excludeId: holiday.id,
      transaction,
    });

    const before = holidaySnapshot(holiday);
    holiday.holidayDate = nextDate;
    holiday.name = nextName;
    holiday.category = nextCategory;
    holiday.duration = nextDuration;
    if (input.description !== undefined) {
      holiday.description = input.description;
    }
    holiday.appliesToAll = nextAppliesToAll;
    holiday.applicableEmployeeIds = nextAppliesToAll ? [] : nextEmployeeIds;
    holiday.departmentIds = [];
    holiday.locationIds = [];
    holiday.updatedByUserId = actorUserId;
    await holiday.save({ transaction });

    await recordAuditEvent(
      {
        organizationId: organization.id,
        actorUserId,
        action: 'LEAVE_HOLIDAY_UPDATED',
        entityType: 'LEAVE_HOLIDAY',
        entityId: holiday.id,
        metadata: { before, after: holidaySnapshot(holiday), changes: input },
      },
      { transaction, context },
    );
    return holiday;
  });

  return getHoliday({
    organization,
    holidayId: updated.id,
    audience: { restrictToEmployee: false, employeeId: actorUserId },
  });
}

export async function deleteHoliday(options: {
  organization: OrganizationModel;
  actorUserId: string;
  holidayId: string;
  query: DeleteHolidayQuery;
  context?: AuditContext;
}) {
  const { organization, actorUserId, holidayId, query, context } = options;
  await sequelize.transaction(async (transaction) => {
    const holiday = await LeaveHoliday.findOne({
      where: { id: holidayId, organizationId: organization.id },
      transaction,
      lock: Transaction.LOCK.UPDATE,
    });
    if (!holiday) {
      throw AppError.notFound('Holiday not found', 'HOLIDAY_NOT_FOUND');
    }

    const settings = await ensureHolidaySettings(organization.id, { transaction });
    assertManagementEnabled(settings);
    assertHistoricalChangeAllowed({
      organization,
      holidayDate: holiday.holidayDate,
      confirmHistorical: query.confirmHistorical === true,
    });

    const snapshot = holidaySnapshot(holiday);
    await holiday.destroy({ transaction });

    await recordAuditEvent(
      {
        organizationId: organization.id,
        actorUserId,
        action: 'LEAVE_HOLIDAY_DELETED',
        entityType: 'LEAVE_HOLIDAY',
        entityId: holidayId,
        metadata: snapshot,
      },
      { transaction, context },
    );
  });
}

export async function duplicateHoliday(options: {
  organization: OrganizationModel;
  actorUserId: string;
  holidayId: string;
  input: DuplicateHolidayInput;
  context?: AuditContext;
}) {
  const { organization, actorUserId, holidayId, input, context } = options;
  const duplicate = await sequelize.transaction(async (transaction) => {
    const source = await LeaveHoliday.findOne({
      where: { id: holidayId, organizationId: organization.id },
      transaction,
    });
    if (!source) {
      throw AppError.notFound('Holiday not found', 'HOLIDAY_NOT_FOUND');
    }
    if (source.source === 'GOVERNMENT') {
      throw AppError.conflict(
        'Government-imported holidays cannot be duplicated. Import the same source year again or add a company holiday manually.',
        'HOLIDAY_GOVERNMENT_DUPLICATE_UNSUPPORTED',
      );
    }

    const settings = await ensureHolidaySettings(organization.id, { transaction });
    assertManagementEnabled(settings);
    assertHalfDayAllowed(settings, source.duration);
    assertCategoryAllowed(settings, source.category);
    assertHistoricalChangeAllowed({
      organization,
      holidayDate: input.holidayDate,
      confirmHistorical: input.confirmHistorical,
    });

    const name = input.name ?? source.name;
    await assertEmployeesBelongToOrganization(
      organization.id,
      source.appliesToAll ? [] : source.applicableEmployeeIds ?? [],
      transaction,
    );
    await assertNoDuplicateHoliday({
      organizationId: organization.id,
      holidayDate: input.holidayDate,
      name,
      transaction,
    });

    const created = await LeaveHoliday.create(
      {
        organizationId: organization.id,
        holidayDate: input.holidayDate,
        name,
        category: source.category,
        duration: source.duration,
        description: source.description,
        appliesToAll: source.appliesToAll,
        applicableEmployeeIds: source.appliesToAll ? [] : source.applicableEmployeeIds ?? [],
        departmentIds: [],
        locationIds: [],
        createdByUserId: actorUserId,
        updatedByUserId: actorUserId,
      },
      { transaction },
    );

    await recordAuditEvent(
      {
        organizationId: organization.id,
        actorUserId,
        action: 'LEAVE_HOLIDAY_DUPLICATED',
        entityType: 'LEAVE_HOLIDAY',
        entityId: created.id,
        metadata: { sourceHolidayId: source.id, ...holidaySnapshot(created) },
      },
      { transaction, context },
    );
    return created;
  });

  return getHoliday({
    organization,
    holidayId: duplicate.id,
    audience: { restrictToEmployee: false, employeeId: actorUserId },
  });
}

export async function getHolidaySettings(organization: OrganizationModel) {
  const settings = await ensureHolidaySettings(organization.id);
  return toHolidaySettingsSummary(settings);
}

/** Active members available for employee-specific holiday applicability. */
export async function listHolidayEmployees(organization: OrganizationModel) {
  const memberships = await Membership.findAll({
    where: { organizationId: organization.id, status: 'ACTIVE' },
    include: [
      {
        model: User,
        as: 'user',
        required: true,
        attributes: ['id', 'name', 'email'],
      },
    ],
    order: [
      ['createdAt', 'ASC'],
      ['id', 'ASC'],
    ],
  });
  return memberships
    .filter((membership) => membership.user)
    .map((membership) => ({
      id: membership.userId,
      name: membership.user!.name,
      email: membership.user!.email,
      role: membership.role,
    }));
}

export async function updateHolidaySettings(options: {
  organization: OrganizationModel;
  actorUserId: string;
  input: HolidaySettingsInput;
  context?: AuditContext;
}) {
  const { organization, actorUserId, input, context } = options;
  const settings = await sequelize.transaction(async (transaction) => {
    const current = await ensureHolidaySettings(organization.id, { transaction });
    const before = toHolidaySettingsSummary(current);

    if (input.enabled !== undefined) current.enabled = input.enabled;
    if (input.optionalHolidaysEnabled !== undefined) {
      current.optionalHolidaysEnabled = input.optionalHolidaysEnabled;
    }
    if (input.allowHalfDayHolidays !== undefined) {
      current.allowHalfDayHolidays = input.allowHalfDayHolidays;
    }
    if (input.defaultCalendarYear !== undefined) {
      current.defaultCalendarYear = input.defaultCalendarYear;
    }
    if (input.defaultApplicability !== undefined) {
      current.defaultApplicability = input.defaultApplicability;
    }
    if (input.workingDays !== undefined) {
      current.workingDays = [...new Set(input.workingDays)].sort((a, b) => a - b);
    }
    if (input.governmentCountry !== undefined) {
      current.governmentCountry = input.governmentCountry;
    }
    if (input.governmentRegion !== undefined) {
      current.governmentRegion = input.governmentRegion;
    }
    if (input.governmentYear !== undefined) {
      current.governmentYear = input.governmentYear;
    }
    current.updatedByUserId = actorUserId;
    await current.save({ transaction });

    await recordAuditEvent(
      {
        organizationId: organization.id,
        actorUserId,
        action: 'LEAVE_HOLIDAY_SETTINGS_UPDATED',
        entityType: 'ORGANIZATION_HOLIDAY_SETTINGS',
        entityId: current.id,
        metadata: { before, after: toHolidaySettingsSummary(current), changes: input },
      },
      { transaction, context },
    );
    return current;
  });

  return toHolidaySettingsSummary(settings);
}

function normalizeHolidayName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Jurisdictions and years for which the catalog contains a verified government
 * notification. The web client uses this to avoid offering imports that would
 * have to invent dates.
 */
export function listGovernmentJurisdictions() {
  return {
    countries: GOVERNMENT_COUNTRIES.map((country) => ({
      code: country.code,
      name: country.name,
      regions: governmentRegionsForCountry(country.code),
    })),
  };
}

function governmentRegionsForCountry(countryCode: string) {
  return GOVERNMENT_JURISDICTIONS.filter(
    (jurisdiction) => jurisdiction.country === countryCode,
  ).map((jurisdiction) => ({
    code: jurisdiction.region,
    name: jurisdiction.regionName,
    years: jurisdiction.years
      .map((year) => ({
        year: year.year,
        holidayCount: year.entries.length,
        source: year.source,
      }))
      .sort((left, right) => left.year - right.year),
  }));
}

type PreviewStatus = 'AVAILABLE' | 'IMPORTED' | 'DUPLICATE_NAME';

export async function previewGovernmentHolidays(options: {
  organization: OrganizationModel;
  query: GovernmentHolidayPreviewQuery;
}) {
  const { organization, query } = options;
  const jurisdiction = findGovernmentJurisdiction(query.country, query.region);
  if (!jurisdiction) {
    throw AppError.unprocessable(
      'This country and region are not part of the verified government holiday catalog',
      'HOLIDAY_JURISDICTION_UNSUPPORTED',
    );
  }

  const yearEntry = findGovernmentYear(query.country, query.region, query.year);
  const availableYears = availableGovernmentYears(query.country, query.region);
  const base = {
    country: jurisdiction.country,
    countryName: jurisdiction.countryName,
    region: jurisdiction.region,
    regionName: jurisdiction.regionName,
    year: query.year,
    availableYears,
  };

  if (!yearEntry) {
    return {
      ...base,
      available: false,
      source: null,
      entries: [] as Array<GovernmentHolidayEntry & { status: PreviewStatus }>,
      counts: { total: 0, available: 0, imported: 0, duplicates: 0 },
      message:
        availableYears.length > 0
          ? `No verified ${jurisdiction.regionName} notification for ${query.year} is in the catalog. Verified years: ${availableYears.join(', ')}.`
          : `No verified ${jurisdiction.regionName} holiday data is in the catalog yet.`,
    };
  }

  const dates = [...new Set(yearEntry.entries.map((entry) => entry.holidayDate))];
  const sourceIds = yearEntry.entries.map((entry) => entry.sourceId);
  const existing = await LeaveHoliday.findAll({
    where: {
      organizationId: organization.id,
      [Op.or]: [
        { sourceId: { [Op.in]: sourceIds } },
        { holidayDate: { [Op.in]: dates } },
      ],
    },
  });
  const bySourceId = new Map(existing.map((row) => [row.sourceId, row]));
  const byDateAndName = new Map(
    existing.map((row) => [`${row.holidayDate}|${normalizeHolidayName(row.name)}`, row]),
  );

  const entries = yearEntry.entries.map((entry) => {
    const imported = bySourceId.get(entry.sourceId);
    if (imported) {
      return {
        ...entry,
        status: 'IMPORTED' as const,
        existingHolidayId: imported.id,
        existingCategory: imported.category,
      };
    }
    const duplicate = byDateAndName.get(
      `${entry.holidayDate}|${normalizeHolidayName(entry.name)}`,
    );
    if (duplicate) {
      return {
        ...entry,
        status: 'DUPLICATE_NAME' as const,
        existingHolidayId: duplicate.id,
        existingCategory: duplicate.category,
      };
    }
    return { ...entry, status: 'AVAILABLE' as const };
  });

  const counts = {
    total: entries.length,
    available: entries.filter((entry) => entry.status === 'AVAILABLE').length,
    imported: entries.filter((entry) => entry.status === 'IMPORTED').length,
    duplicates: entries.filter((entry) => entry.status === 'DUPLICATE_NAME').length,
  };

  return {
    ...base,
    available: true,
    source: yearEntry.source,
    entries,
    counts,
    message: null,
  };
}

export async function importGovernmentHolidays(options: {
  organization: OrganizationModel;
  actorUserId: string;
  input: GovernmentHolidayImportInput;
  context?: AuditContext;
}) {
  const { organization, actorUserId, input, context } = options;
  const jurisdiction = findGovernmentJurisdiction(input.country, input.region);
  if (!jurisdiction) {
    throw AppError.unprocessable(
      'This country and region are not part of the verified government holiday catalog',
      'HOLIDAY_JURISDICTION_UNSUPPORTED',
    );
  }
  const yearEntry = findGovernmentYear(input.country, input.region, input.year);
  if (!yearEntry) {
    throw AppError.unprocessable(
      `No verified ${jurisdiction.regionName} government notification for ${input.year} is available, so no holidays were imported.`,
      'HOLIDAY_SOURCE_UNAVAILABLE',
    );
  }

  const requestedIds = [...new Set(input.sourceIds)];
  const entriesById = new Map(yearEntry.entries.map((entry) => [entry.sourceId, entry]));
  const selected = requestedIds.map((sourceId) => entriesById.get(sourceId));
  if (selected.some((entry) => !entry)) {
    throw AppError.unprocessable(
      'One or more selected holidays are not part of the verified catalog for this jurisdiction and year',
      'HOLIDAY_SOURCE_ENTRY_UNKNOWN',
    );
  }
  const chosen = selected as GovernmentHolidayEntry[];

  const result = await sequelize.transaction(async (transaction) => {
    const settings = await ensureHolidaySettings(organization.id, { transaction });
    assertManagementEnabled(settings);
    if (chosen.some((entry) => entry.category === 'RESTRICTED')) {
      assertCategoryAllowed(settings, 'RESTRICTED');
    }

    const dates = [...new Set(chosen.map((entry) => entry.holidayDate))];
    const existing = await LeaveHoliday.findAll({
      where: {
        organizationId: organization.id,
        [Op.or]: [
          { sourceId: { [Op.in]: requestedIds } },
          { holidayDate: { [Op.in]: dates } },
        ],
      },
      transaction,
    });
    const bySourceId = new Map(existing.map((row) => [row.sourceId, row]));
    const byDateAndName = new Map(
      existing.map((row) => [`${row.holidayDate}|${normalizeHolidayName(row.name)}`, row]),
    );

    const imported: LeaveHolidayModel[] = [];
    const skipped: Array<{
      sourceId: string;
      name: string;
      reason: 'ALREADY_IMPORTED' | 'DUPLICATE_NAME';
    }> = [];
    const importedAt = new Date();

    for (const entry of chosen) {
      if (bySourceId.has(entry.sourceId)) {
        skipped.push({ sourceId: entry.sourceId, name: entry.name, reason: 'ALREADY_IMPORTED' });
        continue;
      }
      const key = `${entry.holidayDate}|${normalizeHolidayName(entry.name)}`;
      if (byDateAndName.has(key)) {
        skipped.push({ sourceId: entry.sourceId, name: entry.name, reason: 'DUPLICATE_NAME' });
        continue;
      }

      const created = await LeaveHoliday.create(
        {
          organizationId: organization.id,
          holidayDate: entry.holidayDate,
          name: entry.name,
          category: entry.category,
          duration: 'FULL_DAY',
          description: entry.notes ?? null,
          appliesToAll: true,
          applicableEmployeeIds: [],
          departmentIds: [],
          locationIds: [],
          published: false,
          source: 'GOVERNMENT',
          sourceId: entry.sourceId,
          sourceYear: yearEntry.year,
          sourceName: yearEntry.source.name,
          sourceUrl: yearEntry.source.url,
          sourceReference: yearEntry.source.reference,
          jurisdictionCountry: input.country,
          jurisdictionRegion: input.region,
          importedAt,
          createdByUserId: actorUserId,
          updatedByUserId: actorUserId,
        },
        { transaction },
      );
      imported.push(created);
      bySourceId.set(entry.sourceId, created);
      byDateAndName.set(key, created);
    }

    await recordAuditEvent(
      {
        organizationId: organization.id,
        actorUserId,
        action: 'LEAVE_HOLIDAYS_IMPORTED',
        entityType: 'ORGANIZATION_HOLIDAY_CALENDAR',
        entityId: organization.id,
        metadata: {
          country: input.country,
          region: input.region,
          year: input.year,
          sourceReference: yearEntry.source.reference,
          importedHolidayIds: imported.map((holiday) => holiday.id),
          skipped,
        },
      },
      { transaction, context },
    );

    return { imported, skipped };
  });

  return {
    country: jurisdiction.country,
    region: jurisdiction.region,
    year: yearEntry.year,
    source: yearEntry.source,
    imported: result.imported.map(toHolidaySummary),
    skipped: result.skipped,
    published: false,
  };
}

export async function updateHolidayPublication(options: {
  organization: OrganizationModel;
  actorUserId: string;
  input: HolidayPublicationInput;
  context?: AuditContext;
}) {
  const { organization, actorUserId, input, context } = options;
  const uniqueIds = [...new Set(input.holidayIds)];
  const today = todayInTimezone(organization.timezone);

  const result = await sequelize.transaction(async (transaction) => {
    const rows = await LeaveHoliday.findAll({
      where: { id: { [Op.in]: uniqueIds }, organizationId: organization.id },
      transaction,
      lock: Transaction.LOCK.UPDATE,
    });
    if (rows.length !== uniqueIds.length) {
      throw AppError.notFound('Holiday not found', 'HOLIDAY_NOT_FOUND');
    }

    const historical = rows.filter((row) => row.holidayDate < today);
    if (historical.length > 0 && !input.confirmHistorical) {
      throw AppError.conflict(
        `${historical.length} selected holiday${historical.length === 1 ? ' is' : 's are'} in the past. Confirm the historical change so attendance and leave history are not altered silently.`,
        'HOLIDAY_HISTORICAL_LOCKED',
      );
    }

    let changed = 0;
    for (const row of rows) {
      if (row.published === input.published) continue;
      row.published = input.published;
      row.updatedByUserId = actorUserId;
      await row.save({ transaction });
      changed += 1;
    }

    await recordAuditEvent(
      {
        organizationId: organization.id,
        actorUserId,
        action: 'LEAVE_HOLIDAYS_PUBLICATION_UPDATED',
        entityType: 'ORGANIZATION_HOLIDAY_CALENDAR',
        entityId: organization.id,
        metadata: {
          published: input.published,
          holidayIds: uniqueIds,
          changed,
          historicalConfirmed: historical.length > 0,
        },
      },
      { transaction, context },
    );

    return { rows, changed };
  });

  return {
    published: input.published,
    changed: result.changed,
    holidays: result.rows.map(toHolidaySummary),
  };
}
