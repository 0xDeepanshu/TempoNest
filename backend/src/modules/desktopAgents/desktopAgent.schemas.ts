import { z } from 'zod';
import { DESKTOP_AGENT_CLIENT_TYPES } from './desktopAgent.model';

export const agentIdParamsSchema = z.object({
  organizationId: z.string().uuid('Organization ID must be a valid UUID'),
  agentId: z.string().uuid('Agent ID must be a valid UUID'),
});

export const registerAgentSchema = z
  .object({
    deviceId: z.string().trim().min(8, 'Device ID must be at least 8 characters').max(160),
    name: z.string().trim().min(1, 'Device name is required').max(120),
    platform: z.string().trim().max(40).optional(),
    osVersion: z.string().trim().max(80).optional(),
    appVersion: z.string().trim().max(40).optional(),
    clientType: z.enum(DESKTOP_AGENT_CLIENT_TYPES).optional(),
  })
  .strict();

export type RegisterAgentInput = z.infer<typeof registerAgentSchema>;

export const authenticateAgentSchema = z
  .object({
    agentId: z.string().uuid('Agent ID must be a valid UUID'),
    agentKey: z.string().min(20, 'Agent key is invalid').max(200),
  })
  .strict();

export type AuthenticateAgentInput = z.infer<typeof authenticateAgentSchema>;

export const agentListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  userId: z.string().uuid().optional(),
  status: z.enum(['ACTIVE', 'REVOKED', 'ALL']).default('ACTIVE'),
});
