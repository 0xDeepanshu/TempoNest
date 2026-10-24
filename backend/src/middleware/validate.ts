import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodTypeAny } from 'zod';
import { AppError, zodDetails } from '../utils/errors';

export type ValidationSchemas = {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
};

/**
 * Validates and replaces request input with the parsed result. All bodies,
 * route params and query strings are validated before reaching a controller.
 */
export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.params) {
        const parsed = schemas.params.safeParse(req.params);
        if (!parsed.success) {
          throw AppError.unprocessable(
            'Request validation failed',
            'VALIDATION_ERROR',
            zodDetails(parsed.error, (path) => `params.${path}`),
          );
        }
        req.params = parsed.data as typeof req.params;
      }

      if (schemas.query) {
        const parsed = schemas.query.safeParse(req.query);
        if (!parsed.success) {
          throw AppError.unprocessable(
            'Request validation failed',
            'VALIDATION_ERROR',
            zodDetails(parsed.error, (path) => (path ? `query.${path}` : 'query')),
          );
        }
        req.query = parsed.data as typeof req.query;
      }

      if (schemas.body) {
        const parsed = schemas.body.safeParse(req.body);
        if (!parsed.success) {
          throw AppError.unprocessable(
            'Request validation failed',
            'VALIDATION_ERROR',
            zodDetails(parsed.error, (path) => (path ? `body.${path}` : 'body')),
          );
        }
        req.body = parsed.data;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
