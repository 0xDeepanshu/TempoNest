import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../utils/errors';
import { loadOrganizationContext } from '../memberships/organizationContext';

const organizationIdSchema = z.string().uuid('Organization ID must be a valid UUID');

/**
 * Supports the "current organization" endpoints, where the client supplies
 * `X-Organization-Id` (for example, the organization selected in the portal).
 * The header is only a selector; membership is still verified server-side.
 */
export async function resolveCurrentOrganization(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.get('x-organization-id');
  if (!header) {
    return next(
      AppError.badRequest(
        'X-Organization-Id header is required for the current organization endpoints',
        'ORGANIZATION_CONTEXT_REQUIRED',
      ),
    );
  }

  const parsed = organizationIdSchema.safeParse(header);
  if (!parsed.success) {
    return next(
      AppError.badRequest('X-Organization-Id must be a valid UUID', 'ORGANIZATION_CONTEXT_INVALID'),
    );
  }

  req.params.organizationId = parsed.data;
  return loadOrganizationContext(req, res, next);
}
