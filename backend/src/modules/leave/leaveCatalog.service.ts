import { Op, Transaction } from 'sequelize';
import {
  AuditEvent,
  LeaveBalance,
  LeaveHoliday,
  LeavePolicy,
  LeaveRequest,
  LeaveType,
  User,
  sequelize,
} from '../../database';
import { AppError } from '../../utils/errors';
import { paginate } from '../../utils/pagination';
import { DEFAULT_WORKING_DAYS } from './leavePolicy.model';
import { ACTIVE_LEAVE_REQUEST_STATUSES } from './leaveRequest.model';
import { todayInTimezone, toUnits } from './leaveCalendar';
import { recordAuditEvent, type AuditContext } from '../screenshots/audit.service';
import { LEAVE_AUDIT_ACTIONS } from '../screenshots/auditEvent.model';
import { createHoliday as createHolidayService, deleteHoliday as deleteHolidayService } from './holiday.service';
import {
  toLeaveAuditSummary,
  toLeaveHolidaySummary,
  toLeavePolicySummary,
  toLeaveTypeSummary,
} from './leave.mapper';
import type { Organization as OrganizationModel } from '../organizations/organization.model';
import type {
  CreateLeaveHolidayInput,
  CreateLeaveTypeInput,
  LeaveAuditQuery,
  LeaveHolidayQuery,
  UpdateLeavePolicyInput,
  UpdateLeaveTypeInput,
} from './leave.schemas';
import { parseAuditDateRange } from './leave.schemas';

const typeIncludes = [{ model: LeavePolicy, as: 'policy', required: false }];

async function assertNoActiveRequestsForType(
  organizationId: string,
  leaveTypeId: string,
  transaction: Transaction,
): Promise<void> {
  const count = await LeaveRequest.count({
    where: {
      organizationId,
      leaveTypeId,
      status: { [Op.in]: [...ACTIVE_LEAVE_REQUEST_STATUSES] },
    },
    transaction,
  });
  if (count > 0) {
    throw AppError.conflict(
      'This leave type has pending or approved requests and cannot switch its balance requirement',
      'LEAVE_TYPE_IN_USE',
    );
  }
}

async function assertNameAvailable(
  organizationId: string,
  name: string,
  excludeTypeId?: string,
): Promise<void> {  const existing = await LeaveType.findOne({
    where: {
      organizationId,
      [Op.and]: [sequelize.where(sequelize.fn('lower', sequelize.col('name')), name.toLowerCase())],
      ...(excludeTypeId ? { id: { [Op.ne]: excludeTypeId } } : {}),
    },
    attributes: ['id'],
  });
  if (existing) {
    throw AppError.conflict(
      'A leave type with this name already exists',
      'LEAVE_TYPE_NAME_CONFLICT',
    );
  }
}

export async function listLeaveTypes(options: {
  organization: OrganizationModel;
  includeInactive: boolean;
}) {
  const types = await LeaveType.findAll({
    where: {
      organizationId: options.organization.id,
      ...(options.includeInactive ? {} : { isActive: true }),
    },
    include: typeIncludes,
    order: [['name', 'ASC']],
  });
  return types.map((type) => toLeaveTypeSummary(type));
}

export async function loadLeaveTypeById(organizationId: string, leaveTypeId: string) {
  const type = await LeaveType.findOne({
    where: { id: leaveTypeId, organizationId },
    include: typeIncludes,
  });
  if (!type) {
    throw AppError.notFound('Leave type not found', 'LEAVE_TYPE_NOT_FOUND');
  }
  return type;
}

