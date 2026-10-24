import type { BackendAuthPayload, BackendMembership } from './backendTypes'
import { ApiClient } from './apiClient'
import { AuthenticationError } from './errors'
import type { AuthSession, OrganizationMembership, SignInCredentials } from '../src/types/auth'
import type { SecureStore } from './secureStore'

const REFRESH_TOKEN_KEY = 'auth.refreshToken'
const LAST_ORGANIZATION_KEY = 'auth.lastOrganizationId'

const AUTH_FAILURE_CODES = new Set([
  'REFRESH_TOKEN_REQUIRED',
  'REFRESH_TOKEN_INVALID',
  'REFRESH_TOKEN_EXPIRED',
  'REFRESH_TOKEN_REUSED',
  'SESSION_REVOKED',
  'AUTH_TOKEN_INVALID',
  'AUTH_TOKEN_EXPIRED',
  'UNAUTHENTICATED'
])

function initialsFor(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

function isActiveMembership(membership: BackendMembership): boolean {
  return (
    membership.status === 'ACTIVE' &&
    membership.organization !== undefined &&
    (membership.organization.status === undefined || membership.organization.status === 'ACTIVE')
  )
}

/**
 * Owns the desktop bearer/refresh pair. The access token lives only in memory;
 * the rotating refresh token is encrypted by safeStorage.
 */
export class AuthManager {
  readonly client: ApiClient
  private accessToken: string | null = null
  private session: AuthSession | null = null
  private refreshPromise: Promise<boolean> | null = null
  private restorePromise: Promise<AuthSession | null> | null = null
  private explicitSignOut = false
  private listeners = new Set<(session: AuthSession | null) => void>()

  constructor(
    baseUrl: string,
    private readonly store: SecureStore
  ) {
    this.client = new ApiClient(
      baseUrl,
      () => this.accessToken,
      () => this.refreshAccessToken()
    )
  }

  getAccessToken(): string | null {
    return this.accessToken
  }

  getSession(): AuthSession | null {
    return this.session
  }

  getOrganizationId(): string | null {
    return this.session?.membership.organization.id ?? null
  }

  getRefreshToken(): string | null {
    return this.store.get(REFRESH_TOKEN_KEY)
  }

  onSessionChanged(listener: (session: AuthSession | null) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.session)
      } catch {
        // A renderer event failure must not break authentication.
      }
    }
  }

  /**
   * Restores the encrypted refresh token on launch. React StrictMode, renderer
   * reloads, and repeated IPC calls can all request a restore concurrently. The
   * refresh token rotates on use, so those calls must share one rotation; two
   * concurrent rotations with the same token would trip the backend's reuse
   * detection and revoke the whole session family.
   */
  restoreSession(): Promise<AuthSession | null> {
    if (this.session) return Promise.resolve(this.session)
    if (!this.restorePromise) {
      this.restorePromise = this.performRestore().finally(() => {
        this.restorePromise = null
      })
    }
    return this.restorePromise
  }

  private async performRestore(): Promise<AuthSession | null> {
    if (this.session) return this.session
    if (!this.store.get(REFRESH_TOKEN_KEY)) return null

    try {
      const refreshed = await this.refreshAccessToken()
      if (!refreshed || !this.session) return null
      this.emit()
      return this.session
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        typeof (error as { code?: unknown }).code === 'string' &&
        AUTH_FAILURE_CODES.has((error as { code: string }).code)
      ) {
        await this.clearLocalSession()
        return null
      }
      throw error
    }
  }

  async signIn(credentials: SignInCredentials): Promise<AuthSession> {
    const email = credentials.email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new AuthenticationError('invalid_email', 'Enter a valid work email address.')
    }
    if (!credentials.password) {
      throw new AuthenticationError('missing_password', 'Enter your password to continue.')
    }

    const payload = await this.client.request<BackendAuthPayload>('/auth/login', {
      method: 'POST',
      authenticated: false,
      body: { email, password: credentials.password, client: 'desktop' }
    })

    await this.applyPayload(payload)
    this.emit()
    return this.session!
  }

  /**
   * True only for the null-session notification caused by an explicit sign-out.
   * Involuntary invalidation keeps the durable offline queue so a pending stop
   * can still be reconciled after the employee signs in again.
   */
  consumeExplicitSignOut(): boolean {
    const explicit = this.explicitSignOut
    this.explicitSignOut = false
    return explicit
  }

  async signOut(): Promise<void> {
    this.explicitSignOut = true
    const refreshToken = this.store.get(REFRESH_TOKEN_KEY)
    try {
      if (this.accessToken || refreshToken) {
        await this.client.request<void>('/auth/logout', {
          method: 'POST',
          authenticated: Boolean(this.accessToken),
          body: refreshToken ? { refreshToken } : undefined,
          retryOnAuthFailure: false
        })
      }
    } catch {
      // Logout is idempotent from the app's point of view; local state is cleared.
    } finally {
      await this.clearLocalSession()
    }
  }

  async refreshAccessToken(): Promise<boolean> {
    if (this.refreshPromise) return this.refreshPromise

    this.refreshPromise = this.performRefresh()
    try {
      return await this.refreshPromise
    } finally {
      this.refreshPromise = null
    }
  }

  private async performRefresh(): Promise<boolean> {
    const refreshToken = this.store.get(REFRESH_TOKEN_KEY)
    if (!refreshToken) {
      await this.clearLocalSession()
      return false
    }

    try {
      const payload = await this.client.request<BackendAuthPayload>('/auth/refresh', {
        method: 'POST',
        authenticated: false,
        retryOnAuthFailure: false,
        body: { refreshToken, client: 'desktop' }
      })
      await this.applyPayload(payload)
      return true
    } catch (error) {
      if (
        error instanceof Error &&
        'status' in error &&
        (error as { status?: unknown }).status === 401
      ) {
        await this.clearLocalSession()
        return false
      }
      if (
        error instanceof Error &&
        'status' in error &&
        (error as { status?: unknown }).status === 403
      ) {
        await this.clearLocalSession()
        return false
      }
      throw error
    }
  }

  /** Called when the API or socket proves the session is no longer valid. */
  async invalidateSession(): Promise<void> {
    await this.clearLocalSession()
  }

  async clearLocalSession(): Promise<void> {
    this.accessToken = null
    this.session = null
    this.store.remove(REFRESH_TOKEN_KEY)
    this.emit()
  }

  private async applyPayload(payload: BackendAuthPayload): Promise<void> {
    const accessToken = payload.accessToken
    const refreshToken = payload.refreshToken
    if (!accessToken || !refreshToken || payload.tokenType !== 'Bearer') {
      throw new AuthenticationError(
        'unavailable',
        'The server returned an unsupported desktop sign-in response.'
      )
    }

    const activeMemberships = payload.memberships.filter(isActiveMembership)
    if (activeMemberships.length === 0) {
      this.store.remove(REFRESH_TOKEN_KEY)
      throw new AuthenticationError(
        'no_membership',
        'This account does not have an active organization membership. Ask your administrator for an invitation.'
      )
    }

    const lastOrganizationId = this.store.get(LAST_ORGANIZATION_KEY)
    const selected =
      activeMemberships.find(
        (membership) => membership.organization.id === lastOrganizationId
      ) ?? activeMemberships[0]

    const mapped = this.mapSession(payload, selected)
    this.store.set(REFRESH_TOKEN_KEY, refreshToken)
    this.store.set(LAST_ORGANIZATION_KEY, selected.organization.id)
    this.accessToken = accessToken
    this.session = mapped
  }

  private mapSession(payload: BackendAuthPayload, membership: BackendMembership): AuthSession {
    const mappedMembership: OrganizationMembership = {
      employeeId: payload.user.id,
      organization: {
        id: membership.organization.id,
        name: membership.organization.name,
        slug: membership.organization.slug
      },
      role:
        membership.role === 'OWNER' || membership.role === 'ADMIN'
          ? 'organization_admin'
          : 'employee'
    }

    return {
      employee: {
        id: payload.user.id,
        organizationId: membership.organization.id,
        name: payload.user.name,
        email: payload.user.email,
        initials: initialsFor(payload.user.name),
        jobTitle: '',
        team: ''
      },
      membership: mappedMembership,
      authenticatedAt: new Date().toISOString()
    }
  }
}
