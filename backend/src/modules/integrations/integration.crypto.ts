import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from 'node:crypto';
import { config } from '../../config/env';
import { AppError } from '../../utils/errors';
import { safeEqualStrings } from '../../utils/crypto';
import { webhookHostBlockReason } from './integration.webhookTransport';

const SECRET_VERSION = 'v1';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

/**
 * All integration secrets (authorization codes, access/refresh tokens, client
 * secrets, browser bindings, webhook HMAC inputs) are keyed hashes, never
 * plaintext. The same server-side pepper used by user sessions provides the
 * keying material.
 */
export function hashIntegrationValue(value: string): string {
  return createHmac('sha256', config.auth.tokenPepper).update(value, 'utf8').digest('hex');
}

function encryptionKey(): Buffer {
  // Derive a stable 256-bit key from the configured webhook key. The prefix
  // separates this use from any other consumer of the same secret.
  return createHash('sha256')
    .update(`workzen-integration-secret:${config.integrations.webhook.secretKey}`, 'utf8')
    .digest();
}

/**
 * Encrypt a value that must be recovered later (webhook signing secrets and the
 * OAuth `state` echo). AES-256-GCM provides confidentiality and integrity.
 * Format: `v1.<iv>.<tag>.<ciphertext>` with base64url parts.
 */
export function encryptIntegrationValue(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    SECRET_VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptIntegrationValue(value: string): string {
  const [version, ivPart, tagPart, dataPart] = value.split('.');
  if (version !== SECRET_VERSION || !ivPart || !tagPart || dataPart === undefined) {
    throw new Error('Unsupported integration secret format');
  }

  const iv = Buffer.from(ivPart, 'base64url');
  const tag = Buffer.from(tagPart, 'base64url');
  if (iv.length !== IV_BYTES || tag.length !== AUTH_TAG_BYTES) {
    throw new Error('Invalid integration secret envelope');
  }

  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function generateWebhookSecret(): string {
  return `wz_whsec_${randomBytes(32).toString('base64url')}`;
}

/**
 * PKCE S256 verification. `code_verifier` is the client-generated PKCE secret;
 * only the SHA-256 challenge it derives was stored on the authorization request.
 */
export function verifyPkceChallenge(codeVerifier: string, codeChallenge: string): boolean {
  const computed = createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');
  return safeEqualStrings(computed, codeChallenge);
}

/**
 * HMAC signature over `<unix-timestamp>.<raw-body>`. The timestamp prevents a
 * captured delivery from being replayed indefinitely.
 */
export function signWebhookPayload(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex');
}

export function redirectUriMatches(registered: readonly string[], candidate: string): boolean {
  // Exact string comparison: no trailing-slash or case normalization, because
  // loose matching is a well-known OAuth redirect hijack vector.
  return registered.some((uri) => uri === candidate);
}

function parseHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw AppError.unprocessable('URL is not a valid absolute URL', 'INVALID_URL');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw AppError.unprocessable('URL must use http or https', 'INVALID_URL');
  }
  if (url.username || url.password) {
    throw AppError.unprocessable('URL must not contain embedded credentials', 'INVALID_URL');
  }
  if (url.hash) {
    throw AppError.unprocessable('URL must not contain a fragment', 'INVALID_URL');
  }
  return url;
}

/** Redirect URIs may be loopback during development, but never in production. */
export function assertIntegrationRedirectUri(raw: string): URL {
  const url = parseHttpUrl(raw);
  if (config.isProduction && url.protocol !== 'https:') {
    throw AppError.unprocessable('Redirect URIs must use https in production', 'INVALID_REDIRECT_URI');
  }
  return url;
}

/**
 * Fast synchronous webhook URL validation for subscription create/update.
 * Literal internal addresses and internal hostnames are rejected in every
 * environment; resolved addresses are revalidated immediately before each
 * delivery attempt in the transport layer.
 */
export function assertIntegrationWebhookUrl(raw: string): URL {
  const url = parseHttpUrl(raw);
  if (config.isProduction && url.protocol !== 'https:') {
    throw AppError.unprocessable('Webhook URLs must use https in production', 'INVALID_WEBHOOK_URL');
  }
  const blocked = webhookHostBlockReason(url.hostname);
  if (blocked) {
    throw AppError.unprocessable(
      `Webhook URLs must not target internal or non-public addresses (${blocked})`,
      'INVALID_WEBHOOK_URL',
    );
  }
  return url;
}

export function parseScopeList(value: string | readonly string[]): string[] {
  const raw = typeof value === 'string' ? value.split(' ') : [...value];
  const scopes = raw.map((scope) => scope.trim()).filter(Boolean);
  return [...new Set(scopes)];
}