export async function createLeaveType(options: {
  organization: OrganizationModel;
  actorUserId: string;
  input: CreateLeaveTypeInput;
  context?: AuditContext;
}) {
  const { organization, actorUserId, input, context } = options;
  await assertNameAvailable(organization.id, input.name);

  const typeId = await sequelize.transaction(async (transaction) => {
    const type = await LeaveType.create(
      {
        organizationId: organization.id,
        name: input.name,
        description: input.description ?? null,
        isActive: input.isActive ?? true,
        isPaid: input.isPaid ?? true,
        requiresBalance: input.requiresBalance ?? true,
        allowNegativeBalance: input.allowNegativeBalance ?? false,
        maxConsecutiveDays: input.maxConsecutiveDays ?? null,
        minNoticeDays: input.minNoticeDays ?? 0,
        requiresDocumentation: input.requiresDocumentation ?? false,
        allowApprovedCancellation: input.allowApprovedCancellation ?? true,
        cancellationRequiresApproval: input.cancellationRequiresApproval ?? false,
      },
      { transaction },
    );

    await LeavePolicy.create(
      {
        organizationId: organization.id,
        leaveTypeId: type.id,
        workingDays: [...DEFAULT_WORKING_DAYS],
      },
      { transaction },
    );

    await recordAuditEvent(
      {
        organizationId: organization.id,
        actorUserId,
        action: 'LEAVE_TYPE_CREATED',
        entityType: 'LEAVE_TYPE',
        entityId: type.id,
        metadata: {
          name: type.name,
          requiresBalance: type.requiresBalance,
          isPaid: type.isPaid,
        },
      },
      { transaction, context },
    );

    return type.id;
  });

  return toLeaveTypeSummary(await loadLeaveTypeById(organization.id, typeId));
}

export async function updateLeaveType(options: {
  organization: OrganizationModel;
  actorUserId: string;
  leaveTypeId: string;
  input: UpdateLeaveTypeInput;
  context?: AuditContext;
}) {
  const { organization, actorUserId, leaveTypeId, input, context } = options;

  const type = await sequelize.transaction(async (transaction) => {
    const current = await LeaveType.findOne({
      where: { id: leaveTypeId, organizationId: organization.id },
      transaction,
      lock: Transaction.LOCK.UPDATE,
    });
    if (!current) {
      throw AppError.notFound('Leave type not found', 'LEAVE_TYPE_NOT_FOUND');
    }

    if (input.name !== undefined) {
      await assertNameAvailable(organization.id, input.name, leaveTypeId);
    }
    if (
      input.requiresBalance !== undefined &&
      input.requiresBalance !== current.requiresBalance
    ) {
      await assertNoActiveRequestsForType(organization.id, leaveTypeId, transaction);
    }

    const before = {
      name: current.name,
      isActive: current.isActive,
      isPaid: current.isPaid,
      requiresBalance: current.requiresBalance,
      allowNegativeBalance: current.allowNegativeBalance,
      maxConsecutiveDays: current.maxConsecutiveDays,
      minNoticeDays: current.minNoticeDays,
      requiresDocumentation: current.requiresDocumentation,
      allowApprovedCancellation: current.allowApprovedCancellation,
      cancellationRequiresApproval: current.cancellationRequiresApproval,
    };

    await current.update(
      {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.isPaid !== undefined ? { isPaid: input.isPaid } : {}),
        ...(input.requiresBalance !== undefined ? { requiresBalance: input.requiresBalance } : {}),
        ...(input.allowNegativeBalance !== undefined
          ? { allowNegativeBalance: input.allowNegativeBalance }
          : {}),
        ...(input.maxConsecutiveDays !== undefined
          ? { maxConsecutiveDays: input.maxConsecutiveDays }
          : {}),
        ...(input.minNoticeDays !== undefined ? { minNoticeDays: input.minNoticeDays } : {}),
        ...(input.requiresDocumentation !== undefined
          ? { requiresDocumentation: input.requiresDocumentation }
          : {}),
        ...(input.allowApprovedCancellation !== undefined
          ? { allowApprovedCancellation: input.allowApprovedCancellation }
          : {}),
        ...(input.cancellationRequiresApproval !== undefined
          ? { cancellationRequiresApproval: input.cancellationRequiresApproval }
          : {}),
      },
      { transaction },
    );

    await recordAuditEvent(
      {
        organizationId: organization.id,
        actorUserId,
        action: 'LEAVE_TYPE_UPDATED',
        entityType: 'LEAVE_TYPE',
        entityId: current.id,
        metadata: { before, changes: input },
      },
      { transaction, context },
    );

    return current;
  });

  return toLeaveTypeSummary(await loadLeaveTypeById(organization.id, type.id));
}

