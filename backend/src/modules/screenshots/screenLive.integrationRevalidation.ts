import { config } from '../../config/env';
import { logger } from '../../config/logger';
import { revalidateIntegrationScreenLiveSessions } from './screenLive.service';

/**
 * Re-authorizes every active integration live session on a fixed timer, independent of any API call or
 * socket event. The interval is `SCREEN_LIVE_INTEGRATION_REVALIDATE_SECONDS`, which the configuration
 * schema caps at 15 seconds, so a revocation reaches a running stream within that bound (plus the time
 * one evaluation takes).
 */
export function startIntegrationScreenLiveRevalidation(
  intervalMs = config.screenLive.integrationRevalidateMs,
): () => void {
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    void revalidateIntegrationScreenLiveSessions()
      .then((ended) => {
        if (ended > 0) logger.info({ ended }, 'integration live sessions ended by revalidation');
      })
      .catch((error) => logger.error({ err: error }, 'integration live revalidation failed'))
      .finally(() => {
        running = false;
      });
  };

  run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
