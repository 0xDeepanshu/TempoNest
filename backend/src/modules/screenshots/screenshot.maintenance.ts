import { config } from '../../config/env';
import { logger } from '../../config/logger';
import { runScreenshotMaintenance } from './screenshot.service';

/**
 * Periodic, server-side housekeeping: expire unanswered requests, remove
 * abandoned uploads and retained screenshots, and prune audit rows according to
 * each organization's policy. The interval is unref'd so it never keeps the
 * process alive on its own.
 */
export function startScreenshotMaintenance(): () => void {
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    void runScreenshotMaintenance()
      .then((summary) => {
        if (
          summary.requestsExpired ||
          summary.abandonedUploads ||
          summary.screenshotsDeleted ||
          summary.orphanedObjectsDeleted ||
          summary.auditEventsDeleted
        ) {
          logger.info({ summary }, 'screenshot maintenance completed');
        }
      })
      .catch((error) => logger.error({ err: error }, 'screenshot maintenance failed'))
      .finally(() => {
        running = false;
      });
  };

  run();
  const timer = setInterval(run, config.screenshots.cleanupIntervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
