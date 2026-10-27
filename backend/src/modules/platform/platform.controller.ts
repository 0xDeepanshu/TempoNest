import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { getClientIp, getUserAgent } from '../../utils/pagination';
import { listPlatformAuditEvents } from './platformAudit.service';
import {
  getPlatformOrganization,
  getPlatformOverview,
  listPlatformOrganizations,
  reactivatePlatformOrganization,
  renamePlatformOrganization,
  softDeletePlatformOrganization,
  suspendPlatformOrganization,
} from './platform.service';
import type {
  PlatformAuditListQuery,
  PlatformDeleteOrganizationInput,
  PlatformOrganizationListQuery,
  PlatformRenameOrganizationInput,
} from './platform.schemas';

function auditContext(req: Request) {
  return {
    ipAddress: getClientIp(req),
    userAgent: getUserAgent(req),
  };
}

export const overview = asyncHandler(async (_req: Request, res: Response) => {
  res.status(200).json({ data: await getPlatformOverview() });
});

export const listOrganizations = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as PlatformOrganizationListQuery;
  res.status(200).json(await listPlatformOrganizations(query));
});

export const getOrganization = asyncHandler(async (req: Request, res: Response) => {
  res.status(200).json({ data: await getPlatformOrganization(req.params.organizationId!) });
});

export const renameOrganization = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as PlatformRenameOrganizationInput;
  await renamePlatformOrganization(
    req.auth!.user.id,
    req.params.organizationId!,
    input.name,
    auditContext(req),
  );
  res.status(200).json({ data: await getPlatformOrganization(req.params.organizationId!) });
});

export const suspendOrganization = asyncHandler(async (req: Request, res: Response) => {
  await suspendPlatformOrganization(
    req.auth!.user.id,
    req.params.organizationId!,
    auditContext(req),
  );
  res.status(200).json({ data: await getPlatformOrganization(req.params.organizationId!) });
});

export const reactivateOrganization = asyncHandler(async (req: Request, res: Response) => {
  await reactivatePlatformOrganization(
    req.auth!.user.id,
    req.params.organizationId!,
    auditContext(req),
  );
  res.status(200).json({ data: await getPlatformOrganization(req.params.organizationId!) });
});

export const deleteOrganization = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as PlatformDeleteOrganizationInput;
  await softDeletePlatformOrganization(
    req.auth!.user,
    req.params.organizationId!,
    input,
    auditContext(req),
  );
  res.status(200).json({ data: await getPlatformOrganization(req.params.organizationId!) });
});

export const listAuditEvents = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as PlatformAuditListQuery;
  res.status(200).json(await listPlatformAuditEvents(query));
});
