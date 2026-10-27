import type { NextFunction, Request, Response } from 'express';
import type { Role } from './roles';
import { AppError } from '../../utils/errors';
import type { Membership } from './membership.model';

export const PERMISSIONS = [
  'organization:read',
  'organization:update',
  'member:read',
  'member:invite',
  'member:update',
  'member:remove',
  'invitation:read',
  'invitation:revoke',
  'time:read',
  'time:write',
  'report:read',
  'attendance:location:read',
  'correction:review',
  'agent:read',
  'agent:revoke',
  'screenshot:request',
  'screenshot:read',
  'screenshot:live',
  'screenshot:manage',
  'screenshot:policy',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Explicit server-side permission matrix. Clients never choose their role and
 * never supply permissions; these are derived from the stored membership.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  OWNER: [...PERMISSIONS],
  ADMIN: [
    'organization:read',
    'organization:update',
    'member:read',
    'member:invite',
    'member:update',
    'member:remove',
    'invitation:read',
    'invitation:revoke',
    'time:read',
    'time:write',
    'report:read',
    'attendance:location:read',
    'correction:review',
    'agent:read',
    'agent:revoke',
    'screenshot:request',
    'screenshot:read',
    'screenshot:live',
    'screenshot:manage',
    'screenshot:policy',
  ],
  MANAGER: [
    'organization:read',
    'member:read',
    'time:read',
    'time:write',
    'report:read',
    'correction:review',
    'agent:read',
    'screenshot:read',
  ],
  EMPLOYEE: ['organization:read', 'time:read', 'time:write', 'agent:read'],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const membership = req.organization?.membership;
    if (!membership) {
      return next(AppError.forbidden('Organization context is required', 'ORGANIZATION_CONTEXT_REQUIRED'));
    }
    if (!hasPermission(membership.role, permission)) {
      return next(
        AppError.forbidden('Your role does not permit this action', 'PERMISSION_DENIED'),
      );
    }
    next();
  };
}

/**
 * An actor may only manage members whose role is strictly below (or, for
 * OWNER, equal or below) their own role. ADMINs can manage MANAGER/EMPLOYEE;
 * MANAGERs cannot mutate memberships.
 */
export function assertCanManageMembership(actor: Membership, target: Membership): void {
  if (actor.userId === target.userId) {
    throw AppError.forbidden('You cannot modify your own membership', 'CANNOT_MODIFY_SELF');
  }

  if (actor.role === 'OWNER') return;

  if (actor.role === 'ADMIN' && (target.role === 'MANAGER' || target.role === 'EMPLOYEE')) {
    return;
  }

  throw AppError.forbidden('Your role cannot manage this member', 'ROLE_MANAGEMENT_FORBIDDEN');
}

/** OWNER is never assignable through role changes or invitations. */
export function assertInvitableRole(actorRole: Role, role: Role): void {
  if (role === 'OWNER') {
    throw AppError.forbidden('Ownership cannot be granted through an invitation', 'ROLE_ASSIGNMENT_FORBIDDEN');
  }
  if (role === 'ADMIN' && actorRole !== 'OWNER') {
    throw AppError.forbidden('Only an owner can assign the ADMIN role', 'ROLE_ASSIGNMENT_FORBIDDEN');
  }
}

export function assertRoleChangeAllowed(actorRole: Role, currentRole: Role, newRole: Role): void {
  if (newRole === 'OWNER' && actorRole !== 'OWNER') {
    throw AppError.forbidden('Only an owner can grant ownership', 'ROLE_ASSIGNMENT_FORBIDDEN');
  }
  if ((currentRole === 'OWNER' || newRole === 'OWNER') && actorRole !== 'OWNER') {
    throw AppError.forbidden('Only an owner can manage owner memberships', 'ROLE_ASSIGNMENT_FORBIDDEN');
  }
  if ((currentRole === 'ADMIN' || newRole === 'ADMIN') && actorRole !== 'OWNER') {
    throw AppError.forbidden('Only an owner can manage admin memberships', 'ROLE_ASSIGNMENT_FORBIDDEN');
  }
}
