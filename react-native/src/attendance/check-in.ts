import { ApiError, NetworkError } from '../api/errors';
import type {
  AttendanceCheckInInput,
  AttendanceLocation,
  AttendanceWorkMode,
} from '../api/types';

/** Server defaults documented in backend/docs/API.md. */
export const LOCATION_MAX_ACCURACY_METERS = 500;
export const LOCATION_MAX_AGE_SECONDS = 300;
export const LOCATION_FUTURE_SKEW_SECONDS = 60;
export const PENDING_CHECK_IN_TTL_MS = 15 * 60_000;

export interface PendingCheckIn {
  version: 1;
  requestId: string;
  workMode: AttendanceWorkMode;
  createdAt: string;
  selfieEvidenceId?: string;
  sitePhotoEvidenceId?: string;
  location?: AttendanceLocation;
  evidenceExpiresAt?: string;
}

export type LocationProblem = 'invalid' | 'accuracy' | 'stale' | 'future';

export type LocationCheck =
  | { ok: true }
  | { ok: false; problem: LocationProblem; message: string };

export function isAttendanceLocation(value: unknown): value is AttendanceLocation {
  if (!value || typeof value !== 'object') return false;
  const location = value as Partial<AttendanceLocation>;
  return (
    typeof location.latitude === 'number' &&
    Number.isFinite(location.latitude) &&
    typeof location.longitude === 'number' &&
    Number.isFinite(location.longitude) &&
    typeof location.accuracyMeters === 'number' &&
    Number.isFinite(location.accuracyMeters) &&
    typeof location.recordedAt === 'string' &&
    !Number.isNaN(Date.parse(location.recordedAt))
  );
}

export function checkLocationFix(
  location: AttendanceLocation,
  nowMs: number,
): LocationCheck {
  if (
    !Number.isFinite(location.latitude) ||
    location.latitude < -90 ||
    location.latitude > 90 ||
    !Number.isFinite(location.longitude) ||
    location.longitude < -180 ||
    location.longitude > 180 ||
    !Number.isFinite(location.accuracyMeters) ||
    location.accuracyMeters <= 0
  ) {
    return {
      ok: false,
      problem: 'invalid',
      message: 'The location reading was invalid. Get your location again.',
    };
  }

  if (location.accuracyMeters > LOCATION_MAX_ACCURACY_METERS) {
    return {
      ok: false,
      problem: 'accuracy',
      message: `Location accuracy is about ${Math.round(
        location.accuracyMeters,
      )} m. Move to an open area and try again.`,
    };
  }

  const recordedAt = Date.parse(location.recordedAt);
  if (recordedAt > nowMs + LOCATION_FUTURE_SKEW_SECONDS * 1000) {
    return {
      ok: false,
      problem: 'future',
      message: 'The location timestamp is in the future. Get your location again.',
    };
  }

  if (recordedAt < nowMs - LOCATION_MAX_AGE_SECONDS * 1000) {
    return {
      ok: false,
      problem: 'stale',
      message: 'That location fix is too old. Get your location again.',
    };
  }

  return { ok: true };
}

export interface CheckInRequirements {
  needsSelfie: boolean;
  needsLocation: boolean;
}

/** Evidence and permissions each work mode needs. WFH needs neither. */
export function checkInRequirements(workMode: AttendanceWorkMode): CheckInRequirements {
  return {
    needsSelfie: workMode !== 'WFH',
    needsLocation: workMode === 'ON_SITE',
  };
}

export function isPendingCheckInComplete(pending: PendingCheckIn): boolean {
  const requirements = checkInRequirements(pending.workMode);
  if (requirements.needsSelfie && !pending.selfieEvidenceId) return false;
  if (requirements.needsLocation && !isAttendanceLocation(pending.location)) return false;
  return true;
}

export function isPendingCheckInExpired(
  pending: PendingCheckIn,
  nowMs = Date.now(),
): boolean {
  const createdAt = Date.parse(pending.createdAt);
  if (Number.isNaN(createdAt)) return true;
  if (nowMs - createdAt > PENDING_CHECK_IN_TTL_MS) return true;

  if (pending.evidenceExpiresAt) {
    const expiresAt = Date.parse(pending.evidenceExpiresAt);
    if (Number.isNaN(expiresAt) || expiresAt <= nowMs) return true;
  }

  return false;
}

