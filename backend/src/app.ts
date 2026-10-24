import express, { type Express } from 'express';
import cors, { type CorsOptions } from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { config } from './config/env';
import { logger } from './config/logger';
import { requestId } from './middleware/requestId';
import { authenticate } from './middleware/authenticate';
import { csrfProtection } from './middleware/csrf';
import { createApiRateLimiter } from './middleware/rateLimit';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { createApiRouter } from './routes';

/**
 * CORS is allowlist-only and credentials are enabled. Requests without an
 * Origin header (server-to-server, Electron main process, curl) are allowed;
 * the browser will still enforce its own policy.
 */
function buildCorsOptions(): CorsOptions {
  return {
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      return callback(null, config.cors.origins.includes(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-CSRF-Token',
      'X-Request-Id',
      'X-Organization-Id',
      'X-Agent-Id',
      'X-Agent-Key',
      'Idempotency-Key',
    ],
    exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy'],
    maxAge: 600,
  };
}

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).requestId,
      autoLogging: {
        ignore: (req) => req.url === `${config.apiPrefix}/health`,
      },
      customLogLevel: (_req, res, error) => {
        if (error || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      serializers: {
        req(req) {
          // Query strings and signed screenshot paths can contain bearer-like
          // tokens; never write them to logs.
          const url = (req.url?.split('?')[0] ?? '')
            .replace(/(\/screenshot-files\/)[^/]+/, '$1[redacted]')
            .replace(/(\/agent\/screenshot-uploads\/)[^/]+/, '$1[redacted]');
          return {
            id: req.id,
            method: req.method,
            url,
            remoteAddress: req.remoteAddress,
          };
        },
        res(res) {
          return { statusCode: res.statusCode };
        },
      },
    }),
  );
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use(cors(buildCorsOptions()));
  app.use(express.json({ limit: config.bodyLimit }));
  app.use(cookieParser());

  if (config.rateLimit.enabled) {
    app.use(createApiRateLimiter());
  }

  app.use(authenticate);
  app.use(csrfProtection);

  app.use(config.apiPrefix, createApiRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
