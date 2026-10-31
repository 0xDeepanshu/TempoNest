import { z } from 'zod';
import { dateOnlySchema } from '../reporting/reporting.schemas';
import {
  HOLIDAY_CATEGORIES,
  HOLIDAY_DURATIONS,
  MANUAL_HOLIDAY_CATEGORIES,
} from './leaveHoliday.model';

const holidayCategorySchema = z.enum(HOLIDAY_CATEGORIES);
const manualHolidayCategorySchema = z.enum(MANUAL_HOLIDAY_CATEGORIES);
const holidayDurationSchema = z.enum(HOLIDAY_DURATIONS);
const holidayApplicabilitySchema = z.enum(['ORGANIZATION', 'EMPLOYEES']);

const booleanQuery = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();

const employeeIdList = z.array(z.string().uuid()).max(500);
const groupIdList = z.array(z.string().uuid()).max(100);

export const holidayListQuerySchema = z
  .object({
    year: z.coerce.number().int().min(1900).max(2200).optional(),
    from: dateOnlySchema.optional(),
    to: dateOnlySchema.optional(),
    category: holidayCategorySchema.optional(),
    duration: holidayDurationSchema.optional(),
    includeOptional: booleanQuery,
    mine: booleanQuery,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.from && value.to && value.to < value.from) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: 'to must be on or after from',
      });
    }
    if (value.year && (value.from || value.to)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['year'],
        message: 'Use either year or from/to, not both',
      });
    }
  });

export const holidayIdParamsSchema = z.object({
  organizationId: z.string().uuid('Organization ID must be a valid UUID'),
  holidayId: z.string().uuid('Holiday ID must be a valid UUID'),
});

const holidayApplicabilityShape = {
  appliesToAll: z.boolean().default(true),
  applicableEmployeeIds: employeeIdList.default([]),
  departmentIds: groupIdList.default([]),
  locationIds: groupIdList.default([]),
};

function validateApplicability(
  value: {
    appliesToAll: boolean;
    applicableEmployeeIds: string[];
    departmentIds: string[];
    locationIds: string[];
  },
  ctx: z.RefinementCtx,
): void {
  if (!value.appliesToAll && value.applicableEmployeeIds.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['applicableEmployeeIds'],
      message: 'Select at least one employee when the holiday is not organization-wide',
    });
  }
  if (value.appliesToAll && value.applicableEmployeeIds.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['applicableEmployeeIds'],
      message: 'Clear employee selections when the holiday applies to everyone',
    });
  }
}

export const createHolidaySchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    holidayDate: dateOnlySchema,
    category: manualHolidayCategorySchema.default('COMPANY'),
    duration: holidayDurationSchema.default('FULL_DAY'),
    description: z.string().trim().max(2000).nullable().optional(),
    ...holidayApplicabilityShape,
    confirmHistorical: z.boolean().default(false),
  })
  .strict()
  .superRefine(validateApplicability);

export const updateHolidaySchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    holidayDate: dateOnlySchema.optional(),
    category: holidayCategorySchema.optional(),
    duration: holidayDurationSchema.optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    appliesToAll: z.boolean().optional(),
    applicableEmployeeIds: employeeIdList.optional(),
    departmentIds: groupIdList.optional(),
    locationIds: groupIdList.optional(),
    confirmHistorical: z.boolean().default(false),
  })
  .strict()
  .refine(
    (value) =>
      Object.keys(value).some(
        (key) => key !== 'confirmHistorical' && value[key as keyof typeof value] !== undefined,
      ),
    { message: 'At least one field must be provided' },
  );

export const duplicateHolidaySchema = z
  .object({
    holidayDate: dateOnlySchema,
    name: z.string().trim().min(2).max(120).optional(),
    confirmHistorical: z.boolean().default(false),
  })
  .strict();

export const deleteHolidayQuerySchema = z
  .object({
    confirmHistorical: booleanQuery,
  })
  .strict();

export const holidaySettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    optionalHolidaysEnabled: z.boolean().optional(),
    allowHalfDayHolidays: z.boolean().optional(),
    defaultCalendarYear: z.number().int().min(1900).max(2200).nullable().optional(),
    defaultApplicability: holidayApplicabilitySchema.optional(),
    workingDays: z
      .array(z.number().int().min(1).max(7))
      .min(1)
      .max(7)
      .refine((days) => new Set(days).size === days.length, {
        message: 'Working days must not contain duplicates',
      })
      .optional(),
    governmentCountry: z.string().trim().min(2).max(8).optional(),
    governmentRegion: z.string().trim().min(2).max(40).nullable().optional(),
    governmentYear: z.number().int().min(1900).max(2200).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });

const governmentJurisdictionShape = {
  country: z.string().trim().min(2).max(8).default('IN'),
  region: z.string().trim().min(2).max(40).default('NATIONAL'),
};

export const governmentHolidayPreviewQuerySchema = z
  .object({
    ...governmentJurisdictionShape,
    year: z.coerce.number().int().min(1900).max(2200),
  })
  .strict();

export const governmentHolidayImportSchema = z
  .object({
    ...governmentJurisdictionShape,
    year: z.coerce.number().int().min(1900).max(2200),
    sourceIds: z.array(z.string().trim().min(1).max(120)).min(1).max(200),
  })
  .strict();

export const holidayPublicationSchema = z
  .object({
    holidayIds: z.array(z.string().uuid()).min(1).max(300),
    published: z.boolean(),
    confirmHistorical: z.boolean().default(false),
  })
  .strict();

export type HolidayListQuery = z.infer<typeof holidayListQuerySchema>;
export type CreateHolidayInput = z.infer<typeof createHolidaySchema>;
export type UpdateHolidayInput = z.infer<typeof updateHolidaySchema>;
export type DuplicateHolidayInput = z.infer<typeof duplicateHolidaySchema>;
export type DeleteHolidayQuery = z.infer<typeof deleteHolidayQuerySchema>;
export type HolidaySettingsInput = z.infer<typeof holidaySettingsSchema>;
export type GovernmentHolidayPreviewQuery = z.infer<
  typeof governmentHolidayPreviewQuerySchema
>;
export type GovernmentHolidayImportInput = z.infer<typeof governmentHolidayImportSchema>;
export type HolidayPublicationInput = z.infer<typeof holidayPublicationSchema>;
