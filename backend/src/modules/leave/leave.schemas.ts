import { z } from 'zod';
import { DateTime } from 'luxon';
import { paginationSchema } from '../../utils/pagination';
import { AppError } from '../../utils/errors';
import { dateOnlySchema } from '../reporting/reporting.schemas';
import { ACCRUAL_FREQUENCIES } from './leavePolicy.model';
import { LEAVE_REQUEST_STATUSES } from './leaveRequest.model';
import { LEAVE_AUDIT_ACTIONS } from '../screenshots/auditEvent.model';

const booleanQuery = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();

const money = z.number().finite().min(0).max(3650);
const signedDayUnits = z.number().finite().min(-3650).max(3650);

export const leaveTypeIdParamsSchema = z.object({
  organizationId: z.string().uuid('Organization ID must be a valid UUID'),
  leaveTypeId: z.string().uuid('Leave type ID must be a valid UUID'),
});

export const leavePolicyIdParamsSchema = z.object({
  organizationId: z.string().uuid('Organization ID must be a valid UUID'),
  policyId: z.string().uuid('Leave policy ID must be a valid UUID'),
});

export const leaveHolidayIdParamsSchema = z.object({
  organizationId: z.string().uuid('Organization ID must be a valid UUID'),
  holidayId: z.string().uuid('Holiday ID must be a valid UUID'),
});

export const leaveRequestIdParamsSchema = z.object({
  organizationId: z.string().uuid('Organization ID must be a valid UUID'),
  requestId: z.string().uuid('Leave request ID must be a valid UUID'),
});

export const leaveBalanceEmployeeParamsSchema = z.object({
  organizationId: z.string().uuid('Organization ID must be a valid UUID'),
  employeeId: z.string().uuid('Employee ID must be a valid UUID'),
});

export const leaveTypesQuerySchema = z.object({
  includeInactive: booleanQuery,
});

export const createLeaveTypeSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(2000).nullable().optional(),
    isActive: z.boolean().optional(),
    isPaid: z.boolean().optional(),
    requiresBalance: z.boolean().optional(),
    allowNegativeBalance: z.boolean().optional(),
    maxConsecutiveDays: z.number().int().min(1).max(365).nullable().optional(),
    minNoticeDays: z.number().int().min(0).max(365).optional(),
    requiresDocumentation: z.boolean().optional(),
    allowApprovedCancellation: z.boolean().optional(),
    cancellationRequiresApproval: z.boolean().optional(),
  })
  .strict();

export const updateLeaveTypeSchema = createLeaveTypeSchema
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });

const workingDaysSchema = z
  .array(z.number().int().min(1).max(7))
  .min(1)
  .max(7)
  .refine((value) => new Set(value).size === value.length, 'Working days must be unique');

export const updateLeavePolicySchema = z
  .object({
    initialEntitlement: money.optional(),
    accrualFrequency: z.enum(ACCRUAL_FREQUENCIES).optional(),
    accrualAmount: money.optional(),
    accrualDayOfMonth: z.number().int().min(1).max(31).optional(),
    accrualEffectiveFrom: dateOnlySchema.nullable().optional(),
    prorateAccrual: z.boolean().optional(),
    balancePeriodStartMonth: z.number().int().min(1).max(12).optional(),
    balancePeriodStartDay: z.number().int().min(1).max(31).optional(),
    carryForwardAllowance: money.optional(),
    maxBalance: money.nullable().optional(),
    prorateInitialEntitlement: z.boolean().optional(),
    workingDays: workingDaysSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });

export const leaveHolidayQuerySchema = z
  .object({
    from: dateOnlySchema.optional(),
    to: dateOnlySchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.from || !value.to) return;
    if (value.to < value.from) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: 'to must be on or after from',
      });
    }
  });

export const createLeaveHolidaySchema = z
  .object({
    holidayDate: dateOnlySchema,
    name: z.string().trim().min(2).max(120),
  })
  .strict();

