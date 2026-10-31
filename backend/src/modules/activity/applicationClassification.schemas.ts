import { z } from 'zod';
import { paginationSchema } from '../../utils/pagination';
import { APPLICATION_PRODUCTIVITY_CATEGORIES } from './applicationClassification.model';

export const classificationIdParamsSchema = z.object({
  organizationId: z.string().uuid('Organization ID must be a valid UUID'),
  classificationId: z.string().uuid('Classification ID must be a valid UUID'),
});

const includeObserved = z
  .enum(['true', 'false'])
  .default('true')
  .transform((value) => value === 'true');

export const classificationListQuerySchema = paginationSchema.extend({
  category: z.enum(APPLICATION_PRODUCTIVITY_CATEGORIES).optional(),
  q: z.string().trim().min(1).max(120).optional(),
  includeObserved,
});

export type ClassificationListQuery = z.infer<typeof classificationListQuerySchema>;

const identifier = z.string().trim().min(1).max(200);
const applicationName = z.string().trim().min(1).max(255);
const notes = z.string().trim().max(1000).nullable().optional();

export const createClassificationSchema = z
  .object({
    applicationIdentifier: identifier,
    applicationName: applicationName.optional(),
    category: z.enum(APPLICATION_PRODUCTIVITY_CATEGORIES).default('UNCLASSIFIED'),
    notes,
  })
  .strict();

export type CreateClassificationInput = z.infer<typeof createClassificationSchema>;

export const updateClassificationSchema = z
  .object({
    applicationName: applicationName.optional(),
    category: z.enum(APPLICATION_PRODUCTIVITY_CATEGORIES).optional(),
    notes,
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateClassificationInput = z.infer<typeof updateClassificationSchema>;
