import { describe, expect, it } from 'vitest';

import { ApiError, NetworkError } from '../api/errors';
import type { AttendanceLocation } from '../api/types';
import {
  PENDING_CHECK_IN_TTL_MS,
  buildCheckInPayload,
  checkInRequirements,
  checkLocationFix,
  classifyCheckInFailure,
  isAttendanceLocation,
  isPendingCheckInComplete,
  isPendingCheckInExpired,
  type PendingCheckIn,
} from './check-in';

const NOW = Date.parse('2026-10-24T10:00:00.000Z');
const REQUEST_ID = '4d3f3f2a-5d1b-4c2e-9f3a-1a2b3c4d5e6f';

const LOCATION: AttendanceLocation = {
  latitude: 12.9716,
  longitude: 77.5946,
  accuracyMeters: 18,
  recordedAt: '2026-10-24T09:59:00.000Z',
};

function pending(overrides: Partial<PendingCheckIn> = {}): PendingCheckIn {
  return {
    version: 1,
    requestId: REQUEST_ID,
    workMode: 'WFO',
    createdAt: '2026-10-24T09:55:00.000Z',
    selfieEvidenceId: 'selfie-1',
    ...overrides,
  };
}

function apiError(status: number, code: string): ApiError {
  return new ApiError({ status, code, message: `Server said ${code}` });
}

describe('buildCheckInPayload', () => {
  it('sends only the request id for WFH', () => {
    const payload = buildCheckInPayload(
      pending({ workMode: 'WFH', selfieEvidenceId: undefined }),
    );

    expect(payload).toEqual({ checkInRequestId: REQUEST_ID, workMode: 'WFH' });
  });

  it('sends the selfie and never a location for WFO', () => {
    const payload = buildCheckInPayload(
      pending({ location: LOCATION, sitePhotoEvidenceId: 'site-1' }),
    );

    expect(payload).toEqual({
      checkInRequestId: REQUEST_ID,
      workMode: 'WFO',
      selfieEvidenceId: 'selfie-1',
    });
    expect(payload && 'location' in payload).toBe(false);
    expect(payload && 'sitePhotoEvidenceId' in payload).toBe(false);
  });

  it('sends only the selfie and location for ON_SITE', () => {
    const payload = buildCheckInPayload(
      pending({
        workMode: 'ON_SITE',
        selfieEvidenceId: 'selfie-2',
        location: LOCATION,
      }),
    );

    expect(payload).toEqual({
      checkInRequestId: REQUEST_ID,
      workMode: 'ON_SITE',
      selfieEvidenceId: 'selfie-2',
      location: LOCATION,
    });
    expect(payload && 'sitePhotoEvidenceId' in payload).toBe(false);
  });

  it('replays a site photo kept on an older pending ON_SITE record', () => {
    const payload = buildCheckInPayload(
      pending({
        workMode: 'ON_SITE',
        selfieEvidenceId: 'selfie-2',
        sitePhotoEvidenceId: 'site-2',
        location: LOCATION,
      }),
    );

    expect(payload).toEqual({
      checkInRequestId: REQUEST_ID,
      workMode: 'ON_SITE',
      selfieEvidenceId: 'selfie-2',
      sitePhotoEvidenceId: 'site-2',
      location: LOCATION,
    });
  });

  it('refuses to build an incomplete payload', () => {
    expect(
      buildCheckInPayload(
        pending({
          workMode: 'ON_SITE',
          selfieEvidenceId: undefined,
          location: LOCATION,
        }),
      ),
    ).toBeNull();
    expect(
      buildCheckInPayload(
        pending({
          workMode: 'ON_SITE',
          selfieEvidenceId: 'selfie-2',
          location: undefined,
        }),
      ),
    ).toBeNull();
    expect(
      buildCheckInPayload(pending({ selfieEvidenceId: undefined })),
    ).toBeNull();
  });
});

describe('checkInRequirements', () => {
  it('needs a selfie but no location for WFO', () => {
    expect(checkInRequirements('WFO')).toEqual({
      needsSelfie: true,
      needsLocation: false,
    });
  });

  it('needs neither evidence nor location for WFH', () => {
    expect(checkInRequirements('WFH')).toEqual({
      needsSelfie: false,
      needsLocation: false,
    });
  });

  it('needs a selfie and a location for ON_SITE', () => {
    expect(checkInRequirements('ON_SITE')).toEqual({
      needsSelfie: true,
      needsLocation: true,
    });
  });
});

describe('isPendingCheckInComplete', () => {
  it('treats WFH as complete without evidence', () => {
    expect(
      isPendingCheckInComplete(
        pending({ workMode: 'WFH', selfieEvidenceId: undefined }),
      ),
    ).toBe(true);
  });

  it('requires a selfie and a location for ON_SITE', () => {
    const base = pending({ workMode: 'ON_SITE' });

    expect(isPendingCheckInComplete(base)).toBe(false);
    expect(isPendingCheckInComplete({ ...base, location: LOCATION })).toBe(true);
    expect(
      isPendingCheckInComplete({ ...base, selfieEvidenceId: undefined, location: LOCATION }),
    ).toBe(false);
    expect(
      isPendingCheckInComplete({ ...base, sitePhotoEvidenceId: 'site-1' }),
    ).toBe(false);
  });
});

