import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SuperadminShell } from "@/components/superadmin-shell";
import { requirePlatformAdmin } from "@/lib/server-session";

export const metadata: Metadata = {
  title: {
    default: "Platform console",
    template: "%s · TempoNest Platform",
  },
};

export const instant = false;

export default async function SuperadminLayout({ children }: { children: ReactNode }) {
  const session = await requirePlatformAdmin();
  return <SuperadminShell session={session}>{children}</SuperadminShell>;
}
