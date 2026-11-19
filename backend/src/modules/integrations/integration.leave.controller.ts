import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../utils/errors';
import { getIntegrationLeaveBalances, getIntegrationLeaveRequests } from './integration.leave.service';
import type { IntegrationContext } from '../../types/express';
import type {
  IntegrationLeaveBalanceQuery,
  IntegrationLeaveRequestListQuery,
} from './integration.schemas';

function integration(req: Request): IntegrationContext {
  const context = req.integration;
  if (!context) {
    throw AppError.unauthorized('Integration authentication is required', 'INTEGRATION_TOKEN_REQUIRED');
  }
  return context;
}

export const leaveBalances = asyncHandler(async (req: Request, res: Response) => {
  const context = integration(req);
  const result = await getIntegrationLeaveBalances({
    connection: context.connection,
    organization: context.organization,
    query: req.query as unknown as IntegrationLeaveBalanceQuery,
  });
  res.status(200).json({ data: result });
});

export const leaveRequests = asyncHandler(async (req: Request, res: Response) => {
  const context = integration(req);
  const result = await getIntegrationLeaveRequests({
    connection: context.connection,
    organization: context.organization,
    query: req.query as unknown as IntegrationLeaveRequestListQuery,
  });
  res.status(200).json(result);
});
