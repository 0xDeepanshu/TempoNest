"use client";

import Link from "next/link";
import { hasAnyPermission, hasPermission, type Permission } from "@/lib/permissions";
import { cn } from "./ui";
import { useWorkspace } from "./workspace";

export type ActivityTab = "overview" | "classifications";

const TABS: Array<{
  value: ActivityTab;
  label: string;
  href: string;
  permission: Permission;
}> = [
  {
    value: "overview",
    label: "Team overview",
    href: "/admin/activity/team",
    permission: "report:read",
  },
  {
    value: "classifications",
    label: "App categories",
    href: "/admin/activity/classifications",
    permission: "report:read",
  },
];

/**
 * Activity review navigation. Tracking and capture configuration moved to
 * Settings → Monitoring so this area stays read-and-review only.
 */
export function ActivityTabs({ current }: { current: ActivityTab }) {
  const { membership } = useWorkspace();
  const visible = TABS.filter((tab) => hasPermission(membership, tab.permission));
  const canOpenSettings = hasAnyPermission(membership, [
    "activity:policy",
    "screenshot:policy",
  ]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <nav
        aria-label="App activity"
        className="flex flex-wrap gap-0.5 rounded-lg border border-line bg-surface p-0.5"
      >
        {visible.map((tab) => {
          const active = tab.value === current;
          return (
            <Link
              key={tab.value}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                active
                  ? "bg-accent-soft text-accent-soft-ink"
                  : "text-muted hover:bg-surface-muted hover:text-ink",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      {canOpenSettings ? (
        <Link
          href="/settings/monitoring/tracking"
          className="rounded-md px-2 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-muted hover:text-ink"
        >
          Tracking settings
        </Link>
      ) : null}
    </div>
  );
}
