"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { apiRequest } from "@/lib/api-client";
import { errorMessage } from "@/lib/api-error";
import {
  hasAnyPermission,
  hasPermission,
  type Permission,
} from "@/lib/permissions";
import type { MembershipSummary, SessionData } from "@/lib/types";
import {
  ArrowRightIcon,
  BuildingIcon,
  CalendarIcon,
  CameraIcon,
  ChartIcon,
  ClockIcon,
  CloseIcon,
  DashboardIcon,
  EditIcon,
  LogOutIcon,
  MapPinIcon,
  MenuIcon,
  MonitorIcon,
  PulseIcon,
  SettingsIcon,
  ShieldIcon,
  UsersIcon,
} from "./icons";
import { ThemeToggle } from "./theme-toggle";
import { Avatar, ErrorState, RoleBadge } from "./ui";
import { visibleSettingsTabs } from "./settings-tabs";
import { WorkspaceProvider, useWorkspace } from "./workspace";

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  /** Single permission required to show the item. */
  permission?: Permission;
  /** Any one of these permissions unlocks the item. */
  anyOf?: Permission[];
  /** Every listed permission is required. */
  allOf?: Permission[];
  /**
   * Extra path prefix that keeps this item highlighted when the workspace
   * splits a surface across sibling routes (for example a hub with tabs).
   */
  activePrefix?: string;
  /** A surface with its own visibility rules, such as the Settings hub. */
  visibleWhen?: (membership: MembershipSummary | undefined) => boolean;
}

const NAV_GROUPS: Array<{ label?: string; items: NavItem[] }> = [
  {
    items: [
      { href: "/dashboard", label: "Overview", icon: <DashboardIcon className="h-4 w-4" /> },
    ],
  },
  {
    label: "Your time",
    items: [
      {
        href: "/attendance",
        label: "My attendance",
        icon: <ClockIcon className="h-4 w-4" />,
        permission: "time:read",
      },
      {
        href: "/leave",
        label: "My leaves",
        icon: <CalendarIcon className="h-4 w-4" />,
        permission: "leave:read",
      },
      {
        href: "/holidays",
        label: "Holiday calendar",
        icon: <CalendarIcon className="h-4 w-4" />,
        permission: "holiday:view",
      },
      {
        href: "/corrections",
        label: "Corrections",
        icon: <EditIcon className="h-4 w-4" />,
        anyOf: ["time:read", "time:write", "correction:review"],
      },
    ],
  },
  {
    label: "Team",
    items: [
      {
        href: "/admin/employees",
        label: "People",
        icon: <UsersIcon className="h-4 w-4" />,
        permission: "member:read",
      },
      {
        href: "/admin/leave",
        label: "Leave",
        icon: <CalendarIcon className="h-4 w-4" />,
        anyOf: ["leave:approve", "leave:manage"],
      },
      {
        href: "/admin/leave/holidays",
        label: "Holidays",
        icon: <CalendarIcon className="h-4 w-4" />,
        // The calendar itself requires read access; management permissions only
        // unlock the edit actions inside it.
        permission: "holiday:view",
        anyOf: [
          "holiday:create",
          "holiday:update",
          "holiday:delete",
          "holiday:settings:manage",
        ],
      },
      {
        href: "/admin/reports",
        label: "Reports",
        icon: <ChartIcon className="h-4 w-4" />,
        permission: "report:read",
      },
      {
        href: "/admin/live-tracking",
        label: "Live tracking",
        icon: <PulseIcon className="h-4 w-4" />,
        permission: "report:read",
      },
    ],
  },
  {
    label: "Monitoring",
    items: [
      {
        href: "/admin/activity/team",
        label: "App tracking",
        icon: <MonitorIcon className="h-4 w-4" />,
        // The activity surfaces read tracking settings (time:read) and reports
        // (report:read). General report access alone must not surface them.
        allOf: ["time:read", "report:read"],
        activePrefix: "/admin/activity",
      },
      {
        href: "/admin/screenshots",
        label: "Screenshots",
        icon: <CameraIcon className="h-4 w-4" />,
        permission: "screenshot:read",
        // Scheduled capture is a view inside Screenshots, so keep this item
        // highlighted on both routes.
        activePrefix: "/admin/scheduled-capture",
      },
      {
        href: "/admin/attendance",
        label: "Attendance logs",
        icon: <MapPinIcon className="h-4 w-4" />,
        permission: "report:read",
      },
    ],
  },
  {
    items: [
      {
        href: "/settings",
        label: "Settings",
        icon: <SettingsIcon className="h-4 w-4" />,
        activePrefix: "/settings",
        // The hub only appears when at least one settings section is readable.
        visibleWhen: (membership) => visibleSettingsTabs(membership).length > 0,
      },
    ],
  },
];

