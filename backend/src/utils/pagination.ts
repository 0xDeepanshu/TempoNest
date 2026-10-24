import type { Request } from 'express';
import { z } from 'zod';

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type Pagination = z.infer<typeof paginationSchema>;

export type PaginatedResponse<T> = {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export function paginate<T>(items: T[], total: number, page: number, limit: number): PaginatedResponse<T> {
  return {
    data: items,
    meta: {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    },
  };
}

export function getClientIp(req: Request): string | undefined {
  return req.ip || req.socket.remoteAddress || undefined;
}

export function getUserAgent(req: Request): string | null {
  const value = req.get('user-agent');
  return value ? value.slice(0, 512) : null;
}
