import pino from 'pino';
import { config } from './env';

export const logger = pino({
  level: config.logLevel,
  base: {
    service: 'temponest-api',
    env: config.env,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-csrf-token"]',
      'req.headers["x-agent-key"]',
      'res.headers["set-cookie"]',
      'password',
      'passwordHash',
      'token',
      'accessToken',
      'refreshToken',
      'csrfToken',
      'invitationToken',
      'agentKey',
      'agentKeyHash',
      'ticket',
      'ticketHash',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.accessToken',
      '*.refreshToken',
      '*.csrfToken',
      '*.invitationToken',
      '*.agentKey',
      '*.agentKeyHash',
      '*.ticket',
      '*.ticketHash',
    ],
    censor: '[REDACTED]',
  },
});
