import { ZodError } from 'zod';

export type ErrorDetail = {
  path: string;
  message: string;
  code?: string;
};

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: ErrorDetail[];

  constructor(statusCode: number, code: string, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace?.(this, AppError);
  }

  static badRequest(message: string, code = 'BAD_REQUEST', details?: ErrorDetail[]): AppError {
    return new AppError(400, code, message, details);
  }

  static unauthorized(message = 'Authentication required', code = 'UNAUTHENTICATED'): AppError {
    return new AppError(401, code, message);
  }

  static forbidden(message = 'You do not have permission to perform this action', code = 'FORBIDDEN'): AppError {
    return new AppError(403, code, message);
  }

  static notFound(message = 'Resource not found', code = 'NOT_FOUND'): AppError {
    return new AppError(404, code, message);
  }

  static conflict(message: string, code = 'CONFLICT'): AppError {
    return new AppError(409, code, message);
  }

  static gone(message: string, code = 'GONE'): AppError {
    return new AppError(410, code, message);
  }

  static unprocessable(message: string, code = 'VALIDATION_ERROR', details?: ErrorDetail[]): AppError {
    return new AppError(422, code, message, details);
  }

  static tooManyRequests(message = 'Too many requests', code = 'RATE_LIMITED'): AppError {
    return new AppError(429, code, message);
  }

  static internal(message = 'An unexpected error occurred', code = 'INTERNAL_ERROR'): AppError {
    return new AppError(500, code, message);
  }

  static serviceUnavailable(message = 'Service unavailable', code = 'SERVICE_UNAVAILABLE'): AppError {
    return new AppError(503, code, message);
  }
}

export function zodDetails(error: ZodError, transform?: (path: string) => string): ErrorDetail[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.');
    return {
      path: transform ? transform(path) : path,
      message: issue.message,
      code: issue.code,
    };
  });
}
