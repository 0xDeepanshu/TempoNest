import { Op, type Transaction } from 'sequelize';
import { sequelize, CustomRole, Membership, User } from '../../database';
import { AppError } from '../../utils/errors';
import { paginate } from '../../utils/pagination';
import { assertCanManageMembership, assertRoleChangeAllowed } from './permissions';
import { toMembershipSummary } from './membership.mapper';
import { recordAuditEvent, type AuditContext } from '../screenshots/audit.service';
import {
  getManagerRoleOverride,
  getManagerRoleOverrides,
  toManagerRoleOverrideAccess,
} from '../roles/managerRole.service';
import type { MembershipAttributes, Membership as MembershipModel } from './membership.model';
import type { CustomRole as CustomRoleModel } from '../roles/customRole.model';
import type { MembershipListQuery } from '../organizations/organization.schemas';
import type { Role } from './roles';

function rowLock(transaction: Transaction) {
  if (sequelize.getDialect() !== 'postgres') return undefined;
  // Scope the lock to the membership row. A bare FOR UPDATE also targets the
  // nullable custom_roles side of the LEFT JOIN, which PostgreSQL rejects.
  return { level: transaction.LOCK.UPDATE, of: Membership };
}

async function findTargetMembership(
  organizationId: string,
  membershipId: string,
  transaction?: Transaction,
): Promise<MembershipModel> {
  const membership = await Membership.findOne({
    where: { id: membershipId, organizationId },
    include: [
      { model: User, as: 'user', required: true },
      { model: CustomRole, as: 'customRole', required: false },
    ],
    transaction,
    ...(transaction && rowLock(transaction) ? { lock: rowLock(transaction) } : {}),
  });

  if (!membership || membership.status === 'REMOVED') {
    throw AppError.notFound('Membership not found', 'MEMBERSHIP_NOT_FOUND');
  }

  return membership;
}

export async function listMembers(organizationId: string, query: MembershipListQuery) {
  const { page, limit } = query;
  const where: Partial<MembershipAttributes> = { organizationId };

  if (query.role) where.role = query.role;
  if (query.status) where.status = query.status;

  const like = sequelize.getDialect() === 'postgres' ? Op.iLike : Op.like;
  const userWhere = query.q
    ? {
        [Op.or]: [
          { name: { [like]: `%${query.q}%` } },
          { email: { [like]: `%${query.q.toLowerCase()}%` } },
        ],
      }
    : undefined;

  const { rows, count } = await Membership.findAndCountAll({
    where,
    include: [
      {
        model: User,
        as: 'user',
        required: true,
        ...(userWhere ? { where: userWhere } : {}),
        attributes: ['id', 'name', 'email', 'status', 'createdAt'],
      },
      { model: CustomRole, as: 'customRole', required: false },
    ],
    order: [
      ['createdAt', 'ASC'],
      ['id', 'ASC'],
    ],
    limit,
    offset: (page - 1) * limit,
    distinct: true,
  });

  const managerOrganizationIds = rows
    .filter((membership) => membership.role === 'MANAGER' && !membership.customRoleId)
    .map((membership) => membership.organizationId);
  const overrides = await getManagerRoleOverrides(managerOrganizationIds);

  return paginate(
    rows.map((membership) =>
      toMembershipSummary(
        membership,
        toManagerRoleOverrideAccess(overrides.get(membership.organizationId)),
      ),
    ),
    count,
    page,
    limit,
  );
}

/** Summaries reflect the organization's MANAGER customization when relevant. */
async function summarize(
  organizationId: string,
  membership: MembershipModel,
) {
  const override =
    membership.role === 'MANAGER' && !membership.customRoleId
      ? await getManagerRoleOverride(organizationId)
      : null;
  return toMembershipSummary(membership, toManagerRoleOverrideAccess(override));
}

