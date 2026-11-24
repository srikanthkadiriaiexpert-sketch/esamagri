import { describe, it, expect, afterEach, vi } from 'vitest';
import { ApiError, NetworkError, NotImplementedError } from './client';
import { registrationHandoffFrom, verifyCustomerOtp } from './auth-api';

/**
 * THE WIRE, END TO END: fetch -> apiRequest -> ApiError -> handoff.
 *
 * WHAT THIS GUARDS, AND WHY IT IS SEPARATE FROM THE SCREEN'S TESTS.
 *
 * `ACCOUNT_NOT_REGISTERED` is the one domain error this app returns with HTTP
 * 404, and 404 is ALSO how the API says "no such address" — which `client.ts`
 * turns into `NotImplementedError` so a screen whose backend has not shipped
 * can show a planned-feature state instead of a fault.
 *
 * Those two meanings share a status code, so the ONLY thing keeping them
 * apart is the response body. This file pins that seam from both sides: the
 * real envelope must survive as an ApiError with its nested
 * `details.registrationTicket` intact, and a 404 that is bodyless, HTML, or
 * carrying `ROUTE_NOT_FOUND` must stay a NotImplementedError and must never
 * be mistaken for "please register".
 *
 * It calls the real `apiRequest` through the real `verifyCustomerOtp`, with
 * only `fetch` replaced — so the status handling, the JSON parsing, the
 * ApiError construction and the handoff parser are all the shipped ones.
 *
 * The ticket below is a placeholder of the right shape. No real ticket, OTP,
 * token or number appears in this file.
 */

const TICKET = 'v1.eyJwbGFjZWhvbGRlciI6dHJ1ZX0.AAAABBBBCCCCDDDDEEEEFFFF';

/** Exactly what the global exception filter emits, including correlationId. */
const SERVER_ENVELOPE = {
  code: 'ACCOUNT_NOT_REGISTERED',
  message: 'This number is not registered yet. Please complete your registration.',
  correlationId: '0193aaaa-bbbb-cccc-dddd-eeeeffff0000',
  details: { registrationTicket: TICKET, mobileNumber: '9999999999' },
};

const realFetch = globalThis.fetch;

/** `unparseable` stands in for a proxy's HTML error page. */
function respondWith(status: number, body: unknown, unparseable = false) {
  globalThis.fetch = vi.fn(async () => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => {
      if (unparseable) throw new SyntaxError('Unexpected token < in JSON');
      return body;
    },
  })) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

async function verifyAndCatch(): Promise<unknown> {
  return verifyCustomerOtp('+919999999999', '246813').then(
    (ok) => ok as unknown,
    (err: unknown) => err
  );
}

describe('the server envelope survives the client intact', () => {
  it('becomes an ApiError, not a NotImplementedError', async () => {
    respondWith(404, SERVER_ENVELOPE);
    const err = await verifyAndCatch();
    expect(err).toBeInstanceOf(ApiError);
    expect(err).not.toBeInstanceOf(NotImplementedError);
  });

  it('keeps the code the screen switches on', async () => {
    respondWith(404, SERVER_ENVELOPE);
    const err = (await verifyAndCatch()) as ApiError;
    expect(err.code).toBe('ACCOUNT_NOT_REGISTERED');
    expect(err.status).toBe(404);
  });

  it('keeps `details` at the nesting level the handoff parser reads', async () => {
    // The envelope is flat: code, message, correlationId, details. A future
    // change that wrapped it one level deeper would break the handoff
    // silently, and this is what would catch it.
    respondWith(404, SERVER_ENVELOPE);
    const err = (await verifyAndCatch()) as ApiError;
    expect(Object.keys(err.details ?? {}).sort()).toEqual(['mobileNumber', 'registrationTicket']);
  });

  it('yields a usable handoff — the step that decides whether the app navigates', async () => {
    respondWith(404, SERVER_ENVELOPE);
    const err = (await verifyAndCatch()) as ApiError;
    const handoff = registrationHandoffFrom(err.details);
    expect(handoff).not.toBeNull();
    expect(handoff?.mobileNumber).toBe('9999999999');
    expect(typeof handoff?.registrationTicket).toBe('string');
  });
});

describe('a 404 that is not this domain error stays a missing route', () => {
  it('ROUTE_NOT_FOUND stays NotImplementedError', async () => {
    respondWith(404, { code: 'ROUTE_NOT_FOUND', message: 'Cannot POST /x', correlationId: 'c' });
    expect(await verifyAndCatch()).toBeInstanceOf(NotImplementedError);
  });

  it('a 404 with an HTML body stays NotImplementedError', async () => {
    // What a reverse proxy or a static preview server answers when it has no
    // route for /api — the exact case that must not look like a handoff.
    respondWith(404, null, true);
    expect(await verifyAndCatch()).toBeInstanceOf(NotImplementedError);
  });

  it('a 404 with a JSON body but no code stays NotImplementedError', async () => {
    respondWith(404, { error: 'Not Found', statusCode: 404 });
    expect(await verifyAndCatch()).toBeInstanceOf(NotImplementedError);
  });

  it('none of those produces a handoff', async () => {
    for (const setup of [
      () => respondWith(404, { code: 'ROUTE_NOT_FOUND', message: 'x', correlationId: 'c' }),
      () => respondWith(404, null, true),
      () => respondWith(404, { error: 'Not Found' }),
    ]) {
      setup();
      const err = (await verifyAndCatch()) as { details?: unknown };
      expect(registrationHandoffFrom(err.details)).toBeNull();
    }
  });
});

describe('registrationHandoffFrom refuses anything it cannot use', () => {
  it('needs BOTH the ticket and the number', () => {
    expect(registrationHandoffFrom({ registrationTicket: TICKET })).toBeNull();
    expect(registrationHandoffFrom({ mobileNumber: '9999999999' })).toBeNull();
  });

  it('refuses empty strings, nulls and non-objects', () => {
    expect(registrationHandoffFrom({ registrationTicket: '', mobileNumber: '9999999999' })).toBeNull();
    expect(registrationHandoffFrom({ registrationTicket: TICKET, mobileNumber: '' })).toBeNull();
    expect(registrationHandoffFrom(null)).toBeNull();
    expect(registrationHandoffFrom(undefined)).toBeNull();
    expect(registrationHandoffFrom('v1.a.b')).toBeNull();
  });

  it('refuses a ticket that is not a string, however plausible', () => {
    expect(registrationHandoffFrom({ registrationTicket: 12345, mobileNumber: '9999999999' })).toBeNull();
    expect(
      registrationHandoffFrom({ registrationTicket: { value: TICKET }, mobileNumber: '9999999999' })
    ).toBeNull();
  });
});

describe('other statuses are unchanged by any of this', () => {
  it('a 400 OTP_INVALID is an ordinary ApiError', async () => {
    respondWith(400, { code: 'OTP_INVALID', message: 'The code is incorrect.', correlationId: 'c' });
    const err = (await verifyAndCatch()) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('OTP_INVALID');
  });

  it('a 503 REGISTRATION_UNAVAILABLE is an ordinary ApiError', async () => {
    respondWith(503, {
      code: 'REGISTRATION_UNAVAILABLE',
      message: 'Self-registration is not yet available. Please ask the facility to register you.',
      correlationId: 'c',
    });
    const err = (await verifyAndCatch()) as ApiError;
    expect(err.code).toBe('REGISTRATION_UNAVAILABLE');
    expect(registrationHandoffFrom(err.details)).toBeNull();
  });

  it('a transport failure is a NetworkError, not a 404 of any kind', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    expect(await verifyAndCatch()).toBeInstanceOf(NetworkError);
  });
});
