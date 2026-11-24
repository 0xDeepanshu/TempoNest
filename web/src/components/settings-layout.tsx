"use client";

import type { ReactNode } from "react";
import { SettingsNav } from "./settings-tabs";
import { PageHeader } from "./ui";
import { useWorkspace } from "./workspace";

/**
 * Settings shell. Every settings page shares one header and one left-hand
 * navigation so the hub feels like a single surface instead of four separate
 * admin pages.
 *
 * All of these settings are organization-wide. This build has no per-client
 * configuration layer, so nothing is labelled as client-specific.
 */
export function SettingsLayout({ children }: { children: ReactNode }) {
  const { organization } = useWorkspace();

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={organization ? `${organization.name} · organization-wide` : "Organization-wide"}
        title="Settings"
        description="These rules apply to everyone in this organization. Only sections you can manage are shown."
      />

      <div className="grid items-start gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <SettingsNav />
        <div className="min-w-0 space-y-5">{children}</div>
      </div>
    </div>
  );
}
