import { describe, expect, it } from "vitest";
import {
  assignableRoles,
  canManageMember,
  hasAnyPermission,
  hasPermission,
  invitableRoles,
  isAdminAreaRole,
  roleRank,
  ROLE_PERMISSIONS,
} from "@/lib/permissions";

describe("role permissions", () => {
  it("gives owners every permission", () => {
    for (const permission of ROLE_PERMISSIONS.OWNER) {
      expect(hasPermission("OWNER", permission)).toBe(true);
    }
  });

  it("keeps employees out of management and reporting areas", () => {
    expect(hasPermission("EMPLOYEE", "time:read")).toBe(true);
    expect(hasPermission("EMPLOYEE", "report:read")).toBe(false);
    expect(hasPermission("EMPLOYEE", "member:read")).toBe(false);
    expect(hasPermission("EMPLOYEE", "correction:review")).toBe(false);
    expect(isAdminAreaRole("EMPLOYEE")).toBe(false);
  });

  it("lets managers read reports and review corrections", () => {
    expect(hasPermission("MANAGER", "report:read")).toBe(true);
    expect(hasPermission("MANAGER", "correction:review")).toBe(true);
    expect(hasPermission("MANAGER", "organization:update")).toBe(false);
    expect(isAdminAreaRole("MANAGER")).toBe(true);
  });

  it("limits location history access to owners and admins", () => {
    expect(hasPermission("OWNER", "attendance:location:read")).toBe(true);
    expect(hasPermission("ADMIN", "attendance:location:read")).toBe(true);
    expect(hasPermission("MANAGER", "attendance:location:read")).toBe(false);
    expect(hasPermission("EMPLOYEE", "attendance:location:read")).toBe(false);
    expect(hasPermission(undefined, "attendance:location:read")).toBe(false);
    // Managers keep report access without inheriting precise-location access.
    expect(hasPermission("MANAGER", "report:read")).toBe(true);
  });

  it("handles unknown roles and any-of checks", () => {
    expect(hasPermission(undefined, "time:read")).toBe(false);
    expect(hasAnyPermission("EMPLOYEE", ["member:read", "time:read"])).toBe(true);
    expect(hasAnyPermission("EMPLOYEE", ["member:read", "report:read"])).toBe(false);
  });

  it("orders roles for hierarchy decisions", () => {
    expect(roleRank("OWNER")).toBeGreaterThan(roleRank("ADMIN"));
    expect(roleRank("ADMIN")).toBeGreaterThan(roleRank("MANAGER"));
    expect(roleRank("MANAGER")).toBeGreaterThan(roleRank("EMPLOYEE"));
  });
});

describe("member management rules", () => {
  const target = (role: "OWNER" | "ADMIN" | "MANAGER" | "EMPLOYEE", userId = "user-2") => ({
    userId,
    role,
  });

  it("prevents self-management for every role", () => {
    expect(canManageMember("OWNER", "user-1", target("ADMIN", "user-1"))).toBe(false);
    expect(canManageMember("ADMIN", "user-1", target("EMPLOYEE", "user-1"))).toBe(false);
  });

  it("lets owners manage any other member", () => {
    expect(canManageMember("OWNER", "user-1", target("OWNER"))).toBe(true);
    expect(canManageMember("OWNER", "user-1", target("ADMIN"))).toBe(true);
    expect(canManageMember("OWNER", "user-1", target("EMPLOYEE"))).toBe(true);
  });

  it("stops admins from managing peers or owners", () => {
    expect(canManageMember("ADMIN", "user-1", target("ADMIN"))).toBe(false);
    expect(canManageMember("ADMIN", "user-1", target("OWNER"))).toBe(false);
    expect(canManageMember("ADMIN", "user-1", target("MANAGER"))).toBe(true);
    expect(canManageMember("ADMIN", "user-1", target("EMPLOYEE"))).toBe(true);
  });

  it("does not let managers or employees manage members", () => {
    expect(canManageMember("MANAGER", "user-1", target("EMPLOYEE"))).toBe(false);
    expect(canManageMember("EMPLOYEE", "user-1", target("EMPLOYEE"))).toBe(false);
  });

  it("limits assignable roles to the actor's authority", () => {
    expect(assignableRoles("OWNER", "EMPLOYEE")).toEqual([
      "ADMIN",
      "MANAGER",
      "EMPLOYEE",
      "OWNER",
    ]);
    expect(assignableRoles("ADMIN", "MANAGER")).toEqual(["MANAGER", "EMPLOYEE"]);
    expect(assignableRoles("ADMIN", "ADMIN")).toEqual([]);
    expect(assignableRoles("MANAGER", "EMPLOYEE")).toEqual([]);
  });

  it("never invites an owner", () => {
    expect(invitableRoles("OWNER")).toEqual(["ADMIN", "MANAGER", "EMPLOYEE"]);
    expect(invitableRoles("ADMIN")).toEqual(["MANAGER", "EMPLOYEE"]);
    expect(invitableRoles("MANAGER")).toEqual([]);
  });
});
