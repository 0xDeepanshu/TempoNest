import type { Role } from "./types";

export const PERMISSIONS = [
  "organization:read",
  "organization:update",
  "member:read",
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
  "attendance:location:read",
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
    "member:read",
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
    "attendance:location:read",
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
  ],
  EMPLOYEE: ["organization:read", "time:read", "time:write", "agent:read"],
};

export function hasPermission(role: Role | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function hasAnyPermission(role: Role | undefined, permissions: Permission[]): boolean {
  return permissions.some((permission) => hasPermission(role, permission));
}

export const ADMIN_AREA_PERMISSIONS: Permission[] = [
  "member:read",
  "report:read",
  "organization:update",
  "correction:review",
];

export function isAdminAreaRole(role: Role | undefined): boolean {
  return hasAnyPermission(role, ADMIN_AREA_PERMISSIONS);
}

export function roleRank(role: Role): number {
  return { EMPLOYEE: 1, MANAGER: 2, ADMIN: 3, OWNER: 4 }[role];
}

/** Mirrors the backend's role-hierarchy rules for member mutation controls. */
export function canManageMember(
  actorRole: Role | undefined,
  actorUserId: string | undefined,
  target: { userId: string; role: Role },
): boolean {
  if (!actorRole || !hasPermission(actorRole, "member:update")) return false;
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
