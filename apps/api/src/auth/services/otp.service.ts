import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt, createHmac, timingSafeEqual } from 'node:crypto';
import type { ApiEnv } from '@esamagri/config';

/**
 * OTP code generation and hashing (shared.otp_requests.otp_hash).
 *
 * The code itself is never stored — only HMAC-SHA256(pepper, code),
 * where the pepper (OTP_HASH_PEPPER) lives only in server config, never
 * in the database. This is a deliberate step up from a bare hash: a
 * leaked otp_requests row alone (no pepper) is not enough to recover or
 * brute-force-verify a code offline, unlike a plain SHA-256(code) which
 * an attacker with a code-space (6 digits = 1e6) could brute force in
 * a leaked-DB scenario. HMAC also fits `shared.otp_requests.otp_hash
 * text` (migration 0004) with no schema change.
 *
 * The generator itself (`generate`) is separated out from `hash`/
 * `verify` so tests can inject a fixed code deterministically without
 * touching the CSPRNG path, while the CSPRNG path itself (randomInt)
 * is exercised by the "generates a 6-digit code" unit test.
 */
@Injectable()
export class OtpService {
  constructor(@Inject(ConfigService) private readonly config: ConfigService<ApiEnv, true>) {}

  /** A cryptographically random 6-digit code, zero-padded. */
  generateCode(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  hashCode(code: string): string {
    const pepper = this.config.get('OTP_HASH_PEPPER', { infer: true });
    return createHmac('sha256', pepper).update(code).digest('hex');
  }

  /** Constant-time comparison against the stored hash — never `===`. */
  verifyCode(code: string, storedHash: string): boolean {
    const candidate = Buffer.from(this.hashCode(code), 'hex');
    const stored = Buffer.from(storedHash, 'hex');
    if (candidate.length !== stored.length) {
      // timingSafeEqual requires equal-length buffers; a length
      // mismatch can only mean a malformed/foreign stored hash, never a
      // real OTP hash produced by this service — treat as no-match
      // without leaking which branch was taken via an exception.
      return false;
    }
    return timingSafeEqual(candidate, stored);
  }

  ttlSeconds(): number {
    return this.config.get('OTP_TTL_SECONDS', { infer: true });
  }

  maxAttempts(): number {
    return this.config.get('OTP_MAX_ATTEMPTS', { infer: true });
  }

  requestWindowSeconds(): number {
    return this.config.get('OTP_REQUEST_WINDOW_SECONDS', { infer: true });
  }

  requestMaxPerWindow(): number {
    return this.config.get('OTP_REQUEST_MAX_PER_WINDOW', { infer: true });
  }
}
