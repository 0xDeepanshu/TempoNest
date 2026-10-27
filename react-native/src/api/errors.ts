const SESSION_FAILURE_CODES = new Set([
  'UNAUTHENTICATED',
  'AUTH_TOKEN_INVALID',
  'AUTH_TOKEN_EXPIRED',
  'REFRESH_TOKEN_REQUIRED',
  'REFRESH_TOKEN_INVALID',
  'REFRESH_TOKEN_EXPIRED',
  'REFRESH_TOKEN_REUSED',
  'SESSION_REVOKED',
  'ACCOUNT_DISABLED',
]);

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(options: {
    status: number;
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  }) {
    super(options.message);
    this.name = 'ApiError';
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
    this.requestId = options.requestId;
  }
}

export class NetworkError extends Error {
  readonly timedOut: boolean;

  constructor(timedOut: boolean) {
    super(
      timedOut
        ? 'TempoNest took too long to respond. Please try again.'
        : "Can't reach TempoNest. Check your connection and try again.",
    );
    this.name = 'NetworkError';
    this.timedOut = timedOut;
  }
}

export class SessionExpiredError extends Error {
  constructor(message = 'Your session has ended. Sign in again to continue.') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

export function isSessionFailure(error: unknown): boolean {
  return error instanceof ApiError && SESSION_FAILURE_CODES.has(error.code);
}

export function isSessionExpiredError(error: unknown): boolean {
  return error instanceof SessionExpiredError || isSessionFailure(error);
}

export function isApiErrorCode(error: unknown, ...codes: string[]): boolean {
  return error instanceof ApiError && codes.includes(error.code);
}

export function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof NetworkError) return error.message;
  if (error instanceof SessionExpiredError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong. Please try again.';
}
