import { createHmac, randomBytes } from 'node:crypto';
import { config } from '../../config/env';
import { safeEqualStrings } from '../../utils/crypto';

const TOKEN_VERSION = 1;
const TOKEN_CONTEXT = 'temponest:attendance-evidence-download:v1:';

type DownloadTokenPayload = {
  v: number;
  eid: string;
  oid: string;
  aid: string | null;
  exp: number;
  nonce: string;
};

export type VerifiedAttendanceEvidenceToken = {
  evidenceId: string;
  organizationId: string;
  actorUserId: string | null;
  expiresAt: Date;
};

function signature(encodedPayload: string): string {
  return createHmac('sha256', `${TOKEN_CONTEXT}${config.auth.tokenPepper}`)
    .update(encodedPayload, 'utf8')
    .digest('base64url');
}

function isUuidLike(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
}

export function createAttendanceEvidenceDownloadToken(input: {
  evidenceId: string;
  organizationId: string;
  actorUserId: string | null;
  expiresAt: Date;
}): string {
  const payload: DownloadTokenPayload = {
    v: TOKEN_VERSION,
    eid: input.evidenceId,
    oid: input.organizationId,
    aid: input.actorUserId,
    exp: Math.floor(input.expiresAt.getTime() / 1000),
    nonce: randomBytes(12).toString('base64url'),
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encoded}.${signature(encoded)}`;
}

export function verifyAttendanceEvidenceDownloadToken(
  token: string,
  now = new Date(),
): VerifiedAttendanceEvidenceToken | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, presentedSignature] = parts;
  if (!encoded || !presentedSignature) return null;

  if (!safeEqualStrings(presentedSignature, signature(encoded))) return null;

  let payload: DownloadTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as DownloadTokenPayload;
  } catch {
    return null;
  }

  if (
    payload.v !== TOKEN_VERSION ||
    !isUuidLike(payload.eid) ||
    !isUuidLike(payload.oid) ||
    (payload.aid !== null && !isUuidLike(payload.aid)) ||
    !Number.isInteger(payload.exp) ||
    typeof payload.nonce !== 'string'
  ) {
    return null;
  }

  const expiresAt = new Date(payload.exp * 1000);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) return null;

  return {
    evidenceId: payload.eid,
    organizationId: payload.oid,
    actorUserId: payload.aid,
    expiresAt,
  };
}
