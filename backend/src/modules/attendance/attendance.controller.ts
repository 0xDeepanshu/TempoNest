import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../utils/errors';
import { getClientIp, getUserAgent } from '../../utils/pagination';
import {
  approveAttendanceCorrection,
  createAttendanceCorrection,
  getAttendanceCorrectionForActor,
  listAttendanceCorrections,
  rejectAttendanceCorrection,
} from './attendanceCorrection.service';
import { getAttendanceSummary } from './attendanceSummary.service';
import {
  checkIn,
  getCurrentAttendance,
  listAttendanceCheckIns,
} from './attendanceCheckIn.service';
import {
  createAttendanceEvidenceAccess,
  createAttendanceEvidenceUpload,
  openAttendanceEvidenceFile,
  reauthorizeAttendanceEvidenceUpload,
  storeAttendanceEvidenceUpload,
} from './attendanceEvidence.service';
import {
  getAttendanceLocationHistory,
  getAttendanceLocationStatus,
  ingestAttendanceLocationSamples,
  reportAttendanceLocationStatus,
} from './attendanceLocation.service';
import {
  assertAttendanceEvidenceContentType,
} from './attendanceEvidence.validation';
import { normalizeContentType } from '../screenshots/screenshot.validation';
import type {
  ApproveAttendanceCorrectionInput,
  AttendanceCheckInInput,
  AttendanceCheckInListQuery,
  AttendanceCorrectionListQuery,
  AttendanceLocationHistoryQuery,
  AttendanceLocationSamplesInput,
  AttendanceLocationStatusInput,
  AttendanceSummaryQuery,
  CreateAttendanceCorrectionInput,
  CreateAttendanceEvidenceInput,
  RejectAttendanceCorrectionInput,
} from './attendance.schemas';

function now(): string {
  return new Date().toISOString();
}

function auditContext(req: Request) {
  return { ipAddress: getClientIp(req), userAgent: getUserAgent(req) };
}

export const summary = asyncHandler(async (req: Request, res: Response) => {
  const result = await getAttendanceSummary({
    organization: req.organization!.organization,
    actorUserId: req.auth!.user.id,
    actorRole: req.organization!.membership.role,
    query: req.query as unknown as AttendanceSummaryQuery,
  });

  res.status(200).json({ data: result, serverTime: now() });
});

export const listCorrections = asyncHandler(async (req: Request, res: Response) => {
  const result = await listAttendanceCorrections({
    organization: req.organization!.organization,
    actorUserId: req.auth!.user.id,
    actorRole: req.organization!.membership.role,
    query: req.query as unknown as AttendanceCorrectionListQuery,
  });

  res.status(200).json({ ...result, serverTime: now() });
});

export const getCorrection = asyncHandler(async (req: Request, res: Response) => {
  const correction = await getAttendanceCorrectionForActor({
    organization: req.organization!.organization,
    correctionId: req.params.correctionId!,
    actorUserId: req.auth!.user.id,
    actorRole: req.organization!.membership.role,
  });

  res.status(200).json({ data: { correction, serverTime: now() } });
});

export const createCorrection = asyncHandler(async (req: Request, res: Response) => {
  const correction = await createAttendanceCorrection({
    organization: req.organization!.organization,
    employeeId: req.auth!.user.id,
    input: req.body as CreateAttendanceCorrectionInput,
    context: auditContext(req),
  });

  res.status(201).json({ data: { correction, serverTime: now() } });
});

export const approveCorrection = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as ApproveAttendanceCorrectionInput;
  const correction = await approveAttendanceCorrection({
    organization: req.organization!.organization,
    correctionId: req.params.correctionId!,
    reviewerUserId: req.auth!.user.id,
    note: input.note,
    context: auditContext(req),
  });

  res.status(200).json({ data: { correction, serverTime: now() } });
});

export const rejectCorrection = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as RejectAttendanceCorrectionInput;
  const correction = await rejectAttendanceCorrection({
    organization: req.organization!.organization,
    correctionId: req.params.correctionId!,
    reviewerUserId: req.auth!.user.id,
    reason: input.reason,
    note: input.note,
    context: auditContext(req),
  });

  res.status(200).json({ data: { correction, serverTime: now() } });
});

export const checkInAttendance = asyncHandler(async (req: Request, res: Response) => {
  const result = await checkIn({
    organizationId: req.organization!.organization.id,
    employeeId: req.auth!.user.id,
    agent: req.desktopAgent!,
    input: req.body as AttendanceCheckInInput,
    context: auditContext(req),
  });

  res.status(result.replayed ? 200 : 201).json({
    data: result,
    serverTime: now(),
  });
});

