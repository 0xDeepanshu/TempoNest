import { apiRequest, type QueryValue } from "./api-client";
import type {
  LeaveAccrualFrequency,
  LeaveAccrualPreviewResponse,
  LeaveAdjustmentPreviewResponse,
  LeaveBackfillPreviewResponse,
  LeaveBackfillResultResponse,
  LeaveBalance,
  LeaveBalanceResponse,
  LeaveBalancesResponse,
  LeaveBulkAdjustmentPreviewResponse,
  LeaveBulkAdjustmentResultResponse,
  LeaveEmployeeBalancesResponse,
  LeaveHolidayResponse,
  LeaveHolidaysResponse,
  LeaveLedgerResponse,
  LeavePolicyResponse,
  LeavePoliciesResponse,
  LeaveReconciliationRepairResponse,
  LeaveReconciliationResponse,
  LeaveRequestResponse,
  LeaveRequestsResponse,
  LeaveRequestStatus,
  LeaveTypeResponse,
  LeaveTypesResponse,
} from "./types";

export type CreateLeaveTypeInput = {
  name: string;
  description?: string | null;
  isActive?: boolean;
  isPaid?: boolean;
  requiresBalance?: boolean;
  allowNegativeBalance?: boolean;
  maxConsecutiveDays?: number | null;
  minNoticeDays?: number;
  requiresDocumentation?: boolean;
  allowApprovedCancellation?: boolean;
  cancellationRequiresApproval?: boolean;
};

export type UpdateLeaveTypeInput = Partial<CreateLeaveTypeInput>;

export type UpdateLeavePolicyInput = {
  initialEntitlement?: number;
  accrualFrequency?: LeaveAccrualFrequency;
  accrualAmount?: number;
  accrualDayOfMonth?: number;
  accrualEffectiveFrom?: string | null;
  prorateAccrual?: boolean;
  balancePeriodStartMonth?: number;
  balancePeriodStartDay?: number;
  carryForwardAllowance?: number;
  maxBalance?: number | null;
  prorateInitialEntitlement?: boolean;
  workingDays?: number[];
  isActive?: boolean;
};

export type LeaveRequestListQuery = {
  page?: number;
  limit?: number;
  employeeId?: string;
  leaveTypeId?: string;
  status?: LeaveRequestStatus;
  from?: string;
  to?: string;
};

export type LeaveBalanceListQuery = {
  page?: number;
  limit?: number;
  employeeId?: string;
  leaveTypeId?: string;
  periodStart?: string;
};

export type LeaveAdjustmentInput = {
  leaveTypeId: string;
  amount: number;
  reason: string;
  periodStart?: string;
};

export type BulkLeaveAdjustmentInput = LeaveAdjustmentInput & {
  employeeIds: string[];
};

export type LeaveBackfillQuery = {
  periodStart?: string;
  employeeId?: string;
  leaveTypeId?: string;
};

export type LeaveBackfillInput = {
  periodStart?: string;
  employeeIds?: string[];
  leaveTypeIds?: string[];
};

export type LeaveReconciliationQuery = {
  periodStart?: string;
};

export type LeaveLedgerQuery = {
  page?: number;
  limit?: number;
  employeeId?: string;
  leaveTypeId?: string;
  periodStart?: string;
};

export type ApplyLeaveInput = {
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  startHalfDay?: boolean;
  endHalfDay?: boolean;
  reason: string;
  documentationReference?: string;
};

type RequestOptions = { signal?: AbortSignal };

function leavePath(organizationId: string, suffix: string): string {
  return `/organizations/${organizationId}/leave${suffix}`;
}

function asQuery(query: object): Record<string, QueryValue> {
  return query as Record<string, QueryValue>;
}

export function listLeaveTypes(
  organizationId: string,
  options: RequestOptions & { includeInactive?: boolean } = {},
) {
  return apiRequest<LeaveTypesResponse>(leavePath(organizationId, "/types"), {
    signal: options.signal,
    query: { includeInactive: options.includeInactive },
  });
}

export function createLeaveType(organizationId: string, input: CreateLeaveTypeInput) {
  return apiRequest<LeaveTypeResponse>(leavePath(organizationId, "/types"), {
    method: "POST",
    body: input,
  });
}

