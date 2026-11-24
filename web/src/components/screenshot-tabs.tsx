"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { hasPermission } from "@/lib/permissions";
import { cn } from "./ui";
import { useWorkspace } from "./workspace";

/**
 * Screenshots and scheduled capture are two views of the same surface, so they
 * share this compact switcher instead of taking separate sidebar slots.
 */
export function ScreenshotSectionTabs() {
  const pathname = usePathname() ?? "";
  const { membership } = useWorkspace();

  const tabs = [
    hasPermission(membership, "screenshot:read")
      ? { href: "/admin/screenshots", label: "Screenshots" }
      : null,
    hasPermission(membership, "screenshot:monitoring")
      ? { href: "/admin/scheduled-capture", label: "Scheduled screenshots" }
      : null,
  ].filter((tab): tab is { href: string; label: string } => tab !== null);

  if (tabs.length < 2) return null;

  return (
    <nav
      aria-label="Screenshot views"
      className="inline-flex flex-wrap gap-0.5 rounded-lg border border-line bg-surface p-0.5"
    >
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
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
  );
}
