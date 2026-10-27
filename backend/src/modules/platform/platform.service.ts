import { Op, fn, col, type WhereOptions } from 'sequelize';
import { sequelize, Membership, Organization, User } from '../../database';
import { agentHub } from '../../realtime/agentHub';
import { terminateActiveScreenLiveSessionsForOrganization } from '../screenshots/screenLive.service';
import { AppError } from '../../utils/errors';
import { paginate } from '../../utils/pagination';
import { verifyPassword } from '../../utils/password';
import type { Organization as OrganizationModel } from '../organizations/organization.model';
import type { User as UserModel } from '../users/user.model';
import {
  recordPlatformAuditEvent,
  type PlatformAuditContext,
} from './platformAudit.service';
import type {
  PlatformDeleteOrganizationInput,
  PlatformOrganizationListQuery,
} from './platform.schemas';

type MemberCounts = {
  memberCount: number;
  activeMemberCount: number;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PlatformOrganizationSummary = {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  memberCount: number;
  activeMemberCount: number;
};

function organizationStatus(organization: OrganizationModel): PlatformOrganizationSummary['status'] {
  if (organization.deletedAt) return 'DELETED';
  return organization.status;
}

function toPlatformOrganizationSummary(
  organization: OrganizationModel,
  counts: MemberCounts,
): PlatformOrganizationSummary {
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    status: organizationStatus(organization),
    timezone: organization.timezone,
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt,
    deletedAt: organization.deletedAt,
    memberCount: counts.memberCount,
    activeMemberCount: counts.activeMemberCount,
  };
}

async function loadMemberCounts(organizationIds: string[]): Promise<Map<string, MemberCounts>> {
  const counts = new Map<string, MemberCounts>();
  if (organizationIds.length === 0) return counts;

  const rows = (await Membership.findAll({
    attributes: [
      'organizationId',
      'status',
      [fn('COUNT', col('id')), 'count'],
    ],
    where: {
      organizationId: { [Op.in]: organizationIds },
      status: { [Op.ne]: 'REMOVED' },
    },
    group: ['organizationId', 'status'],
    raw: true,
  })) as unknown as Array<{ organizationId: string; status: string; count: string | number }>;

  for (const row of rows) {
    const current = counts.get(row.organizationId) ?? {
      memberCount: 0,
      activeMemberCount: 0,
    };
    const count = Number(row.count);
    current.memberCount += count;
    if (row.status === 'ACTIVE') current.activeMemberCount += count;
    counts.set(row.organizationId, current);
  }

  return counts;
}

async function loadMemberCountsFor(organizationId: string): Promise<MemberCounts> {
  const counts = await loadMemberCounts([organizationId]);
  return counts.get(organizationId) ?? { memberCount: 0, activeMemberCount: 0 };
}

function buildListWhere(query: PlatformOrganizationListQuery): WhereOptions {
  const where: WhereOptions = {};

  if (query.status === 'DELETED') {
    where.deletedAt = { [Op.ne]: null };
  } else {
    where.deletedAt = null;
    if (query.status !== 'ALL') where.status = query.status;
  }

  if (query.q) {
    const pattern = `%${query.q}%`;
    const like = sequelize.getDialect() === 'postgres' ? Op.iLike : Op.like;
    const search: WhereOptions[] = [
      { name: { [like]: pattern } },
      { slug: { [like]: pattern } },
    ];
    if (UUID_PATTERN.test(query.q)) search.push({ id: query.q });
    (where as Record<symbol, unknown>)[Op.or] = search;
  }

  return where;
}

export async function getPlatformOverview() {
  const [total, active, suspended, deleted] = await Promise.all([
    Organization.count(),
    Organization.count({ where: { status: 'ACTIVE', deletedAt: null } }),
    Organization.count({ where: { status: 'SUSPENDED', deletedAt: null } }),
    Organization.count({ where: { deletedAt: { [Op.ne]: null } } }),
  ]);

  return { total, active, suspended, deleted };
}

export async function listPlatformOrganizations(query: PlatformOrganizationListQuery) {
  const { rows, count } = await Organization.findAndCountAll({
    where: buildListWhere(query),
    order: [
      ['createdAt', 'DESC'],
      ['id', 'ASC'],
    ],
    limit: query.limit,
    offset: (query.page - 1) * query.limit,
  });

  const counts = await loadMemberCounts(rows.map((organization) => organization.id));

  return paginate(
    rows.map((organization) =>
      toPlatformOrganizationSummary(
        organization,
        counts.get(organization.id) ?? { memberCount: 0, activeMemberCount: 0 },
      ),
    ),
    count,
    query.page,
    query.limit,
  );
}

export async function getPlatformOrganization(organizationId: string) {
  const organization = await Organization.findByPk(organizationId);
  if (!organization) {
    throw AppError.notFound('Organization not found', 'ORGANIZATION_NOT_FOUND');
  }

  return toPlatformOrganizationSummary(
    organization,
    await loadMemberCountsFor(organization.id),
  );
}

function assertMutable(organization: OrganizationModel): void {
  if (organization.deletedAt) {
    throw AppError.conflict(
      'This organization has been deleted and is read-only',
      'ORGANIZATION_DELETED',
    );
  }
}

