import { ConfigService } from '@nestjs/config';
import type { ApiEnv } from '@esamagri/config';
import { PasswordService } from './password.service';

function testConfig(rounds = 4): ConfigService<ApiEnv, true> {
  // A low round count keeps this test fast — it exercises the same
  // bcrypt code path regardless of cost factor. Production uses
  // BCRYPT_SALT_ROUNDS (default 12) from real config.
  return { get: () => rounds } as unknown as ConfigService<ApiEnv, true>;
}

describe('PasswordService', () => {
  it('hashes a password to something other than the plaintext, and verify() accepts it', async () => {
    const service = new PasswordService(testConfig());
    const hash = await service.hash('correct horse battery staple');
    expect(hash).not.toBe('correct horse battery staple');
    expect(hash.startsWith('$2')).toBe(true); // a real bcrypt hash, never a placeholder
    await expect(service.verify('correct horse battery staple', hash)).resolves.toBe(true);
  });

  it('verify() rejects an incorrect password', async () => {
    const service = new PasswordService(testConfig());
    const hash = await service.hash('the-real-password');
    await expect(service.verify('a-wrong-guess', hash)).resolves.toBe(false);
  });

  it('verify() against a null hash (no such account) compares against the dummy hash and returns false, never throws', async () => {
    const service = new PasswordService(testConfig());
    await expect(service.verify('anything', null)).resolves.toBe(false);
  });

  it('two hashes of the same password are not equal (bcrypt salts every call)', async () => {
    const service = new PasswordService(testConfig());
    const [a, b] = await Promise.all([service.hash('same-password'), service.hash('same-password')]);
    expect(a).not.toBe(b);
  });
});
