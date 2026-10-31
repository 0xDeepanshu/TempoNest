import { NextResponse, type NextRequest } from "next/server";
import { backendApiUrl } from "@/lib/backend";
import {
  accessExpiryFromCookies,
  clearAuthCookieHeaders,
  getCookieValue,
  makeAccessHintCookie,
  mergeCookieHeader,
} from "@/lib/cookies";
import { refreshOnce } from "@/lib/refresh";

const PUBLIC_PATHS = new Set([
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/invitations/accept",
]);

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}

function loginRedirect(request: NextRequest, clearCookies: boolean): NextResponse {
  const url = new URL("/login", request.url);
  const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  if (next !== "/") url.searchParams.set("next", next);
  const response = NextResponse.redirect(url);
  if (clearCookies) {
    for (const cookie of clearAuthCookieHeaders(process.env.NODE_ENV === "production")) {
      response.headers.append("set-cookie", cookie);
    }
  }
  return response;
}

function continueWithCookies(
  request: NextRequest,
  setCookies: string[],
): NextResponse {
  const headers = new Headers(request.headers);
  const merged = mergeCookieHeader(request.headers.get("cookie"), setCookies);
  if (merged) headers.set("cookie", merged);

  const response = NextResponse.next({ request: { headers } });
  for (const cookie of setCookies) {
    response.headers.append("set-cookie", cookie);
  }
  return response;
}

/**
 * Returns true when the access cookie appears valid. This is only used for
 * sessions created outside this portal, where the access-expiry hint cookie is
 * absent. It never replaces backend authorization.
 */
async function accessCookieWorks(accessToken: string): Promise<"valid" | "expired" | "unreachable"> {
  try {
    const response = await fetch(backendApiUrl("/auth/me"), {
      headers: {
        Accept: "application/json",
        Cookie: `tn_access=${encodeURIComponent(accessToken)}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(6_000),
    });
    if (response.ok) return "valid";
    if (response.status === 401) return "expired";
    return "expired";
  } catch {
    return "unreachable";
  }
}

async function refreshSession(
  request: NextRequest,
  refreshToken: string,
  csrfToken: string | null,
): Promise<NextResponse> {
  const outcome = await refreshOnce(refreshToken, csrfToken);

  if (!outcome.ok) {
    if (outcome.status === 401 || outcome.status === 403) {
      return loginRedirect(request, true);
    }
    // A transient backend failure should not destroy a valid session. Let the
    // request continue; the server layout will send the user to /login if the
    // session truly cannot be read.
    return NextResponse.next();
  }

  const setCookies = [...outcome.setCookies];
  const expiry = accessExpiryFromCookies(outcome.setCookies);
  if (expiry) {
    const secure =
      process.env.NODE_ENV === "production" ||
      outcome.setCookies.some((cookie) => /;\s*Secure\b/i.test(cookie));
    setCookies.push(makeAccessHintCookie(expiry, secure));
  }
  return continueWithCookies(request, setCookies);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const cookieHeader = request.headers.get("cookie");
  const accessToken = getCookieValue(cookieHeader, "tn_access");
  const refreshToken = getCookieValue(cookieHeader, "tn_refresh");
  const csrfToken = getCookieValue(cookieHeader, "tn_csrf");
  const hint = getCookieValue(cookieHeader, "tn_access_exp");

  if (!accessToken && !refreshToken) {
    return loginRedirect(request, false);
  }

  if (accessToken && hint) {
    const expiresAt = Date.parse(hint);
    if (!Number.isNaN(expiresAt) && expiresAt > Date.now() + 15_000) {
      return NextResponse.next();
    }
    if (!refreshToken) return loginRedirect(request, true);
    return refreshSession(request, refreshToken, csrfToken);
  }

  if (accessToken) {
    const probe = await accessCookieWorks(accessToken);
    if (probe === "valid") {
      const response = NextResponse.next();
      const secure = request.nextUrl.protocol === "https:";
      response.headers.append(
        "set-cookie",
        makeAccessHintCookie(new Date(Date.now() + 5 * 60_000).toISOString(), secure),
      );
      return response;
    }
    if (probe === "unreachable") return NextResponse.next();
  }

  if (!refreshToken) return loginRedirect(request, true);
  return refreshSession(request, refreshToken, csrfToken);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
