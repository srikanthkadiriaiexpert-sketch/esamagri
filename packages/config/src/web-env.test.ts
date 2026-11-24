import { describe, expect, it } from 'vitest';
import { loadCustomerWebEnv } from './customer-web-env';
import { loadAdminWebEnv } from './admin-web-env';

describe('loadCustomerWebEnv', () => {
  it('accepts a minimal valid environment and fills in defaults', () => {
    const env = loadCustomerWebEnv({ VITE_API_BASE_URL: 'http://localhost:3000' });
    expect(env.VITE_APP_NAME).toBe('e Samagri');
    expect(env.VITE_ENVIRONMENT).toBe('development');
  });

  it('fails fast when VITE_API_BASE_URL is missing or not a URL', () => {
    expect(() => loadCustomerWebEnv({})).toThrow();
    expect(() => loadCustomerWebEnv({ VITE_API_BASE_URL: 'not-a-url' })).toThrow();
  });

  it('accepts a same-origin path, so one build serves localhost and a LAN address', () => {
    // The dev server (and, deployed, the reverse proxy) forwards /api to
    // the API, so the browser never leaves the origin it was loaded from
    // and the refresh cookie binds to the host the person actually typed.
    expect(loadCustomerWebEnv({ VITE_API_BASE_URL: '/api' }).VITE_API_BASE_URL).toBe('/api');
    expect(loadCustomerWebEnv({ VITE_API_BASE_URL: '/internal/api' }).VITE_API_BASE_URL).toBe(
      '/internal/api'
    );
  });

  it('rejects a relative-looking value that is really another origin', () => {
    // `//evil.example` reads as a protocol-relative URL, not a path: every
    // API call and the access token on it would leave for a host nobody
    // configured. This assertion is what keeps the relaxed rule safe.
    expect(() => loadCustomerWebEnv({ VITE_API_BASE_URL: '//evil.example' })).toThrow();
    expect(() => loadCustomerWebEnv({ VITE_API_BASE_URL: '//evil.example/api' })).toThrow();
  });

  it('rejects the two forms that would compose into a broken request path', () => {
    // Callers build `${base}${path}` and path already starts with "/".
    // A bare "/" gives "//auth/refresh" — protocol-relative by accident —
    // and a trailing slash gives "/api//auth/refresh".
    expect(() => loadCustomerWebEnv({ VITE_API_BASE_URL: '/' })).toThrow();
    expect(() => loadCustomerWebEnv({ VITE_API_BASE_URL: '/api/' })).toThrow();
  });

  it('still rejects a non-http scheme dressed up as a URL', () => {
    expect(() => loadCustomerWebEnv({ VITE_API_BASE_URL: 'javascript:alert(1)' })).toThrow();
    expect(() => loadCustomerWebEnv({ VITE_API_BASE_URL: 'file:///etc/passwd' })).toThrow();
  });

  it('still accepts the absolute form, which is what deployment uses', () => {
    expect(
      loadCustomerWebEnv({ VITE_API_BASE_URL: 'https://api.esamagri.example' }).VITE_API_BASE_URL
    ).toBe('https://api.esamagri.example');
  });
});

describe('loadAdminWebEnv', () => {
  it('accepts a minimal valid environment and fills in defaults', () => {
    const env = loadAdminWebEnv({ VITE_API_BASE_URL: 'http://localhost:3000' });
    expect(env.VITE_APP_NAME).toBe('e Samagri Admin');
    expect(env.VITE_ENVIRONMENT).toBe('development');
  });

  it('fails fast when VITE_API_BASE_URL is missing or not a URL', () => {
    expect(() => loadAdminWebEnv({})).toThrow();
    expect(() => loadAdminWebEnv({ VITE_API_BASE_URL: 'not-a-url' })).toThrow();
  });
});
