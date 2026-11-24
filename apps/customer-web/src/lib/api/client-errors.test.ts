import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiRequest, ApiError, NetworkError, NotImplementedError } from './client';

/**
 * HOW THIS APP READS A REFUSAL (LAUNCH PREPARATION).
 *
 * WHY THESE TESTS EXIST, specifically. Every screen in this app branches on
 * the difference between "that backend route has not shipped yet" — which
 * should show a calm planned-feature panel — and "something went wrong",
 * which should not. Until the API had a global error filter, those were
 * told apart by an accident: the framework's default 404 body had no `code`
 * field and a real refusal did. Adding the filter gave every error a code
 * and quietly turned every unshipped screen into "Something went wrong",
 * which is exactly the kind of regression nobody notices until a customer
 * sees it. The distinction is now explicit — `ROUTE_NOT_FOUND` for an
 * address that does not exist — and these tests hold it in place.
 */

const okResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    headers: new Headers(),
  }) as unknown as Response;

const errorResponse = (status: number, body: unknown): Response =>
  ({
    ok: false,
    status,
    json: () => (body === undefined ? Promise.reject(new Error('no body')) : Promise.resolve(body)),
    headers: new Headers(),
  }) as unknown as Response;

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a 404 is two different answers', () => {
  it('treats ROUTE_NOT_FOUND as "this screen’s backend has not shipped yet"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        errorResponse(404, {
          code: 'ROUTE_NOT_FOUND',
          message: 'Cannot GET /rik/categories',
          correlationId: 'c0ffee00-0000-4000-8000-000000000000',
        })
      )
    );
    await expect(apiRequest('/rik/categories')).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('treats NOT_FOUND as a real refusal the screen must report', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        errorResponse(404, {
          code: 'NOT_FOUND',
          message: 'That voucher does not exist.',
          correlationId: 'c0ffee00-0000-4000-8000-000000000001',
        })
      )
    );
    const error = await apiRequest('/rik/issue-vouchers/x').catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(404);
    expect((error as ApiError).code).toBe('NOT_FOUND');
  });

  it('still reads an older API, whose unmatched-route 404 carried no code at all', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        errorResponse(404, { statusCode: 404, message: 'Cannot GET /rik/categories' })
      )
    );
    await expect(apiRequest('/rik/categories')).rejects.toBeInstanceOf(NotImplementedError);
  });
});

describe('what every request carries', () => {
  it('tells the API which app is calling, so the right session cookie is read', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await apiRequest('/customer/me');
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)['X-Esamagri-Session']).toBe('customer');
    // And it always sends the cookie, which is how the refresh session works.
    expect(init.credentials).toBe('include');
  });
});

describe('a failure that is not an HTTP response', () => {
  it('becomes a NetworkError rather than an unreadable exception', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(apiRequest('/customer/me')).rejects.toBeInstanceOf(NetworkError);
  });
});
