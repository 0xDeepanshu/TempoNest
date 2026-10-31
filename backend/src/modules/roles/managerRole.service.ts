import { Op } from 'sequelize';
import { ManagerRoleOverride } from '../../database';
import {
  isManagerOverridePermission,
  type ManagerRoleOverrideAccess,
} from '../memberships/permissions';
import type { ManagerRoleOverride as ManagerRoleOverrideModel } from './managerRoleOverride.model';

/** The override is optional: no row means the built-in MANAGER matrix applies. */
export async function getManagerRoleOverride(
  organizationId: string,
): Promise<ManagerRoleOverrideModel | null> {
  return ManagerRoleOverride.findOne({ where: { organizationId } });
}

export async function getManagerRoleOverrides(
  organizationIds: string[],
): Promise<Map<string, ManagerRoleOverrideModel>> {
  if (organizationIds.length === 0) return new Map();

  const rows = await ManagerRoleOverride.findAll({
    where: { organizationId: { [Op.in]: organizationIds } },
  });
  return new Map(rows.map((row) => [row.organizationId, row]));
}

/**
 * Defense in depth: a stored override can only ever carry permissions the API
 * allows, even if the row were tampered with directly.
 */
export function toManagerRoleOverrideAccess(
  override: ManagerRoleOverrideModel | null | undefined,
): ManagerRoleOverrideAccess | null {
  if (!override) return null;
  return {
    permissions: override.permissions.filter((permission) =>
      isManagerOverridePermission(permission),
    ),
    dataScope: override.dataScope,
  };
}
