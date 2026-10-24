import type { MonitoringPhase, MonitoringStatus } from '../src/types/electron'
import type {
  PendingScreenshotRequest,
  ScreenshotClaimResponse,
  ScreenshotCommand,
  ScreenshotCompleteResponse,
  ScreenshotPolicyDisclosure,
  ScreenshotUploadAuthorization,
} from './backendTypes'
import { ApiError, NetworkError } from './errors'
import { ScreenshotOperationError } from './screenshotErrors'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DEFAULT_UPLOAD_TIMEOUT_MS = 30_000
const MAX_REMEMBERED_REQUESTS = 50

export interface ScreenshotCredentials {
  id: string
  key: string
  organizationId: string
}

export interface ScreenshotApiRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  agent?: { id: string; key: string } | null
  organizationId?: string
}

/** The subset of ApiClient used by the screenshot lifecycle. */
export interface ScreenshotApiClient {
  request<T>(path: string, options?: ScreenshotApiRequestOptions): Promise<T>
}

export interface ScreenshotCaptureResult {
  bytes: Buffer
  contentType: 'image/jpeg'
  capturedAt: string
  width: number
  height: number
}

export interface ScreenshotCaptureOptions {
  signal: AbortSignal
  maxBytes: number
}

export type ScreenshotCapture = (
  options: ScreenshotCaptureOptions
) => Promise<ScreenshotCaptureResult>

export interface ScreenshotServiceOptions {
  client: ScreenshotApiClient
  getAccessToken: () => string | null
  refreshAccessToken: () => Promise<boolean>
  getCredentials: () => ScreenshotCredentials | null
  rotateCredentials: () => Promise<ScreenshotCredentials | null>
  capture: ScreenshotCapture
  fetchImpl?: typeof fetch
  now?: () => number
  uploadTimeoutMs?: number
}

export interface ScreenshotSocketError {
  code?: string
  message?: string
  requestId?: string
}

export interface ScreenshotSocketHandler {
  handleConnected: (serverTime?: string) => void
  handlePending: (requests: PendingScreenshotRequest[]) => void
  handleRequest: (command: ScreenshotCommand | PendingScreenshotRequest) => void
  handleCancelled: (requestId: string) => void
  handleServerError: (error: ScreenshotSocketError) => void
}

type AuthorizationResult =
  | { kind: 'upload'; upload: ScreenshotUploadAuthorization }
  | { kind: 'complete' }

type UploadAuthorizationEnvelope = {
  requestId: string
  status: 'CLAIMED'
  upload: ScreenshotUploadAuthorization
}

type ScreenshotPolicyEnvelope = {
  policy: ScreenshotPolicyDisclosure
}

function initialStatus(): MonitoringStatus {
  return {
    policyKnown: false,
    monitoringEnabled: false,
    disclosureText: null,
    acknowledgementRequired: false,
    acknowledged: false,
    phase: 'IDLE',
    activeRequestId: null,
    lastEventAt: null,
    message: null,
  }
}

function iso(value: number): string {
  return new Date(value).toISOString()
}

/**
 * Owns the explicit screenshot lifecycle in the Electron main process.
 *
 * Capture only starts after the server acknowledges a claim for the signed-in
 * employee and this installation. Image bytes and upload credentials never
 * cross the IPC boundary; the renderer receives only display-safe state.
 */
export class ScreenshotService implements ScreenshotSocketHandler {
  private readonly listeners = new Set<(status: MonitoringStatus) => void>()
  private readonly terminalRequests = new Set<string>()
  private readonly fetchImpl: typeof fetch
  private readonly uploadTimeoutMs: number

  private status = initialStatus()
  private organizationId: string | null = null
  private clockOffsetMs = 0
  private active: { requestId: string; controller: AbortController } | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private disposed = false

  constructor(private readonly options: ScreenshotServiceOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.uploadTimeoutMs = options.uploadTimeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS
  }

