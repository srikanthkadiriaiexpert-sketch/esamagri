import { AuthController } from './auth.controller';

/**
 * THE REFRESH COOKIE'S Domain ATTRIBUTE.
 *
 * REFRESH_COOKIE_DOMAIN used to be required and was set to `localhost`.
 * That pins the cookie to one host: a browser refuses a
 * `Domain=localhost` cookie from http://192.168.31.58:5173, so the LAN
 * and kiosk sessions could never refresh. Putting the IP there instead
 * does not help — an IP address is not a legal Domain value — so the
 * only form that serves both is HOST-ONLY: omit the attribute and let
 * the browser bind the cookie to whatever host was asked.
 *
 * "Omit" is the part worth a test. Sending `domain: ''` is NOT the same
 * thing — it emits an empty attribute — and the difference is invisible
 * in review, which is exactly the kind of mistake that reaches staging
 * and presents as "sign-in works on my laptop only".
 *
 * Set and clear are asserted together because a browser matches name,
 * domain and path before it will remove a cookie: if the two drift, a
 * sign-out silently leaves the session cookie in place.
 *
 * No database, no Nest container: the controller is constructed with
 * fakes for exactly the two collaborators these two methods touch.
 */
type CookieCall = { name: string; value: string; options: Record<string, unknown> };

function makeController(configuredDomain: string): {
  controller: AuthController;
  res: { cookie: jest.Mock; clearCookie: jest.Mock };
  calls: { set: CookieCall[]; cleared: CookieCall[] };
} {
  const calls = { set: [] as CookieCall[], cleared: [] as CookieCall[] };

  const res = {
    cookie: jest.fn((name: string, value: string, options: Record<string, unknown>) => {
      calls.set.push({ name, value, options });
    }),
    clearCookie: jest.fn((name: string, options: Record<string, unknown>) => {
      calls.cleared.push({ name, value: '', options });
    }),
  };

  const config = {
    get: (key: string): unknown => (key === 'NODE_ENV' ? 'development' : undefined),
  };

  const tokens = {
    refreshCookieName: (principalType?: string): string =>
      principalType === undefined ? 'esamagri_rt' : `esamagri_rt_${principalType.toLowerCase()}`,
    refreshCookieDomain: (): string => configuredDomain,
  };

  const controller = new AuthController(
    config as never,
    undefined as never,
    undefined as never,
    tokens as never,
    undefined as never
  );

  return { controller, res, calls };
}

const session = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  refreshTokenExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
  session: { principal_type: 'CUSTOMER', principal_id: 'customer-1' },
};

/** Reaches the two private methods without loosening their visibility. */
function respond(controller: AuthController, res: unknown): void {
  (controller as unknown as { respondWithSession: (r: unknown, s: unknown) => unknown })
    .respondWithSession(res, session);
}

function clear(controller: AuthController, res: unknown): void {
  (controller as unknown as { clearRefreshCookie: (r: unknown, n: string) => void })
    .clearRefreshCookie(res, 'esamagri_rt_customer');
}

describe('refresh cookie — Domain attribute', () => {
  describe('when REFRESH_COOKIE_DOMAIN is empty (staging: host-only)', () => {
    it('omits the attribute entirely when setting the cookie', () => {
      const { controller, res, calls } = makeController('');
      respond(controller, res);

      expect(calls.set).toHaveLength(1);
      // Not just undefined — absent. `domain: ''` would emit an empty
      // attribute and would pass a loose `toBeUndefined()` check.
      expect(Object.keys(calls.set[0].options)).not.toContain('domain');
    });

    it('omits the attribute entirely when clearing the cookie', () => {
      const { controller, res, calls } = makeController('');
      clear(controller, res);

      expect(calls.cleared).toHaveLength(1);
      expect(Object.keys(calls.cleared[0].options)).not.toContain('domain');
    });

    it('keeps every other attribute unchanged', () => {
      const { controller, res, calls } = makeController('');
      respond(controller, res);

      const { options } = calls.set[0];
      expect(options.httpOnly).toBe(true);
      // A port is not part of a "site", so the app on :5173 and the API
      // on :3000 are same-site and a Strict cookie still travels.
      expect(options.sameSite).toBe('strict');
      expect(options.path).toBe('/auth');
      // Plain HTTP over the LAN: a Secure cookie would never be sent.
      expect(options.secure).toBe(false);
      expect(options.expires).toEqual(session.refreshTokenExpiresAt);
    });
  });

  describe('when REFRESH_COOKIE_DOMAIN is configured (deployment)', () => {
    it('still sends the attribute, so subdomain sharing is unaffected', () => {
      const { controller, res, calls } = makeController('esamagri.example');
      respond(controller, res);
      expect(calls.set[0].options.domain).toBe('esamagri.example');
    });

    it('sends the same attribute when clearing, so sign-out still matches', () => {
      const { controller, res, calls } = makeController('esamagri.example');
      clear(controller, res);
      expect(calls.cleared[0].options.domain).toBe('esamagri.example');
    });
  });

  it('set and clear present identical attributes apart from expiry', () => {
    // The browser matches name, domain and path before removing a
    // cookie. If these two ever drift, sign-out stops working.
    const { controller, res, calls } = makeController('');
    respond(controller, res);
    clear(controller, res);

    const { expires: _ignored, ...setOptions } = calls.set[0].options;
    expect(calls.cleared[0].options).toEqual(setOptions);
  });
});
