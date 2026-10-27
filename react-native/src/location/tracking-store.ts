import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  appendLocationSample,
  locationUploadBatch,
  removeUploadedLocationSamples,
  type LocationQueue,
  type QueuedLocationSample,
} from './tracking-core';
import type { AttendanceLocationSampleResult } from '../api/types';

const QUEUE_PREFIX = 'temponest.locationQueue.';
const CONTEXT_KEY = 'temponest.locationContext.v1';

export interface LocationTrackingContext {
  version: 1;
  organizationId: string;
  userId: string;
  agentId: string;
  sessionId: string;
  startedAt: string;
}

let queueLock: Promise<unknown> = Promise.resolve();

function withQueueLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = queueLock.then(operation, operation);
  queueLock = result.catch(() => undefined);
  return result;
}

function queueKey(organizationId: string, userId: string): string {
  return `${QUEUE_PREFIX}${organizationId}.${userId}`;
}

function isQueuedSample(value: unknown): value is QueuedLocationSample {
  if (!value || typeof value !== 'object') return false;
  const sample = value as Partial<QueuedLocationSample>;
  return (
    typeof sample.clientSampleId === 'string' &&
    typeof sample.latitude === 'number' &&
    Number.isFinite(sample.latitude) &&
    typeof sample.longitude === 'number' &&
    Number.isFinite(sample.longitude) &&
    typeof sample.accuracyMeters === 'number' &&
    Number.isFinite(sample.accuracyMeters) &&
    typeof sample.capturedAt === 'string' &&
    !Number.isNaN(Date.parse(sample.capturedAt)) &&
    sample.source === 'DEVICE'
  );
}

function parseQueue(raw: string | null): LocationQueue | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LocationQueue>;
    if (typeof parsed.sessionId !== 'string' || !Array.isArray(parsed.samples)) {
      return null;
    }
    return {
      sessionId: parsed.sessionId,
      samples: parsed.samples.filter(isQueuedSample),
    };
  } catch {
    return null;
  }
}

async function readQueue(
  organizationId: string,
  userId: string,
): Promise<LocationQueue | null> {
  return parseQueue(await AsyncStorage.getItem(queueKey(organizationId, userId)));
}

async function writeQueue(
  organizationId: string,
  userId: string,
  queue: LocationQueue,
): Promise<void> {
  await AsyncStorage.setItem(queueKey(organizationId, userId), JSON.stringify(queue));
}

/**
 * Starts a queue for exactly one time session. A queue left over from another
 * session is discarded so stale samples can never be uploaded to a new one.
 */
export function ensureLocationQueue(
  organizationId: string,
  userId: string,
  sessionId: string,
): Promise<LocationQueue> {
  return withQueueLock(async () => {
    const existing = await readQueue(organizationId, userId);
    if (existing?.sessionId === sessionId) return existing;
    const queue: LocationQueue = { sessionId, samples: [] };
    await writeQueue(organizationId, userId, queue);
    return queue;
  });
}

export function enqueueLocationSample(
  organizationId: string,
  userId: string,
  sessionId: string,
  sample: QueuedLocationSample,
): Promise<LocationQueue> {
  return withQueueLock(async () => {
    const existing = await readQueue(organizationId, userId);
    const base =
      existing?.sessionId === sessionId
        ? existing
        : ({ sessionId, samples: [] } satisfies LocationQueue);
    const next = appendLocationSample(base, sample);
    if (next !== base) await writeQueue(organizationId, userId, next);
    return next;
  });
}

export function readLocationUploadBatch(
  organizationId: string,
  userId: string,
  sessionId: string,
): Promise<QueuedLocationSample[]> {
  return withQueueLock(async () => {
    const queue = await readQueue(organizationId, userId);
    if (!queue || queue.sessionId !== sessionId) return [];
    return locationUploadBatch(queue);
  });
}

export function applyLocationUploadResults(
  organizationId: string,
  userId: string,
  sessionId: string,
  results: AttendanceLocationSampleResult[],
): Promise<void> {
  return withQueueLock(async () => {
    const queue = await readQueue(organizationId, userId);
    if (!queue || queue.sessionId !== sessionId) return;
    const next = removeUploadedLocationSamples(queue, results);
    if (next !== queue) await writeQueue(organizationId, userId, next);
  });
}

export function clearLocationQueue(organizationId: string, userId: string): Promise<void> {
  return withQueueLock(async () => {
    await AsyncStorage.removeItem(queueKey(organizationId, userId));
  });
}

export function writeTrackingContext(context: LocationTrackingContext): Promise<void> {
  return AsyncStorage.setItem(CONTEXT_KEY, JSON.stringify(context));
}

export async function readTrackingContext(): Promise<LocationTrackingContext | null> {
  const raw = await AsyncStorage.getItem(CONTEXT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LocationTrackingContext>;
    if (
      parsed.version !== 1 ||
      typeof parsed.organizationId !== 'string' ||
      typeof parsed.userId !== 'string' ||
      typeof parsed.agentId !== 'string' ||
      typeof parsed.sessionId !== 'string' ||
      typeof parsed.startedAt !== 'string'
    ) {
      return null;
    }
    return parsed as LocationTrackingContext;
  } catch {
    return null;
  }
}

export function clearTrackingContext(): Promise<void> {
  return AsyncStorage.removeItem(CONTEXT_KEY);
}
