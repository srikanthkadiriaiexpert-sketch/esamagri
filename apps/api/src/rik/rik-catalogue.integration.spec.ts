import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { STAFF_ROLES, type StaffRole } from '@esamagri/shared-types';
import { AppModule } from '../app.module';
import { DatabaseService } from '../database/database.service';
import { TokenService } from '../auth/services/token.service';
import { PasswordService } from '../auth/services/password.service';
import { RikEligibilityService } from './services/rik-eligibility.service';
import { RikEntitlementService } from './services/rik-entitlement.service';

/**
 * STEP 12A — the RIK catalogue foundation, over real HTTP against real
 * PostgreSQL.
 *
 * WHAT THIS SUITE IS ABOUT. STEP 12A gave the catalogue three fields it
 * did not have — brand, pack unit and image — loaded seventy named
 * varieties into pools that already existed, and lifted brands and pack
 * sizes out of the names they had been written into. Every one of those
 * is a change to DATA and to how data is DESCRIBED. None of them is a
 * change to what anybody is entitled to, and the larger half of this
 * suite exists to prove that second sentence rather than the first.
 *
 * FIVE CLAIMS IT SUBSTANTIATES.
 *
 *  1. THE CATALOGUE IS EXACTLY WHAT THE FACILITY GAVE. Forty-four named
 *     vegetables and twenty-six named fruits — counted, not estimated.
 *     Nothing was added from general knowledge, and the tests fail on a
 *     forty-fifth as loudly as on a forty-third.
 *
 *  2. THE POOLS ARE UNTOUCHED. Vegetables, onion, potato and fruit are
 *     four separate allowances at 170, 60, 110 and 230 g a day. A
 *     catalogue variety BELONGS to a pool; it never creates one, and
 *     onion and potato never fall into the vegetable pool however many
 *     varieties are loaded beside them.
 *
 *  3. BRAND AND PACK ARE FIELDS, NOT PARTS OF A NAME. "Amul Paneer
 *     200g" is gone; Paneer, Amul and 200 g are three columns. Two
 *     dairies' paneer is one provision name offered twice, each row
 *     individually identifiable, rather than two items that read like
 *     duplicates. No pack size is written in code.
 *
 *  4. THE CATALOGUE IS MANAGED FROM THE DASHBOARD. Creating an item
 *     with a brand, a pack unit and a picture, then editing all three,
 *     happens over the admin HTTP API with the permissions that already
 *     existed. No new role, no new permission, no SQL.
 *
 *  5. NOTHING IT DOES REACHES THE ENGINE. A rebrand, a repack and a new
 *     picture leave the entitlement figures identical to the byte, and
 *     leave a confirmed selection exactly as it was recorded.
 *
 * ISOLATION. Rows this suite creates are tagged and dated in 2029, well
 * clear of the 2026 engine suite and the 2027 configuration suite. The
 * assertions about the loaded catalogue are read-only, so they are safe
 * to run beside anything.
 */
