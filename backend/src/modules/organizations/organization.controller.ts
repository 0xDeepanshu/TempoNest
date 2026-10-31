import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { createOrganization, getOrganizationDetails, listOrganizationsForUser, updateOrganization } from './organization.service';
import { toOrganizationSummary } from '../memberships/membership.mapper';
import { ROLE_PERMISSIONS } from '../memberships/permissions';
import type { CreateOrganizationInput, UpdateOrganizationInput } from './organization.schemas';

export const create = asyncHandler(async (req: Request, res: Response) => {
  const user = req.auth!.user;
  const input = req.body as CreateOrganizationInput;

  const { organization, membership } = await createOrganization(user.id, input);

  res.status(201).json({
    data: {
      organization: toOrganizationSummary(organization),
      membership: {
        id: membership.id,
        role: membership.role,
        status: membership.status,
        customRoleId: null,
        permissions: ROLE_PERMISSIONS.OWNER,
        dataScope: 'ORGANIZATION' as const,
      },
    },
  });
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const user = req.auth!.user;
  const organizations = await listOrganizationsForUser(user.id);
  res.status(200).json({ data: organizations });
});

export const getCurrent = asyncHandler(async (req: Request, res: Response) => {
  const context = req.organization!;
  const details = await getOrganizationDetails(context.organization, context.membership);
  res.status(200).json({ data: details });
});

export const updateCurrent = asyncHandler(async (req: Request, res: Response) => {
  const context = req.organization!;
  const input = req.body as UpdateOrganizationInput;

  await updateOrganization(context.organization, input);
  const details = await getOrganizationDetails(context.organization, context.membership);
  res.status(200).json({ data: details });
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const context = req.organization!;
  const details = await getOrganizationDetails(context.organization, context.membership);
  res.status(200).json({ data: details });
});

export const updateById = asyncHandler(async (req: Request, res: Response) => {
  const context = req.organization!;
  const input = req.body as UpdateOrganizationInput;

  await updateOrganization(context.organization, input);
  const details = await getOrganizationDetails(context.organization, context.membership);
  res.status(200).json({ data: details });
});
