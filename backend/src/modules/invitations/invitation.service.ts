import { Op, UniqueConstraintError, type WhereOptions } from 'sequelize';
import { config } from '../../config/env';
import { logger } from '../../config/logger';
import {
  sequelize,
  CustomRole,
  Invitation,
  Membership,
  Organization,
  User,
} from '../../database';
import { generateOpaqueToken, hashOpaqueToken } from '../../utils/crypto';
import { invitationEmail } from '../../utils/emailTemplates';
import { AppError } from '../../utils/errors';
import { sendMail } from '../../utils/mailer';
import { paginate } from '../../utils/pagination';
import { hashPassword } from '../../utils/password';
import { hasPermission, assertInvitableRole } from '../memberships/permissions';
import { toMembershipSummary, toOrganizationSummary } from '../memberships/membership.mapper';
import { recordAuditEvent, type AuditContext } from '../screenshots/audit.service';
import {
  getManagerRoleOverride,
  toManagerRoleOverrideAccess,
} from '../roles/managerRole.service';
import type {
  ManagerRoleOverrideAccess,
  PermissionSubject,
} from '../memberships/permissions';
import type { CustomRole as CustomRoleModel } from '../roles/customRole.model';
import type { Invitation as InvitationModel, InvitationAttributes } from './invitation.model';
import type { Membership as MembershipModel } from '../memberships/membership.model';
import type { Organization as OrganizationModel } from '../organizations/organization.model';
import type { User as UserModel } from '../users/user.model';
import type { AcceptInvitationInput, CreateInvitationInput, InvitationListQuery } from './invitation.schemas';

export function toInvitationSummary(invitation: InvitationModel) {
  return {
    id: invitation.id,
    organizationId: invitation.organizationId,
    name: invitation.name ?? null,
    email: invitation.email,
    role: invitation.role,
    customRoleId: invitation.customRoleId ?? null,
    ...(invitation.customRole
      ? {
          customRole: {
            id: invitation.customRole.id,
            name: invitation.customRole.name,
          },
        }
      : {}),
    expiresAt: invitation.expiresAt,
    acceptedAt: invitation.acceptedAt,
    revokedAt: invitation.revokedAt,
    createdAt: invitation.createdAt,
    ...(invitation.inviter
      ? {
          invitedBy: {
            id: invitation.inviter.id,
            name: invitation.inviter.name,
            email: invitation.inviter.email,
          },
        }
      : {}),
  };
}

function hashInvitationToken(token: string): string {
  return hashOpaqueToken(token, config.auth.tokenPepper);
}

function invitationRoleLabel(invitation: InvitationModel): string {
  if (invitation.customRole) return invitation.customRole.name;
  switch (invitation.role) {
    case 'ADMIN':
      return 'Admin';
    case 'MANAGER':
      return 'Manager';
    default:
      return 'Employee';
  }
}

/**
 * Deliver the invitation e-mail. Delivery failures never roll back the
 * invitation, so an administrator can retry with "resend".
 */
async function deliverInvitationEmail(
  invitation: InvitationModel,
  organizationName: string,
  token: string,
  inviterName?: string | null,
): Promise<boolean> {
  const acceptUrl = `${config.mail.webAppUrl}/invitations/accept?token=${encodeURIComponent(token)}`;
  const template = invitationEmail({
    organizationName,
    invitedEmail: invitation.email,
    roleLabel: invitationRoleLabel(invitation),
    inviterName: inviterName ?? null,
    acceptUrl,
    expiresAt: invitation.expiresAt,
  });

  try {
    await sendMail({ to: invitation.email, ...template });
    return true;
  } catch (error) {
    logger.error(
      { err: error, invitationId: invitation.id, organizationId: invitation.organizationId },
      'failed to send invitation e-mail',
    );
    return false;
  }
}

function assertInvitationUsable(invitation: InvitationModel, now = new Date()): void {
  if (invitation.acceptedAt) {
    throw AppError.gone('This invitation has already been used', 'INVITATION_ALREADY_USED');
  }
  if (invitation.revokedAt) {
    throw AppError.gone('This invitation has been revoked', 'INVITATION_REVOKED');
  }
  if (invitation.expiresAt.getTime() <= now.getTime()) {
    throw AppError.gone('This invitation has expired', 'INVITATION_EXPIRED');
  }
}

