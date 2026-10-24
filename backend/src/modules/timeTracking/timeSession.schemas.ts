import { z } from 'zod';
import { paginationSchema } from '../../utils/pagination';
import { TIME_SESSION_STATUSES } from './timeSession.model';
import { OFFLINE_EVENT_TYPES } from './offlineEvent.model';

export const sessionIdParamsSchema = z.object({
  organizationId: z.string().uuid('Organization ID must be a valid UUID'),
  sessionId: z.string().uuid('Session ID must be a valid UUID'),
});

const historyTimestamp = z.string().datetime({
  offset: true,
  message: 'History range bounds must be ISO-8601 timestamps with an offset',
});

export const sessionListQuerySchema = paginationSchema
  .extend({
    employeeId: z.string().uuid().optional(),
    status: z.enum(TIME_SESSION_STATUSES).optional(),
    from: historyTimestamp.optional(),
    to: historyTimestamp.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.from && value.to && Date.parse(value.to) <= Date.parse(value.from)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: 'to must be after from',
      });
    }
  });

export type SessionListQuery = z.infer<typeof sessionListQuerySchema>;

const clientEventId = z.string().trim().min(8, 'Event ID must be at least 8 characters').max(160);
const occurredAt = z.string().datetime({ offset: true, message: 'occurredAt must be an ISO-8601 timestamp with an offset' });

export const offlineEventSchema = z
  .object({
    eventId: clientEventId,
    type: z.enum(OFFLINE_EVENT_TYPES),
    occurredAt,
    sessionId: z.string().uuid('sessionId must be a valid client-generated UUID'),
  })
  .strict();

export const offlineSyncSchema = z
  .object({
    deviceId: z.string().trim().min(8).max(160),
    events: z.array(offlineEventSchema).min(1).max(200),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const [index, event] of value.events.entries()) {
      if (seen.has(event.eventId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['events', index, 'eventId'],
          message: 'Duplicate eventId within batch',
        });
      }
      seen.add(event.eventId);
    }
  });

export type OfflineSyncInput = z.infer<typeof offlineSyncSchema>;
export type OfflineEventInput = z.infer<typeof offlineEventSchema>;
