import { API_BASE_URL } from '../config/env';
import { ApiError, NetworkError } from './errors';
import type { ApiErrorBody } from './types';

export interface HttpRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export async function httpJson<T>(
  path: string,
  options: HttpRequestOptions = {},
): Promise<T> {
  const method = options.method ?? 'GET';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
  const controller = new AbortController();
  let timedOut = false;

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...options.headers,
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timeout);
    throw new NetworkError(timedOut);
  }

  let rawBody: string;
  try {
    rawBody = response.status === 204 ? '' : await response.text();
  } catch {
    clearTimeout(timeout);
    throw new NetworkError(timedOut);
  }
  clearTimeout(timeout);

  let parsed: unknown = undefined;
  if (rawBody) {
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      if (response.ok) {
        throw new ApiError({
          status: response.status,
          code: 'INVALID_RESPONSE',
          message: 'TempoNest returned an unexpected response. Please try again.',
        });
      }
    }
  }

  if (!response.ok) {
    const body = (parsed ?? {}) as ApiErrorBody;
    throw new ApiError({
      status: response.status,
      code: body.error?.code ?? 'REQUEST_FAILED',
      message: body.error?.message ?? 'The request could not be completed. Please try again.',
      details: body.error?.details,
      requestId: body.requestId ?? response.headers.get('X-Request-Id') ?? undefined,
    });
  }

  return (parsed ?? undefined) as T;
}