  attachSession(organizationId: string): void {
    if (this.organizationId === organizationId && this.status.policyKnown) return
    this.cancelActive()
    this.organizationId = organizationId
    this.clockOffsetMs = 0
    this.status = initialStatus()
    this.emit()
    void this.refreshPolicy()
  }

  detachSession(): void {
    this.cancelActive()
    this.organizationId = null
    this.clockOffsetMs = 0
    this.status = initialStatus()
    this.emit()
  }

  getStatus(): MonitoringStatus {
    return { ...this.status }
  }

  onStatusChanged(listener: (status: MonitoringStatus) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  handleConnected(serverTime?: string): void {
    if (serverTime) {
      const parsed = Date.parse(serverTime)
      if (Number.isFinite(parsed)) this.clockOffsetMs = parsed - Date.now()
    }
    void this.refreshPolicy()
  }

  handlePending(requests: PendingScreenshotRequest[]): void {
    for (const request of requests) void this.handleRequest(request)
  }

  handleRequest(command: ScreenshotCommand | PendingScreenshotRequest): Promise<void> {
    if (this.disposed || !this.organizationId) return Promise.resolve()
    const requestId = command.requestId
    if (!UUID_PATTERN.test(requestId)) {
      this.update({
        phase: 'FAILED',
        activeRequestId: null,
        message: 'The screenshot request identifier was invalid, so nothing was captured.',
      })
      return Promise.resolve()
    }
    if (this.terminalRequests.has(requestId)) return Promise.resolve()
    if (this.active?.requestId === requestId) return Promise.resolve()
    return this.enqueue(() => this.processRequest(command))
  }

  handleCancelled(requestId: string): void {
    if (!UUID_PATTERN.test(requestId)) return
    this.rememberTerminal(requestId)
    if (this.active?.requestId === requestId) this.active.controller.abort()
    this.update({
      phase: 'CANCELLED',
      activeRequestId: null,
      message: 'The screenshot request was cancelled by an administrator. Nothing was uploaded.',
    })
  }

  handleServerError(error: ScreenshotSocketError): void {
    // A socket-level error is informational. It never starts capture and it
    // never includes the server's raw message in the renderer-facing state.
    const message =
      error.code === 'SCREENSHOT_POLICY_DISABLED'
        ? 'Screen monitoring was disabled before the request could be captured.'
        : 'The screenshot service reported a problem. Active requests will be retried when connected.'
    this.update({
      message,
      ...(error.requestId === this.active?.requestId ? { activeRequestId: error.requestId } : {}),
    })
  }

  dispose(): void {
    this.disposed = true
    this.cancelActive()
    this.listeners.clear()
    this.organizationId = null
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work)
    this.queue = next.catch(() => undefined)
    return next
  }

