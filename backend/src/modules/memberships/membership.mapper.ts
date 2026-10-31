import type { Membership } from './membership.model';
import type { Organization } from '../organizations/organization.model';
import type { User } from '../users/user.model';
import { resolvePermissionSubject, type ManagerRoleOverrideAccess } from './permissions';

/** The only user shape ever returned by the API. Never includes secrets. */
export function toPublicUser(user: User) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    status: user.status,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export type PublicUser = ReturnType<typeof toPublicUser>;

export function toOrganizationSummary(organization: Organization) {
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    status: organization.status,
    timezone: organization.timezone,
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt,
  };
}

export function toMembershipSummary(
  membership: Membership,
  managerOverride?: ManagerRoleOverrideAccess | null,
) {
  const effective = resolvePermissionSubject(
    membership.role,
    membership.customRoleId ?? null,
    membership.customRole,
    managerOverride,
  );

  return {
    id: membership.id,
    organizationId: membership.organizationId,
    userId: membership.userId,
    role: membership.role,
    customRoleId: membership.customRoleId ?? null,
    status: membership.status,
    permissions: effective.permissions,
    dataScope: effective.dataScope,
    ...(membership.customRole
      ? {
          customRole: {
            id: membership.customRole.id,
            name: membership.customRole.name,
            description: membership.customRole.description,
            permissions: membership.customRole.permissions,
            dataScope: membership.customRole.dataScope,
            onboardingEligible: membership.customRole.onboardingEligible,
          },
        }
      : {}),
    createdAt: membership.createdAt,
    updatedAt: membership.updatedAt,
    ...(membership.organization
      ? { organization: toOrganizationSummary(membership.organization) }
      : {}),
    ...(membership.user
      ? {
          user: {
            id: membership.user.id,
            name: membership.user.name,
            email: membership.user.email,
            status: membership.user.status,
          },
        }
      : {}),
  };
}
