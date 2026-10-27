import * as Crypto from 'expo-crypto';

import {
  describeDevice,
  registerMobileAgent,
  verifyAgentCredentials,
} from '../api/agents';
import { ApiError, NetworkError, describeError, isApiErrorCode } from '../api/errors';
import {
  readAgentKey,
  storeAgentKey,
} from '../auth/tokens';
import {
  readAgentMetadata,
  readDeviceId,
  writeAgentMetadata,
  writeDeviceId,
} from '../storage/metadata';

export interface MobileAgent {
  id: string;
  key: string;
  deviceId: string;
  organizationId: string;
  userId: string;
  name: string;
}

export type MobileAgentErrorCode = 'REVOKED' | 'CLIENT_TYPE_MISMATCH' | 'REGISTRATION_FAILED';

export class MobileAgentError extends Error {
  readonly code: MobileAgentErrorCode;

  constructor(code: MobileAgentErrorCode, message: string) {
    super(message);
    this.name = 'MobileAgentError';
    this.code = code;
  }
}

async function getOrCreateDeviceId(): Promise<string> {
  const existing = await readDeviceId();
  if (existing) return existing;
  const deviceId = Crypto.randomUUID();
  await writeDeviceId(deviceId);
  return deviceId;
}

async function register(
  organizationId: string,
  userId: string,
  deviceId: string,
): Promise<MobileAgent> {
  const device = describeDevice();

  try {
    const payload = await registerMobileAgent({
      organizationId,
      deviceId,
      name: device.name,
      platform: device.platform,
      osVersion: device.osVersion,
      appVersion: device.appVersion,
    });

    if (payload.agent.clientType !== 'MOBILE') {
      throw new MobileAgentError(
        'CLIENT_TYPE_MISMATCH',
        'This device registration is not a mobile device. Contact your TempoNest administrator.',
      );
    }

    await storeAgentKey(organizationId, userId, payload.agentKey);
    await writeAgentMetadata({
      agentId: payload.agent.id,
      deviceId,
      userId,
      organizationId,
      name: payload.agent.name,
      platform: payload.agent.platform,
      osVersion: payload.agent.osVersion,
      appVersion: payload.agent.appVersion,
    });

    return {
      id: payload.agent.id,
      key: payload.agentKey,
      deviceId,
      organizationId,
      userId,
      name: payload.agent.name,
    };
  } catch (error) {
    if (isApiErrorCode(error, 'AGENT_REVOKED')) {
      throw new MobileAgentError(
        'REVOKED',
        'This device was revoked by an administrator. Contact your TempoNest administrator to restore access.',
      );
    }
    if (isApiErrorCode(error, 'AGENT_CLIENT_TYPE_MISMATCH')) {
      throw new MobileAgentError(
        'CLIENT_TYPE_MISMATCH',
        'This device is already registered with a different client type. Contact your TempoNest administrator.',
      );
    }
    if (error instanceof ApiError || error instanceof NetworkError) {
      throw new MobileAgentError('REGISTRATION_FAILED', describeError(error));
    }
    throw error;
  }
}

/**
 * Ensures this installation has a non-revoked MOBILE agent for the signed-in
 * employee. Device provenance is never changed: a revoked identity stays
 * revoked until an administrator restores access on the server.
 */
export async function ensureMobileAgent(
  organizationId: string,
  userId: string,
): Promise<MobileAgent> {
  const metadata = await readAgentMetadata(organizationId, userId);
  const storedKey = await readAgentKey(organizationId, userId);

  if (metadata && storedKey) {
    const storedAgent: MobileAgent = {
      id: metadata.agentId,
      key: storedKey,
      deviceId: metadata.deviceId,
      organizationId,
      userId,
      name: metadata.name,
    };

    try {
      await verifyAgentCredentials(storedAgent.id, storedAgent.key);
      return storedAgent;
    } catch (error) {
      if (isApiErrorCode(error, 'AGENT_REVOKED')) {
        throw new MobileAgentError(
          'REVOKED',
          'This device was revoked by an administrator. Contact your TempoNest administrator to restore access.',
        );
      }
      if (isApiErrorCode(error, 'AGENT_CREDENTIALS_INVALID')) {
        // The installation identity is intact but its key was lost or rotated
        // elsewhere. Re-registering the same deviceId is the documented flow.
        return register(organizationId, userId, metadata.deviceId);
      }
      if (error instanceof NetworkError) {
        return storedAgent;
      }
      if (isApiErrorCode(error, 'RATE_LIMITED')) {
        return storedAgent;
      }
      if (error instanceof ApiError) {
        throw new MobileAgentError('REGISTRATION_FAILED', describeError(error));
      }
      throw error;
    }
  }

  const deviceId = metadata?.deviceId ?? (await getOrCreateDeviceId());
  return register(organizationId, userId, deviceId);
}
