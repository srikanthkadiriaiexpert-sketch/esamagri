import 'reflect-metadata';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
import { CurrentPeriodLock } from './test-support/current-period-lock';

/**
 * STEP 14B — the category cover picture, on the entitlement pool.
 *
 * WHAT THIS SUITE IS ABOUT. The catalogue now has TWO levels of picture
 * and the whole risk of this step is that they get confused:
 *
 *   a PROVISION picture  is the item an officer takes   -> rik.provisions
 *   a CATEGORY picture   is the cover of an allowance   -> rik.entitlement_pools
 *
 * They are different columns on different tables, and neither stands in
 * for the other. Most of what follows checks that separation holds, that
 * a pool without a picture is completely normal, and that adding one
 * changed no figure anywhere.
 *
 * ALL EIGHTEEN POOLS HAVE A PICTURE AS OF 9 OCTOBER 2026. Milk (STEP 14B),
 * Meat (14C), Eggs (14D) and Fresh Vegetables (14E) were integrated one at a
 * time; Fresh Fruits (0039), Onion / Garlic (0040), Potato (0041) and all
 * eleven Dry categories (0042) followed once the client re-supplied the
 * artwork that was lost with the container. The suite was written for exactly
 * this moment: it said that when a step adds a category, the table below is
 * the one place that changes, and every count is derived from it.
 *
 * So the set is still stated EXACTLY, code by code and path by path, rather
 * than counted — a picture still cannot be added, moved or dropped without
 * being restated here. What changed is the membership of that set, not the
 * strength of the assertion.
 *
 * "A POOL WITHOUT A PICTURE STILL WORKS" is still proven (TEST 1). It no
 * longer has a permanently empty pool to lean on, so it clears one, checks
 * the category is served whole with imageRef null, and puts it back — the
 * same set-and-restore TEST 7 uses. The guarantee is the same; only the way
 * of reaching the state changed.
 */
