import { toUnits } from './leaveCalendar';
import type { AuditEvent as AuditEventModel } from '../screenshots/auditEvent.model';
import type { LeaveBalance as LeaveBalanceModel } from './leaveBalance.model';
import type { LeaveHoliday as LeaveHolidayModel } from './leaveHoliday.model';
import type { LeaveLedgerEntry as LeaveLedgerEntryModel } from './leaveLedgerEntry.model';
import type { LeavePolicy as LeavePolicyModel } from './leavePolicy.model';
import type { LeaveRequest as LeaveRequestModel } from './leaveRequest.model';
import type { LeaveType as LeaveTypeModel } from './leaveType.model';

export function toLeavePolicySummary(policy: LeavePolicyModel) {
  return {
    id: policy.id,
    organizationId: policy.organizationId,
    leaveTypeId: policy.leaveTypeId,
    initialEntitlement: toUnits(policy.initialEntitlement),
    accrualFrequency: policy.accrualFrequency,
    accrualAmount: toUnits(policy.accrualAmount),
    accrualDayOfMonth: policy.accrualDayOfMonth,
    accrualEffectiveFrom: policy.accrualEffectiveFrom,
    prorateAccrual: policy.prorateAccrual,
    balancePeriodStartMonth: policy.balancePeriodStartMonth,
    balancePeriodStartDay: policy.balancePeriodStartDay,
    carryForwardAllowance: toUnits(policy.carryForwardAllowance),
    maxBalance: policy.maxBalance === null ? null : toUnits(policy.maxBalance),
    prorateInitialEntitlement: policy.prorateInitialEntitlement,
    workingDays: policy.workingDays,
    isActive: policy.isActive,
    createdAt: policy.createdAt,
    updatedAt: policy.updatedAt,
  };
}

export function toLeaveTypeSummary(type: LeaveTypeModel) {
  return {
    id: type.id,
    organizationId: type.organizationId,
    name: type.name,
    description: type.description,
    isActive: type.isActive,
    isPaid: type.isPaid,
    requiresBalance: type.requiresBalance,
    allowNegativeBalance: type.allowNegativeBalance,
    maxConsecutiveDays: type.maxConsecutiveDays,
    minNoticeDays: type.minNoticeDays,
    requiresDocumentation: type.requiresDocumentation,
    allowApprovedCancellation: type.allowApprovedCancellation,
    cancellationRequiresApproval: type.cancellationRequiresApproval,
    ...(type.policy ? { policy: toLeavePolicySummary(type.policy) } : {}),
    createdAt: type.createdAt,
    updatedAt: type.updatedAt,
  };
}

export function toLeaveHolidaySummary(holiday: LeaveHolidayModel) {
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
    createdAt: holiday.createdAt,
    updatedAt: holiday.updatedAt,
  };
}