export async function createInvitation(
  actor: MembershipModel,
  organization: OrganizationModel,
  input: CreateInvitationInput,
  effective: PermissionSubject,
  context?: AuditContext,
): Promise<{ invitation: InvitationModel; token: string; emailSent: boolean }> {
  const canInvite = hasPermission(effective, 'member:invite');
  const canOnboard = hasPermission(effective, 'member:onboard');

  if (!canInvite && !canOnboard) {
    throw AppError.forbidden('Your role does not permit this action', 'PERMISSION_DENIED');
  }

  let customRole: CustomRoleModel | null = null;
  if (input.customRoleId) {
    customRole = await CustomRole.findOne({
      where: { id: input.customRoleId, organizationId: organization.id },
    });
    if (!customRole) {
      throw AppError.notFound('Role not found', 'ROLE_NOT_FOUND');
    }
    if (!customRole.onboardingEligible) {
      throw AppError.forbidden(
        'This role is not approved for onboarding in this organization',
        'ROLE_NOT_ONBOARDING_ELIGIBLE',
      );
    }
    if (input.role !== 'EMPLOYEE') {
      throw AppError.forbidden(
        'A custom role is granted at employee level',
        'ROLE_ASSIGNMENT_FORBIDDEN',
      );
    }
  }

  // A custom role always sits on the EMPLOYEE base role.
  const invitedRole = customRole ? 'EMPLOYEE' : input.role;

  if (canInvite) {
    // ADMIN may not invite ADMIN; OWNER cannot be invited by anyone.
    assertInvitableRole(actor.role, invitedRole);
  } else if (invitedRole !== 'EMPLOYEE') {
    // member:onboard only ever creates employee-level invitations.
    throw AppError.forbidden(
      'Only an owner or admin can invite administrative roles',
      'ROLE_ASSIGNMENT_FORBIDDEN',
    );
  }

  const existingUser = await User.findOne({ where: { email: input.email } });
  if (existingUser) {
    const existingMembership = await Membership.findOne({
      where: { organizationId: organization.id, userId: existingUser.id },
    });

    if (existingMembership?.status === 'ACTIVE') {
      throw AppError.conflict('This person is already a member', 'MEMBER_ALREADY_EXISTS');
    }
    if (existingMembership?.status === 'SUSPENDED') {
      throw AppError.conflict(
        'This person has a suspended membership. Reactivate it instead of inviting them.',
        'MEMBERSHIP_SUSPENDED',
      );
    }
  }

  const token = generateOpaqueToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.auth.invitationTtlSeconds * 1000);

  const invitation = await sequelize.transaction(async (transaction) => {
    // Only one live invitation per organization/e-mail. Re-inviting rotates the
    // token and invalidates the previous link.
    await Invitation.update(
      { revokedAt: now },
      {
        where: {
          organizationId: organization.id,
          email: input.email,
          acceptedAt: null,
          revokedAt: null,
        },
        transaction,
      },
    );

    const created = await Invitation.create(
      {
        organizationId: organization.id,
        name: input.name,
        email: input.email,
        role: invitedRole,
        customRoleId: customRole?.id ?? null,
        tokenHash: hashInvitationToken(token),
        inviterId: actor.userId,
        expiresAt,
      },
      { transaction },
    );

    await recordAuditEvent(
      {
        organizationId: organization.id,
        actorUserId: actor.userId,
        action: 'INVITATION_CREATED',
        entityType: 'INVITATION',
        entityId: created.id,
        metadata: {
          email: created.email,
          role: created.role,
          customRoleId: created.customRoleId,
        },
      },
      { transaction, context },
    );

    created.customRole = customRole;
    return created;
  });

  const inviter = await User.findByPk(actor.userId, { attributes: ['id', 'name'] });
  const emailSent = await deliverInvitationEmail(
    invitation,
    organization.name,
    token,
    inviter?.name ?? null,
  );

  logger.info(
    {
      invitationId: invitation.id,
      organizationId: organization.id,
      role: invitation.role,
      emailSent,
    },
    'invitation created',
  );

  return { invitation, token, emailSent };
}

