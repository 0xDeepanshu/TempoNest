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
  KeyIcon,
  LogOutIcon,
  MapPinIcon,
  MenuIcon,
  MonitorIcon,
  PulseIcon,
  ShieldIcon,
  UsersIcon,
} from "./icons";
import { ThemeToggle } from "./theme-toggle";
import { Avatar, ErrorState, RoleBadge } from "./ui";
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
        label: "Holiday management",
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
      {
        href: "/admin/attendance",
        label: "Attendance evidence",
        icon: <MapPinIcon className="h-4 w-4" />,
        permission: "report:read",
      },
    ],
  },
  {
    label: "Monitoring",
    items: [
      {
        href: "/admin/activity",
        label: "App tracking",
        icon: <MonitorIcon className="h-4 w-4" />,
        // The landing page reads tracking settings (time:read) and the team
        // views read reports (report:read). General report access alone must
        // not surface the monitoring area.
        allOf: ["time:read", "report:read"],
      },
      {
        href: "/admin/screenshots",
        label: "Screenshot review",
        icon: <CameraIcon className="h-4 w-4" />,
        permission: "screenshot:read",
      },
      {
        href: "/admin/monitoring",
        label: "Monitoring settings",
        icon: <ShieldIcon className="h-4 w-4" />,
        permission: "screenshot:policy",
      },
    ],
  },
  {
    label: "Workspace",
    items: [
      {
        href: "/admin/roles",
        label: "Roles & permissions",
        icon: <KeyIcon className="h-4 w-4" />,
        permission: "role:read",
      },
      {
        href: "/admin/organization",
        label: "Organization",
        icon: <BuildingIcon className="h-4 w-4" />,
        // The page lives under the admin layout and lists members, so both the
        // organization profile and the directory must be readable.
        allOf: ["organization:read", "member:read"],
      },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function navItemAllowed(
  item: NavItem,
  membership: MembershipSummary | undefined,
): boolean {
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

function NavLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={[
        "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors",
        active
          ? "bg-ink text-on-strong"
          : "text-ink-secondary hover:bg-surface-hover hover:text-ink",
      ].join(" ")}
    >
      <span className={active ? "text-on-strong/70" : "text-muted"}>{item.icon}</span>
      {item.label}
    </Link>
  );
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const { membership } = useWorkspace();
  const groups = visibleNavigationGroups(membership);

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
              <NavLink key={item.href} item={item} onNavigate={onNavigate} />
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
          className="w-full rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-xs font-medium text-ink outline-none transition focus:border-ink focus:ring-2 focus:ring-ink/10"
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
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-ink text-xs font-semibold text-on-strong">
            T
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold tracking-tight text-ink">TempoNest</p>
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
              className="mb-2 flex items-center gap-2 rounded-lg bg-ink px-2.5 py-2 text-[11px] font-medium text-on-strong transition-colors hover:bg-ink-secondary"
            >
              <ShieldIcon className="h-3.5 w-3.5 shrink-0 text-on-strong/70" />
              Platform admin
              <ArrowRightIcon className="ml-auto h-3.5 w-3.5" />
            </Link>
          ) : null}
          <Link
            href="/attendance"
            onClick={onNavigate}
            className="mb-2 flex items-start gap-2 rounded-lg border border-line bg-surface-muted px-2.5 py-2 text-[11px] leading-4 text-muted transition-colors hover:text-ink"
          >
            <ClockIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Online tracking is controlled by the desktop agent.
          </Link>
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
        className="sr-only rounded-lg bg-ink px-3 py-2 text-sm font-medium text-on-strong focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50"
      >
        Skip to content
      </a>

      <aside
        aria-label="Sidebar"
        className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-line bg-surface lg:block"
      >
        {renderSidebar()}
      </aside>

      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur lg:hidden">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-ink text-[11px] font-semibold text-on-strong">
              T
            </span>
            <span className="text-[13px] font-semibold text-ink">TempoNest</span>
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
              className="absolute inset-y-0 left-0 w-72 border-r border-line bg-surface shadow-xl"
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
          className="mx-auto w-full max-w-[1440px] px-4 py-5 outline-none sm:px-6 lg:px-8 lg:py-7"
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
