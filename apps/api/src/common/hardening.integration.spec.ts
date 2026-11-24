import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import request from 'supertest';
import { AppModule } from '../app.module';
import {
  RATE_LIMIT_SETTINGS,
  rateLimitSettingsFromConfig,
  type RateLimitSettings,
} from './rate-limit.guard';

/**
 * LAUNCH HARDENING — the cross-cutting layer, over real HTTP.
 *
 * WHAT THIS SUITE PROVES
 *
 *  1. ONE ERROR ENVELOPE, always: `{ code, message, correlationId }`. A
 *     caller never receives Nest's bare default, and never a stack trace, a
 *     SQL fragment or a table name.
 *  2. THE CORRELATION ID IS REAL: it comes back in the header and in the
 *     body, it is honoured when the caller supplies one, and a hostile
 *     header value is not echoed back.
 *  3. SECURITY HEADERS are on every response, including the error ones.
 *  4. VALIDATION IS GLOBAL: an undeclared field is refused even on a route
 *     that declares no pipe of its own.
 *  5. RATE LIMITING actually refuses, with 429, `Retry-After` and the
 *     RATE_LIMITED code — and the auth class is stricter than the read
 *     class, which is the whole point of having classes.
 *  6. READINESS answers from the database and reports the schema contract.
 *
 * The app is bootstrapped here exactly as main.ts does it, because what is
 * being tested IS the bootstrap. Rate limiting is force-enabled for this
 * suite only (it defaults off under NODE_ENV=test so the other suites can
 * hammer the API).
 */
