import { config } from '../../config/env';
import { logger } from '../../config/logger';
import { dispatchPendingWebhooks } from './integration.webhook.service';

/**
 * Background webhook dispatcher.
 *
 * The outbox is durable, so this loop only needs to make progress eventually.
 * Overlapping ticks are skipped and every failure is contained: REST reads
 * remain the authoritative recovery path for partner integrations.
 */
export function startIntegrationWebhookMaintenance(): () => void {
  if (!config.integrations.enabled) {
    return () => undefined;
  }

  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    void dispatchPendingWebhooks()
      .then((summary) => {
        if (summary.attempted > 0) {
          logger.info({ summary }, 'integration webhook dispatch completed');
        }
      })
      .catch((error) => logger.error({ err: error }, 'integration webhook dispatch failed'))
      .finally(() => {
        running = false;
      });
  };

  run();
  const timer = setInterval(run, config.integrations.webhook.dispatchIntervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
