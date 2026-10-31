import { Op, Transaction } from 'sequelize';
import {
  LeaveBalance,
  LeaveRequest,
  LeaveType,
  User,
  sequelize,
} from '../../database';
import { AppError } from '../../utils/errors';
import { paginate } from '../../utils/pagination';
import { serializeByKey } from '../../utils/serialize';
import { hasPermission, type PermissionSubject } from '../memberships/permissions';
import { recordAuditEvent, type AuditContext } from '../screenshots/audit.service';
import { toLeaveRequestSummary } from './leave.mapper';
import {
  balancePeriodFor,
  calendarDays,
  calculateLeaveUnits,
  roundUnits,
  todayInTimezone,
  toUnits,
} from './leaveCalendar';
import {
  appendLedger,
  availableOf,
  ensureActiveEmployee,
  ensureBalanceForDate,
  loadLeaveTypeWithPolicy,
} from './leaveBalance.service';
import { holidayUnitsForEmployee } from './holiday.service';
import type { Organization as OrganizationModel } from '../organizations/organization.model';
import type { LeaveBalance as LeaveBalanceModel } from './leaveBalance.model';
import type { LeaveRequest as LeaveRequestModel } from './leaveRequest.model';
import type {
  ApplyLeaveInput,
  ApproveLeaveRequestInput,
  CancelLeaveRequestInput,
  LeaveRequestListQuery,
  RejectLeaveRequestInput,
} from './leave.schemas';

const requestIncludes = [
  { model: User, as: 'employee', required: false, attributes: ['id', 'name', 'email'] },
  { model: User, as: 'reviewer', required: false, attributes: ['id', 'name', 'email'] },
  { model: User, as: 'cancelledBy', required: false, attributes: ['id', 'name', 'email'] },
  {
    model: LeaveType,
    as: 'leaveType',
    required: true,
    attributes: ['id', 'name', 'isPaid', 'requiresBalance'],
  },
];

function canReview(subject: PermissionSubject): boolean {
  return hasPermission(subject, 'leave:approve') || hasPermission(subject, 'leave:manage');
}

function assertRequestAccess(
  request: LeaveRequestModel,
  actorUserId: string,
  subject: PermissionSubject,
): void {
  if (request.employeeId === actorUserId) return;
  if (canReview(subject)) return;
  throw AppError.notFound('Leave request not found', 'LEAVE_REQUEST_NOT_FOUND');
}

async function loadRequest(
  organizationId: string,
  requestId: string,
  employeeId?: string,
): Promise<LeaveRequestModel> {
  const request = await LeaveRequest.findOne({
    where: {
      id: requestId,
      organizationId,
      ...(employeeId ? { employeeId } : {}),
    },
    include: requestIncludes,
  });
  if (!request) {
    throw AppError.notFound('Leave request not found', 'LEAVE_REQUEST_NOT_FOUND');
  }
  return request;
}

async function assertNoOverlap(options: {
  transaction: Transaction;
  organizationId: string;
  employeeId: string;
  startDate: string;
  endDate: string;
}): Promise<void> {
  const overlap = await LeaveRequest.findOne({
    where: {
      organizationId: options.organizationId,
      employeeId: options.employeeId,
      status: { [Op.in]: ['PENDING', 'APPROVED', 'CANCELLATION_REQUESTED'] },
      startDate: { [Op.lte]: options.endDate },
      endDate: { [Op.gte]: options.startDate },
    },
    attributes: ['id'],
    transaction: options.transaction,
    lock: Transaction.LOCK.UPDATE,
  });
  if (overlap) {
    throw AppError.conflict(
      'Another pending or approved leave request overlaps these dates',
      'LEAVE_REQUEST_OVERLAP',
    );
  }
}

async function loadLockedBalance(
  transaction: Transaction,
  organizationId: string,
  request: LeaveRequestModel,
): Promise<LeaveBalanceModel | null> {
  if (request.balancePeriodStart === null) return null;
  const balance = await LeaveBalance.findOne({
    where: {
      organizationId,
      employeeId: request.employeeId,
      leaveTypeId: request.leaveTypeId,
      periodStart: request.balancePeriodStart,
    },
    transaction,
    lock: Transaction.LOCK.UPDATE,
  });
  if (!balance) {
    throw AppError.conflict(
      'The leave balance for this request is unavailable',
      'LEAVE_BALANCE_NOT_FOUND',
    );
  }
  return balance;
}

