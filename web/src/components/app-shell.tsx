"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { apiRequest } from "@/lib/api-client";
import { errorMessage } from "@/lib/api-error";
import { hasPermission, type Permission } from "@/lib/permissions";
import type { SessionData } from "@/lib/types";
import {
  BuildingIcon,
  CameraIcon,
  ChartIcon,
  CheckSquareIcon,
  ClockIcon,
  CloseIcon,
  DashboardIcon,
  EditIcon,
  LogOutIcon,
  MenuIcon,
  PulseIcon,
  ShieldIcon,
  UsersIcon,
} from "./icons";
import { Avatar, ErrorState, RoleBadge } from "./ui";
import { WorkspaceProvider, useWorkspace } from "./workspace";

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  permission?: Permission;
}

const MY_WORK: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: <DashboardIcon className="h-4 w-4" /> },
  { href: "/attendance", label: "Attendance", icon: <ClockIcon className="h-4 w-4" /> },
  { href: "/corrections", label: "Corrections", icon: <EditIcon className="h-4 w-4" /> },
];

const TEAM: NavItem[] = [
  {
    href: "/admin",
    label: "Team overview",
    icon: <DashboardIcon className="h-4 w-4" />,
    permission: "report:read",
  },
  {
    href: "/admin/employees",
    label: "People",
    icon: <UsersIcon className="h-4 w-4" />,
    permission: "member:read",
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
    href: "/admin/corrections",
    label: "Correction review",
    icon: <CheckSquareIcon className="h-4 w-4" />,
    permission: "correction:review",
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
  {
    href: "/admin/organization",
    label: "Organization",
    icon: <BuildingIcon className="h-4 w-4" />,
    permission: "organization:read",
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={[
        "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition",
        active
          ? "bg-indigo-50 text-indigo-700"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
      ].join(" ")}
    >
      <span className={active ? "text-indigo-600" : "text-slate-400"}>{item.icon}</span>
      {item.label}
    </Link>
  );
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const { membership } = useWorkspace();
  const role = membership?.role;
  const teamItems = TEAM.filter((item) => !item.permission || hasPermission(role, item.permission));

  return (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
      <div>
        <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
          My work
        </p>
        <div className="space-y-1">
          {MY_WORK.map((item) => (
            <NavLink key={item.href} item={item} onNavigate={onNavigate} />
          ))}
        </div>
      </div>
      {teamItems.length > 0 ? (
        <div>
          <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
            Team
          </p>
          <div className="space-y-1">
            {teamItems.map((item) => (
              <NavLink key={item.href} item={item} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      ) : null}
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
          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        >
          {activeMemberships.map((item) => (
            <option key={item.organizationId} value={item.organizationId}>
              {item.organization?.name}
            </option>
          ))}
        </select>
      ) : (
        <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-2">
          <BuildingIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span className="truncate text-xs font-semibold text-slate-700">
            {organization.name}
          </span>
        </div>
      )}
      <div className="flex items-center gap-2 px-1">
        <RoleBadge role={membership.role} />
        <span className="truncate text-[11px] text-slate-400">{organization.timezone}</span>
      </div>
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { membership, organization, user } = useWorkspace();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  useEffect(() => {
    function onExpired() {
      router.replace("/login");
    }
    window.addEventListener("tn:auth-expired", onExpired);
    return () => window.removeEventListener("tn:auth-expired", onExpired);
  }, [router]);

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

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-2.5 border-b border-slate-100 px-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-black text-white">
          T
        </span>
        <div>
          <p className="text-sm font-bold tracking-tight text-slate-900">TempoNest</p>
          <p className="text-[10px] font-medium uppercase tracking-widest text-slate-400">
            Work portal
          </p>
        </div>
      </div>
      <div className="border-b border-slate-100 p-3">
        <WorkspaceControls />
      </div>
      <Navigation />
      <div className="border-t border-slate-100 p-3">
        <Link
          href="/attendance"
          className="mb-2 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-4 text-slate-500"
        >
          <ClockIcon className="h-3.5 w-3.5 shrink-0" />
          Online tracking is controlled by the desktop agent.
        </Link>
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
          <Avatar name={user.name} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-slate-800">{user.name}</p>
            <p className="truncate text-[10px] text-slate-400">{user.email}</p>
          </div>
          <button
            type="button"
            onClick={logout}
            disabled={loggingOut}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-rose-600 disabled:opacity-50"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOutIcon className="h-4 w-4" />
          </button>
        </div>
        {logoutError ? <p className="px-2 text-[10px] text-rose-600">{logoutError}</p> : null}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-200 bg-white lg:block">
        {sidebar}
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur lg:hidden">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-600 text-xs font-black text-white">
              T
            </span>
            <span className="text-sm font-bold text-slate-900">TempoNest</span>
          </div>
          <div className="flex items-center gap-2">
            {membership ? <RoleBadge role={membership.role} /> : null}
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
              aria-label="Open navigation"
            >
              <MenuIcon className="h-5 w-5" />
            </button>
          </div>
        </header>

        {mobileOpen ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-slate-900/40"
              aria-label="Close navigation"
              onClick={() => setMobileOpen(false)}
            />
            <div className="absolute inset-y-0 left-0 w-72 bg-white shadow-xl">
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="absolute right-3 top-4 z-10 rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                aria-label="Close navigation"
              >
                <CloseIcon className="h-5 w-5" />
              </button>
              {sidebar}
            </div>
          </div>
        ) : null}

        <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
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