describe('checkLocationFix', () => {
  it('accepts a recent, accurate fix', () => {
    expect(checkLocationFix(LOCATION, NOW)).toEqual({ ok: true });
  });

  it('rejects an imprecise fix', () => {
    const result = checkLocationFix({ ...LOCATION, accuracyMeters: 501 }, NOW);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problem).toBe('accuracy');
  });

  it('rejects a stale fix', () => {
    const result = checkLocationFix(
      { ...LOCATION, recordedAt: '2026-10-24T09:54:59.000Z' },
      NOW,
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problem).toBe('stale');
  });

  it('rejects a fix too far in the future', () => {
    const result = checkLocationFix(
      { ...LOCATION, recordedAt: '2026-10-24T10:01:01.000Z' },
      NOW,
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problem).toBe('future');
  });

  it('rejects invalid coordinates and accuracy', () => {
    expect(checkLocationFix({ ...LOCATION, latitude: 91 }, NOW).ok).toBe(false);
    expect(checkLocationFix({ ...LOCATION, longitude: -181 }, NOW).ok).toBe(false);
    expect(checkLocationFix({ ...LOCATION, accuracyMeters: 0 }, NOW).ok).toBe(false);
    expect(checkLocationFix({ ...LOCATION, latitude: Number.NaN }, NOW).ok).toBe(
      false,
    );
  });
});

describe('isAttendanceLocation', () => {
  it('validates the persisted location shape', () => {
    expect(isAttendanceLocation(LOCATION)).toBe(true);
    expect(isAttendanceLocation({ ...LOCATION, recordedAt: 'not-a-date' })).toBe(
      false,
    );
    expect(isAttendanceLocation({ ...LOCATION, accuracyMeters: '18' })).toBe(
      false,
    );
  });
});

describe('isPendingCheckInExpired', () => {
  it('keeps a fresh check-in', () => {
    expect(isPendingCheckInExpired(pending(), NOW)).toBe(false);
  });

  it('expires after the pending TTL', () => {
    const created = new Date(NOW - PENDING_CHECK_IN_TTL_MS - 1).toISOString();
    expect(
      isPendingCheckInExpired(pending({ createdAt: created }), NOW),
    ).toBe(true);
  });

  it('expires when the uploaded evidence has expired', () => {
    expect(
      isPendingCheckInExpired(
        pending({ evidenceExpiresAt: '2026-10-24T09:59:59.000Z' }),
        NOW,
      ),
    ).toBe(true);
    expect(
      isPendingCheckInExpired(
        pending({ evidenceExpiresAt: '2026-10-24T10:10:00.000Z' }),
        NOW,
      ),
    ).toBe(false);
  });

  it('expires an unreadable creation time', () => {
    expect(
      isPendingCheckInExpired(pending({ createdAt: 'yesterday' }), NOW),
    ).toBe(true);
  });
});

describe('classifyCheckInFailure', () => {
  it('retries transport errors without discarding progress', () => {
    expect(classifyCheckInFailure(new NetworkError(false)).action).toBe('retry');
    expect(classifyCheckInFailure(new NetworkError(true)).action).toBe('retry');
  });

  it('refreshes when a session already exists', () => {
    expect(
      classifyCheckInFailure(apiError(409, 'ACTIVE_SESSION_EXISTS')).action,
    ).toBe('refresh');
    expect(
      classifyCheckInFailure(apiError(409, 'ATTENDANCE_EVIDENCE_ALREADY_ATTACHED'))
        .action,
    ).toBe('refresh');
  });

  it('asks for a new location fix on location validation errors', () => {
    expect(
      classifyCheckInFailure(apiError(422, 'LOCATION_ACCURACY_TOO_LOW')).action,
    ).toBe('relocate');
    expect(classifyCheckInFailure(apiError(422, 'LOCATION_FIX_TOO_OLD')).action).toBe(
      'relocate',
    );
  });

  it('restarts when the pending evidence or request id is no longer usable', () => {
    expect(
      classifyCheckInFailure(apiError(409, 'IDEMPOTENCY_KEY_REUSED')).action,
    ).toBe('restart');
    expect(
      classifyCheckInFailure(apiError(410, 'ATTENDANCE_EVIDENCE_EXPIRED')).action,
    ).toBe('restart');
    expect(classifyCheckInFailure(apiError(422, 'VALIDATION_ERROR')).action).toBe(
      'restart',
    );
  });

  it('stops on device credential failures', () => {
    expect(classifyCheckInFailure(apiError(403, 'AGENT_REVOKED')).action).toBe(
      'fatal',
    );
    expect(
      classifyCheckInFailure(apiError(403, 'MOBILE_AGENT_REQUIRED')).action,
    ).toBe('fatal');
  });

  it('retries server failures and restarts on other client errors', () => {
    expect(classifyCheckInFailure(apiError(503, 'INTERNAL_ERROR')).action).toBe(
      'retry',
    );
    expect(classifyCheckInFailure(apiError(400, 'BAD_REQUEST')).action).toBe(
      'restart',
    );
  });
});
