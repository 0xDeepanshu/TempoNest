/**
 * Accepts only same-origin, path-based redirect targets. This prevents the
 * `next` query parameter from being used as an open redirect.
 */
export function safeNext(
  value: string | null | undefined,
  fallback = "/dashboard",
): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  if (value.startsWith("/login") || value.startsWith("/register")) return fallback;
  return value;
}
