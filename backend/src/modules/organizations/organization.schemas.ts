import { z } from 'zod';
import { IANAZone } from 'luxon';
import { paginationSchema } from '../../utils/pagination';
import { MEMBERSHIP_STATUSES } from '../memberships/membership.model';
import { ROLES } from '../memberships/roles';

export const organizationIdParamsSchema = z.object({
  organizationId: z.string().uuid('Organization ID must be a valid UUID'),
});

const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => IANAZone.isValidZone(value), 'Must be a valid IANA timezone');

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120),
  timezone: timezoneSchema.optional(),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const updateOrganizationSchema = z
  .object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120).optional(),
    timezone: timezoneSchema.optional(),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.timezone !== undefined, {
    message: 'At least one field must be provided',
  });

export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

export const membershipListQuerySchema = paginationSchema.extend({
  role: z.enum(ROLES).optional(),
  status: z.enum(MEMBERSHIP_STATUSES).optional(),
  q: z.string().trim().min(1).max(120).optional(),
});

export type MembershipListQuery = z.infer<typeof membershipListQuerySchema>;

export const membershipIdParamsSchema = z.object({
  organizationId: z.string().uuid('Organization ID must be a valid UUID'),
  membershipId: z.string().uuid('Membership ID must be a valid UUID'),
});

export const changeRoleSchema = z
  .object({
    role: z.enum(ROLES),
  })
  .strict();

export type ChangeRoleInput = z.infer<typeof changeRoleSchema>;
