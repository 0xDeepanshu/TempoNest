import { config } from '../../config/env';
import { AppError } from '../../utils/errors';

export const SCREENSHOT_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export function normalizeContentType(value: string | undefined | null): string | null {
  if (!value) return null;
  const normalized = value.split(';')[0]?.trim().toLowerCase();
  return normalized || null;
}

export function isAllowedScreenshotContentType(value: string | null): value is string {
  return Boolean(value && (config.screenshots.allowedContentTypes as readonly string[]).includes(value));
}

/** Detect an image type from the first bytes of the payload. */
export function detectScreenshotContentType(prefix: Buffer): string | null {
  if (
    prefix.length >= 8 &&
    prefix[0] === 0x89 &&
    prefix[1] === 0x50 &&
    prefix[2] === 0x4e &&
    prefix[3] === 0x47 &&
    prefix[4] === 0x0d &&
    prefix[5] === 0x0a &&
    prefix[6] === 0x1a &&
    prefix[7] === 0x0a
  ) {
    return 'image/png';
  }

  if (prefix.length >= 3 && prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff) {
    return 'image/jpeg';
  }

  if (
    prefix.length >= 12 &&
    prefix.toString('ascii', 0, 4) === 'RIFF' &&
    prefix.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }

  return null;
}

export function assertExpectedContentType(
  contentType: string | null,
  expectedContentType: string | null,
): asserts contentType is string {
  if (!isAllowedScreenshotContentType(contentType)) {
    throw new AppError(
      415,
      'UNSUPPORTED_SCREENSHOT_TYPE',
      'Screenshots must be PNG, JPEG, or WebP images',
    );
  }
  if (expectedContentType && contentType !== expectedContentType) {
    throw new AppError(
      422,
      'SCREENSHOT_CONTENT_TYPE_MISMATCH',
      'Uploaded file type does not match the type authorized for this request',
    );
  }
}

export function assertScreenshotSize(sizeBytes: number): void {
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    throw new AppError(422, 'INVALID_SCREENSHOT_FILE', 'The uploaded screenshot is empty');
  }
  if (sizeBytes > config.screenshots.maxBytes) {
    throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'The uploaded screenshot exceeds the size limit');
  }
}

export function assertScreenshotSignature(prefix: Buffer, contentType: string): void {
  const detected = detectScreenshotContentType(prefix);
  if (!detected || detected !== contentType) {
    throw new AppError(
      422,
      'INVALID_SCREENSHOT_FILE',
      'The uploaded file does not match its declared image type',
    );
  }
}

export function validateUploadedScreenshot(input: {
  contentType: string | null;
  expectedContentType: string | null;
  sizeBytes: number;
  prefix: Buffer;
}): string {
  assertExpectedContentType(input.contentType, input.expectedContentType);
  assertScreenshotSize(input.sizeBytes);
  assertScreenshotSignature(input.prefix, input.contentType);
  return input.contentType;
}
