import * as Crypto from 'expo-crypto';

import { deleteSecret, readSecret, writeSecret } from '../auth/tokens';
import {
  isAttendanceLocation,
  type PendingCheckIn,
} from './check-in';
import type { AttendanceWorkMode } from '../api/types';

function pendingKey(organizationId: string, userId: string): string {
  return `temponest.pendingCheckIn.${organizationId}.${userId}`;
}

function isPendingCheckIn(value: unknown): value is PendingCheckIn {
  if (!value || typeof value !== 'object') return false;
  const pending = value as Partial<PendingCheckIn>;
  if (pending.version !== 1) return false;
  if (typeof pending.requestId !== 'string' || pending.requestId.length < 30) return false;
  if (
    pending.workMode !== 'WFO' &&
    pending.workMode !== 'WFH' &&
    pending.workMode !== 'ON_SITE'
  ) {
    return false;
  }
  if (typeof pending.createdAt !== 'string') return false;
  if (pending.selfieEvidenceId !== undefined && typeof pending.selfieEvidenceId !== 'string') {
    return false;
  }
  if (
    pending.sitePhotoEvidenceId !== undefined &&
    typeof pending.sitePhotoEvidenceId !== 'string'
  ) {
    return false;
  }
  if (pending.location !== undefined && !isAttendanceLocation(pending.location)) {
    return false;
  }
  if (
    pending.evidenceExpiresAt !== undefined &&
    typeof pending.evidenceExpiresAt !== 'string'
  ) {
    return false;
  }
  return true;
}

export async function readPendingCheckIn(
  organizationId: string,
  userId: string,
): Promise<PendingCheckIn | null> {
  const raw = await readSecret(pendingKey(organizationId, userId));
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (isPendingCheckIn(parsed)) return parsed;
  } catch {
    // Fall through and remove the unreadable record.
  }

  await clearPendingCheckIn(organizationId, userId);
  return null;
}

export async function createPendingCheckIn(
  organizationId: string,
  userId: string,
  workMode: AttendanceWorkMode,
): Promise<PendingCheckIn> {
  const pending: PendingCheckIn = {
    version: 1,
    requestId: Crypto.randomUUID(),
    workMode,
    createdAt: new Date().toISOString(),
  };
  await writeSecret(pendingKey(organizationId, userId), JSON.stringify(pending));
  return pending;
}

export async function savePendingCheckIn(
  organizationId: string,
  userId: string,
  pending: PendingCheckIn,
): Promise<PendingCheckIn> {
  await writeSecret(pendingKey(organizationId, userId), JSON.stringify(pending));
  return pending;
}

/**
 * A retry with a changed payload needs a new idempotency key, because the
 * server rejects one request ID used for two different check-ins.
 */
export function withNewRequestId(pending: PendingCheckIn): PendingCheckIn {
  return { ...pending, requestId: Crypto.randomUUID() };
}

export async function clearPendingCheckIn(
  organizationId: string,
  userId: string,
): Promise<void> {
  try {
    await deleteSecret(pendingKey(organizationId, userId));
  } catch {
    // A missing record is already cleared.
  }
}
