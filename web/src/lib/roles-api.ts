import { apiRequest, type QueryValue } from "./api-client";
import type {
  DataScope,
  PermissionCatalogResponse,
  RoleListResponse,
  RoleResponse,
  RoleUsersResponse,
} from "./types";
import type { Permission } from "./permissions";

type RequestOptions = { signal?: AbortSignal };

export type CreateRoleInput = {
  name: string;
  description?: string | null;
  permissions: Permission[];
  dataScope?: DataScope;
  onboardingEligible?: boolean;
};

export type UpdateRoleInput = Partial<CreateRoleInput>;

export type UpdateManagerRoleInput = {
  description?: string | null;
  permissions?: Permission[];
  dataScope?: DataScope;
};

export type AssignRoleInput = { role: "OWNER" | "ADMIN" | "MANAGER" | "EMPLOYEE" } | { customRoleId: string };

function rolesPath(organizationId: string, suffix = ""): string {
  return `/organizations/${organizationId}/roles${suffix}`;
}

export function listRoles(organizationId: string, options: RequestOptions = {}) {
  return apiRequest<RoleListResponse>(rolesPath(organizationId), { signal: options.signal });
}

export function getRole(
  organizationId: string,
  roleId: string,
  options: RequestOptions = {},
) {
  return apiRequest<RoleResponse>(rolesPath(organizationId, `/${roleId}`), {
    signal: options.signal,
  });
}

export function listPermissionCatalog(organizationId: string, options: RequestOptions = {}) {
  return apiRequest<PermissionCatalogResponse>(rolesPath(organizationId, "/permissions"), {
    signal: options.signal,
  });
}

export function createRole(organizationId: string, input: CreateRoleInput) {
  return apiRequest<RoleResponse>(rolesPath(organizationId), { method: "POST", body: input });
}

export function updateRole(organizationId: string, roleId: string, input: UpdateRoleInput) {
  return apiRequest<RoleResponse>(rolesPath(organizationId, `/${roleId}`), {
    method: "PATCH",
    body: input,
  });
}

export function deleteRole(organizationId: string, roleId: string) {
  return apiRequest<void>(rolesPath(organizationId, `/${roleId}`), { method: "DELETE" });
}

export function getManagerRole(organizationId: string, options: RequestOptions = {}) {
  return apiRequest<RoleResponse>(rolesPath(organizationId, "/MANAGER"), {
    signal: options.signal,
  });
}

export function updateManagerRole(organizationId: string, input: UpdateManagerRoleInput) {
  return apiRequest<RoleResponse>(rolesPath(organizationId, "/MANAGER"), {
    method: "PATCH",
    body: input,
  });
}

export function resetManagerRole(organizationId: string) {
  return apiRequest<RoleResponse>(rolesPath(organizationId, "/MANAGER"), { method: "DELETE" });
}

export function listRoleUsers(
  organizationId: string,
  roleId: string,
  query: { page?: number; limit?: number } = {},
  options: RequestOptions = {},
) {
  return apiRequest<RoleUsersResponse>(rolesPath(organizationId, `/${roleId}/users`), {
    signal: options.signal,
    query: query as Record<string, QueryValue>,
  });
}

export function assignMemberRole(
  organizationId: string,
  membershipId: string,
  input: AssignRoleInput,
) {
  return apiRequest<{ data: { membership: { id: string; role: string; customRoleId: string | null } } }>(
    `/organizations/${organizationId}/members/${membershipId}`,
    { method: "PATCH", body: input },
  );
}