export async function listInvitations(
  organizationId: string,
  query: InvitationListQuery,
  options: { inviterUserId?: string } = {},
) {
  const now = new Date();
  const where: WhereOptions<InvitationAttributes> = { organizationId };

  // Onboarding-only actors manage their own invitations, not the full history.
  if (options.inviterUserId) {
    where.inviterId = options.inviterUserId;
  }

  switch (query.status) {
    case 'pending':
      where.acceptedAt = null;
      where.revokedAt = null;
      where.expiresAt = { [Op.gt]: now };
      break;
    case 'expired':
      where.acceptedAt = null;
      where.revokedAt = null;
      where.expiresAt = { [Op.lte]: now };
      break;
    case 'accepted':
      where.acceptedAt = { [Op.ne]: null };
      break;
    case 'revoked':
      where.revokedAt = { [Op.ne]: null };
      break;
    case 'all':
    default:
      break;
  }

  const { rows, count } = await Invitation.findAndCountAll({
    where,
    include: [
      {
        model: User,
        as: 'inviter',
        required: false,
        attributes: ['id', 'name', 'email'],
      },
      { model: CustomRole, as: 'customRole', required: false, attributes: ['id', 'name'] },
    ],
    order: [
      ['createdAt', 'DESC'],
      ['id', 'ASC'],
    ],
    limit: query.limit,
    offset: (query.page - 1) * query.limit,
    distinct: true,
  });

  return paginate(rows.map(toInvitationSummary), count, query.page, query.limit);
}

export async function revokeInvitation(options: {
  organizationId: string;
  invitationId: string;
  actorUserId: string;
  /** Onboarding-only actors may revoke only invitations they created. */
  ownOnly: boolean;
  context?: AuditContext;
}): Promise<InvitationModel> {
  const { organizationId, invitationId, actorUserId, ownOnly, context } = options;

  const invitation = await Invitation.findOne({
    where: { id: invitationId, organizationId },
    include: [
      { model: CustomRole, as: 'customRole', required: false, attributes: ['id', 'name'] },
    ],
  });

  if (!invitation || (ownOnly && invitation.inviterId !== actorUserId)) {
    throw AppError.notFound('Invitation not found', 'INVITATION_NOT_FOUND');
  }
  if (invitation.acceptedAt) {
    throw AppError.conflict('This invitation has already been accepted', 'INVITATION_ALREADY_ACCEPTED');
  }
  if (!invitation.revokedAt) {
    await sequelize.transaction(async (transaction) => {
      await invitation.update({ revokedAt: new Date() }, { transaction });
      await recordAuditEvent(
        {
          organizationId,
          actorUserId,
          action: 'INVITATION_REVOKED',
          entityType: 'INVITATION',
          entityId: invitation.id,
          metadata: {
            email: invitation.email,
            role: invitation.role,
            customRoleId: invitation.customRoleId,
          },
        },
        { transaction, context },
      );
    });
  }

  return invitation;
}

/**
 * Rotate the token and extend the expiry of a pending invitation, then send a
 * fresh e-mail. The previous link stops working immediately.
 */
export async function resendInvitation(options: {
  organizationId: string;
  invitationId: string;
  actorUserId: string;
  /** Onboarding-only actors may resend only invitations they created. */
  ownOnly: boolean;
  context?: AuditContext;
}): Promise<{ invitation: InvitationModel; token: string; emailSent: boolean }> {
  const { organizationId, invitationId, actorUserId, ownOnly, context } = options;

  const invitation = await Invitation.findOne({
    where: { id: invitationId, organizationId },
    include: [
      { model: Organization, as: 'organization', required: true },
      { model: CustomRole, as: 'customRole', required: false, attributes: ['id', 'name'] },
      { model: User, as: 'inviter', required: false, attributes: ['id', 'name'] },
    ],
  });

  if (!invitation || (ownOnly && invitation.inviterId !== actorUserId)) {
    throw AppError.notFound('Invitation not found', 'INVITATION_NOT_FOUND');
  }
  if (invitation.acceptedAt) {
    throw AppError.conflict('This invitation has already been accepted', 'INVITATION_ALREADY_ACCEPTED');
  }
  if (invitation.revokedAt) {
    throw AppError.gone('This invitation has been revoked', 'INVITATION_REVOKED');
  }
  if (!invitation.organization) {
    throw AppError.notFound('Organization not found', 'ORGANIZATION_NOT_FOUND');
  }

  const token = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + config.auth.invitationTtlSeconds * 1000);

  await sequelize.transaction(async (transaction) => {
    await invitation.update(
      { tokenHash: hashInvitationToken(token), expiresAt },
      { transaction },
    );
    await recordAuditEvent(
      {
        organizationId,
        actorUserId,
        action: 'INVITATION_RESENT',
        entityType: 'INVITATION',
        entityId: invitation.id,
        metadata: {
          email: invitation.email,
          role: invitation.role,
          customRoleId: invitation.customRoleId,
          expiresAt,
        },
      },
      { transaction, context },
    );
  });

  const emailSent = await deliverInvitationEmail(
    invitation,
    invitation.organization.name,
    token,
    invitation.inviter?.name ?? null,
  );

  logger.info(
    { invitationId: invitation.id, organizationId, emailSent },
    'invitation resent',
  );

  return { invitation, token, emailSent };
}

