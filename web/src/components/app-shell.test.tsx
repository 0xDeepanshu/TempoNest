import { describe, expect, it, vi } from "vitest";
import { activeNavigationHref, visibleNavigationGroups } from "@/components/app-shell";
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
      expect.arrayContaining(["Reports", "Live tracking", "Attendance logs"]),
    );
    expect(visible).not.toContain("My attendance");
    expect(visible).not.toContain("Corrections");
    expect(visible).not.toContain("People");
    expect(visible).not.toContain("App tracking");
    expect(visible).not.toContain("Screenshots");
    expect(visible).not.toContain("Settings");
  });

  it("keeps the built-in EMPLOYEE navigation free of management areas", () => {
    const visible = labels(membership(undefined, { role: "EMPLOYEE" }));

    expect(visible).toEqual(
      expect.arrayContaining(["My attendance", "My leaves", "Corrections"]),
    );
    expect(visible).toContain("Holiday calendar");
    expect(visible).not.toContain("Holidays");
    expect(visible).not.toContain("App tracking");
    expect(visible).not.toContain("Reports");
    expect(visible).not.toContain("People");
    expect(visible).not.toContain("Settings");
  });

  it("shows the single Settings item only when a section is readable", () => {
    // Organization read alone is not enough: General also needs member read,
    // and no other section is granted.
    expect(labels(membership(["organization:read"]))).not.toContain("Settings");
    expect(labels(membership(["organization:read", "member:read"]))).toContain(
      "Settings",
    );
    expect(labels(membership(["role:read"]))).toContain("Settings");
    expect(labels(membership([]))).not.toContain("Settings");
  });

  it("maps live and settings areas to their exact permission", () => {
    expect(labels(membership(["member:read"]))).toContain("People");
    expect(labels(membership(["leave:approve"]))).toContain("Leave");
    expect(labels(membership(["leave:manage"]))).toContain("Leave");
    expect(labels(membership(["role:read"]))).toContain("Settings");
    expect(labels(membership(["screenshot:read"]))).toContain("Screenshots");
    // Screenshot configuration lives in Settings, not in the live nav.
    expect(labels(membership(["screenshot:policy"]))).toContain("Settings");
    // Scheduled capture is a section inside Screenshots, never its own item.
    expect(labels(membership(["screenshot:monitoring"]))).not.toContain(
      "Scheduled screenshots",
    );
    expect(labels(membership(["screenshot:read"]))).not.toContain(
      "Scheduled screenshots",
    );
  });

  it("gates holiday navigation by view and management permissions", () => {
    expect(labels(membership(["holiday:view"]))).toContain("Holiday calendar");
    expect(labels(membership(["holiday:view"]))).not.toContain("Holidays");
    // Management permissions cannot open the calendar endpoint on their own.
    expect(labels(membership(["holiday:create"]))).not.toContain("Holidays");
    expect(labels(membership(["holiday:settings:manage"]))).not.toContain(
      "Holidays",
    );
    expect(labels(membership(["holiday:view", "holiday:create"]))).toContain(
      "Holidays",
    );
    expect(labels(membership(["holiday:view", "holiday:settings:manage"]))).toContain(
      "Holidays",
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

describe("activeNavigationHref", () => {
  const manager = membership([
    "report:read",
    "time:read",
    "screenshot:read",
    "screenshot:policy",
    "leave:manage",
    "holiday:view",
    "holiday:settings:manage",
  ]);

  it("highlights only the most specific matching item", () => {
    expect(activeNavigationHref("/admin/leave/holidays", manager)).toBe(
      "/admin/leave/holidays",
    );
    expect(activeNavigationHref("/admin/leave/requests", manager)).toBe("/admin/leave");
    // Every settings route points at the single Settings item.
    expect(activeNavigationHref("/settings/leave/holidays", manager)).toBe("/settings");
    expect(activeNavigationHref("/settings/roles", manager)).toBe("/settings");
    expect(activeNavigationHref("/admin/activity/classifications", manager)).toBe(
      "/admin/activity/team",
    );
  });

  it("returns null when nothing matches", () => {
    expect(activeNavigationHref("/unrelated", manager)).toBeNull();
  });

  it("only considers items the membership can see", () => {
    const employee = membership(undefined, { role: "EMPLOYEE" });
    // An employee cannot open any settings section, so no Settings highlight.
    expect(activeNavigationHref("/settings/roles", employee)).toBeNull();
  });
});
