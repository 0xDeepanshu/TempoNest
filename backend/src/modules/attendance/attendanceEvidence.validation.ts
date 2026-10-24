import { config } from '../../config/env';
import { AppError } from '../../utils/errors';
import {
  detectScreenshotContentType,
  normalizeContentType,
} from '../screenshots/screenshot.validation';

/** Attendance evidence shares the private-media type and size policy. */
export function isAllowedAttendanceEvidenceContentType(
  value: string | null,
): value is string {
  return Boolean(
    value && (config.screenshots.allowedContentTypes as readonly string[]).includes(value),
  );
}

export function assertAttendanceEvidenceContentType(
  value: string | null,
): asserts value is string {
  if (!isAllowedAttendanceEvidenceContentType(value)) {
    throw new AppError(
      415,
      'UNSUPPORTED_ATTENDANCE_EVIDENCE_TYPE',
      'Attendance photos must be PNG, JPEG, or WebP images',
    );
  }
}

export function assertAttendanceEvidenceSize(sizeBytes: number): void {
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    throw new AppError(
      422,
      'INVALID_ATTENDANCE_EVIDENCE_FILE',
      'The uploaded attendance photo is empty',
    );
  }
  if (sizeBytes > config.screenshots.maxBytes) {
    throw new AppError(
      413,
      'ATTENDANCE_EVIDENCE_TOO_LARGE',
      'The uploaded attendance photo exceeds the size limit',
    );
  }
}

export function validateAttendanceEvidenceFile(input: {
  contentType: string | null;
  expectedContentType: string;
  sizeBytes: number;
  prefix: Buffer;
}): string {
  const contentType = normalizeContentType(input.contentType);
  assertAttendanceEvidenceContentType(contentType);
  if (contentType !== input.expectedContentType) {
    throw new AppError(
      422,
      'ATTENDANCE_EVIDENCE_CONTENT_TYPE_MISMATCH',
      'Uploaded file type does not match the type authorized for this evidence',
    );
  }
  assertAttendanceEvidenceSize(input.sizeBytes);
  const detected = detectScreenshotContentType(input.prefix);
  if (!detected || detected !== contentType) {
    throw new AppError(
      422,
      'INVALID_ATTENDANCE_EVIDENCE_FILE',
      'The uploaded file does not match its declared image type',
    );
  }
  return contentType;
}
