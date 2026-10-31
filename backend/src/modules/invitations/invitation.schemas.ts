import { z } from 'zod';
import { paginationSchema } from '../../utils/pagination';
import { INVITABLE_ROLES } from '../memberships/roles';
import { emailSchema, nameSchema, passwordSchema } from '../auth/auth.schemas';

export const createInvitationSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    role: z.enum(INVITABLE_ROLES).default('EMPLOYEE'),
    // When set, the invitation grants this organization-defined role. The base
    // role is always forced to EMPLOYEE so a custom role never carries
    // MANAGER/ADMIN hierarchy. Eligibility is validated server-side.
    customRoleId: z.string().uuid('Role ID must be a valid UUID').optional(),
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

/**
 * First-time onboarding. `password` is required only when no account exists for
 * the invited email; existing accounts must authenticate instead.
 */
export const acceptInvitationSchema = z
  .object({
    token: z.string().min(20, 'Invitation token is invalid').max(512),
    password: passwordSchema.optional(),
  })
  .strict();

export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

export const invitationListQuerySchema = paginationSchema.extend({
  status: z.enum(['pending', 'accepted', 'revoked', 'expired', 'all']).default('pending'),
});

export type InvitationListQuery = z.infer<typeof invitationListQuerySchema>;
