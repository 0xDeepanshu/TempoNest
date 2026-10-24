import { REQUEST_TIMEOUT_MS } from './config'
import { ApiError, NetworkError } from './errors'

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  /** Attach the current bearer token. Defaults to true. */
  authenticated?: boolean
  /** Attach X-Agent-Id/X-Agent-Key. */
  agent?: { id: string; key: string } | null
  /** Attach X-Organization-Id for organization-scoped routes. */
  organizationId?: string
  /** Retry once after a token refresh. */
  retryOnAuthFailure?: boolean
}

export type AccessTokenProvider = () => string | null
export type TokenRefresher = () => Promise<boolean>

type ErrorEnvelope = {
  error?: {
    code?: unknown
    message?: unknown
    details?: unknown
  }
  requestId?: unknown
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/**
 * Small JSON client. It never logs or forwards raw request/response secrets and
 * refreshes an expired bearer token once before retrying the request.
 */
export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly getAccessToken: AccessTokenProvider,
    private readonly refreshAccessToken: TokenRefresher
  ) {}

  async request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
    return this.requestInternal<T>(path, options, false)
  }

  private async requestInternal<T>(
    path: string,
    options: ApiRequestOptions,
    hasRetried: boolean
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/json'
    }

    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json'
    }

    if (options.authenticated !== false) {
      const token = this.getAccessToken()
      if (!token) {
        throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required.')
      }
      headers.Authorization = `Bearer ${token}`
    }

    if (options.agent) {
      headers['X-Agent-Id'] = options.agent.id
      headers['X-Agent-Key'] = options.agent.key
    }

    if (options.organizationId) {
      headers['X-Organization-Id'] = options.organizationId
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    let response: Response
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal
      })
    } catch (error) {
      throw new NetworkError(undefined, error)
    } finally {
      clearTimeout(timeout)
    }

    const requestId = response.headers.get('x-request-id')

    if (response.status === 204) {
      return undefined as T
    }

    let payload: unknown = null
    const contentType = response.headers.get('content-type') ?? ''
    try {
      payload = contentType.includes('application/json')
        ? await response.json()
        : await response.text()
    } catch (error) {
      if (response.ok) throw new NetworkError('The server returned an unreadable response.', error)
    }

    if (!response.ok) {
      const envelope = (typeof payload === 'object' && payload !== null
        ? payload
        : {}) as ErrorEnvelope
      const code = asString(envelope.error?.code) ?? `HTTP_${response.status}`
      const message =
        asString(envelope.error?.message) ??
        (typeof payload === 'string' && payload.trim() ? payload.trim() : 'Request failed.')

      const canRefresh =
        options.authenticated !== false &&
        response.status === 401 &&
        ['AUTH_TOKEN_EXPIRED', 'AUTH_TOKEN_INVALID', 'UNAUTHENTICATED'].includes(code) &&
        !hasRetried &&
        options.retryOnAuthFailure !== false

      if (canRefresh) {
        const refreshed = await this.refreshAccessToken()
        if (refreshed) {
          return this.requestInternal<T>(path, options, true)
        }
      }

      throw new ApiError(
        response.status,
        code,
        message,
        asString(envelope.requestId) ?? requestId,
        envelope.error?.details ?? null
      )
    }

    if (typeof payload === 'object' && payload !== null && 'data' in payload) {
      return (payload as { data: T }).data
    }

    return payload as T
  }
}
