import { z } from 'zod';
import { DateTime } from 'luxon';
import { paginationSchema } from '../../utils/pagination';
import { dateOnlySchema, dateRangeSchema } from '../reporting/reporting.schemas';
import { CORRECTION_STATUSES } from './attendanceCorrection.model';

export const ATTENDANCE_SUMMARY_PERIODS = ['daily', 'weekly', 'monthly'] as const;
export type AttendanceSummaryPeriod = (typeof ATTENDANCE_SUMMARY_PERIODS)[number];

const timestamp = z.string().datetime({
  offset: true,
  message: 'Timestamps must be ISO-8601 with an offset',
});

const requestedBreakSchema = z
  .object({
    startedAt: timestamp,
    endedAt: timestamp,
  })
  .strict();

export const attendanceSummaryQuerySchema = dateRangeSchema(366).and(
  z.object({
    employeeId: z.string().uuid().optional(),
    period: z.enum(ATTENDANCE_SUMMARY_PERIODS).default('daily'),
  }),
);

export const attendanceCorrectionIdParamsSchema = z.object({
  organizationId: z.string().uuid('Organization ID must be a valid UUID'),
  correctionId: z.string().uuid('Correction ID must be a valid UUID'),
});

export const attendanceCorrectionListQuerySchema = paginationSchema
  .extend({
    employeeId: z.string().uuid().optional(),
    status: z.enum(CORRECTION_STATUSES).optional(),
    from: dateOnlySchema.optional(),
    to: dateOnlySchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.from || !value.to) return;
    const start = DateTime.fromISO(value.from, { zone: 'utc' }).startOf('day');
    const end = DateTime.fromISO(value.to, { zone: 'utc' }).startOf('day');
    if (end < start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: 'to must be on or after from',
      });
    }
  });

export const createAttendanceCorrectionSchema = z
  .object({
    sessionId: z.string().uuid().optional(),
    workDate: dateOnlySchema,
    startedAt: timestamp,
    endedAt: timestamp,
    breaks: z.array(requestedBreakSchema).max(100).default([]),
    reason: z.string().trim().min(3).max(2000),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (Date.parse(value.endedAt) <= Date.parse(value.startedAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endedAt'],
        message: 'endedAt must be after startedAt',
      });
    }
  });

export const approveAttendanceCorrectionSchema = z
  .object({
    note: z.string().trim().max(2000).optional(),
  })
  .strict()
  .default({});

export const rejectAttendanceCorrectionSchema = z
  .object({
    reason: z.string().trim().min(3).max(2000),
    note: z.string().trim().max(2000).optional(),
  })
  .strict();

export type AttendanceSummaryQuery = z.infer<typeof attendanceSummaryQuerySchema>;
export type AttendanceCorrectionListQuery = z.infer<typeof attendanceCorrectionListQuerySchema>;
export type CreateAttendanceCorrectionInput = z.infer<typeof createAttendanceCorrectionSchema>;
export type ApproveAttendanceCorrectionInput = z.infer<typeof approveAttendanceCorrectionSchema>;
export type RejectAttendanceCorrectionInput = z.infer<typeof rejectAttendanceCorrectionSchema>;
