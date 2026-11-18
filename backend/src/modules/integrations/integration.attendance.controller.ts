import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../utils/errors';
import {
  getAttendanceSummary,
  getEmployeeStatus,
  getIdleSummary,
  listSessionHistory,
} from './integration.attendance.service';
import { listMappedEmployees, matchEmployees } from './integration.employee.service';
import { integrationAuditContext } from './integration.http';
import type { IntegrationContext } from '../../types/express';
import type {
  IntegrationEmployeeListQuery,
  IntegrationEmployeeMatchBatchInput,
  IntegrationIdleQuery,
  IntegrationSessionHistoryQuery,
  IntegrationStatusQuery,
  IntegrationSummaryQuery,
} from './integration.schemas';

function integration(req: Request): IntegrationContext {
  const context = req.integration;
  if (!context) {
    throw AppError.unauthorized('Integration authentication is required', 'INTEGRATION_TOKEN_REQUIRED');
  }
  return context;
}

export const listEmployees = asyncHandler(async (req: Request, res: Response) => {
  const context = integration(req);
  const query = req.query as unknown as IntegrationEmployeeListQuery;
  const result = await listMappedEmployees({
    connection: context.connection,
    page: query.page,
    limit: query.limit,
    externalEmployeeId: query.externalEmployeeId,
  });
  res.status(200).json(result);
});

/**
 * Registers or refreshes employee identity for matching. This only creates
 * integration-owned mapping metadata; it never creates or updates WorkZen users.
 */
export const matchIntegrationEmployees = asyncHandler(async (req: Request, res: Response) => {
  const context = integration(req);
  const body = req.body as IntegrationEmployeeMatchBatchInput;
  const result = await matchEmployees({
    connection: context.connection,
    employees: body.employees,
  });
  res.status(200).json({ data: result.matches });
});

export const employeeStatus = asyncHandler(async (req: Request, res: Response) => {
  const context = integration(req);
  const result = await getEmployeeStatus({
    connection: context.connection,
    query: req.query as unknown as IntegrationStatusQuery,
  });
  res.status(200).json({ data: result });
});

export const sessionHistory = asyncHandler(async (req: Request, res: Response) => {
  const context = integration(req);
  const result = await listSessionHistory({
    connection: context.connection,
    query: req.query as unknown as IntegrationSessionHistoryQuery,
  });
  res.status(200).json(result);
});

export const attendanceSummary = asyncHandler(async (req: Request, res: Response) => {
  const context = integration(req);
  const result = await getAttendanceSummary({
    connection: context.connection,
    query: req.query as unknown as IntegrationSummaryQuery,
  });
  res.status(200).json({ data: result });
});

export const idleSummary = asyncHandler(async (req: Request, res: Response) => {
  const context = integration(req);
  const result = await getIdleSummary({
    connection: context.connection,
    query: req.query as unknown as IntegrationIdleQuery,
  });
  res.status(200).json({ data: result });
});
