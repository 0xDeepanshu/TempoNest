import { Router } from 'express';
import { requireAuth } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { requirePermission } from '../memberships/permissions';
import { loadOrganizationContext } from '../memberships/organizationContext';
import { organizationIdParamsSchema } from '../organizations/organization.schemas';
import {
  createCustomRoleSchema,
  roleIdParamsSchema,
  roleUsersQuerySchema,
  updateCustomRoleSchema,
  updateManagerRoleSchema,
} from './customRole.schemas';
import {
  create,
  get,
  getManager,
  list,
  managerUsers,
  permissions,
  remove,
  resetManager,
  update,
  updateManager,
  users,
} from './customRole.controller';

export function createOrganizationRolesRouter(): Router {
  const router = Router({ mergeParams: true });

  router.get(
    '/:organizationId/roles',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('role:read'),
    list,
  );

  // Registered before `/:roleId` so the literal path is never parsed as a UUID.
  router.get(
    '/:organizationId/roles/permissions',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('role:read'),
    permissions,
  );

  // MANAGER is a built-in role that each organization may customize. These
  // literal routes are registered before `/:roleId` so the segment is never
  // parsed as a UUID. OWNER-only enforcement lives in the service.
  router.get(
    '/:organizationId/roles/MANAGER',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('role:read'),
    getManager,
  );

  router.patch(
    '/:organizationId/roles/MANAGER',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('role:manage'),
    validate({ body: updateManagerRoleSchema }),
    updateManager,
  );

  router.delete(
    '/:organizationId/roles/MANAGER',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('role:manage'),
    resetManager,
  );

  router.get(
    '/:organizationId/roles/MANAGER/users',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('role:read'),
    validate({ query: roleUsersQuerySchema }),
    managerUsers,
  );

  router.post(
    '/:organizationId/roles',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('role:manage'),
    validate({ body: createCustomRoleSchema }),
    create,
  );

  router.get(
    '/:organizationId/roles/:roleId/users',
    requireAuth,
    validate({ params: roleIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('role:read'),
    validate({ query: roleUsersQuerySchema }),
    users,
  );

  router.get(
    '/:organizationId/roles/:roleId',
    requireAuth,
    validate({ params: roleIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('role:read'),
    get,
  );

  router.patch(
    '/:organizationId/roles/:roleId',
    requireAuth,
    validate({ params: roleIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('role:manage'),
    validate({ body: updateCustomRoleSchema }),
    update,
  );

  router.delete(
    '/:organizationId/roles/:roleId',
    requireAuth,
    validate({ params: roleIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('role:manage'),
    remove,
  );

  return router;
}
