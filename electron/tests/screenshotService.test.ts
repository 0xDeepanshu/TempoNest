import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type {
  ScreenshotApiClient,
  ScreenshotApiRequestOptions,
  ScreenshotCapture
} from '../electron/screenshotService'
import { ScreenshotService } from '../electron/screenshotService'
import type {
  ScreenshotCommand,
  ScreenshotUploadAuthorization
} from '../electron/backendTypes'
import { ApiError } from '../electron/errors'

const NOW = Date.parse('2026-10-23T12:00:00.000Z')

function uploadAuthorization(url = 'http://localhost:4000/api/v1/agent/screenshot-uploads/token-1'): ScreenshotUploadAuthorization {
  return {
    method: 'PUT',
    url,
    headers: { 'Content-Type': 'image/jpeg' },
    requiredHeaders: { 'X-Organization-Id': 'org-1' },
    requiresAgentAuth: true,
    expiresAt: new Date(NOW + 60_000).toISOString(),
    maxBytes: 10 * 1024 * 1024,
    contentType: 'image/jpeg'
  }
}

function command(expiresAt = new Date(NOW + 45_000).toISOString()): ScreenshotCommand {
  return {
    type: 'screenshot.request',
    requestId: randomUUID(),
    sessionId: randomUUID(),
    requestedAt: new Date(NOW).toISOString(),
    expiresAt,
    maxBytes: 10 * 1024 * 1024,
    allowedContentTypes: ['image/png', 'image/jpeg', 'image/webp'],
    requiresClaim: true
  }
}

function createHarness(
  overrides: {
    policyEnabled?: boolean
    claimError?: Error
    fetchImpl?: ReturnType<typeof vi.fn>
  } = {}
) {
  let uploadCounter = 0
  const calls: Array<{ path: string; options?: ScreenshotApiRequestOptions }> = []

  const request = vi.fn(async (path: string, options?: ScreenshotApiRequestOptions) => {
    calls.push({ path, options })
    if (path === '/screenshot-policy') {
      return {
        policy: {
          enabled: overrides.policyEnabled ?? true,
          retentionDays: 30,
          disclosure: {
            version: '2026-10-01',
            text: 'Screenshots are captured only after an explicit request.',
            acknowledgementRequired: true,
            acknowledged: false,
            acknowledgedAt: null
          },
          updatedAt: new Date(NOW).toISOString()
        }
      }
    }
    if (path.endsWith('/ack')) return { requestId: path.split('/')[3] }
    if (path.endsWith('/claim')) {
      if (overrides.claimError) throw overrides.claimError
      uploadCounter += 1
      return {
        requestId: path.split('/')[3],
        status: 'CLAIMED',
        claimedAt: new Date(NOW).toISOString(),
        expiresAt: new Date(NOW + 45_000).toISOString(),
        upload: uploadAuthorization(
          `http://localhost:4000/api/v1/agent/screenshot-uploads/token-${uploadCounter}`
        )
      }
    }
    if (path.endsWith('/upload-authorization')) {
      uploadCounter += 1
      return {
        requestId: path.split('/')[3],
        status: 'CLAIMED',
        upload: uploadAuthorization(
          `http://localhost:4000/api/v1/agent/screenshot-uploads/token-${uploadCounter}`
        )
      }
    }
    if (path.endsWith('/complete')) {
      return {
        screenshot: {
          id: randomUUID(),
          capturedAt: new Date(NOW).toISOString(),
          contentType: 'image/jpeg',
          fileSizeBytes: 4
        }
      }
    }
    if (path.endsWith('/fail')) return { request: {} }
    throw new Error(`Unexpected API call: ${path}`)
  })

  const capture = vi.fn<ScreenshotCapture>(async () => ({
    bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    contentType: 'image/jpeg',
    capturedAt: new Date(NOW).toISOString(),
    width: 1280,
    height: 720
  }))

  const fetchImpl =
    overrides.fetchImpl ?? vi.fn(async () => new Response(null, { status: 201 }))

  const service = new ScreenshotService({
    client: { request } as unknown as ScreenshotApiClient,
    getAccessToken: () => 'access-token',
    refreshAccessToken: async () => true,
    getCredentials: () => ({ id: 'agent-1', key: 'secret-agent-key', organizationId: 'org-1' }),
    rotateCredentials: async () => ({
      id: 'agent-2',
      key: 'rotated-agent-key',
      organizationId: 'org-1'
    }),
    capture,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    now: () => NOW,
    uploadTimeoutMs: 2_000
  })

  return { service, request, capture, fetchImpl, calls }
}

async function attach(service: ScreenshotService): Promise<void> {
  service.attachSession('org-1')
  await vi.waitFor(() => expect(service.getStatus().policyKnown).toBe(true))
}

