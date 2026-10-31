import { Op, UniqueConstraintError, fn, col, type Transaction } from 'sequelize';
import { CustomRole, ManagerRoleOverride, Membership, User, sequelize } from '../../database';
import { AppError } from '../../utils/errors';
import { paginate } from '../../utils/pagination';
import { recordAuditEvent, type AuditContext } from '../screenshots/audit.service';
import {
  CUSTOM_ROLE_GRANTABLE_PERMISSIONS,
  MANAGER_OVERRIDE_GRANTABLE_PERMISSIONS,
  PROTECTED_PERMISSIONS,
  ROLE_PERMISSIONS,
  isManagerOverridePermission,
  type DataScope,
  type Permission,
} from '../memberships/permissions';
import { ROLES, type Role } from '../memberships/roles';
import { toMembershipSummary } from '../memberships/membership.mapper';
import { getManagerRoleOverride, toManagerRoleOverrideAccess } from './managerRole.service';
import type { CustomRole as CustomRoleModel } from './customRole.model';
import type { ManagerRoleOverride as ManagerRoleOverrideModel } from './managerRoleOverride.model';
import type {
  CreateCustomRoleInput,
  UpdateCustomRoleInput,
  UpdateManagerRoleInput,
} from './customRole.schemas';
import {
  PERMISSION_CATALOG,
  PERMISSION_GROUP_LABELS,
  type PermissionGroupKey,
} from './permissionCatalog';

export const BUILT_IN_ROLE_DESCRIPTIONS: Record<Role, string> = {
  OWNER: 'Full organization control, including ownership and administration.',
  ADMIN: 'Administers people, monitoring, attendance, and reporting.',
  MANAGER: 'Reviews attendance and reads team reports without admin controls.',
  EMPLOYEE: 'Personal time tracking, attendance, and leave self-service.',
};

const ASSIGNED_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;

export function normalizeRoleName(name: string): string {
  return name.trim().normalize('NFC').toLowerCase();
}

export interface RoleSummary {
  id: string;
  key: string;
  name: string;
  description: string | null;
  builtIn: boolean;
  /** Built-in roles that an owner may customize. Only MANAGER qualifies. */
  customizable: boolean;
  /** True when the organization has stored a customization for this role. */
  customized: boolean;
  permissions: readonly Permission[];
  permissionCount: number;
  dataScope: DataScope;
  /** Whether this custom role may be used when onboarding an employee. */
  onboardingEligible: boolean;
  assignedUserCount: number;
  createdAt: string | null;
  updatedAt: string | null;
}

const MANAGER_DEFAULT_DATA_SCOPE: DataScope = 'ORGANIZATION';

function toCustomRoleSummary(role: CustomRoleModel, assignedUserCount: number): RoleSummary {
  return {
    id: role.id,
    key: role.id,
    name: role.name,
    description: role.description,
    builtIn: false,
    customizable: false,
    customized: false,
    permissions: role.permissions,
    permissionCount: role.permissions.length,
    dataScope: role.dataScope,
    onboardingEligible: role.onboardingEligible,
    assignedUserCount,
    createdAt: role.createdAt.toISOString(),
    updatedAt: role.updatedAt.toISOString(),
  };
}

function managerOverridePermissions(
  override: ManagerRoleOverrideModel | null,
): readonly Permission[] {
  if (!override) return ROLE_PERMISSIONS.MANAGER;
  return toManagerRoleOverrideAccess(override)!.permissions;
}

function toManagerRoleSummary(
  assignedUserCount: number,
  override: ManagerRoleOverrideModel | null,
): RoleSummary {
  const permissions = managerOverridePermissions(override);

  return {
    id: 'MANAGER',
    key: 'MANAGER',
    name: 'Manager',
    description: override?.description || BUILT_IN_ROLE_DESCRIPTIONS.MANAGER,
    builtIn: true,
    customizable: true,
    customized: Boolean(override),
    permissions,
    permissionCount: permissions.length,
    dataScope: override?.dataScope ?? MANAGER_DEFAULT_DATA_SCOPE,
    onboardingEligible: false,
    assignedUserCount,
    createdAt: null,
    updatedAt: override ? override.updatedAt.toISOString() : null,
  };
}

function toBuiltInRoleSummary(
  role: Role,
  assignedUserCount: number,
  managerOverride?: ManagerRoleOverrideModel | null,
): RoleSummary {
  if (role === 'MANAGER') {
    return toManagerRoleSummary(assignedUserCount, managerOverride ?? null);
  }

  return {
    id: role,
    key: role,
    name: role.charAt(0) + role.slice(1).toLowerCase(),
    description: BUILT_IN_ROLE_DESCRIPTIONS[role],
    builtIn: true,
    customizable: false,
    customized: false,
    permissions: ROLE_PERMISSIONS[role],
    permissionCount: ROLE_PERMISSIONS[role].length,
    dataScope: role === 'EMPLOYEE' ? 'SELF' : 'ORGANIZATION',
    onboardingEligible: false,
    assignedUserCount,
    createdAt: null,
    updatedAt: null,
  };
}