export function updateLeaveType(
  organizationId: string,
  leaveTypeId: string,
  input: UpdateLeaveTypeInput,
) {
  return apiRequest<LeaveTypeResponse>(leavePath(organizationId, `/types/${leaveTypeId}`), {
    method: "PATCH",
    body: input,
  });
}

export function listLeavePolicies(
  organizationId: string,
  options: RequestOptions = {},
) {
  return apiRequest<LeavePoliciesResponse>(leavePath(organizationId, "/policies"), {
    signal: options.signal,
  });
}

export function updateLeavePolicy(
  organizationId: string,
  policyId: string,
  input: UpdateLeavePolicyInput,
) {
  return apiRequest<LeavePolicyResponse>(leavePath(organizationId, `/policies/${policyId}`), {
    method: "PUT",
    body: input,
  });
}

export function listLeaveHolidays(
  organizationId: string,
  options: RequestOptions & { from?: string; to?: string } = {},
) {
  return apiRequest<LeaveHolidaysResponse>(leavePath(organizationId, "/holidays"), {
    signal: options.signal,
    query: { from: options.from, to: options.to },
  });
}

export function createLeaveHoliday(
  organizationId: string,
  input: { holidayDate: string; name: string },
) {
  return apiRequest<LeaveHolidayResponse>(leavePath(organizationId, "/holidays"), {
    method: "POST",
    body: input,
  });
}

export function deleteLeaveHoliday(organizationId: string, holidayId: string) {
  return apiRequest<void>(leavePath(organizationId, `/holidays/${holidayId}`), {
    method: "DELETE",
  });
}

export function listLeaveRequests(
  organizationId: string,
  query: LeaveRequestListQuery,
  options: RequestOptions = {},
) {
  return apiRequest<LeaveRequestsResponse>(leavePath(organizationId, "/requests"), {
    signal: options.signal,
    query: asQuery(query),
  });
}

export function getLeaveRequest(
  organizationId: string,
  requestId: string,
  options: RequestOptions = {},
) {
  return apiRequest<LeaveRequestResponse>(
    leavePath(organizationId, `/requests/${requestId}`),
    { signal: options.signal },
  );
}

export function createLeaveRequest(
  organizationId: string,
  input: ApplyLeaveInput,
  options: { idempotencyKey?: string } = {},
) {
  return apiRequest<LeaveRequestResponse>(leavePath(organizationId, "/requests"), {
    method: "POST",
    body: input,
    headers: options.idempotencyKey
      ? { "Idempotency-Key": options.idempotencyKey }
      : undefined,
  });
}

export function approveLeaveRequest(
  organizationId: string,
  requestId: string,
  input: { note?: string } = {},
) {
  return apiRequest<LeaveRequestResponse>(
    leavePath(organizationId, `/requests/${requestId}/approve`),
    { method: "POST", body: input },
  );
}

export function rejectLeaveRequest(
  organizationId: string,
  requestId: string,
  input: { reason: string; note?: string },
) {
  return apiRequest<LeaveRequestResponse>(
    leavePath(organizationId, `/requests/${requestId}/reject`),
    { method: "POST", body: input },
  );
}

export function cancelLeaveRequest(
  organizationId: string,
  requestId: string,
  input: { reason?: string } = {},
) {
  return apiRequest<LeaveRequestResponse>(
    leavePath(organizationId, `/requests/${requestId}/cancel`),
    { method: "POST", body: input },
  );
}

export function listLeaveBalances(
  organizationId: string,
  query: LeaveBalanceListQuery,
  options: RequestOptions = {},
) {
  return apiRequest<LeaveBalancesResponse>(leavePath(organizationId, "/balances"), {
    signal: options.signal,
    query: asQuery(query),
  });
}

export function getEmployeeLeaveBalances(
  organizationId: string,
  employeeId: string,
  query: { leaveTypeId?: string; periodStart?: string } = {},
  options: RequestOptions = {},
) {
  return apiRequest<LeaveEmployeeBalancesResponse>(
    leavePath(organizationId, `/balances/${employeeId}`),
    { signal: options.signal, query },
  );
}

export function getMyLeaveBalances(
  organizationId: string,
  query: { leaveTypeId?: string; periodStart?: string } = {},
  options: RequestOptions = {},
) {
  return apiRequest<LeaveEmployeeBalancesResponse>(
    leavePath(organizationId, "/balances/me"),
    { signal: options.signal, query },
  );
}

