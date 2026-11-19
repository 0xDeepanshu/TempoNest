import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../utils/errors';
import { getIntegrationHolidays } from './integration.holiday.service';
import type { IntegrationContext } from '../../types/express';
import type { IntegrationHolidayListQuery } from './integration.schemas';

function integration(req: Request): IntegrationContext {
  const context = req.integration;
  if (!context) {
    throw AppError.unauthorized('Integration authentication is required', 'INTEGRATION_TOKEN_REQUIRED');
  }
  return context;
}

export const holidays = asyncHandler(async (req: Request, res: Response) => {
  const context = integration(req);
  const result = await getIntegrationHolidays({
    connection: context.connection,
    organization: context.organization,
    query: req.query as unknown as IntegrationHolidayListQuery,
  });
  res.status(200).json({ data: result });
});
