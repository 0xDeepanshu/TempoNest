import { describe, expect, it, vi } from 'vitest';

import {
  LOCATION_REQUIRED_MESSAGE,
  LOCATION_RESTORED_MESSAGE,
  TRACKING_INTERRUPTED_MESSAGE,
  locationRecoveryView,
} from './location-recovery';

vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  Linking: {
    openSettings: vi.fn(),
    sendIntent: vi.fn(),
  },
}));

describe('locationRecoveryView', () => {
  it('shows the exact location-required copy while services are off', () => {
    const view = locationRecoveryView({ phase: 'location-disabled', paused: true });

    expect(view).toEqual({
      kind: 'location-required',
      title: 'Location Required',
      message:
        'Your On-Site timer has been paused because location services are turned off. Please enable location to continue your attendance session.',
      primaryLabel: 'Enable Location',
    });
    expect(view?.message).toBe(LOCATION_REQUIRED_MESSAGE);
  });

  it('treats missing updates as the same location-required state', () => {
    expect(
      locationRecoveryView({ phase: 'location-unavailable', paused: true })?.kind,
    ).toBe('location-required');
  });

  it('uses the permission recovery copy when permission was revoked', () => {
    const view = locationRecoveryView({ phase: 'permission-denied', paused: true });
    expect(view?.kind).toBe('permission-required');
    expect(view?.primaryLabel).toBe('Enable Location');
    expect(view?.message).toContain('no longer has location permission');
  });

  it('explains a process/service interruption instead of a settings problem', () => {
    const view = locationRecoveryView({ phase: 'interrupted', paused: true });
    expect(view?.kind).toBe('interrupted');
    expect(view?.title).toBe('Tracking Interrupted');
    expect(view?.message).toBe(TRACKING_INTERRUPTED_MESSAGE);
  });

  it('offers an explicit resume once location is verified', () => {
    const view = locationRecoveryView({ phase: 'location-restored', paused: true });
    expect(view?.kind).toBe('ready');
    expect(view?.primaryLabel).toBe('Resume');
    expect(view?.message).toBe(LOCATION_RESTORED_MESSAGE);
  });

  it('stays hidden for a running or manually managed session', () => {
    expect(locationRecoveryView({ phase: 'location-disabled', paused: false })).toBeNull();
    expect(locationRecoveryView({ phase: 'active-background', paused: true })).toBeNull();
    expect(locationRecoveryView({ phase: 'paused', paused: true })).toBeNull();
  });
});