function itemMatchesPath(item: NavItem, pathname: string): boolean {
  const prefixes = item.activePrefix ? [item.href, item.activePrefix] : [item.href];
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Only one sidebar item may be active at a time. The most specific (longest)
 * matching route wins, so nested pages such as /admin/leave/holidays never also
 * light up their parent (/admin/leave).
 */
export function activeNavigationHref(
  pathname: string,
  membership: MembershipSummary | undefined,
): string | null {
  const groups = visibleNavigationGroups(membership);
  let best: { href: string; length: number } | null = null;

  for (const group of groups) {
    for (const item of group.items) {
      if (!itemMatchesPath(item, pathname)) continue;
      const length = (item.activePrefix ?? item.href).length;
      if (!best || length > best.length) {
        best = { href: item.href, length };
      }
    }
  }

  return best?.href ?? null;
}

function navItemAllowed(
  item: NavItem,
  membership: MembershipSummary | undefined,
): boolean {
  if (item.visibleWhen && !item.visibleWhen(membership)) return false;
  if (item.permission && !hasPermission(membership, item.permission)) return false;
  if (item.anyOf && !hasAnyPermission(membership, item.anyOf)) return false;
  if (item.allOf && !item.allOf.every((permission) => hasPermission(membership, permission))) {
    return false;
  }
  return true;
}

/**
 * Navigation mirrors the backend's effective permission list for the active
 * membership. Items disappear when their entry surface is not permitted; no
 * built-in role name or broader permission is used as a substitute.
 */
export function visibleNavigationGroups(membership: MembershipSummary | undefined) {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => navItemAllowed(item, membership)),
  })).filter((group) => group.items.length > 0);
}

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={[
        "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors",
        active
          ? "bg-accent text-accent-ink shadow-[0_1px_0_rgba(0,0,0,0.15)]"
          : "text-ink-secondary hover:bg-surface-hover hover:text-ink",
      ].join(" ")}
    >
      <span className={active ? "text-accent-ink/70" : "text-muted"}>{item.icon}</span>
      {item.label}
    </Link>
  );
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { membership } = useWorkspace();
  const groups = visibleNavigationGroups(membership);
  const activeHref = activeNavigationHref(pathname, membership);

  return (
    <nav aria-label="Primary" className="flex-1 space-y-5 overflow-y-auto px-2.5 py-4">
      {groups.map((group, index) => (
        <div key={group.label ?? `group-${index}`}>
          {group.label ? (
            <p className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
              {group.label}
            </p>
          ) : null}
          <div className="space-y-0.5">
            {group.items.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                active={item.href === activeHref}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

function WorkspaceControls() {
  const { activeMemberships, membership, organization, setOrganizationId } = useWorkspace();
  if (!organization || !membership) return null;

  return (
    <div className="space-y-2">
      {activeMemberships.length > 1 ? (
        <select
          aria-label="Organization"
          value={organization.id}
          onChange={(event) => setOrganizationId(event.target.value)}
          className="w-full rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-xs font-medium text-ink outline-none transition hover:border-line-strong focus:border-accent focus:ring-2 focus:ring-accent/25"
        >
          {activeMemberships.map((item) => (
            <option key={item.organizationId} value={item.organizationId}>
              {item.organization?.name}
            </option>
          ))}
        </select>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-muted px-2.5 py-1.5">
          <BuildingIcon className="h-3.5 w-3.5 shrink-0 text-muted" />
          <span className="truncate text-xs font-medium text-ink">{organization.name}</span>
        </div>
      )}
      <div className="flex items-center gap-2 px-0.5">
        <RoleBadge role={membership.role} customRoleName={membership.customRole?.name} />
        <span className="truncate text-[11px] text-muted">{organization.timezone}</span>
      </div>
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { membership, organization, session, user } = useWorkspace();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    function onExpired() {
      router.replace("/login");
    }
    window.addEventListener("tn:auth-expired", onExpired);
    return () => window.removeEventListener("tn:auth-expired", onExpired);
  }, [router]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMobileOpen(false);
        return;
      }
      if (event.key !== "Tab" || !drawerRef.current) return;
      const focusable = Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [mobileOpen]);

  async function logout() {
    setLoggingOut(true);
    setLogoutError(null);
    try {
      await apiRequest("/auth/logout", { method: "POST" });
      router.replace("/login");
      router.refresh();
    } catch (error) {
      setLogoutError(errorMessage(error));
      setLoggingOut(false);
    }
  }

  function renderSidebar(onNavigate?: () => void) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-14 items-center gap-2 border-b border-line px-3">
          <img src="/logo/logo-nobg.png" alt="WorkZen" className="h-7 w-7 shrink-0 object-contain" />
          <div className="min-w-0">
            <p className="text-[13px] font-semibold tracking-tight text-ink">WorkZen</p>
            <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted">
              Work portal
            </p>
          </div>
          <ThemeToggle className="ml-auto shrink-0" />
        </div>
        <div className="border-b border-line p-3">
          <WorkspaceControls />
        </div>
        <Navigation onNavigate={onNavigate} />
        <div className="border-t border-line p-3">
          {session.platformRole === "SUPERADMIN" ? (
            <Link
              href="/superadmin"
              onClick={onNavigate}
              className="mb-2 flex items-center gap-2 rounded-lg bg-accent px-2.5 py-2 text-[11px] font-medium text-accent-ink transition-colors hover:bg-accent-hover"
            >
              <ShieldIcon className="h-3.5 w-3.5 shrink-0 text-accent-ink/70" />
              Platform admin
              <ArrowRightIcon className="ml-auto h-3.5 w-3.5" />
            </Link>
          ) : null}
          <div className="flex items-center gap-2.5 px-1 py-1.5">
            <Avatar name={user.name} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-ink">{user.name}</p>
              <p className="truncate text-[10px] text-muted">{user.email}</p>
            </div>
            <button
              type="button"
              onClick={logout}
              disabled={loggingOut}
              className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-danger disabled:opacity-50"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOutIcon className="h-4 w-4" />
            </button>
          </div>
          {logoutError ? <p className="px-1 text-[10px] text-danger">{logoutError}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas">
      <a
        href="#main-content"
        className="sr-only rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-ink focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50"
      >
        Skip to content
      </a>

      <aside
        aria-label="Sidebar"
        className="ambient-sidebar fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-sidebar-border bg-sidebar lg:block"
      >
        {renderSidebar()}
      </aside>

      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur lg:hidden">
          <div className="flex items-center gap-2">
            <img src="/logo/logo-nobg.png" alt="WorkZen" className="h-6 w-6 object-contain" />
            <span className="text-[13px] font-semibold text-ink">WorkZen</span>
          </div>
          <div className="flex items-center gap-2">
            {membership ? (
              <span className="hidden sm:inline-flex">
                <RoleBadge role={membership.role} customRoleName={membership.customRole?.name} />
              </span>
            ) : null}
            <ThemeToggle />
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="rounded-lg p-2 text-ink-secondary transition-colors hover:bg-surface-hover"
              aria-label="Open navigation"
              aria-expanded={mobileOpen}
              aria-controls="mobile-navigation"
            >
              <MenuIcon className="h-5 w-5" />
            </button>
          </div>
        </header>

        {mobileOpen ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-overlay"
              aria-label="Close navigation"
              onClick={() => setMobileOpen(false)}
            />
            <div
              ref={drawerRef}
              id="mobile-navigation"
              role="dialog"
              aria-modal="true"
              aria-label="Navigation"
              className="ambient-sidebar absolute inset-y-0 left-0 w-72 border-r border-sidebar-border bg-sidebar shadow-xl"
            >
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setMobileOpen(false)}
                className="absolute right-3 top-3.5 z-10 rounded-lg p-2 text-muted transition-colors hover:bg-surface-hover hover:text-ink"
                aria-label="Close navigation"
              >
                <CloseIcon className="h-5 w-5" />
              </button>
              {renderSidebar(() => setMobileOpen(false))}
            </div>
          </div>
        ) : null}

        <main
          id="main-content"
          tabIndex={-1}
          className="ambient-top mx-auto w-full max-w-[1440px] px-4 py-5 outline-none sm:px-6 lg:px-8 lg:py-7"
        >
          {!organization ? (
            <div className="mb-4">
              <ErrorState message="No active organization is available for this account." />
            </div>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}

export function AppShell({
  session,
  children,
}: {
  session: SessionData;
  children: ReactNode;
}) {
  return (
    <WorkspaceProvider session={session}>
      <Shell>{children}</Shell>
    </WorkspaceProvider>
  );
}
