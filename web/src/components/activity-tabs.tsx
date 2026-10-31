"use client";

import Link from "next/link";
import { hasPermission, type Permission } from "@/lib/permissions";
import { cn } from "./ui";
import { useWorkspace } from "./workspace";

export type ActivityTab = "settings" | "classifications" | "team";

const TABS: Array<{
  value: ActivityTab;
  label: string;
  href: string;
  permission: Permission;
}> = [
  {
    value: "settings",
    label: "Tracking settings",
    href: "/admin/activity",
    permission: "time:read",
  },
  {
    value: "classifications",
    label: "Classifications",
    href: "/admin/activity/classifications",
    permission: "report:read",
  },
  {
    value: "team",
    label: "Team overview",
    href: "/admin/activity/team",
    permission: "report:read",
  },
];

export function ActivityTabs({ current }: { current: ActivityTab }) {
  const { membership } = useWorkspace();
  const visible = TABS.filter((tab) => hasPermission(membership, tab.permission));

  return (
    <nav
      aria-label="App tracking"
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
                ? "bg-ink text-on-strong"
                : "text-muted hover:bg-surface-muted hover:text-ink",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
