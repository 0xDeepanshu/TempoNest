export const ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'EMPLOYEE'] as const;
export type Role = (typeof ROLES)[number];

export const INVITABLE_ROLES = ['ADMIN', 'MANAGER', 'EMPLOYEE'] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export const ROLE_RANK: Record<Role, number> = {
  OWNER: 40,
  ADMIN: 30,
  MANAGER: 20,
  EMPLOYEE: 10,
};

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function isInvitableRole(value: string): value is InvitableRole {
  return (INVITABLE_ROLES as readonly string[]).includes(value);
}
