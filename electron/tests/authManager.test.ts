import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthManager } from '../electron/authManager'
import { NetworkError } from '../electron/errors'
import type { SecureStore } from '../electron/secureStore'
import type { BackendAuthPayload } from '../electron/backendTypes'

const REFRESH_TOKEN_KEY = 'auth.refreshToken'

class MemoryStore {
  private values = new Map<string, string>()

  get(key: string): string | null {
    return this.values.get(key) ?? null
  }

  set(key: string, value: string): void {
    this.values.set(key, value)
  }

  remove(key: string): void {
    this.values.delete(key)
  }

  clear(): void {
    this.values.clear()
  }

  getJson<T>(key: string): T | null {
    const value = this.get(key)
    return value ? (JSON.parse(value) as T) : null
  }

  setJson(key: string, value: unknown): void {
    this.set(key, JSON.stringify(value))
  }
}

function payload(accessToken: string, refreshToken: string): BackendAuthPayload {
  return {
    user: { id: 'user-1', name: 'Ada Lovelace', email: 'ada@example.com', status: 'ACTIVE' },
    memberships: [
      {
        id: 'membership-1',
        organizationId: 'org-1',
        userId: 'user-1',
        role: 'EMPLOYEE',
        status: 'ACTIVE',
        organization: { id: 'org-1', name: 'Acme', slug: 'acme', status: 'ACTIVE' }
      }
    ],
    client: 'desktop',
    accessToken,
    refreshToken,
    tokenType: 'Bearer',
    accessTokenExpiresAt: '2026-10-24T10:00:00.000Z',
    refreshTokenExpiresAt: '2026-11-24T10:00:00.000Z',
    expiresIn: 900
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

function createAuth(): { auth: AuthManager; store: MemoryStore } {
  const store = new MemoryStore()
  store.set(REFRESH_TOKEN_KEY, 'refresh-1')
  const auth = new AuthManager(
    'http://tempo.test/api/v1',
    store as unknown as SecureStore
  )
  return { auth, store }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AuthManager.restoreSession', () => {
  it('shares one rotation between concurrent restores and reuses the in-memory session', async () => {
    const { auth, store } = createAuth()
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: payload('access-2', 'refresh-2') })
    )
    vi.stubGlobal('fetch', fetchMock)

    const [first, second] = await Promise.all([auth.restoreSession(), auth.restoreSession()])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(first?.employee.id).toBe('user-1')
    expect(second).toBe(first)
    expect(store.get(REFRESH_TOKEN_KEY)).toBe('refresh-2')

    const third = await auth.restoreSession()
    expect(third).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('clears an invalid refresh token instead of leaving a stale credential', async () => {
    const { auth, store } = createAuth()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          { error: { code: 'REFRESH_TOKEN_INVALID', message: 'Refresh token is invalid.' } },
          401
        )
      )
    )

    await expect(auth.restoreSession()).resolves.toBeNull()
    expect(store.get(REFRESH_TOKEN_KEY)).toBeNull()
  })

  it('keeps the refresh token when the server is unreachable', async () => {
    const { auth, store } = createAuth()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      })
    )

    await expect(auth.restoreSession()).rejects.toBeInstanceOf(NetworkError)
    expect(store.get(REFRESH_TOKEN_KEY)).toBe('refresh-1')
  })

  it('marks only an explicit sign-out as user-initiated', async () => {
    const { auth } = createAuth()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 }))
    )

    await auth.signOut()

    expect(auth.consumeExplicitSignOut()).toBe(true)
    expect(auth.consumeExplicitSignOut()).toBe(false)
  })
})
