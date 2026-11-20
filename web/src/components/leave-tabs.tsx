"use client";

import Link from "next/link";
import { hasAnyPermission, hasPermission, type Permission } from "@/lib/permissions";
import { cn } from "./ui";
import { useWorkspace } from "./workspace";

export type LeaveTab = "overview" | "requests" | "balances";

const REVIEW_PERMISSIONS: Permission[] = ["leave:approve", "leave:manage"];

const TABS: Array<{
  value: LeaveTab;
  label: string;
  href: string;
  permission?: Permission;
  anyOf?: Permission[];
}> = [
  {
    value: "overview",
    label: "Overview",
    href: "/admin/leave",
    anyOf: REVIEW_PERMISSIONS,
  },
  {
    value: "requests",
    label: "Requests",
    href: "/admin/leave/requests",
    anyOf: REVIEW_PERMISSIONS,
  },
  {
    value: "balances",
    label: "Balances",
    href: "/admin/leave/balances",
    permission: "leave:manage",
  },
];

/**
 * Day-to-day leave navigation. Leave types and holiday rules are configuration,
 * so they live under Settings → Leave & holidays instead of duplicating here.
 */
export function LeaveTabs({ current }: { current: LeaveTab }) {
  const { membership } = useWorkspace();
  const visible = TABS.filter((tab) =>
    tab.permission
      ? hasPermission(membership, tab.permission)
      : hasAnyPermission(membership, tab.anyOf ?? []),
  );
  const canOpenSettings = hasAnyPermission(membership, [
    "leave:manage",
    "holiday:settings:manage",
  ]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <nav
        aria-label="Leave"
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
      {canOpenSettings ? (
        <Link
          href="/settings/leave"
          className="rounded-md px-2 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-muted hover:text-ink"
        >
          Leave settings
        </Link>
      ) : null}
    </div>
  );
}