export async function renamePlatformOrganization(
  actorUserId: string,
  organizationId: string,
  name: string,
  context?: PlatformAuditContext,
): Promise<OrganizationModel> {
  return sequelize.transaction(async (transaction) => {
    const organization = await Organization.findByPk(organizationId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!organization) {
      throw AppError.notFound('Organization not found', 'ORGANIZATION_NOT_FOUND');
    }
    assertMutable(organization);

    const nextName = name.trim();
    if (organization.name === nextName) {
      throw AppError.conflict('The organization name is unchanged', 'ORGANIZATION_NAME_UNCHANGED');
    }

    const before = { name: organization.name };
    await organization.update({ name: nextName }, { transaction });
    await recordPlatformAuditEvent(
      {
        actorUserId,
        targetOrganizationId: organization.id,
        targetOrganizationName: nextName,
        action: 'ORGANIZATION_RENAMED',
        metadata: { before, after: { name: nextName } },
      },
      { transaction, context },
    );

    return organization;
  });
}

async function setOrganizationStatus(
  actorUserId: string,
  organizationId: string,
  nextStatus: 'ACTIVE' | 'SUSPENDED',
  context?: PlatformAuditContext,
): Promise<OrganizationModel> {
  const organization = await sequelize.transaction(async (transaction) => {
    const locked = await Organization.findByPk(organizationId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!locked) {
      throw AppError.notFound('Organization not found', 'ORGANIZATION_NOT_FOUND');
    }
    assertMutable(locked);

    if (locked.status === nextStatus) {
      throw AppError.conflict(
        nextStatus === 'ACTIVE'
          ? 'This organization is already active'
          : 'This organization is already suspended',
        nextStatus === 'ACTIVE' ? 'ORGANIZATION_ALREADY_ACTIVE' : 'ORGANIZATION_ALREADY_SUSPENDED',
      );
    }

    const before = { status: locked.status };
    await locked.update({ status: nextStatus }, { transaction });
    await recordPlatformAuditEvent(
      {
        actorUserId,
        targetOrganizationId: locked.id,
        targetOrganizationName: locked.name,
        action:
          nextStatus === 'ACTIVE' ? 'ORGANIZATION_REACTIVATED' : 'ORGANIZATION_SUSPENDED',
        metadata: { before, after: { status: nextStatus } },
      },
      { transaction, context },
    );

    return locked;
  });

  if (nextStatus === 'SUSPENDED') {
    // Stop live capture durably before closing the organization's sockets.
    await terminateActiveScreenLiveSessionsForOrganization(
      organization.id,
      'ORGANIZATION_SUSPENDED',
    );
    // Live sockets on this process close immediately; other processes reject on
    // their next heartbeat revalidation.
    agentHub.closeOrganization(organization.id, 4003, 'ORGANIZATION_SUSPENDED');
  }

  return organization;
}

export async function suspendPlatformOrganization(
  actorUserId: string,
  organizationId: string,
  context?: PlatformAuditContext,
): Promise<OrganizationModel> {
  return setOrganizationStatus(actorUserId, organizationId, 'SUSPENDED', context);
}

export async function reactivatePlatformOrganization(
  actorUserId: string,
  organizationId: string,
  context?: PlatformAuditContext,
): Promise<OrganizationModel> {
  return setOrganizationStatus(actorUserId, organizationId, 'ACTIVE', context);
}

/**
 * Soft deletion only. Tenant-owned rows, memberships, sessions and stored files
 * are intentionally left in place; access is blocked by the organization
 * context. The typed name and password are re-verified inside the transaction
 * because permanent-looking actions deserve step-up confirmation.
 */
export async function softDeletePlatformOrganization(
  actor: UserModel,
  organizationId: string,
  input: PlatformDeleteOrganizationInput,
  context?: PlatformAuditContext,
): Promise<OrganizationModel> {
  const organization = await sequelize.transaction(async (transaction) => {
    const locked = await Organization.findByPk(organizationId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!locked) {
      throw AppError.notFound('Organization not found', 'ORGANIZATION_NOT_FOUND');
    }
    if (locked.deletedAt) {
      throw AppError.conflict('This organization is already deleted', 'ORGANIZATION_ALREADY_DELETED');
    }
    if (locked.name !== input.confirmationName) {
      throw AppError.badRequest(
        'The typed organization name does not match',
        'ORGANIZATION_NAME_MISMATCH',
      );
    }

    const actorWithPassword = await User.scope('withPassword').findByPk(actor.id, { transaction });
    if (
      !actorWithPassword ||
      !(await verifyPassword(actorWithPassword.passwordHash, input.password))
    ) {
      throw AppError.forbidden('Password confirmation failed', 'REAUTH_FAILED');
    }

    const deletedAt = new Date();
    const before = { name: locked.name, status: locked.status, deletedAt: null };
    await locked.update({ deletedAt }, { transaction });
    await recordPlatformAuditEvent(
      {
        actorUserId: actor.id,
        targetOrganizationId: locked.id,
        targetOrganizationName: locked.name,
        action: 'ORGANIZATION_SOFT_DELETED',
        metadata: {
          before,
          after: {
            name: locked.name,
            status: locked.status,
            deletedAt: deletedAt.toISOString(),
          },
          retention: 'tenant_data_preserved',
        },
      },
      { transaction, context },
    );

    return locked;
  });

  await terminateActiveScreenLiveSessionsForOrganization(
    organization.id,
    'ORGANIZATION_SUSPENDED',
  );
  agentHub.closeOrganization(organization.id, 4003, 'ORGANIZATION_SUSPENDED');

  return organization;
}
