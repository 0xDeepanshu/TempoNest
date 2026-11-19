import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "@/lib/api-client";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiRequest session expiry events", () => {
  it("emits tn:auth-expired only for a 401 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(401, {
          error: { code: "UNAUTHENTICATED", message: "Sign in to continue." },
        }),
      ),
    );
    const listener = vi.fn();
    window.addEventListener("tn:auth-expired", listener);

    try {
      await expect(apiRequest("/auth/me")).rejects.toMatchObject({ status: 401 });
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("tn:auth-expired", listener);
    }
  });

  it("does not treat rate limiting as an authentication failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(429, {
          error: {
            code: "RATE_LIMITED",
            message: "Too many requests. Please try again later.",
          },
        }),
      ),
    );
    const listener = vi.fn();
    window.addEventListener("tn:auth-expired", listener);

    try {
      await expect(apiRequest("/auth/me")).rejects.toMatchObject({
        status: 429,
        code: "RATE_LIMITED",
      });
      expect(listener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("tn:auth-expired", listener);
    }
  });
});

describe("apiRequest permission events", () => {
  it("emits tn:permission-denied for a PERMISSION_DENIED response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(403, {
          error: {
            code: "PERMISSION_DENIED",
            message: "Your role does not permit this action.",
          },
        }),
      ),
    );
    const listener = vi.fn();
    window.addEventListener("tn:permission-denied", listener);

    try {
      await expect(apiRequest("/organizations/org-1/reports/sessions")).rejects.toMatchObject({
        status: 403,
        code: "PERMISSION_DENIED",
      });
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("tn:permission-denied", listener);
    }
  });

  it("leaves other authorization failures to the calling component", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(403, {
          error: { code: "INSUFFICIENT_ROLE", message: "Not allowed." },
        }),
      ),
    );
    const listener = vi.fn();
    window.addEventListener("tn:permission-denied", listener);

    try {
      await expect(apiRequest("/organizations/org-1/roles")).rejects.toMatchObject({
        status: 403,
        code: "INSUFFICIENT_ROLE",
      });
      expect(listener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("tn:permission-denied", listener);
    }
  });
});
