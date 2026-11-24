import { describe, expect, it } from 'vitest';
import { loadApiEnv } from './api-env';

/**
 * Minimal fixture with every field that has no schema default. Tests
 * mutate a copy of this rather than repeating the full field list.
 */
function validBase(): Record<string, string> {
  return {
    NODE_ENV: 'development',
    PORT: '3000',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/esamagri_dev',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    REFRESH_COOKIE_DOMAIN: 'localhost',
    OTP_HASH_PEPPER: 'b'.repeat(16),
    CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
  };
}

describe('loadApiEnv', () => {
  it('accepts a minimal valid environment and fills in every default', () => {
    const env = loadApiEnv(validBase());
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.DATABASE_SSL).toBe(false);
    expect(env.DATABASE_POOL_MAX).toBe(10);
    expect(env.DATABASE_POOL_MIN).toBe(0);
    expect(env.DATABASE_IDLE_TIMEOUT_MS).toBe(30_000);
    expect(env.DATABASE_CONNECTION_TIMEOUT_MS).toBe(5_000);
    expect(env.DATABASE_STATEMENT_TIMEOUT_MS).toBe(30_000);
    expect(env.JWT_ACCESS_TTL).toBe('15m');
    expect(env.REFRESH_COOKIE_NAME).toBe('esamagri_rt');
    // The approved rolling session policy: one year, extended on every
    // refresh. A default that drifted back to 30 would quietly reintroduce
    // an OTP every month for every customer, which is the cost this policy
    // exists to remove — so the number is asserted, not assumed.
    expect(env.REFRESH_TOKEN_TTL_DAYS).toBe(365);
    expect(env.BCRYPT_SALT_ROUNDS).toBe(12);
    expect(env.OTP_TTL_SECONDS).toBe(300);
    expect(env.OTP_DELIVERY_PROVIDER).toBe('NONE');
    expect(env.STAFF_LOGIN_MAX_FAILURES_PER_WINDOW).toBe(5);
    expect(env.STAFF_LOGIN_LOCKOUT_WINDOW_SECONDS).toBe(900);
    expect(env.PORT).toBe(3000); // coerced to number
  });

  it('coerces DATABASE_SSL="true" to a real boolean, not a truthy string', () => {
    const env = loadApiEnv({ ...validBase(), DATABASE_SSL: 'true' });
    expect(env.DATABASE_SSL).toBe(true);
  });

  it('fails fast, listing every missing required field, when required vars are absent', () => {
    expect(() => loadApiEnv({})).toThrowError(/Refusing to start/);
    try {
      loadApiEnv({});
      expect.unreachable();
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('JWT_ACCESS_SECRET');
      expect(message).toContain('OTP_HASH_PEPPER');
      // The error must describe *shape*, never echo an actual secret value.
      expect(message).not.toContain('postgresql://');
    }
  });

  it('rejects a JWT_ACCESS_SECRET shorter than 32 chars rather than silently truncating/accepting it', () => {
    expect(() => loadApiEnv({ ...validBase(), JWT_ACCESS_SECRET: 'too-short' })).toThrow();
  });

  it('requires WhatsApp credentials once OTP_DELIVERY_PROVIDER=WHATSAPP is selected', () => {
    expect(() =>
      loadApiEnv({ ...validBase(), OTP_DELIVERY_PROVIDER: 'WHATSAPP' })
    ).toThrowError(/WHATSAPP_API_BASE_URL/);
  });

  it('requires the remaining WhatsApp credentials once any one WhatsApp var is set, even without WHATSAPP delivery selected', () => {
    // Guards against a half-configured WhatsApp notification integration
    // (order/status notifications, independent of OTP delivery).
    expect(() =>
      loadApiEnv({ ...validBase(), WHATSAPP_API_TOKEN: 'some-token' })
    ).toThrowError(/WHATSAPP_API_BASE_URL/);
  });

  it('treats empty-string WhatsApp vars as unset, matching apps/api/.env.example\'s `KEY=` placeholders', () => {
    const env = loadApiEnv({
      ...validBase(),
      WHATSAPP_API_BASE_URL: '',
      WHATSAPP_API_TOKEN: '',
      WHATSAPP_BUSINESS_PHONE_NUMBER_ID: '',
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: '',
    });
    expect(env.WHATSAPP_API_BASE_URL).toBeUndefined();
    expect(env.OTP_DELIVERY_PROVIDER).toBe('NONE');
  });

  it('accepts a fully-configured WhatsApp integration', () => {
    const env = loadApiEnv({
      ...validBase(),
      OTP_DELIVERY_PROVIDER: 'WHATSAPP',
      WHATSAPP_API_BASE_URL: 'https://graph.facebook.com/v20.0',
      WHATSAPP_API_TOKEN: 'token',
      WHATSAPP_BUSINESS_PHONE_NUMBER_ID: '1234567890',
    });
    expect(env.OTP_DELIVERY_PROVIDER).toBe('WHATSAPP');
  });

  // ---------------------------------------------------- launch hardening
  //
  // These vars govern whether the API is protected at all, so their
  // DEFAULTS are the thing worth testing: an operator who sets none of them
  // must still get a protected process.

  it('turns rate limiting ON by default outside the test environment', () => {
    const env = loadApiEnv(validBase());
    expect(env.RATE_LIMIT_ENABLED).toBe(true);
    expect(env.RATE_LIMIT_WINDOW_SECONDS).toBe(60);
    expect(env.RATE_LIMIT_AUTH_PER_WINDOW).toBe(20);
    expect(env.RATE_LIMIT_WRITE_PER_WINDOW).toBe(180);
    expect(env.RATE_LIMIT_READ_PER_WINDOW).toBe(900);
  });

  it('turns rate limiting OFF by default under NODE_ENV=test, because the suites flood it', () => {
    const env = loadApiEnv({ ...validBase(), NODE_ENV: 'test' });
    expect(env.RATE_LIMIT_ENABLED).toBe(false);
  });

  it('lets an operator switch it off deliberately, and on deliberately under test', () => {
    expect(loadApiEnv({ ...validBase(), RATE_LIMIT_ENABLED: 'false' }).RATE_LIMIT_ENABLED).toBe(
      false
    );
    expect(
      loadApiEnv({ ...validBase(), NODE_ENV: 'test', RATE_LIMIT_ENABLED: 'true' })
        .RATE_LIMIT_ENABLED
    ).toBe(true);
  });

  it('defaults the request body limit and the import limits', () => {
    const env = loadApiEnv(validBase());
    expect(env.REQUEST_BODY_LIMIT).toBe('256kb');
    expect(env.TRUST_PROXY_HOPS).toBe(0);
    expect(env.PIF_IMPORT_MAX_BYTES).toBe(5_000_000);
    expect(env.PIF_IMPORT_MAX_ROWS).toBe(5_000);
  });

  it('refuses a rate limit that is not a positive number, rather than silently allowing everything', () => {
    expect(() => loadApiEnv({ ...validBase(), RATE_LIMIT_AUTH_PER_WINDOW: '0' })).toThrow();
    expect(() => loadApiEnv({ ...validBase(), RATE_LIMIT_AUTH_PER_WINDOW: 'lots' })).toThrow();
    expect(() => loadApiEnv({ ...validBase(), RATE_LIMIT_WINDOW_SECONDS: '-5' })).toThrow();
  });

  it('refuses an import row limit of zero, which would make every import fail', () => {
    expect(() => loadApiEnv({ ...validBase(), PIF_IMPORT_MAX_ROWS: '0' })).toThrow();
  });
});