describe('ScreenshotService', () => {
  it('claims, captures, uploads with agent auth, completes, and stays display-safe', async () => {
    const harness = createHarness()
    await attach(harness.service)
    const request = command()

    await harness.service.handleRequest(request)

    expect(harness.capture).toHaveBeenCalledTimes(1)
    expect(harness.fetchImpl).toHaveBeenCalledTimes(1)

    const paths = harness.calls.map((call) => call.path)
    expect(paths).toContain(`/agent/screenshot-requests/${request.requestId}/ack`)
    expect(paths).toContain(`/agent/screenshot-requests/${request.requestId}/claim`)
    expect(paths).toContain(`/agent/screenshot-requests/${request.requestId}/complete`)

    const uploadCall = harness.fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit
    ]
    expect(uploadCall[0]).toContain('/agent/screenshot-uploads/token-1')
    const headers = new Headers(uploadCall[1].headers)
    expect(headers.get('Authorization')).toBe('Bearer access-token')
    expect(headers.get('X-Agent-Id')).toBe('agent-1')
    expect(headers.get('X-Agent-Key')).toBe('secret-agent-key')
    expect(headers.get('X-Organization-Id')).toBe('org-1')
    expect(headers.get('Content-Type')).toBe('image/jpeg')

    const complete = harness.calls.find((call) => call.path.endsWith('/complete'))
    expect(complete?.options?.body).toMatchObject({
      captureTimestamp: new Date(NOW).toISOString()
    })

    const status = harness.service.getStatus()
    expect(status.phase).toBe('COMPLETED')
    expect(status.activeRequestId).toBeNull()
    expect(status.monitoringEnabled).toBe(true)
    expect(status.disclosureText).toContain('explicit request')
    expect(status.acknowledgementRequired).toBe(true)

    const serialized = JSON.stringify(status)
    expect(serialized).not.toContain('secret-agent-key')
    expect(serialized).not.toContain('upload-token')
    expect(serialized).not.toContain('screenshot-uploads')
    expect(serialized).not.toContain('access-token')
  })

  it('rejects an expired request before acknowledgement or capture', async () => {
    const harness = createHarness()
    await attach(harness.service)
    const request = command(new Date(NOW - 1_000).toISOString())

    await harness.service.handleRequest(request)

    expect(harness.capture).not.toHaveBeenCalled()
    expect(harness.fetchImpl).not.toHaveBeenCalled()
    expect(
      harness.calls.some((call) => call.path.endsWith('/claim'))
    ).toBe(false)
    expect(harness.calls.some((call) => call.path.endsWith('/fail'))).toBe(false)
    expect(harness.service.getStatus().phase).toBe('EXPIRED')
  })

  it('discards an in-flight capture when an administrator cancels the request', async () => {
    let finishCapture!: (value: Awaited<ReturnType<ScreenshotCapture>>) => void
    const capturePromise = new Promise<Awaited<ReturnType<ScreenshotCapture>>>((resolve) => {
      finishCapture = resolve
    })
    const harness = createHarness()
    harness.capture.mockImplementation(() => capturePromise)
    await attach(harness.service)
    const request = command()

    const pending = harness.service.handleRequest(request)
    await vi.waitFor(() => expect(harness.capture).toHaveBeenCalledTimes(1))
    harness.service.handleCancelled(request.requestId)
    finishCapture({
      bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      contentType: 'image/jpeg',
      capturedAt: new Date(NOW).toISOString(),
      width: 1280,
      height: 720
    })
    await pending

    expect(harness.fetchImpl).not.toHaveBeenCalled()
    expect(harness.calls.some((call) => call.path.endsWith('/complete'))).toBe(false)
    expect(harness.service.getStatus().phase).toBe('CANCELLED')
    expect(harness.service.getStatus().activeRequestId).toBeNull()
  })

  it('reports a sanitized failure when private storage rejects the upload', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 500 }))
    const harness = createHarness({ fetchImpl })
    await attach(harness.service)
    const request = command()

    await harness.service.handleRequest(request)

    const fail = harness.calls.find((call) => call.path.endsWith('/fail'))
    expect(fail?.options?.body).toMatchObject({ code: 'UPLOAD_FAILED' })
    expect(harness.service.getStatus().phase).toBe('FAILED')
    expect(harness.service.getStatus().message).not.toContain('500')
    expect(harness.service.getStatus().message).not.toContain('token-1')
  })

  it('refreshes an expired upload authorization and retries once', async () => {
    let uploadAttempt = 0
    const fetchImpl = vi.fn(async () => {
      uploadAttempt += 1
      return uploadAttempt === 1
        ? new Response(null, { status: 409 })
        : new Response(null, { status: 201 })
    })
    const harness = createHarness({ fetchImpl })
    await attach(harness.service)
    const request = command()

    await harness.service.handleRequest(request)

    expect(harness.fetchImpl).toHaveBeenCalledTimes(2)
    expect(
      harness.calls.filter((call) => call.path.endsWith('/upload-authorization'))
    ).toHaveLength(1)
    expect(
      harness.calls.filter((call) => call.path.endsWith('/complete'))
    ).toHaveLength(1)
    expect(harness.service.getStatus().phase).toBe('COMPLETED')
  })

  it('stops without capture when the device credential was revoked', async () => {
    const harness = createHarness({
      claimError: new ApiError(403, 'AGENT_REVOKED', 'This device was revoked.')
    })
    await attach(harness.service)
    const request = command()

    await harness.service.handleRequest(request)

    expect(harness.capture).not.toHaveBeenCalled()
    expect(harness.fetchImpl).not.toHaveBeenCalled()
    expect(harness.calls.some((call) => call.path.endsWith('/fail'))).toBe(false)
    expect(harness.service.getStatus().phase).toBe('FAILED')
    expect(harness.service.getStatus().message).toContain('revoked')
  })

  it('exposes a disabled policy without allowing capture', async () => {
    const harness = createHarness({ policyEnabled: false })
    await attach(harness.service)

    const status = harness.service.getStatus()
    expect(status.monitoringEnabled).toBe(false)
    expect(status.policyKnown).toBe(true)
    expect(harness.capture).not.toHaveBeenCalled()
  })
})
