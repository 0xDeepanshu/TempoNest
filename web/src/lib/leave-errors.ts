import { errorMessage, isApiError } from "./api-error";

const LEAVE_ERROR_MESSAGES: Record<string, string> = {
  SELF_APPROVAL_FORBIDDEN: "You cannot approve or reject your own leave request.",
  LEAVE_REQUEST_NOT_PENDING:
    "This request is no longer pending. Refresh it to see its current state.",
  LEAVE_REQUEST_NOT_CANCELLABLE:
    "This leave request cannot be cancelled in its current state or for this leave type.",
  LEAVE_REQUEST_OVERLAP:
    "Another pending or approved request overlaps these dates for this employee.",
  INSUFFICIENT_LEAVE_BALANCE:
    "There is not enough available leave balance for this request.",
  LEAVE_DATE_IN_PAST: "Leave cannot start in the past. Choose today or a future date.",
  LEAVE_REQUEST_INVALID_DATES:
    "The leave dates are invalid. Check the start and end dates.",
  LEAVE_REQUEST_INVALID_HALF_DAY:
    "The half-day selection must fall on a chargeable working day.",
  LEAVE_NO_WORKING_DAYS: "The selected range has no chargeable working days.",
  LEAVE_REQUEST_NOT_FOUND: "This leave request is not available.",
  LEAVE_TYPE_INACTIVE:
    "This leave type is no longer available. Refresh and choose another type.",
  LEAVE_BALANCE_NEGATIVE_NOT_ALLOWED:
    "This adjustment would make the available balance negative, and this leave type does not allow that.",
  LEAVE_BALANCE_CAP_EXCEEDED:
    "This adjustment would exceed the maximum balance configured for this leave type.",
  LEAVE_BALANCE_NOT_APPLICABLE:
    "This leave type does not use balances, so it cannot be adjusted.",
  LEAVE_POLICY_INACTIVE:
    "The leave policy is inactive. Reactivate the policy before changing balances.",
  LEAVE_TYPE_IN_USE:
    "This leave type has pending or approved requests, so its balance requirement cannot be changed.",
  LEAVE_TYPE_NAME_CONFLICT: "A leave type with this name already exists.",
  LEAVE_HOLIDAY_CONFLICT: "A holiday already exists on this date.",
  LEAVE_MIN_NOTICE_NOT_MET:
    "The request does not meet the minimum notice configured for this leave type.",
  LEAVE_MAX_CONSECUTIVE_DAYS_EXCEEDED:
    "The request exceeds the maximum consecutive days configured for this leave type.",
  LEAVE_DOCUMENTATION_REQUIRED:
    "This leave type requires a documentation reference before it can be submitted.",
  LEAVE_SPANS_BALANCE_PERIODS:
    "This request crosses a balance period. Submit one request per balance period.",
  LEAVE_BALANCE_INCONSISTENT:
    "The stored balance no longer matches this request. Refresh and contact support if it persists.",
  LEAVE_BALANCE_NOT_FOUND:
    "No balance exists for this employee, leave type, and period. Only the current period can be created on demand.",
  LEAVE_ADJUSTMENT_PERIOD_INVALID:
    "The adjustment period is invalid. Use a date inside an existing balance period or the current period.",
  LEAVE_POLICY_PERIOD_LOCKED:
    "The balance period cannot change while balances exist for this leave type. Reconcile or archive the existing balances first.",
  IDEMPOTENCY_KEY_REUSED:
    "This submission was already used for a different request. Refresh before trying again.",
  EMPLOYEE_INACTIVE: "This employee is no longer active in the organization.",
  EMPLOYEE_NOT_FOUND: "This employee is not a member of the organization.",
  PERMISSION_DENIED: "Your role does not permit this leave action.",
};

export function leaveErrorMessage(error: unknown): string {
  if (isApiError(error)) {
    const known = LEAVE_ERROR_MESSAGES[error.code];
    if (known) return known;
  }
  return errorMessage(error);
}

export function leaveErrorCode(error: unknown): string | null {
  return isApiError(error) ? error.code : null;
}
