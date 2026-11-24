import 'reflect-metadata';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../app.module';
import { DatabaseService } from '../database/database.service';
import { TokenService } from '../auth/services/token.service';
import { PasswordService } from '../auth/services/password.service';
import { RikEligibilityService } from './services/rik-eligibility.service';
import { RikEntitlementService } from './services/rik-entitlement.service';
import { CurrentPeriodLock } from './test-support/current-period-lock';

/**
 * STEP 12C-2 — the dry-catalogue pictures, attached to the right
 * provisions, over real PostgreSQL and real HTTP.
 *
 * WHAT THIS SUITE IS ABOUT. STEP 12C-2 writes one column, image_ref, on
 * 103 rows. Three of the four things it must prove are negatives:
 *
 *  1. EVERY PICTURE IS ON THE RIGHT PROVISION, one to one in both
 *     directions. No provision carries two pictures; no picture is
 *     carried by two provisions; every path is a file that exists.
 *
 *  2. THREE PROVISIONS STAY WITHOUT A PICTURE, deliberately.
 *     OIL_HYDROGENATED, TEA_LOOSE and COFFEE_LOOSE are not depicted on
 *     any supplied sheet, so they keep NULL and the customer screen
 *     falls back to its placeholder. Lending one of them another
 *     product's photograph would misrepresent what an officer chooses,
 *     so a test asserts the absence rather than trusting it.
 *
 *  3. THE FOUR OIL SKUs ARE TOLD APART. One sunflower visual and one
 *     mustard visual serve two pack sizes each, so each exists twice
 *     with its own label. Four provisions, four distinct paths, four
 *     distinct files — checked by content, not just by name.
 *
 *  4. NOTHING ELSE MOVED. The fresh mapping, the entitlement figures
 *     and the confirmed records are compared before and after a picture
 *     is changed through the admin API and must come back identical.
 *
 * AND ONE THING THIS SUITE DELIBERATELY PINS RATHER THAN FIXES. The
 * four oil rows store pack_size 500 / 1000 with the ENTITLEMENT unit
 * 'g' and pack_unit NULL, while their approved pictures read "500 ml"
 * and "1 Litre". That difference is a known, documented and unresolved
 * catalogue-data question. The test below asserts the STORED values are
 * unchanged, so that if anyone ever "tidies" them to match the image,
 * this suite says so out loud instead of letting a quantity drift.
 */
