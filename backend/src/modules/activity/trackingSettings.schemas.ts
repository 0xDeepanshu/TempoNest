import { z } from 'zod';
import {
  ACTIVITY_RETENTION_DAYS_MAX,
  ACTIVITY_RETENTION_DAYS_MIN,
  IDLE_THRESHOLD_MINUTES_MAX,
  IDLE_THRESHOLD_MINUTES_MIN,
} from './trackingSettings.model';

export const updateTrackingSettingsSchema = z
  .object({
    appTrackingEnabled: z.boolean().optional(),
    idleDetectionEnabled: z.boolean().optional(),
    idleThresholdMinutes: z
      .number()
      .int()
      .min(IDLE_THRESHOLD_MINUTES_MIN)
      .max(IDLE_THRESHOLD_MINUTES_MAX)
      .optional(),
    productivityClassificationEnabled: z.boolean().optional(),
    activityRetentionDays: z
      .number()
      .int()
      .min(ACTIVITY_RETENTION_DAYS_MIN)
      .max(ACTIVITY_RETENTION_DAYS_MAX)
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateTrackingSettingsInput = z.infer<typeof updateTrackingSettingsSchema>;
