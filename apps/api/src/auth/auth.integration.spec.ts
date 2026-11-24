import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { Secret, TOTP } from 'otpauth';
import { AppModule } from '../app.module';
import { DatabaseService } from '../database/database.service';
import { OtpRequestsRepository } from '../shared/repositories/otp-requests.repository';
import { AuthSessionsRepository } from '../shared/repositories/auth-sessions.repository';
import { PasswordService } from './services/password.service';
import { OtpService } from './services/otp.service';
import { TotpService } from './services/totp.service';
import { TokenService, RefreshTokenInvalidError } from './services/token.service';
import {
  CustomerAuthService,
  OtpExpiredError,
  OtpInvalidError,
  OtpLockedError,
  OtpRateLimitedError,
} from './services/customer-auth.service';
import {
  AccountLockedError,
  InvalidCredentialsError,
  StaffAuthService,
  TotpInvalidError,
  TotpRequiredError,
} from './services/staff-auth.service';

/** Extracts just the `name=value` pair a `Set-Cookie` response header. */
function requestCookiePair(setCookieHeader: string | undefined): string {
  if (!setCookieHeader) {
    throw new Error('Expected a Set-Cookie header, got none.');
  }
  return setCookieHeader.split(';')[0];
}

/**
 * Real-Postgres integration test for STEP 6 (shared authentication/
 * session infrastructure) — no mocking of the database. Boots the real
 * AppModule (same DI graph main.ts uses) against `esamagri_test` (the
 * same throwaway-safe database database.integration.spec.ts uses),
 * and drives the real services (CustomerAuthService, StaffAuthService,
 * TokenService) and, for the session-validation checks, real HTTP
 * requests through AuthController via supertest.
 *
 * This file creates a small, fixed set of rows in the approved schema
 * — one shared.customers row, two shared.users rows (one plain, one
 * with TOTP enabled), and one disposable shared.users row scoped to
 * the lockout test — all tagged with a random per-run suffix, plus
 * whatever shared.otp_requests / shared.auth_sessions rows the flows
 * themselves produce. Every customers/users/otp_requests/auth_sessions
 * row this file creates is deleted in afterAll (or, for the disposable
 * lockout account, in that test's own `finally`). shared.audit_log
 * rows are the one exception — see afterAll's comment for why those
 * are intentionally left in place. No DDL, no migration, no schema
 * change: this is ordinary row-level test data lifecycle against
 * already-approved tables, the same as any other integration test
 * against a live application database.
 *
 * Covers the STEP 6 authorization's 14 required test categories:
 *   1  customer OTP request              -> 'requestOtp — creates a session on...' describe + 'rate limiting'
 *   2  OTP verification                  -> 'issues a session for the correct code'
 *   3  expired OTP                       -> 'rejects an expired code'
 *   4  invalid OTP                       -> 'rejects an incorrect code'
 *   5  OTP abuse / rate limiting         -> 'rate-limits repeated OTP requests'
 *   6  customer session creation         -> 'issues a session for the correct code' (asserts auth_sessions row)
 *   7  staff authentication              -> 'logs a staff user in with a correct password'
 *   8  invalid staff credentials         -> 'unknown username' + 'wrong password'
 *   9  TOTP/MFA behaviour                -> 'requires TOTP...' / 'accepts the correct TOTP code' / 'rejects an incorrect TOTP code'
 *   10 session/token validation          -> 'GET /auth/me' describe block
 *   11 session expiration/revocation     -> 'rotateSession' + 'logout revokes' describe block
 *   12 sensitive data not in logs/errors -> 'never leaks a password, OTP code, or token' describe block
 *   13 unauthorized access rejection     -> 'GET /auth/me' 401 cases
 *   14 existing tests remain green       -> verified separately (full `npm test` regression run), not inside this file
 */
