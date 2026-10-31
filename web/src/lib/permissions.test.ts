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

  it("gives managers holiday visibility but not holiday management", () => {
    expect(hasPermission("MANAGER", "holiday:view")).toBe(true);
    expect(hasPermission("MANAGER", "holiday:create")).toBe(false);
    expect(hasPermission("MANAGER", "holiday:update")).toBe(false);
    expect(hasPermission("MANAGER", "holiday:delete")).toBe(false);
    expect(hasPermission("MANAGER", "holiday:settings:manage")).toBe(false);
    expect(hasPermission("EMPLOYEE", "holiday:view")).toBe(true);
    expect(hasPermission("ADMIN", "holiday:create")).toBe(true);
    expect(hasPermission("ADMIN", "holiday:settings:manage")).toBe(true);
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

  it("restricts tracking policy edits and classification management to owners and admins", () => {
    expect(hasPermission("OWNER", "activity:policy")).toBe(true);
    expect(hasPermission("ADMIN", "activity:policy")).toBe(true);
    expect(hasPermission("MANAGER", "activity:policy")).toBe(false);
    expect(hasPermission("EMPLOYEE", "activity:policy")).toBe(false);

    expect(hasPermission("OWNER", "classification:manage")).toBe(true);
    expect(hasPermission("ADMIN", "classification:manage")).toBe(true);
    expect(hasPermission("MANAGER", "classification:manage")).toBe(false);
    expect(hasPermission("EMPLOYEE", "classification:manage")).toBe(false);

    // Managers can still view tracking settings and reports read-only.
    expect(hasPermission("MANAGER", "time:read")).toBe(true);
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

describe("server-resolved permissions", () => {
  it("uses the explicit permission list for memberships with a custom role", () => {
    const subject = { role: "EMPLOYEE" as const, permissions: ["report:read"] as const };
    expect(hasPermission(subject, "report:read")).toBe(true);
    expect(hasPermission(subject, "member:read")).toBe(false);
    expect(hasPermission(subject, "time:read")).toBe(false);
  });

  it("treats an empty effective list as least privilege", () => {
    const subject = { role: "EMPLOYEE" as const, permissions: [] as const };
    expect(hasPermission(subject, "time:read")).toBe(false);
    expect(hasAnyPermission(subject, ["time:read", "leave:read"])).toBe(false);
  });

  it("falls back to the built-in matrix for legacy memberships without a list", () => {
    const subject = { role: "MANAGER" as const };
    expect(hasPermission(subject, "report:read")).toBe(true);
    expect(hasPermission(subject, "organization:update")).toBe(false);
  });

  it("lets a delegated member:read permission unlock the admin area", () => {
    expect(isAdminAreaRole({ role: "EMPLOYEE", permissions: ["member:read"] })).toBe(true);
    expect(isAdminAreaRole({ role: "EMPLOYEE", permissions: ["time:read"] })).toBe(false);
  });

  it("lets a delegated holiday role reach the admin holiday pages", () => {
    expect(
      isAdminAreaRole({ role: "EMPLOYEE", permissions: ["holiday:create"] }),
    ).toBe(true);
    expect(
      isAdminAreaRole({ role: "EMPLOYEE", permissions: ["holiday:settings:manage"] }),
    ).toBe(true);
    expect(isAdminAreaRole({ role: "EMPLOYEE", permissions: ["holiday:view"] })).toBe(
      false,
    );
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

  it("delegates onboarding without granting administrator invitations", () => {
    expect(hasPermission("OWNER", "member:onboard")).toBe(true);
    expect(hasPermission("ADMIN", "member:onboard")).toBe(true);
    expect(hasPermission("MANAGER", "member:onboard")).toBe(false);
    expect(hasPermission("EMPLOYEE", "member:onboard")).toBe(false);
    // Onboarding never implies the broader invitation permission.
    expect(hasPermission("MANAGER", "member:invite")).toBe(false);
    expect(hasPermission("EMPLOYEE", "member:invite")).toBe(false);
  });

  it("never invites an owner", () => {
    expect(invitableRoles("OWNER")).toEqual(["ADMIN", "MANAGER", "EMPLOYEE"]);
    expect(invitableRoles("ADMIN")).toEqual(["MANAGER", "EMPLOYEE"]);
    expect(invitableRoles("MANAGER")).toEqual([]);
  });
});