export const leaveBalanceListQuerySchema = paginationSchema.extend({
  employeeId: z.string().uuid().optional(),
  leaveTypeId: z.string().uuid().optional(),
  periodStart: dateOnlySchema.optional(),
});

export const leaveBalanceDetailQuerySchema = z.object({
  leaveTypeId: z.string().uuid().optional(),
  periodStart: dateOnlySchema.optional(),
});

export const leaveAdjustmentSchema = z
  .object({
    leaveTypeId: z.string().uuid(),
    amount: signedDayUnits.refine((value) => value !== 0, 'Amount must not be zero'),
    reason: z.string().trim().min(3).max(500),
    periodStart: dateOnlySchema.optional(),
  })
  .strict();

const employeeIdListSchema = z
  .array(z.string().uuid())
  .min(1)
  .max(200)
  .refine((value) => new Set(value).size === value.length, 'Employee IDs must be unique');

export const bulkLeaveAdjustmentSchema = leaveAdjustmentSchema
  .extend({ employeeIds: employeeIdListSchema })
  .strict();

export const bulkLeaveAdjustmentConfirmSchema = bulkLeaveAdjustmentSchema
  .extend({ confirm: z.literal(true) })
  .strict();

export const leaveBalanceBackfillQuerySchema = z
  .object({
    periodStart: dateOnlySchema.optional(),
    employeeId: z.string().uuid().optional(),
    leaveTypeId: z.string().uuid().optional(),
  })
  .strict();

export const leaveBalanceBackfillSchema = z
  .object({
    confirm: z.literal(true),
    periodStart: dateOnlySchema.optional(),
    employeeIds: z
      .array(z.string().uuid())
      .min(1)
      .max(500)
      .refine((value) => new Set(value).size === value.length, 'Employee IDs must be unique')
      .optional(),
    leaveTypeIds: z
      .array(z.string().uuid())
      .min(1)
      .max(100)
      .refine((value) => new Set(value).size === value.length, 'Leave type IDs must be unique')
      .optional(),
  })
  .strict();

export const leaveBalanceReconciliationQuerySchema = z
  .object({
    periodStart: dateOnlySchema.optional(),
  })
  .strict();

export const leaveBalanceRepairSchema = z
  .object({
    confirm: z.literal(true),
    balanceIds: z
      .array(z.string().uuid())
      .min(1)
      .max(200)
      .refine((value) => new Set(value).size === value.length, 'Balance IDs must be unique'),
  })
  .strict();

export const leaveAccrualPreviewQuerySchema = z
  .object({
    employeeId: z.string().uuid().optional(),
    leaveTypeId: z.string().uuid().optional(),
  })
  .strict();

export const leaveLedgerQuerySchema = paginationSchema.extend({
  employeeId: z.string().uuid().optional(),
  leaveTypeId: z.string().uuid().optional(),
  periodStart: dateOnlySchema.optional(),
});

export const applyLeaveSchema = z
  .object({
    leaveTypeId: z.string().uuid(),
    startDate: dateOnlySchema,
    endDate: dateOnlySchema,
    startHalfDay: z.boolean().default(false),
    endHalfDay: z.boolean().default(false),
    reason: z.string().trim().min(3).max(2000),
    documentationReference: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.endDate < value.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'endDate must be on or after startDate',
      });
    }
    if (value.startDate === value.endDate && value.startHalfDay && value.endHalfDay) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endHalfDay'],
        message: 'A single-day request cannot be half-day at both ends',
      });
    }
  });

export const leaveRequestListQuerySchema = paginationSchema
  .extend({
    employeeId: z.string().uuid().optional(),
    leaveTypeId: z.string().uuid().optional(),
    status: z.enum(LEAVE_REQUEST_STATUSES).optional(),
    from: dateOnlySchema.optional(),
    to: dateOnlySchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.from || !value.to) return;
    if (value.to < value.from) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: 'to must be on or after from',
      });
    }
  });

