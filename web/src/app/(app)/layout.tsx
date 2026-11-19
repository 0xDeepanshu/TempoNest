import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui";
import {
  requireSession,
  SessionUnavailableError,
} from "@/lib/server-session";

// The session read is request-time. Opt this segment out of instant-navigation
// validation so the authenticated shell can block on the server while it is
// being migrated to finer-grained Suspense boundaries.
export const instant = false;

function SessionUnavailable({ status }: { status: number }) {
  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <Card className="p-6 text-center">
        <h1 className="text-lg font-semibold tracking-tight text-ink">
          {status === 429 ? "Too many requests" : "WorkZen is temporarily unavailable"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          {status === 429
            ? "The API is rate limiting requests right now. Wait a minute, then reload the page."
            : "Your session could not be confirmed because the API is unavailable. Reload to try again."}
        </p>
        <p className="mt-2 text-xs text-muted">
          You are still signed in; no session data was cleared.
        </p>
      </Card>
    </main>
  );
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  try {
    const session = await requireSession();
    return <AppShell session={session}>{children}</AppShell>;
  } catch (error) {
    if (error instanceof SessionUnavailableError) {
      return <SessionUnavailable status={error.status} />;
    }
    throw error;
  }
}
