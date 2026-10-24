import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
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