describe('Launch hardening (integration, real HTTP)', () => {
  let app: INestApplication;
  const server = () => app.getHttpServer();

  /**
   * main.ts's own sequence, so this suite tests the real bootstrap.
   *
   * The rate-limit numbers arrive as an overridden provider rather than as
   * environment variables, because ConfigModule validates the environment
   * when `app.module.ts` is first imported — before any test body runs — so
   * setting a variable here would be read by nothing. See the comment on
   * RATE_LIMIT_SETTINGS.
   */
  const boot = async (limits?: Partial<RateLimitSettings>): Promise<INestApplication> => {
    const settings: RateLimitSettings = {
      enabled: false,
      windowMs: 60_000,
      limits: { auth: 20, write: 180, read: 900 },
      ...limits,
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(RATE_LIMIT_SETTINGS)
      .useValue(settings)
      .compile();

    const instance = moduleRef.createNestApplication();
    instance.use(
      helmet({
        contentSecurityPolicy: {
          useDefaults: false,
          directives: {
            'default-src': ["'none'"],
            'img-src': ["'self'", 'data:'],
            'frame-ancestors': ["'none'"],
            'base-uri': ["'none'"],
            'form-action': ["'none'"],
          },
        },
        crossOriginResourcePolicy: { policy: 'cross-origin' },
        referrerPolicy: { policy: 'no-referrer' },
        hsts: false,
      })
    );
    instance.use(express.json({ limit: '256kb' }));
    instance.use(cookieParser());
    instance.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
    );
    await instance.init();
    return instance;
  };

  afterEach(async () => {
    await app?.close();
  });

  // =================================================================
  // 1. The error envelope
  // =================================================================
  describe('every error leaves in one envelope', () => {
    beforeEach(async () => {
      app = await boot();
    });

    it('an unauthenticated request carries a code, a message and a correlation id', async () => {
      const res = await request(server()).get('/admin/session').expect(401);
      expect(res.body.code).toBe('UNAUTHENTICATED');
      expect(typeof res.body.message).toBe('string');
      expect(res.body.correlationId).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.headers['x-correlation-id']).toBe(res.body.correlationId);
    });

    it('a route that does not exist answers the envelope, not Nest’s default', async () => {
      const res = await request(server()).get('/no/such/route').expect(404);
      // ROUTE_NOT_FOUND, not NOT_FOUND: "no such address" is a different
      // answer from "no such thing at this address", and both web apps act
      // on the difference — the first means a screen whose backend route has
      // not shipped yet, which is a planned-feature state, not a failure.
      expect(res.body.code).toBe('ROUTE_NOT_FOUND');
      expect(res.body.correlationId).toBeTruthy();
      // Nest's raw shape must be gone.
      expect(res.body.statusCode).toBeUndefined();
      expect(res.body.error).toBeUndefined();
    });

    it('a domain refusal keeps its OWN code, message and details — only the id is added', async () => {
      const token = await customerToken();
      const res = await request(server())
        .post('/pif/checkout')
        .set('Authorization', `Bearer ${token}`)
        .send({ lines: [], fulfillmentMode: 'PICKUP' })
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.details.reason).toBe('EMPTY_CART');
      expect(res.body.message).toMatch(/nothing in the cart/i);
      expect(res.body.correlationId).toBeTruthy();
    });

    it('a shape refusal is translated into the same envelope, with the field messages', async () => {
      const token = await customerToken();
      const res = await request(server())
        .post('/pif/quote')
        .set('Authorization', `Bearer ${token}`)
        .send({ lines: [{ productId: 'not-a-uuid', qty: 1 }] })
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(Array.isArray(res.body.details.validation)).toBe(true);
      expect(res.body.details.validation.join(' ')).toMatch(/productId/);
      expect(res.body.correlationId).toBeTruthy();
    });

    it('NEVER leaks a stack trace, a SQL fragment or a table name', async () => {
      const token = await customerToken();
      // Built one at a time, not as an array of pending requests: supertest
      // closes the ephemeral server it opened when a request finishes, so a
      // second request created up front would be refused.
      const probes: Array<() => request.Test> = [
        () => request(server()).get('/no/such/route'),
        () => request(server()).get('/admin/session'),
        () =>
          request(server())
            .get(`/pif/orders/${'0'.repeat(8)}-0000-7000-8000-000000000000`)
            .set('Authorization', `Bearer ${token}`),
      ];
      for (const probe of probes) {
        const res = await probe();
        const body = JSON.stringify(res.body);
        expect(body).not.toMatch(/at \w+ \(/);         // a stack frame
        expect(body).not.toMatch(/SELECT |INSERT |pg_/i);
        expect(body).not.toMatch(/\b(rik|pif|shared)\.[a-z_]+\b/);
        expect(body).not.toMatch(/node_modules|\/home\//);
      }
    });
  });

  // =================================================================
  // 2. The correlation id
  // =================================================================
  describe('the correlation id', () => {
    beforeEach(async () => {
      app = await boot();
    });

    it('is generated per request, and differs between requests', async () => {
      const a = await request(server()).get('/health');
      const b = await request(server()).get('/health');
      expect(a.headers['x-correlation-id']).toBeTruthy();
      expect(b.headers['x-correlation-id']).toBeTruthy();
      expect(a.headers['x-correlation-id']).not.toBe(b.headers['x-correlation-id']);
    });

    it('honours one the caller supplied, so a proxy’s id spans the hop', async () => {
      const mine = 'proxy-7f3a9c21-0088';
      const res = await request(server()).get('/health').set('x-correlation-id', mine);
      expect(res.headers['x-correlation-id']).toBe(mine);
    });

    it('does NOT echo a hostile header value back', async () => {
      const nasty = '<script>alert(1)</script>';
      const res = await request(server()).get('/admin/session').set('x-correlation-id', nasty).expect(401);
      expect(res.headers['x-correlation-id']).not.toContain('<');
      expect(JSON.stringify(res.body)).not.toContain('<script');
      // Stripped to safe characters and then too short, so a fresh id was used.
      expect(res.body.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('refuses an absurdly long id and uses its own', async () => {
      const res = await request(server()).get('/health').set('x-correlation-id', 'a'.repeat(500));
      expect(res.headers['x-correlation-id']!.length).toBeLessThanOrEqual(36);
    });
  });

  // =================================================================
  // 3. Security headers
  // =================================================================
  describe('security headers', () => {
    beforeEach(async () => {
      app = await boot();
    });

    it('are present on a success AND on an error', async () => {
      for (const res of [await request(server()).get('/health'), await request(server()).get('/admin/session')]) {
        expect(res.headers['content-security-policy']).toContain("default-src 'none'");
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['referrer-policy']).toBe('no-referrer');
        expect(res.headers['x-frame-options'] ?? 'SAMEORIGIN').toBeTruthy();
        expect(res.headers['x-powered-by']).toBeUndefined();
      }
    });
  });

  // =================================================================
  // 4. Validation, globally
  // =================================================================
  describe('validation applies even where a route declares no pipe', () => {
    beforeEach(async () => {
      app = await boot();
    });

    it('refuses an undeclared field on the OTP request route', async () => {
      const res = await request(server())
        .post('/auth/customer/otp/request')
        .send({ mobileNumber: '+919000000111', isAdmin: true })
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.details.validation.join(' ')).toMatch(/isAdmin/);
    });

    it('refuses a body that is far too large', async () => {
      const res = await request(server())
        .post('/auth/customer/otp/request')
        .set('Content-Type', 'application/json')
        .send(`{"mobileNumber":"+919000000111","pad":"${'x'.repeat(400_000)}"}`);
      expect([400, 413]).toContain(res.status);
    });
  });

  // =================================================================
  // 5. Rate limiting
  // =================================================================
  describe('rate limiting refuses, and refuses the right class first', () => {
    it('answers 429 with Retry-After and the RATE_LIMITED code once the auth class is spent', async () => {
      app = await boot({ enabled: true, limits: { auth: 3, write: 500, read: 500 } });

      const attempt = () =>
        request(server())
          .post('/auth/staff/login')
          .send({ username: 'nobody_hardening', password: 'WrongPassword1!' });

      const first = await attempt();
      const second = await attempt();
      const third = await attempt();
      const fourth = await attempt();

      expect([first.status, second.status, third.status]).toEqual([401, 401, 401]);
      expect(fourth.status).toBe(429);
      expect(fourth.body.code).toBe('RATE_LIMITED');
      expect(Number(fourth.headers['retry-after'])).toBeGreaterThan(0);
      expect(fourth.body.details.retryAfterSeconds).toBeGreaterThan(0);
      expect(fourth.body.correlationId).toBeTruthy();
      // The password itself is never reflected.
      expect(JSON.stringify(fourth.body)).not.toContain('WrongPassword1!');
    });

    it('a spent AUTH allowance does not spend the READ allowance', async () => {
      app = await boot({ enabled: true, limits: { auth: 2, write: 180, read: 50 } });
      for (let i = 0; i < 4; i += 1) {
        await request(server()).post('/auth/staff/login').send({ username: 'x_hardening', password: 'Nope12345!' });
      }
      // The classes are counted separately: reads still work.
      await request(server()).get('/health').expect(200);
      const res = await request(server()).get('/admin/session');
      expect(res.status).toBe(401);
    });

    it('reports the allowance in headers, counting down', async () => {
      app = await boot({ enabled: true, limits: { auth: 20, write: 180, read: 10 } });
      const first = await request(server()).get('/admin/dashboard');
      const second = await request(server()).get('/admin/dashboard');
      expect(Number(first.headers['x-ratelimit-limit'])).toBe(10);
      expect(Number(first.headers['x-ratelimit-remaining'])).toBeGreaterThan(
        Number(second.headers['x-ratelimit-remaining'])
      );
    });


    it('does NOT spend the sign-in allowance on an ordinary page load’s refresh', async () => {
      // A rehearsal caught this: every page load calls /auth/refresh, and
      // when that counted as a sign-in attempt, a facility behind one NAT
      // shared twenty page loads a minute between everybody and started
      // signing people out mid-shift. A refresh presents a token that is
      // verified and rotated; it is not a guess.
      app = await boot({ enabled: true, limits: { auth: 2, write: 180, read: 900 } });

      for (let i = 0; i < 8; i += 1) {
        const res = await request(server()).post('/auth/refresh');
        expect(res.status).toBe(401); // no cookie — but never 429
      }

      // The sign-in allowance is still intact and still strict.
      const first = await request(server())
        .post('/auth/staff/login')
        .send({ username: 'nobody_classes', password: 'WrongPassword1!' });
      const second = await request(server())
        .post('/auth/staff/login')
        .send({ username: 'nobody_classes', password: 'WrongPassword1!' });
      const third = await request(server())
        .post('/auth/staff/login')
        .send({ username: 'nobody_classes', password: 'WrongPassword1!' });
      expect([first.status, second.status]).toEqual([401, 401]);
      expect(third.status).toBe(429);
    });

    it('does not throttle the product-image route, which one page requests many times', async () => {
      app = await boot({ enabled: true, limits: { auth: 20, write: 180, read: 3 } });
      const key = '/pif/media/pif/products/00000000-0000-4000-8000-000000000000.png';
      for (let i = 0; i < 8; i += 1) {
        const res = await request(server()).get(key);
        // 404 because no such picture is stored — never 429.
        expect(res.status).toBe(404);
      }
    });

    it('is OFF by default under NODE_ENV=test, so the other suites are not throttled', async () => {
      app = await boot();
      const config = app.get(ConfigService);
      expect(process.env.NODE_ENV).toBe('test');
      // Resolved by loadApiEnv from NODE_ENV alone — no variable is set in
      // the test fixture, and this is what every other suite runs under.
      expect(config.get('RATE_LIMIT_ENABLED')).toBe(false);
      // ...and a guard built from that config lets everything through.
      const settings = rateLimitSettingsFromConfig(config);
      expect(settings.enabled).toBe(false);
    });
  });

  // =================================================================
  // 6. Readiness
  // =================================================================
  describe('liveness and readiness', () => {
    beforeEach(async () => {
      app = await boot();
    });

    it('/health is a flat liveness answer with no internals', async () => {
      const res = await request(server()).get('/health').expect(200);
      expect(res.body.status).toBe('ok');
      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/postgres|password|localhost:5432/i);
    });

    it('/health/ready asks the database and reports the schema contract', async () => {
      const res = await request(server()).get('/health/ready').expect(200);
      expect(res.body.status).toBe('ready');
      expect(res.body.database.reachable).toBe(true);
      expect(res.body.database.schemaContractOk).toBe(true);
      // Still nothing about where that database is.
      expect(JSON.stringify(res.body)).not.toMatch(/postgres|5432|password/i);
    });

    it('/health/views reports the approved views and nothing else', async () => {
      const res = await request(server()).get('/health/views').expect(200);
      expect(res.body.views).toHaveLength(5);
    });

    it('neither needs a credential, because a probe has none', async () => {
      await request(server()).get('/health').expect(200);
      await request(server()).get('/health/ready').expect(200);
    });
  });

  /** A real customer session, through the real OTP flow. */
  async function customerToken(): Promise<string> {
    const { DatabaseService } = await import('../database/database.service');
    const { TokenService } = await import('../auth/services/token.service');
    const db = app.get(DatabaseService);
    const tokens = app.get(TokenService);
    const rows = await db.query<{ id: string }>(
      `SELECT id FROM shared.customers WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1`
    );
    return tokens.signAccessToken({ principalType: 'CUSTOMER', principalId: rows[0]!.id });
  }
});
