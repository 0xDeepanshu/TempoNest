const API_PREFIX = "/api/v1";

/**
 * Builds the direct backend WebSocket URL for the live view relay.
 *
 * The Next.js BFF only proxies HTTP. Live frames therefore connect straight to
 * the backend origin configured at build time. The one-time ticket is never
 * placed in the URL: it is sent as the first application message so it cannot
 * leak through proxy or access logs.
 */
export function liveScreenWebSocketUrl(
  websocketPath: string,
  configuredBase: string | undefined = process.env.NEXT_PUBLIC_API_WS_URL,
): string {
  const base = configuredBase?.trim();
  if (!base) {
    throw new Error(
      "Live screen viewing is not configured for this deployment. Ask an administrator to set NEXT_PUBLIC_API_WS_URL.",
    );
  }

  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new Error("The live screen WebSocket address is invalid.");
  }

  if (url.protocol === "http:") url.protocol = "ws:";
  else if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("The live screen WebSocket address must use ws, wss, http, or https.");
  }

  const path = websocketPath.startsWith("/") ? websocketPath : `/${websocketPath}`;
  if (!path.startsWith(`${API_PREFIX}/`)) {
    throw new Error("The live screen WebSocket path is invalid.");
  }

  const basePath = url.pathname.replace(/\/+$/, "");
  const prefix = basePath.endsWith(API_PREFIX)
    ? basePath.slice(0, -API_PREFIX.length)
    : basePath;
  url.pathname = `${prefix}${path}`.replace(/\/{2,}/g, "/");
  url.search = "";
  url.hash = "";
  return url.toString();
}
