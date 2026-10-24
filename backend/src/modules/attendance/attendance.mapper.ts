import { secondsBetween } from '../../utils/time';
import type { AttendanceCorrectionRequest as AttendanceCorrectionModel } from './attendanceCorrection.model';

export function toAttendanceCorrectionSummary(correction: AttendanceCorrectionModel) {
  const requestedBreaks = [...(correction.requestedBreaks ?? [])]
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
    .map((brk) => ({
      startedAt: brk.startedAt,
      endedAt: brk.endedAt,
      durationSeconds: secondsBetween(new Date(brk.startedAt), new Date(brk.endedAt)),
    }));

  return {
    id: correction.id,
    organizationId: correction.organizationId,
    employeeId: correction.employeeId,
    timeSessionId: correction.timeSessionId,
    requestType: correction.requestType,
    workDate: correction.workDate,
    requestedStartedAt: correction.requestedStartedAt,
    requestedEndedAt: correction.requestedEndedAt,
    requestedBreaks,
    requestedBreakSeconds: requestedBreaks.reduce(
      (sum, brk) => sum + brk.durationSeconds,
      0,
    ),
    reason: correction.reason,
    status: correction.status,
    original: correction.originalSnapshot,
    applied: correction.appliedSnapshot,
    resultingSessionId: correction.resultingSessionId,
    reviewedByUserId: correction.reviewedByUserId,
    reviewedAt: correction.reviewedAt,
    reviewerNote: correction.reviewerNote,
    rejectionReason: correction.rejectionReason,
    ...(correction.employee
      ? {
          employee: {
            id: correction.employee.id,
            name: correction.employee.name,
            email: correction.employee.email,
          },
        }
      : {}),
    ...(correction.reviewer
      ? {
          reviewer: {
            id: correction.reviewer.id,
            name: correction.reviewer.name,
            email: correction.reviewer.email,
          },
        }
      : {}),
    createdAt: correction.createdAt,
    updatedAt: correction.updatedAt,
  };
}

export type AttendanceCorrectionSummary = ReturnType<typeof toAttendanceCorrectionSummary>;
