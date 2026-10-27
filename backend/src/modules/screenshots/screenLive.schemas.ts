import { z } from 'zod';

export const screenLiveSessionIdParamsSchema = z.object({
  sessionId: z.string().uuid('Live screen session ID must be a valid UUID'),
});

export const screenLiveTicketSchema = z.object({}).strict().default({});

export const screenLiveStopSchema = z.object({}).strict().default({});

export type ScreenLiveTicketInput = z.infer<typeof screenLiveTicketSchema>;
export type ScreenLiveStopInput = z.infer<typeof screenLiveStopSchema>;
