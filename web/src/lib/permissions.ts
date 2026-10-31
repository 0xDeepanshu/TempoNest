import type { DataScope, Role } from "./types";

export const PERMISSIONS = [
  "organization:read",
  "organization:update",
  "role:read",
  "role:manage",
  "member:read",
  "member:onboard",
  "member:invite",
  "member:update",
  "member:remove",
  "invitation:read",
  "invitation:revoke",
  "time:read",
  "time:write",
  "report:read",
  "correction:review",
  "agent:read",
  "agent:revoke",
  "screenshot:request",
  "screenshot:read",
  "screenshot:live",
  "screenshot:manage",
  "screenshot:policy",
  "activity:policy",
  "classification:manage",
  "attendance:location:read",
  "leave:read",
  "leave:write",
  "leave:approve",
  "leave:manage",
  "holiday:view",
  "holiday:create",
  "holiday:update",
  "holiday:delete",
  "holiday:settings:manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Mirrors the backend permission matrix. This is a UX helper only: every API
 * call is still authorized by the backend using the stored membership.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  OWNER: [...PERMISSIONS],
  ADMIN: [
    "organization:read",
    "organization:update",
    "role:read",
    "role:manage",
    "member:read",
    "member:onboard",
    "member:invite",
    "member:update",
    "member:remove",
    "invitation:read",
    "invitation:revoke",
    "time:read",
    "time:write",
    "report:read",
    "correction:review",
    "agent:read",
    "agent:revoke",
    "screenshot:request",
    "screenshot:read",
    "screenshot:live",
    "screenshot:manage",
    "screenshot:policy",
    "activity:policy",
    "classification:manage",
    "attendance:location:read",
    "leave:read",
    "leave:write",
    "leave:approve",
    "leave:manage",
    "holiday:view",
    "holiday:create",
    "holiday:update",
    "holiday:delete",
    "holiday:settings:manage",
  ],
  MANAGER: [
    "organization:read",
    "member:read",
    "time:read",
    "time:write",
    "report:read",
    "correction:review",
    "agent:read",
    "screenshot:read",
    "leave:read",
    "leave:write",
    "holiday:view",
  ],
  EMPLOYEE: [
    "organization:read",
    "time:read",
    "time:write",
    "agent:read",
    "leave:read",
    "leave:write",
    "holiday:view",
  ],
};

/**
 * Anything that can carry effective permissions. Built-in roles use the local
 * matrix; memberships use the permission list resolved by the backend, so a
 * custom role is mirrored exactly (including an intentionally empty list).
 */
export type PermissionActor =
  | Role
  | { role: Role; permissions?: readonly Permission[] }
  | undefined;

function builtInRole(actor: PermissionActor): Role | undefined {
  if (!actor) return undefined;
  return typeof actor === "string" ? actor : actor.role;
}

export function hasPermission(actor: PermissionActor, permission: Permission): boolean {
  if (!actor) return false;
  if (typeof actor !== "string" && Array.isArray(actor.permissions)) {
    return actor.permissions.includes(permission);
  }
  const role = builtInRole(actor);
  return role ? ROLE_PERMISSIONS[role].includes(permission) : false;
}

export function hasAnyPermission(
  actor: PermissionActor,
  permissions: Permission[],
): boolean {
  return permissions.some((permission) => hasPermission(actor, permission));
}

export const ADMIN_AREA_PERMISSIONS: Permission[] = [
  "member:read",
  "report:read",
  "organization:update",
  "correction:review",
  "role:read",
  // Holiday administration lives under /admin; a delegated holiday role must be
  // able to reach its own pages even without the team-management permissions.
  "holiday:create",
  "holiday:update",
  "holiday:delete",
  "holiday:settings:manage",
];

export function isAdminAreaRole(actor: PermissionActor): boolean {
  return hasAnyPermission(actor, ADMIN_AREA_PERMISSIONS);
}

/** Mirrors the backend's scope resolution for memberships and built-in roles. */
export function isSelfScoped(actor: PermissionActor, dataScope?: DataScope): boolean {
  if (dataScope) return dataScope === "SELF";
  return builtInRole(actor) === "EMPLOYEE";
}

export function roleRank(role: Role): number {
  return { EMPLOYEE: 1, MANAGER: 2, ADMIN: 3, OWNER: 4 }[role];
}

/** Mirrors the backend's role-hierarchy rules for member mutation controls. */
export function canManageMember(
  actor: PermissionActor,
  actorUserId: string | undefined,
  target: { userId: string; role: Role },
): boolean {
  const actorRole = builtInRole(actor);
  if (!actorRole || !hasPermission(actor, "member:update")) return false;
  if (actorUserId === target.userId) return false;
  if (actorRole === "OWNER") return true;
  if (actorRole === "ADMIN") return target.role === "MANAGER" || target.role === "EMPLOYEE";
  return false;
}

/** Roles an actor may assign to a member with the given current role. */
export function assignableRoles(
  actorRole: Role | undefined,
  currentRole: Role,
): Role[] {
  if (!actorRole) return [];
  if (actorRole === "OWNER") return ["ADMIN", "MANAGER", "EMPLOYEE", "OWNER"];
  if (actorRole === "ADMIN" && (currentRole === "MANAGER" || currentRole === "EMPLOYEE")) {
    return ["MANAGER", "EMPLOYEE"];
  }
  return [];
}

/** Roles an actor may invite. OWNER can never be invited. */
export function invitableRoles(actorRole: Role | undefined): Role[] {
  if (!actorRole) return [];
  if (actorRole === "OWNER") return ["ADMIN", "MANAGER", "EMPLOYEE"];
  if (actorRole === "ADMIN") return ["MANAGER", "EMPLOYEE"];
  return [];
}
