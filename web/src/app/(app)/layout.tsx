import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireSession } from "@/lib/server-session";

// The session read is request-time. Opt this segment out of instant-navigation
// validation so the authenticated shell can block on the server while it is
// being migrated to finer-grained Suspense boundaries.
export const instant = false;

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  return <AppShell session={session}>{children}</AppShell>;
}
