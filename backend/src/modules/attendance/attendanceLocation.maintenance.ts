import { config } from '../../config/env';
import { logger } from '../../config/logger';
import { purgeAttendanceLocationHistory } from './attendanceLocation.service';

/**
 * Enforces the precise-location retention window. The interval is unref'd so
 * housekeeping never keeps the process alive on its own.
 */
export function startAttendanceLocationMaintenance(): () => void {
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    void purgeAttendanceLocationHistory()
      .then((summary) => {
        if (summary.samplesDeleted || summary.trackingDeleted) {
          logger.info({ summary }, 'attendance location retention purge completed');
        }
      })
      .catch((error) =>
        logger.error({ err: error }, 'attendance location retention purge failed'),
      )
      .finally(() => {
        running = false;
      });
  };

  run();
  const timer = setInterval(run, config.attendance.locationPurgeIntervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
