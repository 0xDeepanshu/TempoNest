import { IntegrationEmployeeMapping, User } from '../../database';
import { AppError } from '../../utils/errors';
import type { Organization as OrganizationModel } from '../organizations/organization.model';
import { listAttendanceCorrections } from '../attendance/attendanceCorrection.service';
import type { PermissionSubject } from '../memberships/permissions';
import { toIntegrationEmployeeView } from './integration.employee.service';
import type { IntegrationConnection as IntegrationConnectionModel } from './integrationConnection.model';
import type { IntegrationEmployeeMapping as MappingModel } from './integrationEmployeeMapping.model';
import type { IntegrationCorrectionListQuery } from './integration.schemas';

/**
 * A subject with no review permissions. Passed to the real correction-listing logic so it applies its
 * own "self only" branch (teamScope = hasPermission(..., 'correction:review') && !isSelfScoped(...))
 * rather than this module re-implementing that scoping rule. hasPermission on an object subject reads
 * only `.permissions`, never `.role`, so this stays self-scoped even if the mapped WorkZen user is
 * actually an Owner with real correction:review rights in WorkZen itself.
 */
const SELF_SCOPED_SUBJECT: PermissionSubject = {
  role: 'EMPLOYEE',
  permissions: [],
  dataScope: 'SELF',
  customRoleId: null,
};

/**
 * Resolves exactly one explicitly mapped, active employee for this connection. Deliberately
 * duplicated rather than shared with the attendance/leave/holiday integration services, so none of
 * those is ever touched by a corrections-only change. Never falls back to any other employee.
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

/** A curated, deliberately narrow view: no evidence, no reviewer identity, no session internals. */
function toIntegrationCorrectionView(correction: Awaited<ReturnType<typeof listAttendanceCorrections>>['data'][number]) {
  return {
    id: correction.id,
    requestType: correction.requestType,
    workDate: correction.workDate,
    requestedStartedAt: correction.requestedStartedAt,
    requestedEndedAt: correction.requestedEndedAt,
    requestedBreaks: correction.requestedBreaks,
    reason: correction.reason,
    status: correction.status,
    reviewedAt: correction.reviewedAt,
    reviewerNote: correction.reviewerNote,
    rejectionReason: correction.rejectionReason,
    createdAt: correction.createdAt,
  };
}

/**
 * One mapped employee's own attendance correction history. Reuses listAttendanceCorrections
 * unchanged with a non-reviewing subject, so it is impossible for this endpoint to return anyone
 * else's requests, evidence files, or reviewer identity, regardless of the mapped user's real role.
 */
export async function getIntegrationCorrections(options: {
  connection: IntegrationConnectionModel;
  organization: OrganizationModel;
  query: IntegrationCorrectionListQuery;
}) {
  const { connection, organization, query } = options;
  const { mapping, userId } = await loadSingleMappedEmployee({
    connection,
    externalEmployeeId: query.externalEmployeeId,
  });

  const result = await listAttendanceCorrections({
    organization,
    actorUserId: userId,
    actorRole: SELF_SCOPED_SUBJECT,
    query: {
      page: query.page,
      limit: query.limit,
      status: query.status,
      from: query.from,
      to: query.to,
      // employeeId is intentionally omitted: SELF_SCOPED_SUBJECT cannot review, so
      // listAttendanceCorrections ignores any employeeId filter and always scopes to actorUserId.
    },
  });

  return {
    externalEmployeeId: mapping.externalEmployeeId,
    employee: mapping.workzenUser ? toIntegrationEmployeeView(mapping.workzenUser) : { id: userId },
    data: result.data.map(toIntegrationCorrectionView),
    meta: result.meta,
  };
}
