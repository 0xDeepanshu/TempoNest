import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { accept, preview } from './invitation.controller';
import { acceptInvitationSchema, invitationTokenSchema } from './invitation.schemas';

export function createPublicInvitationRouter(): Router {
  const router = Router();

  // Both endpoints are public. Optional authentication (populated by the app
  // middleware) tells previews and acceptance whether an account is signed in.
  router.post('/preview', validate({ body: invitationTokenSchema }), preview);

  router.post('/accept', validate({ body: acceptInvitationSchema }), accept);

  return router;
}