async function assignedCounts(organizationId: string): Promise<{
  byRole: Map<string, number>;
  byCustomRole: Map<string, number>;
}> {
  const statusWhere = { [Op.in]: [...ASSIGNED_STATUSES] };

  const [roleRows, customRows] = await Promise.all([
    Membership.findAll({
      where: { organizationId, status: statusWhere },
      attributes: ['role', [fn('COUNT', col('id')), 'count']],
      group: ['role'],
      raw: true,
    }) as unknown as Promise<Array<{ role: string; count: string | number }>>,
    Membership.findAll({
      where: {
        organizationId,
        status: statusWhere,
        customRoleId: { [Op.ne]: null },
      },
      attributes: ['customRoleId', [fn('COUNT', col('id')), 'count']],
      group: ['custom_role_id'],
      raw: true,
    }) as unknown as Promise<Array<{ customRoleId: string; count: string | number }>>,
  ]);

  return {
    byRole: new Map(roleRows.map((row) => [row.role, Number(row.count)])),
    byCustomRole: new Map(customRows.map((row) => [row.customRoleId, Number(row.count)])),
  };
}

export async function listRoles(organizationId: string): Promise<RoleSummary[]> {
  const [customRoles, counts, managerOverride] = await Promise.all([
    CustomRole.findAll({
      where: { organizationId },
      order: [
        ['nameNormalized', 'ASC'],
        ['id', 'ASC'],
      ],
    }),
    assignedCounts(organizationId),
    getManagerRoleOverride(organizationId),
  ]);

  return [
    ...ROLES.map((role) =>
      toBuiltInRoleSummary(role, counts.byRole.get(role) ?? 0, managerOverride),
    ),
    ...customRoles.map((role) =>
      toCustomRoleSummary(role, counts.byCustomRole.get(role.id) ?? 0),
    ),
  ];
}

export async function getRole(organizationId: string, roleId: string): Promise<RoleSummary> {
  if (roleId === 'MANAGER') {
    const [count, override] = await Promise.all([
      Membership.count({
        where: {
          organizationId,
          role: 'MANAGER',
          customRoleId: null,
          status: { [Op.in]: [...ASSIGNED_STATUSES] },
        },
      }),
      getManagerRoleOverride(organizationId),
    ]);
    return toManagerRoleSummary(count, override);
  }

  const role = await findCustomRole(organizationId, roleId);
  const count = await Membership.count({
    where: {
      organizationId,
      customRoleId: role.id,
      status: { [Op.in]: [...ASSIGNED_STATUSES] },
    },
  });
  return toCustomRoleSummary(role, count);
}

async function findCustomRole(
  organizationId: string,
  roleId: string,
  transaction?: Transaction,
): Promise<CustomRoleModel> {
  const role = await CustomRole.findOne({
    where: { id: roleId, organizationId },
    transaction,
  });
  if (!role) {
    throw AppError.notFound('Role not found', 'ROLE_NOT_FOUND');
  }
  return role;
}

async function assertUniqueName(
  organizationId: string,
  name: string,
  excludeRoleId?: string,
): Promise<void> {
  const existing = await CustomRole.findOne({
    where: {
      organizationId,
      nameNormalized: normalizeRoleName(name),
      ...(excludeRoleId ? { id: { [Op.ne]: excludeRoleId } } : {}),
    },
    attributes: ['id'],
  });
  if (existing) {
    throw AppError.conflict(
      'A role with this name already exists in the organization',
      'DUPLICATE_ROLE_NAME',
    );
  }
}

export async function createRole(options: {
  organizationId: string;
  actorUserId: string;
  input: CreateCustomRoleInput;
  context?: AuditContext;
}): Promise<RoleSummary> {
  const { organizationId, actorUserId, input, context } = options;
  const name = input.name.trim();
  await assertUniqueName(organizationId, name);

  try {
    const role = await sequelize.transaction(async (transaction) => {
      const created = await CustomRole.create(
        {
          organizationId,
          name,
          nameNormalized: normalizeRoleName(name),
          description: input.description?.trim() || null,
          permissions: input.permissions,
          dataScope: input.dataScope,
          onboardingEligible: input.onboardingEligible,
          createdByUserId: actorUserId,
        },
        { transaction },
      );

      await recordAuditEvent(
        {
          organizationId,
          actorUserId,
          action: 'CUSTOM_ROLE_CREATED',
          entityType: 'CUSTOM_ROLE',
          entityId: created.id,
          metadata: {
            name: created.name,
            permissions: created.permissions,
            dataScope: created.dataScope,
            onboardingEligible: created.onboardingEligible,
          },
        },
        { transaction, context },
      );

      return created;
    });

    return toCustomRoleSummary(role, 0);
  } catch (error) {
    if (error instanceof UniqueConstraintError) {
      throw AppError.conflict(
        'A role with this name already exists in the organization',
        'DUPLICATE_ROLE_NAME',
      );
    }
    throw error;
  }
}

