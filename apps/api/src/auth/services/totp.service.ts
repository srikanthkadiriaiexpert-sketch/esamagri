import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Secret, TOTP } from 'otpauth';
import type { ApiEnv } from '@esamagri/config';

/**
 * Staff TOTP (RFC 6238), backed by shared.users.totp_secret /
 * totp_enabled (already present in the frozen Phase 2 schema — no
 * migration needed). Uses the `otpauth` package (single dependency
 * `@noble/hashes`) rather than a hand-rolled HMAC-SHA1 implementation,
 * to keep this security-critical path on an audited library.
 *
 * Secret provisioning (generating + persisting a new totp_secret,
 * turning totp_enabled on) is a staff self-service / admin flow that
 * belongs to a later step's settings UI, not this foundation — this
 * service only provides the primitives (`generateSecret`, `verify`)
 * that flow will call. STEP 6 wires `verify` into StaffAuthService's
 * login path for any account that already has totp_enabled = true.
 */
@Injectable()
export class TotpService {
  constructor(@Inject(ConfigService) private readonly config: ConfigService<ApiEnv, true>) {}

  /** A new random base32 secret, for provisioning (not yet wired to an endpoint in STEP 6). */
  generateSecret(accountLabel: string): { base32: string; otpauthUrl: string } {
    const totp = new TOTP({
      issuer: this.config.get('STAFF_TOTP_ISSUER', { infer: true }),
      label: accountLabel,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: new Secret({ size: 20 }),
    });
    return { base32: totp.secret.base32, otpauthUrl: totp.toString() };
  }

  /**
   * Verifies a 6-digit code against a stored base32 secret, allowing
   * one time-step of clock drift either side (window: 1 — a ~90s
   * effective acceptance window, the standard RFC 6238 tolerance).
   * Never throws on a malformed secret/token — returns false.
   */
  verify(secretBase32: string, token: string): boolean {
    if (!/^\d{6}$/.test(token)) {
      return false;
    }
    try {
      const totp = new TOTP({
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: Secret.fromBase32(secretBase32),
      });
      return totp.validate({ token, window: 1 }) !== null;
    } catch {
      return false;
    }
  }
}
