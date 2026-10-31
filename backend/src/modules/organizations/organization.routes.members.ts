import { Router } from 'express';
import { requireAuth } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { requireAnyPermission, requirePermission } from '../memberships/permissions';
import { loadOrganizationContext } from '../memberships/organizationContext';
import {
  changeRoleSchema,
  membershipIdParamsSchema,
  membershipListQuerySchema,
  organizationIdParamsSchema,
} from './organization.schemas';
import { list, reactivate, remove, suspend, updateRole } from '../memberships/membership.controller';
import {
  createInvitationSchema,
  invitationIdParamsSchema,
  invitationListQuerySchema,
} from '../invitations/invitation.schemas';
import {
  create as createInvitation,
  list as listInvitations,
  resend as resendInvitation,
  revoke as revokeInvitation,
} from '../invitations/invitation.controller';

/**
 * Nested routes mounted under /organizations/:organizationId. Params are
 * validated before the membership lookup so malformed IDs never hit the DB.
 */
export function createOrganizationMembersRouter(): Router {
  const router = Router({ mergeParams: true });

  router.get(
    '/:organizationId/members',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('member:read'),
    validate({ query: membershipListQuerySchema }),
    list,
  );

  router.patch(
    '/:organizationId/members/:membershipId',
    requireAuth,
    validate({ params: membershipIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('member:update'),
    validate({ body: changeRoleSchema }),
    updateRole,
  );

  router.post(
    '/:organizationId/members/:membershipId/suspend',
    requireAuth,
    validate({ params: membershipIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('member:update'),
    suspend,
  );

  router.post(
    '/:organizationId/members/:membershipId/reactivate',
    requireAuth,
    validate({ params: membershipIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('member:update'),
    reactivate,
  );

  router.delete(
    '/:organizationId/members/:membershipId',
    requireAuth,
    validate({ params: membershipIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('member:remove'),
    remove,
  );

  router.post(
    '/:organizationId/invitations',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requireAnyPermission(['member:invite', 'member:onboard']),
    validate({ body: createInvitationSchema }),
    createInvitation,
  );

  router.get(
    '/:organizationId/invitations',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requireAnyPermission(['invitation:read', 'member:onboard']),
    validate({ query: invitationListQuerySchema }),
    listInvitations,
  );

  router.post(
    '/:organizationId/invitations/:invitationId/resend',
    requireAuth,
    validate({ params: invitationIdParamsSchema }),
    loadOrganizationContext,
    requireAnyPermission(['member:invite', 'member:onboard']),
    resendInvitation,
  );

  router.delete(
    '/:organizationId/invitations/:invitationId',
    requireAuth,
    validate({ params: invitationIdParamsSchema }),
    loadOrganizationContext,
    requireAnyPermission(['invitation:revoke', 'member:onboard']),
    revokeInvitation,
  );

  return router;
}