export async function updateRole(options: {
  organizationId: string;
  actorUserId: string;
  roleId: string;
  input: UpdateCustomRoleInput;
  context?: AuditContext;
}): Promise<RoleSummary> {
  const { organizationId, actorUserId, roleId, input, context } = options;
  const name = input.name !== undefined ? input.name.trim() : undefined;

  if (name !== undefined) {
    await assertUniqueName(organizationId, name, roleId);
  }

  try {
    const role = await sequelize.transaction(async (transaction) => {
      const target = await findCustomRole(organizationId, roleId, transaction);
      const before = [...target.permissions];

      await target.update(
        {
          ...(name !== undefined ? { name, nameNormalized: normalizeRoleName(name) } : {}),
          ...(input.description !== undefined
            ? { description: input.description?.trim() || null }
            : {}),
          ...(input.permissions !== undefined ? { permissions: input.permissions } : {}),
          ...(input.dataScope !== undefined ? { dataScope: input.dataScope } : {}),
          ...(input.onboardingEligible !== undefined
            ? { onboardingEligible: input.onboardingEligible }
            : {}),
        },
        { transaction },
      );

      await recordAuditEvent(
        {
          organizationId,
          actorUserId,
          action: 'CUSTOM_ROLE_UPDATED',
          entityType: 'CUSTOM_ROLE',
          entityId: target.id,
          metadata: {
            name: target.name,
            previousPermissions: before,
            permissions: target.permissions,
            dataScope: target.dataScope,
            onboardingEligible: target.onboardingEligible,
          },
        },
        { transaction, context },
      );

      return target;
    });

    const count = await Membership.count({
      where: {
        organizationId,
        customRoleId: role.id,
        status: { [Op.in]: [...ASSIGNED_STATUSES] },
      },
    });

    return toCustomRoleSummary(role, count);
  } catch (error) {
    if (error instanceof UniqueConstraintError) {
      throw AppError.conflict(
        'A role with this name already exists in the organization',
        'DUPLICATE_ROLE_NAME',
      );
    }
    throw error;
  }
}

export async function deleteRole(options: {
  organizationId: string;
  actorUserId: string;
  roleId: string;
  context?: AuditContext;
}): Promise<void> {
  const { organizationId, actorUserId, roleId, context } = options;

  await sequelize.transaction(async (transaction) => {
    const role = await findCustomRole(organizationId, roleId, transaction);

    const assigned = await Membership.count({
      where: {
        organizationId,
        customRoleId: role.id,
        status: { [Op.in]: [...ASSIGNED_STATUSES] },
      },
      transaction,
    });

    if (assigned > 0) {
      throw AppError.conflict(
        `This role is assigned to ${assigned} user${assigned === 1 ? '' : 's'}. Reassign them before deleting it.`,
        'ROLE_IN_USE',
      );
    }

    await recordAuditEvent(
      {
        organizationId,
        actorUserId,
        action: 'CUSTOM_ROLE_DELETED',
        entityType: 'CUSTOM_ROLE',
        entityId: role.id,
        metadata: { name: role.name, permissions: role.permissions },
      },
      { transaction, context },
    );

    await role.destroy({ transaction });
  });
}

