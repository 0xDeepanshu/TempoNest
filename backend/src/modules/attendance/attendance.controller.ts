import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { getClientIp, getUserAgent } from '../../utils/pagination';
import {
  approveAttendanceCorrection,
  createAttendanceCorrection,
  getAttendanceCorrectionForActor,
  listAttendanceCorrections,
  rejectAttendanceCorrection,
} from './attendanceCorrection.service';
import { getAttendanceSummary } from './attendanceSummary.service';
import type {
  ApproveAttendanceCorrectionInput,
  AttendanceCorrectionListQuery,
  AttendanceSummaryQuery,
  CreateAttendanceCorrectionInput,
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
