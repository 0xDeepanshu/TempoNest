import { apiRequest } from "./api-client";
import type { MemberListItem, Paginated } from "./types";

/** Finds one membership by user ID, paging the member directory when needed. */
export async function findMember(
  organizationId: string,
  userId: string,
  signal: AbortSignal,
  maxPages = 10,
): Promise<MemberListItem | null> {
  let page = 1;
  let totalPages = 1;
  do {
    const result = await apiRequest<Paginated<MemberListItem>>(
      `/organizations/${organizationId}/members`,
      { signal, query: { page, limit: 100 } },
    );
    const found = result.data.find((member) => member.userId === userId);
    if (found) return found;
    totalPages = result.meta.totalPages;
    page += 1;
  } while (page <= totalPages && page <= maxPages);
  return null;
}
