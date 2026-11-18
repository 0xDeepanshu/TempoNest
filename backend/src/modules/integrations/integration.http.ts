import type { Request } from 'express';
import { getClientIp, getUserAgent } from '../../utils/pagination';
import type { AuditContext } from '../screenshots/audit.service';

/** Audit metadata shared by integration endpoints. */
export function integrationAuditContext(req: Request): AuditContext {
  return { ipAddress: getClientIp(req), userAgent: getUserAgent(req) };
}
