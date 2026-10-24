import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { checkDatabaseHealth } from '../../database';

export const health = asyncHandler(async (_req: Request, res: Response) => {
  res.status(200).json({
    data: {
      status: 'ok',
      service: 'temponest-api',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    },
  });
});

export const ready = asyncHandler(async (_req: Request, res: Response) => {
  const databaseHealthy = await checkDatabaseHealth();
  const status = databaseHealthy ? 'ready' : 'unavailable';

  res.status(databaseHealthy ? 200 : 503).json({
    data: {
      status,
      checks: {
        database: databaseHealthy ? 'ok' : 'failed',
      },
      timestamp: new Date().toISOString(),
    },
  });
});
