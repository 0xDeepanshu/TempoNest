import { z } from 'zod';
import { platformSchema } from './activity.schemas';

const isoDateTime = z.string().datetime({
  offset: true,
  message: 'Must be an ISO-8601 timestamp with an offset',
});

export const idleIntervalSchema = z
  .object({
    idempotencyKey: z.string().trim().min(8).max(160),
    sessionId: z.string().uuid('sessionId must be a valid UUID').optional(),
    platform: platformSchema.optional(),
    startedAt: isoDateTime,
    endedAt: isoDateTime,
  })
  .strict()
  .superRefine((value, ctx) => {
    const start = Date.parse(value.startedAt);
    const end = Date.parse(value.endedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endedAt'],
        message: 'endedAt must be after startedAt',
      });
      return;
    }
    if (end - start > 86_400_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endedAt'],
        message: 'Idle interval cannot exceed 24 hours',
      });
    }
  });

export const idleIntervalBatchSchema = z
  .object({
    intervals: z.array(idleIntervalSchema).min(1).max(200),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const [index, interval] of value.intervals.entries()) {
      if (seen.has(interval.idempotencyKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['intervals', index, 'idempotencyKey'],
          message: 'Duplicate idempotencyKey within batch',
        });
      }
      seen.add(interval.idempotencyKey);
    }
  });

export type IdleIntervalInput = z.infer<typeof idleIntervalSchema>;
export type IdleIntervalBatchInput = z.infer<typeof idleIntervalBatchSchema>;