async function releaseReservation(
  balance: LeaveBalanceModel,
  request: LeaveRequestModel,
  transaction: Transaction,
): Promise<void> {
  const units = toUnits(request.units);
  if (toUnits(balance.pendingReserved) + 0.001 < units) {
    throw AppError.conflict(
      'The reservation for this request no longer matches the balance',
      'LEAVE_BALANCE_INCONSISTENT',
    );
  }
  balance.pendingReserved = roundUnits(toUnits(balance.pendingReserved) - units);
  balance.availableBalance = availableOf(balance);
  await balance.save({ transaction });
  await appendLedger(
    balance,
    {
      kind: 'RESERVATION_RELEASE',
      deltas: { reservedDelta: -units, availableDelta: units },
      leaveRequestId: request.id,
      reason: 'Leave request no longer reserves balance',
      metadata: { status: request.status, units },
    },
    transaction,
  );
}

async function restoreConsumption(
  balance: LeaveBalanceModel,
  request: LeaveRequestModel,
  actorUserId: string,
  transaction: Transaction,
): Promise<void> {
  const units = toUnits(request.units);
  if (toUnits(balance.approvedConsumed) + 0.001 < units) {
    throw AppError.conflict(
      'The approved consumption for this request no longer matches the balance',
      'LEAVE_BALANCE_INCONSISTENT',
    );
  }
  balance.approvedConsumed = roundUnits(toUnits(balance.approvedConsumed) - units);
  balance.availableBalance = availableOf(balance);
  await balance.save({ transaction });
  await appendLedger(
    balance,
    {
      kind: 'CONSUMPTION_RESTORE',
      deltas: { consumedDelta: -units, availableDelta: units },
      leaveRequestId: request.id,
      actorUserId,
      reason: 'Approved leave request cancelled',
      metadata: { units },
    },
    transaction,
  );
}

async function convertReservationToConsumption(
  balance: LeaveBalanceModel,
  request: LeaveRequestModel,
  reviewerUserId: string,
  transaction: Transaction,
): Promise<void> {
  const units = toUnits(request.units);
  if (toUnits(balance.pendingReserved) + 0.001 < units) {
    throw AppError.conflict(
      'The reservation for this request no longer matches the balance',
      'LEAVE_BALANCE_INCONSISTENT',
    );
  }
  balance.pendingReserved = roundUnits(toUnits(balance.pendingReserved) - units);
  balance.approvedConsumed = roundUnits(toUnits(balance.approvedConsumed) + units);
  balance.availableBalance = availableOf(balance);
  await balance.save({ transaction });
  await appendLedger(
    balance,
    {
      kind: 'CONSUMPTION',
      deltas: { reservedDelta: -units, consumedDelta: units, availableDelta: 0 },
      leaveRequestId: request.id,
      actorUserId: reviewerUserId,
      reason: 'Leave request approved',
      metadata: { units },
    },
    transaction,
  );
}

function requestPayloadDiffers(existing: LeaveRequestModel, input: ApplyLeaveInput): boolean {
  return (
    existing.leaveTypeId !== input.leaveTypeId ||
    existing.startDate !== input.startDate ||
    existing.endDate !== input.endDate ||
    existing.startHalfDay !== input.startHalfDay ||
    existing.endHalfDay !== input.endHalfDay ||
    existing.reason !== input.reason ||
    existing.documentationReference !== (input.documentationReference ?? null)
  );
}

