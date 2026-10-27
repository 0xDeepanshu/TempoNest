"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { apiRequest } from "@/lib/api-client";
import { errorMessage } from "@/lib/api-error";
import type { SessionData } from "@/lib/types";
import { ArrowRightIcon, BuildingIcon, LogOutIcon, ShieldIcon } from "./icons";
import { ThemeToggle } from "./theme-toggle";
import { Avatar, Badge, cn } from "./ui";

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  {
    href: "/superadmin",
    label: "Organizations",
    icon: <BuildingIcon className="h-4 w-4" />,
  },
  {
    href: "/superadmin/audit-log",
    label: "Audit log",
    icon: <ShieldIcon className="h-4 w-4" />,
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/superadmin") {
    return pathname === href || pathname.startsWith("/superadmin/organizations");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({
  item,
  onNavigate,
  compact = false,
}: {
  item: NavItem;
  onNavigate?: () => void;
  compact?: boolean;
}) {
  const pathname = usePathname();
  const active = isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-lg font-medium transition-colors",
        compact ? "px-2.5 py-1.5 text-xs" : "px-2.5 py-1.5 text-[13px]",
        active
          ? "bg-ink text-on-strong"
          : "text-ink-secondary hover:bg-surface-hover hover:text-ink",
      )}
    >
      <span className={active ? "text-on-strong/70" : "text-muted"}>{item.icon}</span>
      {item.label}
    </Link>
  );
}

export function SuperadminShell({
  session,
  children,
}: {
  session: SessionData;
  children: ReactNode;
}) {
  const router = useRouter();
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

  const userCard = (
    <div className="flex items-center gap-2.5 px-1 py-1.5">
      <Avatar name={session.user.name} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-ink">{session.user.name}</p>
        <p className="truncate text-[10px] text-muted">{session.user.email}</p>
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
  );

  return (
    <div className="min-h-screen bg-canvas">
      <a
        href="#platform-main"
        className="sr-only rounded-lg bg-ink px-3 py-2 text-sm font-medium text-on-strong focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50"
      >
        Skip to content
      </a>

      <aside
        aria-label="Platform sidebar"
        className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-line bg-surface lg:flex"
      >
        <div className="flex h-14 items-center gap-2 border-b border-line px-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-ink text-xs font-semibold text-on-strong">
            T
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold tracking-tight text-ink">TempoNest</p>
            <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted">
              Platform console
            </p>
          </div>
        </div>
        <div className="border-b border-line px-3 py-2.5">
          <Badge tone="indigo">Platform admin</Badge>
        </div>
        <nav aria-label="Platform" className="flex-1 space-y-0.5 overflow-y-auto px-2.5 py-3">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.href} item={item} />
          ))}
        </nav>
        <div className="space-y-2 border-t border-line p-3">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 rounded-lg border border-line bg-surface-muted px-2.5 py-2 text-[11px] font-medium text-ink-secondary transition-colors hover:text-ink"
          >
            <ArrowRightIcon className="h-3.5 w-3.5 shrink-0 text-muted" />
            Back to workspace
          </Link>
          <ThemeToggle className="w-full justify-center" />
          {userCard}
          {logoutError ? <p className="px-1 text-[10px] text-danger">{logoutError}</p> : null}
        </div>
      </aside>

      <div className="lg:pl-56">
        <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur lg:hidden">
          <div className="flex h-14 items-center justify-between gap-3 px-4">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-ink text-[11px] font-semibold text-on-strong">
                T
              </span>
              <div>
                <p className="text-[13px] font-semibold leading-4 text-ink">TempoNest</p>
                <p className="text-[9px] font-medium uppercase tracking-[0.12em] text-muted">
                  Platform console
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <ThemeToggle />
              <button
                type="button"
                onClick={logout}
                disabled={loggingOut}
                className="rounded-lg p-2 text-muted transition-colors hover:bg-surface-hover hover:text-danger disabled:opacity-50"
                aria-label="Sign out"
              >
                <LogOutIcon className="h-4 w-4" />
              </button>
            </div>
          </div>
          <nav aria-label="Platform" className="flex gap-1 px-3 pb-2">
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.href} item={item} compact />
            ))}
          </nav>
        </header>

        <main
          id="platform-main"
          tabIndex={-1}
          className="mx-auto w-full max-w-[1280px] px-4 py-5 outline-none sm:px-6 lg:px-8 lg:py-7"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