export async function previewInvitation(
  token: string,
  viewer: { id: string; email: string } | null = null,
) {
  const invitation = await Invitation.findOne({
    where: { tokenHash: hashInvitationToken(token) },
    include: [
      { model: Organization, as: 'organization', required: true },
      { model: CustomRole, as: 'customRole', required: false, attributes: ['id', 'name'] },
    ],
  });

  if (!invitation) {
    throw AppError.badRequest('Invitation is invalid', 'INVITATION_INVALID');
  }

  assertInvitationUsable(invitation);

  if (invitation.organization!.deletedAt || invitation.organization!.status !== 'ACTIVE') {
    throw AppError.forbidden(
      'This organization is not accepting invitations',
      'ORGANIZATION_SUSPENDED',
    );
  }

  const existingUser = await User.findOne({
    where: { email: invitation.email },
    attributes: ['id'],
  });

  return {
    organization: toOrganizationSummary(invitation.organization!),
    name: invitation.name ?? null,
    email: invitation.email,
    role: invitation.role,
    customRole: invitation.customRole
      ? { id: invitation.customRole.id, name: invitation.customRole.name }
      : null,
    expiresAt: invitation.expiresAt,
    // The caller holds the e-mailed token, so revealing whether an account
    // already exists cannot be used to enumerate arbitrary addresses.
    existingAccount: Boolean(existingUser),
    signedInEmail: viewer?.email ?? null,
    signedInMatches: Boolean(viewer && existingUser && viewer.id === existingUser.id),
  };
}

export type AcceptInvitationResult = {
  membership: MembershipModel;
  organization: OrganizationModel;
  managerOverride: ManagerRoleOverrideAccess | null;
  user: UserModel;
  accountCreated: boolean;
};

/**
 * Accept an invitation. A new account is created from the invited name/email
 * and the chosen password; an existing account must already be authenticated
 * and keeps its password. Membership creation and the single-use invitation
 * claim share one transaction.
 */
