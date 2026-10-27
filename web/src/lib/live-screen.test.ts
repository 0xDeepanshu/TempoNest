import { describe, expect, it } from "vitest";
import { liveScreenWebSocketUrl } from "@/lib/live-screen";

const PATH = "/api/v1/ws/screen-live";

describe("liveScreenWebSocketUrl", () => {
  it("requires a configured browser-reachable backend origin", () => {
    expect(() => liveScreenWebSocketUrl(PATH, "")).toThrow(/NEXT_PUBLIC_API_WS_URL/);
    expect(() => liveScreenWebSocketUrl(PATH, undefined)).toThrow(/NEXT_PUBLIC_API_WS_URL/);
  });

  it("maps http origins to ws and adds the API prefix", () => {
    expect(liveScreenWebSocketUrl(PATH, "http://localhost:4000")).toBe(
      "ws://localhost:4000/api/v1/ws/screen-live",
    );
  });

  it("maps https origins to wss", () => {
    expect(liveScreenWebSocketUrl(PATH, "https://api.example.com")).toBe(
      "wss://api.example.com/api/v1/ws/screen-live",
    );
  });

  it("does not duplicate an API prefix already present on the base", () => {
    expect(liveScreenWebSocketUrl(PATH, "wss://api.example.com/api/v1/")).toBe(
      "wss://api.example.com/api/v1/ws/screen-live",
    );
  });

  it("drops any existing base query and hash", () => {
    expect(liveScreenWebSocketUrl(PATH, "ws://localhost:4000/base?debug=1#x")).toBe(
      "ws://localhost:4000/base/api/v1/ws/screen-live",
    );
  });

  it("never includes credentials in the URL", () => {
    expect(liveScreenWebSocketUrl(PATH, "wss://api.example.com")).not.toMatch(
      /ticket|token|auth/i,
    );
  });

  it("rejects invalid protocols, URLs, and relay paths", () => {
    expect(() => liveScreenWebSocketUrl(PATH, "ftp://localhost:4000")).toThrow(
      /ws, wss, http, or https/,
    );
    expect(() => liveScreenWebSocketUrl(PATH, "not a url")).toThrow(/invalid/);
    expect(() => liveScreenWebSocketUrl("/ws/screen-live", "ws://localhost:4000")).toThrow(
      /path is invalid/,
    );
  });
});
