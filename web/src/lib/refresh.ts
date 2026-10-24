import { backendApiUrl } from "./backend";
import { getSetCookieList, rewriteAuthCookies } from "./cookies";

export interface RefreshOutcome {
  ok: boolean;
  status: number;
  setCookies: string[];
  code?: string;
}

export async function performRefresh(
  refreshToken: string,
  csrfToken: string | null,
): Promise<RefreshOutcome> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    Cookie: [
      `tn_refresh=${encodeURIComponent(refreshToken)}`,
      ...(csrfToken ? [`tn_csrf=${encodeURIComponent(csrfToken)}`] : []),
    ].join("; "),
    "X-CSRF-Token": csrfToken ?? "",
  };

  try {
    const response = await fetch(backendApiUrl("/auth/refresh"), {
      method: "POST",
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });

    const setCookies = rewriteAuthCookies(getSetCookieList(response.headers));

    if (!response.ok) {
      let code: string | undefined;
      try {
        const body = (await response.json()) as { error?: { code?: string } };
        code = body.error?.code;
      } catch {
        code = undefined;
      }
      return { ok: false, status: response.status, setCookies, code };
    }

    return { ok: true, status: response.status, setCookies };
  } catch {
    return { ok: false, status: 0, setCookies: [], code: "BACKEND_UNAVAILABLE" };
  }
}

interface RefreshFlight {
  promise: Promise<RefreshOutcome>;
  expiresAt: number;
}

const flights = new Map<string, RefreshFlight>();

/**
 * Refresh tokens rotate and the backend revokes a session family if a rotated
 * token is presented again. Concurrent BFF requests with the same cookie must
 * therefore await one refresh instead of racing.
 */
export function refreshOnce(
  refreshToken: string,
  csrfToken: string | null,
): Promise<RefreshOutcome> {
  const now = Date.now();
  for (const [key, flight] of flights) {
    if (flight.expiresAt <= now) flights.delete(key);
  }

  const existing = flights.get(refreshToken);
  if (existing && existing.expiresAt > now) return existing.promise;

  const promise = performRefresh(refreshToken, csrfToken);
  flights.set(refreshToken, { promise, expiresAt: now + 30_000 });

  if (flights.size > 100) {
    const oldest = flights.keys().next().value;
    if (oldest) flights.delete(oldest);
  }

  return promise;
}
