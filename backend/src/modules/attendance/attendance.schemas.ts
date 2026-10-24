import { z } from 'zod';
import { DateTime } from 'luxon';
import { paginationSchema } from '../../utils/pagination';
import { dateOnlySchema, dateRangeSchema } from '../reporting/reporting.schemas';
import { CORRECTION_STATUSES } from './attendanceCorrection.model';
import { ATTENDANCE_EVIDENCE_KINDS } from './attendanceEvidence.model';
import { ATTENDANCE_WORK_MODES } from './attendanceCheckIn.model';

export const ATTENDANCE_SUMMARY_PERIODS = ['daily', 'weekly', 'monthly'] as const;
export type AttendanceSummaryPeriod = (typeof ATTENDANCE_SUMMARY_PERIODS)[number];

const timestamp = z.string().datetime({
  offset: true,
  message: 'Timestamps must be ISO-8601 with an offset',
});

const requestedBreakSchema = z
  .object({
    startedAt: timestamp,
    endedAt: timestamp,
  })
  .strict();

export const attendanceSummaryQuerySchema = dateRangeSchema(366).and(
  z.object({
    employeeId: z.string().uuid().optional(),
    period: z.enum(ATTENDANCE_SUMMARY_PERIODS).default('daily'),
  }),
);

export const attendanceCorrectionIdParamsSchema = z.object({
  organizationId: z.string().uuid('Organization ID must be a valid UUID'),
  correctionId: z.string().uuid('Correction ID must be a valid UUID'),
});

export const attendanceCorrectionListQuerySchema = paginationSchema
  .extend({
    employeeId: z.string().uuid().optional(),
    status: z.enum(CORRECTION_STATUSES).optional(),
    from: dateOnlySchema.optional(),
    to: dateOnlySchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.from || !value.to) return;
    const start = DateTime.fromISO(value.from, { zone: 'utc' }).startOf('day');
    const end = DateTime.fromISO(value.to, { zone: 'utc' }).startOf('day');
    if (end < start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: 'to must be on or after from',
      });
    }
  });

export const createAttendanceCorrectionSchema = z
  .object({
    sessionId: z.string().uuid().optional(),
    workDate: dateOnlySchema,
    startedAt: timestamp,
    endedAt: timestamp,
    breaks: z.array(requestedBreakSchema).max(100).default([]),
    reason: z.string().trim().min(3).max(2000),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (Date.parse(value.endedAt) <= Date.parse(value.startedAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endedAt'],
        message: 'endedAt must be after startedAt',
      });
    }
  });

export const approveAttendanceCorrectionSchema = z
  .object({
    note: z.string().trim().max(2000).optional(),
  })
  .strict()
  .default({});

export const rejectAttendanceCorrectionSchema = z
  .object({
    reason: z.string().trim().min(3).max(2000),
    note: z.string().trim().max(2000).optional(),
  })
  .strict();

export const attendanceEvidenceIdParamsSchema = z.object({
  organizationId: z.string().uuid('Organization ID must be a valid UUID'),
  evidenceId: z.string().uuid('Evidence ID must be a valid UUID'),
});

export const attendanceEvidenceUploadTokenParamsSchema = z.object({
  token: z
    .string()
    .min(16)
    .max(200)
    .regex(/^[A-Za-z0-9_-]+$/, 'Invalid attendance upload token'),
});

export const attendanceEvidenceFileTokenParamsSchema = z.object({
  token: z.string().min(20).max(2048),
});

export const createAttendanceEvidenceSchema = z
  .object({
    kind: z.enum(ATTENDANCE_EVIDENCE_KINDS),
    contentType: z.string().trim().min(3).max(64),
    capturedAt: timestamp.optional(),
  })
  .strict();

export const attendanceLocationSchema = z
  .object({
    latitude: z.number().finite().min(-90, 'latitude must be between -90 and 90').max(90),
    longitude: z.number().finite().min(-180, 'longitude must be between -180 and 180').max(180),
    accuracyMeters: z.number().finite().positive().max(100_000),
    recordedAt: timestamp,
  })
  .strict();

export const attendanceCheckInSchema = z
  .object({
    checkInRequestId: z.string().uuid('checkInRequestId must be a client-generated UUID'),
    workMode: z.enum(ATTENDANCE_WORK_MODES),
    location: attendanceLocationSchema.optional(),
    selfieEvidenceId: z.string().uuid().optional(),
    sitePhotoEvidenceId: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const addIssue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });

    if (value.workMode === 'WFH') {
      if (value.selfieEvidenceId) addIssue(['selfieEvidenceId'], 'WFH does not accept a selfie');
      if (value.sitePhotoEvidenceId) {
        addIssue(['sitePhotoEvidenceId'], 'WFH does not accept a site photo');
      }
      return;
    }

    if (value.workMode === 'WFO') {
      if (!value.selfieEvidenceId) addIssue(['selfieEvidenceId'], 'WFO check-in requires a selfie');
      if (value.sitePhotoEvidenceId) {
        addIssue(['sitePhotoEvidenceId'], 'WFO check-in does not accept a site photo');
      }
      if (value.location) {
        addIssue(['location'], 'WFO check-in does not accept a location');
      }
      return;
    }

    if (!value.location) addIssue(['location'], 'ON_SITE check-in requires a location');

    if (!value.selfieEvidenceId) {
      addIssue(['selfieEvidenceId'], 'ON_SITE check-in requires a selfie');
    }
    if (!value.sitePhotoEvidenceId) {
      addIssue(['sitePhotoEvidenceId'], 'ON_SITE check-in requires a site photo');
    }
    if (
      value.selfieEvidenceId &&
      value.sitePhotoEvidenceId &&
      value.selfieEvidenceId === value.sitePhotoEvidenceId
    ) {
      addIssue(
        ['sitePhotoEvidenceId'],
        'The site photo must be a different upload from the selfie',
      );
    }
  });

export type AttendanceSummaryQuery = z.infer<typeof attendanceSummaryQuerySchema>;
export type AttendanceCorrectionListQuery = z.infer<typeof attendanceCorrectionListQuerySchema>;
export type CreateAttendanceCorrectionInput = z.infer<typeof createAttendanceCorrectionSchema>;
export type ApproveAttendanceCorrectionInput = z.infer<typeof approveAttendanceCorrectionSchema>;
export type RejectAttendanceCorrectionInput = z.infer<typeof rejectAttendanceCorrectionSchema>;
export type CreateAttendanceEvidenceInput = z.infer<typeof createAttendanceEvidenceSchema>;
export type AttendanceLocationInput = z.infer<typeof attendanceLocationSchema>;
export type AttendanceCheckInInput = z.infer<typeof attendanceCheckInSchema>;
