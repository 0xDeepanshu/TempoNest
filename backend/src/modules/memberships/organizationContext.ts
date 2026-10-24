import type { NextFunction, Request, Response } from 'express';
import { Organization } from '../../database';
import { Membership } from './membership.model';
import { AppError } from '../../utils/errors';

/**
 * Resolves organization context from the route param, then loads the caller's
 * membership from the database. Organization IDs from the client are never
 * trusted as proof of access.
 */
export async function loadOrganizationContext(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = req.auth?.user;
    if (!user) {
      return next(AppError.unauthorized('Authentication required', 'UNAUTHENTICATED'));
    }

    const organizationId = req.params.organizationId;
    if (!organizationId) {
      return next(AppError.badRequest('Organization ID is required', 'ORGANIZATION_ID_REQUIRED'));
    }

    const membership = await Membership.findOne({
      where: { organizationId, userId: user.id },
      include: [{ model: Organization, as: 'organization', required: true }],
    });

    // Return 404 rather than 403 for non-members so that organization IDs
    // cannot be enumerated by outsiders.
    if (!membership || !membership.organization) {
      return next(AppError.notFound('Organization not found', 'ORGANIZATION_NOT_FOUND'));
    }

    if (membership.status !== 'ACTIVE') {
      return next(AppError.forbidden('Your membership is not active', 'MEMBERSHIP_INACTIVE'));
    }

    if (membership.organization.status === 'SUSPENDED' && req.method !== 'GET') {
      return next(AppError.forbidden('This organization is suspended', 'ORGANIZATION_SUSPENDED'));
    }

    req.organization = {
      organization: membership.organization,
      membership,
    };

    next();
  } catch (error) {
    next(error);
  }
}
