"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  hasAnyPermission,
  hasPermission,
  type Permission,
  type PermissionActor,
} from "@/lib/permissions";
import { cn } from "./ui";
import { useWorkspace } from "./workspace";

export type SettingsTab = "general" | "roles" | "leave" | "monitoring";

export interface SettingsLink {
  value: string;
  label: string;
  href: string;
  /** Short line shown under the link on the settings index. */
  description?: string;
  permission?: Permission;
  anyOf?: Permission[];
  allOf?: Permission[];
}

export interface SettingsTabDefinition extends SettingsLink {
  value: SettingsTab;
  children?: SettingsLink[];
}

export const SETTINGS_TABS: SettingsTabDefinition[] = [
  {
    value: "general",
    label: "General",
    href: "/settings/general",
    description: "Organization profile, timezone, and the people directory.",
    // The page lists members, so both the organization profile and the
    // directory must be readable.
    allOf: ["organization:read", "member:read"],
  },
  {
    value: "roles",
    label: "Roles & permissions",
    href: "/settings/roles",
    description: "Decide what each role can see and do.",
    permission: "role:read",
  },
  {
    value: "leave",
    label: "Leave & holidays",
    href: "/settings/leave",
    description: "Leave types, how days are earned, and company holidays.",
    anyOf: ["leave:manage", "holiday:settings:manage"],
    children: [
      {
        value: "leave-types",
        label: "Leave types",
        href: "/settings/leave",
        permission: "leave:manage",
      },
      {
        value: "leave-holidays",
        label: "Holiday rules",
        href: "/settings/leave/holidays",
        anyOf: ["holiday:view", "holiday:settings:manage"],
      },
    ],
  },
  {
    value: "monitoring",
    label: "Monitoring",
    href: "/settings/monitoring",
    description: "Screenshots, app tracking, and how long records are kept.",
    anyOf: ["screenshot:policy", "activity:policy"],
    children: [
      {
        value: "monitoring-screenshots",
        label: "Screenshots",
        href: "/settings/monitoring",
        permission: "screenshot:policy",
      },
      {
        value: "monitoring-tracking",
        label: "App tracking",
        href: "/settings/monitoring/tracking",
        anyOf: ["activity:policy", "time:read"],
      },
    ],
  },
];

function allowed(
  definition: Pick<SettingsLink, "permission" | "anyOf" | "allOf">,
  actor: PermissionActor,
): boolean {
  if (definition.permission && !hasPermission(actor, definition.permission)) return false;
  if (definition.anyOf && !hasAnyPermission(actor, definition.anyOf)) return false;
  if (definition.allOf && !definition.allOf.every((permission) => hasPermission(actor, permission))) {
    return false;
  }
  return true;
}

function visibleChildren(
  tab: SettingsTabDefinition,
  actor: PermissionActor,
): SettingsLink[] {
  return (tab.children ?? []).filter((child) => allowed(child, actor));
}

/**
 * A settings section is visible when its own permissions pass. Sections with
 * sub-pages also need at least one readable sub-page so the hub never links to
 * an empty area.
 */
export function visibleSettingsTabs(actor: PermissionActor): SettingsTabDefinition[] {
  return SETTINGS_TABS.filter((tab) => {
    if (!allowed(tab, actor)) return false;
    if (tab.children && tab.children.length > 0) {
      return visibleChildren(tab, actor).length > 0;
    }
    return true;
  });
}

function linkMatches(pathname: string, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The most specific section link for the current URL. */
export function activeSettingsHref(pathname: string, actor: PermissionActor): string | null {
  const candidates: string[] = [];
  for (const tab of visibleSettingsTabs(actor)) {
    candidates.push(tab.href);
    for (const child of visibleChildren(tab, actor)) candidates.push(child.href);
  }

  let best: string | null = null;
  for (const href of candidates) {
    if (!linkMatches(pathname, href)) continue;
    if (!best || href.length > best.length) best = href;
  }
  return best;
}

/**
 * Left-hand navigation shared by every Settings page. Each section keeps its
 * own URL so it can be bookmarked and shared. On small screens the same links
 * become a wrapped row above the content.
 */
export function SettingsNav() {
  const pathname = usePathname() ?? "";
  const { membership } = useWorkspace();
  const visible = visibleSettingsTabs(membership);
  const current = activeSettingsHref(pathname, membership);

  if (visible.length === 0) return null;

  const topLevelLinks = visible.map((tab) => ({
    key: tab.value,
    href: tab.href,
    label: tab.label,
    active: current === tab.href,
  }));
  const childLinks = visible.flatMap((tab) =>
    visibleChildren(tab, membership).map((child) => ({
      key: `${tab.value}-${child.value}`,
      href: child.href,
      label: child.label,
      active: current === child.href,
    })),
  );

  return (
    <nav aria-label="Settings" className="lg:sticky lg:top-20">
      <p className="mb-2 hidden px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted lg:block">
        Settings
      </p>

      {/* Small screens: every section and sub-section in one wrapped row. */}
      <div className="flex flex-wrap gap-1 lg:hidden">
        {[...topLevelLinks, ...childLinks].map((item) => (
          <Link
            key={item.key}
            href={item.href}
            aria-current={item.active ? "page" : undefined}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              item.active
                ? "bg-accent-soft text-accent-soft-ink"
                : "border border-line text-ink-secondary hover:bg-surface-hover hover:text-ink",
            )}
          >
            {item.label}
          </Link>
        ))}
      </div>

      {/* Desktop: grouped sections with nested sub-pages. */}
      <div className="hidden space-y-1 lg:block">
        {visible.map((tab) => {
          const children = visibleChildren(tab, membership);
          const groupActive =
            current === tab.href || children.some((child) => child.href === current);
          return (
            <div key={tab.value}>
              <Link
                href={tab.href}
                aria-current={current === tab.href ? "page" : undefined}
                className={cn(
                  "flex items-center rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
                  groupActive
                    ? "bg-accent-soft text-accent-soft-ink"
                    : "text-ink-secondary hover:bg-surface-hover hover:text-ink",
                )}
              >
                {tab.label}
              </Link>
              {children.length > 1 ? (
                <div className="mt-1 space-y-0.5 border-l border-line pl-3 ml-3">
                  {children.map((child) => (
                    <Link
                      key={child.value}
                      href={child.href}
                      aria-current={current === child.href ? "page" : undefined}
                      className={cn(
                        "block rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                        current === child.href
                          ? "text-ink"
                          : "text-muted hover:bg-surface-muted hover:text-ink",
                      )}
                    >
                      {child.label}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
