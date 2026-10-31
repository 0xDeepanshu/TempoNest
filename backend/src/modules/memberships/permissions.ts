import type { NextFunction, Request, Response } from 'express';
import type { Role } from './roles';
import { AppError } from '../../utils/errors';
import type { Membership } from './membership.model';

export const PERMISSIONS = [
  'organization:read',
  'organization:update',
  'role:read',
  'role:manage',
  'member:read',
  'member:onboard',
  'member:invite',
  'member:update',
  'member:remove',
  'invitation:read',
  'invitation:revoke',
  'time:read',
  'time:write',
  'report:read',
  'activity:policy',
  'classification:manage',
  'attendance:location:read',
  'correction:review',
  'agent:read',
  'agent:revoke',
  'screenshot:request',
  'screenshot:read',
  'screenshot:live',
  'screenshot:manage',
  'screenshot:policy',
  'leave:read',
  'leave:write',
  'leave:approve',
  'leave:manage',
  'holiday:view',
  'holiday:create',
  'holiday:update',
  'holiday:delete',
  'holiday:settings:manage',
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
    'role:read',
    'role:manage',
    'member:read',
    'member:onboard',
    'member:invite',
    'member:update',
    'member:remove',
    'invitation:read',
    'invitation:revoke',
    'time:read',
    'time:write',
    'report:read',
    'activity:policy',
    'classification:manage',
    'attendance:location:read',
    'correction:review',
    'agent:read',
    'agent:revoke',
    'screenshot:request',
    'screenshot:read',
    'screenshot:live',
    'screenshot:manage',
    'screenshot:policy',
    'leave:read',
    'leave:write',
    'leave:approve',
    'leave:manage',
    'holiday:view',
    'holiday:create',
    'holiday:update',
    'holiday:delete',
    'holiday:settings:manage',
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
    'leave:read',
    'leave:write',
    'holiday:view',
  ],
  EMPLOYEE: [
    'organization:read',
    'time:read',
    'time:write',
    'agent:read',
    'leave:read',
    'leave:write',
    'holiday:view',
  ],
};

export const DATA_SCOPES = ['SELF', 'ORGANIZATION'] as const;
export type DataScope = (typeof DATA_SCOPES)[number];

/**
 * Permissions that may be delegated to an organization-defined role. The set
 * intentionally excludes every OWNER/ADMIN-only capability (member management,
 * invitations, monitoring policy, live screenshots, leave administration and
 * role administration) so a custom role can never escalate a member beyond the
 * existing non-admin management surface.
 *
 * Screenshot viewing stays protected because its access is additionally scoped
 * by the screenshot policy's built-in role lists.
 */
export const CUSTOM_ROLE_GRANTABLE_PERMISSIONS = [
  'organization:read',
  'member:read',
  'member:onboard',
  'time:read',
  'time:write',
  'report:read',
  'correction:review',
  'agent:read',
  'leave:read',
  'leave:write',
  'holiday:view',
  'holiday:create',
  'holiday:update',
  'holiday:delete',
  'holiday:settings:manage',
] as const satisfies readonly Permission[];

export type GrantablePermission = (typeof CUSTOM_ROLE_GRANTABLE_PERMISSIONS)[number];

/**
 * Permissions an organization may use to customize its built-in MANAGER role.
 * It extends the custom-role set with screenshot viewing, which MANAGER already
 * has by default, but never with administrator-only capabilities.
 */
export const MANAGER_OVERRIDE_GRANTABLE_PERMISSIONS = [
  ...CUSTOM_ROLE_GRANTABLE_PERMISSIONS,
  'screenshot:read',
] as const satisfies readonly Permission[];

export function isManagerOverridePermission(value: string): value is Permission {
  return (MANAGER_OVERRIDE_GRANTABLE_PERMISSIONS as readonly string[]).includes(value);
}

export const PROTECTED_PERMISSIONS: readonly Permission[] = PERMISSIONS.filter(
  (permission) => !(CUSTOM_ROLE_GRANTABLE_PERMISSIONS as readonly string[]).includes(permission),
);

export function isGrantablePermission(value: string): value is GrantablePermission {
  return (CUSTOM_ROLE_GRANTABLE_PERMISSIONS as readonly string[]).includes(value);
}

/** Effective authorization derived from the stored membership on every request. */
export interface PermissionSubject {
  role: Role;
  permissions: readonly Permission[];
  dataScope: DataScope;
  customRoleId: string | null;
}

export interface CustomRoleAccess {
  permissions: readonly Permission[];
  dataScope: DataScope;
}

export interface ManagerRoleOverrideAccess {
  permissions: readonly Permission[];
  dataScope: DataScope;
}

function builtInDataScope(role: Role): DataScope {
  return role === 'EMPLOYEE' ? 'SELF' : 'ORGANIZATION';
}

/**
 * Resolves the effective subject. Built-in roles keep their existing matrix
 * unless the organization customized its MANAGER role. When a membership
 * points at a custom role that could not be loaded, the subject is
 * least-privilege rather than silently falling back to EMPLOYEE.
 */
export function resolvePermissionSubject(
  role: Role,
  customRoleId: string | null,
  customRole: CustomRoleAccess | null | undefined,
  managerOverride?: ManagerRoleOverrideAccess | null,
): PermissionSubject {
  if (!customRoleId) {
    if (role === 'MANAGER' && managerOverride) {
      return {
        role,
        permissions: managerOverride.permissions.filter((permission) =>
          isManagerOverridePermission(permission),
        ),
        dataScope: managerOverride.dataScope,
        customRoleId: null,
      };
    }

    return {
      role,
      permissions: ROLE_PERMISSIONS[role],
      dataScope: builtInDataScope(role),
      customRoleId: null,
    };
  }

  if (!customRole) {
    return { role, permissions: [], dataScope: 'SELF', customRoleId };
  }

  return {
    role,
    // Defense in depth: even if a stored row were tampered with directly, a
    // custom role can only ever carry permissions the API allows it to hold.
    permissions: customRole.permissions.filter((permission) =>
      isGrantablePermission(permission),
    ),
    dataScope: customRole.dataScope,
    customRoleId,
  };
}

export function isSelfScoped(subject: Role | PermissionSubject): boolean {
  if (typeof subject === 'string') return subject === 'EMPLOYEE';
  return subject.dataScope === 'SELF';
}

/** Built-in role used by legacy policy lists (screenshot/live-view role lists). */
export function policyRole(subject: Role | PermissionSubject): Role {
  return typeof subject === 'string' ? subject : subject.role;
}

export function hasPermission(
  subject: Role | PermissionSubject,
  permission: Permission,
): boolean {
  const permissions =
    typeof subject === 'string' ? ROLE_PERMISSIONS[subject] : subject.permissions;
  return permissions.includes(permission);
}

export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const context = req.organization;
    if (!context) {
      return next(AppError.forbidden('Organization context is required', 'ORGANIZATION_CONTEXT_REQUIRED'));
    }
    if (!hasPermission(context.effective, permission)) {
      return next(
        AppError.forbidden('Your role does not permit this action', 'PERMISSION_DENIED'),
      );
    }
    next();
  };
}

/** Accepts a request when the caller holds at least one of the permissions. */
export function requireAnyPermission(permissions: readonly Permission[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const context = req.organization;
    if (!context) {
      return next(AppError.forbidden('Organization context is required', 'ORGANIZATION_CONTEXT_REQUIRED'));
    }
    if (!permissions.some((permission) => hasPermission(context.effective, permission))) {
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