export async function listLeavePolicies(organization: OrganizationModel) {
  const policies = await LeavePolicy.findAll({
    where: { organizationId: organization.id },
    include: [
      {
        model: LeaveType,
        as: 'leaveType',
        required: true,
        attributes: ['id', 'name', 'isActive', 'requiresBalance'],
      },
    ],
    order: [['createdAt', 'ASC']],
  });
  return policies.map((policy) => ({
    ...toLeavePolicySummary(policy),
    ...(policy.leaveType
      ? {
          leaveType: {
            id: policy.leaveType.id,
            name: policy.leaveType.name,
            isActive: policy.leaveType.isActive,
            requiresBalance: policy.leaveType.requiresBalance,
          },
        }
      : {}),
  }));
}

export async function updateLeavePolicy(options: {
  organization: OrganizationModel;
  actorUserId: string;
  policyId: string;
  input: UpdateLeavePolicyInput;
  context?: AuditContext;
}) {
  const { organization, actorUserId, policyId, input, context } = options;

  const policy = await sequelize.transaction(async (transaction) => {
    const current = await LeavePolicy.findOne({
      where: { id: policyId, organizationId: organization.id },
      transaction,
      lock: Transaction.LOCK.UPDATE,
    });
    if (!current) {
      throw AppError.notFound('Leave policy not found', 'LEAVE_POLICY_NOT_FOUND');
    }

    const changesPeriod =
      (input.balancePeriodStartMonth !== undefined &&
        input.balancePeriodStartMonth !== current.balancePeriodStartMonth) ||
      (input.balancePeriodStartDay !== undefined &&
        input.balancePeriodStartDay !== current.balancePeriodStartDay);
    if (changesPeriod) {
      const balanceCount = await LeaveBalance.count({
        where: {
          organizationId: organization.id,
          leaveTypeId: current.leaveTypeId,
        },
        transaction,
      });
      if (balanceCount > 0) {
        throw AppError.conflict(
          'The balance period cannot change while balances exist for this leave type. Existing rows would overlap the new period.',
          'LEAVE_POLICY_PERIOD_LOCKED',
        );
      }
    }

    const nextFrequency = input.accrualFrequency ?? current.accrualFrequency;
    const nextAmount =
      input.accrualAmount !== undefined ? input.accrualAmount : toUnits(current.accrualAmount);
    const accrualEnabled = nextFrequency !== 'NONE' && nextAmount > 0;
    let nextEffectiveFrom = input.accrualEffectiveFrom;
    if (
      accrualEnabled &&
      (nextEffectiveFrom === null ||
        (nextEffectiveFrom === undefined && current.accrualEffectiveFrom === null))
    ) {
      // Never let the new scheduler reach back before the policy was enabled.
      nextEffectiveFrom = todayInTimezone(organization.timezone);
    }

    const before = toLeavePolicySummary(current);
    await current.update(
      {
        ...(input.initialEntitlement !== undefined
          ? { initialEntitlement: input.initialEntitlement }
          : {}),
        ...(input.accrualFrequency !== undefined
          ? { accrualFrequency: input.accrualFrequency }
          : {}),
        ...(input.accrualAmount !== undefined ? { accrualAmount: input.accrualAmount } : {}),
        ...(input.accrualDayOfMonth !== undefined
          ? { accrualDayOfMonth: input.accrualDayOfMonth }
          : {}),
        ...(nextEffectiveFrom !== undefined
          ? { accrualEffectiveFrom: nextEffectiveFrom }
          : {}),
        ...(input.prorateAccrual !== undefined
          ? { prorateAccrual: input.prorateAccrual }
          : {}),
        ...(input.balancePeriodStartMonth !== undefined
          ? { balancePeriodStartMonth: input.balancePeriodStartMonth }
          : {}),
        ...(input.balancePeriodStartDay !== undefined
          ? { balancePeriodStartDay: input.balancePeriodStartDay }
          : {}),
        ...(input.carryForwardAllowance !== undefined
          ? { carryForwardAllowance: input.carryForwardAllowance }
          : {}),
        ...(input.maxBalance !== undefined ? { maxBalance: input.maxBalance } : {}),
        ...(input.prorateInitialEntitlement !== undefined
          ? { prorateInitialEntitlement: input.prorateInitialEntitlement }
          : {}),
        ...(input.workingDays !== undefined ? { workingDays: input.workingDays } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
      { transaction },
    );

    await recordAuditEvent(
      {
        organizationId: organization.id,
        actorUserId,
        action: 'LEAVE_POLICY_UPDATED',
        entityType: 'LEAVE_POLICY',
        entityId: current.id,
        metadata: { leaveTypeId: current.leaveTypeId, before, changes: input },
      },
      { transaction, context },
    );

    return current;
  });

  return toLeavePolicySummary(policy);
}

export async function listLeaveHolidays(options: {
  organization: OrganizationModel;
  query: LeaveHolidayQuery;
}) {
  const holidays = await LeaveHoliday.findAll({
    where: {
      organizationId: options.organization.id,
      ...(options.query.from && options.query.to
        ? { holidayDate: { [Op.between]: [options.query.from, options.query.to] } }
        : options.query.from
          ? { holidayDate: { [Op.gte]: options.query.from } }
          : options.query.to
            ? { holidayDate: { [Op.lte]: options.query.to } }
            : {}),
    },
    order: [['holidayDate', 'ASC']],
  });
  return holidays.map((holiday) => toLeaveHolidaySummary(holiday));
}

export async function createLeaveHoliday(options: {
  organization: OrganizationModel;
  actorUserId: string;
  input: CreateLeaveHolidayInput;
  context?: AuditContext;
}) {
  const { organization, actorUserId, input, context } = options;
  // Legacy endpoint kept for compatibility. It now uses the full holiday
  // service so category, duration, applicability, duplicate checks, and audit
  // behave exactly like the calendar API.
  return createHolidayService({
    organization,
    actorUserId,
    input: {
      name: input.name,
      holidayDate: input.holidayDate,
      category: 'COMPANY',
      duration: 'FULL_DAY',
      description: null,
      appliesToAll: true,
      applicableEmployeeIds: [],
      departmentIds: [],
      locationIds: [],
      confirmHistorical: false,
    },
    context,
  });
}

export async function deleteLeaveHoliday(options: {
  organization: OrganizationModel;
  actorUserId: string;
  holidayId: string;
  context?: AuditContext;
}) {
  const { organization, actorUserId, holidayId, context } = options;
  await deleteHolidayService({
    organization,
    actorUserId,
    holidayId,
    query: { confirmHistorical: false },
    context,
  });
}

export async function listLeaveAudit(options: {
  organization: OrganizationModel;
  query: LeaveAuditQuery;
}) {
  const { organization, query } = options;
  const range = parseAuditDateRange(query.from, query.to);
  const where: Record<string | symbol, unknown> = {
    organizationId: organization.id,
    action: query.action ?? { [Op.in]: LEAVE_AUDIT_ACTIONS },
  };
  if (query.entityType) where.entityType = query.entityType;
  if (query.employeeId) where.targetEmployeeId = query.employeeId;
  if (range.start || range.end) {
    where.createdAt = {
      ...(range.start ? { [Op.gte]: range.start } : {}),
      ...(range.end ? { [Op.lte]: range.end } : {}),
    };
  }

  const result = await AuditEvent.findAndCountAll({
    where,
    include: [
      { model: User, as: 'actor', required: false, attributes: ['id', 'name', 'email'] },
      { model: User, as: 'targetEmployee', required: false, attributes: ['id', 'name', 'email'] },
    ],
    order: [
      ['createdAt', 'DESC'],
      ['id', 'ASC'],
    ],
    limit: query.limit,
    offset: (query.page - 1) * query.limit,
    distinct: true,
  });

  return paginate(
    result.rows.map((event) => toLeaveAuditSummary(event)),
    result.count,
    query.page,
    query.limit,
  );
}
