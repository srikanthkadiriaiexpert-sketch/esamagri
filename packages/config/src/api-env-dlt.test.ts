import { describe, expect, it } from 'vitest';
import { loadApiEnv } from './api-env';

/**
 * The cross-field rule for the DLT identifiers.
 *
 * WHAT THIS DEFENDS: a request missing either identifier is ACCEPTED by
 * the gateway (ErrorCode 000) and then dropped by DLT scrubbing, so the
 * API would record a successful send and no customer would receive a
 * code. Refusing to start is the only honest response.
 */
const base = {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/d',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  OTP_HASH_PEPPER: 'b'.repeat(16),
  CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
  REFRESH_COOKIE_DOMAIN: 'localhost',
};

const withSms = (over: Record<string, string | undefined> = {}) => ({
  ...base,
  OTP_DELIVERY_PROVIDER: 'SMS_GATEWAY_HUB',
  SMS_GATEWAY_HUB_API_KEY: 'test-key',
  SMS_GATEWAY_HUB_SENDER_ID: 'SRILSM',
  SMS_GATEWAY_HUB_ENTITY_ID: '1401311430000081977',
  SMS_GATEWAY_HUB_DLT_TEMPLATE_ID: '1477179481426499954',
  ...over,
});

describe('SMS Gateway Hub DLT identifiers', () => {
  it('accepts a complete configuration and exposes both identifiers', () => {
    const env = loadApiEnv(withSms());
    expect(env.SMS_GATEWAY_HUB_ENTITY_ID).toBe('1401311430000081977');
    expect(env.SMS_GATEWAY_HUB_DLT_TEMPLATE_ID).toBe('1477179481426499954');
  });

  it.each(['SMS_GATEWAY_HUB_ENTITY_ID', 'SMS_GATEWAY_HUB_DLT_TEMPLATE_ID'])(
    'refuses to start when %s is missing',
    (key) => {
      expect(() => loadApiEnv(withSms({ [key]: undefined }))).toThrow(key);
    }
  );

  it.each(['SMS_GATEWAY_HUB_ENTITY_ID', 'SMS_GATEWAY_HUB_DLT_TEMPLATE_ID'])(
    'refuses to start when %s is blank',
    (key) => {
      expect(() => loadApiEnv(withSms({ [key]: '   ' }))).toThrow(key);
    }
  );

  it('rejects a non-numeric identifier', () => {
    expect(() => loadApiEnv(withSms({ SMS_GATEWAY_HUB_DLT_TEMPLATE_ID: '1477-1794-8142' }))).toThrow();
  });

  it('trims a pasted identifier', () => {
    const env = loadApiEnv(withSms({ SMS_GATEWAY_HUB_ENTITY_ID: '  1401311430000081977  ' }));
    expect(env.SMS_GATEWAY_HUB_ENTITY_ID).toBe('1401311430000081977');
  });

  it('accepts an 18-digit id: length is a registry convention, not a documented rule', () => {
    // Deliberate. The 18-digit value that broke this integration was a
    // dropped keystroke, but refusing a validly-issued shorter id would
    // be a worse failure than the one being prevented. Digits-only is
    // the rule; length is not.
    expect(() => loadApiEnv(withSms({ SMS_GATEWAY_HUB_DLT_TEMPLATE_ID: '147719481426499954' }))).not.toThrow();
  });

  it('does not require them when the channel is NONE', () => {
    expect(() =>
      loadApiEnv({ ...base, OTP_DELIVERY_PROVIDER: 'NONE' })
    ).not.toThrow();
  });

  it('never puts an identifier value into the error message', () => {
    try {
      loadApiEnv(withSms({ SMS_GATEWAY_HUB_API_KEY: undefined }));
      throw new Error('expected a throw');
    } catch (err) {
      const text = String(err instanceof Error ? err.message : err);
      expect(text).toContain('SMS_GATEWAY_HUB_API_KEY');
      expect(text).not.toContain('test-key');
      expect(text).not.toContain('1401311430000081977');
    }
  });
});
