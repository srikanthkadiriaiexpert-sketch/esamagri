import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../app.module';
import { DatabaseService } from '../database/database.service';
import { TokenService } from '../auth/services/token.service';
import { PasswordService } from '../auth/services/password.service';

/**
 * STEP 9 — customer profile, over real HTTP against real PostgreSQL
 * (`esamagri_test`), booting the same AppModule DI graph main.ts uses.
 *
 * The security-relevant cases are the point of this file: a customer
 * may read and write their OWN profile and nothing else, and that is
 * enforced server-side (AuthorizationGuard) rather than by the client
 * choosing not to ask. Every horizontal-escalation attempt below goes
 * through a real request with a real, validly-signed token for a
 * DIFFERENT customer — not a mocked guard.
 *
 * Test data is created and removed per run; `shared.audit_log` rows
 * written by denials are left in place, matching the existing STEP 6/7
 * suites (the table is append-only by design and no application role
 * holds DELETE on it).
 */
describe('Customer profile (STEP 9, integration, real PostgreSQL + real HTTP)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let tokenService: TokenService;

  const runId = randomUUID().slice(0, 8);
  const digits = runId.replace(/[^0-9]/g, '').padEnd(7, '5');

  let customerAId: string;
  let customerBId: string;
  let inactiveCustomerId: string;
  let staffId: string;
  let tokenA: string;
  let tokenB: string;
  let tokenInactive: string;
  let tokenStaff: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    // Mirrors the global pipe the API applies in production bootstrap
    // for DTO-validated routes.
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    db = app.get(DatabaseService);
    tokenService = app.get(TokenService);
    const passwordService = app.get(PasswordService);

    const customers = await db.query<{ id: string }>(
      `INSERT INTO shared.customers (id, mobile_number, name, is_active)
       VALUES (shared.uuid_generate_v7(), $1, $2, true),
              (shared.uuid_generate_v7(), $3, $4, true),
              (shared.uuid_generate_v7(), $5, $6, false)
       RETURNING id`,
      [
        `+91801${digits.slice(0, 7)}`,
        `Jest Customer A ${runId}`,
        `+91802${digits.slice(0, 7)}`,
        `Jest Customer B ${runId}`,
        `+91803${digits.slice(0, 7)}`,
        `Jest Inactive ${runId}`,
      ]
    );
    customerAId = customers[0].id;
    customerBId = customers[1].id;
    inactiveCustomerId = customers[2].id;

    const staffRows = await db.query<{ id: string }>(
      `INSERT INTO shared.users (id, username, password_hash, display_name, status)
       VALUES (shared.uuid_generate_v7(), $1, $2, $3, 'ACTIVE') RETURNING id`,
      [`jest_step9_staff_${runId}`, await passwordService.hash('CorrectHorseBatteryStaple!1'), `Jest STEP9 Staff ${runId}`]
    );
    staffId = staffRows[0].id;

    tokenA = tokenService.signAccessToken({ principalType: 'CUSTOMER', principalId: customerAId });
    tokenB = tokenService.signAccessToken({ principalType: 'CUSTOMER', principalId: customerBId });
    tokenInactive = tokenService.signAccessToken({ principalType: 'CUSTOMER', principalId: inactiveCustomerId });
    tokenStaff = tokenService.signAccessToken({ principalType: 'STAFF', principalId: staffId });
  });

  afterAll(async () => {
    const ids = [customerAId, customerBId, inactiveCustomerId];
    await db.query('DELETE FROM shared.auth_sessions WHERE principal_id = ANY($1::uuid[])', [[...ids, staffId]]);
    await db.query('DELETE FROM shared.customer_addresses WHERE customer_id = ANY($1::uuid[])', [ids]);
    await db.query('DELETE FROM shared.customers WHERE id = ANY($1::uuid[])', [ids]);
    await db.query('DELETE FROM shared.users WHERE id = $1', [staffId]);
    await app.close();
  });

  // --- authentication boundary (401, never 403) ---------------------------
  describe('unauthenticated access', () => {
    it('GET /customer/me without a token -> 401', async () => {
      await request(app.getHttpServer()).get('/customer/me').expect(401);
    });

    it('GET /customer/:id without a token -> 401', async () => {
      await request(app.getHttpServer()).get(`/customer/${customerAId}`).expect(401);
    });

    it('PATCH /customer/me without a token -> 401', async () => {
      await request(app.getHttpServer()).patch('/customer/me').send({ name: 'Nope' }).expect(401);
    });

    it('a garbage bearer token -> 401, not 403', async () => {
      await request(app.getHttpServer())
        .get('/customer/me')
        .set('Authorization', 'Bearer not-a-real-token')
        .expect(401);
    });

    it('an expired/invalid-signature token -> 401 (session expiry surface)', async () => {
      // A token signed with a different secret must never authenticate.
      const forged =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
        Buffer.from(JSON.stringify({ sub: customerAId, type: 'CUSTOMER', exp: 1 })).toString('base64url') +
        '.forgedsignature';
      await request(app.getHttpServer()).get('/customer/me').set('Authorization', `Bearer ${forged}`).expect(401);
    });
  });

  // --- the customer's own profile ----------------------------------------
  describe('own profile', () => {
    it('GET /customer/me returns only the approved fields', async () => {
      const res = await request(app.getHttpServer())
        .get('/customer/me')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(res.body.customerId).toBe(customerAId);
      expect(res.body.name).toBe(`Jest Customer A ${runId}`);
      expect(res.body.mobileNumber).toBe(`+91801${digits.slice(0, 7)}`);
      // No residence recorded yet — an empty state, not an error.
      expect(res.body.residence).toBeNull();

      // Nothing beyond the approved field set may leak into the payload.
      // STEP 11E added `dietaryPreference` to the approved set: it is a
      // fact about the officer that decides their entitlement, and until
      // it was exposed here only SQL could record it. Still no Aadhaar,
      // PAN, service number, rank, unit or family field — the point of
      // this assertion is that the set grows deliberately, one reviewed
      // field at a time, rather than by accident.
      expect(Object.keys(res.body).sort()).toEqual([
        'customerId',
        'dietaryPreference',
        'mobileNumber',
        'name',
        'residence',
      ]);
      const serialized = JSON.stringify(res.body).toLowerCase();
      for (const forbidden of ['aadhaar', 'pan', 'service_number', 'rank', 'unit', 'password', 'hash']) {
        expect(serialized).not.toContain(forbidden);
      }
    });

    it('GET /customer/:ownId returns the same profile', async () => {
      const res = await request(app.getHttpServer())
        .get(`/customer/${customerAId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(res.body.customerId).toBe(customerAId);
    });

    it('a deactivated customer gets 404, not another customer’s data', async () => {
      await request(app.getHttpServer())
        .get('/customer/me')
        .set('Authorization', `Bearer ${tokenInactive}`)
        .expect(404);
    });
  });

  // --- horizontal privilege escalation (IDOR / BOLA) ----------------------
  describe('ownership enforcement', () => {
    it('customer A requesting customer B’s profile by id -> 403', async () => {
      await request(app.getHttpServer())
        .get(`/customer/${customerBId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(403);
    });

    it('the 403 body is generic — it never reveals whether that customer exists', async () => {
      const real = await request(app.getHttpServer())
        .get(`/customer/${customerBId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(403);
      const fabricated = await request(app.getHttpServer())
        .get(`/customer/${randomUUID()}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(403);
      // Everything except the correlation id must be identical — a real
      // customer's id and a fabricated one must produce the same refusal, or
      // the refusal itself becomes a way to enumerate customers. The
      // correlation id is deliberately different per request (LAUNCH
      // HARDENING: it is what finds this one refusal in the server log) and
      // says nothing about the customer, so it is excluded from the
      // comparison and asserted to be a fresh id instead.
      const { correlationId: realId, ...realRest } = real.body;
      const { correlationId: otherId, ...otherRest } = fabricated.body;
      expect(realRest).toEqual(otherRest);
      expect(realId).toMatch(/^[0-9a-f-]{36}$/);
      expect(otherId).toMatch(/^[0-9a-f-]{36}$/);
      expect(realId).not.toBe(otherId);
      expect(JSON.stringify(real.body)).not.toContain(customerBId);
    });

    it('a customer id in the PATCH body cannot retarget the update', async () => {
      await request(app.getHttpServer())
        .patch('/customer/me')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Hijack Attempt', customerId: customerBId })
        .expect(400);

      // Customer B is untouched.
      const b = await request(app.getHttpServer())
        .get('/customer/me')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);
      expect(b.body.name).toBe(`Jest Customer B ${runId}`);
    });

    it('a STAFF principal is 403 on a customer’s own profile routes', async () => {
      await request(app.getHttpServer()).get('/customer/me').set('Authorization', `Bearer ${tokenStaff}`).expect(403);
      await request(app.getHttpServer())
        .get(`/customer/${customerAId}`)
        .set('Authorization', `Bearer ${tokenStaff}`)
        .expect(403);
    });
  });

  // --- update, validation -------------------------------------------------
  describe('profile update', () => {
    it('updates the customer’s own name', async () => {
      const res = await request(app.getHttpServer())
        .patch('/customer/me')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: `Renamed A ${runId}` })
        .expect(200);
      expect(res.body.name).toBe(`Renamed A ${runId}`);
    });

    it('records quarter/residence and reads it back', async () => {
      const res = await request(app.getHttpServer())
        .patch('/customer/me')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ quarterBlock: 'Block 4', quarterNumber: 'Qtr 12', landmark: 'Near the parade ground' })
        .expect(200);
      expect(res.body.residence).toEqual({
        label: null,
        quarterBlock: 'Block 4',
        quarterNumber: 'Qtr 12',
        landmark: 'Near the parade ground',
      });

      const reread = await request(app.getHttpServer())
        .get('/customer/me')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(reread.body.residence.quarterBlock).toBe('Block 4');
    });

    it('updating residence twice keeps exactly one default address row', async () => {
      await request(app.getHttpServer())
        .patch('/customer/me')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ quarterBlock: 'Block 7', quarterNumber: 'Qtr 3' })
        .expect(200);

      const rows = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM shared.customer_addresses WHERE customer_id = $1 AND is_default`,
        [customerAId]
      );
      expect(rows[0].count).toBe('1');
    });

    it('rejects a half-specified residence (quarter number without block)', async () => {
      await request(app.getHttpServer())
        .patch('/customer/me')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ quarterNumber: 'Qtr 9' })
        .expect(400);
    });

    it('rejects an empty name', async () => {
      await request(app.getHttpServer())
        .patch('/customer/me')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: '' })
        .expect(400);
    });

    it('rejects an attempt to change the mobile number (identity, not a profile field)', async () => {
      await request(app.getHttpServer())
        .patch('/customer/me')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ mobileNumber: '+919999999999' })
        .expect(400);

      const res = await request(app.getHttpServer())
        .get('/customer/me')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(res.body.mobileNumber).toBe(`+91801${digits.slice(0, 7)}`);
    });

    it('rejects unapproved profile fields outright', async () => {
      for (const body of [{ aadhaar: '1234' }, { rank: 'CPO' }, { serviceNumber: 'X1' }, { unit: 'INS' }]) {
        await request(app.getHttpServer())
          .patch('/customer/me')
          .set('Authorization', `Bearer ${tokenA}`)
          .send(body)
          .expect(400);
      }
    });
  });

  // --- error shape --------------------------------------------------------
  it('never leaks database or stack-trace detail to the client', async () => {
    const res = await request(app.getHttpServer())
      .patch('/customer/me')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: '' })
      .expect(400);
    const body = JSON.stringify(res.body).toLowerCase();
    for (const leak of ['select ', 'insert ', 'pg_', 'postgres', 'at object.', '.ts:']) {
      expect(body).not.toContain(leak);
    }
  });
});