  private async processRequest(
    command: ScreenshotCommand | PendingScreenshotRequest
  ): Promise<void> {
    const requestId = command.requestId
    if (this.disposed || !this.organizationId) return
    if (this.terminalRequests.has(requestId)) return

    if (this.isExpired(command.expiresAt)) {
      this.finish(requestId, 'EXPIRED', 'The screenshot request expired before it could be captured.')
      return
    }

    const controller = new AbortController()
    this.active = { requestId, controller }
    this.update({
      phase: 'REQUESTED',
      activeRequestId: requestId,
      message: 'An administrator requested a screenshot. Preparing to capture your screen.',
    })

    try {
      await this.tryAcknowledge(requestId)

      this.update({
        phase: 'CLAIMING',
        activeRequestId: requestId,
        message: 'The request was acknowledged. Checking the monitoring policy and device eligibility.',
      })
      const authorization = await this.obtainAuthorization(command)
      if (authorization.kind === 'complete') {
        await this.completeRequest(requestId, this.isoNow())
        this.finish(
          requestId,
          'COMPLETED',
          'The screenshot was already uploaded and the request was completed.',
        )
        return
      }

      if (controller.signal.aborted) return
      this.assertNotExpired(command.expiresAt)

      this.update({
        phase: 'CAPTURING',
        activeRequestId: requestId,
        message: 'Capturing your screen now. This capture was requested by an administrator.',
      })
      const capture = await this.options.capture({
        signal: controller.signal,
        maxBytes: authorization.upload.maxBytes,
      })
      if (controller.signal.aborted) return
      this.assertNotExpired(command.expiresAt)

      this.update({
        phase: 'UPLOADING',
        activeRequestId: requestId,
        message: 'Uploading the screenshot to private storage.',
      })
      await this.uploadWithAuthorization(authorization.upload, capture, controller.signal)
      if (controller.signal.aborted) return

      this.update({
        phase: 'UPLOADING',
        activeRequestId: requestId,
        message: 'Finalizing the private screenshot record.',
      })
      await this.completeRequest(requestId, capture.capturedAt)
      this.finish(
        requestId,
        'COMPLETED',
        'Screenshot captured and uploaded to private storage.',
      )
    } catch (error) {
      if (controller.signal.aborted) return
      const failure = this.classifyFailure(error)
      if (failure.phase === 'REQUESTED') {
        // Network failures stay retryable. The next reconnect reloads pending
        // requests and resumes without inventing a terminal failure.
        this.update({
          phase: 'REQUESTED',
          activeRequestId: requestId,
          message: failure.message,
        })
        return
      }
      if (failure.report) {
        await this.reportFailure(requestId, failure.code, failure.message).catch(() => undefined)
      }
      this.finish(requestId, failure.phase, failure.message)
    } finally {
      if (this.active?.requestId === requestId) this.active = null
    }
  }

  private async obtainAuthorization(
    command: ScreenshotCommand | PendingScreenshotRequest
  ): Promise<AuthorizationResult> {
    const resumed = 'status' in command && command.status === 'CLAIMED'
    if (resumed && command.uploadedAt) return { kind: 'complete' }

    if (resumed) return this.reauthorize(command.requestId)

    try {
      const response = await this.agentRequest<ScreenshotClaimResponse>(
        `/agent/screenshot-requests/${command.requestId}/claim`,
        {
          method: 'POST',
          body: { contentType: 'image/jpeg' },
        }
      )
      return { kind: 'upload', upload: response.upload }
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      if (error.code === 'SCREENSHOT_ALREADY_CLAIMED') {
        return this.reauthorize(command.requestId)
      }
      if (error.code === 'SCREENSHOT_ALREADY_COMPLETED') return { kind: 'complete' }
      throw error
    }
  }

