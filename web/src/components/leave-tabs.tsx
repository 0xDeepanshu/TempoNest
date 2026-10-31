"use client";

import Link from "next/link";
import { hasAnyPermission, hasPermission, type Permission } from "@/lib/permissions";
import { cn } from "./ui";
import { useWorkspace } from "./workspace";

export type LeaveTab =
  | "overview"
  | "requests"
  | "balances"
  | "types"
  | "holidays"
  | "holiday-settings";

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
  {
    value: "types",
    label: "Types & policies",
    href: "/admin/leave/types",
    permission: "leave:manage",
  },
  {
    value: "holidays",
    label: "Holidays",
    href: "/admin/leave/holidays",
    permission: "holiday:view",
  },
  {
    value: "holiday-settings",
    label: "Holiday settings",
    href: "/admin/leave/holidays/settings",
    permission: "holiday:view",
  },
];

export function LeaveTabs({ current }: { current: LeaveTab }) {
  const { membership } = useWorkspace();
  const visible = TABS.filter((tab) =>
    tab.permission
      ? hasPermission(membership, tab.permission)
      : hasAnyPermission(membership, tab.anyOf ?? []),
  );

  return (
    <nav
      aria-label="Leave management"
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
