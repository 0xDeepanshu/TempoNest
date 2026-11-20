"use client";

import Link from "next/link";
import {
  hasAnyPermission,
  hasPermission,
  type Permission,
  type PermissionActor,
} from "@/lib/permissions";
import { cn } from "./ui";
import { useWorkspace } from "./workspace";

export type SettingsTab = "general" | "roles" | "leave" | "monitoring";

export interface SettingsTabDefinition {
  value: SettingsTab;
  label: string;
  href: string;
  permission?: Permission;
  anyOf?: Permission[];
  allOf?: Permission[];
}

const TABS: SettingsTabDefinition[] = [
  {
    value: "general",
    label: "General",
    href: "/settings/general",
    allOf: ["organization:read", "member:read"],
  },
  {
    value: "roles",
    label: "Roles & permissions",
    href: "/settings/roles",
    permission: "role:read",
  },
  {
    value: "leave",
    label: "Leave & holidays",
    href: "/settings/leave",
    anyOf: ["leave:manage", "holiday:settings:manage"],
  },
  {
    value: "monitoring",
    label: "Monitoring",
    href: "/settings/monitoring",
    anyOf: ["screenshot:policy", "activity:policy"],
  },
];

export function visibleSettingsTabs(actor: PermissionActor): SettingsTabDefinition[] {
  return TABS.filter((tab) => {
    if (tab.permission && !hasPermission(actor, tab.permission)) return false;
    if (tab.anyOf && !hasAnyPermission(actor, tab.anyOf)) return false;
    if (tab.allOf && !tab.allOf.every((permission) => hasPermission(actor, permission))) {
      return false;
    }
    return true;
  });
}

function tabClass(active: boolean): string {
  return cn(
    "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
    active ? "bg-ink text-on-strong" : "text-muted hover:bg-surface-muted hover:text-ink",
  );
}

export function SettingsTabs({ current }: { current: SettingsTab }) {
  const { membership } = useWorkspace();
  const visible = visibleSettingsTabs(membership);

  if (visible.length === 0) return null;

  return (
    <nav
      aria-label="Settings"
      className="flex flex-wrap gap-0.5 rounded-lg border border-line bg-surface p-0.5"
    >
      {visible.map((tab) => (
        <Link
          key={tab.value}
          href={tab.href}
          aria-current={tab.value === current ? "page" : undefined}
          className={tabClass(tab.value === current)}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Second-level navigation inside one settings tab. It uses real links so each
 * section keeps a stable, shareable URL.
 */
export function SettingsSubNav({
  label,
  current,
  items,
}: {
  label: string;
  current: string;
  items: Array<{ value: string; label: string; href: string; visible?: boolean }>;
}) {
  const visible = items.filter((item) => item.visible !== false);
  if (visible.length < 2) return null;

  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-1">
      {visible.map((item) => {
        const active = item.value === current;
        return (
          <Link
            key={item.value}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
              active
                ? "border-ink/30 bg-surface-muted text-ink"
                : "border-transparent text-muted hover:bg-surface-muted hover:text-ink",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
