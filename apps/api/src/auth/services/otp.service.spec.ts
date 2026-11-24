import { ConfigService } from '@nestjs/config';
import type { ApiEnv } from '@esamagri/config';
import { OtpService } from './otp.service';

function testConfig(overrides: Partial<ApiEnv> = {}): ConfigService<ApiEnv, true> {
  const values: Record<string, unknown> = {
    OTP_HASH_PEPPER: 'test-pepper-value-1234',
    OTP_TTL_SECONDS: 300,
    OTP_MAX_ATTEMPTS: 5,
    OTP_REQUEST_WINDOW_SECONDS: 3600,
    OTP_REQUEST_MAX_PER_WINDOW: 5,
    ...overrides,
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService<ApiEnv, true>;
}

describe('OtpService', () => {
  it('generates a 6-digit, zero-padded numeric code', () => {
    const service = new OtpService(testConfig());
    for (let i = 0; i < 50; i++) {
      const code = service.generateCode();
      expect(code).toMatch(/^\d{6}$/);
    }
  });

  it('generated codes are not all identical (exercises the CSPRNG path)', () => {
    const service = new OtpService(testConfig());
    const codes = new Set(Array.from({ length: 20 }, () => service.generateCode()));
    expect(codes.size).toBeGreaterThan(1);
  });

  it('hashCode is deterministic for the same code and pepper', () => {
    const service = new OtpService(testConfig());
    expect(service.hashCode('123456')).toBe(service.hashCode('123456'));
  });

  it('hashCode differs for a different pepper (never logs/derives the pepper itself)', () => {
    const a = new OtpService(testConfig({ OTP_HASH_PEPPER: 'pepper-one-1234' }));
    const b = new OtpService(testConfig({ OTP_HASH_PEPPER: 'pepper-two-1234' }));
    expect(a.hashCode('123456')).not.toBe(b.hashCode('123456'));
  });

  it('the stored hash never equals the plaintext code (never stores plaintext)', () => {
    const service = new OtpService(testConfig());
    expect(service.hashCode('123456')).not.toBe('123456');
  });

  it('verifyCode returns true for the correct code and false for an incorrect one', () => {
    const service = new OtpService(testConfig());
    const hash = service.hashCode('654321');
    expect(service.verifyCode('654321', hash)).toBe(true);
    expect(service.verifyCode('000000', hash)).toBe(false);
  });

  it('verifyCode returns false (not throws) for a malformed/foreign stored hash', () => {
    const service = new OtpService(testConfig());
    expect(() => service.verifyCode('123456', 'not-a-real-hash')).not.toThrow();
    expect(service.verifyCode('123456', 'not-a-real-hash')).toBe(false);
  });

  it('exposes the configured TTL/attempt/rate-limit values', () => {
    const service = new OtpService(
      testConfig({
        OTP_TTL_SECONDS: 120,
        OTP_MAX_ATTEMPTS: 3,
        OTP_REQUEST_WINDOW_SECONDS: 60,
        OTP_REQUEST_MAX_PER_WINDOW: 2,
      })
    );
    expect(service.ttlSeconds()).toBe(120);
    expect(service.maxAttempts()).toBe(3);
    expect(service.requestWindowSeconds()).toBe(60);
    expect(service.requestMaxPerWindow()).toBe(2);
  });
});