export const approveLeaveRequestSchema = z
  .object({
    note: z.string().trim().max(2000).optional(),
  })
  .strict()
  .default({});

export const rejectLeaveRequestSchema = z
  .object({
    reason: z.string().trim().min(3).max(2000),
    note: z.string().trim().max(2000).optional(),
  })
  .strict();

export const cancelLeaveRequestSchema = z
  .object({
    reason: z.string().trim().min(3).max(2000).optional(),
  })
  .strict()
  .default({});

export const leaveAuditQuerySchema = paginationSchema
  .extend({
    action: z.enum(LEAVE_AUDIT_ACTIONS).optional(),
    entityType: z.string().trim().min(1).max(40).optional(),
    employeeId: z.string().uuid().optional(),
    from: dateOnlySchema.optional(),
    to: dateOnlySchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.from || !value.to) return;
    if (value.to < value.from) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: 'to must be on or after from',
      });
    }
  });

export function parseIdempotencyKey(value: string | undefined): string | null {
  if (value === undefined || value.trim() === '') return null;
  const trimmed = value.trim();
  if (trimmed.length > 128) {
    throw AppError.unprocessable(
      'Idempotency-Key must be at most 128 characters',
      'IDEMPOTENCY_KEY_INVALID',
    );
  }
  return trimmed;
}

export function parseAuditDateRange(from?: string, to?: string): { start?: Date; end?: Date } {
  return {
    start: from ? DateTime.fromISO(from, { zone: 'utc' }).startOf('day').toJSDate() : undefined,
    end: to ? DateTime.fromISO(to, { zone: 'utc' }).endOf('day').toJSDate() : undefined,
  };
}

export type CreateLeaveTypeInput = z.infer<typeof createLeaveTypeSchema>;
export type UpdateLeaveTypeInput = z.infer<typeof updateLeaveTypeSchema>;
export type UpdateLeavePolicyInput = z.infer<typeof updateLeavePolicySchema>;
export type CreateLeaveHolidayInput = z.infer<typeof createLeaveHolidaySchema>;
export type LeaveHolidayQuery = z.infer<typeof leaveHolidayQuerySchema>;
export type LeaveBalanceListQuery = z.infer<typeof leaveBalanceListQuerySchema>;
export type LeaveBalanceDetailQuery = z.infer<typeof leaveBalanceDetailQuerySchema>;
export type LeaveAdjustmentInput = z.infer<typeof leaveAdjustmentSchema>;
export type BulkLeaveAdjustmentInput = z.infer<typeof bulkLeaveAdjustmentSchema>;
export type BulkLeaveAdjustmentConfirmInput = z.infer<
  typeof bulkLeaveAdjustmentConfirmSchema
>;
export type LeaveBalanceBackfillQuery = z.infer<typeof leaveBalanceBackfillQuerySchema>;
export type LeaveBalanceBackfillInput = z.infer<typeof leaveBalanceBackfillSchema>;
export type LeaveBalanceReconciliationQuery = z.infer<
  typeof leaveBalanceReconciliationQuerySchema
>;
export type LeaveBalanceRepairInput = z.infer<typeof leaveBalanceRepairSchema>;
export type LeaveAccrualPreviewQuery = z.infer<typeof leaveAccrualPreviewQuerySchema>;
export type LeaveLedgerQuery = z.infer<typeof leaveLedgerQuerySchema>;
export type ApplyLeaveInput = z.infer<typeof applyLeaveSchema>;
export type LeaveRequestListQuery = z.infer<typeof leaveRequestListQuerySchema>;
export type ApproveLeaveRequestInput = z.infer<typeof approveLeaveRequestSchema>;
export type RejectLeaveRequestInput = z.infer<typeof rejectLeaveRequestSchema>;
export type CancelLeaveRequestInput = z.infer<typeof cancelLeaveRequestSchema>;
export type LeaveAuditQuery = z.infer<typeof leaveAuditQuerySchema>;
export type LeaveTypesQuery = z.infer<typeof leaveTypesQuerySchema>;
