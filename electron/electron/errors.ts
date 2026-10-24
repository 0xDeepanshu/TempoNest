import type { UserFacingError } from '../src/types/electron'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly requestId: string | null
  readonly details: unknown

  constructor(
    status: number,
    code: string,
    message: string,
    requestId: string | null = null,
    details: unknown = null
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.requestId = requestId
    this.details = details
  }
}

export class NetworkError extends Error {
  constructor(message = 'The TempoNest service could not be reached.', cause?: unknown) {
    super(message, { cause })
    this.name = 'NetworkError'
  }
}

export class SecureStorageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecureStorageError'
  }
}

export class AuthenticationError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'AuthenticationError'
    this.code = code
  }
}

/** Never include a raw response body or credential in a renderer-facing error. */
export function toUserFacingError(error: unknown): UserFacingError {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return {
        code: error.code,
        message:
          error.code === 'INVALID_CREDENTIALS'
            ? 'Those details do not match an active account.'
            : 'Your session has expired. Please sign in again.'
      }
    }
    if (error.status === 403) {
      return {
        code: error.code,
        message:
          error.code === 'AGENT_REVOKED'
            ? 'This device was revoked. Contact your organization administrator.'
            : error.message
      }
    }
    if (error.status === 429) {
      return {
        code: 'RATE_LIMITED',
        message: 'Too many attempts. Please wait a moment and try again.'
      }
    }
    return { code: error.code, message: error.message }
  }

  if (error instanceof AuthenticationError) {
    return { code: error.code, message: error.message }
  }

  if (error instanceof NetworkError) {
    return { code: 'NETWORK_UNAVAILABLE', message: error.message }
  }

  if (error instanceof SecureStorageError) {
    return { code: 'SECURE_STORAGE_UNAVAILABLE', message: error.message }
  }

  return {
    code: 'UNEXPECTED_ERROR',
    message: 'Something went wrong. Please try again.'
  }
}