export async function acceptInvitation(
  token: string,
  input: AcceptInvitationInput,
  viewer: { id: string; email: string } | null = null,
): Promise<AcceptInvitationResult> {
  const tokenHash = hashInvitationToken(token);

  // Resolve the account path before opening the transaction so Argon2id hashing
  // does not hold a database transaction open. The conditional claim below is
  // still the authoritative concurrency guard.
  const candidate = await Invitation.findOne({ where: { tokenHash } });
  if (!candidate) {
    throw AppError.badRequest('Invitation is invalid', 'INVITATION_INVALID');
  }
  assertInvitationUsable(candidate);

  // A signed-in visitor may only accept an invitation addressed to their own
  // account. This prevents accepting a colleague's link into the wrong account.
  if (viewer && viewer.email !== candidate.email) {
    throw AppError.forbidden(
      'This invitation was issued to a different email address',
      'INVITATION_EMAIL_MISMATCH',
    );
  }

  const existingAccount = await User.findOne({
    where: { email: candidate.email },
    attributes: ['id', 'email'],
  });

  if (existingAccount) {
    if (!viewer) {
      throw AppError.unauthorized(
        'Sign in with the invited email address to accept this invitation.',
        'ACCOUNT_EXISTS_SIGN_IN',
      );
    }
    if (viewer.id !== existingAccount.id) {
      throw AppError.forbidden(
        'This invitation was issued to a different email address',
        'INVITATION_EMAIL_MISMATCH',
      );
    }
  } else if (!input.password) {
    throw AppError.unprocessable(
      'Choose a password to activate your account.',
      'PASSWORD_REQUIRED',
      [{ path: 'password', message: 'Password is required for a new account' }],
    );
  }

  const passwordHash =
    !existingAccount && input.password ? await hashPassword(input.password) : null;

  return sequelize.transaction(async (transaction) => {
    const invitation = await Invitation.findOne({
      where: { id: candidate.id },
      include: [
        { model: Organization, as: 'organization', required: true },
        { model: CustomRole, as: 'customRole', required: false },
      ],
      transaction,
    });

    if (!invitation || !invitation.organization) {
      throw AppError.badRequest('Invitation is invalid', 'INVITATION_INVALID');
    }

    assertInvitationUsable(invitation);

    if (invitation.organization.deletedAt || invitation.organization.status !== 'ACTIVE') {
      throw AppError.forbidden('This organization is not accepting invitations', 'ORGANIZATION_SUSPENDED');
    }

    let user: UserModel;
    let accountCreated = false;

    if (existingAccount) {
      const existing = await User.findByPk(existingAccount.id, { transaction });
      if (!existing) {
        throw AppError.unauthorized(
          'Sign in with the invited email address to accept this invitation.',
          'ACCOUNT_EXISTS_SIGN_IN',
        );
      }
      user = existing;
    } else {
      try {
        user = await User.create(
          {
            name: invitation.name?.trim() || invitation.email.split('@')[0] || 'Employee',
            email: invitation.email,
            passwordHash: passwordHash!,
          },
          { transaction },
        );
        accountCreated = true;
      } catch (error) {
        if (error instanceof UniqueConstraintError) {
          throw AppError.conflict(
            'An account already exists for this email address. Sign in to accept the invitation.',
            'ACCOUNT_EXISTS_SIGN_IN',
          );
        }
        throw error;
      }
    }

    const existingMembership = await Membership.findOne({
      where: { organizationId: invitation.organizationId, userId: user.id },
      transaction,
    });

    if (existingMembership?.status === 'ACTIVE') {
      throw AppError.conflict('You are already a member of this organization', 'ALREADY_MEMBER');
    }
    if (existingMembership?.status === 'SUSPENDED') {
      throw AppError.conflict(
        'Your membership is suspended. Ask an administrator to reactivate it.',
        'MEMBERSHIP_SUSPENDED',
      );
    }

    const now = new Date();

    // Single-use claim. The conditional update guarantees that two concurrent
    // acceptances cannot both succeed.
    const [claimed] = await Invitation.update(
      { acceptedAt: now, acceptedByUserId: user.id },
      {
        where: {
          id: invitation.id,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { [Op.gt]: now },
        },
        transaction,
      },
    );

    if (claimed !== 1) {
      throw AppError.gone('This invitation is no longer valid', 'INVITATION_ALREADY_USED');
    }

    // A custom role is only honored while it still exists, belongs to this
    // organization, and is still approved for onboarding. Otherwise the invite
    // degrades to a plain EMPLOYEE membership instead of granting stale access.
    const invitedCustomRole =
      invitation.customRole &&
      invitation.customRole.organizationId === invitation.organizationId &&
      invitation.customRole.onboardingEligible
        ? invitation.customRole
        : null;
    const invitedRole = invitation.customRoleId ? 'EMPLOYEE' : invitation.role;
    const invitedCustomRoleId = invitedCustomRole?.id ?? null;

    let membership: MembershipModel;

    if (existingMembership) {
      // A previously removed member is reactivated with the invited role.
      await existingMembership.update(
        {
          role: invitedRole,
          customRoleId: invitedCustomRoleId,
          status: 'ACTIVE',
          removedAt: null,
        },
        { transaction },
      );
      membership = existingMembership;
    } else {
      membership = await Membership.create(
        {
          organizationId: invitation.organizationId,
          userId: user.id,
          role: invitedRole,
          customRoleId: invitedCustomRoleId,
          status: 'ACTIVE',
        },
        { transaction },
      );
    }

    membership.organization = invitation.organization;
    membership.customRole = invitedCustomRole;

    await recordAuditEvent(
      {
        organizationId: invitation.organizationId,
        actorUserId: user.id,
        targetEmployeeId: user.id,
        action: 'INVITATION_ACCEPTED',
        entityType: 'INVITATION',
        entityId: invitation.id,
        metadata: {
          email: invitation.email,
          role: invitedRole,
          customRoleId: invitedCustomRoleId,
          accountCreated,
        },
      },
      { transaction },
    );

    const managerOverride =
      membership.role === 'MANAGER' && !membership.customRoleId
        ? await getManagerRoleOverride(invitation.organizationId)
        : null;

    logger.info(
      {
        invitationId: invitation.id,
        organizationId: invitation.organizationId,
        userId: user.id,
        role: membership.role,
        accountCreated,
      },
      'invitation accepted',
    );

    return {
      membership,
      organization: invitation.organization,
      managerOverride: toManagerRoleOverrideAccess(managerOverride),
      user,
      accountCreated,
    };
  });
}

export function toAcceptedInvitation(
  membership: MembershipModel,
  organization: OrganizationModel,
  managerOverride?: ManagerRoleOverrideAccess | null,
) {
  return {
    membership: toMembershipSummary(membership, managerOverride),
    organization: toOrganizationSummary(organization),
  };
}
