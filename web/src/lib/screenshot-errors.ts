import { errorMessage, isApiError } from "./api-error";

const MESSAGES: Record<string, string> = {
  SCREENSHOT_POLICY_DISABLED:
    "Screen monitoring is disabled for this organization. An owner or administrator must enable it in monitoring settings first.",
  SCREENSHOT_ROLE_NOT_ALLOWED:
    "Your role is not permitted to perform this monitoring action under the current organization policy.",
  SCREENSHOT_POLICY_ACKNOWLEDGEMENT_REQUIRED:
    "This employee must acknowledge the current monitoring disclosure before a screenshot can be requested.",
  NO_ELIGIBLE_SCREENSHOT_SESSION:
    "The employee is not in an eligible active work session with a fresh heartbeat. Start a session in the desktop app and try again.",
  INVALID_SCREENSHOT_AGENT:
    "The employee does not have a valid desktop agent for the active session.",
  SCREENSHOT_REQUEST_PENDING:
    "This employee already has a pending screenshot request. Wait for it to finish or cancel it first.",
  SCREENSHOT_REQUEST_COOLDOWN:
    "Please wait a few seconds before requesting another screenshot.",
  SCREENSHOT_REQUEST_EXPIRED:
    "The screenshot request expired before the desktop agent could capture it.",
  SCREENSHOT_REQUEST_NOT_ACTIVE:
    "The screenshot request is no longer active.",
  SCREENSHOT_NOT_FOUND:
    "The screenshot is no longer available. It may have reached its retention limit.",
  SCREENSHOT_LINK_INVALID:
    "The screenshot preview link expired. Request a fresh preview.",
  IDEMPOTENCY_KEY_REUSED:
    "This request key was already used for a different employee. Try the action again.",
  EMPLOYEE_NOT_FOUND: "The selected employee was not found in this organization.",
  VALIDATION_ERROR: "Some monitoring settings are invalid. Review the highlighted values.",
};

/** Maps backend screenshot error codes to safe, actionable portal copy. */
export function screenshotErrorMessage(error: unknown): string {
  if (isApiError(error)) {
    return MESSAGES[error.code] ?? error.message;
  }
  return errorMessage(error);
}
