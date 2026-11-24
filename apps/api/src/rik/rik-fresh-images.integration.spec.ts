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
 * STEP 12B — the seventy fresh-catalogue pictures, attached to the right
 * provisions, over real PostgreSQL and real HTTP.
 *
 * WHAT THIS SUITE IS ABOUT. STEP 12B writes one column, image_ref, on
 * seventy rows. That is the whole change. So the suite has two jobs, and
 * the second is the larger one:
 *
 *  1. EVERY PICTURE IS ON THE RIGHT PROVISION. Not "44 rows have a
 *     picture" — each of the seventy is checked by provision code against
 *     the filename the facility's own catalogue caption gives it, and the
 *     file is checked to exist on disk. The near-misses the catalogue
 *     actually contains get tests of their own: Spring Onion is not Onion,
 *     the two grape varieties stay apart, the purple-and-green brinjal is
 *     one provision, and Musambi/Sweet Lemon survives its slash.
 *
 *  2. NOTHING ELSE MOVED. A picture is not an entitlement. The entitlement
 *     figures, the confirmed records and every other catalogue column are
 *     compared before and after a picture is changed through the admin API,
 *     and must come back identical.
 *
 * THE GENERIC PLACEHOLDERS ARE CHECKED BY NAME. VEG_FRESH, FRUIT_FRESH and
 * FRUIT_DRY are not varieties and none of the seventy pictures depicts
 * them. They must keep image_ref NULL so the customer screen keeps showing
 * its placeholder for them, and a test says so explicitly — this is the
 * mis-assignment that would be easiest to make and hardest to notice.
 */