  private async reauthorize(requestId: string): Promise<AuthorizationResult> {
    try {
      const response = await this.agentRequest<UploadAuthorizationEnvelope>(
        `/agent/screenshot-requests/${requestId}/upload-authorization`,
        {
          method: 'POST',
          body: { contentType: 'image/jpeg' },
        }
      )
      return { kind: 'upload', upload: response.upload }
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === 'SCREENSHOT_ALREADY_UPLOADED') return { kind: 'complete' }
        if (error.code === 'SCREENSHOT_ALREADY_COMPLETED') return { kind: 'complete' }
      }
      throw error
    }
  }

  private async tryAcknowledge(requestId: string): Promise<void> {
    try {
      await this.agentRequest(`/agent/screenshot-requests/${requestId}/ack`, {
        method: 'POST',
        body: {},
      })
    } catch {
      // Acknowledgement is an audit marker. Claim is the authoritative gate,
      // so a benign ack race must not stop an otherwise valid request.
    }
  }

  private async uploadWithAuthorization(
    initial: ScreenshotUploadAuthorization,
    capture: ScreenshotCaptureResult,
    signal: AbortSignal
  ): Promise<void> {
    if (capture.bytes.length === 0) {
      throw new ScreenshotOperationError(
        'CAPTURE_EMPTY',
        'The screen capture was empty, so it was not uploaded.'
      )
    }
    if (capture.bytes.length > initial.maxBytes) {
      throw new ScreenshotOperationError(
        'CAPTURE_TOO_LARGE',
        'The screen capture exceeded the organization upload limit.'
      )
    }

    let authorization = initial
    if (this.isExpired(authorization.expiresAt)) {
      const refreshed = await this.reauthorizeForUpload()
      if (refreshed.kind === 'complete') return
      authorization = refreshed.upload
    }

    try {
      await this.sendUpload(authorization, capture, signal)
    } catch (error) {
      if (signal.aborted) throw error
      if (!this.isUploadAuthorizationFailure(error)) throw error

      const refreshed = await this.reauthorizeForUpload()
      if (refreshed.kind === 'complete') return
      authorization = refreshed.upload
      await this.sendUpload(authorization, capture, signal)
    }
  }

  private async reauthorizeForUpload(): Promise<AuthorizationResult> {
    const requestId = this.active?.requestId
    if (!requestId) {
      throw new ScreenshotOperationError(
        'UPLOAD_AUTHORIZATION_EXPIRED',
        'The screenshot upload authorization is no longer available.'
      )
    }
    return this.reauthorize(requestId)
  }

  private async sendUpload(
    authorization: ScreenshotUploadAuthorization,
    capture: ScreenshotCaptureResult,
    signal: AbortSignal
  ): Promise<void> {
    if (capture.bytes.length > authorization.maxBytes) {
      throw new ScreenshotOperationError(
        'CAPTURE_TOO_LARGE',
        'The screen capture exceeded the organization upload limit.'
      )
    }

    let attempt = 0
    while (attempt < 2) {
      attempt += 1
      const headers = new Headers(authorization.headers ?? {})
      for (const [name, value] of Object.entries(authorization.requiredHeaders ?? {})) {
        headers.set(name, value)
      }

      if (authorization.requiresAgentAuth) {
        const credentials = this.requireCredentials()
        const token = this.options.getAccessToken()
        if (!token) {
          throw new ScreenshotOperationError(
            'AUTHENTICATION_REQUIRED',
            'The desktop agent is not signed in.'
          )
        }
        headers.set('Authorization', `Bearer ${token}`)
        headers.set('X-Agent-Id', credentials.id)
        headers.set('X-Agent-Key', credentials.key)
        headers.set('X-Organization-Id', credentials.organizationId)
      }

      const controller = new AbortController()
      const onAbort = (): void => controller.abort()
      signal.addEventListener('abort', onAbort, { once: true })
      let timedOut = false
      const timeout = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, this.uploadTimeoutMs)

      let response: Response
      try {
        response = await this.fetchImpl(authorization.url, {
          method: authorization.method,
          headers,
          body: new Uint8Array(capture.bytes),
          signal: controller.signal,
        })
      } catch (error) {
        if (signal.aborted) {
          throw new ScreenshotOperationError(
            'REQUEST_CANCELLED',
            'The screenshot request was cancelled.'
          )
        }
        if (timedOut) {
          throw new ScreenshotOperationError(
            'UPLOAD_TIMEOUT',
            'The screenshot upload timed out and will be retried.'
          )
        }
        throw new NetworkError('The screenshot upload could not be reached.', error)
      } finally {
        clearTimeout(timeout)
        signal.removeEventListener('abort', onAbort)
      }

      if (response.ok) return

      if (
        response.status === 401 &&
        authorization.requiresAgentAuth &&
        attempt === 1 &&
        (await this.options.refreshAccessToken())
      ) {
        continue
      }

      if (response.status === 409 || response.status === 404 || response.status === 410) {
        throw new ScreenshotOperationError(
          'UPLOAD_AUTHORIZATION_EXPIRED',
          'The screenshot upload authorization expired and will be refreshed.'
        )
      }

      throw new ScreenshotOperationError(
        'UPLOAD_FAILED',
        'The private screenshot upload was rejected by storage.'
      )
    }

    throw new ScreenshotOperationError(
      'UPLOAD_FAILED',
      'The private screenshot upload could not be completed.'
    )
  }

  private async completeRequest(requestId: string, captureTimestamp: string): Promise<void> {
    await this.agentRequest<ScreenshotCompleteResponse>(
      `/agent/screenshot-requests/${requestId}/complete`,
      {
        method: 'POST',
        body: { captureTimestamp },
      }
    )
  }

  private async reportFailure(requestId: string, code: string, message: string): Promise<void> {
    await this.agentRequest(`/agent/screenshot-requests/${requestId}/fail`, {
      method: 'POST',
      body: { code: this.safeFailureCode(code), message },
    })
  }

  private async refreshPolicy(): Promise<void> {
    if (this.disposed || !this.organizationId) return
    const credentials = this.options.getCredentials()
    if (!credentials) return

    try {
      const response = await this.options.client.request<ScreenshotPolicyEnvelope>(
        '/screenshot-policy',
        { organizationId: credentials.organizationId }
      )
      const policy = response.policy
      this.update({
        policyKnown: true,
        monitoringEnabled: policy.enabled,
        disclosureText: policy.disclosure.text,
        acknowledgementRequired: policy.disclosure.acknowledgementRequired,
        acknowledged: policy.disclosure.acknowledged,
        message: policy.enabled
          ? this.status.message
          : 'Screen monitoring is disabled by this organization.',
      })
    } catch (error) {
      if (error instanceof NetworkError) return
      this.update({ policyKnown: false })
    }
  }

  private async agentRequest<T>(
    path: string,
    options: ScreenshotApiRequestOptions,
    retried = false
  ): Promise<T> {
    const credentials = this.requireCredentials()
    if (credentials.organizationId !== this.organizationId) {
      throw new ScreenshotOperationError(
        'ORGANIZATION_MISMATCH',
        'The screenshot request does not match the signed-in organization.'
      )
    }

    try {
      return await this.options.client.request<T>(path, {
        ...options,
        agent: { id: credentials.id, key: credentials.key },
        organizationId: credentials.organizationId,
      })
    } catch (error) {
      if (
        !retried &&
        error instanceof ApiError &&
        (error.code === 'AGENT_CREDENTIALS_INVALID' || error.code === 'AGENT_NOT_FOUND')
      ) {
        const rotated = await this.options.rotateCredentials()
        if (rotated) return this.agentRequest<T>(path, options, true)
      }
      throw error
    }
  }

  private requireCredentials(): ScreenshotCredentials {
    const credentials = this.options.getCredentials()
    if (!credentials) {
      throw new ScreenshotOperationError(
        'AGENT_NOT_READY',
        'The desktop agent is not registered for this device.'
      )
    }
    return credentials
  }

  private classifyFailure(error: unknown): {
    phase: MonitoringPhase
    code: string
    message: string
    report: boolean
  } {
    if (error instanceof NetworkError) {
      return {
        phase: 'REQUESTED',
        code: 'NETWORK_UNAVAILABLE',
        message:
          'Network unavailable. The screenshot request is still pending and will be retried when connected.',
        report: false,
      }
    }

    if (error instanceof ScreenshotOperationError) {
      if (error.code === 'REQUEST_CANCELLED') {
        return {
          phase: 'CANCELLED',
          code: 'REQUEST_CANCELLED',
          message: 'The screenshot request was cancelled. Nothing was uploaded.',
          report: false,
        }
      }
      if (error.code === 'REQUEST_EXPIRED') {
        return {
          phase: 'EXPIRED',
          code: error.code,
          message: 'The screenshot request expired before it could be completed.',
          report: false,
        }
      }
      return {
        phase: 'FAILED',
        code: error.code,
        message: error.message,
        report: ['OS_PERMISSION_DENIED', 'CAPTURE_UNAVAILABLE', 'CAPTURE_TOO_LARGE', 'CAPTURE_EMPTY', 'UPLOAD_FAILED', 'UPLOAD_TIMEOUT'].includes(
          error.code
        ),
      }
    }

    if (error instanceof ApiError) {
      if (error.code === 'SCREENSHOT_REQUEST_EXPIRED') {
        return {
          phase: 'EXPIRED',
          code: error.code,
          message: 'The screenshot request expired before it could be completed.',
          report: false,
        }
      }
      if (error.code === 'SCREENSHOT_ALREADY_COMPLETED') {
        return {
          phase: 'COMPLETED',
          code: error.code,
          message: 'The screenshot request was already completed.',
          report: false,
        }
      }
      if (
        error.code === 'SCREENSHOT_REQUEST_NOT_ACTIVE' ||
        error.code === 'SCREENSHOT_REQUEST_NOT_FOUND'
      ) {
        return {
          phase: 'EXPIRED',
          code: error.code,
          message: 'The screenshot request is no longer active.',
          report: false,
        }
      }
      if (error.code === 'AGENT_REVOKED') {
        return {
          phase: 'FAILED',
          code: error.code,
          message: 'This device was revoked, so no screenshot was captured.',
          report: false,
        }
      }
      if (
        error.code === 'AUTH_TOKEN_EXPIRED' ||
        error.code === 'AUTH_TOKEN_INVALID' ||
        error.code === 'UNAUTHENTICATED'
      ) {
        return {
          phase: 'FAILED',
          code: error.code,
          message: 'Your session is no longer valid. Sign in again to resume tracking.',
          report: false,
        }
      }
      if (error.code === 'SCREENSHOT_POLICY_DISABLED') {
        return {
          phase: 'FAILED',
          code: error.code,
          message: 'Screen monitoring was disabled by this organization before capture began.',
          report: true,
        }
      }
      if (error.code === 'SCREENSHOT_SESSION_NOT_ACTIVE') {
        return {
          phase: 'FAILED',
          code: error.code,
          message: 'The linked work session ended before the screenshot could be captured.',
          report: true,
        }
      }
      return {
        phase: 'FAILED',
        code: 'SCREENSHOT_FAILED',
        message: 'The screenshot request could not be completed.',
        report: true,
      }
    }

    return {
      phase: 'FAILED',
      code: 'SCREENSHOT_FAILED',
      message: 'The screenshot request could not be completed.',
      report: true,
    }
  }

  private isUploadAuthorizationFailure(error: unknown): boolean {
    return (
      (error instanceof ScreenshotOperationError &&
        error.code === 'UPLOAD_AUTHORIZATION_EXPIRED') ||
      (error instanceof ApiError &&
        (error.code === 'UPLOAD_AUTHORIZATION_INVALID' ||
          error.code === 'UPLOAD_AUTHORIZATION_EXPIRED'))
    )
  }

  private safeFailureCode(code: string): string {
    const normalized = code.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_')
    return (normalized || 'SCREENSHOT_FAILED').slice(0, 64)
  }

  private finish(requestId: string, phase: MonitoringPhase, message: string): void {
    this.rememberTerminal(requestId)
    this.update({ phase, activeRequestId: null, message })
  }

  private rememberTerminal(requestId: string): void {
    this.terminalRequests.add(requestId)
    while (this.terminalRequests.size > MAX_REMEMBERED_REQUESTS) {
      const oldest = this.terminalRequests.values().next().value
      if (typeof oldest !== 'string') break
      this.terminalRequests.delete(oldest)
    }
  }

  private cancelActive(): void {
    if (this.active) this.active.controller.abort()
    this.active = null
  }

  private assertNotExpired(expiresAt: string): void {
    if (this.isExpired(expiresAt)) {
      throw new ScreenshotOperationError(
        'REQUEST_EXPIRED',
        'The screenshot request expired before it could be captured.'
      )
    }
  }

  private isExpired(expiresAt: string): boolean {
    const parsed = Date.parse(expiresAt)
    return !Number.isFinite(parsed) || parsed <= this.nowMs()
  }

  private nowMs(): number {
    return (this.options.now?.() ?? Date.now()) + this.clockOffsetMs
  }

  private isoNow(): string {
    return iso(this.nowMs())
  }

  private update(patch: Partial<MonitoringStatus>): void {
    this.status = {
      ...this.status,
      ...patch,
      lastEventAt: new Date().toISOString(),
    }
    this.emit()
  }

  private emit(): void {
    const snapshot = this.getStatus()
    for (const listener of this.listeners) listener(snapshot)
  }
}
