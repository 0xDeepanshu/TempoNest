import { describe, expect, it } from 'vitest';

import type { AttendanceLocationSampleResult } from '../api/types';
import {
  LOCATION_MAX_ACCURACY_METERS,
  LOCATION_QUEUE_MAX_SAMPLES,
  appendLocationSample,
  createQueuedLocationSample,
  locationUploadBatch,
  phaseFromLocationState,
  removeUploadedLocationSamples,
  shouldTrackOnSite,
  trackingPhasePresentation,
  type LocationQueue,
  type QueuedLocationSample,
} from './tracking-core';

const NOW = Date.parse('2026-10-26T09:00:00.000Z');

function sample(overrides: Partial<QueuedLocationSample> = {}): QueuedLocationSample {
  return {
    clientSampleId: '11111111-1111-4111-8111-111111111111',
    latitude: 28.6139,
    longitude: 77.209,
    accuracyMeters: 25,
    capturedAt: '2026-10-26T08:59:00.000Z',
    source: 'DEVICE',
    ...overrides,
  };
}

function queue(samples: QueuedLocationSample[]): LocationQueue {
  return { sessionId: 'session-1', samples };
}

describe('createQueuedLocationSample', () => {
  it('accepts a valid device fix and normalizes the capture time', () => {
    expect(
      createQueuedLocationSample({
        clientSampleId: 'sample-1',
        latitude: 28.6139,
        longitude: 77.209,
        accuracyMeters: 25,
        capturedAtMs: NOW - 5_000,
        nowMs: NOW,
      }),
    ).toEqual({
      clientSampleId: 'sample-1',
      latitude: 28.6139,
      longitude: 77.209,
      accuracyMeters: 25,
      capturedAt: new Date(NOW - 5_000).toISOString(),
      source: 'DEVICE',
    });
  });

  it('rejects coordinates outside the valid range', () => {
    for (const input of [
      { latitude: Number.NaN, longitude: 77.2 },
      { latitude: 90.1, longitude: 77.2 },
      { latitude: 28.6, longitude: 180.1 },
      { latitude: 28.6, longitude: Number.POSITIVE_INFINITY },
    ]) {
      expect(
        createQueuedLocationSample({
          clientSampleId: 'sample-1',
          accuracyMeters: 20,
          capturedAtMs: NOW,
          nowMs: NOW,
          ...input,
        }),
      ).toBeNull();
    }
  });

  it('rejects missing, zero, or too-coarse accuracy', () => {
    for (const accuracyMeters of [null, 0, -1, Number.NaN, LOCATION_MAX_ACCURACY_METERS + 1]) {
      expect(
        createQueuedLocationSample({
          clientSampleId: 'sample-1',
          latitude: 28.6,
          longitude: 77.2,
          accuracyMeters,
          capturedAtMs: NOW,
          nowMs: NOW,
        }),
      ).toBeNull();
    }
  });

  it('rejects future and ancient captures', () => {
    expect(
      createQueuedLocationSample({
        clientSampleId: 'sample-1',
        latitude: 28.6,
        longitude: 77.2,
        accuracyMeters: 20,
        capturedAtMs: NOW + 61_000,
        nowMs: NOW,
      }),
    ).toBeNull();
    expect(
      createQueuedLocationSample({
        clientSampleId: 'sample-1',
        latitude: 28.6,
        longitude: 77.2,
        accuracyMeters: 20,
        capturedAtMs: NOW - 11 * 60_000,
        nowMs: NOW,
      }),
    ).toBeNull();
  });
});

