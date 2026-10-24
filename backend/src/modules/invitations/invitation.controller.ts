import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  acceptInvitation,
  createInvitation,
  listInvitations,
  previewInvitation,
  revokeInvitation,
  toAcceptedInvitation,
  toInvitationSummary,
} from './invitation.service';
import type {
  CreateInvitationInput,
  InvitationListQuery,
  InvitationTokenInput,
} from './invitation.schemas';

export const create = asyncHandler(async (req: Request, res: Response) => {
  const context = req.organization!;
  const input = req.body as CreateInvitationInput;

  const { invitation, token } = await createInvitation(context.membership, context.organization, input);

  res.status(201).json({
    data: {
      invitation: toInvitationSummary(invitation),
      // There is no e-mail transport in step 1. The raw token is returned only
      // to the authorized inviter so the invitation can be delivered out of
      // band. Replace this with e-mail delivery and remove it in step 2.
      token,
      expiresAt: invitation.expiresAt,
    },
  });
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const context = req.organization!;
  const query = req.query as unknown as InvitationListQuery;
  const result = await listInvitations(context.organization.id, query);
  res.status(200).json(result);
});

export const revoke = asyncHandler(async (req: Request, res: Response) => {
  const context = req.organization!;
  const invitation = await revokeInvitation(context.organization.id, req.params.invitationId!);
  res.status(200).json({ data: { invitation: toInvitationSummary(invitation) } });
});

export const preview = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as InvitationTokenInput;
  const invitation = await previewInvitation(input.token);
  res.status(200).json({ data: { invitation } });
});

export const accept = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as InvitationTokenInput;
  const { membership, organization } = await acceptInvitation(input.token, req.auth!.user);
  res.status(200).json({ data: toAcceptedInvitation(membership, organization) });
});
