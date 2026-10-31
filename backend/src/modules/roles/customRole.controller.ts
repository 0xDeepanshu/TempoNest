import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { getClientIp, getUserAgent } from '../../utils/pagination';
import {
  createRole,
  deleteRole,
  getRole,
  listPermissionCatalog,
  listRoles,
  listRoleUsers,
  resetManagerRole,
  updateManagerRole,
  updateRole,
} from './customRole.service';
import type {
  CreateCustomRoleInput,
  RoleUsersQuery,
  UpdateCustomRoleInput,
  UpdateManagerRoleInput,
} from './customRole.schemas';

function auditContext(req: Request) {
  return { ipAddress: getClientIp(req), userAgent: getUserAgent(req) };
}

export const list = asyncHandler(async (req: Request, res: Response) => {
  const roles = await listRoles(req.organization!.organization.id);
  res.status(200).json({ data: roles });
});

export const permissions = asyncHandler(async (_req: Request, res: Response) => {
  res.status(200).json({ data: listPermissionCatalog() });
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  const role = await getRole(req.organization!.organization.id, req.params.roleId!);
  res.status(200).json({ data: { role } });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const role = await createRole({
    organizationId: req.organization!.organization.id,
    actorUserId: req.auth!.user.id,
    input: req.body as CreateCustomRoleInput,
    context: auditContext(req),
  });
  res.status(201).json({ data: { role } });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const role = await updateRole({
    organizationId: req.organization!.organization.id,
    actorUserId: req.auth!.user.id,
    roleId: req.params.roleId!,
    input: req.body as UpdateCustomRoleInput,
    context: auditContext(req),
  });
  res.status(200).json({ data: { role } });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await deleteRole({
    organizationId: req.organization!.organization.id,
    actorUserId: req.auth!.user.id,
    roleId: req.params.roleId!,
    context: auditContext(req),
  });
  res.status(204).send();
});

export const users = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as RoleUsersQuery;
  const result = await listRoleUsers({
    organizationId: req.organization!.organization.id,
    roleId: req.params.roleId!,
    page: query.page,
    limit: query.limit,
  });
  res.status(200).json(result);
});

export const getManager = asyncHandler(async (req: Request, res: Response) => {
  const role = await getRole(req.organization!.organization.id, 'MANAGER');
  res.status(200).json({ data: { role } });
});

export const updateManager = asyncHandler(async (req: Request, res: Response) => {
  const context = req.organization!;
  const role = await updateManagerRole({
    organizationId: context.organization.id,
    actorUserId: req.auth!.user.id,
    actorRole: context.membership.role,
    input: req.body as UpdateManagerRoleInput,
    context: auditContext(req),
  });
  res.status(200).json({ data: { role } });
});

export const resetManager = asyncHandler(async (req: Request, res: Response) => {
  const context = req.organization!;
  const role = await resetManagerRole({
    organizationId: context.organization.id,
    actorUserId: req.auth!.user.id,
    actorRole: context.membership.role,
    context: auditContext(req),
  });
  res.status(200).json({ data: { role } });
});

export const managerUsers = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as RoleUsersQuery;
  const result = await listRoleUsers({
    organizationId: req.organization!.organization.id,
    roleId: 'MANAGER',
    page: query.page,
    limit: query.limit,
  });
  res.status(200).json(result);
});
