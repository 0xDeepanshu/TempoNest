import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { ForeignKeyConstraintError, UniqueConstraintError, ValidationError } from 'sequelize';
import { logger } from '../config/logger';
import { AppError, zodDetails } from '../utils/errors';

function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  if (error instanceof ZodError) {
    return AppError.unprocessable('Request validation failed', 'VALIDATION_ERROR', zodDetails(error));
  }

  if (error instanceof UniqueConstraintError) {
    return AppError.conflict('A resource with these values already exists', 'CONFLICT');
  }

  if (error instanceof ForeignKeyConstraintError) {
    return AppError.conflict('The request conflicts with related data', 'CONFLICT');
  }

  if (error instanceof ValidationError) {
    return AppError.unprocessable(
      'Request validation failed',
      'VALIDATION_ERROR',
      error.errors.map((item) => ({
        path: item.path ?? '',
        message: item.message,
        code: item.type ?? undefined,
      })),
    );
  }

  if (error instanceof SyntaxError && 'body' in error) {
    return AppError.badRequest('Request body is not valid JSON', 'INVALID_JSON');
  }

  const maybeHttpError = error as { type?: string; status?: number; statusCode?: number };
  if (maybeHttpError?.type === 'entity.too.large') {
    return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  }

  return AppError.internal();
}

export function errorHandler(error: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  const appError = normalizeError(error);
  const path = req.path
    .replace(/(\/screenshot-files\/)[^/]+/, '$1[redacted]')
    .replace(/(\/agent\/screenshot-uploads\/)[^/]+/, '$1[redacted]');
  const logPayload = {
    err: error,
    requestId: req.requestId,
    method: req.method,
    path,
    statusCode: appError.statusCode,
    code: appError.code,
  };

  if (appError.statusCode >= 500) {
    logger.error(logPayload, 'request failed');
  } else {
    logger.warn(logPayload, 'request rejected');
  }

  res.status(appError.statusCode).json({
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details ? { details: appError.details } : {}),
    },
    requestId: req.requestId,
  });
}

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(AppError.notFound(`Route ${req.method} ${req.path} does not exist`, 'ROUTE_NOT_FOUND'));
}
