import { describe, expect, it } from "vitest";
import {
  accessExpiryFromCookies,
  clearAuthCookieHeaders,
  cookiePath,
  getCookieValue,
  getSetCookieList,
  hasSessionCookies,
  isSecureCookie,
  makeAccessHintCookie,
  mergeCookieHeader,
  rewriteAuthCookie,
  setCookieName,
  setCookieValue,
} from "@/lib/cookies";

describe("set-cookie parsing", () => {
  it("reads names and values", () => {
    expect(setCookieName("tn_access=abc; Path=/")).toBe("tn_access");
    expect(setCookieValue("tn_access=abc%20def; Path=/")).toBe("abc def");
    expect(setCookieName("invalid")).toBe("");
    expect(setCookieValue("invalid")).toBe("");
  });

  it("reads the Path attribute", () => {
    expect(cookiePath("tn_refresh=abc; Path=/api/v1/auth; HttpOnly")).toBe("/api/v1/auth");
    expect(cookiePath("tn_access=abc; HttpOnly")).toBeNull();
  });

  it("splits combined headers without breaking Expires commas", () => {
    const headers = {
      get: () =>
        "tn_access=one; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT; HttpOnly, tn_refresh=two; Path=/api/v1/auth; HttpOnly",
    } as unknown as Headers;

    const cookies = getSetCookieList(headers);
    expect(cookies).toHaveLength(2);
    expect(setCookieName(cookies[0])).toBe("tn_access");
    expect(setCookieName(cookies[1])).toBe("tn_refresh");
  });

  it("uses getSetCookie when the runtime provides it", () => {
    const headers = {
      getSetCookie: () => ["tn_access=one; Path=/", "tn_refresh=two; Path=/"],
    } as unknown as Headers;

    expect(getSetCookieList(headers)).toHaveLength(2);
  });
});

describe("auth cookie rewriting", () => {
  it("widens known auth cookies to the site root", () => {
    expect(rewriteAuthCookie("tn_refresh=abc; Path=/api/v1/auth; HttpOnly; SameSite=Lax")).toBe(
      "tn_refresh=abc; Path=/; HttpOnly; SameSite=Lax",
    );
    expect(rewriteAuthCookie("tn_access=abc; path=/api/v1/auth")).toBe(
      "tn_access=abc; Path=/",
    );
  });

  it("adds a root path when the attribute is absent", () => {
    expect(rewriteAuthCookie("tn_csrf=token; HttpOnly")).toBe(
      "tn_csrf=token; HttpOnly; Path=/",
    );
  });

  it("leaves unrelated cookies untouched", () => {
    expect(rewriteAuthCookie("theme=dark; Path=/settings")).toBe("theme=dark; Path=/settings");
  });

  it("detects the Secure flag", () => {
    expect(isSecureCookie("tn_access=abc; Secure; Path=/")).toBe(true);
    expect(isSecureCookie("tn_access=abc; Path=/")).toBe(false);
  });
});

describe("access expiry hint", () => {
  it("derives expiry from the Set-Cookie header", () => {
    const expires = new Date("2026-10-23T12:00:00.000Z").toUTCString();
    expect(accessExpiryFromCookies([`tn_access=abc; Expires=${expires}; Path=/`])).toBe(
      "2026-10-23T12:00:00.000Z",
    );
    expect(accessExpiryFromCookies(["tn_refresh=abc; Path=/"])).toBeNull();
  });

  it("creates a non-JavaScript-readable hint cookie", () => {
    const hint = makeAccessHintCookie("2026-10-23T12:00:00.000Z", true);
    expect(hint).toContain("tn_access_exp=");
    expect(hint).toContain("Path=/");
    expect(hint).toContain("HttpOnly");
    expect(hint).toContain("SameSite=Lax");
    expect(hint).toContain("Secure");
    expect(hint).toContain(`Expires=${new Date("2026-10-23T12:00:00.000Z").toUTCString()}`);
  });

  it("clears every auth cookie at the root path", () => {
    const headers = clearAuthCookieHeaders(true);
    expect(headers).toHaveLength(4);
    for (const header of headers) {
      expect(header).toContain("Path=/");
      expect(header).toContain("Max-Age=0");
      expect(header).toContain("HttpOnly");
      expect(header).toContain("Secure");
    }
  });
});

describe("cookie jar helpers", () => {
  it("reads a named cookie", () => {
    expect(getCookieValue("a=1; tn_csrf=token%2B1; b=2", "tn_csrf")).toBe("token+1");
    expect(getCookieValue("a=1", "tn_csrf")).toBeNull();
    expect(getCookieValue(null, "tn_csrf")).toBeNull();
  });

  it("merges rotated cookies and removes cleared ones", () => {
    const merged = mergeCookieHeader("tn_access=old; tn_csrf=keep; stale=1", [
      "tn_access=new; Path=/",
      "stale=; Max-Age=0; Path=/",
    ]);
    expect(merged).toContain("tn_access=new");
    expect(merged).toContain("tn_csrf=keep");
    expect(merged).not.toContain("stale=");
  });

  it("detects session cookies", () => {
    expect(hasSessionCookies("tn_access=abc")).toBe(true);
    expect(hasSessionCookies("tn_refresh=abc")).toBe(true);
    expect(hasSessionCookies("tn_csrf=abc")).toBe(false);
    expect(hasSessionCookies(null)).toBe(false);
  });
});
