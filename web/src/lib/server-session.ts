import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { backendApiUrl } from "./backend";
import type { SessionData } from "./types";

/**
 * Server-side session read. The access/refresh cookies stay HttpOnly; this BFF
 * asks the backend who the caller is and returns only public session data.
 */
export const getSession = cache(async (): Promise<SessionData | null> => {
  const cookieHeader = (await cookies()).toString();
  if (!cookieHeader) return null;

  try {
    const response = await fetch(backendApiUrl("/auth/me"), {
      headers: {
        Accept: "application/json",
        Cookie: cookieHeader,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: SessionData };
    return body.data ?? null;
  } catch {
    return null;
  }
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
