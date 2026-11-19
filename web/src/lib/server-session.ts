import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { backendApiUrl } from "./backend";
import type { SessionData } from "./types";

/**
 * Raised when the backend cannot confirm the session for a transient reason
 * (rate limit, outage). Callers must not treat this as a signed-out user.
 */
export class SessionUnavailableError extends Error {
  constructor(readonly status: number) {
    super(
      status === 429
        ? "Too many requests. Wait a moment, then reload."
        : "WorkZen is temporarily unavailable. Try again shortly.",
    );
    this.name = "SessionUnavailableError";
  }
}

/**
 * Server-side session read. The access/refresh cookies stay HttpOnly; this BFF
 * asks the backend who the caller is and returns only public session data.
 *
 * Only a 401 means "not signed in". A rate-limited or failing backend must not
 * send an authenticated user to the login page.
 */
export const getSession = cache(async (): Promise<SessionData | null> => {
  const cookieHeader = (await cookies()).toString();
  if (!cookieHeader) return null;

  let response: Response;
  try {
    response = await fetch(backendApiUrl("/auth/me"), {
      headers: {
        Accept: "application/json",
        Cookie: cookieHeader,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new SessionUnavailableError(0);
  }

  if (response.status === 401) return null;
  if (!response.ok) throw new SessionUnavailableError(response.status);

  const body = (await response.json()) as { data?: SessionData };
  return body.data ?? null;
});

export async function requireSession(): Promise<SessionData> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/**
 * Hides the platform console from anyone without the database-backed platform
 * role. The backend re-checks the role on every /platform request, so this guard
 * is only an early exit for rendering.
 */
export async function requirePlatformAdmin(): Promise<SessionData> {
  const session = await requireSession();
  if (session.user.status !== "ACTIVE" || session.platformRole !== "SUPERADMIN") {
    notFound();
  }
  return session;
}
