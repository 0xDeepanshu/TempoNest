import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));

const ORIGINAL = process.env.EXPO_PUBLIC_API_BASE_URL;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL;
  else process.env.EXPO_PUBLIC_API_BASE_URL = ORIGINAL;
  vi.resetModules();
});

async function loadBaseUrl(value: string): Promise<string> {
  vi.resetModules();
  process.env.EXPO_PUBLIC_API_BASE_URL = value;
  const { API_BASE_URL } = await import('./env');
  return API_BASE_URL;
}

describe('API base URL', () => {
  it('resolves the production login URL under /api/v1', async () => {
    const baseUrl = await loadBaseUrl('https://api.workzen.cloud');
    expect(`${baseUrl}/auth/login`).toBe('https://api.workzen.cloud/api/v1/auth/login');
  });

  it('keeps an existing /api/v1 prefix instead of duplicating it', async () => {
    const baseUrl = await loadBaseUrl('https://api.workzen.cloud/api/v1');
    expect(baseUrl).toBe('https://api.workzen.cloud/api/v1');
  });

  it('trims trailing slashes before appending the prefix', async () => {
    const baseUrl = await loadBaseUrl('http://192.168.1.20:4000/');
    expect(baseUrl).toBe('http://192.168.1.20:4000/api/v1');
  });

  it('rejects a non-absolute URL', async () => {
    await expect(loadBaseUrl('api.workzen.cloud')).rejects.toThrow(
      'EXPO_PUBLIC_API_BASE_URL must be an absolute http(s) URL',
    );
  });
});
