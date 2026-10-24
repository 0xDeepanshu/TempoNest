const AUTH_COOKIE_NAMES = new Set(["tn_access", "tn_refresh", "tn_csrf", "tn_access_exp"]);

export function getSetCookieList(headers: Headers): string[] {
  const extended = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof extended.getSetCookie === "function") {
    return extended.getSetCookie();
  }
  const combined = headers.get("set-cookie");
  if (!combined) return [];
  // Fallback for runtimes without getSetCookie(). Expires contains a comma, so
  // split on commas followed by a cookie name rather than every comma.
  return combined.split(/,(?=\s*[^;,=\s]+=)/g).map((value) => value.trim());
}

export function setCookieName(cookie: string): string {
  const separator = cookie.indexOf("=");
  return separator === -1 ? "" : cookie.slice(0, separator).trim();
}

export function setCookieValue(cookie: string): string {
  const separator = cookie.indexOf("=");
  if (separator === -1) return "";
  const end = cookie.indexOf(";", separator);
  return decodeURIComponent(cookie.slice(separator + 1, end === -1 ? undefined : end));
}

export function cookiePath(cookie: string): string | null {
  const match = /;\s*Path=([^;]*)/i.exec(cookie);
  return match ? match[1].trim() : null;
}

/**
 * The backend scopes the refresh cookie to /api/v1/auth. This portal is a
 * same-origin BFF, so the server needs that cookie on ordinary API requests to
 * perform transparent refresh. Widening the HttpOnly cookie to "/" keeps it
 * inaccessible to JavaScript while making refresh work from the BFF and Proxy.
 */
export function rewriteAuthCookie(cookie: string): string {
  const name = setCookieName(cookie);
  if (!AUTH_COOKIE_NAMES.has(name)) return cookie;
  if (/;\s*Path=/i.test(cookie)) {
    return cookie.replace(/;\s*Path=[^;]*/i, "; Path=/");
  }
  return `${cookie}; Path=/`;
}

export function rewriteAuthCookies(cookies: string[]): string[] {
  return cookies.map(rewriteAuthCookie);
}

export function isSecureCookie(cookie: string): boolean {
  return /;\s*Secure\b/i.test(cookie);
}

export function accessExpiryFromCookies(cookies: string[]): string | null {
  const accessCookie = cookies.find((cookie) => setCookieName(cookie) === "tn_access");
  if (!accessCookie) return null;
  const expires = /;\s*Expires=([^;]+)/i.exec(accessCookie);
  if (expires) {
    const parsed = Date.parse(expires[1]);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return null;
}

export function makeAccessHintCookie(expiresAt: string, secure: boolean): string {
  const expires = new Date(expiresAt);
  return [
    `tn_access_exp=${encodeURIComponent(expires.toISOString())}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expires.toUTCString()}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function clearAuthCookieHeaders(secure = false): string[] {
  return ["tn_access", "tn_refresh", "tn_csrf", "tn_access_exp"].map((name) =>
    [
      `${name}=`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      "Max-Age=0",
      "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
      ...(secure ? ["Secure"] : []),
    ].join("; "),
  );
}

export function getCookieValue(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const entry = part.trim();
    const prefix = `${name}=`;
    if (entry.startsWith(prefix)) {
      return decodeURIComponent(entry.slice(prefix.length));
    }
  }
  return null;
}

export function mergeCookieHeader(cookieHeader: string | null, setCookies: string[]): string {
  const jar = new Map<string, string>();
  if (cookieHeader) {
    for (const part of cookieHeader.split(";")) {
      const entry = part.trim();
      const separator = entry.indexOf("=");
      if (separator === -1) continue;
      jar.set(entry.slice(0, separator), entry.slice(separator + 1));
    }
  }
  for (const cookie of setCookies) {
    const name = setCookieName(cookie);
    if (!name) continue;
    if (/;\s*Max-Age=0\b/i.test(cookie)) {
      jar.delete(name);
      continue;
    }
    jar.set(name, encodeURIComponent(setCookieValue(cookie)));
  }
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

export function hasSessionCookies(cookieHeader: string | null | undefined): boolean {
  return Boolean(
    getCookieValue(cookieHeader, "tn_access") || getCookieValue(cookieHeader, "tn_refresh"),
  );
}