export function toLeaveLedgerEntrySummary(entry: LeaveLedgerEntryModel) {
  return {
    id: entry.id,
    balanceId: entry.balanceId,
    leaveRequestId: entry.leaveRequestId,
    kind: entry.kind,
    accrualPeriod: entry.accrualPeriod,
    entitledDelta: toUnits(entry.entitledDelta),
    accruedDelta: toUnits(entry.accruedDelta),
    adjustmentDelta: toUnits(entry.adjustmentDelta),
    carriedForwardDelta: toUnits(entry.carriedForwardDelta),
    reservedDelta: toUnits(entry.reservedDelta),
    consumedDelta: toUnits(entry.consumedDelta),
    availableDelta: toUnits(entry.availableDelta),
    balanceAfter: toUnits(entry.balanceAfter),
    reason: entry.reason,
    actorUserId: entry.actorUserId,
    metadata: entry.metadata,
    ...(entry.employee
      ? {
          employee: {
            id: entry.employee.id,
            name: entry.employee.name,
            email: entry.employee.email,
          },
        }
      : {}),
    ...(entry.leaveType
      ? { leaveType: { id: entry.leaveType.id, name: entry.leaveType.name } }
      : {}),
    ...(entry.actor
      ? { actor: { id: entry.actor.id, name: entry.actor.name, email: entry.actor.email } }
      : {}),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

export function toLeaveBalanceSummary(balance: LeaveBalanceModel) {
  return {
    id: balance.id,
    organizationId: balance.organizationId,
    employeeId: balance.employeeId,
    leaveTypeId: balance.leaveTypeId,
    periodStart: balance.periodStart,
    periodEnd: balance.periodEnd,
    entitledBalance: toUnits(balance.entitledBalance),
    accruedBalance: toUnits(balance.accruedBalance),
    adjustmentBalance: toUnits(balance.adjustmentBalance),
    carriedForwardBalance: toUnits(balance.carriedForwardBalance),
    approvedConsumed: toUnits(balance.approvedConsumed),
    pendingReserved: toUnits(balance.pendingReserved),
    availableBalance: toUnits(balance.availableBalance),
    breakdown: {
      entitled: toUnits(balance.entitledBalance),
      accrued: toUnits(balance.accruedBalance),
      adjustments: toUnits(balance.adjustmentBalance),
      carriedForward: toUnits(balance.carriedForwardBalance),
      approvedConsumed: toUnits(balance.approvedConsumed),
      pendingReserved: toUnits(balance.pendingReserved),
      available: toUnits(balance.availableBalance),
    },
    ...(balance.leaveType
      ? {
          leaveType: {
            id: balance.leaveType.id,
            name: balance.leaveType.name,
            isPaid: balance.leaveType.isPaid,
            requiresBalance: balance.leaveType.requiresBalance,
          },
        }
      : {}),
    ...(balance.employee
      ? {
          employee: {
            id: balance.employee.id,
            name: balance.employee.name,
            email: balance.employee.email,
          },
        }
      : {}),
    ...(balance.ledgerEntries
      ? { ledger: balance.ledgerEntries.map((entry) => toLeaveLedgerEntrySummary(entry)) }
      : {}),
    createdAt: balance.createdAt,
    updatedAt: balance.updatedAt,
  };
}

export function toLeaveRequestSummary(request: LeaveRequestModel) {
  return {
    id: request.id,
    organizationId: request.organizationId,
    employeeId: request.employeeId,
    leaveTypeId: request.leaveTypeId,
    startDate: request.startDate,
    endDate: request.endDate,
    startHalfDay: request.startHalfDay,
    endHalfDay: request.endHalfDay,
    units: toUnits(request.units),
    chargedDates: request.chargedDates,
    balancePeriodStart: request.balancePeriodStart,
    reason: request.reason,
    documentationReference: request.documentationReference,
    status: request.status,
    idempotencyKey: request.idempotencyKey,
    submittedAt: request.submittedAt,
    reviewedAt: request.reviewedAt,
    reviewedByUserId: request.reviewedByUserId,
    reviewerNote: request.reviewerNote,
    rejectionReason: request.rejectionReason,
    cancellationRequestedAt: request.cancellationRequestedAt,
    cancelledAt: request.cancelledAt,
    cancelledByUserId: request.cancelledByUserId,
    cancellationReason: request.cancellationReason,
    ...(request.leaveType
      ? {
          leaveType: {
            id: request.leaveType.id,
            name: request.leaveType.name,
            isPaid: request.leaveType.isPaid,
            requiresBalance: request.leaveType.requiresBalance,
          },
        }
      : {}),
    ...(request.employee
      ? {
          employee: {
            id: request.employee.id,
            name: request.employee.name,
            email: request.employee.email,
          },
        }
      : {}),
    ...(request.reviewer
      ? {
          reviewer: {
            id: request.reviewer.id,
            name: request.reviewer.name,
            email: request.reviewer.email,
          },
        }
      : {}),
    ...(request.cancelledBy
      ? {
          cancelledBy: {
            id: request.cancelledBy.id,
            name: request.cancelledBy.name,
            email: request.cancelledBy.email,
          },
        }
      : {}),
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

export function toLeaveAuditSummary(event: AuditEventModel) {
  return {
    id: event.id,
    organizationId: event.organizationId,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    actorUserId: event.actorUserId,
    targetEmployeeId: event.targetEmployeeId,
    metadata: event.metadata,
    ipAddress: event.ipAddress,
    userAgent: event.userAgent,
    ...(event.actor
      ? { actor: { id: event.actor.id, name: event.actor.name, email: event.actor.email } }
      : {}),
    ...(event.targetEmployee
      ? {
          targetEmployee: {
            id: event.targetEmployee.id,
            name: event.targetEmployee.name,
            email: event.targetEmployee.email,
          },
        }
      : {}),
    createdAt: event.createdAt,
  };
}
