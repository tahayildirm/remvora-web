import { afterEach, describe, expect, it, vi } from 'vitest';
import { Api } from './api';
describe('API failure classification', () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each([
    [400, 'INVALID_REQUEST'],
    [401, 'UNAUTHORIZED'],
    [429, 'RATE_LIMITED'],
    [503, 'SERVER_ERROR'],
  ])('classifies empty HTTP %s without blaming connectivity', async (status, code) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: Number(status) })));
    await expect(new Api().request('auth/login', 'POST', {})).rejects.toThrow(String(code));
  });
  it('preserves a server error code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"code":"LOGIN_FAILED"}', { status: 401 })),
    );
    await expect(new Api().request('auth/login')).rejects.toThrow('LOGIN_FAILED');
  });
  it('distinguishes network failure from an HTTP response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(new Api().request('auth/login')).rejects.toThrow('NETWORK_ERROR');
  });
});
