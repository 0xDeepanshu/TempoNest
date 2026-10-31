import type { Server } from 'node:http';
import type { WebSocketServer } from 'ws';
import { createApp } from './app';
import { config } from './config/env';
import { logger } from './config/logger';
import { connectDatabase, disconnectDatabase } from './database';
import { attachAgentWebSocketServer } from './realtime/agentWebSocket';
import { attachScreenLiveRelay, type ScreenLiveRelay } from './realtime/screenLiveRelay';
import { agentHub } from './realtime/agentHub';
import { startScreenshotMaintenance } from './modules/screenshots/screenshot.maintenance';
import { startScreenLiveMaintenance } from './modules/screenshots/screenLive.maintenance';
import { startAttendanceLocationMaintenance } from './modules/attendance/attendanceLocation.maintenance';
import { startLeaveAccrualMaintenance } from './modules/leave/leaveAccrual.maintenance';
import { startActivityMaintenance } from './modules/activity/activity.maintenance';

let shuttingDown = false;

async function shutdown(
  server: Server,
  signal: string,
  wss?: WebSocketServer,
  stopMaintenance?: () => void,
  relay?: ScreenLiveRelay,
  stopLiveMaintenance?: () => void,
  stopLocationMaintenance?: () => void,
  stopLeaveAccrualMaintenance?: () => void,
  stopActivityMaintenance?: () => void,
): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutdown initiated');

  stopMaintenance?.();
  stopLiveMaintenance?.();
  stopLocationMaintenance?.();
  stopLeaveAccrualMaintenance?.();
  stopActivityMaintenance?.();
  agentHub.closeAll(1001, 'Server shutting down');
  wss?.close();
  if (relay) {
    try {
      await relay.close();
    } catch (error) {
      logger.warn({ err: error }, 'error while closing live screen relay');
    }
  }

  const forceExit = setTimeout(() => {
    logger.error('graceful shutdown timed out; forcing exit');
    server.closeAllConnections();
    process.exitCode = 1;
  }, 10_000);
  forceExit.unref();

  await new Promise<void>((resolve) => {
    server.close((error) => {
      if (error) {
        logger.error({ err: error }, 'error while closing HTTP server');
        process.exitCode = 1;
      }
      resolve();
    });
  });

  try {
    await disconnectDatabase();
  } catch (error) {
    logger.error({ err: error }, 'error while closing database connection');
    process.exitCode = 1;
  }

  clearTimeout(forceExit);
  logger.info('shutdown complete');
}

async function main(): Promise<void> {
  await connectDatabase(3);

  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, env: config.env }, 'TempoNest API listening');
  });
  const wss = attachAgentWebSocketServer(server);
  const relay = attachScreenLiveRelay(server);
  const stopMaintenance = startScreenshotMaintenance();
  const stopLiveMaintenance = startScreenLiveMaintenance();
  const stopLocationMaintenance = startAttendanceLocationMaintenance();
  const stopLeaveAccrualMaintenance = startLeaveAccrualMaintenance();
  const stopActivityMaintenance = startActivityMaintenance();

  // Both realtime endpoints above ignore paths they do not own. Reject any
  // other upgrade request so unhandled sockets do not linger.
  const knownUpgradePaths = new Set([
    `${config.apiPrefix}/ws/agent`,
    `${config.apiPrefix}${config.screenLive.viewerPath}`,
    `${config.apiPrefix}${config.screenLive.agentPath}`,
  ]);
  server.on('upgrade', (req, socket) => {
    try {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (!knownUpgradePaths.has(pathname)) socket.destroy();
    } catch {
      socket.destroy();
    }
  });

  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;

  const handleSignal = (signal: NodeJS.Signals) => {
    void shutdown(
      server,
      signal,
      wss,
      stopMaintenance,
      relay,
      stopLiveMaintenance,
      stopLocationMaintenance,
      stopLeaveAccrualMaintenance,
      stopActivityMaintenance,
    ).then(() => process.exit(process.exitCode ?? 0));
  };

  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandled promise rejection');
  });

  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception; shutting down');
    void shutdown(
      server,
      'uncaughtException',
      wss,
      stopMaintenance,
      relay,
      stopLiveMaintenance,
      stopLocationMaintenance,
      stopLeaveAccrualMaintenance,
      stopActivityMaintenance,
    ).then(() => process.exit(1));
  });
}

main().catch((error) => {
  logger.fatal({ err: error }, 'failed to start TempoNest API');
  process.exit(1);
});
