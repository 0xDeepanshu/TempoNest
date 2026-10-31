import type { Request, Response } from 'express';
import { setAuthCookies } from '../../utils/cookies';
import { asyncHandler } from '../../utils/asyncHandler';
import { getClientIp, getUserAgent } from '../../utils/pagination';
import { createSession } from '../auth/session.service';
import { toPublicUser } from '../memberships/membership.mapper';
import { hasPermission } from '../memberships/permissions';
import {
  acceptInvitation,
  createInvitation,
  listInvitations,
  previewInvitation,
  resendInvitation,
  revokeInvitation,
  toAcceptedInvitation,
  toInvitationSummary,
} from './invitation.service';
import type {
  AcceptInvitationInput,
  CreateInvitationInput,
  InvitationListQuery,
  InvitationTokenInput,
} from './invitation.schemas';

function auditContext(req: Request) {
  return { ipAddress: getClientIp(req), userAgent: getUserAgent(req) };
}

export const create = asyncHandler(async (req: Request, res: Response) => {
  const context = req.organization!;
  const input = req.body as CreateInvitationInput;

  const { invitation, token, emailSent } = await createInvitation(
    context.membership,
    context.organization,
    input,
    context.effective,
    auditContext(req),
  );

  res.status(201).json({
    data: {
      invitation: toInvitationSummary(invitation),
      // The invitation is e-mailed. The token is also returned once to the
      // authorized inviter as a delivery fallback when SMTP is not configured.
      token,
      expiresAt: invitation.expiresAt,
      emailSent,
    },
  });
});

export const resend = asyncHandler(async (req: Request, res: Response) => {
  const context = req.organization!;
  const canResendAll = hasPermission(context.effective, 'member:invite');

  const { invitation, token, emailSent } = await resendInvitation({
    organizationId: context.organization.id,
    invitationId: req.params.invitationId!,
    actorUserId: req.auth!.user.id,
    ownOnly: !canResendAll,
    context: auditContext(req),
  });

  res.status(200).json({
    data: {
      invitation: toInvitationSummary(invitation),
      token,
      expiresAt: invitation.expiresAt,
      emailSent,
    },
  });
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const context = req.organization!;
  const query = req.query as unknown as InvitationListQuery;

  // Without invitation:read, an onboarding-only actor only sees invitations
  // they personally created.
  const canReadAll = hasPermission(context.effective, 'invitation:read');
  const result = await listInvitations(
    context.organization.id,
    query,
    canReadAll ? {} : { inviterUserId: context.membership.userId },
  );
  res.status(200).json(result);
});

export const revoke = asyncHandler(async (req: Request, res: Response) => {
  const context = req.organization!;
  const canRevokeAll = hasPermission(context.effective, 'invitation:revoke');

  const invitation = await revokeInvitation({
    organizationId: context.organization.id,
    invitationId: req.params.invitationId!,
    actorUserId: req.auth!.user.id,
    ownOnly: !canRevokeAll,
    context: auditContext(req),
  });
  res.status(200).json({ data: { invitation: toInvitationSummary(invitation) } });
});

export const preview = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as InvitationTokenInput;
  const viewer = req.auth
    ? { id: req.auth.user.id, email: req.auth.user.email }
    : null;
  const invitation = await previewInvitation(input.token, viewer);
  res.status(200).json({ data: { invitation } });
});

export const accept = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as AcceptInvitationInput;
  const viewer = req.auth
    ? { id: req.auth.user.id, email: req.auth.user.email }
    : null;

  const result = await acceptInvitation(input.token, input, viewer);

  // A first-time account is signed in immediately with the normal opaque
  // session cookies. Existing accounts keep their current session.
  let session: {
    id: string;
    transport: 'cookie';
    csrfToken: string;
    accessExpiresAt: Date;
    refreshExpiresAt: Date;
  } | null = null;

  if (result.accountCreated) {
    const issued = await createSession(result.user, req);
    setAuthCookies(res, {
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      csrfToken: issued.csrfToken,
      accessExpiresAt: issued.accessExpiresAt,
      refreshExpiresAt: issued.refreshExpiresAt,
    });
    await result.user.update({ lastLoginAt: new Date() });
    session = {
      id: issued.session.id,
      transport: 'cookie',
      csrfToken: issued.csrfToken,
      accessExpiresAt: issued.accessExpiresAt,
      refreshExpiresAt: issued.refreshExpiresAt,
    };
  }

  res.status(200).json({
    data: {
      ...toAcceptedInvitation(result.membership, result.organization, result.managerOverride),
      user: toPublicUser(result.user),
      accountCreated: result.accountCreated,
      session,
    },
  });
});
