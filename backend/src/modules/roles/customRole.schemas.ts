import { z } from 'zod';
import { paginationSchema } from '../../utils/pagination';
import {
  DATA_SCOPES,
  PERMISSIONS,
  isGrantablePermission,
  isManagerOverridePermission,
  type Permission,
} from '../memberships/permissions';

const permissionSchema = z.string().superRefine((value, ctx) => {
  if (!(PERMISSIONS as readonly string[]).includes(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Unknown permission "${value}"`,
    });
    return;
  }
  if (!isGrantablePermission(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `"${value}" is administrator-only and cannot be granted to a custom role`,
    });
  }
});

const permissionsSchema = z
  .array(permissionSchema)
  .min(1, 'Select at least one permission')
  .max(PERMISSIONS.length)
  .transform((values) => [...new Set(values)] as Permission[]);

const managerPermissionSchema = z.string().superRefine((value, ctx) => {
  if (!(PERMISSIONS as readonly string[]).includes(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Unknown permission "${value}"`,
    });
    return;
  }
  if (!isManagerOverridePermission(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `"${value}" is administrator-only and cannot be granted to the Manager role`,
    });
  }
});

const managerPermissionsSchema = z
  .array(managerPermissionSchema)
  .min(1, 'Select at least one permission')
  .max(PERMISSIONS.length)
  .transform((values) => [...new Set(values)] as Permission[]);

const nameSchema = z
  .string()
  .trim()
  .min(2, 'Role name must be at least 2 characters')
  .max(80, 'Role name must be 80 characters or fewer');

const descriptionSchema = z
  .string()
  .trim()
  .max(500, 'Description must be 500 characters or fewer')
  .nullable();

export const roleIdParamsSchema = z.object({
  organizationId: z.string().uuid('Organization ID must be a valid UUID'),
  roleId: z.string().uuid('Role ID must be a valid UUID'),
});

export const createCustomRoleSchema = z
  .object({
    name: nameSchema,
    description: descriptionSchema.optional(),
    permissions: permissionsSchema,
    dataScope: z.enum(DATA_SCOPES).default('SELF'),
    onboardingEligible: z.boolean().default(false),
  })
  .strict();

export type CreateCustomRoleInput = z.infer<typeof createCustomRoleSchema>;

export const updateCustomRoleSchema = z
  .object({
    name: nameSchema.optional(),
    description: descriptionSchema.optional(),
    permissions: permissionsSchema.optional(),
    dataScope: z.enum(DATA_SCOPES).optional(),
    onboardingEligible: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.description !== undefined ||
      value.permissions !== undefined ||
      value.dataScope !== undefined ||
      value.onboardingEligible !== undefined,
    { message: 'At least one field must be provided' },
  );

export type UpdateCustomRoleInput = z.infer<typeof updateCustomRoleSchema>;

export const updateManagerRoleSchema = z
  .object({
    description: descriptionSchema.optional(),
    permissions: managerPermissionsSchema.optional(),
    dataScope: z.enum(DATA_SCOPES).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.description !== undefined ||
      value.permissions !== undefined ||
      value.dataScope !== undefined,
    { message: 'At least one field must be provided' },
  );

export type UpdateManagerRoleInput = z.infer<typeof updateManagerRoleSchema>;

export const roleUsersQuerySchema = paginationSchema;

export type RoleUsersQuery = z.infer<typeof roleUsersQuerySchema>;
