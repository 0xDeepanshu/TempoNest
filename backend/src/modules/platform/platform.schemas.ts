import { z } from 'zod';
import { paginationSchema } from '../../utils/pagination';
import { PLATFORM_AUDIT_ACTIONS } from './platformAuditEvent.model';

export const platformOrganizationIdParamsSchema = z.object({
  organizationId: z.string().uuid('Organization ID must be a valid UUID'),
});

export const PLATFORM_ORGANIZATION_FILTERS = ['ALL', 'ACTIVE', 'SUSPENDED', 'DELETED'] as const;
export type PlatformOrganizationFilter = (typeof PLATFORM_ORGANIZATION_FILTERS)[number];

export const platformOrganizationListQuerySchema = paginationSchema.extend({
  status: z.enum(PLATFORM_ORGANIZATION_FILTERS).default('ALL'),
  q: z.string().trim().min(1).max(120).optional(),
});

export type PlatformOrganizationListQuery = z.infer<typeof platformOrganizationListQuerySchema>;

export const platformRenameOrganizationSchema = z
  .object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120),
  })
  .strict();

export type PlatformRenameOrganizationInput = z.infer<typeof platformRenameOrganizationSchema>;

export const platformDeleteOrganizationSchema = z
  .object({
    confirmationName: z.string().trim().min(1, 'Type the organization name to confirm').max(120),
    password: z.string().min(1, 'Password confirmation is required').max(256),
  })
  .strict();

export type PlatformDeleteOrganizationInput = z.infer<typeof platformDeleteOrganizationSchema>;

export const platformAuditListQuerySchema = paginationSchema.extend({
  organizationId: z.string().uuid('Organization ID must be a valid UUID').optional(),
  action: z.enum(PLATFORM_AUDIT_ACTIONS).optional(),
});

export type PlatformAuditListQuery = z.infer<typeof platformAuditListQuerySchema>;
