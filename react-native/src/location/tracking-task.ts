import type * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { processBackgroundLocationUpdates } from './on-site-tracking';
import { LOCATION_TRACKING_TASK } from './tracking-core';

interface LocationTaskData {
  locations?: Location.LocationObject[];
}

// Must be defined at module scope so a background launch can register it
// before React mounts.
TaskManager.defineTask<LocationTaskData>(LOCATION_TRACKING_TASK, async ({ data, error }) => {
  if (error) return;
  const locations = data?.locations;
  if (!locations || locations.length === 0) return;
  await processBackgroundLocationUpdates(locations);
});
