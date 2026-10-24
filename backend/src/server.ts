import type { Server } from 'node:http';
import type { WebSocketServer } from 'ws';
import { createApp } from './app';
import { config } from './config/env';
import { logger } from './config/logger';
import { connectDatabase, disconnectDatabase } from './database';
import { attachAgentWebSocketServer } from './realtime/agentWebSocket';
import { agentHub } from './realtime/agentHub';
import { startScreenshotMaintenance } from './modules/screenshots/screenshot.maintenance';

let shuttingDown = false;

async function shutdown(
  server: Server,
  signal: string,
  wss?: WebSocketServer,
  stopMaintenance?: () => void,
): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutdown initiated');

  stopMaintenance?.();
  agentHub.closeAll(1001, 'Server shutting down');
  wss?.close();

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
  const stopMaintenance = startScreenshotMaintenance();

  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;

  const handleSignal = (signal: NodeJS.Signals) => {
    void shutdown(server, signal, wss, stopMaintenance).then(() =>
      process.exit(process.exitCode ?? 0),
    );
  };

  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandled promise rejection');
  });

  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception; shutting down');
    void shutdown(server, 'uncaughtException', wss, stopMaintenance).then(() =>
      process.exit(1),
    );
  });
}

main().catch((error) => {
  logger.fatal({ err: error }, 'failed to start TempoNest API');
  process.exit(1);
});
