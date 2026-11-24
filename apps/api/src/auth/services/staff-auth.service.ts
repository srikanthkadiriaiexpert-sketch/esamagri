import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnv } from '@esamagri/config';
import { UsersRepository } from '../../shared/repositories/users.repository';
import { AuditLogRepository } from '../../shared/repositories/audit-log.repository';
import { PasswordService } from './password.service';
import { TotpService } from './totp.service';
import { TokenService, type IssuedSession } from './token.service';

const STAFF_LOGIN_FAILURE = 'STAFF_LOGIN_FAILURE';

export class InvalidCredentialsError extends Error {
  constructor() {
    super('Invalid username or password.');
    this.name = 'InvalidCredentialsError';
  }
}
export class AccountLockedError extends Error {
  constructor() {
    super('This account is temporarily locked due to repeated failed sign-in attempts.');
    this.name = 'AccountLockedError';
  }
}
export class AccountInactiveError extends Error {
  constructor() {
    super('This account is not active.');
    this.name = 'AccountInactiveError';
  }
}
export class TotpRequiredError extends Error {
  constructor() {
    super('A verification code from your authenticator app is required.');
    this.name = 'TotpRequiredError';
  }
}
export class TotpInvalidError extends Error {
  constructor() {
    super('The verification code is incorrect.');
    this.name = 'TotpInvalidError';
  }
}

/**
 * Staff authentication: username + password (bcrypt), plus TOTP for
 * any account with totp_enabled = true (shared.users, frozen schema —
 * no change needed). Session issuance and audit logging both go
 * through the same primitives CustomerAuthService uses.
 *
 * Ordering of checks is deliberate and documented here because it's
 * the whole account-enumeration-safety argument for this service (see
 * STEP 6 report section H):
 *   1. Look up the account. Unknown username -> compare the presented
 *      password against a fixed local dummy hash anyway (timing
 *      parity with a real compare), log a generic failure with
 *      actor_id = NULL, and fail with the SAME InvalidCredentialsError
 *      a wrong password would produce. Nothing before this point
 *      reveals whether the username exists.
 *   2. Known account -> check the brute-force lockout counter BEFORE
 *      attempting the password compare (so a locked account never
 *      even pays the bcrypt cost, and further failed attempts can't
 *      keep extending a legitimate user's lockout indefinitely once
 *      it's already tripped). This step is the one accepted exception
 *      to "never reveal account existence": once lockout triggers, the
 *      distinct AccountLockedError response necessarily confirms the
 *      username is real. That's the industry-standard tradeoff called
 *      out explicitly in this report rather than left implicit.
 *   3. Password compare. Wrong -> log failure (this IS what feeds the
 *      lockout counter), throw InvalidCredentialsError.
 *   4. Only once the password has been proven correct do status
 *      (ACTIVE) and TOTP requirements get checked — AccountInactiveError
 *      and TotpRequiredError/TotpInvalidError are safe to be specific
 *      here because reaching them already required knowing the correct
 *      password, i.e. the caller has already demonstrated they're not
 *      a blind guesser.
 */
@Injectable()
export class StaffAuthService {
  private readonly logger = new Logger(StaffAuthService.name);

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<ApiEnv, true>,
    private readonly users: UsersRepository,
    private readonly auditLog: AuditLogRepository,
    private readonly password: PasswordService,
    private readonly totp: TotpService,
    private readonly tokens: TokenService
  ) {}

  async login(params: {
    username: string;
    password: string;
    totpCode?: string;
    ipAddress: string | null;
    deviceInfo: string | null;
  }): Promise<IssuedSession> {
    const user = await this.users.findByUsername(params.username);

    if (!user) {
      await this.password.verifyAgainstDummy(params.password);
      await this.auditLog.logEvent({
        actorId: null,
        actorRole: 'STAFF',
        module: 'shared',
        action: STAFF_LOGIN_FAILURE,
        entityType: 'shared.users',
        entityId: null,
        after: { reason: 'unknown_username' },
        ipAddress: params.ipAddress,
        deviceInfo: params.deviceInfo,
      });
      throw new InvalidCredentialsError();
    }

    const maxFailures = this.config.get('STAFF_LOGIN_MAX_FAILURES_PER_WINDOW', { infer: true });
    const windowSeconds = this.config.get('STAFF_LOGIN_LOCKOUT_WINDOW_SECONDS', { infer: true });
    const recentFailures = await this.auditLog.countRecentActionsForActor(user.id, STAFF_LOGIN_FAILURE, windowSeconds);
    if (recentFailures >= maxFailures) {
      this.logger.warn(`Staff account ${user.id} locked out after ${recentFailures} recent failed sign-ins`);
      throw new AccountLockedError();
    }

    const passwordOk = await this.password.verify(params.password, user.password_hash);
    if (!passwordOk) {
      await this.auditLog.logEvent({
        actorId: user.id,
        actorRole: 'STAFF',
        module: 'shared',
        action: STAFF_LOGIN_FAILURE,
        entityType: 'shared.users',
        entityId: user.id,
        after: { reason: 'bad_password' },
        ipAddress: params.ipAddress,
        deviceInfo: params.deviceInfo,
      });
      throw new InvalidCredentialsError();
    }

    if (user.status !== 'ACTIVE') {
      throw new AccountInactiveError();
    }

    if (user.totp_enabled) {
      if (!params.totpCode) {
        throw new TotpRequiredError();
      }
      const totpOk = user.totp_secret ? this.totp.verify(user.totp_secret, params.totpCode) : false;
      if (!totpOk) {
        await this.auditLog.logEvent({
          actorId: user.id,
          actorRole: 'STAFF',
          module: 'shared',
          action: STAFF_LOGIN_FAILURE,
          entityType: 'shared.users',
          entityId: user.id,
          after: { reason: 'bad_totp' },
          ipAddress: params.ipAddress,
          deviceInfo: params.deviceInfo,
        });
        throw new TotpInvalidError();
      }
    }

    await this.users.markLoginSuccessful(user.id);

    const session = await this.tokens.issueSession({
      principalType: 'STAFF',
      principalId: user.id,
      ipAddress: params.ipAddress,
      deviceInfo: params.deviceInfo,
    });

    await this.auditLog.logEvent({
      actorId: user.id,
      actorRole: 'STAFF',
      module: 'shared',
      action: 'STAFF_LOGIN_SUCCESS',
      entityType: 'shared.users',
      entityId: user.id,
      ipAddress: params.ipAddress,
      deviceInfo: params.deviceInfo,
    });

    return session;
  }
}
