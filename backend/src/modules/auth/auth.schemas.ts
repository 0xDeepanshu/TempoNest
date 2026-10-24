import { z } from 'zod';
import { normalizeEmail } from '../../utils/email';

export const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .email('Enter a valid email address')
  .transform(normalizeEmail);

export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128, 'Password must be at most 128 characters');

export const nameSchema = z.string().trim().min(2, 'Name must be at least 2 characters').max(120);

export const registerSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(128),
  client: z.enum(['browser', 'desktop']).default('browser'),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(20).max(512).optional(),
  client: z.enum(['browser', 'desktop']).optional(),
});

export type RefreshInput = z.infer<typeof refreshSchema>;

export const logoutSchema = z.object({
  refreshToken: z.string().min(20).max(512).optional(),
});

export const sessionIdParamsSchema = z.object({
  sessionId: z.string().uuid('Session ID must be a valid UUID'),
});
