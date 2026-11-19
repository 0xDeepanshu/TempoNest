import { IntegrationEmployeeMapping, User } from '../../database';
import { AppError } from '../../utils/errors';
import type { Organization as OrganizationModel } from '../organizations/organization.model';
import { listHolidays } from '../leave/holiday.service';
import { toIntegrationEmployeeView } from './integration.employee.service';
import type { IntegrationConnection as IntegrationConnectionModel } from './integrationConnection.model';
import type { IntegrationEmployeeMapping as MappingModel } from './integrationEmployeeMapping.model';
import type { IntegrationHolidayListQuery } from './integration.schemas';

/**
 * Resolves exactly one explicitly mapped, active employee for this connection. Deliberately
 * duplicated rather than shared with integration.attendance.service.ts / integration.leave.service.ts
 * so neither attendance nor leave is ever touched by a holiday-only change. Never falls back to any
 * other employee of the organisation.
 */
async function loadSingleMappedEmployee(options: {
  connection: IntegrationConnectionModel;
  externalEmployeeId: string;
}): Promise<{ mapping: MappingModel; userId: string }> {
  const { connection, externalEmployeeId } = options;

  const mapping = await IntegrationEmployeeMapping.findOne({
    where: {
      connectionId: connection.id,
      organizationId: connection.organizationId,
      externalEmployeeId,
      status: 'ACTIVE',
    },
    include: [
      { model: User, as: 'workzenUser', required: true, attributes: ['id', 'name', 'email'] },
    ],
  });

  if (!mapping || !mapping.workzenUserId) {
    throw AppError.notFound('This employee is not mapped to the integration', 'EMPLOYEE_NOT_MAPPED');
  }

  return { mapping, userId: mapping.workzenUserId };
}

/**
 * One mapped employee's own applicable holiday calendar. Reuses listHolidays unchanged with
 * restrictToEmployee: true — the exact same self-scoping rule WorkZen's own employee-facing calendar
 * uses, which already filters to published holidays that are either organisation-wide or explicitly
 * list this employee. Never reads unpublished drafts and never a cross-employee listing.
 */
export async function getIntegrationHolidays(options: {
  connection: IntegrationConnectionModel;
  organization: OrganizationModel;
  query: IntegrationHolidayListQuery;
}) {
  const { connection, organization, query } = options;
  const { mapping, userId } = await loadSingleMappedEmployee({
    connection,
    externalEmployeeId: query.externalEmployeeId,
  });

  const result = await listHolidays({
    organization,
    query: { from: query.from, to: query.to },
    audience: { restrictToEmployee: true, employeeId: userId },
  });

  return {
    externalEmployeeId: mapping.externalEmployeeId,
    employee: mapping.workzenUser ? toIntegrationEmployeeView(mapping.workzenUser) : { id: userId },
    timezone: organization.timezone,
    from: result.from,
    to: result.to,
    holidays: result.holidays.map((holiday) => ({
      id: holiday.id,
      holidayDate: holiday.holidayDate,
      name: holiday.name,
      category: holiday.category,
      duration: holiday.duration,
      description: holiday.description,
    })),
  };
}
