import * as Location from 'expo-location';

import type { AttendanceLocation } from '../api/types';
import { checkLocationFix, type LocationProblem } from '../attendance/check-in';

export type ForegroundLocationResult =
  | { status: 'ok'; location: AttendanceLocation }
  | { status: 'denied'; canAskAgain: boolean }
  | { status: 'services_disabled' }
  | { status: 'unavailable'; message: string }
  | { status: 'invalid'; problem: LocationProblem; message: string };

export interface ForegroundLocationPermission {
  status: 'granted' | 'denied' | 'undetermined' | 'unavailable';
  canAskAgain: boolean;
}

/** Reads the current permission without prompting, for status display. */
export async function getForegroundLocationPermission(): Promise<ForegroundLocationPermission> {
  try {
    const permission = await Location.getForegroundPermissionsAsync();
    return { status: permission.status, canAskAgain: permission.canAskAgain };
  } catch {
    return { status: 'unavailable', canAskAgain: false };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Location request timed out')), ms);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

/**
 * One foreground fix, requested only from the ON_SITE check-in flow. The
 * continuous on-site tracker lives in `on-site-tracking.ts`; it starts after a
 * successful check-in and never uses this one-shot helper.
 */
export async function collectForegroundLocation(): Promise<ForegroundLocationResult> {
  let permission: Location.LocationPermissionResponse;
  try {
    permission = await Location.requestForegroundPermissionsAsync();
  } catch {
    return {
      status: 'unavailable',
      message: 'Location permission could not be requested. Try again.',
    };
  }

  if (permission.status !== 'granted') {
    return { status: 'denied', canAskAgain: permission.canAskAgain };
  }

  try {
    if (!(await Location.hasServicesEnabledAsync())) {
      return { status: 'services_disabled' };
    }
  } catch {
    return {
      status: 'unavailable',
      message: 'Location services could not be checked. Try again.',
    };
  }

  try {
    const position = await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      25_000,
    );
    const accuracy = position.coords.accuracy;
    if (accuracy === null || !Number.isFinite(accuracy) || accuracy <= 0) {
      return {
        status: 'unavailable',
        message: 'This device did not report a usable location accuracy. Try again.',
      };
    }

    const location: AttendanceLocation = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracyMeters: accuracy,
      recordedAt: new Date(position.timestamp || Date.now()).toISOString(),
    };

    const check = checkLocationFix(location, Date.now());
    if (!check.ok) {
      return { status: 'invalid', problem: check.problem, message: check.message };
    }

    return { status: 'ok', location };
  } catch {
    return {
      status: 'unavailable',
      message:
        'A current location fix is not available yet. Move near a window or outdoors and try again.',
    };
  }
}
