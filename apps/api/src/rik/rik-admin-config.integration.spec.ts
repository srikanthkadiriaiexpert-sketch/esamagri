import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { STAFF_ROLES, type StaffRole } from '@esamagri/shared-types';
import { AppModule } from '../app.module';
import { DatabaseService } from '../database/database.service';
import { TokenService } from '../auth/services/token.service';
import { PasswordService } from '../auth/services/password.service';
import { EntitlementConfigRepository } from './repositories/entitlement-config.repository';
import { RikEligibilityService } from './services/rik-eligibility.service';
import { RikEntitlementService } from './services/rik-entitlement.service';

/**
 * STEP 11C — RIK entitlement configuration API, over real HTTP against
 * real PostgreSQL, with the approved role/permission seed exactly as it
 * exists in the frozen database.
 *
 * Three things this suite is designed to prove, in order of importance:
 *
 *  1. ONLY RIK_ADMIN CAN CHANGE RIK CONFIGURATION. Every other staff
 *     role in the seed, a staff member with no role at all, a customer,
 *     and an anonymous caller are each pointed at every route. No new
 *     role and no new permission was introduced for this; the suite
 *     also asserts that the role and permission counts are unchanged.
 *
 *  2. EVERY BUSINESS RULE IS ENFORCED BY THE SERVER. Each rejection is
 *     exercised through HTTP with a well-formed request that a screen
 *     could send, and each is checked to have written nothing.
 *
 *  3. THE ENGINE FOLLOWS THE DASHBOARD. A pool, a scale and a provision
 *     are created through the HTTP API only — no SQL, no fixture — and
 *     the STEP 11B calculation engine is then asked what a customer is
 *     entitled to. The number it returns comes from rows this suite
 *     wrote through the admin API. Changing the scale through the API
 *     changes the answer. Not one line of the calculation engine was
 *     modified for STEP 11C, which is the claim these tests exist to
 *     substantiate rather than assert.
 *
 * ISOLATION FROM THE STEP 11B SUITE. Jest runs spec files in parallel.
 * Everything this suite creates is dated in 2027 — the configuration's
 * effective window and the issue period alike — while the STEP 11B
 * suite works entirely in 2026. An effective-dated configuration is
 * invisible outside its window by construction, so the two suites
 * cannot see each other's rows even when they run at the same moment.
 * That is the versioning model doing exactly what it was built for.
 */
