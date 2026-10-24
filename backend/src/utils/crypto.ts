import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

/** Generate a URL-safe opaque token with 256 bits of entropy. */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function generateUuid(): string {
  return randomUUID();
}

/**
 * Opaque tokens are never stored in plaintext. They are HMAC-SHA256 hashed with
 * a server-side pepper, so a database leak alone does not yield usable tokens.
 */
export function hashOpaqueToken(token: string, pepper: string): string {
  return createHmac('sha256', pepper).update(token, 'utf8').digest('hex');
}

export function safeEqualStrings(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) {
    // Still run a comparison to keep timing reasonably uniform.
    timingSafeEqual(bufferA, bufferA);
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}
