import { Router } from 'express';
import { health, ready } from './health.controller';

export function createHealthRouter(): Router {
  const router = Router();
  router.get('/', health);
  router.get('/ready', ready);
  return router;
}