describe('location queue', () => {
  it('ignores duplicate sample ids', () => {
    const first = appendLocationSample(queue([]), sample());
    expect(appendLocationSample(first, sample())).toBe(first);
  });

  it('keeps the newest samples within the bound', () => {
    let bounded = queue([]);
    for (let index = 0; index < LOCATION_QUEUE_MAX_SAMPLES + 3; index += 1) {
      bounded = appendLocationSample(bounded, sample({ clientSampleId: `sample-${index}` }), 3);
    }
    expect(bounded.samples.map((entry) => entry.clientSampleId)).toEqual([
      `sample-${LOCATION_QUEUE_MAX_SAMPLES}`,
      `sample-${LOCATION_QUEUE_MAX_SAMPLES + 1}`,
      `sample-${LOCATION_QUEUE_MAX_SAMPLES + 2}`,
    ]);
  });

  it('batches the oldest samples first', () => {
    const pending = queue([sample({ clientSampleId: 'a' }), sample({ clientSampleId: 'b' })]);
    expect(locationUploadBatch(pending, 1).map((entry) => entry.clientSampleId)).toEqual(['a']);
  });

  it('drops answered samples and keeps unsent ones', () => {
    const pending = queue([
      sample({ clientSampleId: 'a' }),
      sample({ clientSampleId: 'b' }),
      sample({ clientSampleId: 'c' }),
    ]);
    const results: AttendanceLocationSampleResult[] = [
      { clientSampleId: 'a', status: 'ACCEPTED' },
      { clientSampleId: 'b', status: 'REJECTED', code: 'SAMPLE_DURING_BREAK' },
    ];
    expect(removeUploadedLocationSamples(pending, results).samples.map((entry) => entry.clientSampleId)).toEqual([
      'c',
    ]);
  });

  it('returns the same queue when no sample was answered', () => {
    const pending = queue([sample({ clientSampleId: 'a' })]);
    const results: AttendanceLocationSampleResult[] = [
      { clientSampleId: 'other', status: 'DUPLICATE' },
    ];
    expect(removeUploadedLocationSamples(pending, results)).toBe(pending);
  });
});

describe('shouldTrackOnSite', () => {
  it('tracks only an owned, active ON_SITE session', () => {
    expect(
      shouldTrackOnSite({ workMode: 'ON_SITE', sessionStatus: 'ACTIVE', ownsSession: true }),
    ).toBe(true);

    for (const options of [
      { workMode: 'WFO' as const, sessionStatus: 'ACTIVE', ownsSession: true },
      { workMode: 'WFH' as const, sessionStatus: 'ACTIVE', ownsSession: true },
      { workMode: 'ON_SITE' as const, sessionStatus: 'ON_BREAK', ownsSession: true },
      { workMode: 'ON_SITE' as const, sessionStatus: 'STOPPED', ownsSession: true },
      { workMode: 'ON_SITE' as const, sessionStatus: 'ACTIVE', ownsSession: false },
      { workMode: null, sessionStatus: 'ACTIVE', ownsSession: true },
      { workMode: 'ON_SITE' as const, sessionStatus: null, ownsSession: true },
    ]) {
      expect(shouldTrackOnSite(options)).toBe(false);
    }
  });
});

describe('tracking presentation', () => {
  it('derives an honest phase from the server state', () => {
    expect(phaseFromLocationState('ACTIVE', true)).toBe('active-background');
    expect(phaseFromLocationState('ACTIVE', false)).toBe('active-foreground');
    expect(phaseFromLocationState('PAUSED', true)).toBe('paused');
    expect(phaseFromLocationState('PERMISSION_UNAVAILABLE', true)).toBe('permission-denied');
    expect(phaseFromLocationState('STALE', true)).toBe('stale');
    expect(phaseFromLocationState('STOPPED', true)).toBe('stopped');
  });

  it('labels foreground-only tracking as limited, not fully active', () => {
    expect(trackingPhasePresentation('active-background').tone).toBe('success');
    expect(trackingPhasePresentation('active-foreground').tone).toBe('warning');
    expect(trackingPhasePresentation('active-foreground').detail).toContain('only while');
    expect(trackingPhasePresentation('permission-denied').tone).toBe('danger');
    expect(trackingPhasePresentation('paused').label).toBe('Paused');
  });
});
