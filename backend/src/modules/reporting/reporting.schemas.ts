import { z } from 'zod';
import { DateTime } from 'luxon';
import { paginationSchema } from '../../utils/pagination';
import { TIME_SESSION_STATUSES } from '../timeTracking/timeSession.model';

export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((value) => DateTime.fromISO(value, { zone: 'utc' }).isValid, 'Invalid calendar date');

export function dateRangeSchema(maxDays: number) {
  return z
    .object({
      from: dateOnlySchema,
      to: dateOnlySchema,
    })
    .superRefine((value, ctx) => {
      const start = DateTime.fromISO(value.from, { zone: 'utc' }).startOf('day');
      const end = DateTime.fromISO(value.to, { zone: 'utc' }).startOf('day');
      if (end < start) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['to'],
          message: 'to must be on or after from',
        });
        return;
      }
      const days = Math.round(end.diff(start, 'days').days) + 1;
      if (days > maxDays) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['to'],
          message: `Date range cannot exceed ${maxDays} days`,
        });
      }
    });
}

export const trackingStatusQuerySchema = paginationSchema.extend({
  employeeId: z.string().uuid().optional(),
});

export const sessionReportQuerySchema = dateRangeSchema(366).and(
  paginationSchema.extend({
    employeeId: z.string().uuid().optional(),
    status: z.enum(TIME_SESSION_STATUSES).optional(),
  }),
);

export const dailyReportQuerySchema = dateRangeSchema(92).and(
  z.object({
    employeeId: z.string().uuid('employeeId is required'),
  }),
);

export const applicationUsageQuerySchema = dateRangeSchema(31).and(
  paginationSchema.extend({
    employeeId: z.string().uuid('employeeId is required'),
  }),
);

export const applicationTimelineQuerySchema = dateRangeSchema(7).and(
  paginationSchema.extend({
    employeeId: z.string().uuid('employeeId is required'),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  }),
);

export type TrackingStatusQuery = z.infer<typeof trackingStatusQuerySchema>;
export type SessionReportQuery = z.infer<typeof sessionReportQuerySchema>;
export type DailyReportQuery = z.infer<typeof dailyReportQuerySchema>;
export type ApplicationUsageQuery = z.infer<typeof applicationUsageQuerySchema>;
export type ApplicationTimelineQuery = z.infer<typeof applicationTimelineQuerySchema>;
