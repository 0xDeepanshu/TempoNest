import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { getClientIp, getUserAgent } from '../../utils/pagination';
import { isSelfScoped } from '../memberships/permissions';
import {
  createHoliday,
  deleteHoliday,
  duplicateHoliday,
  getHoliday,
  getHolidaySettings,
  importGovernmentHolidays,
  listGovernmentJurisdictions,
  listHolidayEmployees,
  listHolidays,
  previewGovernmentHolidays,
  updateHoliday,
  updateHolidayPublication,
  updateHolidaySettings,
} from './holiday.service';
import type {
  CreateHolidayInput,
  DeleteHolidayQuery,
  DuplicateHolidayInput,
  GovernmentHolidayImportInput,
  GovernmentHolidayPreviewQuery,
  HolidayListQuery,
  HolidayPublicationInput,
  HolidaySettingsInput,
  UpdateHolidayInput,
} from './holiday.schemas';

function now(): string {
  return new Date().toISOString();
}

function auditContext(req: Request) {
  return { ipAddress: getClientIp(req), userAgent: getUserAgent(req) };
}

function audience(req: Request) {
  return {
    restrictToEmployee: isSelfScoped(req.organization!.effective),
    employeeId: req.auth!.user.id,
  };
}

export const list = asyncHandler(async (req: Request, res: Response) => {
  const result = await listHolidays({
    organization: req.organization!.organization,
    query: req.query as unknown as HolidayListQuery,
    audience: audience(req),
  });
  res.status(200).json({ data: result, serverTime: now() });
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
  const holiday = await getHoliday({
    organization: req.organization!.organization,
    holidayId: req.params.holidayId!,
    audience: audience(req),
  });
  res.status(200).json({ data: { holiday, serverTime: now() } });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const holiday = await createHoliday({
    organization: req.organization!.organization,
    actorUserId: req.auth!.user.id,
    input: req.body as CreateHolidayInput,
    context: auditContext(req),
  });
  res.status(201).json({ data: { holiday, serverTime: now() } });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const holiday = await updateHoliday({
    organization: req.organization!.organization,
    actorUserId: req.auth!.user.id,
    holidayId: req.params.holidayId!,
    input: req.body as UpdateHolidayInput,
    context: auditContext(req),
  });
  res.status(200).json({ data: { holiday, serverTime: now() } });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await deleteHoliday({
    organization: req.organization!.organization,
    actorUserId: req.auth!.user.id,
    holidayId: req.params.holidayId!,
    query: req.query as unknown as DeleteHolidayQuery,
    context: auditContext(req),
  });
  res.status(204).send();
});

export const duplicate = asyncHandler(async (req: Request, res: Response) => {
  const holiday = await duplicateHoliday({
    organization: req.organization!.organization,
    actorUserId: req.auth!.user.id,
    holidayId: req.params.holidayId!,
    input: req.body as DuplicateHolidayInput,
    context: auditContext(req),
  });
  res.status(201).json({ data: { holiday, serverTime: now() } });
});

export const readSettings = asyncHandler(async (req: Request, res: Response) => {
  const settings = await getHolidaySettings(req.organization!.organization);
  res.status(200).json({ data: { settings, serverTime: now() } });
});

export const listEmployees = asyncHandler(async (req: Request, res: Response) => {
  const employees = await listHolidayEmployees(req.organization!.organization);
  res.status(200).json({ data: employees, serverTime: now() });
});

export const writeSettings = asyncHandler(async (req: Request, res: Response) => {
  const settings = await updateHolidaySettings({
    organization: req.organization!.organization,
    actorUserId: req.auth!.user.id,
    input: req.body as HolidaySettingsInput,
    context: auditContext(req),
  });
  res.status(200).json({ data: { settings, serverTime: now() } });
});

export const readGovernmentJurisdictions = asyncHandler(
  async (_req: Request, res: Response) => {
    res.status(200).json({ data: listGovernmentJurisdictions(), serverTime: now() });
  },
);

export const previewGovernment = asyncHandler(async (req: Request, res: Response) => {
  const preview = await previewGovernmentHolidays({
    organization: req.organization!.organization,
    query: req.query as unknown as GovernmentHolidayPreviewQuery,
  });
  res.status(200).json({ data: preview, serverTime: now() });
});

export const importGovernment = asyncHandler(async (req: Request, res: Response) => {
  const result = await importGovernmentHolidays({
    organization: req.organization!.organization,
    actorUserId: req.auth!.user.id,
    input: req.body as GovernmentHolidayImportInput,
    context: auditContext(req),
  });
  res.status(201).json({ data: result, serverTime: now() });
});

export const updatePublication = asyncHandler(async (req: Request, res: Response) => {
  const result = await updateHolidayPublication({
    organization: req.organization!.organization,
    actorUserId: req.auth!.user.id,
    input: req.body as HolidayPublicationInput,
    context: auditContext(req),
  });
  res.status(200).json({ data: result, serverTime: now() });
});
