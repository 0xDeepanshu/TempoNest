import { z } from 'zod';
import { paginationSchema } from '../../utils/pagination';
import { ROLES } from '../memberships/roles';
import { SCREENSHOT_AUDIT_ACTIONS } from './auditEvent.model';
import { SCREENSHOT_REQUEST_STATUSES } from './screenshotRequest.model';

export const employeeIdParamsSchema = z.object({
  employeeId: z.string().uuid('Employee ID must be a valid UUID'),
});

export const screenshotRequestIdParamsSchema = z.object({
  requestId: z.string().uuid('Screenshot request ID must be a valid UUID'),
});

export const screenshotIdParamsSchema = z.object({
  screenshotId: z.string().uuid('Screenshot ID must be a valid UUID'),
});

export const screenshotUploadTokenParamsSchema = z.object({
  token: z
    .string()
    .min(20)
    .max(200)
    .regex(/^[A-Za-z0-9_-]+$/, 'Invalid upload token'),
});

export const screenshotFileTokenParamsSchema = z.object({
  token: z.string().min(20).max(2048),
});

export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(160)
  .regex(/^[A-Za-z0-9._:-]+$/, 'Invalid Idempotency-Key header');

export const screenshotRequestListQuerySchema = paginationSchema.extend({
  status: z.enum(SCREENSHOT_REQUEST_STATUSES).optional(),
});

export const organizationScreenshotRequestListQuerySchema = screenshotRequestListQuerySchema.extend({
  employeeId: z.string().uuid().optional(),
});

export const screenshotListQuerySchema = paginationSchema.extend({
  employeeId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

export const screenshotAuditQuerySchema = paginationSchema.extend({
  employeeId: z.string().uuid().optional(),
  requestId: z.string().uuid().optional(),
  action: z.enum(SCREENSHOT_AUDIT_ACTIONS).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

export const screenshotClaimSchema = z
  .object({
    contentType: z.enum(['image/png', 'image/jpeg', 'image/webp']).optional(),
  })
  .strict()
  .default({});

export const screenshotUploadAuthorizationSchema = z
  .object({
    contentType: z.enum(['image/png', 'image/jpeg', 'image/webp']).optional(),
  })
  .strict()
  .default({});

export const screenshotCompleteSchema = z
  .object({
    captureTimestamp: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .default({});

export const screenshotFailSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9_]+$/, 'Use A-Z, 0-9, and underscores'),
    message: z.string().trim().max(500).optional(),
  })
  .strict();

const policyRoleSchema = z.enum(ROLES);

export const screenshotPolicyUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    requestRoles: z.array(policyRoleSchema).min(1).max(4).optional(),
    viewRoles: z.array(policyRoleSchema).min(1).max(4).optional(),
    requestCooldownSeconds: z.number().int().min(0).max(3600).optional(),
    retentionDays: z.number().int().min(1).max(3650).optional(),
    auditRetentionDays: z.number().int().min(1).max(3650).optional(),
    employeeAcknowledgementRequired: z.boolean().optional(),
    disclosureVersion: z.string().trim().min(1).max(64).optional(),
    disclosureText: z.string().trim().min(1).max(8000).optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: 'At least one policy field must be provided',
  });

export type ScreenshotClaimInput = z.infer<typeof screenshotClaimSchema>;
export type ScreenshotCompleteInput = z.infer<typeof screenshotCompleteSchema>;
export type ScreenshotFailInput = z.infer<typeof screenshotFailSchema>;
export type ScreenshotListQuery = z.infer<typeof screenshotListQuerySchema>;
export type ScreenshotAuditQuery = z.infer<typeof screenshotAuditQuerySchema>;
export type ScreenshotRequestListQuery = z.infer<typeof screenshotRequestListQuerySchema>;
export type OrganizationScreenshotRequestListQuery = z.infer<
  typeof organizationScreenshotRequestListQuerySchema
>;
export type ScreenshotPolicyUpdate = z.infer<typeof screenshotPolicyUpdateSchema>;
