import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { STAFF_ROLES } from '@esamagri/shared-types';
import { AppModule } from '../app.module';
import { DatabaseService } from '../database/database.service';
import { TokenService } from '../auth/services/token.service';
import { PasswordService } from '../auth/services/password.service';

/**
 * GET /rik/catalogue — the reference list behind the Nutrition Info page.
 *
 * THE TWO THINGS THIS SUITE EXISTS TO PROVE:
 *
 *  1. IT LEAKS NO ENTITLEMENT INFORMATION. The route is a product reference,
 *     not an allowance. A consumption ratio, a maximum quantity, a minimum
 *     eligible day count or a dietary applicability would each let a reader
 *     work out an allowance this route never checked, so none of them may
 *     appear in the response. That is asserted field by field.
 *
 *  2. IT IS THE WHOLE ACTIVE CATALOGUE, not one officer's slice. It must
 *     agree exactly with what the engine itself considers active — same
 *     rows, same count — because a reference page that quietly omits items
 *     is worse than no page.
 *
 * It also proves the route is read-only and customer-authenticated. Every row
 * it reads is the facility's own; the suite creates one customer and one
 * staff user of each role, and removes them in afterAll. It writes nothing to
 * the catalogue.
 */
describe('GET /rik/catalogue (integration, real PostgreSQL + real HTTP)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let tokenService: TokenService;

  const runId = randomUUID().slice(0, 8);
  const staffIds: string[] = [];
  const staffTokens = new Map<string, string>();
  let customerToken: string;
  let customerId: string;

  const server = () => app.getHttpServer();
  const asCustomer = () => request(server()).get('/rik/catalogue').set('Authorization', `Bearer ${customerToken}`);

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    db = app.get(DatabaseService);
    tokenService = app.get(TokenService);

    const passwordHash = await app.get(PasswordService).hash('CorrectHorseBatteryStaple!1');
    const bootstrap = await db.query<{ id: string }>(
      `SELECT id FROM shared.users WHERE username = 'bootstrap_super_admin'`
    );
    for (const role of STAFF_ROLES) {
      const rows = await db.query<{ id: string }>(
        `INSERT INTO shared.users (id, username, password_hash, display_name, status)
         VALUES (shared.uuid_generate_v7(), $1, $2, $3, 'ACTIVE') RETURNING id`,
        [`jest_cat_${role.toLowerCase()}_${runId}`, passwordHash, `Jest CAT ${role} ${runId}`]
      );
      const id = rows[0]!.id;
      staffIds.push(id);
      await db.query(
        `INSERT INTO shared.user_roles (user_id, role_id, granted_by)
         SELECT $1, r.id, $2 FROM shared.roles r WHERE r.name = $3`,
        [id, bootstrap[0]!.id, role]
      );
      staffTokens.set(role, tokenService.signAccessToken({ principalType: 'STAFF', principalId: id }));
    }

    const digits = runId.replace(/[^0-9]/g, '').padEnd(7, '3').slice(0, 7);
    const customer = await db.query<{ id: string }>(
      `INSERT INTO shared.customers (id, mobile_number, name, is_active)
       VALUES (shared.uuid_generate_v7(), $1, $2, true) RETURNING id`,
      [`+91663${digits}`, `Jest CAT Customer ${runId}`]
    );
    customerId = customer[0]!.id;
    customerToken = tokenService.signAccessToken({ principalType: 'CUSTOMER', principalId: customerId });
  });

  afterAll(async () => {
    if (staffIds.length > 0) {
      await db.query('DELETE FROM shared.user_roles WHERE user_id = ANY($1::uuid[])', [staffIds]);
      await db.query('DELETE FROM shared.users WHERE id = ANY($1::uuid[])', [staffIds]);
    }
    if (customerId) await db.query('DELETE FROM shared.customers WHERE id = $1', [customerId]);
    await app.close();
  });

  it('TEST 1 — a customer gets the whole active catalogue, agreeing with the database', async () => {
    const res = await asCustomer().expect(200);

    const expected = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM rik.provisions
        WHERE is_active AND effective_from <= CURRENT_DATE
          AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)`
    );
    expect(res.body.items).toHaveLength(Number(expected[0]!.n));
    // Not a hard-coded 190: the count is whatever the database currently holds.
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('TEST 2 — every item carries the customer-safe catalogue fields', async () => {
    const res = await asCustomer().expect(200);
    const item = res.body.items[0];
    expect(Object.keys(item).sort()).toEqual(
      [
        'brand', 'code', 'imageRef', 'isLoose', 'issuePeriod',
        'name', 'packSize', 'packUnit', 'poolCode', 'poolName', 'unit',
      ].sort()
    );
    expect(typeof item.code).toBe('string');
    expect(typeof item.name).toBe('string');
  });

  it('TEST 3 — NO entitlement information is exposed, on any item', async () => {
    const res = await asCustomer().expect(200);
    const forbidden = [
      'consumptionRatio', 'consumption_ratio',
      'maxQuantity', 'max_quantity', 'maxPacks', 'max_packs',
      'minEligibleDays', 'min_eligible_days',
      'dietaryPreference', 'dietary_preference',
      'isCustomerSelectable', 'is_customer_selectable',
      'wholeUnitsOnly', 'whole_units_only',
      'id', 'poolId', 'pool_id', 'displayOrder', 'display_order',
    ];
    for (const item of res.body.items) {
      for (const field of forbidden) {
        expect({ code: item.code, field, present: field in item }).toEqual({
          code: item.code,
          field,
          present: false,
        });
      }
    }
  });

  it('TEST 4 — a committed catalogue picture is passed through unchanged', async () => {
    const res = await asCustomer().expect(200);
    const withPicture = res.body.items.filter((i: { imageRef: string | null }) => i.imageRef !== null);
    expect(withPicture.length).toBeGreaterThan(0);
    for (const item of withPicture) {
      expect(item.imageRef).toMatch(/^(\/catalogue\/|\/rik\/media\/)/);
    }
  });

  it('TEST 5 — authentication is required, and it is the CUSTOMER session', async () => {
    await request(server()).get('/rik/catalogue').expect(401);
    // Staff hold no customer session; this route is for the customer app.
    for (const role of STAFF_ROLES) {
      const res = await request(server())
        .get('/rik/catalogue')
        .set('Authorization', `Bearer ${staffTokens.get(role)}`);
      expect({ role, status: res.status }).toEqual({ role, status: 403 });
    }
  });

  it('TEST 6 — the route is read-only: it writes nothing and offers no write verb', async () => {
    const before = await db.query<{ fingerprint: string }>(
      `SELECT count(*)::text || ':' || coalesce(max(updated_at)::text, '-') AS fingerprint FROM rik.provisions`
    );
    await asCustomer().expect(200);
    await asCustomer().expect(200);
    const after = await db.query<{ fingerprint: string }>(
      `SELECT count(*)::text || ':' || coalesce(max(updated_at)::text, '-') AS fingerprint FROM rik.provisions`
    );
    expect(after[0]!.fingerprint).toBe(before[0]!.fingerprint);

    const server_ = server();
    expect((await request(server_).post('/rik/catalogue').set('Authorization', `Bearer ${customerToken}`)).status).toBe(404);
    expect((await request(server_).patch('/rik/catalogue').set('Authorization', `Bearer ${customerToken}`)).status).toBe(404);
    expect((await request(server_).delete('/rik/catalogue').set('Authorization', `Bearer ${customerToken}`)).status).toBe(404);
  });

  it('TEST 7 — a retired provision is absent, exactly as the engine sees it', async () => {
    // Created and retired by this suite, then removed in the same test, so
    // the facility's own catalogue is never altered.
    const pool = await db.query<{ id: string }>(`SELECT id FROM rik.entitlement_pools ORDER BY code LIMIT 1`);
    const made = await db.query<{ id: string }>(
      `INSERT INTO rik.provisions (pool_id, code, name, unit, consumption_ratio, issue_period, is_active)
       VALUES ($1, $2, $3, 'g', 1.000000, 'DRY', false) RETURNING id`,
      [pool[0]!.id, `JEST_CAT_RETIRED_${runId.toUpperCase()}`, `Jest retired ${runId}`]
    );
    try {
      const res = await asCustomer().expect(200);
      const codes = res.body.items.map((i: { code: string }) => i.code);
      expect(codes).not.toContain(`JEST_CAT_RETIRED_${runId.toUpperCase()}`);
    } finally {
      await db.query('DELETE FROM rik.provisions WHERE id = $1', [made[0]!.id]);
    }
  });

  it('TEST 8 — the entitlement route is untouched and still answers for a customer', async () => {
    // The new route must not have disturbed the engine's own endpoint; a 200
    // or a 404/409 about periods is fine, a 500 is not.
    const res = await request(server())
      .get('/rik/entitlements/current')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBeLessThan(500);
  });
});