export function adjustLeaveBalance(
  organizationId: string,
  employeeId: string,
  input: LeaveAdjustmentInput,
) {
  return apiRequest<LeaveBalanceResponse>(
    leavePath(organizationId, `/balances/${employeeId}/adjustments`),
    { method: "POST", body: input },
  );
}

export function previewLeaveBalanceAdjustment(
  organizationId: string,
  employeeId: string,
  input: LeaveAdjustmentInput,
) {
  return apiRequest<LeaveAdjustmentPreviewResponse>(
    leavePath(organizationId, `/balances/${employeeId}/adjustments/preview`),
    { method: "POST", body: input },
  );
}

export function previewBulkLeaveAdjustments(
  organizationId: string,
  input: BulkLeaveAdjustmentInput,
) {
  return apiRequest<LeaveBulkAdjustmentPreviewResponse>(
    leavePath(organizationId, "/balances/bulk-adjustments/preview"),
    { method: "POST", body: input },
  );
}

export function bulkAdjustLeaveBalances(
  organizationId: string,
  input: BulkLeaveAdjustmentInput,
) {
  return apiRequest<LeaveBulkAdjustmentResultResponse>(
    leavePath(organizationId, "/balances/bulk-adjustments"),
    { method: "POST", body: { ...input, confirm: true } },
  );
}

export function previewLeaveBalanceBackfill(
  organizationId: string,
  query: LeaveBackfillQuery = {},
  options: RequestOptions = {},
) {
  return apiRequest<LeaveBackfillPreviewResponse>(
    leavePath(organizationId, "/balances/backfill/preview"),
    { signal: options.signal, query: asQuery(query) },
  );
}

export function applyLeaveBalanceBackfill(
  organizationId: string,
  input: LeaveBackfillInput,
) {
  return apiRequest<LeaveBackfillResultResponse>(
    leavePath(organizationId, "/balances/backfill"),
    { method: "POST", body: { ...input, confirm: true } },
  );
}

export function getLeaveBalanceReconciliation(
  organizationId: string,
  query: LeaveReconciliationQuery = {},
  options: RequestOptions = {},
) {
  return apiRequest<LeaveReconciliationResponse>(
    leavePath(organizationId, "/balances/reconciliation"),
    { signal: options.signal, query: asQuery(query) },
  );
}

export function repairLeaveBalanceReconciliation(
  organizationId: string,
  balanceIds: string[],
) {
  return apiRequest<LeaveReconciliationRepairResponse>(
    leavePath(organizationId, "/balances/reconciliation/repair"),
    { method: "POST", body: { balanceIds, confirm: true } },
  );
}

export function getLeaveAccrualPreview(
  organizationId: string,
  query: { employeeId?: string; leaveTypeId?: string } = {},
  options: RequestOptions = {},
) {
  return apiRequest<LeaveAccrualPreviewResponse>(
    leavePath(organizationId, "/balances/accrual-preview"),
    { signal: options.signal, query },
  );
}

export function listLeaveLedger(
  organizationId: string,
  query: LeaveLedgerQuery,
  options: RequestOptions = {},
) {
  return apiRequest<LeaveLedgerResponse>(leavePath(organizationId, "/balances/ledger"), {
    signal: options.signal,
    query: asQuery(query),
  });
}

/**
 * Scans balance pages for the overview. The API has no aggregate endpoint, so
 * the caller must surface when the scan was capped instead of presenting a
 * partial count as complete.
 */
export async function listAllLeaveBalances(
  organizationId: string,
  query: LeaveBalanceListQuery,
  options: RequestOptions & { maxPages?: number } = {},
): Promise<{ rows: LeaveBalance[]; total: number; truncated: boolean }> {
  const maxPages = options.maxPages ?? 10;
  const rows: LeaveBalance[] = [];
  let page = 1;
  let total = 0;
  let totalPages = 1;

  do {
    const result = await listLeaveBalances(
      organizationId,
      { ...query, page, limit: 100 },
      options,
    );
    rows.push(...result.data);
    total = result.meta.total;
    totalPages = result.meta.totalPages;
    if (page >= maxPages) break;
    page += 1;
  } while (page <= totalPages);

  return { rows, total, truncated: totalPages > maxPages };
}