describe('RIK category images (STEPS 14B/14C/14D/14E, integration, real PostgreSQL + real HTTP)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let tokenService: TokenService;
  let eligibility: RikEligibilityService;
  let entitlement: RikEntitlementService;

  const runId = randomUUID().slice(0, 8);
  const digits = runId.replace(/[^0-9]/g, '').padEnd(7, '9');
  const MILK_IMAGE = '/catalogue/rik/category/milk.png';
  const MEAT_IMAGE = '/catalogue/rik/category/meat.png';
  const EGGS_IMAGE = '/catalogue/rik/category/eggs.png';
  const VEGETABLES_IMAGE = '/catalogue/rik/category/vegetables.png';

  /** Every category that has a cover picture today, in code order. */
  const WITH_PICTURE: ReadonlyArray<readonly [code: string, path: string]> = [
    ['BUTTER_GHEE', '/catalogue/rik/category/butter-ghee.png'],
    ['CEREALS', '/catalogue/rik/category/cereals.png'],
    ['CHEESE_NUTRAMUL', '/catalogue/rik/category/cheese-nutramul.png'],
    ['CONDIMENTS', '/catalogue/rik/category/condiments.png'],
    ['DAL', '/catalogue/rik/category/dal.png'],
    ['DALIYA', '/catalogue/rik/category/daliya.png'],
    ['EGGS', EGGS_IMAGE],
    ['FRUITS', '/catalogue/rik/category/fruits.png'],
    ['GARAM_MASALA_WHOLE', '/catalogue/rik/category/garam-masala-whole.png'],
    ['HYDROGENATED_OIL', '/catalogue/rik/category/hydrogenated-oil.png'],
    ['MEAT', MEAT_IMAGE],
    ['MILK', MILK_IMAGE],
    ['ONION_GARLIC', '/catalogue/rik/category/onion.png'],
    ['POTATO', '/catalogue/rik/category/potato.png'],
    ['SALT', '/catalogue/rik/category/salt.png'],
    ['SUGAR_JAGGERY', '/catalogue/rik/category/sugar-jaggery.png'],
    ['TEA_COFFEE', '/catalogue/rik/category/tea-coffee.png'],
    ['VEGETABLES', VEGETABLES_IMAGE],
  ];
  const TOTAL_POOLS = 18;

  const PUBLIC_DIR = join(__dirname, '..', '..', '..', 'customer-web', 'public');

  const tokenByRole = new Map<StaffRole, string>();
  const staffIdByRole = new Map<StaffRole, string>();
  let customerId: string;
  let customerToken: string;
  let periodId: string;
  let periodLock: CurrentPeriodLock;
  const ELIGIBLE_DAYS = 30;

  const server = () => app.getHttpServer();
  const bearer = (role: StaffRole) => `Bearer ${tokenByRole.get(role)}`;
  const admin = () => bearer('RIK_ADMIN');

  interface PoolRow {
    code: string;
    name: string;
    image_ref: string | null;
  }
  const pools = () =>
    db.query<PoolRow>(`SELECT code, name, image_ref FROM rik.entitlement_pools ORDER BY code`);

  const categories = async () => {
    const res = await request(server())
      .get('/rik/entitlements/current')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    return [...res.body.fresh, ...res.body.dry] as Array<{
      code: string;
      name: string;
      imageRef: string | null;
      totalEntitlement: number;
      provisions: Array<{ code: string; imageRef: string | null }>;
    }>;
  };

  beforeAll(async () => {
    periodLock = await CurrentPeriodLock.acquire();

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
        [`jest_14b_${role.toLowerCase()}_${runId}`, passwordHash, `Jest 14B ${role} ${runId}`]
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

    await db.query(
      `DELETE FROM rik.customer_period_eligibility
        WHERE period_id IN (SELECT id FROM rik.entitlement_periods WHERE name LIKE 'Jest 14B%')`
    );
    await db.query(`DELETE FROM rik.entitlement_periods WHERE name LIKE 'Jest 14B%'`);
    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
    const period = await db.query<{ id: string }>(
      `INSERT INTO rik.entitlement_periods (id, name, start_date, end_date, status)
       VALUES (shared.uuid_generate_v7(), $1, $2::date, $3::date, 'ACTIVE') RETURNING id`,
      [`Jest 14B period ${runId}`, iso(start), iso(end)]
    );
    periodId = period[0]!.id;

    const customer = await db.query<{ id: string }>(
      `INSERT INTO shared.customers (id, mobile_number, name, is_active, dietary_preference)
       VALUES (shared.uuid_generate_v7(), $1, $2, true, 'NV') RETURNING id`,
      [`+9174${digits.slice(0, 5)}3`, `Jest 14B Customer ${runId}`]
    );
    customerId = customer[0]!.id;
    customerToken = tokenService.signAccessToken({ principalType: 'CUSTOMER', principalId: customerId });
    await db.query(
      `INSERT INTO rik.customer_period_eligibility (customer_id, period_id, eligible_days) VALUES ($1,$2,$3)`,
      [customerId, periodId, ELIGIBLE_DAYS]
    );
  });

  afterAll(async () => {
    await db.query(
      `DELETE FROM rik.entitlement_selections WHERE customer_id = $1 AND status <> 'CONFIRMED'`,
      [customerId]
    );
    await db.query(`DELETE FROM rik.customer_period_eligibility WHERE customer_id = $1`, [customerId]);
    await db.query(`DELETE FROM rik.entitlement_periods WHERE id = $1`, [periodId]);
    const staff = [...staffIdByRole.values()];
    await db.query('DELETE FROM shared.auth_sessions WHERE principal_id = ANY($1::uuid[])', [
      [...staff, customerId],
    ]);
    await db.query('DELETE FROM shared.user_roles WHERE user_id = ANY($1::uuid[])', [staff]);
    await db.query('DELETE FROM shared.users WHERE id = ANY($1::uuid[])', [staff]);
    await db.query('DELETE FROM shared.customers WHERE id = $1', [customerId]);
    await app.close();
    await periodLock.release();
  });

  // ===================================================================
  it('TEST 1 — a pool without a category picture still works everywhere', async () => {
    // Every pool carries a picture today, so this clears one and puts it
    // back. The column is nullable on purpose and the customer screen has a
    // placeholder for exactly this case; neither may quietly rot now that
    // the ordinary state is "filled".
    const target = 'CEREALS';
    const restore = WITH_PICTURE.find(([code]) => code === target)![1];
    const id = (
      await db.query<{ id: string }>(`SELECT id FROM rik.entitlement_pools WHERE code = $1`, [target])
    )[0]!.id;

    await request(server())
      .patch(`/admin/rik/config/pools/${id}`)
      .set('Authorization', admin())
      .send({ imageRef: null })
      .expect(200);

    try {
      const rows = await pools();
      const without = rows.filter((r) => r.image_ref === null);
      expect(without.map((r) => r.code)).toEqual([target]);

      // Still served to the customer as a full category, with its
      // entitlement intact — a missing picture withholds nothing.
      const served = await categories();
      const bare = served.find((c) => c.code === target)!;
      expect(bare.imageRef).toBeNull();
      expect(bare.name.length).toBeGreaterThan(0);
      expect(typeof bare.totalEntitlement).toBe('number');
      expect(bare.provisions.length).toBeGreaterThan(0);

      // Null, never an empty string — the column's CHECK makes that impossible.
      await expect(
        db.query(`UPDATE rik.entitlement_pools SET image_ref = '' WHERE code = $1`, [target])
      ).rejects.toBeDefined();
    } finally {
      await request(server())
        .patch(`/admin/rik/config/pools/${id}`)
        .set('Authorization', admin())
        .send({ imageRef: restore })
        .expect(200);
    }

    const back = await db.query<{ image_ref: string }>(
      `SELECT image_ref FROM rik.entitlement_pools WHERE code = $1`,
      [target]
    );
    expect(back[0]!.image_ref).toBe(restore);
  });

  it('TEST 2 — a pool with a picture returns it as imageRef', async () => {
    const served = await categories();
    const withPicture = served.filter((c) => c.imageRef !== null);
    expect(withPicture.length).toBeGreaterThan(0);
    for (const c of withPicture) {
      expect(c.imageRef).toMatch(/^\/catalogue\/rik\/category\/[a-z0-9-]+\.png$/);
    }
  });

  it('TEST 3 — Milk returns the correct imageRef, and that file exists', async () => {
    const rows = await pools();
    const milk = rows.find((r) => r.code === 'MILK')!;
    expect(milk.image_ref).toBe(MILK_IMAGE);

    const served = await categories();
    const milkCategory = served.find((c) => c.code === 'MILK')!;
    expect(milkCategory.imageRef).toBe(MILK_IMAGE);

    expect(existsSync(join(PUBLIC_DIR, MILK_IMAGE))).toBe(true);
    const head = readFileSync(join(PUBLIC_DIR, MILK_IMAGE)).subarray(0, 8);
    expect([...head]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it('TEST 4 — every pool has exactly the picture the catalogue says it has', async () => {
    const rows = await pools();
    const withPicture = rows.filter((r) => r.image_ref !== null);

    // The exact set, and each one's exact path. Not a count.
    expect(withPicture.map((r) => [r.code, r.image_ref])).toEqual(WITH_PICTURE.map((e) => [e[0], e[1]]));
    expect(withPicture).toHaveLength(TOTAL_POOLS);

    // Every Dry category now has one too — the eleven integrated by 0042.
    const dry = await db.query<{ code: string; image_ref: string | null }>(
      `SELECT code, image_ref FROM rik.entitlement_pools WHERE ration_type = 'DRY' ORDER BY code`
    );
    expect(dry).toHaveLength(11);
    expect(dry.filter((r) => r.image_ref === null)).toEqual([]);

    // No two categories share a picture: a cover that appeared against two
    // allowances would be telling an officer nothing while looking as
    // though it were telling them something.
    const paths = withPicture.map((r) => r.image_ref);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('TEST 4A — every configured category picture resolves to a real PNG on disk', async () => {
    const rows = await pools();
    for (const row of rows) {
      expect(row.image_ref).not.toBeNull();
      const file = join(PUBLIC_DIR, row.image_ref!);
      expect(existsSync(file)).toBe(true);
      // A real PNG, not a placeholder or a truncated copy.
      const head = readFileSync(file).subarray(0, 8);
      expect([...head]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    }
  });

  it('TEST 5 — a category picture and a provision picture never cross over', async () => {
    const poolRows = await pools();
    const provisionRows = await db.query<{ code: string; image_ref: string | null }>(
      `SELECT code, image_ref FROM rik.provisions WHERE image_ref IS NOT NULL`
    );

    // No pool carries a provision path, and no provision a category path.
    expect(poolRows.filter((r) => r.image_ref?.startsWith('/catalogue/rik/category/') === false)).toEqual([]);
    expect(provisionRows.filter((r) => r.image_ref!.startsWith('/catalogue/rik/category/'))).toEqual([]);

    // And no category POOL picture is on any provision.
    for (const [, path] of WITH_PICTURE) {
      expect(provisionRows.filter((r) => r.image_ref === path)).toEqual([]);
    }
  });

  it('TEST 6 — existing provision pictures are unaffected', async () => {
    const rows = await db.query<{ total: string; with_image: string }>(
      `SELECT count(*)::text AS total, count(image_ref)::text AS with_image FROM rik.provisions`
    );
    expect(Number(rows[0]!.total)).toBe(190);
    // 70 fresh varieties + 103 dry + the 7 fresh staples added by migration
    // 0052. The provision COUNT is what this test is really about and it is
    // unchanged at 189 — no category step has ever created a provision.
    expect(Number(rows[0]!.with_image)).toBe(180);

    // The customer still gets provision pictures alongside the category one.
    const served = await categories();
    // Neither category picture leaked down onto the provisions that draw on
    // that pool. Only the categories this customer is actually served are
    // checked — a pool that does not apply to their dietary preference is
    // absent from the response by design, and that is STEP 11's rule, not
    // this step's business.
    let checked = 0;
    for (const [code, path] of WITH_PICTURE) {
      const category = served.find((c) => c.code === code);
      if (category === undefined) continue;
      expect(category.imageRef).toBe(path);
      for (const p of category.provisions) expect(p.imageRef).not.toBe(path);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);

    // Cereals carries its own cover now, and its provisions still carry
    // theirs — the two levels sit side by side without crossing over.
    const cereals = served.find((c) => c.code === 'CEREALS')!;
    expect(cereals.imageRef).toBe('/catalogue/rik/category/cereals.png');
    expect(cereals.provisions.some((p) => p.imageRef?.startsWith('/catalogue/rik/dry/'))).toBe(true);
    expect(cereals.provisions.every((p) => p.imageRef !== cereals.imageRef)).toBe(true);
  });

  it('TEST 7 — setting and clearing a category picture changes no entitlement figure', async () => {
    const calculate = async () => {
      const basis = await eligibility.resolveBasis(customerId, periodId);
      const calc = await entitlement.calculate(basis);
      return [...calc.fresh, ...calc.dry].map((p) => ({
        code: p.code,
        dailyScale: p.dailyScale,
        effectiveDailyQty: p.effectiveDailyQty,
        eligibleDays: p.eligibleDays,
        total: p.totalEntitlement,
        consumed: p.consumed,
        remaining: p.remaining,
        provisions: p.provisions.map((v) => ({ code: v.code, ratio: v.consumptionRatio, max: v.maxSelectableQuantity })),
      }));
    };

    const before = await calculate();
    const milk = await db.query<{ id: string }>(`SELECT id FROM rik.entitlement_pools WHERE code = 'MILK'`);
    const id = milk[0]!.id;

    await request(server())
      .patch(`/admin/rik/config/pools/${id}`)
      .set('Authorization', admin())
      .send({ imageRef: null })
      .expect(200);
    expect(await calculate()).toEqual(before);

    await request(server())
      .patch(`/admin/rik/config/pools/${id}`)
      .set('Authorization', admin())
      .send({ imageRef: MILK_IMAGE })
      .expect(200);
    expect(await calculate()).toEqual(before);

    // And the pool's rule-bearing fields are exactly as they were.
    const after = await db.query<{ name: string; unit: string; ration_type: string; image_ref: string }>(
      `SELECT name, unit, ration_type, image_ref FROM rik.entitlement_pools WHERE id = $1`,
      [id]
    );
    expect(after[0]!.name).toBe('Milk');
    expect(after[0]!.unit).toBe('ml');
    expect(after[0]!.ration_type).toBe('FRESH');
    expect(after[0]!.image_ref).toBe(MILK_IMAGE);
  });

  /**
   * STEP 14C — the Meat category picture.
   *
   * Meat is the category where the two-level confusion would be most
   * costly and least obvious. The pool is a SHARED balance: Meat, Fish and
   * Chicken / Fowl all draw on it in meat-equivalent grams. If the pool's
   * cover ever reached a provision row, an officer choosing between fish
   * and chicken would be shown the same mixed platter against both, and
   * the picture would be telling them nothing while looking as though it
   * were telling them something.
   */
  it('TEST 9 — Meat returns the correct imageRef, and that file exists', async () => {
    const rows = await pools();
    const meat = rows.find((r) => r.code === 'MEAT')!;
    expect(meat.image_ref).toBe(MEAT_IMAGE);
    expect(meat.name).toBe('Meat');

    const served = await categories();
    const meatCategory = served.find((c) => c.code === 'MEAT')!;
    expect(meatCategory.imageRef).toBe(MEAT_IMAGE);

    // The path resolves to a real PNG on disk, not merely to a string of
    // the right shape.
    expect(existsSync(join(PUBLIC_DIR, MEAT_IMAGE))).toBe(true);
    const bytes = readFileSync(join(PUBLIC_DIR, MEAT_IMAGE));
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // IHDR carries the dimensions: 800 x 800, the category convention.
    expect(bytes.readUInt32BE(16)).toBe(800);
    expect(bytes.readUInt32BE(20)).toBe(800);

    // Each category has its OWN file. Two categories sharing one picture
    // would pass every other assertion in this suite.
    expect(MEAT_IMAGE).not.toBe(MILK_IMAGE);
    const milkBytes = readFileSync(join(PUBLIC_DIR, MILK_IMAGE));
    expect(bytes.equals(milkBytes)).toBe(false);
  });

  it('TEST 10 — the Meat cover is not shown against Meat, Fish or Chicken', async () => {
    const served = await categories();
    const meat = served.find((c) => c.code === 'MEAT')!;

    // The pool really is shared — this is the condition that makes the
    // assertion below matter, so it is asserted rather than assumed.
    expect(meat.provisions.length).toBeGreaterThan(1);
    for (const p of meat.provisions) {
      expect(p.imageRef).not.toBe(MEAT_IMAGE);
      expect(p.imageRef?.startsWith('/catalogue/rik/category/') ?? false).toBe(false);
    }

    // Nothing in the database ties the cover to a provision either.
    //
    // UPDATED BY MIGRATION 0052. This asked for NO meat provision to carry
    // any picture, which was true only because the client had supplied none:
    // Meat, Fish and Chicken all showed the placeholder. They now have
    // photographs of their own. The point of the test is unchanged — the
    // CATEGORY COVER must never be served as a provision's picture — so that
    // is what is asserted, rather than the absence of any picture at all.
    const rows = await db.query<{ code: string; image_ref: string | null }>(
      `SELECT pr.code, pr.image_ref FROM rik.provisions pr
        JOIN rik.entitlement_pools p ON p.id = pr.pool_id
       WHERE p.code = 'MEAT' AND pr.image_ref LIKE '/catalogue/rik/category/%'`
    );
    expect(rows).toEqual([]);

    // And each one carries its own staple photograph instead.
    const meatProvisions = await db.query<{ code: string; image_ref: string | null }>(
      `SELECT pr.code, pr.image_ref FROM rik.provisions pr
        JOIN rik.entitlement_pools p ON p.id = pr.pool_id
       WHERE p.code = 'MEAT' ORDER BY pr.code`
    );
    expect(meatProvisions).toEqual([
      { code: 'MEAT_CHICKEN', image_ref: '/catalogue/rik/fresh-staples/meat__chicken-fowl.png' },
      { code: 'MEAT_FISH', image_ref: '/catalogue/rik/fresh-staples/meat__fish.png' },
      { code: 'MEAT_MUTTON', image_ref: '/catalogue/rik/fresh-staples/meat__mutton.png' },
    ]);
  });

  it('TEST 11 — adding the Meat cover moved no figure and left Milk alone', async () => {
    // Meat's own rule-bearing fields, unchanged by a presentation column.
    const meat = await db.query<{ name: string; unit: string; ration_type: string; display_order: number }>(
      `SELECT name, unit, ration_type, display_order FROM rik.entitlement_pools WHERE code = 'MEAT'`
    );
    expect(meat[0]).toMatchObject({ name: 'Meat', unit: 'g', ration_type: 'FRESH' });

    // The scale the engine actually uses for Meat is untouched.
    const scales = await db.query<{ dietary_preference: string; daily_qty: string }>(
      `SELECT s.dietary_preference, s.daily_qty
         FROM rik.pool_scales s JOIN rik.entitlement_pools p ON p.id = s.pool_id
        WHERE p.code = 'MEAT' AND s.is_active ORDER BY s.dietary_preference`
    );
    expect(scales.map((r) => [r.dietary_preference, r.daily_qty])).toEqual([['NV', '260.0000']]);

    // STEP 14B's picture is exactly where STEP 14B left it.
    const milk = await db.query<{ image_ref: string }>(
      `SELECT image_ref FROM rik.entitlement_pools WHERE code = 'MILK'`
    );
    expect(milk[0]!.image_ref).toBe(MILK_IMAGE);
  });

  /**
   * STEP 14D — the Eggs category picture.
   *
   * Eggs were the subject that broke the extraction convention, and the
   * reason is worth keeping next to the test. The subject mask is
   * `min(RGB) < 246`; eggs are white, so the brightest part of each egg
   * sat ABOVE that threshold and left enclosed holes in the silhouette,
   * which the background-whitening step then flattened to pure white —
   * inventing a hard-edged highlight the source artwork does not have.
   * The amended rule fills those enclosed holes BEFORE any whitening, so
   * the interior of the asset is bit-identical to the sheet. TEST 14
   * asserts that property on the shipped file rather than trusting it.
   *
   * Milk and Meat were NOT re-extracted; their assets and migrations 0035
   * and 0036 are untouched, and TEST 13 pins both.
   */
  it('TEST 12 — Eggs returns the correct imageRef, and that file exists', async () => {
    const rows = await pools();
    const eggs = rows.find((r) => r.code === 'EGGS')!;
    expect(eggs.image_ref).toBe(EGGS_IMAGE);
    expect(eggs.name).toBe('Eggs');

    const served = await categories();
    const eggsCategory = served.find((c) => c.code === 'EGGS')!;
    expect(eggsCategory.imageRef).toBe(EGGS_IMAGE);

    const bytes = readFileSync(join(PUBLIC_DIR, EGGS_IMAGE));
    expect(existsSync(join(PUBLIC_DIR, EGGS_IMAGE))).toBe(true);
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(bytes.readUInt32BE(16)).toBe(800);
    expect(bytes.readUInt32BE(20)).toBe(800);

    // Each category has its OWN file.
    for (const [code, path] of WITH_PICTURE) {
      if (code === 'EGGS') continue;
      expect(EGGS_IMAGE).not.toBe(path);
      expect(bytes.equals(readFileSync(join(PUBLIC_DIR, path)))).toBe(false);
    }
  });

  it('TEST 13 — adding Eggs left Milk and Meat, and every figure, alone', async () => {
    const rows = await pools();
    // The two approved, closed categories are exactly where their own
    // steps left them.
    expect(rows.find((r) => r.code === 'MILK')!.image_ref).toBe(MILK_IMAGE);
    expect(rows.find((r) => r.code === 'MEAT')!.image_ref).toBe(MEAT_IMAGE);

    // Eggs' rule-bearing fields are untouched by a presentation column —
    // note the unit is `piece`, not a weight.
    const eggs = await db.query<{ name: string; unit: string; ration_type: string }>(
      `SELECT name, unit, ration_type FROM rik.entitlement_pools WHERE code = 'EGGS'`
    );
    expect(eggs[0]).toMatchObject({ name: 'Eggs', unit: 'piece', ration_type: 'FRESH' });

    const scales = await db.query<{ dietary_preference: string; daily_qty: string }>(
      `SELECT s.dietary_preference, s.daily_qty
         FROM rik.pool_scales s JOIN rik.entitlement_pools p ON p.id = s.pool_id
        WHERE p.code = 'EGGS' AND s.is_active ORDER BY s.dietary_preference`
    );
    expect(scales.map((r) => [r.dietary_preference, r.daily_qty])).toEqual([
      ['EV', '2.0000'],
      ['NV', '2.0000'],
    ]);

    // The egg conversions — the ones that make this pool interesting —
    // are exactly as configured.
    const conversions = await db.query<{ code: string; from_qty: string; to_qty: string }>(
      `SELECT code, from_qty, to_qty FROM rik.pool_conversions WHERE code LIKE 'EGGS_%' OR code LIKE '%_EGGS_%' ORDER BY code`
    );
    expect(conversions.length).toBeGreaterThan(0);
    for (const c of conversions) expect(Number(c.from_qty)).toBeGreaterThan(0);
  });

  it('TEST 14 — the Eggs asset preserves the source artwork, not a flattened copy', async () => {
    /*
     * The rejected candidate and the shipped one differ only in near-white
     * interior pixels, so a size or magic-byte check cannot tell them
     * apart. What does tell them apart is the flattening: the rejected
     * render contained large connected regions of pure (255,255,255)
     * INSIDE the egg silhouette — 12,071 px across four patches — where
     * the source has smooth gradient. The shipped asset has none.
     *
     * This reads the PNG with no image library: it inflates the IDAT
     * stream, undoes the per-scanline filters, and counts pure-white runs
     * strictly inside the subject's own bounding box.
     */
    const { inflateSync } = await import('node:zlib');
    const bytes = readFileSync(join(PUBLIC_DIR, EGGS_IMAGE));

    const idat: Buffer[] = [];
    for (let off = 8; off < bytes.length; ) {
      const len = bytes.readUInt32BE(off);
      const type = bytes.toString('ascii', off + 4, off + 8);
      if (type === 'IDAT') idat.push(bytes.subarray(off + 8, off + 8 + len));
      off += 12 + len;
    }
    const raw = inflateSync(Buffer.concat(idat));
    const W = 800;
    const H = 800;
    const BPP = 3;
    const stride = W * BPP;
    const px = Buffer.alloc(H * stride);
    const paeth = (a: number, b: number, c: number) => {
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    };
    for (let y = 0; y < H; y++) {
      const filter = raw[y * (stride + 1)];
      const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
      for (let i = 0; i < stride; i++) {
        const a = i >= BPP ? px[y * stride + i - BPP] : 0;
        const b = y > 0 ? px[(y - 1) * stride + i] : 0;
        const c = i >= BPP && y > 0 ? px[(y - 1) * stride + i - BPP] : 0;
        let v = src[i]!;
        if (filter === 1) v += a;
        else if (filter === 2) v += b;
        else if (filter === 3) v += (a + b) >> 1;
        else if (filter === 4) v += paeth(a, b, c);
        px[y * stride + i] = v & 0xff;
      }
    }
    const at = (x: number, y: number) => {
      const i = y * stride + x * BPP;
      return Math.min(px[i]!, px[i + 1]!, px[i + 2]!);
    };

    /*
     * The subject occupies a known, centred box (624 x 489 at 78% fill).
     * For every row of it, take the span between the first and last
     * non-white pixel and count the pure white ENCLOSED by the artwork.
     * White outside that span is the legitimate background; white inside
     * it is either a genuine gap between two eggs — of which this
     * arrangement has very little — or flattening.
     *
     * Measured on both builds of this exact artwork:
     *     shipped (holes filled first) :  0.339% enclosed, longest run 39
     *     rejected (holes whitened)    : 15.297% enclosed, longest run 97
     * so the bounds below sit an order of magnitude clear of both.
     */
    const X0 = 88;
    const X1 = 711;
    const Y0 = 155;
    const Y1 = 643;

    let interior = 0;
    let enclosedWhite = 0;
    let longestRun = 0;
    for (let y = Y0; y <= Y1; y++) {
      const row: number[] = [];
      for (let x = X0; x <= X1; x++) row.push(at(x, y));
      let first = -1;
      let last = -1;
      for (let i = 0; i < row.length; i++) {
        if (row[i]! < 255) {
          if (first < 0) first = i;
          last = i;
        }
      }
      if (first < 0 || last <= first) continue;
      let run = 0;
      for (let i = first; i <= last; i++) {
        interior++;
        if (row[i] === 255) {
          enclosedWhite++;
          run++;
          if (run > longestRun) longestRun = run;
        } else {
          run = 0;
        }
      }
    }

    expect(interior).toBeGreaterThan(100_000);
    // Flat blown-out area enclosed by the artwork.
    expect(enclosedWhite / interior).toBeLessThan(0.02);
    // And no wide flat band across the curved surface.
    expect(longestRun).toBeLessThan(60);
  });

  /**
   * STEP 14E — the Fresh Vegetables category picture.
   *
   * This is the first category whose PROVISIONS already carry pictures of
   * their own — forty-four of its forty-five do, set in STEP 12B. Every
   * earlier category cover sat above provisions that had none, so a leak
   * in either direction showed up as a picture where there had been a
   * placeholder. Here it would show up as the WRONG picture: a crate of
   * mixed vegetables against Tomato Red, or a single tomato standing for
   * the whole allowance. TEST 16 is therefore the sharpest cross-over
   * test in this suite, and it is specific to this pool.
   *
   * Note the code is VEGETABLES while the customer-facing name is
   * "Fresh Vegetables". The tests match on the code, as the migration does.
   */
  it('TEST 15 — Fresh Vegetables returns the correct imageRef, and that file exists', async () => {
    const rows = await pools();
    const veg = rows.find((r) => r.code === 'VEGETABLES')!;
    expect(veg.image_ref).toBe(VEGETABLES_IMAGE);
    expect(veg.name).toBe('Fresh Vegetables');

    const served = await categories();
    const category = served.find((c) => c.code === 'VEGETABLES')!;
    expect(category.imageRef).toBe(VEGETABLES_IMAGE);

    const bytes = readFileSync(join(PUBLIC_DIR, VEGETABLES_IMAGE));
    expect(existsSync(join(PUBLIC_DIR, VEGETABLES_IMAGE))).toBe(true);
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(bytes.readUInt32BE(16)).toBe(800);
    expect(bytes.readUInt32BE(20)).toBe(800);

    // Four categories, four distinct files.
    for (const [code, path] of WITH_PICTURE) {
      if (code === 'VEGETABLES') continue;
      expect(VEGETABLES_IMAGE).not.toBe(path);
      expect(bytes.equals(readFileSync(join(PUBLIC_DIR, path)))).toBe(false);
    }
  });

  it('TEST 16 — the Fresh Vegetables cover and its 45 provision pictures never swap', async () => {
    const served = await categories();
    const veg = served.find((c) => c.code === 'VEGETABLES')!;

    // The condition that makes this test matter, asserted rather than assumed.
    expect(veg.provisions.length + (await db.query(
      `SELECT 1 FROM rik.provisions pr JOIN rik.entitlement_pools p ON p.id = pr.pool_id
        WHERE p.code = 'VEGETABLES' AND pr.image_ref IS NOT NULL`
    )).length).toBeGreaterThan(1);

    // Not one provision carries the category cover, or any category path.
    for (const p of veg.provisions) {
      expect(p.imageRef).not.toBe(VEGETABLES_IMAGE);
      expect(p.imageRef?.startsWith('/catalogue/rik/category/') ?? false).toBe(false);
    }
    // And the cover is not one of the provision pictures borrowed upward.
    const provisionPaths = await db.query<{ image_ref: string }>(
      `SELECT DISTINCT image_ref FROM rik.provisions WHERE image_ref IS NOT NULL`
    );
    expect(provisionPaths.map((r) => r.image_ref)).not.toContain(VEGETABLES_IMAGE);

    // The provisions that had their own pictures still have them.
    const withPictures = await db.query<{ n: string }>(
      `SELECT count(pr.image_ref)::text AS n FROM rik.provisions pr
         JOIN rik.entitlement_pools p ON p.id = pr.pool_id WHERE p.code = 'VEGETABLES'`
    );
    expect(Number(withPictures[0]!.n)).toBe(44);
  });

  it('TEST 17 — adding Fresh Vegetables left the other three, and every figure, alone', async () => {
    const rows = await pools();
    expect(rows.find((r) => r.code === 'MILK')!.image_ref).toBe(MILK_IMAGE);
    expect(rows.find((r) => r.code === 'MEAT')!.image_ref).toBe(MEAT_IMAGE);
    expect(rows.find((r) => r.code === 'EGGS')!.image_ref).toBe(EGGS_IMAGE);

    const veg = await db.query<{ name: string; unit: string; ration_type: string }>(
      `SELECT name, unit, ration_type FROM rik.entitlement_pools WHERE code = 'VEGETABLES'`
    );
    expect(veg[0]).toMatchObject({ name: 'Fresh Vegetables', unit: 'g', ration_type: 'FRESH' });

    const scales = await db.query<{ dietary_preference: string; daily_qty: string }>(
      `SELECT s.dietary_preference, s.daily_qty
         FROM rik.pool_scales s JOIN rik.entitlement_pools p ON p.id = s.pool_id
        WHERE p.code = 'VEGETABLES' AND s.is_active ORDER BY s.dietary_preference`
    );
    expect(scales.length).toBeGreaterThan(0);
    for (const sc of scales) expect(Number(sc.daily_qty)).toBeGreaterThan(0);

    // Fresh Fruits, Onion / Garlic and Potato are separate pools with covers
    // of their own (0039, 0040, 0041). Each must hold ITS OWN picture — the
    // claim this assertion has always made is that adding one category's
    // cover does not reach another's, and that is what is checked.
    for (const code of ['FRUITS', 'ONION_GARLIC', 'POTATO']) {
      const expected = WITH_PICTURE.find(([c]) => c === code)![1];
      expect(rows.find((r) => r.code === code)!.image_ref).toBe(expected);
      expect(rows.find((r) => r.code === code)!.image_ref).not.toBe(VEGETABLES_IMAGE);
    }
  });

  it('TEST 8 — the category picture is RIK_ADMIN work under the permission that existed', async () => {
    const milk = await db.query<{ id: string; image_ref: string }>(
      `SELECT id, image_ref FROM rik.entitlement_pools WHERE code = 'MILK'`
    );
    const id = milk[0]!.id;

    const listed = await request(server())
      .get('/admin/rik/config/pools')
      .set('Authorization', admin())
      .expect(200);
    expect(listed.body.items.find((p: { code: string }) => p.code === 'MILK').imageRef).toBe(MILK_IMAGE);

    for (const role of STAFF_ROLES.filter((r) => r !== 'RIK_ADMIN' && r !== 'SUPER_ADMIN')) {
      await request(server())
        .patch(`/admin/rik/config/pools/${id}`)
        .set('Authorization', bearer(role))
        .send({ imageRef: '/somewhere/else.png' })
        .expect(403);
    }
    await request(server()).patch(`/admin/rik/config/pools/${id}`).send({ imageRef: '/x.png' }).expect(401);

    const after = await db.query<{ image_ref: string }>(
      `SELECT image_ref FROM rik.entitlement_pools WHERE id = $1`,
      [id]
    );
    expect(after[0]!.image_ref).toBe(milk[0]!.image_ref);

    // No new role and no new permission were introduced for any of this.
    const roles = await db.query<{ name: string }>(`SELECT name FROM shared.roles`);
    const perms = await db.query<{ code: string }>(`SELECT code FROM shared.permissions`);
    expect(roles).toHaveLength(6);
    expect(perms).toHaveLength(22);
    expect(roles.map((r) => r.name)).not.toContain('PURCHASING');
  });
});
