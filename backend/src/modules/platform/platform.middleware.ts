import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../utils/errors';

/**
 * Platform authority is stored on the user row and reloaded with every
 * authenticated request. Organization ownership deliberately grants nothing
 * here, and the client cannot assert this role.
 */
export function requirePlatformAdmin(req: Request, _res: Response, next: NextFunction): void {
  const user = req.auth?.user;
  if (!user) {
    return next(AppError.unauthorized('Authentication required', 'UNAUTHENTICATED'));
  }
  if (user.status !== 'ACTIVE' || user.platformRole !== 'SUPERADMIN') {
    return next(AppError.forbidden('Platform access required', 'PLATFORM_ACCESS_REQUIRED'));
  }
  next();
}
