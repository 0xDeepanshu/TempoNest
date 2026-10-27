import { Platform } from 'react-native';

const configuredBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();

const defaultDevelopmentBaseUrl =
  Platform.OS === 'android'
    ? 'http://10.0.2.2:4000/api/v1'
    : 'http://localhost:4000/api/v1';

function normalizeBaseUrl(value: string): string {
  const trimmed = value.replace(/\/+$/, '');
  if (!/^https?:\/\/[^/\s]+/i.test(trimmed)) {
    throw new Error(
      'EXPO_PUBLIC_API_BASE_URL must be an absolute http(s) URL, for example http://192.168.1.20:4000/api/v1',
    );
  }
  return trimmed;
}

function resolveBaseUrl(): string {
  if (configuredBaseUrl) return normalizeBaseUrl(configuredBaseUrl);
  if (__DEV__) return defaultDevelopmentBaseUrl;
  throw new Error(
    'EXPO_PUBLIC_API_BASE_URL is required for production builds. Point it at the verified TempoNest API origin.',
  );
}

export const API_BASE_URL = resolveBaseUrl();

export const API_HOST_LABEL = API_BASE_URL.replace(/^https?:\/\//i, '').replace(/\/api\/v1\/?$/i, '');
