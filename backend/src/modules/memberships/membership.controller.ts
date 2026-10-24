import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { listMembers, changeMembershipRole, removeMembership, reactivateMembership, suspendMembership } from './membership.service';
import type { ChangeRoleInput, MembershipListQuery } from '../organizations/organization.schemas';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const context = req.organization!;
  const query = req.query as unknown as MembershipListQuery;
  const result = await listMembers(context.organization.id, query);
  res.status(200).json(result);
});

export const updateRole = asyncHandler(async (req: Request, res: Response) => {
  const context = req.organization!;
  const input = req.body as ChangeRoleInput;

  const membership = await changeMembershipRole(
    context.membership,
    context.organization.id,
    req.params.membershipId!,
    input.role,
  );

  res.status(200).json({ data: { membership } });
});

export const suspend = asyncHandler(async (req: Request, res: Response) => {
  const context = req.organization!;
  const membership = await suspendMembership(
    context.membership,
    context.organization.id,
    req.params.membershipId!,
  );
  res.status(200).json({ data: { membership } });
});

export const reactivate = asyncHandler(async (req: Request, res: Response) => {
  const context = req.organization!;
  const membership = await reactivateMembership(
    context.membership,
    context.organization.id,
    req.params.membershipId!,
  );
  res.status(200).json({ data: { membership } });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  const context = req.organization!;
  const membership = await removeMembership(
    context.membership,
    context.organization.id,
    req.params.membershipId!,
  );
  res.status(200).json({ data: { membership } });
});
