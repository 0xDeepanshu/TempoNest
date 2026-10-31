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
