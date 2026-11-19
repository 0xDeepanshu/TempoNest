import { IntegrationEmployeeMapping, User } from '../../database';
import { AppError } from '../../utils/errors';
import type { Organization as OrganizationModel } from '../organizations/organization.model';
import { getEmployeeLeaveBalances } from '../leave/leaveBalance.service';
import { listLeaveRequests } from '../leave/leaveRequest.service';
import type { PermissionSubject } from '../memberships/permissions';
import { toIntegrationEmployeeView } from './integration.employee.service';
import type { IntegrationConnection as IntegrationConnectionModel } from './integrationConnection.model';
import type { IntegrationEmployeeMapping as MappingModel } from './integrationEmployeeMapping.model';
import type {
  IntegrationLeaveBalanceQuery,
  IntegrationLeaveRequestListQuery,
} from './integration.schemas';

/**
 * A subject with no review permissions. Passed to the real leave-request
 * listing logic so it applies its own "self only" branch rather than this
 * module re-implementing that scoping rule.
 */
const SELF_SCOPED_SUBJECT: PermissionSubject = {
  role: 'EMPLOYEE',
  permissions: [],
  dataScope: 'SELF',
  customRoleId: null,
};

/**
 * Resolves exactly one explicitly mapped, active employee for this connection. Mirrors the lookup in
 * integration.attendance.service.ts (kept separate rather than shared, so attendance is never touched
 * by leave changes). Never falls back to any other employee of the organisation.
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
 * One mapped employee's own leave balances. Reuses getEmployeeLeaveBalances unchanged: the same
 * function the WorkZen UI calls for "my balances", so entitlement, accrual and period rules are
 * never duplicated here.
 */
export async function getIntegrationLeaveBalances(options: {
  connection: IntegrationConnectionModel;
  organization: OrganizationModel;
  query: IntegrationLeaveBalanceQuery;
}) {
  const { connection, organization, query } = options;
  const { mapping, userId } = await loadSingleMappedEmployee({
    connection,
    externalEmployeeId: query.externalEmployeeId,
  });

  const result = await getEmployeeLeaveBalances({
    organization,
    employeeId: userId,
    query: { leaveTypeId: query.leaveTypeId, periodStart: undefined },
  });

  return {
    externalEmployeeId: mapping.externalEmployeeId,
    employee: mapping.workzenUser ? toIntegrationEmployeeView(mapping.workzenUser) : { id: userId },
    timezone: result.timezone,
    balances: result.balances,
  };
}

/**
 * One mapped employee's own leave request history. actorRole is a synthetic non-reviewing subject,
 * so listLeaveRequests's own "else { where.employeeId = actorUserId }" branch is what scopes this —
 * the integration can never pass a reviewer subject or another employee's id.
 */
export async function getIntegrationLeaveRequests(options: {
  connection: IntegrationConnectionModel;
  organization: OrganizationModel;
  query: IntegrationLeaveRequestListQuery;
}) {
  const { connection, organization, query } = options;
  const { mapping, userId } = await loadSingleMappedEmployee({
    connection,
    externalEmployeeId: query.externalEmployeeId,
  });

  const result = await listLeaveRequests({
    organization,
    actorUserId: userId,
    actorRole: SELF_SCOPED_SUBJECT,
    query: {
      page: query.page,
      limit: query.limit,
      leaveTypeId: query.leaveTypeId,
      status: query.status,
      from: query.from,
      to: query.to,
      // employeeId is intentionally omitted: SELF_SCOPED_SUBJECT cannot review, so
      // listLeaveRequests ignores any employeeId filter and always scopes to actorUserId.
    },
  });

  return {
    ...result,
    externalEmployeeId: mapping.externalEmployeeId,
  };
}
