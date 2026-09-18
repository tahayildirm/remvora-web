import { apiOrigin, signalingUrl } from './api-endpoint';

describe('Deployment API endpoint', () => {
  afterEach(() => document.querySelector('meta[name="remvora-api-origin"]')?.remove());
  function configure(value: string) {
    const meta = document.createElement('meta');
    meta.name = 'remvora-api-origin';
    meta.content = value;
    document.head.appendChild(meta);
  }
  it('uses the current origin for local development', () => {
    expect(apiOrigin()).toBe(location.origin);
  });
  it('routes API and signaling to the configured HTTPS origin', () => {
    configure('https://api.example.com');
    expect(apiOrigin()).toBe('https://api.example.com');
    expect(signalingUrl()).toBe('wss://api.example.com/ws/browser');
  });
  it('rejects plaintext deployment endpoints', () => {
    configure('http://api.example.com');
    expect(() => apiOrigin()).toThrow('INVALID_API_ORIGIN');
  });
});
