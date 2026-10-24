import type { NextRequest } from "next/server";
import { backendApiUrl } from "@/lib/backend";
import {
  accessExpiryFromCookies,
  clearAuthCookieHeaders,
  getCookieValue,
  getSetCookieList,
  isSecureCookie,
  makeAccessHintCookie,
  mergeCookieHeader,
  rewriteAuthCookies,
} from "@/lib/cookies";
import { refreshOnce } from "@/lib/refresh";

interface RouteContext {
  params: Promise<{ path: string[] }>;
}

const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "accept-language",
  "authorization",
  "content-type",
  "idempotency-key",
  "origin",
  "referer",
  "user-agent",
  "x-csrf-token",
  "x-organization-id",
  "x-request-id",
];

const FORWARDED_RESPONSE_HEADERS = [
  "content-disposition",
  "content-type",
  "ratelimit-limit",
  "ratelimit-policy",
  "ratelimit-remaining",
  "ratelimit-reset",
  "retry-after",
  "www-authenticate",
  "x-request-id",
];

const NO_REFRESH_PATHS = new Set([
  "auth/login",
  "auth/register",
  "auth/refresh",
  "auth/logout",
]);

function upstreamHeaders(
  request: NextRequest,
  cookieHeader: string | null,
  csrfOverride?: string | null,
): Headers {
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (cookieHeader) headers.set("cookie", cookieHeader);
  if (csrfOverride) headers.set("x-csrf-token", csrfOverride);
  return headers;
}

function shouldRefresh(status: number, path: string, request: NextRequest): boolean {
  if (status !== 401) return false;
  if (NO_REFRESH_PATHS.has(path)) return false;
  if (request.headers.get("authorization")) return false;
  return Boolean(getCookieValue(request.headers.get("cookie"), "tn_refresh"));
}

function responseHeaders(upstream: Response, setCookies: string[]): Headers {
  const headers = new Headers();
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("cache-control", "no-store");
  for (const cookie of setCookies) headers.append("set-cookie", cookie);
  return headers;
}

async function respond(upstream: Response, setCookies: string[]): Promise<Response> {
  const status = upstream.status;
  const body =
    status === 204 || status === 304 || upstream.body === null
      ? null
      : await upstream.arrayBuffer();
  return new Response(body, {
    status,
    statusText: upstream.statusText,
    headers: responseHeaders(upstream, setCookies),
  });
}

async function handle(request: NextRequest, context: RouteContext): Promise<Response> {
  const { path: segments } = await context.params;
  const path = segments.join("/");
  const target = backendApiUrl(`/${segments.map(encodeURIComponent).join("/")}${request.nextUrl.search}`);

  const cookieHeader = request.headers.get("cookie");
  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  const body = hasBody ? await request.arrayBuffer() : undefined;

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method,
      headers: upstreamHeaders(request, cookieHeader),
      ...(body && body.byteLength > 0 ? { body } : {}),
      cache: "no-store",
      redirect: "manual",
    });
  } catch {
    return Response.json(
      {
        error: {
          code: "BACKEND_UNAVAILABLE",
          message:
            "The TempoNest API is unavailable. Check that the backend is running and reachable.",
        },
      },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }

  let setCookies = rewriteAuthCookies(getSetCookieList(upstream.headers));

  if (shouldRefresh(upstream.status, path, request)) {
    const refreshToken = getCookieValue(cookieHeader, "tn_refresh")!;
    const csrfToken = getCookieValue(cookieHeader, "tn_csrf");
    const outcome = await refreshOnce(refreshToken, csrfToken);

    if (outcome.ok) {
      setCookies = [...outcome.setCookies];
      const mergedCookie = mergeCookieHeader(cookieHeader, outcome.setCookies);
      const newCsrf = getCookieValue(mergedCookie, "tn_csrf");
      try {
        upstream = await fetch(target, {
          method,
          headers: upstreamHeaders(request, mergedCookie, newCsrf),
          ...(body && body.byteLength > 0 ? { body } : {}),
          cache: "no-store",
          redirect: "manual",
        });
        setCookies.push(...rewriteAuthCookies(getSetCookieList(upstream.headers)));
      } catch {
        return Response.json(
          {
            error: {
              code: "BACKEND_UNAVAILABLE",
              message:
                "The TempoNest API is unavailable. Check that the backend is running and reachable.",
            },
          },
          { status: 502, headers: { "cache-control": "no-store" } },
        );
      }
    } else if (outcome.status === 401 || outcome.status === 403) {
      const secure =
        isSecureCookie(cookieHeader ?? "") || process.env.NODE_ENV === "production";
      setCookies.push(...clearAuthCookieHeaders(secure));
    }
  }

  const secure = setCookies.some(isSecureCookie) || process.env.NODE_ENV === "production";
  const accessExpiry = accessExpiryFromCookies(setCookies);
  if (accessExpiry) setCookies.push(makeAccessHintCookie(accessExpiry, secure));

  return respond(upstream, setCookies);
}

export function GET(request: NextRequest, context: RouteContext) {
  return handle(request, context);
}

export function POST(request: NextRequest, context: RouteContext) {
  return handle(request, context);
}

export function PATCH(request: NextRequest, context: RouteContext) {
  return handle(request, context);
}

export function PUT(request: NextRequest, context: RouteContext) {
  return handle(request, context);
}

export function DELETE(request: NextRequest, context: RouteContext) {
  return handle(request, context);
}

export function OPTIONS(request: NextRequest, context: RouteContext) {
  return handle(request, context);
}
