import { Op, type Transaction } from 'sequelize';
import { sequelize, Membership, User } from '../../database';
import { AppError } from '../../utils/errors';
import { paginate } from '../../utils/pagination';
import { assertCanManageMembership, assertRoleChangeAllowed } from './permissions';
import { toMembershipSummary } from './membership.mapper';
import type { MembershipAttributes, Membership as MembershipModel } from './membership.model';
import type { MembershipListQuery } from '../organizations/organization.schemas';
import type { Role } from './roles';

function rowLock(transaction: Transaction) {
  return sequelize.getDialect() === 'postgres' ? transaction.LOCK.UPDATE : undefined;
}

async function findTargetMembership(
  organizationId: string,
  membershipId: string,
  transaction?: Transaction,
): Promise<MembershipModel> {
  const membership = await Membership.findOne({
    where: { id: membershipId, organizationId },
    include: [{ model: User, as: 'user', required: true }],
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
    ],
    order: [
      ['createdAt', 'ASC'],
      ['id', 'ASC'],
    ],
    limit,
    offset: (page - 1) * limit,
    distinct: true,
  });

  return paginate(rows.map(toMembershipSummary), count, page, limit);
}

export async function changeMembershipRole(
  actor: MembershipModel,
  organizationId: string,
  membershipId: string,
  role: Role,
) {
  return sequelize.transaction(async (transaction) => {
    const target = await findTargetMembership(organizationId, membershipId, transaction);

    assertCanManageMembership(actor, target);
    assertRoleChangeAllowed(actor.role, target.role, role);

    if (target.role === role) return toMembershipSummary(target);

    if (target.role === 'OWNER' && target.status === 'ACTIVE' && role !== 'OWNER') {
      await assertNotLastActiveOwner(organizationId, target.id, transaction);
    }

    await target.update({ role }, { transaction });
    return toMembershipSummary(target);
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

    if (target.status === 'SUSPENDED') return toMembershipSummary(target);

    if (target.role === 'OWNER') {
      await assertNotLastActiveOwner(organizationId, target.id, transaction);
    }

    await target.update({ status: 'SUSPENDED' }, { transaction });
    return toMembershipSummary(target);
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
  return toMembershipSummary(target);
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
    return toMembershipSummary(target);
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
