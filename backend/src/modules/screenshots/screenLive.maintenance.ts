import { logger } from '../../config/logger';
import { runScreenLiveMaintenance } from './screenLive.service';

const INTERVAL_MS = 15_000;

/**
 * Expires live sessions whose work session, agent, policy, or organization is
 * no longer valid. The relay also applies its own transport timeouts; this loop
 * is the durable backstop for sessions with no live sockets.
 */
export function startScreenLiveMaintenance(): () => void {
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    void runScreenLiveMaintenance()
      .then((summary) => {
        if (summary.sessionsTerminated > 0) {
          logger.info({ summary }, 'live screen maintenance completed');
        }
      })
      .catch((error) => logger.error({ err: error }, 'live screen maintenance failed'))
      .finally(() => {
        running = false;
      });
  };

  run();
  const timer = setInterval(run, INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