async function listRoleMembers(options: {
  organizationId: string;
  where: Record<string, unknown>;
  page: number;
  limit: number;
  managerOverride?: ManagerRoleOverrideModel | null;
}) {
  const { organizationId, where, page, limit, managerOverride } = options;

  const { rows, count } = await Membership.findAndCountAll({
    where: {
      organizationId,
      status: { [Op.in]: [...ASSIGNED_STATUSES] },
      ...where,
    },
    include: [
      {
        model: User,
        as: 'user',
        required: true,
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

  return paginate(
    rows.map((membership) =>
      toMembershipSummary(membership, toManagerRoleOverrideAccess(managerOverride)),
    ),
    count,
    page,
    limit,
  );
}

export async function listRoleUsers(options: {
  organizationId: string;
  roleId: string;
  page: number;
  limit: number;
}) {
  const { organizationId, roleId, page, limit } = options;

  if (roleId === 'MANAGER') {
    const override = await getManagerRoleOverride(organizationId);
    return listRoleMembers({
      organizationId,
      where: { role: 'MANAGER', customRoleId: null },
      page,
      limit,
      managerOverride: override,
    });
  }

  await findCustomRole(organizationId, roleId);
  return listRoleMembers({ organizationId, where: { customRoleId: roleId }, page, limit });
}

function assertOwner(actorRole: Role): void {
  if (actorRole !== 'OWNER') {
    throw AppError.forbidden(
      'Only the organization owner can customize the Manager role',
      'OWNER_REQUIRED',
    );
  }
}

function countManagerUsers(organizationId: string): Promise<number> {
  return Membership.count({
    where: {
      organizationId,
      role: 'MANAGER',
      customRoleId: null,
      status: { [Op.in]: [...ASSIGNED_STATUSES] },
    },
  });
}

/** Owner-defined customization of the built-in MANAGER role for one organization. */
export async function updateManagerRole(options: {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  input: UpdateManagerRoleInput;
  context?: AuditContext;
}): Promise<RoleSummary> {
  const { organizationId, actorUserId, actorRole, input, context } = options;
  assertOwner(actorRole);

  const updated = await sequelize.transaction(async (transaction) => {
    const existing = await ManagerRoleOverride.findOne({
      where: { organizationId },
      transaction,
    });

    const previousPermissions = managerOverridePermissions(existing);
    const previousDataScope = existing?.dataScope ?? MANAGER_DEFAULT_DATA_SCOPE;

    const values = {
      ...(input.description !== undefined
        ? { description: input.description?.trim() || null }
        : {}),
      ...(input.permissions !== undefined ? { permissions: input.permissions } : {}),
      ...(input.dataScope !== undefined ? { dataScope: input.dataScope } : {}),
    };

    let override: ManagerRoleOverrideModel;
    if (existing) {
      await existing.update({ ...values, updatedByUserId: actorUserId }, { transaction });
      override = existing;
    } else {
      override = await ManagerRoleOverride.create(
        {
          organizationId,
          permissions: input.permissions ?? [...ROLE_PERMISSIONS.MANAGER],
          dataScope: input.dataScope ?? MANAGER_DEFAULT_DATA_SCOPE,
          description: input.description?.trim() || null,
          updatedByUserId: actorUserId,
        },
        { transaction },
      );
    }

    await recordAuditEvent(
      {
        organizationId,
        actorUserId,
        action: 'MANAGER_ROLE_UPDATED',
        entityType: 'ROLE',
        // MANAGER is a built-in role key, not a UUID, so entity_id stays empty.
        entityId: null,
        metadata: {
          roleKey: 'MANAGER',
          previousPermissions,
          previousDataScope,
          permissions: override.permissions,
          dataScope: override.dataScope,
          description: override.description,
        },
      },
      { transaction, context },
    );

    return override;
  });

  const count = await countManagerUsers(organizationId);
  return toManagerRoleSummary(count, updated);
}

/** Removes the organization-specific override so MANAGER uses its defaults again. */
export async function resetManagerRole(options: {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  context?: AuditContext;
}): Promise<RoleSummary> {
  const { organizationId, actorUserId, actorRole, context } = options;
  assertOwner(actorRole);

  await sequelize.transaction(async (transaction) => {
    const existing = await ManagerRoleOverride.findOne({
      where: { organizationId },
      transaction,
    });
    if (!existing) return;

    await recordAuditEvent(
      {
        organizationId,
        actorUserId,
        action: 'MANAGER_ROLE_RESET',
        entityType: 'ROLE',
        entityId: null,
        metadata: {
          roleKey: 'MANAGER',
          previousPermissions: managerOverridePermissions(existing),
          previousDataScope: existing.dataScope,
        },
      },
      { transaction, context },
    );

    await existing.destroy({ transaction });
  });

  const count = await countManagerUsers(organizationId);
  return toManagerRoleSummary(count, null);
}

export function listPermissionCatalog() {
  const groups = (Object.keys(PERMISSION_GROUP_LABELS) as PermissionGroupKey[])
    .map((key) => ({
      key,
      label: PERMISSION_GROUP_LABELS[key],
      permissions: PERMISSION_CATALOG.filter(
        (entry) => entry.group === key && entry.grantableToCustomRole,
      ).map((entry) => entry.id),
    }))
    .filter((group) => group.permissions.length > 0);

  return {
    permissions: PERMISSION_CATALOG,
    groups,
    grantable: CUSTOM_ROLE_GRANTABLE_PERMISSIONS,
    grantableManager: MANAGER_OVERRIDE_GRANTABLE_PERMISSIONS,
    protected: PROTECTED_PERMISSIONS,
    dataScopes: [
      {
        value: 'SELF',
        label: 'Own records only',
        description:
          'Users can access their own attendance, time tracking, leave, and reports where supported.',
      },
      {
        value: 'ORGANIZATION',
        label: 'All organization records',
        description:
          'Users can access records belonging to other employees in this organization, but only for features they have permission to view.',
      },
    ],
    dataScopeNote:
      'This never grants access to another organization or automatically provides editing or administrative permissions.',
  };
}
