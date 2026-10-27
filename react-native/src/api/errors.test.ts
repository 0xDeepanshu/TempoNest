import { describe, expect, it } from 'vitest';

import {
  ApiError,
  NetworkError,
  SessionExpiredError,
  describeError,
  isApiErrorCode,
  isSessionExpiredError,
  isSessionFailure,
} from './errors';

function apiError(status: number, code: string): ApiError {
  return new ApiError({ status, code, message: 'Request failed' });
}

describe('session failure classification', () => {
  it('treats authentication and refresh failures as session failures', () => {
    expect(isSessionFailure(apiError(401, 'UNAUTHENTICATED'))).toBe(true);
    expect(isSessionFailure(apiError(401, 'AUTH_TOKEN_EXPIRED'))).toBe(true);
    expect(isSessionFailure(apiError(401, 'REFRESH_TOKEN_REUSED'))).toBe(true);
    expect(isSessionFailure(apiError(403, 'SESSION_REVOKED'))).toBe(true);
  });

  it('does not treat unrelated errors as session failures', () => {
    expect(isSessionFailure(apiError(409, 'ACTIVE_SESSION_EXISTS'))).toBe(false);
    expect(isSessionFailure(new NetworkError(false))).toBe(false);
    expect(isSessionFailure(new Error('boom'))).toBe(false);
  });

  it('recognises an already cleared session', () => {
    expect(isSessionExpiredError(new SessionExpiredError())).toBe(true);
    expect(isSessionExpiredError(apiError(401, 'AUTH_TOKEN_INVALID'))).toBe(true);
  });
});

describe('error matching', () => {
  it('matches one or more API error codes', () => {
    const error = apiError(409, 'AGENT_REVOKED');
    expect(isApiErrorCode(error, 'AGENT_REVOKED')).toBe(true);
    expect(isApiErrorCode(error, 'AGENT_CREDENTIALS_INVALID', 'AGENT_REVOKED')).toBe(true);
    expect(isApiErrorCode(error, 'AGENT_CLIENT_TYPE_MISMATCH')).toBe(false);
    expect(isApiErrorCode(new Error('AGENT_REVOKED'), 'AGENT_REVOKED')).toBe(false);
  });
});

describe('describeError', () => {
  it('returns safe messages for known errors', () => {
    expect(describeError(apiError(400, 'VALIDATION_ERROR'))).toBe('Request failed');
    expect(describeError(new NetworkError(true))).toContain('took too long');
    expect(describeError(new SessionExpiredError())).toContain('session has ended');
  });

  it('falls back to a generic message', () => {
    expect(describeError(null)).toBe('Something went wrong. Please try again.');
    expect(describeError(new Error())).toBe('Something went wrong. Please try again.');
  });
});
