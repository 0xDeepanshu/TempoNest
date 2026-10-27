import { Op, type WhereOptions } from 'sequelize';
import { config } from '../../config/env';
import { logger } from '../../config/logger';
import { sequelize, Invitation, Membership, Organization, User } from '../../database';
import { generateOpaqueToken, hashOpaqueToken } from '../../utils/crypto';
import { AppError } from '../../utils/errors';
import { paginate } from '../../utils/pagination';
import { assertInvitableRole } from '../memberships/permissions';
import { toMembershipSummary, toOrganizationSummary } from '../memberships/membership.mapper';
import type { Invitation as InvitationModel, InvitationAttributes } from './invitation.model';
import type { Membership as MembershipModel } from '../memberships/membership.model';
import type { Organization as OrganizationModel } from '../organizations/organization.model';
import type { User as UserModel } from '../users/user.model';
import type { CreateInvitationInput, InvitationListQuery } from './invitation.schemas';

export function toInvitationSummary(invitation: InvitationModel) {
  return {
    id: invitation.id,
    organizationId: invitation.organizationId,
    email: invitation.email,
    role: invitation.role,
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
): Promise<{ invitation: InvitationModel; token: string }> {
  assertInvitableRole(actor.role, input.role);

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

    return Invitation.create(
      {
        organizationId: organization.id,
        email: input.email,
        role: input.role,
        tokenHash: hashInvitationToken(token),
        inviterId: actor.userId,
        expiresAt,
      },
      { transaction },
    );
  });

  logger.info(
    { invitationId: invitation.id, organizationId: organization.id, role: invitation.role },
    'invitation created',
  );

  return { invitation, token };
}

export async function listInvitations(organizationId: string, query: InvitationListQuery) {
  const now = new Date();
  const where: WhereOptions<InvitationAttributes> = { organizationId };

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

export async function revokeInvitation(
  organizationId: string,
  invitationId: string,
): Promise<InvitationModel> {
  const invitation = await Invitation.findOne({ where: { id: invitationId, organizationId } });

  if (!invitation) {
    throw AppError.notFound('Invitation not found', 'INVITATION_NOT_FOUND');
  }
  if (invitation.acceptedAt) {
    throw AppError.conflict('This invitation has already been accepted', 'INVITATION_ALREADY_ACCEPTED');
  }
  if (!invitation.revokedAt) {
    await invitation.update({ revokedAt: new Date() });
  }

  return invitation;
}

export async function previewInvitation(token: string) {
  const invitation = await Invitation.findOne({
    where: { tokenHash: hashInvitationToken(token) },
    include: [{ model: Organization, as: 'organization', required: true }],
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

  return {
    organization: toOrganizationSummary(invitation.organization!),
    email: invitation.email,
    role: invitation.role,
    expiresAt: invitation.expiresAt,
  };
}

export async function acceptInvitation(
  token: string,
  user: UserModel,
): Promise<{ membership: MembershipModel; organization: OrganizationModel }> {
  const tokenHash = hashInvitationToken(token);

  return sequelize.transaction(async (transaction) => {
    const invitation = await Invitation.findOne({
      where: { tokenHash },
      include: [{ model: Organization, as: 'organization', required: true }],
      transaction,
    });

    if (!invitation || !invitation.organization) {
      throw AppError.badRequest('Invitation is invalid', 'INVITATION_INVALID');
    }

    assertInvitationUsable(invitation);

    if (invitation.email !== user.email) {
      throw AppError.forbidden(
        'This invitation was issued to a different email address',
        'INVITATION_EMAIL_MISMATCH',
      );
    }

    if (invitation.organization.deletedAt || invitation.organization.status !== 'ACTIVE') {
      throw AppError.forbidden('This organization is not accepting invitations', 'ORGANIZATION_SUSPENDED');
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

    let membership: MembershipModel;

    if (existingMembership) {
      // A previously removed member is reactivated with the invited role.
      await existingMembership.update(
        { role: invitation.role, status: 'ACTIVE', removedAt: null },
        { transaction },
      );
      membership = existingMembership;
    } else {
      membership = await Membership.create(
        {
          organizationId: invitation.organizationId,
          userId: user.id,
          role: invitation.role,
          status: 'ACTIVE',
        },
        { transaction },
      );
    }

    membership.organization = invitation.organization;

    logger.info(
      {
        invitationId: invitation.id,
        organizationId: invitation.organizationId,
        userId: user.id,
        role: membership.role,
      },
      'invitation accepted',
    );

    return { membership, organization: invitation.organization };
  });
}

export function toAcceptedInvitation(membership: MembershipModel, organization: OrganizationModel) {
  return {
    membership: toMembershipSummary(membership),
    organization: toOrganizationSummary(organization),
  };
}
