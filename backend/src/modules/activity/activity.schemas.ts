import { z } from 'zod';

const isoDateTime = z.string().datetime({
  offset: true,
  message: 'Must be an ISO-8601 timestamp with an offset',
});

export const activityEventSchema = z
  .object({
    idempotencyKey: z.string().trim().min(8).max(160),
    sessionId: z.string().uuid('sessionId must be a valid UUID'),
    applicationIdentifier: z.string().trim().min(1).max(200),
    applicationName: z.string().trim().min(1).max(255),
    startedAt: isoDateTime,
    endedAt: isoDateTime,
    // Present for Electron compatibility but deliberately ignored: the server
    // derives duration from the interval and reports clip it again. No maximum
    // is enforced here because the client value must never influence storage.
    durationSeconds: z.number().finite().min(0).optional(),
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
        message: 'Activity interval cannot exceed 24 hours',
      });
    }
  });

export const activityBatchSchema = z
  .object({
    events: z.array(activityEventSchema).min(1).max(200),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const [index, event] of value.events.entries()) {
      if (seen.has(event.idempotencyKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['events', index, 'idempotencyKey'],
          message: 'Duplicate idempotencyKey within batch',
        });
      }
      seen.add(event.idempotencyKey);
    }
  });

export type ActivityEventInput = z.infer<typeof activityEventSchema>;
export type ActivityBatchInput = z.infer<typeof activityBatchSchema>;
