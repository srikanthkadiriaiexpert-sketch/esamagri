import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import type { ApiEnv } from '@esamagri/config';
import { DatabaseService } from '../../database/database.service';
import {
  AuthSessionsRepository,
  type AuthSessionRecord,
  type PrincipalType,
} from '../../shared/repositories/auth-sessions.repository';
import { AuditLogRepository } from '../../shared/repositories/audit-log.repository';

export interface AccessTokenPrincipal {
  principalType: PrincipalType;
  principalId: string;
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  session: AuthSessionRecord;
}

export class RefreshTokenInvalidError extends Error {
  constructor(message = 'Refresh token is invalid, expired, or revoked.') {
    super(message);
    this.name = 'RefreshTokenInvalidError';
  }
}

/**
 * JWT access-token issuance/verification, plus opaque refresh-token
 * session lifecycle on top of shared.auth_sessions — the "session
 * security" and "authorization foundation" pieces of STEP 6.
 *
 * Access tokens are short-lived JWTs (JWT_ACCESS_TTL, default 15m),
 * identity-only claims (`sub` = principal id, `type` = STAFF|CUSTOMER),
 * never persisted server-side, never carry roles/permissions yet — that
 * is STEP 7's RBAC matrix, deliberately out of scope here per the
 * "authentication identity/context mechanism the RBAC guards will
 * consume, not the full matrix" instruction.
 *
 * Refresh tokens are opaque 256-bit random values, never a JWT (nothing
 * about a refresh token needs to be self-describing — the whole point
 * is that only this server, holding the DB, can turn it into a
 * session). Only SHA-256(token) is ever persisted
 * (shared.auth_sessions.refresh_token_hash); the plaintext value is
 * handed to the client exactly once, as an HttpOnly cookie
 * (AuthController), and never logged.
 *
 * Rotation + reuse detection: every refresh call revokes the presented
 * session and issues a new one in the same `family_id`
 * (replaced_by_id links them). If a token is presented that is already
 * revoked — meaning it was already rotated away once before — that is
 * treated as token theft (the legitimate client would only ever hold
 * the *latest* token in the chain) and the entire family is revoked,
 * forcing re-authentication. This runs inside a single
 * DatabaseService.withTransaction with `SELECT ... FOR UPDATE` on the
 * presented token's row, so two concurrent uses of the same refresh
 * token can't both succeed.
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<ApiEnv, true>,
    private readonly jwt: JwtService,
    private readonly db: DatabaseService,
    private readonly authSessions: AuthSessionsRepository,
    private readonly auditLog: AuditLogRepository
  ) {}

  signAccessToken(principal: AccessTokenPrincipal): string {
    return this.jwt.sign({ sub: principal.principalId, type: principal.principalType });
  }

  /** Returns the verified principal, or null for any invalid/expired/malformed token — never throws. */
  verifyAccessToken(token: string): AccessTokenPrincipal | null {
    try {
      const payload = this.jwt.verify<{ sub: string; type: PrincipalType }>(token);
      if (!payload?.sub || (payload.type !== 'STAFF' && payload.type !== 'CUSTOMER')) {
        return null;
      }
      return { principalId: payload.sub, principalType: payload.type };
    } catch {
      return null;
    }
  }

  /** Issues a brand-new session (fresh family) — used on OTP verify / staff login success. */
  async issueSession(params: {
    principalType: PrincipalType;
    principalId: string;
    ipAddress: string | null;
    deviceInfo: string | null;
  }): Promise<IssuedSession> {
    const refreshToken = this.generateOpaqueToken();
    const refreshTokenHash = this.hashToken(refreshToken);
    const refreshTokenExpiresAt = this.refreshExpiryFromNow();

    const session = await this.authSessions.create({
      principalType: params.principalType,
      principalId: params.principalId,
      familyId: randomUUID(),
      refreshTokenHash,
      expiresAt: refreshTokenExpiresAt,
      ipAddress: params.ipAddress,
      deviceInfo: params.deviceInfo,
    });

    return {
      accessToken: this.signAccessToken({ principalType: params.principalType, principalId: params.principalId }),
      refreshToken,
      refreshTokenExpiresAt,
      session,
    };
  }

  /**
   * Rotates a presented refresh token. Throws RefreshTokenInvalidError
   * for: unknown token, expired token, or a token already revoked
   * through normal rotation. On the specific "already revoked AND has
   * a replaced_by_id" shape — i.e. reuse of a token that was already
   * rotated forward — the whole family is additionally revoked and a
   * REFRESH_TOKEN_REUSE_DETECTED audit event is logged before throwing,
   * so a later legitimate refresh attempt (the true current token, also
   * now revoked) will itself fail closed and force re-authentication.
   *
   * The transaction callback below returns a discriminated outcome
   * instead of throwing RefreshTokenInvalidError directly — the same
   * pattern CustomerAuthService.verifyOtp uses, and for the same
   * reason: DatabaseService.withTransaction (STEP 5, frozen) treats
   * ANY error the callback throws that isn't already a
   * SafeDatabaseError as an unexpected database failure and rewraps it
   * into a generic SafeDatabaseError (by design — it can't tell a
   * deliberate "this token is invalid" from a real driver error). A
   * real-Postgres integration test caught exactly this: throwing
   * RefreshTokenInvalidError from inside the callback surfaced to the
   * caller as SafeDatabaseError instead, which a mocked-withTransaction
   * unit test could not have shown. Returning the outcome and only
   * throwing after the transaction has resolved avoids relying on
   * withTransaction ever seeing a non-database error at all.
   */
  async rotateSession(params: {
    presentedRefreshToken: string;
    ipAddress: string | null;
    deviceInfo: string | null;
  }): Promise<IssuedSession> {
    const presentedHash = this.hashToken(params.presentedRefreshToken);

    const outcome = await this.db.withTransaction<
      { kind: 'invalid'; message?: string } | { kind: 'issued'; session: IssuedSession }
    >(async (client) => {
      const existing = await this.authSessions.findByTokenHashForUpdate(client, presentedHash);

      if (!existing) {
        return { kind: 'invalid' };
      }

      if (existing.revoked_at) {
        if (existing.replaced_by_id) {
          // Reuse of an already-rotated token: theft signal.
          const revokedCount = await this.authSessions.revokeFamily(client, existing.family_id);
          this.logger.warn(
            `Refresh token reuse detected for family ${existing.family_id} (principal ${existing.principal_type}:${existing.principal_id}); revoked ${revokedCount} session(s).`
          );
          await this.auditLog.logEvent({
            actorId: existing.principal_id,
            actorRole: existing.principal_type,
            module: 'shared',
            action: 'REFRESH_TOKEN_REUSE_DETECTED',
            entityType: 'shared.auth_sessions',
            entityId: existing.id,
            after: { familyId: existing.family_id, revokedCount },
            ipAddress: params.ipAddress,
            deviceInfo: params.deviceInfo,
          });
        }
        return { kind: 'invalid' };
      }

      if (existing.expires_at.getTime() <= Date.now()) {
        return { kind: 'invalid', message: 'Refresh token has expired.' };
      }

      const newRefreshToken = this.generateOpaqueToken();
      const newRefreshTokenHash = this.hashToken(newRefreshToken);
      const newExpiresAt = this.refreshExpiryFromNow();

      const newSession = await this.authSessions.create({
        principalType: existing.principal_type,
        principalId: existing.principal_id,
        familyId: existing.family_id,
        refreshTokenHash: newRefreshTokenHash,
        expiresAt: newExpiresAt,
        ipAddress: params.ipAddress,
        deviceInfo: params.deviceInfo,
      });
      await this.authSessions.revoke(client, existing.id, newSession.id);

      return {
        kind: 'issued',
        session: {
          accessToken: this.signAccessToken({
            principalType: existing.principal_type,
            principalId: existing.principal_id,
          }),
          refreshToken: newRefreshToken,
          refreshTokenExpiresAt: newExpiresAt,
          session: newSession,
        },
      };
    });

    if (outcome.kind === 'invalid') {
      throw new RefreshTokenInvalidError(outcome.message);
    }
    return outcome.session;
  }

  /** Logout: revoke just the presented session's family (all devices sharing that refresh chain). */
  async revokeSessionFamily(refreshToken: string): Promise<void> {
    const hash = this.hashToken(refreshToken);
    await this.db.withTransaction(async (client) => {
      const existing = await this.authSessions.findByTokenHashForUpdate(client, hash);
      if (existing) {
        await this.authSessions.revokeFamily(client, existing.family_id);
      }
    });
  }

  /**
   * The refresh cookie's name, which is PER PRINCIPAL TYPE
   * (LAUNCH PREPARATION).
   *
   * WHY THIS IS NOT ONE NAME. Both web apps talk to this one API, so the
   * refresh cookie belongs to the API's own host no matter which host each
   * app is served from. With a single cookie name, a yard clerk who also
   * shops as a resident in the same browser silently signed themselves out
   * of the admin portal by signing in to the shop: the second sign-in
   * simply overwrote the first one's cookie. Two names means two cookies
   * and two sessions that coexist, which is what a person with two roles
   * actually has.
   *
   * Called with no argument it returns the legacy, un-suffixed name, which
   * is still READ (so a session issued before this change is not thrown
   * away) but never written again.
   */
  refreshCookieName(principalType?: 'STAFF' | 'CUSTOMER'): string {
    const base = this.config.get('REFRESH_COOKIE_NAME', { infer: true });
    return principalType === undefined ? base : `${base}_${principalType.toLowerCase()}`;
  }

  refreshCookieDomain(): string {
    return this.config.get('REFRESH_COOKIE_DOMAIN', { infer: true });
  }

  private refreshExpiryFromNow(): Date {
    const days = this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true });
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  private generateOpaqueToken(): string {
    return randomBytes(32).toString('base64url');
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
