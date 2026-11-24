import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { ApiEnv } from '@esamagri/config';
import { DatabaseService } from '../../database/database.service';
import { AuthSessionsRepository, type AuthSessionRecord } from '../../shared/repositories/auth-sessions.repository';
import { AuditLogRepository } from '../../shared/repositories/audit-log.repository';
import { RefreshTokenInvalidError, TokenService } from './token.service';

function testConfig(): ConfigService<ApiEnv, true> {
  const values: Record<string, unknown> = {
    REFRESH_COOKIE_NAME: 'esamagri_rt',
    REFRESH_COOKIE_DOMAIN: 'localhost',
    // Matches the approved policy. The day count is asserted explicitly
    // below rather than left to coincide with whatever the schema default
    // happens to be.
    REFRESH_TOKEN_TTL_DAYS: 365,
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService<ApiEnv, true>;
}

function makeSession(overrides: Partial<AuthSessionRecord> = {}): AuthSessionRecord {
  return {
    id: 'session-1',
    principal_type: 'CUSTOMER',
    principal_id: 'customer-1',
    family_id: 'family-1',
    refresh_token_hash: 'irrelevant-in-mocked-records',
    issued_at: new Date(),
    expires_at: new Date(Date.now() + 1000 * 60 * 60),
    revoked_at: null,
    replaced_by_id: null,
    ip_address: null,
    device_info: null,
    ...overrides,
  };
}

describe('TokenService', () => {
  let jwt: JwtService;
  let db: jest.Mocked<Pick<DatabaseService, 'withTransaction'>>;
  let authSessions: jest.Mocked<AuthSessionsRepository>;
  let auditLog: jest.Mocked<AuditLogRepository>;
  let service: TokenService;

  beforeEach(() => {
    jwt = new JwtService({ secret: 'a'.repeat(32), signOptions: { expiresIn: '15m' } });
    db = { withTransaction: jest.fn((fn: (client: unknown) => unknown) => fn({})) } as never;
    authSessions = {
      create: jest.fn(),
      findByTokenHashForUpdate: jest.fn(),
      findById: jest.fn(),
      revoke: jest.fn(),
      revokeFamily: jest.fn(),
    } as never;
    auditLog = { logEvent: jest.fn(), countRecentActionsForActor: jest.fn() } as never;

    service = new TokenService(
      testConfig(),
      jwt,
      db as unknown as DatabaseService,
      authSessions,
      auditLog
    );
  });

  describe('access tokens', () => {
    it('signs a token whose verified payload round-trips the principal', () => {
      const token = service.signAccessToken({ principalType: 'STAFF', principalId: 'user-42' });
      const principal = service.verifyAccessToken(token);
      expect(principal).toEqual({ principalType: 'STAFF', principalId: 'user-42' });
    });

    it('verifyAccessToken returns null (never throws) for a malformed token', () => {
      expect(() => service.verifyAccessToken('not-a-jwt')).not.toThrow();
      expect(service.verifyAccessToken('not-a-jwt')).toBeNull();
    });

    it('verifyAccessToken returns null for a token signed with a different secret', () => {
      const otherJwt = new JwtService({ secret: 'b'.repeat(32) });
      const foreignToken = otherJwt.sign({ sub: 'customer-1', type: 'CUSTOMER' });
      expect(service.verifyAccessToken(foreignToken)).toBeNull();
    });

    it('verifyAccessToken returns null for an expired token', () => {
      const shortLivedJwt = new JwtService({ secret: 'a'.repeat(32), signOptions: { expiresIn: '-1s' } });
      const shortLivedService = new TokenService(
        testConfig(),
        shortLivedJwt,
        db as unknown as DatabaseService,
        authSessions,
        auditLog
      );
      const token = shortLivedJwt.sign({ sub: 'customer-1', type: 'CUSTOMER' });
      expect(shortLivedService.verifyAccessToken(token)).toBeNull();
    });
  });

  describe('issueSession', () => {
    it('creates a new auth_sessions row and returns a matching access token', async () => {
      authSessions.create.mockResolvedValue(makeSession({ principal_type: 'CUSTOMER', principal_id: 'cust-1' }));

      const issued = await service.issueSession({
        principalType: 'CUSTOMER',
        principalId: 'cust-1',
        ipAddress: '127.0.0.1',
        deviceInfo: 'jest',
      });

      expect(authSessions.create).toHaveBeenCalledWith(
        expect.objectContaining({ principalType: 'CUSTOMER', principalId: 'cust-1' })
      );
      expect(service.verifyAccessToken(issued.accessToken)).toEqual({
        principalType: 'CUSTOMER',
        principalId: 'cust-1',
      });
      // The plaintext refresh token must never equal what's persisted.
      expect(authSessions.create.mock.calls[0][0].refreshTokenHash).not.toBe(issued.refreshToken);
    });

    /**
     * THE ROLLING 365-DAY POLICY, ASSERTED IN DAYS.
     *
     * A number this far from the old 30 would be easy to change back by
     * accident — a merge, a copied .env, a "tidy up the defaults" commit — and
     * the only symptom would be the facility paying for an OTP from every
     * customer a month later. So the expiry is checked against the
     * CONFIGURED day count, in days, rather than against a literal.
     */
    it('sets the refresh expiry to REFRESH_TOKEN_TTL_DAYS from now', async () => {
      authSessions.create.mockResolvedValue(makeSession());
      const before = Date.now();

      const issued = await service.issueSession({
        principalType: 'CUSTOMER',
        principalId: 'cust-1',
        ipAddress: null,
        deviceInfo: null,
      });

      const days = (issued.refreshTokenExpiresAt.getTime() - before) / 86_400_000;
      expect(days).toBeGreaterThan(364.9);
      expect(days).toBeLessThan(365.1);
    });

    it('persists the same expiry it hands back, so the row and the cookie agree', async () => {
      authSessions.create.mockResolvedValue(makeSession());
      const issued = await service.issueSession({
        principalType: 'CUSTOMER',
        principalId: 'cust-1',
        ipAddress: null,
        deviceInfo: null,
      });
      expect(authSessions.create.mock.calls[0][0].expiresAt).toEqual(issued.refreshTokenExpiresAt);
    });

    it('is the SAME mechanism for a RIK officer and a PIF-only resident', async () => {
      // Both are CUSTOMER principals in one table. There is no RIK session
      // and no PIF session — a difference here would be the beginning of two
      // session systems, and of one of them being weaker.
      for (const principalId of ['rik-officer-1', 'pif-only-1']) {
        authSessions.create.mockResolvedValue(makeSession({ principal_id: principalId }));
        const issued = await service.issueSession({
          principalType: 'CUSTOMER',
          principalId,
          ipAddress: null,
          deviceInfo: null,
        });
        const call = authSessions.create.mock.calls.at(-1)![0];
        expect(call.principalType).toBe('CUSTOMER');
        const days = (call.expiresAt.getTime() - Date.now()) / 86_400_000;
        expect(days).toBeGreaterThan(364.9);
        // The access token carries identity only — no RIK claim to inherit.
        expect(Object.keys(service.verifyAccessToken(issued.accessToken) ?? {}).sort()).toEqual([
          'principalId',
          'principalType',
        ]);
      }
    });
  });

  describe('rotateSession', () => {
    it('throws RefreshTokenInvalidError when no session matches the presented token', async () => {
      authSessions.findByTokenHashForUpdate.mockResolvedValue(null);
      await expect(
        service.rotateSession({ presentedRefreshToken: 'nope', ipAddress: null, deviceInfo: null })
      ).rejects.toThrow(RefreshTokenInvalidError);
    });

    it('throws RefreshTokenInvalidError for an expired (but not yet revoked) session', async () => {
      authSessions.findByTokenHashForUpdate.mockResolvedValue(
        makeSession({ expires_at: new Date(Date.now() - 1000) })
      );
      await expect(
        service.rotateSession({ presentedRefreshToken: 'expired', ipAddress: null, deviceInfo: null })
      ).rejects.toThrow(RefreshTokenInvalidError);
    });

    it('rotates a valid session: revokes the old one, links replaced_by_id, issues a new one in the same family', async () => {
      const existing = makeSession({ id: 'old-session', family_id: 'family-xyz' });
      authSessions.findByTokenHashForUpdate.mockResolvedValue(existing);
      authSessions.create.mockResolvedValue(makeSession({ id: 'new-session', family_id: 'family-xyz' }));

      const rotated = await service.rotateSession({
        presentedRefreshToken: 'current-token',
        ipAddress: '127.0.0.1',
        deviceInfo: 'jest',
      });

      expect(authSessions.create).toHaveBeenCalledWith(expect.objectContaining({ familyId: 'family-xyz' }));
      expect(authSessions.revoke).toHaveBeenCalledWith(expect.anything(), 'old-session', 'new-session');
      expect(rotated.session.id).toBe('new-session');
    });

    it('reuse of an already-rotated token revokes the whole family and logs REFRESH_TOKEN_REUSE_DETECTED, then throws', async () => {
      const alreadyRotated = makeSession({
        id: 'stale-session',
        family_id: 'family-stolen',
        revoked_at: new Date(),
        replaced_by_id: 'whatever-came-next',
      });
      authSessions.findByTokenHashForUpdate.mockResolvedValue(alreadyRotated);
      authSessions.revokeFamily.mockResolvedValue(2);

      await expect(
        service.rotateSession({ presentedRefreshToken: 'stolen-and-reused', ipAddress: null, deviceInfo: null })
      ).rejects.toThrow(RefreshTokenInvalidError);

      expect(authSessions.revokeFamily).toHaveBeenCalledWith(expect.anything(), 'family-stolen');
      expect(auditLog.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'REFRESH_TOKEN_REUSE_DETECTED' })
      );
    });

    it('a session revoked through normal rotation (no reuse) is rejected WITHOUT revoking the family again', async () => {
      const normallyRevoked = makeSession({
        id: 'already-used',
        family_id: 'family-normal',
        revoked_at: new Date(),
        replaced_by_id: null, // revoked but not yet linked forward — not the reuse shape
      });
      authSessions.findByTokenHashForUpdate.mockResolvedValue(normallyRevoked);

      await expect(
        service.rotateSession({ presentedRefreshToken: 'already-used-token', ipAddress: null, deviceInfo: null })
      ).rejects.toThrow(RefreshTokenInvalidError);
      expect(authSessions.revokeFamily).not.toHaveBeenCalled();
    });
  });

  describe('the rolling window', () => {
    /**
     * ROLLING, NOT FIXED. This is the difference between "stays signed in for
     * a year" and "stays signed in for a year from first login". A customer
     * who uses the app must never reach an expiry at all, so every rotation
     * has to push it out again — and there is deliberately no absolute cap
     * anywhere for this to be measured against.
     */
    it('a refresh extends the expiry to another full 365 days', async () => {
      const nearlyExpired = makeSession({
        // Eleven months in: the original expiry is a month away.
        expires_at: new Date(Date.now() + 30 * 86_400_000),
      });
      authSessions.findByTokenHashForUpdate.mockResolvedValue(nearlyExpired);
      authSessions.create.mockResolvedValue(makeSession({ id: 'session-2' }));

      const rotated = await service.rotateSession({
        presentedRefreshToken: 'whatever',
        ipAddress: null,
        deviceInfo: null,
      });

      const days = (rotated.refreshTokenExpiresAt.getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(364.9);
      // Not merely later than before — a full year out again.
      expect(rotated.refreshTokenExpiresAt.getTime()).toBeGreaterThan(
        nearlyExpired.expires_at.getTime()
      );
    });

    it('issues a DIFFERENT refresh token on every rotation', async () => {
      authSessions.findByTokenHashForUpdate.mockResolvedValue(makeSession());
      authSessions.create.mockResolvedValue(makeSession({ id: 'session-2' }));
      const first = await service.rotateSession({
        presentedRefreshToken: 'a',
        ipAddress: null,
        deviceInfo: null,
      });
      const second = await service.rotateSession({
        presentedRefreshToken: 'b',
        ipAddress: null,
        deviceInfo: null,
      });
      expect(first.refreshToken).not.toBe(second.refreshToken);
    });
  });

  describe('revokeSessionFamily', () => {
    it('revokes the family of the session matching the presented token', async () => {
      authSessions.findByTokenHashForUpdate.mockResolvedValue(makeSession({ family_id: 'family-logout' }));
      await service.revokeSessionFamily('some-refresh-token');
      expect(authSessions.revokeFamily).toHaveBeenCalledWith(expect.anything(), 'family-logout');
    });

    it('is a no-op (never throws) when the token does not match any session', async () => {
      authSessions.findByTokenHashForUpdate.mockResolvedValue(null);
      await expect(service.revokeSessionFamily('unknown-token')).resolves.toBeUndefined();
      expect(authSessions.revokeFamily).not.toHaveBeenCalled();
    });
  });
});
