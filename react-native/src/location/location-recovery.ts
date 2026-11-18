import { Linking, Platform } from 'react-native';

import type { OnSiteTrackingPhase } from './tracking-core';

export type LocationRecoveryKind =
  | 'location-required'
  | 'permission-required'
  | 'interrupted'
  | 'ready';

export interface LocationRecoveryView {
  kind: LocationRecoveryKind;
  title: string;
  message: string;
  primaryLabel: string;
}

export const LOCATION_REQUIRED_MESSAGE =
  'Your On-Site timer has been paused because location services are turned off. Please enable location to continue your attendance session.';

export const LOCATION_PERMISSION_MESSAGE =
  'Your On-Site timer has been paused because WorkZen no longer has location permission. Allow location access to continue your attendance session.';

export const TRACKING_INTERRUPTED_MESSAGE =
  'WorkZen could not verify your location while the app was closed. The timer is paused so unverified time is not counted. Check location and resume when you are ready.';

export const LOCATION_RESTORED_MESSAGE =
  'Location is available again. Your timer is still paused. Press Resume to continue.';

/**
 * The single source of truth for the recovery dialog. Only an explicit resume
 * clears it; a restored signal moves it to "ready" instead of resuming the
 * timer on its own.
 */
export function locationRecoveryView(options: {
  phase: OnSiteTrackingPhase;
  paused: boolean;
}): LocationRecoveryView | null {
  const { phase, paused } = options;
  if (!paused) return null;

  switch (phase) {
    case 'permission-denied':
      return {
        kind: 'permission-required',
        title: 'Location Required',
        message: LOCATION_PERMISSION_MESSAGE,
        primaryLabel: 'Enable Location',
      };
    case 'location-disabled':
    case 'location-unavailable':
      return {
        kind: 'location-required',
        title: 'Location Required',
        message: LOCATION_REQUIRED_MESSAGE,
        primaryLabel: 'Enable Location',
      };
    case 'interrupted':
      return {
        kind: 'interrupted',
        title: 'Tracking Interrupted',
        message: TRACKING_INTERRUPTED_MESSAGE,
        primaryLabel: 'Enable Location',
      };
    case 'location-restored':
      return {
        kind: 'ready',
        title: 'Location Available',
        message: LOCATION_RESTORED_MESSAGE,
        primaryLabel: 'Resume',
      };
    default:
      return null;
  }
}

/** Android exposes a dedicated location-source screen; iOS does not. */
export async function openLocationServicesSettings(): Promise<void> {
  if (Platform.OS === 'android') {
    try {
      await Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS');
      return;
    } catch {
      // Fall through to the app settings screen.
    }
  }
  await Linking.openSettings().catch(() => undefined);
}

/** Used when location permission was revoked and can no longer be prompted. */
export async function openAppPermissionSettings(): Promise<void> {
  await Linking.openSettings().catch(() => undefined);
}
