import { config } from '../../config/env';
import { logger } from '../../config/logger';
import { runDueScheduledCaptures } from './screenshot.scheduler';

/**
 * Periodically sweeps the per-employee schedule. The timer is unref'd so it
 * never keeps the process alive on its own.
 */
export function startScreenshotScheduler(): () => void {
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    void runDueScheduledCaptures()
      .then((summary) => {
        if (summary.captured || summary.deferred) {
          logger.debug({ summary }, 'scheduled screenshot sweep completed');
        }
      })
      .catch((error) => logger.error({ err: error }, 'scheduled screenshot sweep failed'))
      .finally(() => {
        running = false;
      });
  };

  run();
  const timer = setInterval(run, config.screenshots.scheduleSweepIntervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