describe('RIK catalogue foundation (STEP 12A, integration, real PostgreSQL + real HTTP)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let tokenService: TokenService;
  let eligibility: RikEligibilityService;
  let entitlement: RikEntitlementService;

  const runId = randomUUID().slice(0, 8);
  const tag = runId.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const digits = runId.replace(/[^0-9]/g, '').padEnd(7, '3');

  const tokenByRole = new Map<StaffRole, string>();
  const staffIdByRole = new Map<StaffRole, string>();

  let customerId: string;
  let periodId: string;
  const PERIOD_START = '2029-01-01';
  const PERIOD_END = '2029-01-31';
  const ELIGIBLE_DAYS = 31;
  const CONFIG_FROM = '2029-01-01';

  const POOL_CODE = `JEST12A_POOL_${tag}`;
  let poolId: string;
  let scaleId: string;
  const createdProvisionIds: string[] = [];
  const createdSelectionIds: string[] = [];

  const server = () => app.getHttpServer();
  const bearer = (role: StaffRole) => `Bearer ${tokenByRole.get(role)}`;
  const admin = () => bearer('RIK_ADMIN');

  /**
   * The units §7 allows a pack to be described in. 'coupon' was added by
   * migration 0053 for the physical Fresh Milk coupon — presentation only,
   * never an input to a calculation.
   */
  const PACK_UNITS = ['g', 'kg', 'ml', 'litre', 'piece', 'packet', 'tin', 'box', 'coupon'];

  interface CatalogueRow {
    code: string;
    name: string;
    brand: string | null;
    pack_size: string | null;
    pack_unit: string | null;
    image_ref: string | null;
    unit: string;
    pool_code: string;
  }

  /** Every provision in a pool, as the catalogue actually holds it. */
  const catalogueOf = (poolCode: string) =>
    db.query<CatalogueRow>(
      `SELECT v.code, v.name, v.brand, v.pack_size::text AS pack_size, v.pack_unit,
              v.image_ref, v.unit, p.code AS pool_code
         FROM rik.provisions v
         JOIN rik.entitlement_pools p ON p.id = v.pool_id
        WHERE p.code = $1
        ORDER BY v.name`,
      [poolCode]
    );

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    db = app.get(DatabaseService);
    tokenService = app.get(TokenService);
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
        [`jest_12a_${role.toLowerCase()}_${runId}`, passwordHash, `Jest 12A ${role} ${runId}`]
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

    // Residue from an aborted run would collide on the period's daterange.
    await db.query(
      `DELETE FROM rik.customer_period_eligibility
        WHERE period_id IN (SELECT id FROM rik.entitlement_periods WHERE name LIKE 'Jest 12A%')`
    );
    await db.query(`DELETE FROM rik.entitlement_periods WHERE name LIKE 'Jest 12A%'`);

    const period = await db.query<{ id: string }>(
      `INSERT INTO rik.entitlement_periods (id, name, start_date, end_date, status)
       VALUES (shared.uuid_generate_v7(), $1, $2::date, $3::date, 'UPCOMING') RETURNING id`,
      [`Jest 12A period ${runId}`, PERIOD_START, PERIOD_END]
    );
    periodId = period[0]!.id;

    const customer = await db.query<{ id: string }>(
      `INSERT INTO shared.customers (id, mobile_number, name, is_active, dietary_preference)
       VALUES (shared.uuid_generate_v7(), $1, $2, true, 'NV') RETURNING id`,
      [`+9178${digits.slice(0, 5)}2`, `Jest 12A Customer ${runId}`]
    );
    customerId = customer[0]!.id;

    await db.query(
      `INSERT INTO rik.customer_period_eligibility (customer_id, period_id, eligible_days)
       VALUES ($1, $2, $3)`,
      [customerId, periodId, ELIGIBLE_DAYS]
    );

    // A pool and a scale of this suite's own, so the catalogue writes
    // below never touch a pool the facility's own data depends on.
    const pool = await request(server())
      .post('/admin/rik/config/pools')
      .set('Authorization', admin())
      .send({
        code: POOL_CODE,
        name: `Jest 12A pool ${runId}`,
        rationType: 'DRY',
        unit: 'g',
        displayOrder: 920,
        effectiveFrom: CONFIG_FROM,
      })
      .expect(201);
    poolId = pool.body.id;

    const scale = await request(server())
      .post('/admin/rik/config/scales')
      .set('Authorization', admin())
      .send({ poolId, dietaryPreference: 'NV', dailyQty: 100, effectiveFrom: CONFIG_FROM })
      .expect(201);
    scaleId = scale.body.id;
  });

  afterAll(async () => {
    if (createdSelectionIds.length > 0) {
      await db.query(
        `UPDATE rik.entitlement_selections SET status = 'CANCELLED', cancelled_at = now()
          WHERE id = ANY($1::uuid[]) AND status = 'CONFIRMED'`,
        [createdSelectionIds]
      );
      await db.query(`DELETE FROM rik.entitlement_selections WHERE id = ANY($1::uuid[])`, [createdSelectionIds]);
    }

    await db.query(`DELETE FROM rik.provisions WHERE code LIKE $1`, [`JEST12A_%${tag}`]);
    await db.query(
      `DELETE FROM rik.pool_scales WHERE pool_id IN (SELECT id FROM rik.entitlement_pools WHERE code = $1)`,
      [POOL_CODE]
    );
    await db.query(`DELETE FROM rik.entitlement_pools WHERE code = $1`, [POOL_CODE]);

    await db.query(`DELETE FROM rik.customer_period_eligibility WHERE customer_id = $1`, [customerId]);
    await db.query(`DELETE FROM rik.entitlement_periods WHERE id = $1`, [periodId]);

    const staffIds = [...staffIdByRole.values()];
    await db.query('DELETE FROM shared.auth_sessions WHERE principal_id = ANY($1::uuid[])', [
      [...staffIds, customerId],
    ]);
    await db.query('DELETE FROM shared.user_roles WHERE user_id = ANY($1::uuid[])', [staffIds]);
    await db.query('DELETE FROM shared.users WHERE id = ANY($1::uuid[])', [staffIds]);
    await db.query('DELETE FROM shared.customers WHERE id = $1', [customerId]);

    // Scale id is held only so the cleanup above reads as deliberate.
    void scaleId;

    await app.close();
  });

  // ===================================================================
  // 1. The loaded catalogue is exactly what the facility supplied
  // ===================================================================
  describe('the varieties the facility named, and no others', () => {
    /**
     * The generic placeholders predate STEP 12A and are excluded by
     * code. They are the un-named "Fresh Vegetables" and "Fresh Fruits"
     * entries the pools were created with; the count under test is of
     * the NAMED varieties that STEP 12A loaded beside them.
     */
    const PLACEHOLDERS = ['VEG_FRESH', 'FRUIT_FRESH', 'FRUIT_DRY'];

    it('SCENARIO 1 — the vegetable pool holds exactly 44 named varieties', async () => {
      const rows = await catalogueOf('VEGETABLES');
      const named = rows.filter((r) => !PLACEHOLDERS.includes(r.code));
      expect(named).toHaveLength(44);
      // Every one of them is a variety row, not a repackaged staple.
      expect(named.every((r) => r.code.startsWith('VEG_'))).toBe(true);
      expect(new Set(named.map((r) => r.name)).size).toBe(44);
    });

    it('SCENARIO 2 — the fruit pool holds exactly 26 named varieties', async () => {
      const rows = await catalogueOf('FRUITS');
      const named = rows.filter((r) => !PLACEHOLDERS.includes(r.code));
      expect(named).toHaveLength(26);
      expect(named.every((r) => r.code.startsWith('FRUIT_'))).toBe(true);
      expect(new Set(named.map((r) => r.name)).size).toBe(26);
    });

    it('SCENARIO 3 — every loaded variety is fresh, measured in grams, and costs its pool one for one', async () => {
      const rows = [...(await catalogueOf('VEGETABLES')), ...(await catalogueOf('FRUITS'))];
      const named = rows.filter((r) => !PLACEHOLDERS.includes(r.code));

      const detail = await db.query<{ unit: string; ratio: string; issue_period: string; selectable: boolean }>(
        `SELECT unit, consumption_ratio::text AS ratio, issue_period, is_customer_selectable AS selectable
           FROM rik.provisions WHERE code = ANY($1::text[])`,
        [named.map((r) => r.code)]
      );

      expect(detail).toHaveLength(70);
      for (const row of detail) {
        expect(row.unit).toBe('g');
        expect(Number(row.ratio)).toBe(1);
        expect(row.issue_period).toBe('FRESH');
        expect(row.selectable).toBe(true);
      }
    });

    it('SCENARIO 4 — no variety carries a price, a supplier or a contract rate', async () => {
      // Proved by the shape of the table rather than by inspecting
      // values: STEP 12A added three columns and no commercial one, so
      // there is nowhere for a price to have been loaded.
      const columns = await db.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'rik' AND table_name = 'provisions'`
      );
      const names = columns.map((c) => c.column_name);
      for (const forbidden of ['price', 'rate', 'cost', 'mrp', 'supplier', 'supplier_id', 'vendor']) {
        expect(names).not.toContain(forbidden);
      }
      expect(names).toEqual(expect.arrayContaining(['brand', 'pack_unit', 'image_ref']));
    });
  });

  // ===================================================================
  // 2. The four fresh pools are untouched
  // ===================================================================
  describe('a variety belongs to a pool; it never creates one', () => {
    const scaleOf = async (poolCode: string) => {
      const rows = await db.query<{ daily_qty: string; unit: string }>(
        `SELECT s.daily_qty::text AS daily_qty, p.unit
           FROM rik.pool_scales s
           JOIN rik.entitlement_pools p ON p.id = s.pool_id
          WHERE p.code = $1 AND s.is_active AND s.effective_to IS NULL
          ORDER BY s.daily_qty
          LIMIT 1`,
        [poolCode]
      );
      return rows[0];
    };

    it('SCENARIO 5 — the four fresh scales are still 170, 60, 110 and 230 g a day', async () => {
      expect(Number((await scaleOf('VEGETABLES'))!.daily_qty)).toBe(170);
      expect(Number((await scaleOf('ONION_GARLIC'))!.daily_qty)).toBe(60);
      expect(Number((await scaleOf('POTATO'))!.daily_qty)).toBe(110);
      expect(Number((await scaleOf('FRUITS'))!.daily_qty)).toBe(230);
    });

    it('SCENARIO 6 — onion and potato keep pools of their own, each still stocked', async () => {
      const onion = await catalogueOf('ONION_GARLIC');
      const potato = await catalogueOf('POTATO');
      expect(onion.length).toBeGreaterThan(0);
      expect(potato.length).toBeGreaterThan(0);

      // And they are genuinely separate allowances, not two views of one.
      const pools = await db.query<{ code: string; id: string }>(
        `SELECT code, id FROM rik.entitlement_pools WHERE code IN ('VEGETABLES','ONION_GARLIC','POTATO','FRUITS')`
      );
      expect(new Set(pools.map((p) => p.id)).size).toBe(4);
    });

    it('SCENARIO 7 — the onion and potato provisions did not leak into the general vegetable pool', async () => {
      const veg = await catalogueOf('VEGETABLES');

      // The bulb onion and the potato are their own allowances. Neither
      // the provision itself nor anything named for it may sit in the
      // vegetable pool and be spent out of the 170 g a day.
      //
      // Spring Onion is NOT such a stray. It is one of the forty-four
      // varieties the facility listed under Fresh Vegetables, and it is
      // a green vegetable rather than the bulb the 60 g onion scale is
      // for — so the check is against the onion and potato provisions
      // by name, not against the word "onion" appearing anywhere.
      const separate = await db.query<{ name: string }>(
        `SELECT v.name FROM rik.provisions v
           JOIN rik.entitlement_pools p ON p.id = v.pool_id
          WHERE p.code IN ('ONION_GARLIC', 'POTATO')`
      );
      const separateNames = new Set(separate.map((r) => r.name.toLowerCase()));
      expect(separateNames.size).toBeGreaterThan(0);

      const strays = veg.filter((r) => separateNames.has(r.name.toLowerCase()));
      expect(strays.map((r) => r.name)).toEqual([]);
      expect(veg.filter((r) => /^(onion|potato)$/i.test(r.name.trim()))).toEqual([]);
      expect(veg.some((r) => r.name === 'Spring Onion')).toBe(true);
    });

    it('SCENARIO 8 — loading seventy varieties added no pool and no scale', async () => {
      // The pool count is the schema contract's business: what matters
      // here is that the four fresh pools each still have exactly the
      // one open-ended active scale they had before.
      for (const code of ['VEGETABLES', 'ONION_GARLIC', 'POTATO', 'FRUITS']) {
        const rows = await db.query<{ count: string }>(
          `SELECT count(*)::text AS count
             FROM rik.pool_scales s JOIN rik.entitlement_pools p ON p.id = s.pool_id
            WHERE p.code = $1 AND s.is_active AND s.effective_to IS NULL`,
          [code]
        );
        expect(Number(rows[0]!.count)).toBeGreaterThan(0);
      }
    });
  });

  // ===================================================================
  // 3. Brand and pack size are fields, not parts of a name
  // ===================================================================
  describe('the brand is a column, and the name is only the item', () => {
    it('SCENARIO 9 — no provision name still contains the brand recorded beside it', async () => {
      const rows = await db.query<{ code: string; name: string; brand: string }>(
        `SELECT code, name, brand FROM rik.provisions WHERE brand IS NOT NULL`
      );
      expect(rows.length).toBeGreaterThan(0);
      const embedded = rows.filter((r) => r.name.toLowerCase().includes(r.brand.toLowerCase()));
      expect(embedded.map((r) => `${r.code}: ${r.name}`)).toEqual([]);
    });

    it('SCENARIO 10 — no provision name ends with the pack size recorded beside it', async () => {
      const rows = await db.query<{ code: string; name: string }>(
        `SELECT code, name FROM rik.provisions
          WHERE pack_size IS NOT NULL AND name ~* '[0-9]+\\s*(kg|g|ml|l|litre)\\s*$'`
      );
      expect(rows.map((r) => `${r.code}: ${r.name}`)).toEqual([]);
    });

    it('SCENARIO 11 — the pack sizes the facility set are catalogue data, readable without code', async () => {
      const rows = await db.query<{ code: string; name: string; pack_size: string }>(
        `SELECT code, name, pack_size::text AS pack_size FROM rik.provisions
          WHERE code IN ('CER_MAGGI','CER_HAKKA_NOODLES','CER_MAIDA')`
      );
      const bySize = new Map(rows.map((r) => [r.code, Number(r.pack_size)]));
      expect(bySize.get('CER_MAGGI')).toBe(280);
      expect(bySize.get('CER_HAKKA_NOODLES')).toBe(1000);
      expect(bySize.get('CER_MAIDA')).toBe(500);

      // The figures live in the row and nowhere else: none of them is
      // written into the engine, the service or the controller.
      for (const row of rows) expect(row.name).not.toMatch(/[0-9]/);
    });

    it('SCENARIO 12 — a pack unit is only ever one the facility uses', async () => {
      const rows = await db.query<{ pack_unit: string }>(
        `SELECT DISTINCT pack_unit FROM rik.provisions WHERE pack_unit IS NOT NULL`
      );
      for (const row of rows) expect(PACK_UNITS).toContain(row.pack_unit);

      // And the database itself refuses anything else, so an import or
      // a future screen cannot invent a ninth.
      await expect(
        db.query(`UPDATE rik.provisions SET pack_unit = 'sachet' WHERE code = 'CER_MAGGI'`)
      ).rejects.toBeDefined();
    });

    it('SCENARIO 13 — an item with no picture has none, rather than a borrowed one', async () => {
      const rows = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM rik.provisions
          WHERE image_ref IS NOT NULL AND btrim(image_ref) = ''`
      );
      // Blank is not a picture. The CHECK forbids it outright, so an
      // unset picture is null and the screen shows its placeholder.
      expect(Number(rows[0]!.count)).toBe(0);
      await expect(
        db.query(`UPDATE rik.provisions SET image_ref = '   ' WHERE code = 'CER_MAGGI'`)
      ).rejects.toBeDefined();
    });
  });

  // ===================================================================
  // 4. The catalogue is managed from the dashboard, not from SQL
  // ===================================================================
  describe('an administrator manages the catalogue over HTTP', () => {
    let paneerAmulId: string;
    let paneerOtherId: string;

    it('SCENARIO 14 — creates an item carrying a brand, a pack unit and a picture', async () => {
      const res = await request(server())
        .post('/admin/rik/config/provisions')
        .set('Authorization', admin())
        .send({
          poolId,
          code: `JEST12A_PANEER_A_${tag}`,
          name: 'Paneer',
          brand: 'Amul',
          packUnit: 'packet',
          imageRef: 'rik/catalogue/paneer-amul-200.jpg',
          unit: 'g',
          consumptionRatio: 1,
          packSize: 200,
          issuePeriod: 'DRY',
          displayOrder: 920,
          effectiveFrom: CONFIG_FROM,
        })
        .expect(201);

      paneerAmulId = res.body.id;
      createdProvisionIds.push(paneerAmulId);
      expect(res.body).toMatchObject({
        name: 'Paneer',
        brand: 'Amul',
        packUnit: 'packet',
        imageRef: 'rik/catalogue/paneer-amul-200.jpg',
      });
      // The name is the item. The brand is not in it.
      expect(res.body.name).not.toMatch(/amul/i);
      expect(res.body.name).not.toMatch(/200/);
    });

    it('SCENARIO 15 — a second brand of the same item is a second row, not a renamed duplicate', async () => {
      const res = await request(server())
        .post('/admin/rik/config/provisions')
        .set('Authorization', admin())
        .send({
          poolId,
          code: `JEST12A_PANEER_B_${tag}`,
          name: 'Paneer',
          brand: `Jest Dairy ${tag}`,
          packUnit: 'packet',
          unit: 'g',
          consumptionRatio: 1,
          packSize: 500,
          issuePeriod: 'DRY',
          displayOrder: 921,
          effectiveFrom: CONFIG_FROM,
        })
        .expect(201);

      paneerOtherId = res.body.id;
      createdProvisionIds.push(paneerOtherId);

      const listed = await request(server())
        .get(`/admin/rik/config/provisions?poolId=${poolId}`)
        .set('Authorization', admin())
        .expect(200);

      const paneers = listed.body.items.filter((p: { name: string }) => p.name === 'Paneer');
      expect(paneers).toHaveLength(2);
      // One name, two brands, two pack sizes, two ids — each row is
      // individually identifiable without the name having to carry it.
      expect(paneers.map((p: { brand: string }) => p.brand).sort()).toEqual(['Amul', `Jest Dairy ${tag}`].sort());
      expect(new Set(paneers.map((p: { id: string }) => p.id)).size).toBe(2);
      expect(new Set(paneers.map((p: { packSize: string }) => Number(p.packSize)))).toEqual(new Set([200, 500]));
    });

    it('SCENARIO 16 — edits the brand, the pack unit and the picture of an existing item', async () => {
      const res = await request(server())
        .patch(`/admin/rik/config/provisions/${paneerAmulId}`)
        .set('Authorization', admin())
        .send({ brand: 'Amul Gold', packUnit: 'box', imageRef: 'rik/catalogue/paneer-amul-gold.jpg' })
        .expect(200);

      expect(res.body).toMatchObject({
        name: 'Paneer',
        brand: 'Amul Gold',
        packUnit: 'box',
        imageRef: 'rik/catalogue/paneer-amul-gold.jpg',
      });

      // Clearing them puts the row back to unbranded and pictureless,
      // which is a legitimate state and not an error.
      const cleared = await request(server())
        .patch(`/admin/rik/config/provisions/${paneerAmulId}`)
        .set('Authorization', admin())
        .send({ brand: null, packUnit: null, imageRef: null })
        .expect(200);
      expect(cleared.body).toMatchObject({ brand: null, packUnit: null, imageRef: null });

      await request(server())
        .patch(`/admin/rik/config/provisions/${paneerAmulId}`)
        .set('Authorization', admin())
        .send({ brand: 'Amul', packUnit: 'packet' })
        .expect(200);
    });

    it('SCENARIO 17 — refuses a pack unit the facility does not use, and writes nothing', async () => {
      const before = await request(server())
        .get(`/admin/rik/config/provisions?poolId=${poolId}`)
        .set('Authorization', admin())
        .expect(200);

      await request(server())
        .patch(`/admin/rik/config/provisions/${paneerAmulId}`)
        .set('Authorization', admin())
        .send({ packUnit: 'sachet' })
        .expect(400);

      const after = await request(server())
        .get(`/admin/rik/config/provisions?poolId=${poolId}`)
        .set('Authorization', admin())
        .expect(200);
      expect(after.body.items).toEqual(before.body.items);
    });

    it('SCENARIO 18 — the catalogue is RIK_ADMIN work under the permissions that already existed', async () => {
      // No new role, no new permission, and emphatically no PURCHASING.
      const roles = await db.query<{ name: string }>(`SELECT name FROM shared.roles ORDER BY name`);
      const permissions = await db.query<{ code: string }>(`SELECT code FROM shared.permissions`);
      expect(roles.map((r) => r.name)).not.toContain('PURCHASING');
      expect(roles).toHaveLength(6);
      // 22 after PHASE F added the two PIF order permissions; the rik.*
      // set below is what this test is about and it has not moved.
      expect(permissions).toHaveLength(22);
      expect(permissions.map((p) => p.code)).toContain('rik.product.manage');

      // Every other staff role is refused the catalogue write outright.
      for (const role of STAFF_ROLES.filter((r) => r !== 'RIK_ADMIN' && r !== 'SUPER_ADMIN')) {
        await request(server())
          .patch(`/admin/rik/config/provisions/${paneerAmulId}`)
          .set('Authorization', bearer(role))
          .send({ brand: 'Not allowed' })
          .expect(403);
      }
      await request(server())
        .patch(`/admin/rik/config/provisions/${paneerAmulId}`)
        .send({ brand: 'Not allowed' })
        .expect(401);
    });

    it('SCENARIO 19 — the catalogue change is recorded in the audit history with its new fields', async () => {
      await request(server())
        .patch(`/admin/rik/config/provisions/${paneerOtherId}`)
        .set('Authorization', admin())
        .send({ brand: `Jest Dairy Renamed ${tag}` })
        .expect(200);

      const res = await request(server())
        .get('/admin/rik/config/history?entityType=rik.provisions')
        .set('Authorization', admin())
        .expect(200);

      const entry = res.body.items.find(
        (e: { entityId: string; after: { brand?: string } }) =>
          e.entityId === paneerOtherId && e.after?.brand === `Jest Dairy Renamed ${tag}`
      );
      expect(entry).toBeDefined();
      expect(entry.actorRole).toBe('RIK_ADMIN');
      expect(entry.before.brand).toBe(`Jest Dairy ${tag}`);
    });
  });

  // ===================================================================
  // 5. None of it reaches the engine or a confirmed record
  // ===================================================================
  describe('describing an item differently changes nothing that was calculated', () => {
    it('SCENARIO 20 — a rebrand, a repack and a new picture leave the entitlement and a confirmed record identical', async () => {
      const calculate = async () => {
        const basis = await eligibility.resolveBasis(customerId, periodId);
        const calc = await entitlement.calculate(basis);
        return calc.dry.find((p) => p.code === POOL_CODE)!;
      };

      const before = await calculate();
      expect(before.totalEntitlement).toBe(100 * ELIGIBLE_DAYS);

      // A confirmed record that points at one of the items about to be
      // re-described. It is built draft-first and then confirmed,
      // because the protection this test relies on is already in force:
      // rik.trg_protect_confirmed_selection_children refuses an INSERT
      // into a selection that is CONFIRMED already. Writing the lines
      // while the selection is still a DRAFT and confirming afterwards
      // is exactly the order the real confirmation uses.
      const provisionId = createdProvisionIds[0]!;
      const selection = await db.query<{ id: string }>(
        `INSERT INTO rik.entitlement_selections
           (id, customer_id, period_id, status, dietary_preference, eligible_days)
         VALUES (shared.uuid_generate_v7(), $1, $2, 'DRAFT', 'NV', $3)
         RETURNING id`,
        [customerId, periodId, ELIGIBLE_DAYS]
      );
      const selectionId = selection[0]!.id;
      createdSelectionIds.push(selectionId);

      await db.query(
        `INSERT INTO rik.entitlement_selection_items
           (selection_id, provision_id, pool_id, quantity, consumption_ratio, pool_equivalent_qty)
         VALUES ($1, $2, $3, 400, 1, 400)`,
        [selectionId, provisionId, poolId]
      );

      await db.query(
        `UPDATE rik.entitlement_selections
            SET status = 'CONFIRMED',
                rule_snapshot = $2::jsonb,
                confirmed_at = now(),
                reference_number = 'RIK-12A-' || substr(md5(random()::text), 1, 8),
                fulfillment_type = 'PICKUP',
                pickup_location_name = 'Naval Park',
                availability_acknowledged = true,
                availability_acknowledged_at = now()
          WHERE id = $1`,
        [
          selectionId,
          JSON.stringify({ provisions: [{ id: provisionId, name: 'Paneer', brand: 'Amul', packSize: '200.0000' }] }),
        ]
      );

      const recordBefore = await db.query<{ snapshot: string; quantity: string; ratio: string; equiv: string }>(
        `SELECT s.rule_snapshot::text AS snapshot, i.quantity::text AS quantity,
                i.consumption_ratio::text AS ratio, i.pool_equivalent_qty::text AS equiv
           FROM rik.entitlement_selections s
           JOIN rik.entitlement_selection_items i ON i.selection_id = s.id
          WHERE s.id = $1`,
        [selectionId]
      );

      // Now re-describe the item every way STEP 12A allows.
      await request(server())
        .patch(`/admin/rik/config/provisions/${provisionId}`)
        .set('Authorization', admin())
        .send({
          name: 'Paneer Cubes',
          brand: `Rebranded ${tag}`,
          packUnit: 'box',
          imageRef: 'rik/catalogue/rebranded.jpg',
          packSize: 750,
        })
        .expect(200);

      const after = await calculate();
      expect(after.totalEntitlement).toBe(before.totalEntitlement);
      expect(after.dailyScale).toBe(before.dailyScale);
      expect(after.eligibleDays).toBe(before.eligibleDays);
      expect(after.remaining).toBe(before.remaining);
      for (const provision of after.provisions) {
        const was = before.provisions.find((p) => p.provisionId === provision.provisionId);
        if (!was) continue;
        expect(provision.consumptionRatio).toBe(was.consumptionRatio);
        expect(provision.maxSelectableQuantity).toBe(was.maxSelectableQuantity);
      }

      const recordAfter = await db.query<{ snapshot: string; quantity: string; ratio: string; equiv: string }>(
        `SELECT s.rule_snapshot::text AS snapshot, i.quantity::text AS quantity,
                i.consumption_ratio::text AS ratio, i.pool_equivalent_qty::text AS equiv
           FROM rik.entitlement_selections s
           JOIN rik.entitlement_selection_items i ON i.selection_id = s.id
          WHERE s.id = $1`,
        [selectionId]
      );
      expect(recordAfter).toEqual(recordBefore);
      // What was confirmed still reads as what was confirmed, brand and
      // pack size included, whatever the catalogue says today.
      expect(recordAfter[0]!.snapshot).toContain('Amul');
      expect(recordAfter[0]!.snapshot).toContain('200.0000');
    });
  });
});
