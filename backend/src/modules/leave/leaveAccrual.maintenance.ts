import { config } from '../../config/env';
import { logger } from '../../config/logger';
import { runLeaveAccrualSweep } from './leaveAccrual.service';

/**
 * Server-side accrual sweep so leave balances do not depend on an administrator
 * opening the web app. Lazy reads remain the source of truth; this job simply
 * makes the scheduled grants happen on time. The interval is unref'd so it
 * never keeps the process alive on its own.
 */
export function startLeaveAccrualMaintenance(): () => void {
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    void runLeaveAccrualSweep()
      .then((summary) => {
        if (summary.employeesProcessed || summary.failures) {
          logger.info({ summary }, 'leave accrual sweep completed');
        }
      })
      .catch((error) => logger.error({ err: error }, 'leave accrual sweep failed'))
      .finally(() => {
        running = false;
      });
  };

  run();
  const timer = setInterval(run, config.leave.accrualSweepIntervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