export async function changeMembershipRole(
  actor: MembershipModel,
  organizationId: string,
  membershipId: string,
  input: { role?: Role; customRoleId?: string },
  context?: AuditContext,
) {
  return sequelize.transaction(async (transaction) => {
    const target = await findTargetMembership(organizationId, membershipId, transaction);

    assertCanManageMembership(actor, target);

    let customRole: CustomRoleModel | null = null;
    if (input.customRoleId) {
      customRole = await CustomRole.findOne({
        where: { id: input.customRoleId, organizationId },
        transaction,
      });
      if (!customRole) {
        throw AppError.notFound('Role not found', 'ROLE_NOT_FOUND');
      }
    }

    // A custom role is stored on top of the EMPLOYEE base role so it can never
    // inherit MANAGER/ADMIN hierarchy or manage memberships.
    const nextRole: Role = customRole ? 'EMPLOYEE' : input.role!;
    const nextCustomRoleId = customRole?.id ?? null;
    const previousCustomRoleId = target.customRoleId ?? null;
    const previousRole = target.role;

    assertRoleChangeAllowed(actor.role, target.role, nextRole);

    if (target.role === nextRole && previousCustomRoleId === nextCustomRoleId) {
      target.customRole = customRole;
      return summarize(organizationId, target);
    }

    if (target.role === 'OWNER' && target.status === 'ACTIVE' && nextRole !== 'OWNER') {
      await assertNotLastActiveOwner(organizationId, target.id, transaction);
    }

    await target.update(
      { role: nextRole, customRoleId: nextCustomRoleId },
      { transaction },
    );
    target.customRole = customRole;

    if (nextCustomRoleId) {
      await recordAuditEvent(
        {
          organizationId,
          actorUserId: actor.userId,
          targetEmployeeId: target.userId,
          action: 'CUSTOM_ROLE_ASSIGNED',
          entityType: 'MEMBERSHIP',
          entityId: target.id,
          metadata: {
            roleId: nextCustomRoleId,
            roleName: customRole!.name,
            previousRole,
            previousCustomRoleId,
          },
        },
        { transaction, context },
      );
    } else if (previousCustomRoleId) {
      await recordAuditEvent(
        {
          organizationId,
          actorUserId: actor.userId,
          targetEmployeeId: target.userId,
          action: 'CUSTOM_ROLE_UNASSIGNED',
          entityType: 'MEMBERSHIP',
          entityId: target.id,
          metadata: {
            roleId: previousCustomRoleId,
            role: nextRole,
          },
        },
        { transaction, context },
      );
    }

    return summarize(organizationId, target);
  });
}

export async function suspendMembership(
  actor: MembershipModel,
  organizationId: string,
  membershipId: string,
) {
  return sequelize.transaction(async (transaction) => {
    const target = await findTargetMembership(organizationId, membershipId, transaction);
    assertCanManageMembership(actor, target);

    if (target.status === 'SUSPENDED') return summarize(organizationId, target);

    if (target.role === 'OWNER') {
      await assertNotLastActiveOwner(organizationId, target.id, transaction);
    }

    await target.update({ status: 'SUSPENDED' }, { transaction });
    return summarize(organizationId, target);
  });
}

export async function reactivateMembership(
  actor: MembershipModel,
  organizationId: string,
  membershipId: string,
) {
  const target = await findTargetMembership(organizationId, membershipId);
  assertCanManageMembership(actor, target);

  if (target.status !== 'ACTIVE') {
    await target.update({ status: 'ACTIVE', removedAt: null });
  }
  return summarize(organizationId, target);
}

export async function removeMembership(
  actor: MembershipModel,
  organizationId: string,
  membershipId: string,
) {
  return sequelize.transaction(async (transaction) => {
    const target = await findTargetMembership(organizationId, membershipId, transaction);
    assertCanManageMembership(actor, target);

    if (target.role === 'OWNER' && target.status === 'ACTIVE') {
      await assertNotLastActiveOwner(organizationId, target.id, transaction);
    }

    await target.update({ status: 'REMOVED', removedAt: new Date() }, { transaction });
    return summarize(organizationId, target);
  });
}

async function assertNotLastActiveOwner(
  organizationId: string,
  excludingMembershipId: string,
  transaction: Transaction,
): Promise<void> {
  const otherOwners = await Membership.count({
    where: {
      organizationId,
      role: 'OWNER',
      status: 'ACTIVE',
      id: { [Op.ne]: excludingMembershipId },
    },
    transaction,
  });

  if (otherOwners === 0) {
    throw AppError.conflict(
      'The organization must keep at least one active owner',
      'LAST_OWNER',
    );
  }
}