export const listCheckIns = asyncHandler(async (req: Request, res: Response) => {
  const result = await listAttendanceCheckIns({
    organization: req.organization!.organization,
    query: req.query as unknown as AttendanceCheckInListQuery,
  });

  res.status(200).json({ ...result, serverTime: now() });
});

export const currentCheckIn = asyncHandler(async (req: Request, res: Response) => {
  const result = await getCurrentAttendance({
    organizationId: req.organization!.organization.id,
    employeeId: req.auth!.user.id,
  });

  res.status(200).json({ data: result, serverTime: now() });
});

export const locationStatus = asyncHandler(async (req: Request, res: Response) => {
  const result = await getAttendanceLocationStatus({
    organizationId: req.organization!.organization.id,
    employeeId: req.auth!.user.id,
    agent: req.desktopAgent!,
  });

  res.status(200).json({ data: result, serverTime: now() });
});

export const reportLocationStatus = asyncHandler(async (req: Request, res: Response) => {
  const result = await reportAttendanceLocationStatus({
    organizationId: req.organization!.organization.id,
    employeeId: req.auth!.user.id,
    agent: req.desktopAgent!,
    input: req.body as AttendanceLocationStatusInput,
  });

  res.status(200).json({ data: result, serverTime: now() });
});

export const ingestLocationSamples = asyncHandler(async (req: Request, res: Response) => {
  const result = await ingestAttendanceLocationSamples({
    organizationId: req.organization!.organization.id,
    employeeId: req.auth!.user.id,
    agent: req.desktopAgent!,
    input: req.body as AttendanceLocationSamplesInput,
  });

  res.status(201).json({ data: result, serverTime: now() });
});

export const locationHistory = asyncHandler(async (req: Request, res: Response) => {
  const result = await getAttendanceLocationHistory({
    organization: req.organization!.organization,
    checkInId: req.params.checkInId!,
    actorUserId: req.auth!.user.id,
    actorRole: req.organization!.membership.role,
    query: req.query as unknown as AttendanceLocationHistoryQuery,
    context: auditContext(req),
  });

  res.status(200).json({ data: result, serverTime: now() });
});

export const createEvidence = asyncHandler(async (req: Request, res: Response) => {
  const result = await createAttendanceEvidenceUpload({
    organizationId: req.organization!.organization.id,
    employeeId: req.auth!.user.id,
    agent: req.desktopAgent!,
    input: req.body as CreateAttendanceEvidenceInput,
    context: auditContext(req),
  });

  res.status(201).json({ data: result, serverTime: now() });
});

export const reauthorizeEvidence = asyncHandler(async (req: Request, res: Response) => {
  const result = await reauthorizeAttendanceEvidenceUpload({
    organizationId: req.organization!.organization.id,
    evidenceId: req.params.evidenceId!,
    employeeId: req.auth!.user.id,
    agent: req.desktopAgent!,
  });

  res.status(200).json({ data: result, serverTime: now() });
});

export const uploadEvidence = asyncHandler(async (req: Request, res: Response) => {
  const contentType = normalizeContentType(req.get('content-type'));
  assertAttendanceEvidenceContentType(contentType);
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    throw new AppError(
      422,
      'INVALID_ATTENDANCE_EVIDENCE_FILE',
      'The uploaded attendance photo is empty',
    );
  }

  const evidence = await storeAttendanceEvidenceUpload({
    organizationId: req.organization!.organization.id,
    agent: req.desktopAgent!,
    uploadToken: req.params.token!,
    body: req.body,
    contentType,
    context: auditContext(req),
  });

  res.status(201).json({ data: { evidence }, serverTime: now() });
});

export const accessEvidence = asyncHandler(async (req: Request, res: Response) => {
  const result = await createAttendanceEvidenceAccess({
    organizationId: req.organization!.organization.id,
    evidenceId: req.params.evidenceId!,
    actorUserId: req.auth!.user.id,
    actorRole: req.organization!.membership.role,
    context: auditContext(req),
  });

  res.status(200).json({ data: result, serverTime: now() });
});

export const downloadEvidenceFile = asyncHandler(async (req: Request, res: Response) => {
  const result = await openAttendanceEvidenceFile(req.params.token!, auditContext(req));
  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Content-Length', String(result.sizeBytes));
  res.setHeader('Content-Disposition', 'inline; filename="attendance-evidence"');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  result.stream.on('error', (error) => {
    res.destroy(error);
  });
  result.stream.pipe(res);
});
