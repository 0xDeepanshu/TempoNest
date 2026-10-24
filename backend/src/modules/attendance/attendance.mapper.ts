import { secondsBetween } from '../../utils/time';
import type { AttendanceCorrectionRequest as AttendanceCorrectionModel } from './attendanceCorrection.model';
import type { AttendanceEvidence as AttendanceEvidenceModel } from './attendanceEvidence.model';
import type { AttendanceCheckIn as AttendanceCheckInModel } from './attendanceCheckIn.model';

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

/** Storage keys and upload tokens are intentionally never exposed. */
export function toAttendanceEvidenceSummary(evidence: AttendanceEvidenceModel) {
  return {
    id: evidence.id,
    organizationId: evidence.organizationId,
    employeeId: evidence.employeeId,
    desktopAgentId: evidence.desktopAgentId,
    kind: evidence.kind,
    status: evidence.status,
    contentType: evidence.contentType,
    fileSizeBytes: evidence.fileSizeBytes,
    capturedAt: evidence.capturedAt,
    uploadedAt: evidence.uploadedAt,
    expiresAt: evidence.expiresAt,
    attachedSessionId: evidence.attachedSessionId,
    createdAt: evidence.createdAt,
    updatedAt: evidence.updatedAt,
  };
}

export type AttendanceEvidenceSummary = ReturnType<typeof toAttendanceEvidenceSummary>;

export function toAttendanceCheckInSummary(checkIn: AttendanceCheckInModel) {
  return {
    id: checkIn.id,
    organizationId: checkIn.organizationId,
    employeeId: checkIn.employeeId,
    desktopAgentId: checkIn.desktopAgentId,
    sessionId: checkIn.timeSessionId,
    workMode: checkIn.workMode,
    checkInRequestId: checkIn.checkInRequestId,
    location:
      checkIn.latitude !== null &&
      checkIn.longitude !== null &&
      checkIn.accuracyMeters !== null &&
      checkIn.locationRecordedAt !== null
        ? {
            latitude: Number(checkIn.latitude),
            longitude: Number(checkIn.longitude),
            accuracyMeters: Number(checkIn.accuracyMeters),
            recordedAt: checkIn.locationRecordedAt,
          }
        : null,
    selfie: checkIn.selfieEvidence
      ? toAttendanceEvidenceSummary(checkIn.selfieEvidence)
      : null,
    sitePhoto: checkIn.sitePhotoEvidence
      ? toAttendanceEvidenceSummary(checkIn.sitePhotoEvidence)
      : null,
    createdAt: checkIn.createdAt,
    updatedAt: checkIn.updatedAt,
  };
}

export type AttendanceCheckInSummary = ReturnType<typeof toAttendanceCheckInSummary>;
