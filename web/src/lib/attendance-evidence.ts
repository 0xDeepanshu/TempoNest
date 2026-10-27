/**
 * Local-disk attendance evidence is served by the API with a signed,
 * short-lived token. When the browser and API use different hosts (for example
 * the web app on localhost and the API on a LAN address), the API's same-site
 * resource policy blocks the image. Route those paths through the same-origin
 * Next.js API proxy, which forwards the signed request unchanged. Presigned
 * object-storage URLs are already reachable and stay absolute.
 */
export function privateEvidenceImageUrl(url: string): string {
  try {
    const parsed = new URL(url, "http://temponest.invalid");
    if (parsed.pathname.startsWith("/api/v1/attendance-files/")) {
      return `${parsed.pathname}${parsed.search}`;
    }
  } catch {
    // Leave the value untouched; the image element reports any load failure.
  }
  return url;
}
