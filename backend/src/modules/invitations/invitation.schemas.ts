import { z } from 'zod';
import { paginationSchema } from '../../utils/pagination';
import { INVITABLE_ROLES } from '../memberships/roles';
import { emailSchema } from '../auth/auth.schemas';

export const createInvitationSchema = z
  .object({
    email: emailSchema,
    role: z.enum(INVITABLE_ROLES).default('EMPLOYEE'),
  })
  .strict();

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

export const invitationIdParamsSchema = z.object({
  organizationId: z.string().uuid('Organization ID must be a valid UUID'),
  invitationId: z.string().uuid('Invitation ID must be a valid UUID'),
});

export const invitationTokenSchema = z
  .object({
    token: z.string().min(20, 'Invitation token is invalid').max(512),
  })
  .strict();

export type InvitationTokenInput = z.infer<typeof invitationTokenSchema>;

export const invitationListQuerySchema = paginationSchema.extend({
  status: z.enum(['pending', 'accepted', 'revoked', 'expired', 'all']).default('pending'),
});

export type InvitationListQuery = z.infer<typeof invitationListQuerySchema>;