/**
 * Builds exactly the payload allowed for the mode. WFO never includes a
 * location, and WFH never includes evidence or a location. A site photo is no
 * longer captured, but an older pending record that already has one is replayed
 * unchanged so the original idempotent request stays valid.
 */
export function buildCheckInPayload(
  pending: PendingCheckIn,
): AttendanceCheckInInput | null {
  if (!isPendingCheckInComplete(pending)) return null;

  if (pending.workMode === 'WFH') {
    return { checkInRequestId: pending.requestId, workMode: 'WFH' };
  }

  if (pending.workMode === 'WFO') {
    return {
      checkInRequestId: pending.requestId,
      workMode: 'WFO',
      selfieEvidenceId: pending.selfieEvidenceId,
    };
  }

  return {
    checkInRequestId: pending.requestId,
    workMode: 'ON_SITE',
    selfieEvidenceId: pending.selfieEvidenceId,
    ...(pending.sitePhotoEvidenceId
      ? { sitePhotoEvidenceId: pending.sitePhotoEvidenceId }
      : {}),
    location: pending.location,
  };
}

export type CheckInFailureAction =
  | 'retry'
  | 'restart'
  | 'relocate'
  | 'refresh'
  | 'fatal';

export interface CheckInFailure {
  action: CheckInFailureAction;
  message: string;
}

const RESTART_CODES = new Set([
  'IDEMPOTENCY_KEY_REUSED',
  'ATTENDANCE_EVIDENCE_EXPIRED',
  'ATTENDANCE_EVIDENCE_NOT_FOUND',
  'ATTENDANCE_EVIDENCE_NOT_UPLOADED',
  'ATTENDANCE_EVIDENCE_STORAGE_MISSING',
  'ATTENDANCE_EVIDENCE_STORAGE_MISMATCH',
  'ATTENDANCE_EVIDENCE_KIND_MISMATCH',
  'VALIDATION_ERROR',
  'INVALID_ATTENDANCE_EVIDENCE_FILE',
  'ATTENDANCE_EVIDENCE_TOO_LARGE',
  'WFO_LOCATION_NOT_ALLOWED',
]);

const RELOCATE_CODES = new Set([
  'LOCATION_ACCURACY_TOO_LOW',
  'LOCATION_FIX_TOO_OLD',
  'LOCATION_FIX_IN_FUTURE',
]);

const AGENT_CODES = new Set([
  'AGENT_AUTH_REQUIRED',
  'AGENT_CREDENTIALS_INVALID',
  'AGENT_REVOKED',
  'MOBILE_AGENT_REQUIRED',
]);

export function classifyCheckInFailure(error: unknown): CheckInFailure {
  if (error instanceof NetworkError) {
    return {
      action: 'retry',
      message:
        'The check-in did not reach TempoNest. Your progress is saved; reconnect and try again.',
    };
  }

  if (error instanceof ApiError) {
    if (error.code === 'ACTIVE_SESSION_EXISTS') {
      return {
        action: 'refresh',
        message:
          'You already have an active session. Refresh to see it instead of checking in again.',
      };
    }
    if (error.code === 'ATTENDANCE_EVIDENCE_ALREADY_ATTACHED') {
      return {
        action: 'refresh',
        message: 'This check-in was already recorded. Refreshing your session.',
      };
    }
    if (RELOCATE_CODES.has(error.code)) {
      return { action: 'relocate', message: error.message };
    }
    if (RESTART_CODES.has(error.code)) {
      return { action: 'restart', message: error.message };
    }
    if (AGENT_CODES.has(error.code)) {
      return { action: 'fatal', message: error.message };
    }
    if (error.status >= 500) {
      return {
        action: 'retry',
        message: 'TempoNest could not finish the check-in. Please retry.',
      };
    }
    return { action: 'restart', message: error.message };
  }

  if (error instanceof Error && error.message) {
    return { action: 'fatal', message: error.message };
  }

  return {
    action: 'retry',
    message: 'The check-in could not be completed. Please try again.',
  };
}
