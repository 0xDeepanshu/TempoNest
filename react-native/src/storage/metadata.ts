import AsyncStorage from '@react-native-async-storage/async-storage';

const DEVICE_ID_KEY = 'temponest.deviceId';
const SELECTED_ORGANIZATION_PREFIX = 'temponest.selectedOrganization.';
const AGENT_METADATA_PREFIX = 'temponest.agent.';

async function readJson<T>(key: string): Promise<T | null> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

export function readDeviceId(): Promise<string | null> {
  return AsyncStorage.getItem(DEVICE_ID_KEY);
}

export function writeDeviceId(deviceId: string): Promise<void> {
  return AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
}

export function readSelectedOrganizationId(userId: string): Promise<string | null> {
  return AsyncStorage.getItem(`${SELECTED_ORGANIZATION_PREFIX}${userId}`);
}

export function writeSelectedOrganizationId(userId: string, organizationId: string): Promise<void> {
  return AsyncStorage.setItem(`${SELECTED_ORGANIZATION_PREFIX}${userId}`, organizationId);
}

export interface StoredAgentMetadata {
  agentId: string;
  deviceId: string;
  userId: string;
  organizationId: string;
  name: string;
  platform: string | null;
  osVersion: string | null;
  appVersion: string | null;
}

function agentMetadataKey(organizationId: string, userId: string): string {
  return `${AGENT_METADATA_PREFIX}${organizationId}.${userId}`;
}

export function readAgentMetadata(
  organizationId: string,
  userId: string,
): Promise<StoredAgentMetadata | null> {
  return readJson<StoredAgentMetadata>(agentMetadataKey(organizationId, userId));
}

export function writeAgentMetadata(metadata: StoredAgentMetadata): Promise<void> {
  return writeJson(agentMetadataKey(metadata.organizationId, metadata.userId), metadata);
}

export function deleteAgentMetadata(organizationId: string, userId: string): Promise<void> {
  return AsyncStorage.removeItem(agentMetadataKey(organizationId, userId));
}