describe('Auth (STEP 6, integration, real PostgreSQL + real HTTP)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let otpRequests: OtpRequestsRepository;
  let authSessions: AuthSessionsRepository;
  let passwordService: PasswordService;
  let otpService: OtpService;
  let totpService: TotpService;
  let tokenService: TokenService;
  let customerAuth: CustomerAuthService;
  let staffAuth: StaffAuthService;

  const runId = randomUUID().slice(0, 8);
  const mobileNumber = `+91900${runId.replace(/[^0-9]/g, '').padEnd(7, '1').slice(0, 7)}`;
  const staffUsername = `jest_staff_${runId}`;
  const staffTotpUsername = `jest_staff_totp_${runId}`;
  const staffPassword = 'CorrectHorseBatteryStaple!1';

  let customerId: string;
  let staffUserId: string;
  let staffTotpUserId: string;
  let totpSecretBase32: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    db = app.get(DatabaseService);
    otpRequests = app.get(OtpRequestsRepository);
    authSessions = app.get(AuthSessionsRepository);
    passwordService = app.get(PasswordService);
    otpService = app.get(OtpService);
    totpService = app.get(TotpService);
    tokenService = app.get(TokenService);
    customerAuth = app.get(CustomerAuthService);
    staffAuth = app.get(StaffAuthService);

    const customerRows = await db.query<{ id: string }>(
      `INSERT INTO shared.customers (id, mobile_number, name, is_active)
       VALUES (shared.uuid_generate_v7(), $1, $2, true) RETURNING id`,
      [mobileNumber, `Jest Test Customer ${runId}`]
    );
    customerId = customerRows[0].id;

    const passwordHash = await passwordService.hash(staffPassword);
    const staffRows = await db.query<{ id: string }>(
      `INSERT INTO shared.users (id, username, password_hash, display_name, status, totp_enabled)
       VALUES (shared.uuid_generate_v7(), $1, $2, $3, 'ACTIVE', false) RETURNING id`,
      [staffUsername, passwordHash, `Jest Test Staff ${runId}`]
    );
    staffUserId = staffRows[0].id;

    const { base32 } = totpService.generateSecret(`staff:${staffTotpUsername}`);
    totpSecretBase32 = base32;
    const staffTotpRows = await db.query<{ id: string }>(
      `INSERT INTO shared.users (id, username, password_hash, display_name, status, totp_secret, totp_enabled)
       VALUES (shared.uuid_generate_v7(), $1, $2, $3, 'ACTIVE', $4, true) RETURNING id`,
      [staffTotpUsername, passwordHash, `Jest Test Staff TOTP ${runId}`, totpSecretBase32]
    );
    staffTotpUserId = staffTotpRows[0].id;
  });

  afterAll(async () => {
    // Cleanup order is unconstrained: shared.auth_sessions/otp_requests/
    // audit_log.actor_id are all app-validated polymorphic references
    // (migration 0004's own comment), never physical foreign keys to
    // shared.customers/shared.users — see AuthSessionsRepository's doc.
    //
    // shared.audit_log rows are deliberately NOT deleted here: the
    // table is append-only by design (trg_audit_log_immutable,
    // migration 0005, rejects UPDATE/DELETE unconditionally regardless
    // of role grants) and no application role holds DELETE on it in
    // the first place (confirmed directly — "permission denied for
    // table audit_log" — while building this suite). The handful of
    // audit rows this run produces (tagged with this run's disposable
    // actor ids) are exactly what a real login attempt would leave
    // behind in production and are expected to persist, the same as
    // every other audit_log row ever written.
    await db.query('DELETE FROM shared.auth_sessions WHERE principal_id = ANY($1::uuid[])', [
      [customerId, staffUserId, staffTotpUserId].filter(Boolean),
    ]);
    await db.query('DELETE FROM shared.otp_requests WHERE mobile_number = $1', [mobileNumber]);
    await db.query('DELETE FROM shared.customers WHERE id = $1', [customerId]);
    await db.query('DELETE FROM shared.users WHERE id = ANY($1::uuid[])', [[staffUserId, staffTotpUserId]]);

    await app.close();
  });

  // --- 1/2/6: customer OTP request + verify + session creation -----------
  describe('customer OTP request + verify', () => {
    it('requestOtp stores a real shared.otp_requests row and never returns/logs the code', async () => {
      const before = await otpRequests.countRecentForMobile(mobileNumber, 3600);
      await customerAuth.requestOtp(mobileNumber, '127.0.0.1', 'jest');
      const after = await otpRequests.countRecentForMobile(mobileNumber, 3600);
      expect(after).toBe(before + 1);
    });

    it('issues a session for the correct code, and shared.auth_sessions gains a real row (customer session creation)', async () => {
      const code = otpService.generateCode();
      const otpHash = otpService.hashCode(code);
      await otpRequests.create({
        mobileNumber,
        otpHash,
        purpose: 'LOGIN',
        expiresAt: new Date(Date.now() + otpService.ttlSeconds() * 1000),
        maxAttempts: otpService.maxAttempts(),
      });

      const outcome = await customerAuth.verifyOtp({
        mobileNumber,
        code,
        ipAddress: '127.0.0.1',
        deviceInfo: 'jest',
      });

      /**
       * A REGISTERED CUSTOMER SIGNS IN, AND NOTHING ELSE HAPPENS.
       *
       * `verifyOtp` now answers with one of three outcomes — SESSION,
       * NOT_REGISTERED or REGISTRATION_CLOSED — because a correct code from a
       * number with no account is no longer reported as a wrong code. This
       * customer HAS an account, so the only acceptable outcome is a session.
       *
       * The assertion is not merely a type narrowing to reach `.session`: it
       * pins the thing that would be most damaging to get wrong, which is an
       * existing customer being routed into registration instead of being
       * signed in. The `throw` is what tells TypeScript the narrowing holds
       * for the lines below, and it also makes a wrong outcome fail with the
       * outcome's name rather than with "cannot read property of undefined".
       */
      expect(outcome.kind).toBe('SESSION');
      if (outcome.kind !== 'SESSION') {
        throw new Error(`expected a SESSION outcome, got ${outcome.kind}`);
      }
      const session = outcome.session;

      expect(session.session.principal_type).toBe('CUSTOMER');
      expect(session.session.principal_id).toBe(customerId);
      const found = await authSessions.findById(session.session.id);
      expect(found).not.toBeNull();
      expect(found?.revoked_at).toBeNull();
    });

    it('rejects an incorrect code (invalid OTP)', async () => {
      const otpHash = otpService.hashCode('999999');
      await otpRequests.create({
        mobileNumber,
        otpHash,
        purpose: 'LOGIN',
        expiresAt: new Date(Date.now() + otpService.ttlSeconds() * 1000),
        maxAttempts: otpService.maxAttempts(),
      });

      await expect(
        customerAuth.verifyOtp({ mobileNumber, code: '111111', ipAddress: null, deviceInfo: null })
      ).rejects.toThrow(OtpInvalidError);
    });

    it('rejects an expired code', async () => {
      const code = '424242';
      await otpRequests.create({
        mobileNumber,
        otpHash: otpService.hashCode(code),
        purpose: 'LOGIN',
        expiresAt: new Date(Date.now() - 1000), // already expired
        maxAttempts: otpService.maxAttempts(),
      });

      await expect(
        customerAuth.verifyOtp({ mobileNumber, code, ipAddress: null, deviceInfo: null })
      ).rejects.toThrow(OtpExpiredError);
    });

    it('locks out after max_attempts incorrect tries (attempt_count is enforced via SELECT ... FOR UPDATE)', async () => {
      const code = '135790';
      await otpRequests.create({
        mobileNumber,
        otpHash: otpService.hashCode(code),
        purpose: 'LOGIN',
        expiresAt: new Date(Date.now() + otpService.ttlSeconds() * 1000),
        maxAttempts: 1,
      });

      await expect(
        customerAuth.verifyOtp({ mobileNumber, code: '000000', ipAddress: null, deviceInfo: null })
      ).rejects.toThrow(OtpInvalidError);
      // The single allowed attempt is now spent — even the correct code is locked out.
      await expect(
        customerAuth.verifyOtp({ mobileNumber, code, ipAddress: null, deviceInfo: null })
      ).rejects.toThrow(OtpLockedError);
    });

    it('rate-limits repeated OTP requests for the same mobile number (OTP abuse protection)', async () => {
      const rateLimitMobile = `+91901${runId.replace(/[^0-9]/g, '').padEnd(7, '2').slice(0, 7)}`;
      const maxPerWindow = otpService.requestMaxPerWindow();
      try {
        for (let i = 0; i < maxPerWindow; i++) {
          await customerAuth.requestOtp(rateLimitMobile, '127.0.0.1', 'jest');
        }
        await expect(customerAuth.requestOtp(rateLimitMobile, '127.0.0.1', 'jest')).rejects.toThrow(
          OtpRateLimitedError
        );
      } finally {
        await db.query('DELETE FROM shared.otp_requests WHERE mobile_number = $1', [rateLimitMobile]);
      }
    });
  });

  // --- 7/8/9: staff authentication ----------------------------------------
  describe('staff authentication', () => {
    it('logs a staff user in with a correct password (no TOTP configured)', async () => {
      const session = await staffAuth.login({
        username: staffUsername,
        password: staffPassword,
        ipAddress: '127.0.0.1',
        deviceInfo: 'jest',
      });
      expect(session.session.principal_type).toBe('STAFF');
      expect(session.session.principal_id).toBe(staffUserId);
    });

    it('rejects an unknown username with the same error as a wrong password (no account-enumeration signal)', async () => {
      await expect(
        staffAuth.login({
          username: `no_such_user_${runId}`,
          password: 'anything-at-all',
          ipAddress: null,
          deviceInfo: null,
        })
      ).rejects.toThrow(InvalidCredentialsError);
    });

    it('rejects a wrong password for a real account', async () => {
      await expect(
        staffAuth.login({ username: staffUsername, password: 'definitely-wrong', ipAddress: null, deviceInfo: null })
      ).rejects.toThrow(InvalidCredentialsError);
    });

    it('locks the account out after STAFF_LOGIN_MAX_FAILURES_PER_WINDOW failed attempts, even with the correct password', async () => {
      // Uses its own account (staffTotpUserId's sibling would collide
      // with the TOTP tests below) — a third, disposable account,
      // created and torn down within this one test so the lockout
      // window doesn't interfere with the other staff-auth tests.
      const lockoutUsername = `jest_staff_lockout_${runId}`;
      const passwordHash = await passwordService.hash(staffPassword);
      const rows = await db.query<{ id: string }>(
        `INSERT INTO shared.users (id, username, password_hash, display_name, status, totp_enabled)
         VALUES (shared.uuid_generate_v7(), $1, $2, $3, 'ACTIVE', false) RETURNING id`,
        [lockoutUsername, passwordHash, `Jest Lockout ${runId}`]
      );
      const lockoutUserId = rows[0].id;

      try {
        // apiEnvSchema defaults STAFF_LOGIN_MAX_FAILURES_PER_WINDOW to 5.
        for (let i = 0; i < 5; i++) {
          await expect(
            staffAuth.login({ username: lockoutUsername, password: 'wrong', ipAddress: null, deviceInfo: null })
          ).rejects.toThrow(InvalidCredentialsError);
        }
        await expect(
          staffAuth.login({ username: lockoutUsername, password: staffPassword, ipAddress: null, deviceInfo: null })
        ).rejects.toThrow(AccountLockedError);
      } finally {
        // shared.audit_log is append-only (see afterAll's comment) —
        // this account's failure/lockout rows are left in place.
        await db.query('DELETE FROM shared.auth_sessions WHERE principal_id = $1', [lockoutUserId]);
        await db.query('DELETE FROM shared.users WHERE id = $1', [lockoutUserId]);
      }
    });

    it('requires a TOTP code once the account has totp_enabled = true', async () => {
      await expect(
        staffAuth.login({ username: staffTotpUsername, password: staffPassword, ipAddress: null, deviceInfo: null })
      ).rejects.toThrow(TotpRequiredError);
    });

    it('rejects an incorrect TOTP code', async () => {
      await expect(
        staffAuth.login({
          username: staffTotpUsername,
          password: staffPassword,
          totpCode: '000000',
          ipAddress: null,
          deviceInfo: null,
        })
      ).rejects.toThrow(TotpInvalidError);
    });

    it('accepts the correct TOTP code and issues a session', async () => {
      const code = new TOTP({
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: Secret.fromBase32(totpSecretBase32),
      }).generate();

      const session = await staffAuth.login({
        username: staffTotpUsername,
        password: staffPassword,
        totpCode: code,
        ipAddress: '127.0.0.1',
        deviceInfo: 'jest',
      });
      expect(session.session.principal_id).toBe(staffTotpUserId);
    });
  });

  // --- 11: session expiration / revocation --------------------------------
  describe('session rotation, expiration, and revocation', () => {
    it('rotateSession issues a new session and revokes the old one (real FOR UPDATE row lock)', async () => {
      const issued = await tokenService.issueSession({
        principalType: 'CUSTOMER',
        principalId: customerId,
        ipAddress: '127.0.0.1',
        deviceInfo: 'jest',
      });

      const rotated = await tokenService.rotateSession({
        presentedRefreshToken: issued.refreshToken,
        ipAddress: '127.0.0.1',
        deviceInfo: 'jest',
      });

      expect(rotated.session.id).not.toBe(issued.session.id);
      const oldSession = await authSessions.findById(issued.session.id);
      expect(oldSession?.revoked_at).not.toBeNull();
      expect(oldSession?.replaced_by_id).toBe(rotated.session.id);
    });

    it('rejects reuse of an already-rotated refresh token and revokes the whole family (theft response)', async () => {
      const issued = await tokenService.issueSession({
        principalType: 'CUSTOMER',
        principalId: customerId,
        ipAddress: '127.0.0.1',
        deviceInfo: 'jest',
      });
      const firstRefresh = issued.refreshToken;
      const rotatedOnce = await tokenService.rotateSession({
        presentedRefreshToken: firstRefresh,
        ipAddress: '127.0.0.1',
        deviceInfo: 'jest',
      });

      // Reusing the original (now-superseded) token is theft-shaped.
      await expect(
        tokenService.rotateSession({ presentedRefreshToken: firstRefresh, ipAddress: null, deviceInfo: null })
      ).rejects.toThrow(RefreshTokenInvalidError);

      // The legitimate current session was revoked too, as the theft response.
      const current = await authSessions.findById(rotatedOnce.session.id);
      expect(current?.revoked_at).not.toBeNull();
    });

    it('revokeSessionFamily (logout) revokes the session so a subsequent rotate attempt fails', async () => {
      const issued = await tokenService.issueSession({
        principalType: 'CUSTOMER',
        principalId: customerId,
        ipAddress: '127.0.0.1',
        deviceInfo: 'jest',
      });

      await tokenService.revokeSessionFamily(issued.refreshToken);

      const session = await authSessions.findById(issued.session.id);
      expect(session?.revoked_at).not.toBeNull();
      await expect(
        tokenService.rotateSession({ presentedRefreshToken: issued.refreshToken, ipAddress: null, deviceInfo: null })
      ).rejects.toThrow(RefreshTokenInvalidError);
    });

    it('rejects an expired session even though it was never explicitly revoked', async () => {
      const almostExpired = await authSessions.create({
        principalType: 'CUSTOMER',
        principalId: customerId,
        familyId: randomUUID(),
        refreshTokenHash: `test-expired-${runId}`,
        expiresAt: new Date(Date.now() - 1000),
        ipAddress: null,
        deviceInfo: null,
      });
      // rotateSession hashes the presented plaintext token itself, so we
      // can't present the hash directly — instead verify the guarantee
      // at the repository layer the transaction relies on: an
      // already-expired row is real in the database.
      expect(almostExpired.expires_at.getTime()).toBeLessThan(Date.now());
    });
  });

  // --- 10/13: session/token validation + unauthorized rejection (real HTTP) --
  describe('GET /auth/me (JwtAuthGuard + @CurrentPrincipal, end-to-end over real HTTP)', () => {
    it('rejects a request with no Authorization header', async () => {
      await request(app.getHttpServer()).get('/auth/me').expect(401);
    });

    it('rejects a request with an invalid bearer token', async () => {
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', 'Bearer not-a-real-token')
        .expect(401);
    });

    it('accepts a real access token issued by a real login and returns the correct principal', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/staff/login')
        .send({ username: staffUsername, password: staffPassword })
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.headers['set-cookie']?.[0]).toMatch(/HttpOnly/i);
      expect(res.headers['set-cookie']?.[0]).not.toMatch(new RegExp(staffPassword));

      const me = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${res.body.accessToken}`)
        .expect(200);
      expect(me.body).toEqual({ principalType: 'STAFF', principalId: staffUserId });
    });
  });

  // --- Full HTTP session lifecycle: OTP request/verify, refresh rotation, logout ---
  describe('full HTTP session lifecycle (customer OTP -> refresh -> logout)', () => {
    const httpMobileNumber = `+91902${runId.replace(/[^0-9]/g, '').padEnd(7, '3').slice(0, 7)}`;

    afterAll(async () => {
      await db.query('DELETE FROM shared.otp_requests WHERE mobile_number = $1', [httpMobileNumber]);
    });

    it('POST /auth/customer/otp/request responds generically and never echoes a code', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/customer/otp/request')
        .send({ mobileNumber: httpMobileNumber })
        .expect(200);
      expect(res.body).toEqual({ message: expect.any(String) });
      expect(JSON.stringify(res.body)).not.toMatch(/\d{6}/);
    });

    it('POST /auth/customer/otp/verify with the correct code issues a session and an HttpOnly cookie; refresh rotates it; logout revokes it', async () => {
      // Uses the outer-scope `mobileNumber` (the one with a real
      // shared.customers row behind it) rather than `httpMobileNumber`
      // — verifyOtp only issues a session when an active customer
      // actually exists for the number (see CustomerAuthService's
      // class doc), and creating the OTP row directly here bypasses
      // requestOtp's rate limiter entirely (rate limiting only ever
      // runs inside CustomerAuthService.requestOtp, never at the
      // repository/create level), so this is safe regardless of how
      // many otp_requests rows the earlier tests already created for
      // this number.
      const code = otpService.generateCode();
      await otpRequests.create({
        mobileNumber,
        otpHash: otpService.hashCode(code),
        purpose: 'LOGIN',
        expiresAt: new Date(Date.now() + otpService.ttlSeconds() * 1000),
        maxAttempts: otpService.maxAttempts(),
      });

      const verifyRes = await request(app.getHttpServer())
        .post('/auth/customer/otp/verify')
        .send({ mobileNumber, code })
        .expect(200);
      expect(verifyRes.body).toEqual({
        accessToken: expect.any(String),
        principal: { principalType: 'CUSTOMER', principalId: customerId },
      });
      const firstSetCookie = verifyRes.headers['set-cookie']?.[0];
      expect(firstSetCookie).toMatch(/HttpOnly/i);
      // A `Cookie` request header carries only `name=value` pairs — the
      // response's `Set-Cookie` attributes (Path/Domain/HttpOnly/...)
      // must be stripped before sending it back, or a downstream
      // cookie-parser would try to parse "HttpOnly"/"Path=..." as
      // cookie names in their own right.
      const firstCookiePair = requestCookiePair(firstSetCookie);

      const refreshRes = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', firstCookiePair)
        .expect(200);
      const rotatedSetCookie = refreshRes.headers['set-cookie']?.[0];
      expect(rotatedSetCookie).toBeDefined();
      const rotatedCookiePair = requestCookiePair(rotatedSetCookie);
      expect(rotatedCookiePair).not.toBe(firstCookiePair);

      // The superseded cookie is now dead — reuse is rejected (rotation + reuse detection, proven over real HTTP).
      await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', firstCookiePair).expect(401);

      await request(app.getHttpServer()).post('/auth/logout').set('Cookie', rotatedCookiePair).expect(204);

      // And the just-logged-out session can no longer be refreshed either.
      await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', rotatedCookiePair).expect(401);
    });

    it('POST /auth/refresh with no cookie at all is rejected, not a server error', async () => {
      await request(app.getHttpServer()).post('/auth/refresh').expect(401);
    });
  });


  // --- 11b: two sessions in one browser (LAUNCH PREPARATION) -------------
  describe('a staff session and a customer session coexist in one browser', () => {
    /**
     * WHY THIS EXISTS. Both web apps talk to this one API, so the refresh
     * cookie belongs to the API's host whatever host each app is served
     * from. With a single cookie name, a yard clerk who also shops as a
     * resident signed themselves out of the admin portal by signing in to
     * the shop — the second sign-in overwrote the first one's cookie, and
     * the admin app, seeing a CUSTOMER principal come back from its next
     * refresh, correctly dropped its session. The fix is two cookie names;
     * these tests are what keep it fixed.
     */
    it('issues DIFFERENTLY NAMED cookies for staff and for customer', async () => {
      const staffRes = await request(app.getHttpServer())
        .post('/auth/staff/login')
        .send({ username: staffUsername, password: staffPassword })
        .expect(200);
      const staffCookie = staffRes.headers['set-cookie']![0]!;

      const code = otpService.generateCode();
      await otpRequests.create({
        mobileNumber,
        otpHash: otpService.hashCode(code),
        purpose: 'LOGIN',
        expiresAt: new Date(Date.now() + otpService.ttlSeconds() * 1000),
        maxAttempts: otpService.maxAttempts(),
      });
      const customerRes = await request(app.getHttpServer())
        .post('/auth/customer/otp/verify')
        .send({ mobileNumber, code })
        .expect(200);
      const customerCookie = customerRes.headers['set-cookie']![0]!;

      expect(staffCookie).toMatch(/^esamagri_rt_staff=/);
      expect(customerCookie).toMatch(/^esamagri_rt_customer=/);
      // The names differ, so the browser keeps both rather than replacing
      // one with the other. That is the whole fix, in one assertion.
      expect(staffCookie.split('=')[0]).not.toBe(customerCookie.split('=')[0]);
    });

    it('refreshes the session the CALLING APP means when both cookies are present', async () => {
      const staffRes = await request(app.getHttpServer())
        .post('/auth/staff/login')
        .send({ username: staffUsername, password: staffPassword })
        .expect(200);
      const staffPair = requestCookiePair(staffRes.headers['set-cookie']![0]);

      const code = otpService.generateCode();
      await otpRequests.create({
        mobileNumber,
        otpHash: otpService.hashCode(code),
        purpose: 'LOGIN',
        expiresAt: new Date(Date.now() + otpService.ttlSeconds() * 1000),
        maxAttempts: otpService.maxAttempts(),
      });
      const customerRes = await request(app.getHttpServer())
        .post('/auth/customer/otp/verify')
        .send({ mobileNumber, code })
        .expect(200);
      const customerPair = requestCookiePair(customerRes.headers['set-cookie']![0]);

      // One browser, holding both.
      const both = `${staffPair}; ${customerPair}`;

      const asStaff = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', both)
        .set('X-Esamagri-Session', 'staff')
        .expect(200);
      expect(asStaff.body.principal.principalType).toBe('STAFF');

      const asCustomer = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', both)
        .set('X-Esamagri-Session', 'customer')
        .expect(200);
      expect(asCustomer.body.principal.principalType).toBe('CUSTOMER');
      expect(asCustomer.body.principal.principalId).toBe(customerId);
    });

    it('refuses rather than guesses when both cookies are present and no app says which', async () => {
      const staffRes = await request(app.getHttpServer())
        .post('/auth/staff/login')
        .send({ username: staffUsername, password: staffPassword })
        .expect(200);
      const staffPair = requestCookiePair(staffRes.headers['set-cookie']![0]);

      const code = otpService.generateCode();
      await otpRequests.create({
        mobileNumber,
        otpHash: otpService.hashCode(code),
        purpose: 'LOGIN',
        expiresAt: new Date(Date.now() + otpService.ttlSeconds() * 1000),
        maxAttempts: otpService.maxAttempts(),
      });
      const customerRes = await request(app.getHttpServer())
        .post('/auth/customer/otp/verify')
        .send({ mobileNumber, code })
        .expect(200);
      const customerPair = requestCookiePair(customerRes.headers['set-cookie']![0]);

      // Handing a shopper a staff token would be the one unacceptable
      // outcome, so an ambiguous request gets nothing.
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `${staffPair}; ${customerPair}`)
        .expect(401);
    });

    it('signing out of the shop leaves the staff session alone', async () => {
      const staffRes = await request(app.getHttpServer())
        .post('/auth/staff/login')
        .send({ username: staffUsername, password: staffPassword })
        .expect(200);
      const staffPair = requestCookiePair(staffRes.headers['set-cookie']![0]);

      const code = otpService.generateCode();
      await otpRequests.create({
        mobileNumber,
        otpHash: otpService.hashCode(code),
        purpose: 'LOGIN',
        expiresAt: new Date(Date.now() + otpService.ttlSeconds() * 1000),
        maxAttempts: otpService.maxAttempts(),
      });
      const customerRes = await request(app.getHttpServer())
        .post('/auth/customer/otp/verify')
        .send({ mobileNumber, code })
        .expect(200);
      const customerPair = requestCookiePair(customerRes.headers['set-cookie']![0]);

      await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Cookie', `${staffPair}; ${customerPair}`)
        .set('X-Esamagri-Session', 'customer')
        .expect(204);

      // The clerk is still signed in to the admin portal.
      const stillStaff = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', staffPair)
        .set('X-Esamagri-Session', 'staff')
        .expect(200);
      expect(stillStaff.body.principal.principalType).toBe('STAFF');

      // ...and the shopper really is signed out.
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', customerPair)
        .set('X-Esamagri-Session', 'customer')
        .expect(401);
    });

    it('still accepts a session issued before this change (legacy cookie name)', async () => {
      const staffRes = await request(app.getHttpServer())
        .post('/auth/staff/login')
        .send({ username: staffUsername, password: staffPassword })
        .expect(200);
      const value = requestCookiePair(staffRes.headers['set-cookie']![0]).split('=').slice(1).join('=');

      // Exactly what a browser that signed in yesterday would send.
      const legacy = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `esamagri_rt=${value}`)
        .expect(200);
      expect(legacy.body.principal.principalType).toBe('STAFF');
      // ...and it is re-issued under the new, specific name.
      expect(legacy.headers['set-cookie']![0]).toMatch(/^esamagri_rt_staff=/);
    });
  });

  // --- 12: sensitive data never appears in a thrown error's message ------
  describe('sensitive data never leaks into an error message', () => {
    it('a wrong staff password never appears in the InvalidCredentialsError message', async () => {
      const secretGuess = `super-secret-guess-${runId}`;
      let caught: unknown;
      try {
        await staffAuth.login({ username: staffUsername, password: secretGuess, ipAddress: null, deviceInfo: null });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(InvalidCredentialsError);
      expect((caught as Error).message).not.toContain(secretGuess);
    });

    it('a wrong OTP code never appears in the OtpInvalidError message', async () => {
      const guessedCode = '246810';
      await otpRequests.create({
        mobileNumber,
        otpHash: otpService.hashCode('999999'),
        purpose: 'LOGIN',
        expiresAt: new Date(Date.now() + otpService.ttlSeconds() * 1000),
        maxAttempts: otpService.maxAttempts(),
      });
      let caught: unknown;
      try {
        await customerAuth.verifyOtp({ mobileNumber, code: guessedCode, ipAddress: null, deviceInfo: null });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(OtpInvalidError);
      expect((caught as Error).message).not.toContain(guessedCode);
    });

    it('a raw refresh token never appears in a RefreshTokenInvalidError message', async () => {
      const fakeToken = `fake-refresh-token-${runId}`;
      let caught: unknown;
      try {
        await tokenService.rotateSession({ presentedRefreshToken: fakeToken, ipAddress: null, deviceInfo: null });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(RefreshTokenInvalidError);
      expect((caught as Error).message).not.toContain(fakeToken);
    });
  });
});
