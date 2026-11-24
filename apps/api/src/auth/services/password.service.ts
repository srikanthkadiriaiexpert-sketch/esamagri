import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import type { ApiEnv } from '@esamagri/config';

/**
 * Staff password hashing/verification (shared.users.password_hash).
 * bcrypt only — never a hand-rolled scheme, never a reversible one.
 *
 * `verify` always runs a bcrypt.compare, even for an unknown username
 * (StaffAuthService passes a fixed local dummy hash in that case) so
 * that "unknown username" and "known username, wrong password" take
 * the same amount of time — a timing side channel is otherwise a valid
 * account-enumeration vector even though the eventual HTTP response is
 * the same INVALID_CREDENTIALS in both cases.
 */
@Injectable()
export class PasswordService {
  // A real bcrypt hash of a fixed, never-used-elsewhere placeholder
  // value, generated once ahead of time (NOT derived from any secret
  // and NOT sensitive — it is only ever compared against, never
  // treated as a real credential). Used solely so a compare always
  // costs one real bcrypt round even when there is no account to check
  // it against.
  private static readonly DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEeOxsFRp0J8fPTGkKvA/OF.Dj9y5aJIe.q';

  constructor(@Inject(ConfigService) private readonly config: ConfigService<ApiEnv, true>) {}

  async hash(plaintext: string): Promise<string> {
    const rounds = this.config.get('BCRYPT_SALT_ROUNDS', { infer: true });
    return bcrypt.hash(plaintext, rounds);
  }

  async verify(plaintext: string, hash: string | null): Promise<boolean> {
    return bcrypt.compare(plaintext, hash ?? PasswordService.DUMMY_HASH);
  }

  /** Explicit alias for the "no such account" branch — see class doc. */
  async verifyAgainstDummy(plaintext: string): Promise<void> {
    await bcrypt.compare(plaintext, PasswordService.DUMMY_HASH);
  }
}
