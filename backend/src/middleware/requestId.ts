import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Every request gets a stable correlation ID. Incoming IDs are accepted only
 * if they are short and URL-safe, otherwise a new UUID is generated.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const header = req.get('x-request-id');
  const id = header && SAFE_REQUEST_ID.test(header) ? header : randomUUID();

  req.requestId = id;
  res.setHeader('x-request-id', id);
  next();
}
