import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { apiRequest } from './client';
import { httpJson } from './http';
import type { DesktopAgentSummary, RegisterAgentPayload, ServerEnvelope } from './types';

export interface RegisterMobileAgentInput {
  organizationId: string;
  deviceId: string;
  name: string;
  platform: string;
  osVersion: string | null;
  appVersion: string | null;
}

export async function registerMobileAgent(
  input: RegisterMobileAgentInput,
): Promise<RegisterAgentPayload> {
  const response = await apiRequest<ServerEnvelope<RegisterAgentPayload>>(
    `/organizations/${input.organizationId}/desktop-agents`,
    {
      method: 'POST',
      auth: true,
      body: {
        deviceId: input.deviceId,
        name: input.name,
        platform: input.platform,
        osVersion: input.osVersion ?? undefined,
        appVersion: input.appVersion ?? undefined,
        clientType: 'MOBILE',
      },
      timeoutMs: 20_000,
    },
  );
  return response.data;
}

/** Public credential check. It never creates a user session by itself. */
export async function verifyAgentCredentials(agentId: string, agentKey: string): Promise<void> {
  await httpJson<ServerEnvelope<{ agent: DesktopAgentSummary }>>('/desktop-agents/authenticate', {
    method: 'POST',
    body: { agentId, agentKey },
    timeoutMs: 10_000,
  });
}

export function describeDevice(): { name: string; platform: string; osVersion: string | null; appVersion: string | null } {
  const model = Device.modelName?.trim();
  const platformLabel = Platform.OS === 'ios' ? 'iPhone/iPad' : Platform.OS === 'android' ? 'Android' : 'Web';
  const fallbackName = `TempoNest on ${platformLabel}`;
  const name = (model ? `${model} · TempoNest` : fallbackName).slice(0, 120);
  const appVersion = Constants.expoConfig?.version ?? null;

  return {
    name,
    platform: Platform.OS,
    osVersion: Platform.Version === undefined ? null : String(Platform.Version).slice(0, 80),
    appVersion: appVersion ? appVersion.slice(0, 40) : null,
  };
}
