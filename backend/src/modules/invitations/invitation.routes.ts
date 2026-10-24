import { Router } from 'express';
import { requireAuth } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { accept, preview } from './invitation.controller';
import { invitationTokenSchema } from './invitation.schemas';

export function createPublicInvitationRouter(): Router {
  const router = Router();

  router.post('/preview', validate({ body: invitationTokenSchema }), preview);

  router.post('/accept', requireAuth, validate({ body: invitationTokenSchema }), accept);

  return router;
}