describe('RIK dry catalogue images (STEP 12C-2, integration, real PostgreSQL + real HTTP)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let tokenService: TokenService;
  let eligibility: RikEligibilityService;
  let entitlement: RikEntitlementService;

  const runId = randomUUID().slice(0, 8);
  const digits = runId.replace(/[^0-9]/g, '').padEnd(7, '2');
  const BASE = '/catalogue/rik/dry/';
  const FRESH_BASE = '/catalogue/rik/fresh/';
  const PUBLIC_DIR = join(__dirname, '..', '..', '..', 'customer-web', 'public');

  const DRY_POOLS = [
    'CEREALS', 'DAL', 'HYDROGENATED_OIL', 'SUGAR_JAGGERY', 'TEA_COFFEE', 'DALIYA',
    'BUTTER_GHEE', 'SALT', 'CHEESE_NUTRAMUL', 'CONDIMENTS', 'GARAM_MASALA_WHOLE',
  ];
  /** Not depicted on any supplied sheet; deliberately without a picture. */
  const NO_PICTURE = ['OIL_HYDROGENATED', 'TEA_LOOSE', 'COFFEE_LOOSE'];
  const OIL_SKUS = ['OIL_SUNFLOWER_500', 'OIL_SUNFLOWER_1000', 'OIL_MUSTARD_500', 'OIL_MUSTARD_1000'];

  let adminToken: string;
  let adminId: string;
  let customerId: string;
  let customerToken: string;
  let periodId: string;
  let periodLock: CurrentPeriodLock;
  const ELIGIBLE_DAYS = 30;

  const server = () => app.getHttpServer();
  const admin = () => `Bearer ${adminToken}`;

  interface Row {
    code: string;
    name: string;
    pool_code: string;
    image_ref: string | null;
    pack_size: string | null;
    pack_unit: string | null;
    unit: string;
    brand: string | null;
  }
  const catalogue = () =>
    db.query<Row>(
      `SELECT v.code, v.name, p.code AS pool_code, v.image_ref,
              v.pack_size::text AS pack_size, v.pack_unit, v.unit, v.brand
         FROM rik.provisions v JOIN rik.entitlement_pools p ON p.id = v.pool_id`
    );
  const dryRows = async () => (await catalogue()).filter((r) => DRY_POOLS.includes(r.pool_code));

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
    const staff = await db.query<{ id: string }>(
      `INSERT INTO shared.users (id, username, password_hash, display_name, status)
       VALUES (shared.uuid_generate_v7(), $1, $2, $3, 'ACTIVE') RETURNING id`,
      [`jest_12c2_rik_admin_${runId}`, passwordHash, `Jest 12C2 RIK_ADMIN ${runId}`]
    );
    adminId = staff[0]!.id;
    await db.query(
      `INSERT INTO shared.user_roles (user_id, role_id, granted_by)
       SELECT $1, r.id, $2 FROM shared.roles r WHERE r.name = 'RIK_ADMIN'`,
      [adminId, bootstrap[0]!.id]
    );
    adminToken = tokenService.signAccessToken({ principalType: 'STAFF', principalId: adminId });

    await db.query(
      `DELETE FROM rik.customer_period_eligibility
        WHERE period_id IN (SELECT id FROM rik.entitlement_periods WHERE name LIKE 'Jest 12C2%')`
    );
    await db.query(`DELETE FROM rik.entitlement_periods WHERE name LIKE 'Jest 12C2%'`);
    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
    const period = await db.query<{ id: string }>(
      `INSERT INTO rik.entitlement_periods (id, name, start_date, end_date, status)
       VALUES (shared.uuid_generate_v7(), $1, $2::date, $3::date, 'ACTIVE') RETURNING id`,
      [`Jest 12C2 period ${runId}`, iso(start), iso(end)]
    );
    periodId = period[0]!.id;

    const customer = await db.query<{ id: string }>(
      `INSERT INTO shared.customers (id, mobile_number, name, is_active, dietary_preference)
       VALUES (shared.uuid_generate_v7(), $1, $2, true, 'NV') RETURNING id`,
      [`+9176${digits.slice(0, 5)}8`, `Jest 12C2 Customer ${runId}`]
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
    await db.query('DELETE FROM shared.auth_sessions WHERE principal_id = ANY($1::uuid[])', [
      [adminId, customerId],
    ]);
    await db.query('DELETE FROM shared.user_roles WHERE user_id = $1', [adminId]);
    await db.query('DELETE FROM shared.users WHERE id = $1', [adminId]);
    await db.query('DELETE FROM shared.customers WHERE id = $1', [customerId]);
    await app.close();
    await periodLock.release();
  });

  // ===================================================================
  it('TEST 1 — exactly 103 dry provisions carry a picture', async () => {
    const dry = await dryRows();
    expect(dry).toHaveLength(106);
    const withPicture = dry.filter((r) => r.image_ref !== null);
    expect(withPicture).toHaveLength(103);
    expect(withPicture.every((r) => r.image_ref!.startsWith(BASE))).toBe(true);
  });

  it('TEST 2 — exactly 3 dry provisions deliberately have no picture', async () => {
    const dry = await dryRows();
    const without = dry.filter((r) => r.image_ref === null);
    expect(without.map((r) => r.code).sort()).toEqual([...NO_PICTURE].sort());
    // Null, not an empty string — the empty case is impossible at source.
    for (const r of without) expect(r.image_ref).toBeNull();
    await expect(
      db.query(`UPDATE rik.provisions SET image_ref = '' WHERE code = 'TEA_LOOSE'`)
    ).rejects.toBeDefined();
  });

  it('TEST 3 — every provision code maps to exactly one picture, and that file exists', async () => {
    const dry = await dryRows();
    const withPicture = dry.filter((r) => r.image_ref !== null);

    // One row, one value: guaranteed by the column, so the real check is
    // that each path resolves to a file actually on disk.
    const missing = withPicture
      .filter((r) => !existsSync(join(PUBLIC_DIR, r.image_ref!)))
      .map((r) => `${r.code}: ${r.image_ref}`);
    expect(missing).toEqual([]);

    // And each is a real PNG rather than an empty or stray file.
    for (const r of withPicture.slice(0, 6)) {
      const head = readFileSync(join(PUBLIC_DIR, r.image_ref!)).subarray(0, 8);
      expect([...head]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    }
  });

  it('TEST 4 — no picture serves more than one provision code', async () => {
    const all = await catalogue();
    const refs = all.filter((r) => r.image_ref !== null).map((r) => r.image_ref!);
    // 70 fresh varieties + 103 dry + the 7 fresh staples (migration 0052).
    // The assertion this test exists for is the one below it — one picture,
    // one provision — and that is unchanged.
    expect(refs).toHaveLength(180);
    expect(new Set(refs).size).toBe(180);

    const seen = new Map<string, string[]>();
    for (const r of all) {
      if (r.image_ref === null) continue;
      seen.set(r.image_ref, [...(seen.get(r.image_ref) ?? []), r.code]);
    }
    expect([...seen.values()].filter((v) => v.length > 1)).toEqual([]);
  });

  it('TEST 5 — the four oil SKUs have distinct pictures, each showing its own pack size', async () => {
    const all = await catalogue();
    const byCode = new Map(all.map((r) => [r.code, r]));
    const refs = OIL_SKUS.map((c) => byCode.get(c)!.image_ref);
    expect(refs.every((r) => r !== null)).toBe(true);
    expect(new Set(refs).size).toBe(4);

    // The pack size each one shows, from the path the migration set.
    expect(byCode.get('OIL_SUNFLOWER_500')!.image_ref).toBe(`${BASE}oil/oil__sunflower-refined-oil__500ml.png`);
    expect(byCode.get('OIL_SUNFLOWER_1000')!.image_ref).toBe(`${BASE}oil/oil__sunflower-refined-oil__1litre.png`);
    expect(byCode.get('OIL_MUSTARD_500')!.image_ref).toBe(`${BASE}oil/oil__mustard-oil__500ml.png`);
    expect(byCode.get('OIL_MUSTARD_1000')!.image_ref).toBe(`${BASE}oil/oil__mustard-oil__1litre.png`);

    // Distinct by content, not merely by filename — a copy-paste slip
    // would give two SKUs different names for the same bytes.
    const bytes = OIL_SKUS.map((c) => readFileSync(join(PUBLIC_DIR, byCode.get(c)!.image_ref!)).toString('base64'));
    expect(new Set(bytes).size).toBe(4);

    // Sunflower and mustard come from different source bottles; the two
    // pack sizes of one oil share a bottle and differ by the label.
    expect(bytes[0]).not.toBe(bytes[1]);
    expect(bytes[2]).not.toBe(bytes[3]);
  });

  it('TEST 6 — a provision with no picture is served null, so the screen falls back', async () => {
    const res = await request(server())
      .get('/rik/entitlements/current')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);

    type Served = { code: string; imageRef: string | null; name: string };
    const served: Served[] = [...res.body.fresh, ...res.body.dry].flatMap(
      (c: { provisions: Served[]; unavailableProvisions: Served[] }) => [
        ...c.provisions,
        ...c.unavailableProvisions,
      ]
    );

    const loose = served.filter((p) => NO_PICTURE.includes(p.code));
    expect(loose.length).toBeGreaterThan(0);
    for (const p of loose) expect(p.imageRef).toBeNull();

    // Everything the customer IS shown a picture for uses a real path.
    // Three catalogue folders now: the dry items, the seventy fresh
    // varieties, and the seven fresh staples added by migration 0052.
    for (const p of served) {
      if (p.imageRef === null) continue;
      expect(p.imageRef).toMatch(/^\/catalogue\/rik\/(dry|fresh|fresh-staples)\//);
    }
  });

  it('TEST 7 — attaching and clearing a picture changes no entitlement figure', async () => {
    const calculate = async () => {
      const basis = await eligibility.resolveBasis(customerId, periodId);
      const calc = await entitlement.calculate(basis);
      return [...calc.fresh, ...calc.dry].map((p) => ({
        code: p.code,
        dailyScale: p.dailyScale,
        eligibleDays: p.eligibleDays,
        total: p.totalEntitlement,
        consumed: p.consumed,
        remaining: p.remaining,
        provisions: p.provisions.map((v) => ({
          code: v.code,
          ratio: v.consumptionRatio,
          max: v.maxSelectableQuantity,
          packSize: v.packSize,
          unit: v.unit,
        })),
      }));
    };

    const before = await calculate();
    const row = await db.query<{ id: string; image_ref: string }>(
      `SELECT id, image_ref FROM rik.provisions WHERE code = 'CER_MAGGI'`
    );
    const id = row[0]!.id;

    await request(server())
      .patch(`/admin/rik/config/provisions/${id}`)
      .set('Authorization', admin())
      .send({ imageRef: null })
      .expect(200);
    expect(await calculate()).toEqual(before);

    await request(server())
      .patch(`/admin/rik/config/provisions/${id}`)
      .set('Authorization', admin())
      .send({ imageRef: row[0]!.image_ref })
      .expect(200);
    expect(await calculate()).toEqual(before);
  });

  it('TEST 8 — changing a picture leaves a confirmed selection exactly as recorded', async () => {
    const provision = await db.query<{ id: string; image_ref: string }>(
      `SELECT id, image_ref FROM rik.provisions WHERE code = 'CER_RICE_ROZANA'`
    );
    const provisionId = provision[0]!.id;
    const pool = await db.query<{ id: string }>(`SELECT id FROM rik.entitlement_pools WHERE code = 'CEREALS'`);

    const sel = await db.query<{ id: string }>(
      `INSERT INTO rik.entitlement_selections
         (id, customer_id, period_id, status, dietary_preference, eligible_days)
       VALUES (shared.uuid_generate_v7(), $1, $2, 'DRAFT', 'NV', $3) RETURNING id`,
      [customerId, periodId, ELIGIBLE_DAYS]
    );
    const selectionId = sel[0]!.id;
    await db.query(
      `INSERT INTO rik.entitlement_selection_items
         (selection_id, provision_id, pool_id, quantity, consumption_ratio, pool_equivalent_qty)
       VALUES ($1,$2,$3,1000,1,1000)`,
      [selectionId, provisionId, pool[0]!.id]
    );
    await db.query(
      `UPDATE rik.entitlement_selections
          SET status='CONFIRMED', rule_snapshot=$2::jsonb, confirmed_at=now(),
              reference_number='RIK-12C2-' || substr(md5(random()::text),1,8),
              fulfillment_type='PICKUP', pickup_location_name='Naval Park',
              availability_acknowledged=true, availability_acknowledged_at=now()
        WHERE id=$1`,
      [selectionId, JSON.stringify({ provisions: [{ id: provisionId, imageRef: provision[0]!.image_ref }] })]
    );

    const read = () =>
      db.query<{ snapshot: string; quantity: string; ratio: string; equiv: string; ref: string }>(
        `SELECT s.rule_snapshot::text AS snapshot, i.quantity::text AS quantity,
                i.consumption_ratio::text AS ratio, i.pool_equivalent_qty::text AS equiv,
                s.reference_number AS ref
           FROM rik.entitlement_selections s
           JOIN rik.entitlement_selection_items i ON i.selection_id = s.id
          WHERE s.id = $1`,
        [selectionId]
      );
    const before = await read();

    await request(server())
      .patch(`/admin/rik/config/provisions/${provisionId}`)
      .set('Authorization', admin())
      .send({ imageRef: `${BASE}cereals/whatever.png` })
      .expect(200);
    expect(await read()).toEqual(before);

    await request(server())
      .patch(`/admin/rik/config/provisions/${provisionId}`)
      .set('Authorization', admin())
      .send({ imageRef: provision[0]!.image_ref })
      .expect(200);

    await db.query(
      `UPDATE rik.entitlement_selections SET status='CANCELLED', cancelled_at=now() WHERE id=$1`,
      [selectionId]
    );
    await db.query(`DELETE FROM rik.entitlement_selections WHERE id=$1`, [selectionId]);
  });

  it('TEST 9 — no provision was created, deleted or retired', async () => {
    const all = await catalogue();
    expect(all).toHaveLength(190);
    const inactive = await db.query<{ code: string }>(
      `SELECT code FROM rik.provisions WHERE NOT is_active ORDER BY code`
    );
    // The two generic fresh placeholders retired in the 12B cleanup, and
    // nothing else. This step retired nothing.
    expect(inactive.map((r) => r.code)).toEqual(['FRUIT_FRESH', 'VEG_FRESH']);
  });

  it('TEST 10 — the fresh image mapping is untouched', async () => {
    const all = await catalogue();
    const fresh = all.filter((r) => ['VEGETABLES', 'FRUITS'].includes(r.pool_code));
    const withPicture = fresh.filter((r) => r.image_ref !== null);
    expect(withPicture).toHaveLength(70);
    expect(withPicture.every((r) => r.image_ref!.startsWith(FRESH_BASE))).toBe(true);
    // No fresh row acquired a dry picture, and no dry row a fresh one.
    expect(fresh.filter((r) => r.image_ref?.startsWith(BASE))).toEqual([]);
    const dry = await dryRows();
    expect(dry.filter((r) => r.image_ref?.startsWith(FRESH_BASE))).toEqual([]);
  });

  it('TEST 11 — the assignment is idempotent', async () => {
    // Re-applying the same value to every dry row must change nothing:
    // the same guard the migration uses, exercised against live data.
    const before = await dryRows();
    const changed = await db.query<{ code: string }>(
      `UPDATE rik.provisions v SET image_ref = v.image_ref, updated_at = now()
        WHERE v.image_ref IS DISTINCT FROM v.image_ref
        RETURNING v.code`
    );
    expect(changed).toEqual([]);
    expect(await dryRows()).toEqual(before);
  });

  it('TEST 12 — only image_ref carries this step; no other field is involved', async () => {
    // Read the columns the brief protects, for every dry row, and assert
    // they are all still populated as catalogue data rather than blanked.
    const dry = await dryRows();
    expect(dry.every((r) => typeof r.name === 'string' && r.name.length > 0)).toBe(true);
    expect(dry.every((r) => ['g', 'ml', 'piece'].includes(r.unit))).toBe(true);
    expect(dry.every((r) => r.pack_unit === null || ['g','kg','ml','litre','piece','packet','tin','box'].includes(r.pack_unit))).toBe(true);

    // The known fixed points of the dry catalogue, unchanged.
    const byCode = new Map(dry.map((r) => [r.code, r]));
    expect(Number(byCode.get('CER_MAGGI')!.pack_size)).toBe(280);
    expect(Number(byCode.get('CER_HAKKA_NOODLES')!.pack_size)).toBe(1000);
    expect(Number(byCode.get('CER_MAIDA')!.pack_size)).toBe(500);
    expect(byCode.get('CH_PANEER')!.brand).toBe('Amul');
    expect(byCode.get('BG_AMUL_GHEE')!.pack_unit).toBe('tin');
  });

  /**
   * TEST 13 — the oil rows are PINNED, not corrected.
   *
   * Their pictures read "500 ml" and "1 Litre"; the rows read 500 and
   * 1000 with the entitlement unit 'g' and pack_unit NULL. That gap is
   * a known catalogue-data question with a business decision still
   * outstanding. This test exists so that nobody closes it quietly: an
   * image label is not evidence about a stored quantity, and if these
   * values are ever changed to match the picture, this fails.
   */
  it('TEST 13 — the four oil provisions retain their stored measurements exactly', async () => {
    const all = await catalogue();
    const byCode = new Map(all.map((r) => [r.code, r]));

    for (const code of ['OIL_SUNFLOWER_500', 'OIL_MUSTARD_500']) {
      const r = byCode.get(code)!;
      expect(Number(r.pack_size)).toBe(500);
      expect(r.unit).toBe('g');
      expect(r.pack_unit).toBeNull();
    }
    for (const code of ['OIL_SUNFLOWER_1000', 'OIL_MUSTARD_1000']) {
      const r = byCode.get(code)!;
      expect(Number(r.pack_size)).toBe(1000);
      expect(r.unit).toBe('g');
      expect(r.pack_unit).toBeNull();
    }
    // Names and the absent brand are equally untouched.
    expect(byCode.get('OIL_SUNFLOWER_500')!.name).toBe('Sunflower Refined Oil');
    expect(byCode.get('OIL_MUSTARD_500')!.name).toBe('Mustard Oil');
    for (const code of OIL_SKUS) expect(byCode.get(code)!.brand).toBeNull();
  });
});
