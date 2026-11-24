import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { setAccessToken, getAccessToken } from './client';
import { refreshSession, requestCustomerOtp, verifyCustomerOtp } from './auth-api';

/**
 * PERSISTENT LOGIN, FROM THE CLIENT'S SIDE.
 *
 * THE POINT OF THE WHOLE POLICY: a customer who opens the app should be
 * signed in already, and the facility should not pay for an SMS to make that
 * happen. These tests pin the two halves of that on the client — the session
 * is restored from the cookie, and NOTHING on the restore path asks for an
 * OTP — plus the storage rule that makes a year-long session acceptable.
 *
 * WHAT IS NOT TESTED HERE, and deliberately: the cookie's own expiry and the
 * rotation behind it are the server's, and are asserted in the API's
 * token.service.spec.ts in days. A frontend test cannot see an HttpOnly
 * cookie at all — which is itself the property being relied on.
 */

const realFetch = globalThis.fetch;

function respond(status: number, body: unknown, capture?: (init: RequestInit) => void) {
  globalThis.fetch = vi.fn(async (_url: unknown, init: RequestInit = {}) => {
    capture?.(init);
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => body,
    };
  }) as unknown as typeof fetch;
}

const SESSION = {
  accessToken: 'header.payload.signature',
  principal: { principalType: 'CUSTOMER', principalId: 'cust-1' },
};

beforeEach(() => {
  setAccessToken(null);
});

afterEach(() => {
  globalThis.fetch = realFetch;
  setAccessToken(null);
  vi.restoreAllMocks();
});

describe('silent restoration on reopening the app', () => {
  it('turns the persistent cookie back into a session with no OTP', async () => {
    respond(200, SESSION);
    const restored = await refreshSession();
    expect(restored.principal.principalType).toBe('CUSTOMER');
    expect(restored.accessToken).toBeTruthy();
  });

  it('SENDS THE COOKIE: the refresh call includes credentials', async () => {
    // Without `credentials: 'include'` the browser withholds the cookie and
    // every reopening becomes a fresh OTP. This is the single line the whole
    // policy rests on from the client side.
    let seen: RequestInit = {};
    respond(200, SESSION, (init) => {
      seen = init;
    });
    await refreshSession();
    expect(seen.credentials).toBe('include');
  });

  it('asks for no OTP anywhere on the restore path', async () => {
    // A tripwire rather than an inspection: if restoring a session ever
    // started calling an OTP route, this records the URL it called.
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (url: unknown) => {
      urls.push(String(url));
      return { status: 200, ok: true, json: async () => SESSION };
    }) as unknown as typeof fetch;

    await refreshSession();

    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('/auth/refresh');
    expect(urls.join(' ')).not.toMatch(/otp/i);
    expect(urls.join(' ')).not.toMatch(/verify/i);
  });

  it('does not chase its own tail — the refresh call skips the 401 retry', async () => {
    // refreshSession passes skipAuthRetry. Without it a 401 from the refresh
    // would trigger another refresh, and a signed-out customer would make
    // the browser loop instead of seeing the login screen.
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      return { status: 401, ok: false, json: async () => ({ code: 'UNAUTHENTICATED' }) };
    }) as unknown as typeof fetch;

    await refreshSession().catch(() => undefined);
    expect(calls).toBe(1);
  });
});

describe('the access token is never written to disk', () => {
  it('lives in memory and in no web storage', async () => {
    respond(200, SESSION);
    const restored = await refreshSession();
    setAccessToken(restored.accessToken);

    expect(getAccessToken()).toBe(restored.accessToken);

    // A year-long session is only acceptable while the credential is not
    // sitting where any script on the page can read it.
    const everything = [
      ...Object.entries(globalThis.localStorage ?? {}),
      ...Object.entries(globalThis.sessionStorage ?? {}),
    ]
      .map(([k, v]) => `${k}=${String(v)}`)
      .join('|');
    expect(everything).not.toContain(restored.accessToken);
    expect(everything).not.toMatch(/accessToken|refreshToken|esamagri_rt/i);
  });

  it('is sent as a bearer header, not as a query parameter', async () => {
    // A token in a URL ends up in history and in every log that records paths.
    let seen: RequestInit = {};
    let seenUrl = '';
    globalThis.fetch = vi.fn(async (url: unknown, init: RequestInit = {}) => {
      seenUrl = String(url);
      seen = init;
      return { status: 200, ok: true, json: async () => ({}) };
    }) as unknown as typeof fetch;

    setAccessToken('header.payload.signature');
    await requestCustomerOtp('+919999999999');

    const headers = (seen.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer header.payload.signature');
    expect(seenUrl).not.toContain('header.payload.signature');
  });
});

describe('OTP is still required when it should be', () => {
  it('a rejected refresh does not quietly produce a session', async () => {
    respond(401, { code: 'REFRESH_TOKEN_INVALID', message: 'no', correlationId: 'c' });
    await expect(refreshSession()).rejects.toBeDefined();
  });

  it('the OTP request route is a different call entirely from refresh', async () => {
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (url: unknown) => {
      urls.push(String(url));
      return { status: 200, ok: true, json: async () => ({ message: 'sent' }) };
    }) as unknown as typeof fetch;

    await requestCustomerOtp('+919999999999');
    expect(urls[0]).toContain('/auth/customer/otp/request');
    expect(urls[0]).not.toContain('/auth/refresh');
  });

  it('verifying an OTP is what establishes a session, and it is a POST', async () => {
    let seen: RequestInit = {};
    respond(200, SESSION, (init) => {
      seen = init;
    });
    const session = await verifyCustomerOtp('+919999999999', '246813');
    expect(seen.method).toBe('POST');
    expect(seen.credentials).toBe('include');
    expect(session.principal.principalType).toBe('CUSTOMER');
  });
});