export async function applyForLeave(options: {
  organization: OrganizationModel;
  employeeId: string;
  input: ApplyLeaveInput;
  idempotencyKey: string | null;
  context?: AuditContext;
}) {
  const { organization, employeeId, input, idempotencyKey, context } = options;
  await ensureActiveEmployee(organization.id, employeeId);

  const requestId = await serializeByKey(`leave:${organization.id}:${employeeId}`, () =>
    sequelize.transaction(async (transaction) => {
      if (idempotencyKey) {
        const existing = await LeaveRequest.findOne({
          where: { organizationId: organization.id, employeeId, idempotencyKey },
          transaction,
          lock: Transaction.LOCK.UPDATE,
        });
        if (existing) {
          if (requestPayloadDiffers(existing, input)) {
            throw AppError.conflict(
              'This idempotency key was already used for a different request',
              'IDEMPOTENCY_KEY_REUSED',
            );
          }
          return existing.id;
        }
      }

      const { type, policy } = await loadLeaveTypeWithPolicy(
        organization.id,
        input.leaveTypeId,
        { transaction },
      );
      if (!type.isActive) {
        throw AppError.conflict('This leave type is inactive', 'LEAVE_TYPE_INACTIVE');
      }
      if (!policy.isActive) {
        throw AppError.conflict('The leave policy is inactive', 'LEAVE_POLICY_INACTIVE');
      }

      const today = todayInTimezone(organization.timezone);
      if (input.startDate < today) {
        throw AppError.unprocessable(
          'Leave cannot start in the past',
          'LEAVE_DATE_IN_PAST',
        );
      }
      const noticeDays = Math.round(
        (Date.parse(`${input.startDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
          86_400_000,
      );
      if (noticeDays < type.minNoticeDays) {
        throw AppError.unprocessable(
          `This leave type requires at least ${type.minNoticeDays} day(s) of notice`,
          'LEAVE_MIN_NOTICE_NOT_MET',
        );
      }
      const span = calendarDays(input.startDate, input.endDate);
      if (type.maxConsecutiveDays !== null && span > type.maxConsecutiveDays) {
        throw AppError.unprocessable(
          `This leave type allows at most ${type.maxConsecutiveDays} consecutive day(s)`,
          'LEAVE_MAX_CONSECUTIVE_DAYS_EXCEEDED',
        );
      }
      if (type.requiresDocumentation && !input.documentationReference) {
        throw AppError.unprocessable(
          'Supporting documentation is required for this leave type',
          'LEAVE_DOCUMENTATION_REQUIRED',
        );
      }

      const startPeriod = balancePeriodFor(input.startDate, policy, organization.timezone);
      const endPeriod = balancePeriodFor(input.endDate, policy, organization.timezone);
      if (startPeriod.periodStart !== endPeriod.periodStart) {
        throw AppError.unprocessable(
          'Leave requests cannot span two balance periods; submit each period separately',
          'LEAVE_SPANS_BALANCE_PERIODS',
        );
      }

      const holidayUnits = await holidayUnitsForEmployee({
        organizationId: organization.id,
        employeeId,
        from: input.startDate,
        to: input.endDate,
        transaction,
      });
      const { units, chargedDates } = calculateLeaveUnits({
        startDate: input.startDate,
        endDate: input.endDate,
        startHalfDay: input.startHalfDay,
        endHalfDay: input.endHalfDay,
        workingDays: policy.workingDays,
        holidays: new Set(),
        holidayUnits,
      });

      await assertNoOverlap({
        transaction,
        organizationId: organization.id,
        employeeId,
        startDate: input.startDate,
        endDate: input.endDate,
      });

      let balance: LeaveBalanceModel | null = null;
      if (type.requiresBalance) {
        const ensured = await ensureBalanceForDate({
          organization,
          employeeId,
          type,
          policy,
          dateIso: input.startDate,
          transaction,
        });
        balance = ensured.balance;
        if (!type.allowNegativeBalance && availableOf(balance) + 0.001 < units) {
          throw AppError.conflict(
            'The available leave balance is insufficient for this request',
            'INSUFFICIENT_LEAVE_BALANCE',
          );
        }
        balance.pendingReserved = roundUnits(toUnits(balance.pendingReserved) + units);
        balance.availableBalance = availableOf(balance);
        await balance.save({ transaction });
      }

      const request = await LeaveRequest.create(
        {
          organizationId: organization.id,
          employeeId,
          leaveTypeId: type.id,
          startDate: input.startDate,
          endDate: input.endDate,
          startHalfDay: input.startHalfDay,
          endHalfDay: input.endHalfDay,
          units,
          chargedDates,
          balancePeriodStart: type.requiresBalance ? startPeriod.periodStart : null,
          reason: input.reason,
          documentationReference: input.documentationReference ?? null,
          status: 'PENDING',
          idempotencyKey,
          submittedAt: new Date(),
        },
        { transaction },
      );

      if (balance) {
        await appendLedger(
          balance,
          {
            kind: 'RESERVATION',
            deltas: { reservedDelta: units, availableDelta: -units },
            leaveRequestId: request.id,
            actorUserId: employeeId,
            reason: 'Leave request submitted',
            metadata: { leaveTypeName: type.name, units },
          },
          transaction,
        );
      }

      await recordAuditEvent(
        {
          organizationId: organization.id,
          actorUserId: employeeId,
          targetEmployeeId: employeeId,
          action: 'LEAVE_REQUEST_SUBMITTED',
          entityType: 'LEAVE_REQUEST',
          entityId: request.id,
          metadata: {
            leaveTypeId: type.id,
            leaveTypeName: type.name,
            startDate: request.startDate,
            endDate: request.endDate,
            startHalfDay: request.startHalfDay,
            endHalfDay: request.endHalfDay,
            units,
            requiresBalance: type.requiresBalance,
            balance: balance
              ? {
                  periodStart: balance.periodStart,
                  availableBalance: toUnits(balance.availableBalance),
                  pendingReserved: toUnits(balance.pendingReserved),
                }
              : null,
          },
        },
        { transaction, context },
      );

      return request.id;
    }),
  );

  return toLeaveRequestSummary(await loadRequest(organization.id, requestId));
}

export async function listLeaveRequests(options: {
  organization: OrganizationModel;
  actorUserId: string;
  actorRole: PermissionSubject;
  query: LeaveRequestListQuery;
}) {
  const { organization, actorUserId, actorRole, query } = options;
  const where: Record<string | symbol, unknown> = { organizationId: organization.id };

  if (canReview(actorRole)) {
    if (query.employeeId) where.employeeId = query.employeeId;
  } else {
    where.employeeId = actorUserId;
  }

  if (query.status) where.status = query.status;
  if (query.leaveTypeId) where.leaveTypeId = query.leaveTypeId;
  if (query.from) where.endDate = { [Op.gte]: query.from };
  if (query.to) where.startDate = { [Op.lte]: query.to };

  const result = await LeaveRequest.findAndCountAll({
    where,
    include: requestIncludes,
    order: [
      ['createdAt', 'DESC'],
      ['id', 'ASC'],
    ],
    limit: query.limit,
    offset: (query.page - 1) * query.limit,
    distinct: true,
  });

  return paginate(
    result.rows.map((request) => toLeaveRequestSummary(request)),
    result.count,
    query.page,
    query.limit,
  );
}

export async function getLeaveRequestForActor(options: {
  organization: OrganizationModel;
  requestId: string;
  actorUserId: string;
  actorRole: PermissionSubject;
}) {
  const request = await loadRequest(options.organization.id, options.requestId);
  assertRequestAccess(request, options.actorUserId, options.actorRole);
  return toLeaveRequestSummary(request);
}

export async function approveLeaveRequest(options: {
  organization: OrganizationModel;
  requestId: string;
  reviewerUserId: string;
  input: ApproveLeaveRequestInput;
  context?: AuditContext;
}) {
  const { organization, requestId, reviewerUserId, input, context } = options;
  const header = await LeaveRequest.findOne({
    where: { id: requestId, organizationId: organization.id },
    attributes: ['id', 'employeeId'],
  });
  if (!header) {
    throw AppError.notFound('Leave request not found', 'LEAVE_REQUEST_NOT_FOUND');
  }
  if (header.employeeId === reviewerUserId) {
    throw AppError.forbidden('You cannot approve your own leave', 'SELF_APPROVAL_FORBIDDEN');
  }

  await serializeByKey(`leave:${organization.id}:${header.employeeId}`, () =>
    sequelize.transaction(async (transaction) => {
      const request = await LeaveRequest.findOne({
        where: { id: requestId, organizationId: organization.id },
        include: [{ model: LeaveType, as: 'leaveType', required: true }],
        transaction,
        lock: Transaction.LOCK.UPDATE,
      });
      if (!request) {
        throw AppError.notFound('Leave request not found', 'LEAVE_REQUEST_NOT_FOUND');
      }

      if (request.status === 'APPROVED') return;
      if (request.status !== 'PENDING') {
        throw AppError.conflict(
          'Only a pending leave request can be approved',
          'LEAVE_REQUEST_NOT_PENDING',
        );
      }

      let balance: LeaveBalanceModel | null = null;
      if (request.leaveType?.requiresBalance) {
        balance = await loadLockedBalance(transaction, organization.id, request);
        if (balance) {
          await convertReservationToConsumption(balance, request, reviewerUserId, transaction);
        }
      }

      await request.update(
        {
          status: 'APPROVED',
          reviewedAt: new Date(),
          reviewedByUserId: reviewerUserId,
          reviewerNote: input.note ?? null,
          rejectionReason: null,
        },
        { transaction },
      );

      await recordAuditEvent(
        {
          organizationId: organization.id,
          actorUserId: reviewerUserId,
          targetEmployeeId: request.employeeId,
          action: 'LEAVE_REQUEST_APPROVED',
          entityType: 'LEAVE_REQUEST',
          entityId: request.id,
          metadata: {
            leaveTypeId: request.leaveTypeId,
            units: toUnits(request.units),
            startDate: request.startDate,
            endDate: request.endDate,
            reviewerNote: input.note ?? null,
            balance: balance
              ? {
                  availableBalance: toUnits(balance.availableBalance),
                  approvedConsumed: toUnits(balance.approvedConsumed),
                  pendingReserved: toUnits(balance.pendingReserved),
                }
              : null,
          },
        },
        { transaction, context },
      );
    }),
  );

  return toLeaveRequestSummary(await loadRequest(organization.id, requestId));
}

export async function rejectLeaveRequest(options: {
  organization: OrganizationModel;
  requestId: string;
  reviewerUserId: string;
  input: RejectLeaveRequestInput;
  context?: AuditContext;
}) {
  const { organization, requestId, reviewerUserId, input, context } = options;
  const header = await LeaveRequest.findOne({
    where: { id: requestId, organizationId: organization.id },
    attributes: ['id', 'employeeId'],
  });
  if (!header) {
    throw AppError.notFound('Leave request not found', 'LEAVE_REQUEST_NOT_FOUND');
  }
  if (header.employeeId === reviewerUserId) {
    throw AppError.forbidden('You cannot reject your own leave', 'SELF_APPROVAL_FORBIDDEN');
  }

  await serializeByKey(`leave:${organization.id}:${header.employeeId}`, () =>
    sequelize.transaction(async (transaction) => {
      const request = await LeaveRequest.findOne({
        where: { id: requestId, organizationId: organization.id },
        include: [{ model: LeaveType, as: 'leaveType', required: true }],
        transaction,
        lock: Transaction.LOCK.UPDATE,
      });
      if (!request) {
        throw AppError.notFound('Leave request not found', 'LEAVE_REQUEST_NOT_FOUND');
      }

      if (request.status === 'REJECTED') return;

      if (request.status === 'CANCELLATION_REQUESTED') {
        await request.update(
          {
            status: 'APPROVED',
            cancellationRequestedAt: null,
            cancellationReason: null,
            reviewedAt: new Date(),
            reviewedByUserId: reviewerUserId,
            reviewerNote: input.note ?? null,
          },
          { transaction },
        );

        await recordAuditEvent(
          {
            organizationId: organization.id,
            actorUserId: reviewerUserId,
            targetEmployeeId: request.employeeId,
            action: 'LEAVE_CANCELLATION_REJECTED',
            entityType: 'LEAVE_REQUEST',
            entityId: request.id,
            metadata: {
              reason: input.reason,
              reviewerNote: input.note ?? null,
              units: toUnits(request.units),
            },
          },
          { transaction, context },
        );
        return;
      }

      if (request.status !== 'PENDING') {
        throw AppError.conflict(
          'Only a pending leave request can be rejected',
          'LEAVE_REQUEST_NOT_PENDING',
        );
      }

      if (request.leaveType?.requiresBalance) {
        const balance = await loadLockedBalance(transaction, organization.id, request);
        if (balance) await releaseReservation(balance, request, transaction);
      }

      await request.update(
        {
          status: 'REJECTED',
          reviewedAt: new Date(),
          reviewedByUserId: reviewerUserId,
          reviewerNote: input.note ?? null,
          rejectionReason: input.reason,
        },
        { transaction },
      );

      await recordAuditEvent(
        {
          organizationId: organization.id,
          actorUserId: reviewerUserId,
          targetEmployeeId: request.employeeId,
          action: 'LEAVE_REQUEST_REJECTED',
          entityType: 'LEAVE_REQUEST',
          entityId: request.id,
          metadata: {
            leaveTypeId: request.leaveTypeId,
            units: toUnits(request.units),
            reason: input.reason,
            reviewerNote: input.note ?? null,
          },
        },
        { transaction, context },
      );
    }),
  );

  return toLeaveRequestSummary(await loadRequest(organization.id, requestId));
}

export async function cancelLeaveRequest(options: {
  organization: OrganizationModel;
  requestId: string;
  actorUserId: string;
  actorRole: PermissionSubject;
  input: CancelLeaveRequestInput;
  context?: AuditContext;
}) {
  const { organization, requestId, actorUserId, actorRole, input, context } = options;
  const actorCanReview = canReview(actorRole);

  const header = await LeaveRequest.findOne({
    where: { id: requestId, organizationId: organization.id },
    attributes: ['id', 'employeeId'],
  });
  if (!header) {
    throw AppError.notFound('Leave request not found', 'LEAVE_REQUEST_NOT_FOUND');
  }
  if (header.employeeId !== actorUserId && !actorCanReview) {
    throw AppError.notFound('Leave request not found', 'LEAVE_REQUEST_NOT_FOUND');
  }

  await serializeByKey(`leave:${organization.id}:${header.employeeId}`, () =>
    sequelize.transaction(async (transaction) => {
      const request = await LeaveRequest.findOne({
        where: { id: requestId, organizationId: organization.id },
        include: [{ model: LeaveType, as: 'leaveType', required: true }],
        transaction,
        lock: Transaction.LOCK.UPDATE,
      });
      if (!request) {
        throw AppError.notFound('Leave request not found', 'LEAVE_REQUEST_NOT_FOUND');
      }

      if (request.status === 'CANCELLED' || request.status === 'REJECTED') {
        throw AppError.conflict(
          'This leave request can no longer be cancelled',
          'LEAVE_REQUEST_NOT_CANCELLABLE',
        );
      }

      if (request.status === 'CANCELLATION_REQUESTED') {
        // A repeat employee cancellation is idempotent; a reviewer finalizes it.
        if (!actorCanReview) return;
      }

      if (request.status === 'APPROVED') {
        if (!request.leaveType?.allowApprovedCancellation) {
          throw AppError.conflict(
            'Approved leave of this type cannot be cancelled',
            'LEAVE_REQUEST_NOT_CANCELLABLE',
          );
        }

        if (request.leaveType.cancellationRequiresApproval && !actorCanReview) {
          await request.update(
            {
              status: 'CANCELLATION_REQUESTED',
              cancellationRequestedAt: new Date(),
              cancellationReason: input.reason ?? null,
            },
            { transaction },
          );

          await recordAuditEvent(
            {
              organizationId: organization.id,
              actorUserId,
              targetEmployeeId: request.employeeId,
              action: 'LEAVE_CANCELLATION_REQUESTED',
              entityType: 'LEAVE_REQUEST',
              entityId: request.id,
              metadata: {
                reason: input.reason ?? null,
                units: toUnits(request.units),
              },
            },
            { transaction, context },
          );
          return;
        }
      }

      const wasApproved = request.status === 'APPROVED' || request.status === 'CANCELLATION_REQUESTED';

      if (wasApproved && request.leaveType?.requiresBalance) {
        const balance = await loadLockedBalance(transaction, organization.id, request);
        if (balance) await restoreConsumption(balance, request, actorUserId, transaction);
      }

      if (!wasApproved && request.leaveType?.requiresBalance) {
        const balance = await loadLockedBalance(transaction, organization.id, request);
        if (balance) await releaseReservation(balance, request, transaction);
      }

      await request.update(
        {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledByUserId: actorUserId,
          cancellationReason: input.reason ?? request.cancellationReason ?? null,
        },
        { transaction },
      );

      await recordAuditEvent(
        {
          organizationId: organization.id,
          actorUserId,
          targetEmployeeId: request.employeeId,
          action: 'LEAVE_REQUEST_CANCELLED',
          entityType: 'LEAVE_REQUEST',
          entityId: request.id,
          metadata: {
            leaveTypeId: request.leaveTypeId,
            units: toUnits(request.units),
            wasApproved,
            reason: input.reason ?? null,
          },
        },
        { transaction, context },
      );
    }),
  );

  return toLeaveRequestSummary(await loadRequest(organization.id, requestId));
}
