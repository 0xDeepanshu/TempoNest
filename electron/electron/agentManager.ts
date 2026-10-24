import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import type { AuthSession } from '../src/types/auth'
import type { BackendAgentRegistration } from './backendTypes'
import type { ApiClient } from './apiClient'
import { ApiError } from './errors'
import type { SecureStore } from './secureStore'

const DEVICE_ID_KEY = 'device.id'
const AGENT_CREDENTIALS_KEY = 'agent.credentials'

export interface AgentCredentials {
  id: string
  key: string
  deviceId: string
  organizationId: string
  userId: string
}

function isCredentials(value: unknown): value is AgentCredentials {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.key === 'string' &&
    typeof candidate.deviceId === 'string' &&
    typeof candidate.organizationId === 'string' &&
    typeof candidate.userId === 'string'
  )
}

/**
 * Registers this installation for the signed-in employee. The raw tna_… key is
 * kept only in safeStorage and is never included in IPC responses.
 */
export class AgentManager {
  constructor(
    private readonly store: SecureStore,
    private readonly client: ApiClient
  ) {}

  getDeviceId(): string {
    const existing = this.store.get(DEVICE_ID_KEY)
    if (existing && existing.length >= 8) return existing

    const created = `temponest-${randomUUID()}`
    this.store.set(DEVICE_ID_KEY, created)
    return created
  }

  getCredentials(): AgentCredentials | null {
    const stored = this.store.getJson<unknown>(AGENT_CREDENTIALS_KEY)
    if (!isCredentials(stored)) {
      this.store.remove(AGENT_CREDENTIALS_KEY)
      return null
    }
    return stored
  }

  async ensureAgent(session: AuthSession, forceRegister = false): Promise<AgentCredentials> {
    const deviceId = this.getDeviceId()
    const existing = this.getCredentials()
    const organizationId = session.membership.organization.id

    if (
      !forceRegister &&
      existing &&
      existing.organizationId === organizationId &&
      existing.userId === session.employee.id &&
      existing.deviceId === deviceId
    ) {
      return existing
    }

    const response = await this.client.request<BackendAgentRegistration>(
      `/organizations/${organizationId}/desktop-agents`,
      {
        method: 'POST',
        body: {
          deviceId,
          name: `${os.hostname()} · TempoNest`,
          platform: process.platform,
          osVersion: os.release(),
          appVersion: app.getVersion()
        }
      }
    )

    const credentials: AgentCredentials = {
      id: response.agent.id,
      key: response.agentKey,
      deviceId,
      organizationId,
      userId: session.employee.id
    }
    this.store.setJson(AGENT_CREDENTIALS_KEY, credentials)
    return credentials
  }

  /**
   * Called once after AGENT_CREDENTIALS_INVALID. Registration for the same
   * stable deviceId rotates the key; it is not an unbounded retry loop.
   */
  async rotateAgent(session: AuthSession): Promise<AgentCredentials> {
    this.forgetAgent()
    return this.ensureAgent(session, true)
  }

  forgetAgent(): void {
    this.store.remove(AGENT_CREDENTIALS_KEY)
  }

  isRevokedError(error: unknown): boolean {
    return error instanceof ApiError && error.code === 'AGENT_REVOKED'
  }
}