describe('RIK fresh catalogue images (STEP 12B, integration, real PostgreSQL + real HTTP)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let tokenService: TokenService;
  let eligibility: RikEligibilityService;
  let entitlement: RikEntitlementService;

  const runId = randomUUID().slice(0, 8);
  const digits = runId.replace(/[^0-9]/g, '').padEnd(7, '4');
  const BASE = '/catalogue/rik/fresh/';
  /** Where the customer app serves its static assets from. */
  const PUBLIC_DIR = join(__dirname, '..', '..', '..', 'customer-web', 'public');

  let adminToken: string;
  let adminId: string;
  let pifAdminToken: string;
  let pifAdminId: string;
  let customerId: string;
  let customerToken: string;
  let periodId: string;
  let periodLock: CurrentPeriodLock;
  const ELIGIBLE_DAYS = 31;

  const server = () => app.getHttpServer();
  const admin = () => `Bearer ${adminToken}`;

  /**
   * The mapping under test, as the facility's captions give it: the file
   * the STEP 12A extraction produced, against the provision CODE it
   * belongs to. Codes rather than display names, because a display name is
   * editable from the dashboard and a code is not.
   */
  const EXPECTED: ReadonlyArray<readonly [string, string]> = [
    ['VEG_ARVI', '01_arvi.png'],
    ['VEG_ASPARAGUS', '02_asparagus.png'],
    ['VEG_BABY_CORN', '03_baby-corn.png'],
    ['VEG_BEANS_FRENCH', '04_beans-french.png'],
    ['VEG_BEANS_LONG', '05_beans-long.png'],
    ['VEG_BEETROOT', '06_beetroot.png'],
    ['VEG_BITTER_GUARD', '07_bitter-guard.png'],
    ['VEG_BOTTLE_GUARD', '08_bottle-guard.png'],
    ['VEG_BRINJAL_PURPLE_AND_GREEN', '09_brinjal-purple-green.png'],
    ['VEG_BROCCOLI', '10_broccoli.png'],
    ['VEG_CABBAGE', '11_cabbage.png'],
    ['VEG_CAPSICUM', '12_capsicum.png'],
    ['VEG_CAPSICUM_RED', '13_capsicum-red.png'],
    ['VEG_CAPSICUM_YELLOW', '14_capsicum-yellow.png'],
    ['VEG_CARROT_COUNTRY', '15_carrot-country.png'],
    ['VEG_CARROT_RED', '16_carrot-red.png'],
    ['VEG_CAULIFLOWER', '17_cauliflower.png'],
    ['VEG_CHILLY_GREEN', '18_chilly-green.png'],
    ['VEG_CLUSTER_BEANS', '19_cluster-beans.png'],
    ['VEG_CORIANDER_GREEN', '20_coriander-green.png'],
    ['VEG_COWPEAS', '21_cowpeas.png'],
    ['VEG_CUCUMBER', '22_cucumber.png'],
    ['VEG_CURRY_LEAVES', '23_curry-leaves.png'],
    ['VEG_DRUM_STICK', '24_drum-stick.png'],
    ['VEG_GINGER_GREEN', '25_ginger-green.png'],
    ['VEG_KHOL_KHOL', '26_khol-khol.png'],
    ['VEG_KUNDRI', '27_kundri.png'],
    ['VEG_LADIE_S_FINGER', '28_ladies-finger.png'],
    ['VEG_LEEK', '29_leek.png'],
    ['VEG_MARROW', '30_marrow.png'],
    ['VEG_MINT_GREEN', '31_mint-green.png'],
    ['VEG_MUSHROOM', '32_mushroom.png'],
    ['VEG_PARWAL', '33_parwal.png'],
    ['VEG_PEAS_GREEN', '34_peas-green.png'],
    ['VEG_PUMPKIN', '35_pumpkin.png'],
    ['VEG_RADISH', '36_radish.png'],
    ['VEG_RIBBED_GUARD', '37_ribbed-guard.png'],
    ['VEG_SNAKE_GUARD', '38_snake-guard.png'],
    ['VEG_SPINACH_COUNTRY', '39_spinach-country.png'],
    ['VEG_SPRING_ONION', '40_spring-onion.png'],
    ['VEG_TINDA', '41_tinda.png'],
    ['VEG_TOMATO_RED', '42_tomato-red.png'],
    ['VEG_TURNIP', '43_turnip.png'],
    ['VEG_ZIMIKAND', '44_zimikand.png'],
    ['FRUIT_APPLE_SHIMLA', '45_apple-shimla.png'],
    ['FRUIT_CUSTARD_APPLE', '46_custard-apple.png'],
    ['FRUIT_MANGO_BANGANPALLI', '47_mango-banganpalli.png'],
    ['FRUIT_ORANGE', '48_orange.png'],
    ['FRUIT_BANANA_ROBUSTA', '49_banana-robusta.png'],
    ['FRUIT_GRAPES_BLACK_S_L', '50_grapes-black-sl.png'],
    ['FRUIT_GRAPES_S_L', '51_grapes-sl.png'],
    ['FRUIT_KINNU', '52_kinnu.png'],
    ['FRUIT_MUSAMBI_SWEET_LEMON', '53_musambi-sweet-lemon.png'],
    ['FRUIT_MUSKMELON', '54_muskmelon.png'],
    ['FRUIT_PAPAYA', '55_papaya.png'],
    ['FRUIT_SOUR_LIME', '56_sour-lime.png'],
    ['FRUIT_WATERMELON', '57_watermelon.png'],
    ['FRUIT_PINEAPPLE', '58_pineapple.png'],
    ['FRUIT_MANGO_DASHERI', '59_mango-dasheri.png'],
    ['FRUIT_MANGO_LANGRA', '60_mango-langra.png'],
    ['FRUIT_APRICOT', '61_apricot.png'],
    ['FRUIT_LITCHI', '62_litchi.png'],
    ['FRUIT_PEARS', '63_pears.png'],
    ['FRUIT_PLUM', '64_plum.png'],
    ['FRUIT_STRAWBERRY', '65_strawberry.png'],
    ['FRUIT_THAI_GUAVA', '66_thai-guava.png'],
    ['FRUIT_KIWI', '67_kiwi.png'],
    ['FRUIT_DRAGON_FRUIT', '68_dragon-fruit.png'],
    ['FRUIT_CHICKOO', '69_chickoo.png'],
    ['FRUIT_POMEGRANATE', '70_pomegranate.png'],
  ];

  const PLACEHOLDERS = ['VEG_FRESH', 'FRUIT_FRESH', 'FRUIT_DRY'];

  interface Row {
    code: string;
    name: string;
    image_ref: string | null;
    pool_code: string;
  }
  const catalogue = () =>
    db.query<Row>(
      `SELECT v.code, v.name, v.image_ref, p.code AS pool_code
         FROM rik.provisions v JOIN rik.entitlement_pools p ON p.id = v.pool_id`
    );

  beforeAll(async () => {
    // Two of these tests ask the customer endpoint what it is serving
    // today, which needs THE current ration period. Only one spec may own
    // that at a time (rik_ent_periods_no_overlap is a global exclusion),
    // so this takes the same advisory lock the checkout suite uses.
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

    const mkStaff = async (role: string) => {
      const rows = await db.query<{ id: string }>(
        `INSERT INTO shared.users (id, username, password_hash, display_name, status)
         VALUES (shared.uuid_generate_v7(), $1, $2, $3, 'ACTIVE') RETURNING id`,
        [`jest_12b_${role.toLowerCase()}_${runId}`, passwordHash, `Jest 12B ${role} ${runId}`]
      );
      const id = rows[0]!.id;
      await db.query(
        `INSERT INTO shared.user_roles (user_id, role_id, granted_by)
         SELECT $1, r.id, $2 FROM shared.roles r WHERE r.name = $3`,
        [id, grantedBy, role]
      );
      return { id, token: tokenService.signAccessToken({ principalType: 'STAFF', principalId: id }) };
    };
    ({ id: adminId, token: adminToken } = await mkStaff('RIK_ADMIN'));
    ({ id: pifAdminId, token: pifAdminToken } = await mkStaff('PIF_ADMIN'));

    await db.query(
      `DELETE FROM rik.customer_period_eligibility
        WHERE period_id IN (SELECT id FROM rik.entitlement_periods WHERE name LIKE 'Jest 12B%')`
    );
    await db.query(`DELETE FROM rik.entitlement_periods WHERE name LIKE 'Jest 12B%'`);
    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
    const period = await db.query<{ id: string }>(
      `INSERT INTO rik.entitlement_periods (id, name, start_date, end_date, status)
       VALUES (shared.uuid_generate_v7(), $1, $2::date, $3::date, 'ACTIVE') RETURNING id`,
      [`Jest 12B period ${runId}`, iso(start), iso(end)]
    );
    periodId = period[0]!.id;

    const customer = await db.query<{ id: string }>(
      `INSERT INTO shared.customers (id, mobile_number, name, is_active, dietary_preference)
       VALUES (shared.uuid_generate_v7(), $1, $2, true, 'NV') RETURNING id`,
      [`+9177${digits.slice(0, 5)}6`, `Jest 12B Customer ${runId}`]
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
    const staff = [adminId, pifAdminId];
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
  // 1 & 2. The counts
  // ===================================================================
  it('TEST 1 — exactly 44 Fresh Vegetable provisions carry a picture', async () => {
    const rows = await catalogue();
    const veg = rows.filter(
      (r) => r.pool_code === 'VEGETABLES' && !PLACEHOLDERS.includes(r.code) && r.image_ref !== null
    );
    expect(veg).toHaveLength(44);
    expect(veg.every((r) => r.image_ref!.startsWith(BASE))).toBe(true);
  });

  it('TEST 2 — exactly 26 Fresh Fruit provisions carry a picture', async () => {
    const rows = await catalogue();
    const fruit = rows.filter(
      (r) => r.pool_code === 'FRUITS' && !PLACEHOLDERS.includes(r.code) && r.image_ref !== null
    );
    expect(fruit).toHaveLength(26);
    expect(fruit.every((r) => r.image_ref!.startsWith(BASE))).toBe(true);
  });

  // ===================================================================
  // 3. Every single one, by code — not a count, a mapping
  // ===================================================================
  it('TEST 3 — no picture is attached to the wrong provision', async () => {
    const rows = await catalogue();
    const byCode = new Map(rows.map((r) => [r.code, r]));

    const wrong: string[] = [];
    for (const [code, file] of EXPECTED) {
      const row = byCode.get(code);
      if (!row) { wrong.push(`${code}: provision missing`); continue; }
      if (row.image_ref !== `${BASE}${file}`) {
        wrong.push(`${code}: expected ${BASE}${file}, found ${row.image_ref}`);
      }
    }
    expect(wrong).toEqual([]);

    // And in the other direction: no provision outside the seventy
    // carries a FRESH picture.
    //
    // This was written when the fresh set was the only set with
    // pictures, and read "no provision anywhere has one". STEP 12C-2
    // gave the dry catalogue its own 103, so the assertion is scoped to
    // what it was always about — the fresh folder — rather than relaxed.
    // A dry row that acquired a fresh picture, or a fresh row that
    // acquired a dry one, still fails here.
    const expectedCodes = new Set(EXPECTED.map(([c]) => c));
    const unexpected = rows.filter(
      (r) => r.image_ref !== null && r.image_ref.startsWith(BASE) && !expectedCodes.has(r.code)
    );
    expect(unexpected.map((r) => r.code)).toEqual([]);
    const freshRowsWithForeignPicture = rows.filter(
      (r) => expectedCodes.has(r.code) && r.image_ref !== null && !r.image_ref.startsWith(BASE)
    );
    expect(freshRowsWithForeignPicture.map((r) => r.code)).toEqual([]);

    // One picture belongs to exactly one provision — checked across the
    // whole catalogue, fresh and dry together.
    const refs = rows.filter((r) => r.image_ref !== null).map((r) => r.image_ref!);
    expect(refs.filter((r) => r.startsWith(BASE))).toHaveLength(70);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it('TEST 3b — every attached picture is a real file on disk', () => {
    const missing = EXPECTED.filter(([, f]) => !existsSync(join(PUBLIC_DIR, BASE, f))).map(([c, f]) => `${c}: ${f}`);
    expect(missing).toEqual([]);
    // And it is a PNG, not a placeholder or an empty file.
    for (const [, f] of EXPECTED.slice(0, 5)) {
      const head = readFileSync(join(PUBLIC_DIR, BASE, f)).subarray(0, 8);
      expect([...head]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    }
  });

  // ===================================================================
  // 4–7. The near-misses this catalogue actually contains
  // ===================================================================
  it('TEST 4 — Spring Onion gets the spring onion, and the bulb onion gets its own picture, never this one', async () => {
    const rows = await catalogue();
    const spring = rows.find((r) => r.code === 'VEG_SPRING_ONION')!;
    expect(spring.name).toBe('Spring Onion');
    expect(spring.pool_code).toBe('VEGETABLES');
    expect(spring.image_ref).toBe(`${BASE}40_spring-onion.png`);

    // The bulb onion is a separate allowance in its own pool and is not one
    // of the seventy.
    //
    // UPDATED BY MIGRATION 0052. This read "it must still have no picture at
    // all", which was true only because none existed: the client had supplied
    // no bulb-onion photograph. One has now been supplied and ONION_FRESH
    // carries it. The point of this test is unchanged and is the reason it
    // was written — Spring Onion and the bulb onion are different things, and
    // neither may wear the other's picture. That is now asserted directly
    // rather than by the absence of any picture at all.
    const onionPool = rows.filter((r) => r.pool_code === 'ONION_GARLIC');
    expect(onionPool.length).toBeGreaterThan(0);

    const bulbOnion = onionPool.find((r) => r.code === 'ONION_FRESH')!;
    expect(bulbOnion.name).toBe('Onion');
    expect(bulbOnion.image_ref).toBe('/catalogue/rik/fresh-staples/onion__fresh.png');

    // No provision in that pool carries a picture from the seventy, and
    // Garlic still has none of its own.
    expect(onionPool.filter((r) => r.image_ref?.startsWith(BASE))).toEqual([]);
    expect(onionPool.find((r) => r.code === 'GARLIC_FRESH')!.image_ref).toBeNull();

    // Nothing anywhere was given the spring onion's picture twice.
    expect(rows.filter((r) => r.image_ref === `${BASE}40_spring-onion.png`)).toHaveLength(1);
  });

  it('TEST 5 — Brinjal (Purple & Green) is one provision with one picture', async () => {
    const rows = await catalogue();
    const brinjal = rows.filter((r) => r.name === 'Brinjal (Purple & Green)');
    expect(brinjal).toHaveLength(1);
    expect(brinjal[0]!.code).toBe('VEG_BRINJAL_PURPLE_AND_GREEN');
    expect(brinjal[0]!.image_ref).toBe(`${BASE}09_brinjal-purple-green.png`);
  });

  it('TEST 6 — the two grape varieties stay separate, with a picture each', async () => {
    const rows = await catalogue();
    const black = rows.find((r) => r.code === 'FRUIT_GRAPES_BLACK_S_L')!;
    const green = rows.find((r) => r.code === 'FRUIT_GRAPES_S_L')!;
    expect(black.name).toBe('Grapes Black S/L');
    expect(green.name).toBe('Grapes S/L');
    expect(black.image_ref).toBe(`${BASE}50_grapes-black-sl.png`);
    expect(green.image_ref).toBe(`${BASE}51_grapes-sl.png`);
    expect(black.image_ref).not.toBe(green.image_ref);
  });

  it('TEST 7 — Musambi/Sweet Lemon keeps its name and gets its own picture', async () => {
    const rows = await catalogue();
    const m = rows.find((r) => r.code === 'FRUIT_MUSAMBI_SWEET_LEMON')!;
    expect(m.name).toBe('Musambi/Sweet Lemon');
    expect(m.image_ref).toBe(`${BASE}53_musambi-sweet-lemon.png`);
    // Not confused with the sour lime beside it.
    const sour = rows.find((r) => r.code === 'FRUIT_SOUR_LIME')!;
    expect(sour.image_ref).toBe(`${BASE}56_sour-lime.png`);
  });

  // ===================================================================
  // 8. The generic placeholders
  // ===================================================================
  it('TEST 8 — the generic placeholder provisions were given no picture', async () => {
    const rows = await catalogue();
    const generics = rows.filter((r) => PLACEHOLDERS.includes(r.code));
    expect(generics).toHaveLength(3);
    for (const g of generics) expect(g.image_ref).toBeNull();
    // They are still there, still named as they were.
    expect(generics.map((g) => g.name).sort()).toEqual(['Dry Fruits', 'Fresh Fruits', 'Fresh Vegetables']);
  });

  // ===================================================================
  // 9 & 10. What the customer is served
  // ===================================================================
  it('TEST 9 — the customer API returns the right picture for a variety', async () => {
    const res = await request(server())
      .get('/rik/entitlements/current')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);

    const categories = [...res.body.fresh, ...res.body.dry];
    const veg = categories.find((c: { code: string }) => c.code === 'VEGETABLES');
    expect(veg).toBeDefined();

    const all = [...veg.provisions, ...veg.unavailableProvisions];
    const tomato = all.find((p: { code: string }) => p.code === 'VEG_TOMATO_RED');
    expect(tomato).toBeDefined();
    expect(tomato.imageRef).toBe(`${BASE}42_tomato-red.png`);
    expect(tomato.name).toBe('Tomato Red');

    // The picture travels with the item everywhere it is offered, and it
    // is never a pool id, a database id or a code dressed up as a path.
    for (const p of all) {
      if (p.imageRef === null) continue;
      expect(p.imageRef).toMatch(/^\/catalogue\/rik\/fresh\/\d{2}_[a-z0-9-]+\.png$/);
      expect(p.imageRef).not.toContain(p.provisionId);
    }
  });

  it('TEST 10 — an item with no picture is served null, so the screen falls back', async () => {
    const res = await request(server())
      .get('/rik/entitlements/current')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);

    const categories = [...res.body.fresh, ...res.body.dry];
    type Served = { imageRef: string | null };
    const withoutPictures = categories
      .flatMap((c: { provisions: Served[]; unavailableProvisions: Served[] }) => [
        ...c.provisions,
        ...c.unavailableProvisions,
      ])
      .filter((p: Served) => p.imageRef === null);

    // The dry catalogue has no pictures yet, so there is plenty to check.
    expect(withoutPictures.length).toBeGreaterThan(0);
    // Null, never an empty string, a "null" string or an invented path —
    // each of which would defeat the screen's placeholder.
    for (const p of withoutPictures) {
      expect(p.imageRef).toBeNull();
    }
    // A database CHECK makes the empty-string case impossible at the source.
    await expect(
      db.query(`UPDATE rik.provisions SET image_ref = '' WHERE code = 'CER_MAGGI'`)
    ).rejects.toBeDefined();
  });

  // ===================================================================
  // 11 & 12. A picture is not an entitlement
  // ===================================================================
  it('TEST 11 — changing a picture leaves a confirmed selection exactly as recorded', async () => {
    const provision = await db.query<{ id: string; image_ref: string }>(
      `SELECT id, image_ref FROM rik.provisions WHERE code = 'VEG_TOMATO_RED'`
    );
    const provisionId = provision[0]!.id;
    const poolRow = await db.query<{ id: string }>(
      `SELECT id FROM rik.entitlement_pools WHERE code = 'VEGETABLES'`
    );

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
       VALUES ($1,$2,$3,500,1,500)`,
      [selectionId, provisionId, poolRow[0]!.id]
    );
    await db.query(
      `UPDATE rik.entitlement_selections
          SET status='CONFIRMED', rule_snapshot=$2::jsonb, confirmed_at=now(),
              reference_number='RIK-12B-' || substr(md5(random()::text),1,8),
              fulfillment_type='PICKUP', pickup_location_name='Naval Park',
              availability_acknowledged=true, availability_acknowledged_at=now()
        WHERE id=$1`,
      [
        selectionId,
        JSON.stringify({ provisions: [{ id: provisionId, name: 'Tomato Red', imageRef: provision[0]!.image_ref }] }),
      ]
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

    // Change the picture through the admin API, the way an officer would.
    await request(server())
      .patch(`/admin/rik/config/provisions/${provisionId}`)
      .set('Authorization', admin())
      .send({ imageRef: `${BASE}42_tomato-red.png?v=2` })
      .expect(200);

    expect(await read()).toEqual(before);

    await request(server())
      .patch(`/admin/rik/config/provisions/${provisionId}`)
      .set('Authorization', admin())
      .send({ imageRef: provision[0]!.image_ref })
      .expect(200);

    // Tidy up: a CONFIRMED row has to be cancelled before it can go.
    await db.query(
      `UPDATE rik.entitlement_selections SET status='CANCELLED', cancelled_at=now() WHERE id=$1`,
      [selectionId]
    );
    await db.query(`DELETE FROM rik.entitlement_selections WHERE id=$1`, [selectionId]);
  });

  it('TEST 12 — attaching and clearing a picture changes no entitlement figure', async () => {
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
        })),
      }));
    };

    const before = await calculate();
    const row = await db.query<{ id: string; image_ref: string }>(
      `SELECT id, image_ref FROM rik.provisions WHERE code = 'VEG_PUMPKIN'`
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

  // ===================================================================
  // The admin path this step relies on, under the permission that existed
  // ===================================================================
  it('the picture is RIK_ADMIN work under the existing catalogue permission', async () => {
    const row = await db.query<{ id: string; image_ref: string }>(
      `SELECT id, image_ref FROM rik.provisions WHERE code = 'VEG_CABBAGE'`
    );
    const id = row[0]!.id;

    const listed = await request(server())
      .get('/admin/rik/config/provisions')
      .set('Authorization', admin())
      .expect(200);
    const cabbage = listed.body.items.find((p: { code: string }) => p.code === 'VEG_CABBAGE');
    expect(cabbage.imageRef).toBe(`${BASE}11_cabbage.png`);

    await request(server())
      .patch(`/admin/rik/config/provisions/${id}`)
      .set('Authorization', `Bearer ${pifAdminToken}`)
      .send({ imageRef: '/somewhere/else.png' })
      .expect(403);
    await request(server()).patch(`/admin/rik/config/provisions/${id}`).send({ imageRef: '/x.png' }).expect(401);

    // Unchanged by the refusals.
    const after = await db.query<{ image_ref: string }>(
      `SELECT image_ref FROM rik.provisions WHERE id = $1`,
      [id]
    );
    expect(after[0]!.image_ref).toBe(row[0]!.image_ref);

    // No new role and no new permission were introduced for any of this.
    const roles = await db.query<{ name: string }>(`SELECT name FROM shared.roles`);
    const perms = await db.query<{ code: string }>(`SELECT code FROM shared.permissions`);
    expect(roles).toHaveLength(6);
    expect(perms).toHaveLength(22);
    expect(roles.map((r) => r.name)).not.toContain('PURCHASING');
  });

  // ===================================================================
  // STEP 12B-CLEANUP — the generic fresh placeholders are retired
  //
  // VEG_FRESH ("Fresh Vegetables") and FRUIT_FRESH ("Fresh Fruits") were
  // temporary generic entries the two fresh pools were created with. Now
  // that the 44 and 26 named client varieties are loaded and pictured,
  // leaving them selectable would let an officer take unspecified "Fresh
  // Vegetables" and bypass the variety choice entirely.
  //
  // They were retired through the RIK Admin SKU Master workflow — a
  // RIK_ADMIN logging in and using the screen's Retire action, which is
  // POST /admin/rik/config/provisions/:id/active with isActive false.
  // Not by SQL, and not by deletion: both rows are still there, still
  // named, still carrying their history, and the change is in the audit
  // log under the administrator who made it.
  //
  // NOTE FOR A REBUILT ENVIRONMENT. This state is data, created by an
  // administrator, not by a migration. A database rebuilt from migrations
  // alone will have both rows active again and these tests will fail,
  // which is the intended signal: repeat the Retire action in that
  // environment (see docs/reports/step-12b-cleanup-report.md).
  // ===================================================================
  describe('the generic fresh placeholders are retired, not deleted', () => {
    it('both records still exist, keep their names, and are inactive', async () => {
      const rows = await db.query<{ code: string; name: string; is_active: boolean }>(
        `SELECT code, name, is_active FROM rik.provisions
          WHERE code IN ('VEG_FRESH','FRUIT_FRESH') ORDER BY code`
      );
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => [r.code, r.name, r.is_active])).toEqual([
        ['FRUIT_FRESH', 'Fresh Fruits', false],
        ['VEG_FRESH', 'Fresh Vegetables', false],
      ]);
    });

    it('FRUIT_DRY was left active — it is a real provision, not a placeholder', async () => {
      const rows = await db.query<{ is_active: boolean; is_customer_selectable: boolean }>(
        `SELECT is_active, is_customer_selectable FROM rik.provisions WHERE code = 'FRUIT_DRY'`
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.is_active).toBe(true);
      expect(rows[0]!.is_customer_selectable).toBe(true);
    });

    it('nothing was deleted — the catalogue still holds every row it did', async () => {
      const rows = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM rik.provisions`
      );
      expect(Number(rows[0]!.count)).toBe(190);
    });

    it('the customer is offered the 44 named vegetables and no generic entry', async () => {
      const res = await request(server())
        .get('/rik/entitlements/current')
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200);

      const veg = [...res.body.fresh, ...res.body.dry].find((c: { code: string }) => c.code === 'VEGETABLES');
      const offered = veg.provisions as Array<{ code: string; name: string }>;
      const withheld = veg.unavailableProvisions as Array<{ code: string }>;

      expect(offered).toHaveLength(44);
      expect(offered.map((p) => p.code)).not.toContain('VEG_FRESH');
      // A retired provision is not offered AND not listed as withheld —
      // it leaves the catalogue entirely rather than appearing with a
      // reason, which would tell an officer about an entry that no
      // longer exists.
      expect(withheld.map((p) => p.code)).not.toContain('VEG_FRESH');
      expect(offered.every((p) => p.code.startsWith('VEG_'))).toBe(true);
      expect(offered.every((p) => p.name !== 'Fresh Vegetables')).toBe(true);
    });

    it('the customer is offered the 26 named fruits, plus Dry Fruits, and no generic entry', async () => {
      const res = await request(server())
        .get('/rik/entitlements/current')
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200);

      const fruit = [...res.body.fresh, ...res.body.dry].find((c: { code: string }) => c.code === 'FRUITS');
      const offered = fruit.provisions as Array<{ code: string; name: string }>;
      const withheld = fruit.unavailableProvisions as Array<{ code: string }>;

      expect(offered.map((p) => p.code)).not.toContain('FRUIT_FRESH');
      expect(withheld.map((p) => p.code)).not.toContain('FRUIT_FRESH');

      // Exactly the 26 named fresh varieties...
      const named = offered.filter((p) => p.code !== 'FRUIT_DRY');
      expect(named).toHaveLength(26);
      expect(named.every((p) => p.name !== 'Fresh Fruits')).toBe(true);

      // ...and Dry Fruits alongside them, which is a provision in its own
      // right and was deliberately kept. So the fruit category shows 27
      // items in total, and that is correct rather than a miscount.
      expect(offered.map((p) => p.code)).toContain('FRUIT_DRY');
      expect(offered).toHaveLength(27);
    });

    it('retiring them changed no pool, no scale and no conversion', async () => {
      const pools = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM rik.entitlement_pools WHERE is_active`
      );
      // One open-ended scale per dietary preference, so the fresh pools
      // each have three — all at the same figure, which is the point.
      const scales = await db.query<{ pool: string; qty: string }>(
        `SELECT p.code AS pool, s.daily_qty::text AS qty FROM rik.pool_scales s
           JOIN rik.entitlement_pools p ON p.id = s.pool_id
          WHERE p.code IN ('VEGETABLES','FRUITS') AND s.is_active AND s.effective_to IS NULL
          ORDER BY p.code`
      );
      const conversions = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM rik.pool_conversions`
      );
      expect(Number(pools[0]!.count)).toBe(18);
      // FRUITS 230 g/day and VEGETABLES 170 g/day, exactly as before.
      const byPool = new Map<string, Set<number>>();
      for (const r of scales) {
        if (!byPool.has(r.pool)) byPool.set(r.pool, new Set());
        byPool.get(r.pool)!.add(Number(r.qty));
      }
      expect([...byPool.get('FRUITS')!]).toEqual([230]);
      expect([...byPool.get('VEGETABLES')!]).toEqual([170]);
      expect(Number(conversions[0]!.count)).toBe(7);
    });
  });
});