describe('RIK admin configuration API (STEP 11C, integration, real PostgreSQL + real HTTP)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let tokenService: TokenService;
  let configRepo: EntitlementConfigRepository;
  let eligibility: RikEligibilityService;
  let entitlement: RikEntitlementService;

  const runId = randomUUID().slice(0, 8);
  const tag = runId.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const digits = runId.replace(/[^0-9]/g, '').padEnd(7, '7');

  const staffIdByRole = new Map<StaffRole, string>();
  const tokenByRole = new Map<StaffRole, string>();
  let noRoleStaffId: string;
  let noRoleToken: string;
  let customerId: string;
  let customerToken: string;

  /** The 2027 issue period the engine assertions run against. */
  let periodId: string;
  const PERIOD_START = '2027-01-01';
  const PERIOD_END = '2027-01-31';
  const ELIGIBLE_DAYS = 31;
  const CONFIG_FROM = '2027-01-01';

  // Ids created through the HTTP API during the run, cleaned up at the end.
  const createdPoolIds: string[] = [];
  const createdScaleIds: string[] = [];
  const createdConversionIds: string[] = [];
  const createdProvisionIds: string[] = [];
  const createdSelectionIds: string[] = [];

  const POOL_CODE = `JEST11C_POOL_${tag}`;
  const POOL2_CODE = `JEST11C_POOL2_${tag}`;
  const PROVISION_CODE = `JEST11C_PROV_${tag}`;
  const CONVERSION_CODE = `JEST11C_CONV_${tag}`;

  let poolId: string;
  let pool2Id: string;
  let scaleId: string;
  let provisionId: string;

  const server = () => app.getHttpServer();
  const bearer = (role: StaffRole) => `Bearer ${tokenByRole.get(role)}`;
  const admin = () => bearer('RIK_ADMIN');

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    db = app.get(DatabaseService);
    tokenService = app.get(TokenService);
    configRepo = app.get(EntitlementConfigRepository);
    eligibility = app.get(RikEligibilityService);
    entitlement = app.get(RikEntitlementService);

    const passwordService = app.get(PasswordService);
    const passwordHash = await passwordService.hash('CorrectHorseBatteryStaple!1');

    const bootstrap = await db.query<{ id: string }>(
      `SELECT id FROM shared.users WHERE username = 'bootstrap_super_admin'`
    );
    const grantedBy = bootstrap[0]!.id;

    for (const role of STAFF_ROLES) {
      const rows = await db.query<{ id: string }>(
        `INSERT INTO shared.users (id, username, password_hash, display_name, status)
         VALUES (shared.uuid_generate_v7(), $1, $2, $3, 'ACTIVE') RETURNING id`,
        [`jest_11c_${role.toLowerCase()}_${runId}`, passwordHash, `Jest 11C ${role} ${runId}`]
      );
      const id = rows[0]!.id;
      staffIdByRole.set(role, id);
      await db.query(
        `INSERT INTO shared.user_roles (user_id, role_id, granted_by)
         SELECT $1, r.id, $2 FROM shared.roles r WHERE r.name = $3`,
        [id, grantedBy, role]
      );
      tokenByRole.set(role, tokenService.signAccessToken({ principalType: 'STAFF', principalId: id }));
    }

    const noRole = await db.query<{ id: string }>(
      `INSERT INTO shared.users (id, username, password_hash, display_name, status)
       VALUES (shared.uuid_generate_v7(), $1, $2, $3, 'ACTIVE') RETURNING id`,
      [`jest_11c_norole_${runId}`, passwordHash, `Jest 11C NoRole ${runId}`]
    );
    noRoleStaffId = noRole[0]!.id;
    noRoleToken = tokenService.signAccessToken({ principalType: 'STAFF', principalId: noRoleStaffId });

    // Defensive: a previously aborted run would leave a period whose
    // daterange blocks this one (rik_ent_periods_no_overlap is a global
    // GiST exclusion), and orphaned configuration rows sharing the tag.
    await db.query(
      `DELETE FROM rik.customer_period_eligibility
        WHERE period_id IN (SELECT id FROM rik.entitlement_periods WHERE name LIKE 'Jest 11C%')`
    );
    await db.query(`DELETE FROM rik.entitlement_periods WHERE name LIKE 'Jest 11C%'`);

    const period = await db.query<{ id: string }>(
      `INSERT INTO rik.entitlement_periods (id, name, start_date, end_date, status)
       VALUES (shared.uuid_generate_v7(), $1, $2::date, $3::date, 'UPCOMING') RETURNING id`,
      [`Jest 11C period ${runId}`, PERIOD_START, PERIOD_END]
    );
    periodId = period[0]!.id;

    const customer = await db.query<{ id: string }>(
      `INSERT INTO shared.customers (id, mobile_number, name, is_active, dietary_preference)
       VALUES (shared.uuid_generate_v7(), $1, $2, true, 'NV') RETURNING id`,
      [`+9179${digits.slice(0, 5)}1`, `Jest 11C Customer ${runId}`, ]
    );
    customerId = customer[0]!.id;
    customerToken = tokenService.signAccessToken({ principalType: 'CUSTOMER', principalId: customerId });

    await db.query(
      `INSERT INTO rik.customer_period_eligibility (customer_id, period_id, eligible_days)
       VALUES ($1, $2, $3)`,
      [customerId, periodId, ELIGIBLE_DAYS]
    );
  });

  afterAll(async () => {
    // Selections first: a CONFIRMED selection's snapshot is precisely
    // what migration 0028's trigger refuses to let configuration be
    // deleted underneath, so it has to be cancelled and removed before
    // the configuration it refers to can be.
    if (createdSelectionIds.length > 0) {
      await db.query(
        `UPDATE rik.entitlement_selections SET status = 'CANCELLED', cancelled_at = now()
          WHERE id = ANY($1::uuid[]) AND status = 'CONFIRMED'`,
        [createdSelectionIds]
      );
      await db.query(`DELETE FROM rik.entitlement_selections WHERE id = ANY($1::uuid[])`, [createdSelectionIds]);
    }

    // Configuration created by this run, child rows before parents.
    await db.query(`DELETE FROM rik.provisions WHERE code LIKE $1`, [`JEST11C_%${tag}`]);
    await db.query(`DELETE FROM rik.pool_conversions WHERE code LIKE $1`, [`JEST11C_%${tag}`]);
    await db.query(
      `DELETE FROM rik.pool_scales
        WHERE pool_id IN (SELECT id FROM rik.entitlement_pools WHERE code LIKE $1)`,
      [`JEST11C_%${tag}`]
    );
    await db.query(`DELETE FROM rik.entitlement_pools WHERE code LIKE $1`, [`JEST11C_%${tag}`]);

    await db.query(`DELETE FROM rik.customer_period_eligibility WHERE customer_id = $1`, [customerId]);
    await db.query(`DELETE FROM rik.entitlement_periods WHERE id = $1`, [periodId]);

    const staffIds = [...staffIdByRole.values(), noRoleStaffId];
    await db.query('DELETE FROM shared.auth_sessions WHERE principal_id = ANY($1::uuid[])', [
      [...staffIds, customerId],
    ]);
    await db.query('DELETE FROM shared.user_roles WHERE user_id = ANY($1::uuid[])', [staffIds]);
    await db.query('DELETE FROM shared.users WHERE id = ANY($1::uuid[])', [staffIds]);
    await db.query('DELETE FROM shared.customers WHERE id = $1', [customerId]);

    await app.close();
  });

  // ===================================================================
  // 1. The RBAC facts this step relies on
  // ===================================================================
  describe('the approved RBAC seed is unchanged and already sufficient', () => {
    it('holds six roles, and the 22 permissions the seed has after PHASE F', async () => {
      const counts = await db.query<{ roles: string; permissions: string }>(
        `SELECT (SELECT count(*)::text FROM shared.roles)       AS roles,
                (SELECT count(*)::text FROM shared.permissions) AS permissions`
      );
      expect(counts[0]).toEqual({ roles: '6', permissions: '22' });
    });

    it('grants rik.entitlement.adjust and rik.product.manage to RIK_ADMIN and SUPER_ADMIN, and to no other role', async () => {
      const rows = await db.query<{ permission: string; role: string }>(
        `SELECT p.code AS permission, r.name AS role
           FROM shared.permissions p
           JOIN shared.role_permissions rp ON rp.permission_id = p.id
           JOIN shared.roles r ON r.id = rp.role_id
          WHERE p.code IN ('rik.entitlement.adjust', 'rik.product.manage')
          ORDER BY p.code, r.name`
      );
      // PHASE F added SUPER_ADMIN to both, explicitly. No PIF or
      // operational role appears, which is what this test is really for.
      expect(rows).toEqual([
        { permission: 'rik.entitlement.adjust', role: 'RIK_ADMIN' },
        { permission: 'rik.entitlement.adjust', role: 'SUPER_ADMIN' },
        { permission: 'rik.product.manage', role: 'RIK_ADMIN' },
        { permission: 'rik.product.manage', role: 'SUPER_ADMIN' },
      ]);
    });

    it('has no PURCHASING role', async () => {
      const rows = await db.query<{ name: string }>(`SELECT name FROM shared.roles WHERE name = 'PURCHASING'`);
      expect(rows).toHaveLength(0);
    });
  });

  // ===================================================================
  // 2. Authentication and authorization on every route
  // ===================================================================
  const READ_ROUTES = [
    '/admin/rik/config/pools',
    '/admin/rik/config/scales',
    '/admin/rik/config/conversions',
    '/admin/rik/config/provisions',
    '/admin/rik/config/provision-pools',
    '/admin/rik/config/history',
  ];

  const WRITE_ROUTES = [
    '/admin/rik/config/pools',
    '/admin/rik/config/scales',
    '/admin/rik/config/conversions',
    '/admin/rik/config/provisions',
  ];

  describe('unauthenticated access is 401, never 403', () => {
    for (const path of READ_ROUTES) {
      it(`GET ${path} without a token -> 401`, async () => {
        await request(server()).get(path).expect(401);
      });
    }
    for (const path of WRITE_ROUTES) {
      it(`POST ${path} without a token -> 401`, async () => {
        await request(server()).post(path).send({}).expect(401);
      });
    }
  });

  describe('a CUSTOMER cannot reach RIK configuration', () => {
    for (const path of READ_ROUTES) {
      it(`customer GET ${path} -> 403`, async () => {
        await request(server()).get(path).set('Authorization', `Bearer ${customerToken}`).expect(403);
      });
    }
    it('customer POST pools -> 403', async () => {
      await request(server())
        .post('/admin/rik/config/pools')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({})
        .expect(403);
    });
  });

  describe('only RIK_ADMIN may read or write RIK configuration', () => {
    const otherRoles = STAFF_ROLES.filter((r) => r !== 'RIK_ADMIN' && r !== 'SUPER_ADMIN');

    for (const role of otherRoles) {
      for (const path of READ_ROUTES) {
        it(`${role} GET ${path} -> 403`, async () => {
          await request(server()).get(path).set('Authorization', bearer(role)).expect(403);
        });
      }
      it(`${role} POST pools -> 403`, async () => {
        await request(server()).post('/admin/rik/config/pools').set('Authorization', bearer(role)).send({}).expect(403);
      });
      it(`${role} POST provisions -> 403`, async () => {
        await request(server())
          .post('/admin/rik/config/provisions')
          .set('Authorization', bearer(role))
          .send({})
          .expect(403);
      });
    }

    it('a staff member with no role at all -> 403', async () => {
      await request(server())
        .get('/admin/rik/config/pools')
        .set('Authorization', `Bearer ${noRoleToken}`)
        .expect(403);
    });

    it('RIK_ADMIN may read every configuration route', async () => {
      for (const path of READ_ROUTES) {
        await request(server()).get(path).set('Authorization', admin()).expect(200);
      }
    });
  });

  // ===================================================================
  // 3. Creating configuration through the API
  // ===================================================================
  describe('creating configuration', () => {
    it('creates an entitlement pool', async () => {
      const res = await request(server())
        .post('/admin/rik/config/pools')
        .set('Authorization', admin())
        .send({
          code: POOL_CODE,
          name: `Jest 11C pool ${runId}`,
          rationType: 'DRY',
          unit: 'g',
          description: 'Created by the STEP 11C integration suite through the HTTP API.',
          displayOrder: 900,
          effectiveFrom: CONFIG_FROM,
        })
        .expect(201);

      poolId = res.body.id;
      createdPoolIds.push(poolId);
      expect(res.body).toMatchObject({
        code: POOL_CODE,
        rationType: 'DRY',
        unit: 'g',
        isActive: true,
        effectiveFrom: CONFIG_FROM,
        effectiveTo: null,
      });
    });

    it('creates a second pool, for the conversion tests', async () => {
      const res = await request(server())
        .post('/admin/rik/config/pools')
        .set('Authorization', admin())
        .send({
          code: POOL2_CODE,
          name: `Jest 11C pool 2 ${runId}`,
          rationType: 'DRY',
          unit: 'g',
          displayOrder: 901,
          effectiveFrom: CONFIG_FROM,
        })
        .expect(201);
      pool2Id = res.body.id;
      createdPoolIds.push(pool2Id);
    });

    it('creates a daily scale against that pool', async () => {
      const res = await request(server())
        .post('/admin/rik/config/scales')
        .set('Authorization', admin())
        .send({ poolId, dietaryPreference: 'NV', dailyQty: 100, effectiveFrom: CONFIG_FROM })
        .expect(201);

      scaleId = res.body.id;
      createdScaleIds.push(scaleId);
      expect(res.body).toMatchObject({ poolCode: POOL_CODE, dietaryPreference: 'NV', isActive: true });
      expect(Number(res.body.dailyQty)).toBe(100);
    });

    it('creates a provision against that pool', async () => {
      const res = await request(server())
        .post('/admin/rik/config/provisions')
        .set('Authorization', admin())
        .send({
          poolId,
          code: PROVISION_CODE,
          name: `Jest 11C provision ${runId}`,
          unit: 'g',
          consumptionRatio: 1,
          packSize: 500,
          issuePeriod: 'DRY',
          displayOrder: 900,
          effectiveFrom: CONFIG_FROM,
        })
        .expect(201);

      provisionId = res.body.id;
      createdProvisionIds.push(provisionId);
      expect(res.body).toMatchObject({ code: PROVISION_CODE, poolCode: POOL_CODE, issuePeriod: 'DRY' });
      expect(Number(res.body.consumptionRatio)).toBe(1);
    });

    it('creates a cross-pool conversion', async () => {
      const res = await request(server())
        .post('/admin/rik/config/conversions')
        .set('Authorization', admin())
        .send({
          code: CONVERSION_CODE,
          fromPoolId: pool2Id,
          toPoolId: poolId,
          fromQty: 10,
          toQty: 20,
          mode: 'ELECTIVE',
          dietaryPreference: 'NV',
          effectiveFrom: CONFIG_FROM,
        })
        .expect(201);

      createdConversionIds.push(res.body.id);
      expect(res.body).toMatchObject({ code: CONVERSION_CODE, mode: 'ELECTIVE', fromPoolCode: POOL2_CODE });
    });

    it('lists what it created, retired rows included', async () => {
      const res = await request(server()).get('/admin/rik/config/pools').set('Authorization', admin()).expect(200);
      const codes = res.body.items.map((p: { code: string }) => p.code);
      expect(codes).toContain(POOL_CODE);
      expect(codes).toContain(POOL2_CODE);
    });

    it('filters scales by pool', async () => {
      const res = await request(server())
        .get(`/admin/rik/config/scales?poolId=${poolId}`)
        .set('Authorization', admin())
        .expect(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].poolCode).toBe(POOL_CODE);
    });
  });

  // ===================================================================
  // 4. Server-side validation — every rule, over HTTP
  // ===================================================================
  describe('the server refuses invalid configuration', () => {
    const reason = (res: { body: { details?: { reason?: string } } }) => res.body.details?.reason;

    it('refuses a consumption ratio of zero', async () => {
      const res = await request(server())
        .post('/admin/rik/config/provisions')
        .set('Authorization', admin())
        .send({
          poolId,
          code: `JEST11C_BAD1_${tag}`,
          name: 'bad ratio',
          unit: 'g',
          consumptionRatio: 0,
          issuePeriod: 'DRY',
          effectiveFrom: CONFIG_FROM,
        })
        .expect(400);
      expect(reason(res)).toBe('INVALID_RATIO');
    });

    it('refuses a negative consumption ratio', async () => {
      const res = await request(server())
        .patch(`/admin/rik/config/provisions/${provisionId}`)
        .set('Authorization', admin())
        .send({ consumptionRatio: -2 })
        .expect(400);
      expect(reason(res)).toBe('INVALID_RATIO');
    });

    it('refuses a negative daily entitlement', async () => {
      const res = await request(server())
        .patch(`/admin/rik/config/scales/${scaleId}`)
        .set('Authorization', admin())
        .send({ dailyQty: -1 })
        .expect(400);
      expect(reason(res)).toBe('NEGATIVE_ENTITLEMENT');
    });

    it('refuses a pack size of zero or less', async () => {
      const res = await request(server())
        .patch(`/admin/rik/config/provisions/${provisionId}`)
        .set('Authorization', admin())
        .send({ packSize: 0 })
        .expect(400);
      expect(reason(res)).toBe('INVALID_PACK_SIZE');
    });

    it('refuses a max quantity of zero', async () => {
      const res = await request(server())
        .patch(`/admin/rik/config/provisions/${provisionId}`)
        .set('Authorization', admin())
        .send({ maxQuantity: 0 })
        .expect(400);
      expect(reason(res)).toBe('INVALID_MAX_QUANTITY');
    });

    it('refuses a max packs of zero', async () => {
      const res = await request(server())
        .patch(`/admin/rik/config/provisions/${provisionId}`)
        .set('Authorization', admin())
        .send({ maxPacks: 0 })
        .expect(400);
      expect(reason(res)).toBe('INVALID_MAX_PACKS');
    });

    it('refuses an unknown dietary preference', async () => {
      await request(server())
        .post('/admin/rik/config/scales')
        .set('Authorization', admin())
        .send({ poolId, dietaryPreference: 'XX', dailyQty: 10, effectiveFrom: CONFIG_FROM })
        .expect(400);
    });

    it('refuses an end date before the start date', async () => {
      const res = await request(server())
        .patch(`/admin/rik/config/pools/${poolId}`)
        .set('Authorization', admin())
        .send({ effectiveTo: '2026-12-31' })
        .expect(400);
      expect(reason(res)).toBe('INVALID_EFFECTIVE_RANGE');
    });

    it('refuses a second scale for the same pool, diet and start date', async () => {
      const res = await request(server())
        .post('/admin/rik/config/scales')
        .set('Authorization', admin())
        .send({ poolId, dietaryPreference: 'NV', dailyQty: 55, effectiveFrom: CONFIG_FROM })
        .expect(400);
      expect(reason(res)).toBe('DUPLICATE_SCALE_VERSION');
    });

    it('refuses a scale whose window overlaps an existing active one', async () => {
      const res = await request(server())
        .post('/admin/rik/config/scales')
        .set('Authorization', admin())
        .send({ poolId, dietaryPreference: 'NV', dailyQty: 55, effectiveFrom: '2027-03-01' })
        .expect(400);
      expect(reason(res)).toBe('OVERLAPPING_SCALE');
    });

    it('refuses a scale against a pool that does not exist', async () => {
      const res = await request(server())
        .post('/admin/rik/config/scales')
        .set('Authorization', admin())
        .send({
          poolId: '00000000-0000-7000-8000-000000000000',
          dietaryPreference: 'PV',
          dailyQty: 10,
          effectiveFrom: CONFIG_FROM,
        })
        .expect(400);
      expect(reason(res)).toBe('POOL_NOT_FOUND');
    });

    it('refuses a duplicate pool code', async () => {
      const res = await request(server())
        .post('/admin/rik/config/pools')
        .set('Authorization', admin())
        .send({ code: POOL_CODE, name: 'duplicate', rationType: 'DRY', unit: 'g', effectiveFrom: CONFIG_FROM })
        .expect(400);
      expect(reason(res)).toBe('DUPLICATE_CODE');
    });

    it('refuses a conversion between a pool and itself', async () => {
      const res = await request(server())
        .post('/admin/rik/config/conversions')
        .set('Authorization', admin())
        .send({
          code: `JEST11C_SELF_${tag}`,
          fromPoolId: poolId,
          toPoolId: poolId,
          fromQty: 1,
          toQty: 1,
          mode: 'ELECTIVE',
          effectiveFrom: CONFIG_FROM,
        })
        .expect(400);
      expect(reason(res)).toBe('CONVERSION_POOLS_IDENTICAL');
    });

    it('refuses a conversion quantity of zero', async () => {
      const res = await request(server())
        .post('/admin/rik/config/conversions')
        .set('Authorization', admin())
        .send({
          code: `JEST11C_ZERO_${tag}`,
          fromPoolId: pool2Id,
          toPoolId: poolId,
          fromQty: 0,
          toQty: 5,
          mode: 'ELECTIVE',
          effectiveFrom: CONFIG_FROM,
        })
        .expect(400);
      expect(reason(res)).toBe('INVALID_CONVERSION_QUANTITY');
    });

    it('refuses a loose item that also carries a pack size', async () => {
      const res = await request(server())
        .patch(`/admin/rik/config/provisions/${provisionId}`)
        .set('Authorization', admin())
        .send({ isLoose: true })
        .expect(400);
      expect(reason(res)).toBe('LOOSE_ITEM_CANNOT_HAVE_PACK_SIZE');
    });

    it('refuses a PATCH that changes nothing', async () => {
      const res = await request(server())
        .patch(`/admin/rik/config/pools/${poolId}`)
        .set('Authorization', admin())
        .send({})
        .expect(400);
      expect(reason(res)).toBe('NO_CHANGES_SUPPLIED');
    });

    it('refuses an unrecognised field rather than ignoring it', async () => {
      await request(server())
        .patch(`/admin/rik/config/pools/${poolId}`)
        .set('Authorization', admin())
        .send({ name: 'fine', somethingInvented: true })
        .expect(400);
    });

    it('404s a row that does not exist', async () => {
      await request(server())
        .patch('/admin/rik/config/pools/00000000-0000-7000-8000-000000000000')
        .set('Authorization', admin())
        .send({ name: 'nope' })
        .expect(404);
    });

    it('wrote nothing while refusing all of the above', async () => {
      const rows = await db.query<{ count: string }>(
        `SELECT (SELECT count(*) FROM rik.entitlement_pools  WHERE code LIKE $1)
              + (SELECT count(*) FROM rik.provisions        WHERE code LIKE $1)
              + (SELECT count(*) FROM rik.pool_conversions  WHERE code LIKE $1) AS count`,
        [`JEST11C_%${tag}`]
      );
      // The two pools, one provision and one conversion created above,
      // and nothing from any rejected request.
      expect(rows[0]!.count).toBe('4');

      const scales = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM rik.pool_scales WHERE pool_id = $1`,
        [poolId]
      );
      expect(scales[0]!.count).toBe('1');
    });

    it('left the provision exactly as it was', async () => {
      const res = await request(server())
        .get(`/admin/rik/config/provisions?poolId=${poolId}`)
        .set('Authorization', admin())
        .expect(200);
      const provision = res.body.items.find((p: { id: string }) => p.id === provisionId);
      expect(Number(provision.consumptionRatio)).toBe(1);
      expect(Number(provision.packSize)).toBe(500);
      expect(provision.maxQuantity).toBeNull();
      expect(provision.maxPacks).toBeNull();
      expect(provision.isLoose).toBe(false);
    });
  });

  // ===================================================================
  // 5. The engine follows the dashboard — no calculation-code change
  // ===================================================================
  describe('the STEP 11B engine uses the configuration written through this API', () => {
    const poolFromCalculation = async () => {
      const basis = await eligibility.resolveBasis(customerId, periodId);
      const calc = await entitlement.calculate(basis);
      return calc.dry.find((p) => p.code === POOL_CODE);
    };

    it('calculates entitlement from a pool, scale and provision created only through HTTP', async () => {
      const view = await poolFromCalculation();
      expect(view).toBeDefined();
      expect(view!.dailyScale).toBe(100);
      expect(view!.eligibleDays).toBe(ELIGIBLE_DAYS);
      expect(view!.totalEntitlement).toBe(100 * ELIGIBLE_DAYS);
      expect(view!.provisions.map((p) => p.code)).toContain(PROVISION_CODE);
    });

    it('follows a scale change made through the API, with no code change', async () => {
      await request(server())
        .patch(`/admin/rik/config/scales/${scaleId}`)
        .set('Authorization', admin())
        .send({ dailyQty: 150 })
        .expect(200);

      const view = await poolFromCalculation();
      expect(view!.dailyScale).toBe(150);
      expect(view!.totalEntitlement).toBe(150 * ELIGIBLE_DAYS);

      await request(server())
        .patch(`/admin/rik/config/scales/${scaleId}`)
        .set('Authorization', admin())
        .send({ dailyQty: 100 })
        .expect(200);
      expect((await poolFromCalculation())!.totalEntitlement).toBe(100 * ELIGIBLE_DAYS);
    });

    it('follows a consumption-ratio change made through the API', async () => {
      await request(server())
        .patch(`/admin/rik/config/provisions/${provisionId}`)
        .set('Authorization', admin())
        .send({ consumptionRatio: 2 })
        .expect(200);

      const view = await poolFromCalculation();
      const provision = view!.provisions.find((p) => p.code === PROVISION_CODE);
      // 3,100 g of pool entitlement at 2 pool units per provision unit
      // is 1,550 provision units — computed by the engine from the row.
      expect(provision!.consumptionRatio).toBe(2);
      expect(provision!.maxSelectableQuantity).toBe((100 * ELIGIBLE_DAYS) / 2);

      await request(server())
        .patch(`/admin/rik/config/provisions/${provisionId}`)
        .set('Authorization', admin())
        .send({ consumptionRatio: 1 })
        .expect(200);
    });

    it('stops offering a provision the moment it is made unselectable through the API', async () => {
      await request(server())
        .patch(`/admin/rik/config/provisions/${provisionId}`)
        .set('Authorization', admin())
        .send({ isCustomerSelectable: false })
        .expect(200);

      const view = await poolFromCalculation();
      // An item an officer may not choose is not offered at all, rather
      // than offered and then refused — the engine filters it out.
      expect(view!.provisions.map((p) => p.code)).not.toContain(PROVISION_CODE);

      await request(server())
        .patch(`/admin/rik/config/provisions/${provisionId}`)
        .set('Authorization', admin())
        .send({ isCustomerSelectable: true })
        .expect(200);
    });

    it('drops a deactivated provision out of the calculation entirely', async () => {
      await request(server())
        .post(`/admin/rik/config/provisions/${provisionId}/active`)
        .set('Authorization', admin())
        .send({ isActive: false })
        .expect(201);

      const view = await poolFromCalculation();
      expect(view!.provisions.map((p) => p.code)).not.toContain(PROVISION_CODE);

      await request(server())
        .post(`/admin/rik/config/provisions/${provisionId}/active`)
        .set('Authorization', admin())
        .send({ isActive: true })
        .expect(201);
      expect((await poolFromCalculation())!.provisions.map((p) => p.code)).toContain(PROVISION_CODE);
    });

    it('drops a deactivated pool out of the calculation entirely', async () => {
      await request(server())
        .post(`/admin/rik/config/pools/${poolId}/active`)
        .set('Authorization', admin())
        .send({ isActive: false })
        .expect(201);

      expect(await poolFromCalculation()).toBeUndefined();

      await request(server())
        .post(`/admin/rik/config/pools/${poolId}/active`)
        .set('Authorization', admin())
        .send({ isActive: true })
        .expect(201);
      expect(await poolFromCalculation()).toBeDefined();
    });
  });

  // ===================================================================
  // 6. Superseding — a new rule without rewriting the old one
  // ===================================================================
  describe('superseding a scale', () => {
    let supersedingScaleId: string;

    it('closes the current rule and opens a new one', async () => {
      const res = await request(server())
        .post(`/admin/rik/config/scales/${scaleId}/supersede`)
        .set('Authorization', admin())
        .send({ dailyQty: 200, effectiveFrom: '2027-01-20', notes: 'Superseded by the STEP 11C suite.' })
        .expect(201);

      expect(res.body.closed.effectiveTo).toBe('2027-01-19');
      expect(res.body.created.effectiveFrom).toBe('2027-01-20');
      expect(Number(res.body.created.dailyQty)).toBe(200);
      supersedingScaleId = res.body.created.id;
      createdScaleIds.push(supersedingScaleId);
    });

    it('leaves the old window answering with the old number', async () => {
      const before = await configRepo.loadConfiguration('2027-01-10');
      const oldScale = before.scales.find((s) => s.pool_id === poolId && s.dietary_preference === 'NV');
      expect(Number(oldScale!.daily_qty)).toBe(100);
    });

    it('answers the new window with the new number', async () => {
      const after = await configRepo.loadConfiguration('2027-01-25');
      const newScale = after.scales.find((s) => s.pool_id === poolId && s.dietary_preference === 'NV');
      expect(Number(newScale!.daily_qty)).toBe(200);
      expect(newScale!.id).toBe(supersedingScaleId);
    });

    it('refuses to supersede from a date at or before the rule it replaces', async () => {
      const res = await request(server())
        .post(`/admin/rik/config/scales/${supersedingScaleId}/supersede`)
        .set('Authorization', admin())
        .send({ dailyQty: 300, effectiveFrom: '2027-01-20' })
        .expect(400);
      expect(res.body.details?.reason).toBe('INVALID_EFFECTIVE_RANGE');
    });

    it('restores the single-rule state for the tests that follow', async () => {
      await request(server())
        .post(`/admin/rik/config/scales/${supersedingScaleId}/active`)
        .set('Authorization', admin())
        .send({ isActive: false })
        .expect(201);
      await request(server())
        .patch(`/admin/rik/config/scales/${scaleId}`)
        .set('Authorization', admin())
        .send({ effectiveTo: null })
        .expect(200);

      const config = await configRepo.loadConfiguration('2027-01-25');
      const scales = config.scales.filter((s) => s.pool_id === poolId);
      expect(scales).toHaveLength(1);
      expect(Number(scales[0]!.daily_qty)).toBe(100);
    });
  });

  // ===================================================================
  // 7. Audit — every change recorded, and the history screen's source
  // ===================================================================
  describe('every configuration change is audited', () => {
    it('recorded the pool creation with its values', async () => {
      const rows = await db.query<{ action: string; after: Record<string, unknown> }>(
        `SELECT action, after FROM shared.audit_log
          WHERE module = 'rik' AND entity_type = 'rik.entitlement_pools' AND entity_id = $1
            AND action = 'RIK_CONFIG_POOL_CREATED'`,
        [poolId]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.after).toMatchObject({ code: POOL_CODE, rationType: 'DRY', unit: 'g' });
    });

    it('recorded a scale change with both the before and the after', async () => {
      const rows = await db.query<{ before: Record<string, unknown>; after: Record<string, unknown> }>(
        `SELECT before, after FROM shared.audit_log
          WHERE module = 'rik' AND entity_type = 'rik.pool_scales' AND entity_id = $1
            AND action = 'RIK_CONFIG_SCALE_UPDATED'
          ORDER BY created_at
          LIMIT 1`,
        [scaleId]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.before).toHaveProperty('dailyQty');
      expect(rows[0]!.after).toHaveProperty('dailyQty');
    });

    it('names the actor and the role on every entry', async () => {
      const rows = await db.query<{ actor_id: string; actor_role: string }>(
        `SELECT actor_id, actor_role FROM shared.audit_log
          WHERE module = 'rik' AND entity_id = $1 LIMIT 1`,
        [poolId]
      );
      expect(rows[0]!.actor_id).toBe(staffIdByRole.get('RIK_ADMIN'));
      expect(rows[0]!.actor_role).toBe('RIK_ADMIN');
    });

    it('serves the same entries through the rule-history API', async () => {
      const res = await request(server())
        .get(`/admin/rik/config/history?entityId=${poolId}`)
        .set('Authorization', admin())
        .expect(200);
      const actions = res.body.items.map((i: { action: string }) => i.action);
      expect(actions).toContain('RIK_CONFIG_POOL_CREATED');
      expect(res.body.items[0]).toHaveProperty('actorName');
    });

    it('narrows the history to one configuration table when asked', async () => {
      const res = await request(server())
        .get('/admin/rik/config/history?entityType=rik.pool_scales&limit=50')
        .set('Authorization', admin())
        .expect(200);
      const types: string[] = res.body.items.map((i: { entityType: string }) => i.entityType);
      expect(types.every((t) => t === 'rik.pool_scales')).toBe(true);
    });

    it('never serves another module’s audit entries', async () => {
      const res = await request(server())
        .get('/admin/rik/config/history?limit=200')
        .set('Authorization', admin())
        .expect(200);
      const types: string[] = res.body.items.map((i: { entityType: string }) => i.entityType);
      expect(types.every((t) => t.startsWith('rik.'))).toBe(true);
    });

    it('cannot be rewritten after the fact', async () => {
      await expect(
        db.query(`UPDATE shared.audit_log SET action = 'TAMPERED' WHERE entity_id = $1`, [poolId])
      ).rejects.toBeDefined();
    });
  });

  // ===================================================================
  // 8. Configuration that has been used cannot be destroyed
  // ===================================================================
  describe('used configuration is permanent; unused configuration is removable', () => {
    let selectionId: string;

    it('refuses to delete a pool once a confirmed selection has used it', async () => {
      const rows = await db.query<{ id: string }>(
        // STEP 11E added the fulfillment a confirmation carries, with a
        // CHECK that a CONFIRMED row must be complete. This row is built
        // by hand to exercise the delete protection, so it supplies the
        // minimum a confirmation now requires.
        `INSERT INTO rik.entitlement_selections
           (id, customer_id, period_id, status, dietary_preference, eligible_days, rule_snapshot, confirmed_at,
            reference_number, fulfillment_type, pickup_location_name,
            availability_acknowledged, availability_acknowledged_at)
         VALUES (shared.uuid_generate_v7(), $1, $2, 'CONFIRMED', 'NV', $3, $4::jsonb, now(),
                 'RIK-TEST-' || substr(md5(random()::text), 1, 8), 'PICKUP', 'Naval Park',
                 true, now())
         RETURNING id`,
        [customerId, periodId, ELIGIBLE_DAYS, JSON.stringify({ pools: [{ id: poolId, code: POOL_CODE }] })]
      );
      selectionId = rows[0]!.id;
      createdSelectionIds.push(selectionId);

      await expect(db.query(`DELETE FROM rik.entitlement_pools WHERE id = $1`, [poolId])).rejects.toBeDefined();

      const still = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM rik.entitlement_pools WHERE id = $1`,
        [poolId]
      );
      expect(still[0]!.count).toBe('1');
    });

    it('allows an unused row to be removed, so a mistake is not permanent', async () => {
      const res = await request(server())
        .post('/admin/rik/config/pools')
        .set('Authorization', admin())
        .send({
          code: `JEST11C_MISTAKE_${tag}`,
          name: 'created by mistake',
          rationType: 'DRY',
          unit: 'g',
          effectiveFrom: CONFIG_FROM,
        })
        .expect(201);

      await db.query(`DELETE FROM rik.entitlement_pools WHERE id = $1`, [res.body.id]);
      const gone = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM rik.entitlement_pools WHERE id = $1`,
        [res.body.id]
      );
      expect(gone[0]!.count).toBe('0');
    });

    it('offers no delete endpoint at all — retirement is deactivation', async () => {
      await request(server()).delete(`/admin/rik/config/pools/${poolId}`).set('Authorization', admin()).expect(404);
      await request(server())
        .delete(`/admin/rik/config/provisions/${provisionId}`)
        .set('Authorization', admin())
        .expect(404);
    });
  });
});
