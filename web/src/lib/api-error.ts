import type { ApiErrorDetail } from "./types";

export interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    details?: ApiErrorDetail[];
  };
  requestId?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ApiErrorDetail[];
  readonly requestId?: string;

  constructor(options: {
    status: number;
    code: string;
    message: string;
    details?: ApiErrorDetail[];
    requestId?: string;
  }) {
    super(options.message);
    this.name = "ApiError";
    this.status = options.status;
    this.code = options.code;
    this.details = options.details ?? [];
    this.requestId = options.requestId;
  }

  fieldError(path: string): string | undefined {
    const normalized = path.replace(/^body\./, "");
    return this.details.find(
      (detail) =>
        detail.path === path ||
        detail.path === normalized ||
        detail.path.endsWith(`.${normalized}`),
    )?.message;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function parseApiError(status: number, body: unknown): ApiError {
  const envelope = (body ?? {}) as ErrorEnvelope;
  const code = envelope.error?.code ?? (status === 401 ? "UNAUTHENTICATED" : "REQUEST_FAILED");
  const message =
    envelope.error?.message ??
    (status >= 500
      ? "The server could not complete this request. Please try again."
      : "The request could not be completed.");
  return new ApiError({
    status,
    code,
    message,
    details: envelope.error?.details,
    requestId: envelope.requestId,
  });
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}
