import { describe, expect, it } from "vitest";
import { isDefinitiveRefreshFailure, transientRefreshStatus } from "@/lib/refresh";

describe("refresh outcome classification", () => {
  it("treats 401 and 403 as definitive session failures", () => {
    expect(isDefinitiveRefreshFailure({ ok: false, status: 401, setCookies: [] })).toBe(true);
    expect(isDefinitiveRefreshFailure({ ok: false, status: 403, setCookies: [] })).toBe(true);
  });

  it("treats rate limiting, server errors, and network failures as transient", () => {
    for (const status of [429, 500, 502, 503, 0]) {
      expect(isDefinitiveRefreshFailure({ ok: false, status, setCookies: [] })).toBe(false);
    }
    expect(isDefinitiveRefreshFailure({ ok: true, status: 200, setCookies: [] })).toBe(false);
  });

  it("surfaces rate limiting as 429 and everything else transient as 503", () => {
    expect(transientRefreshStatus({ ok: false, status: 429, setCookies: [] })).toBe(429);
    expect(transientRefreshStatus({ ok: false, status: 500, setCookies: [] })).toBe(503);
    expect(transientRefreshStatus({ ok: false, status: 0, setCookies: [] })).toBe(503);
  });
});
