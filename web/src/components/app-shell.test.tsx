import { describe, expect, it, vi } from "vitest";
import { visibleNavigationGroups } from "@/components/app-shell";
import type { Permission } from "@/lib/permissions";
import type { DataScope, MembershipSummary } from "@/lib/types";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));

function membership(
  permissions: Permission[] | undefined,
  overrides: Partial<MembershipSummary> = {},
): MembershipSummary {
  return {
    id: "membership-1",
    organizationId: "org-1",
    userId: "user-1",
    role: "EMPLOYEE",
    status: "ACTIVE",
    ...(permissions === undefined ? {} : { permissions }),
    dataScope: "ORGANIZATION" as DataScope,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function labels(actor: MembershipSummary | undefined): string[] {
  return visibleNavigationGroups(actor).flatMap((group) =>
    group.items.map((item) => item.label),
  );
}

describe("visibleNavigationGroups", () => {
  it("shows App tracking only when tracking read and reporting are both granted", () => {
    expect(labels(membership(["report:read"]))).not.toContain("App tracking");
    expect(labels(membership(["time:read"]))).not.toContain("App tracking");
    expect(labels(membership(["time:read", "report:read"]))).toContain("App tracking");
  });

  it("keeps report-only custom roles limited to reporting surfaces", () => {
    const visible = labels(membership(["report:read"]));

    expect(visible).toEqual(
      expect.arrayContaining(["Reports", "Live tracking", "Attendance evidence"]),
    );
    expect(visible).not.toContain("My attendance");
    expect(visible).not.toContain("Corrections");
    expect(visible).not.toContain("People");
    expect(visible).not.toContain("App tracking");
    expect(visible).not.toContain("Screenshot review");
    expect(visible).not.toContain("Monitoring settings");
    expect(visible).not.toContain("Organization");
  });

  it("keeps the built-in EMPLOYEE navigation free of management areas", () => {
    const visible = labels(membership(undefined, { role: "EMPLOYEE" }));

    expect(visible).toEqual(
      expect.arrayContaining(["My attendance", "My leaves", "Corrections"]),
    );
    expect(visible).toContain("Holiday calendar");
    expect(visible).not.toContain("Holiday management");
    expect(visible).not.toContain("App tracking");
    expect(visible).not.toContain("Reports");
    expect(visible).not.toContain("People");
    expect(visible).not.toContain("Organization");
    expect(visible).not.toContain("Roles & permissions");
  });

  it("requires both organization and member read for the Organization item", () => {
    expect(labels(membership(["organization:read"]))).not.toContain("Organization");
    expect(labels(membership(["organization:read", "member:read"]))).toContain(
      "Organization",
    );
  });

  it("maps each team and workspace item to its exact permission", () => {
    expect(labels(membership(["member:read"]))).toContain("People");
    expect(labels(membership(["leave:approve"]))).toContain("Leave");
    expect(labels(membership(["leave:manage"]))).toContain("Leave");
    expect(labels(membership(["role:read"]))).toContain("Roles & permissions");
    expect(labels(membership(["screenshot:read"]))).toContain("Screenshot review");
    expect(labels(membership(["screenshot:policy"]))).toContain("Monitoring settings");
  });

  it("gates holiday navigation by view and management permissions", () => {
    expect(labels(membership(["holiday:view"]))).toContain("Holiday calendar");
    expect(labels(membership(["holiday:view"]))).not.toContain("Holiday management");
    // Management permissions cannot open the calendar endpoint on their own.
    expect(labels(membership(["holiday:create"]))).not.toContain("Holiday management");
    expect(labels(membership(["holiday:settings:manage"]))).not.toContain(
      "Holiday management",
    );
    expect(labels(membership(["holiday:view", "holiday:create"]))).toContain(
      "Holiday management",
    );
    expect(labels(membership(["holiday:view", "holiday:settings:manage"]))).toContain(
      "Holiday management",
    );
    expect(labels(membership([]))).not.toContain("Holiday calendar");
  });

  it("keeps time-scoped self-service items available without team access", () => {
    const visible = labels(membership(["time:read", "time:write"]));

    expect(visible).toContain("My attendance");
    expect(visible).toContain("Corrections");
    expect(visible).not.toContain("Reports");
    expect(visible).not.toContain("App tracking");
  });

  it("collapses to the permission-free overview when nothing is granted", () => {
    const groups = visibleNavigationGroups(membership([]));

    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((item) => item.label)).toEqual(["Overview"]);
  });
});
