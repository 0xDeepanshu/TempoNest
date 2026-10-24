import { describe, expect, it } from "vitest";
import { ApiError, errorMessage, isApiError, parseApiError } from "@/lib/api-error";

describe("parseApiError", () => {
  it("reads the backend error envelope", () => {
    const error = parseApiError(400, {
      error: {
        code: "VALIDATION_ERROR",
        message: "The request is invalid.",
        details: [{ path: "body.startedAt", message: "Must not be in the future." }],
      },
      requestId: "req-1",
    });

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.message).toBe("The request is invalid.");
    expect(error.details).toEqual([
      { path: "body.startedAt", message: "Must not be in the future." },
    ]);
    expect(error.requestId).toBe("req-1");
  });

  it("falls back to safe messages when the envelope is missing", () => {
    expect(parseApiError(500, null).message).toBe(
      "The server could not complete this request. Please try again.",
    );
    expect(parseApiError(401, {}).code).toBe("UNAUTHENTICATED");
    expect(parseApiError(409, {}).code).toBe("REQUEST_FAILED");
    expect(parseApiError(409, {}).message).toBe("The request could not be completed.");
  });

  it("normalizes field paths for form errors", () => {
    const error = parseApiError(422, {
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid",
        details: [
          { path: "body.breaks.0.startedAt", message: "Break starts before session." },
          { path: "reason", message: "Too short." },
        ],
      },
    });

    expect(error.fieldError("breaks.0.startedAt")).toBe("Break starts before session.");
    expect(error.fieldError("body.reason")).toBe("Too short.");
    expect(error.fieldError("endedAt")).toBeUndefined();
  });
});

describe("error helpers", () => {
  it("recognizes ApiError instances", () => {
    const error = new ApiError({ status: 403, code: "FORBIDDEN", message: "No." });
    expect(isApiError(error)).toBe(true);
    expect(isApiError(new Error("No."))).toBe(false);
    expect(error.details).toEqual([]);
  });

  it("extracts a user-facing message", () => {
    expect(errorMessage(new Error("Boom"))).toBe("Boom");
    expect(errorMessage("Boom")).toBe("Something went wrong. Please try again.");
    expect(errorMessage(undefined)).toBe("Something went wrong. Please try again.");
  });
});
