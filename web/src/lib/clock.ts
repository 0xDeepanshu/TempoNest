/**
 * Wrapper around the current wall clock. Keeping it in a small module makes the
 * dependency explicit and keeps component modules free of direct impure global
 * calls that the React compiler flags.
 */
export function nowMs(): number {
  return Date.now();
}
