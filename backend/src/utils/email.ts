/** Normalize e-mail addresses for storage and comparison. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
