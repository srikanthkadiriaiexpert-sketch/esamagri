import { ConfigService } from '@nestjs/config';
import { Secret, TOTP } from 'otpauth';
import type { ApiEnv } from '@esamagri/config';
import { TotpService } from './totp.service';

function testConfig(issuer = 'e Samagri Test'): ConfigService<ApiEnv, true> {
  return { get: () => issuer } as unknown as ConfigService<ApiEnv, true>;
}

describe('TotpService', () => {
  it('generateSecret returns a base32 secret and a valid otpauth:// URL', () => {
    const service = new TotpService(testConfig());
    const { base32, otpauthUrl } = service.generateSecret('staff:jdoe');
    expect(base32).toMatch(/^[A-Z2-7]+=*$/);
    expect(otpauthUrl.startsWith('otpauth://totp/')).toBe(true);
  });

  it('verify() accepts the current, correctly-computed code for a secret (RFC 6238)', () => {
    const service = new TotpService(testConfig());
    const secret = new Secret({ size: 20 });
    const totp = new TOTP({ algorithm: 'SHA1', digits: 6, period: 30, secret });
    const currentCode = totp.generate();

    expect(service.verify(secret.base32, currentCode)).toBe(true);
  });

  it('verify() rejects an incorrect code', () => {
    const service = new TotpService(testConfig());
    const secret = new Secret({ size: 20 });
    const totp = new TOTP({ algorithm: 'SHA1', digits: 6, period: 30, secret });
    const correctCode = totp.generate();
    const wrongCode = correctCode === '000000' ? '111111' : '000000';

    expect(service.verify(secret.base32, wrongCode)).toBe(false);
  });

  it('verify() rejects a code generated against a different secret', () => {
    const service = new TotpService(testConfig());
    const secretA = new Secret({ size: 20 });
    const secretB = new Secret({ size: 20 });
    const codeForA = new TOTP({ algorithm: 'SHA1', digits: 6, period: 30, secret: secretA }).generate();

    expect(service.verify(secretB.base32, codeForA)).toBe(false);
  });

  it('verify() never throws on malformed input — a non-6-digit token is simply rejected', () => {
    const service = new TotpService(testConfig());
    const secret = new Secret({ size: 20 });
    expect(() => service.verify(secret.base32, 'abc')).not.toThrow();
    expect(service.verify(secret.base32, 'abc')).toBe(false);
    expect(service.verify(secret.base32, '12345')).toBe(false);
  });

  it('verify() never throws on a malformed stored secret', () => {
    const service = new TotpService(testConfig());
    expect(() => service.verify('not-valid-base32!!', '123456')).not.toThrow();
    expect(service.verify('not-valid-base32!!', '123456')).toBe(false);
  });
});
