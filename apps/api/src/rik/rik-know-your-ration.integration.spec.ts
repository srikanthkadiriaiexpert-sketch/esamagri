import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../app.module';
import { DatabaseService } from '../database/database.service';
import {
  clearRationEligibilityForCustomers,
  seedBothRationTypes,
} from './test-support/seed-ration-eligibility';
import { TokenService } from '../auth/services/token.service';
import { PasswordService } from '../auth/services/password.service';
import { CurrentPeriodLock } from './test-support/current-period-lock';

/**
 * STEP 11D — Know Your Ration, over the real customer HTTP surface.
 *
 * WHAT MAKES THIS DIFFERENT FROM THE STEP 11B SUITE. That one proves
 * the engine computes correctly, mostly by calling its services. This
 * one proves the CUSTOMER APP's contract: that the routes the browser
 * actually calls return, over HTTP, everything the seven requirements
 * of the screen need — and nothing that would let the browser compute
 * an entitlement for itself.
 *
 * It runs against the approved production seed (18 pools, 50 scales,
 * 7 conversions, 119 provisions) rather than fixtures, so a change to
 * that configuration shows up here as a changed expectation rather than
 * as a test that keeps passing while the product breaks.
 *
 * ASSERTION STYLE. Where a figure is configuration — 450 g of cereals a
 * day — the test reads it from the response and asserts the
 * RELATIONSHIP the customer depends on (total = daily x eligible days),
 * rather than restating the constant. Where a fact is structural — a
 * pure vegetarian is offered no meat — it is asserted directly, because
 * that IS the requirement.
 */
describe('Know Your Ration customer API (STEP 11D, integration, real PostgreSQL + real HTTP)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let tokenService: TokenService;
  let periodLock: CurrentPeriodLock;

  const runId = randomUUID().slice(0, 8);
  const digits = runId.replace(/[^0-9]/g, '').padEnd(7, '3');

  /** The period covering today — what every selection route resolves. */
  let periodId: string;
  /** A short period, for the minimum-eligible-days rule. */
  let shortPeriodId: string;

  const ELIGIBLE_DAYS = 30;
  const SHORT_ELIGIBLE_DAYS = 20;

  const customers: Record<'PV' | 'EV' | 'NV', string> = { PV: '', EV: '', NV: '' };
  const tokens: Record<'PV' | 'EV' | 'NV', string> = { PV: '', EV: '', NV: '' };
  let shortCustomerId: string;
  let shortCustomerToken: string;
  let noDietCustomerId: string;
  let noDietToken: string;
  let noDaysCustomerId: string;
  let noDaysToken: string;
  let staffId: string;
  let staffToken: string;

  const server = () => app.getHttpServer();
  const asCustomer = (diet: 'PV' | 'EV' | 'NV') => `Bearer ${tokens[diet]}`;

  interface Category {
    poolId: string;
    code: string;
    name: string;
    unit: string;
    dailyScale: number;
    effectiveDailyQty: number;
    eligibleDays: number;
    totalEntitlement: number;
    consumed: number;
    remaining: number;
    automaticConversions: { code: string; toDailyQty: number; description: string | null }[];
    conversionOptions: {
      conversionId: string;
      code: string;
      fromPoolId: string;
      toPoolId: string;
      toDailyQty: number;
      selected: boolean;
    }[];
    provisions: {
      provisionId: string;
      code: string;
      name: string;
      unit: string;
      consumptionRatio: number;
      packSize: number | null;
      maxQuantity: number | null;
      maxPacks: number | null;
      minEligibleDays: number | null;
      issuePeriod: 'FRESH' | 'DRY';
      maxSelectableQuantity: number;
      selectedQuantity: number;
      selectedPoolEquivalentQty: number;
    }[];
    unavailableProvisions: { code: string; name: string; reason: string; minEligibleDays: number | null }[];
  }

  interface EntitlementBody {
    period: { id: string; name: string; startDate: string; endDate: string };
    dietaryPreference: 'PV' | 'EV' | 'NV';
    eligibleDays: number;
    fresh: Category[];
    dry: Category[];
  }

  const getEntitlement = async (diet: 'PV' | 'EV' | 'NV', query = ''): Promise<EntitlementBody> => {
    const res = await request(server())
      .get(`/rik/entitlements/current${query}`)
      .set('Authorization', asCustomer(diet))
      .expect(200);
    return res.body as EntitlementBody;
  };

  const categoryOf = (body: EntitlementBody, code: string): Category | undefined =>
    [...body.fresh, ...body.dry].find((c) => c.code === code);

  /** Put every line of this customer's draft back to zero. */
  const clearSelection = async (diet: 'PV' | 'EV' | 'NV') => {
    await request(server())
      .post('/rik/selections/elections')
      .set('Authorization', asCustomer(diet))
      .send({ conversionIds: [] });
    const body = await getEntitlement(diet);
    for (const category of [...body.fresh, ...body.dry]) {
      for (const provision of category.provisions) {
        if (provision.selectedQuantity > 0) {
          await request(server())
            .post('/rik/selections/quantity')
            .set('Authorization', asCustomer(diet))
            .send({ provisionId: provision.provisionId, quantity: 0 });
        }
      }
    }
  };

  beforeAll(async () => {
    // The period covering today is a single exclusive resource — see
    // CurrentPeriodLock. Taken before anything touches the table.
    periodLock = await CurrentPeriodLock.acquire();

    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    db = app.get(DatabaseService);
    tokenService = app.get(TokenService);
    const passwordService = app.get(PasswordService);

    // Residue from an aborted run would block the no-overlap constraint.
    await db.query(
      `UPDATE rik.entitlement_selections SET status = 'CANCELLED', cancelled_at = now()
        WHERE status = 'CONFIRMED'
          AND customer_id IN (SELECT id FROM shared.customers WHERE name LIKE 'Jest 11D%')`
    );
    await db.query(
      `DELETE FROM rik.entitlement_selections
        WHERE customer_id IN (SELECT id FROM shared.customers WHERE name LIKE 'Jest 11D%')`
    );
    await db.query(
      `DELETE FROM rik.customer_period_eligibility
        WHERE period_id IN (SELECT id FROM rik.entitlement_periods WHERE name LIKE 'Jest 11D%')`
    );
    await db.query(`DELETE FROM shared.customers WHERE name LIKE 'Jest 11D%'`);
    await db.query(`DELETE FROM rik.entitlement_periods WHERE name LIKE 'Jest 11D%'`);

    // A 30-day period that CONTAINS TODAY, so findCurrent() resolves it
    // and the selection routes work exactly as the browser will use them.
    const today = new Date();
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
    const iso = (d: Date) => d.toISOString().slice(0, 10);

    const period = await db.query<{ id: string }>(
      `INSERT INTO rik.entitlement_periods (id, name, start_date, end_date, status)
       VALUES (shared.uuid_generate_v7(), $1, $2::date, $3::date, 'ACTIVE') RETURNING id`,
      [`Jest 11D current ${runId}`, iso(start), iso(end)]
    );
    periodId = period[0]!.id;

    // A separate, non-overlapping window used only to read an
    // entitlement for a customer with too few eligible days.
    const shortPeriod = await db.query<{ id: string }>(
      `INSERT INTO rik.entitlement_periods (id, name, start_date, end_date, status)
       VALUES (shared.uuid_generate_v7(), $1, '2028-02-01', '2028-02-20', 'UPCOMING') RETURNING id`,
      [`Jest 11D short ${runId}`]
    );
    shortPeriodId = shortPeriod[0]!.id;

    let n = 0;
    for (const diet of ['PV', 'EV', 'NV'] as const) {
      const row = await db.query<{ id: string }>(
        `INSERT INTO shared.customers (id, mobile_number, name, is_active, dietary_preference)
         VALUES (shared.uuid_generate_v7(), $1, $2, true, $3) RETURNING id`,
        [`+9176${digits.slice(0, 5)}${n}`, `Jest 11D ${diet} ${runId}`, diet]
      );
      customers[diet] = row[0]!.id;
      tokens[diet] = tokenService.signAccessToken({ principalType: 'CUSTOMER', principalId: row[0]!.id });
      await db.query(
        `INSERT INTO rik.customer_period_eligibility (customer_id, period_id, eligible_days)
         VALUES ($1, $2, $3)`,
        [row[0]!.id, periodId, ELIGIBLE_DAYS]
      );
      // Both per-type figures at the SAME number as the legacy row, so every
      // quantity this suite asserts is unchanged while the engine is
      // exercised on its real source (rik.customer_period_ration_eligibility)
      // rather than on the pre-0066 fallback.
      await seedBothRationTypes(db, row[0]!.id, periodId, ELIGIBLE_DAYS);
      n += 1;
    }

    // Same diet as NV, but too few eligible days for the oats rule.
    const shortCustomer = await db.query<{ id: string }>(
      `INSERT INTO shared.customers (id, mobile_number, name, is_active, dietary_preference)
       VALUES (shared.uuid_generate_v7(), $1, $2, true, 'NV') RETURNING id`,
      [`+9176${digits.slice(0, 5)}7`, `Jest 11D short-days ${runId}`]
    );
    shortCustomerId = shortCustomer[0]!.id;
    shortCustomerToken = tokenService.signAccessToken({ principalType: 'CUSTOMER', principalId: shortCustomerId });
    await db.query(
      `INSERT INTO rik.customer_period_eligibility (customer_id, period_id, eligible_days)
       VALUES ($1, $2, $3)`,
      [shortCustomerId, shortPeriodId, SHORT_ELIGIBLE_DAYS]
    );
    await seedBothRationTypes(db, shortCustomerId, shortPeriodId, SHORT_ELIGIBLE_DAYS);

    // No dietary preference recorded at all.
    const noDiet = await db.query<{ id: string }>(
      `INSERT INTO shared.customers (id, mobile_number, name, is_active, dietary_preference)
       VALUES (shared.uuid_generate_v7(), $1, $2, true, NULL) RETURNING id`,
      [`+9176${digits.slice(0, 5)}8`, `Jest 11D no-diet ${runId}`]
    );
    noDietCustomerId = noDiet[0]!.id;
    noDietToken = tokenService.signAccessToken({ principalType: 'CUSTOMER', principalId: noDietCustomerId });
    await db.query(
      `INSERT INTO rik.customer_period_eligibility (customer_id, period_id, eligible_days)
       VALUES ($1, $2, $3)`,
      [noDietCustomerId, periodId, ELIGIBLE_DAYS]
    );
    // Seeded too, so that the refusal this case asserts is the missing
    // dietary preference and nothing else.
    await seedBothRationTypes(db, noDietCustomerId, periodId, ELIGIBLE_DAYS);

    // Diet recorded, but no eligible days for this period.
    const noDays = await db.query<{ id: string }>(
      `INSERT INTO shared.customers (id, mobile_number, name, is_active, dietary_preference)
       VALUES (shared.uuid_generate_v7(), $1, $2, true, 'NV') RETURNING id`,
      [`+9176${digits.slice(0, 5)}9`, `Jest 11D no-days ${runId}`]
    );
    noDaysCustomerId = noDays[0]!.id;
    noDaysToken = tokenService.signAccessToken({ principalType: 'CUSTOMER', principalId: noDaysCustomerId });

    // A staff principal, to prove the customer routes refuse staff.
    const passwordHash = await passwordService.hash('CorrectHorseBatteryStaple!1');
    const bootstrap = await db.query<{ id: string }>(
      `SELECT id FROM shared.users WHERE username = 'bootstrap_super_admin'`
    );
    const staff = await db.query<{ id: string }>(
      `INSERT INTO shared.users (id, username, password_hash, display_name, status)
       VALUES (shared.uuid_generate_v7(), $1, $2, $3, 'ACTIVE') RETURNING id`,
      [`jest_11d_rik_admin_${runId}`, passwordHash, `Jest 11D RIK_ADMIN ${runId}`]
    );
    staffId = staff[0]!.id;
    await db.query(
      `INSERT INTO shared.user_roles (user_id, role_id, granted_by)
       SELECT $1, r.id, $2 FROM shared.roles r WHERE r.name = 'RIK_ADMIN'`,
      [staffId, bootstrap[0]!.id]
    );
    staffToken = tokenService.signAccessToken({ principalType: 'STAFF', principalId: staffId });
  });

  afterAll(async () => {
    const ids = [...Object.values(customers), shortCustomerId, noDietCustomerId, noDaysCustomerId];
    await db.query(
      `UPDATE rik.entitlement_selections SET status = 'CANCELLED', cancelled_at = now()
        WHERE status = 'CONFIRMED' AND customer_id = ANY($1::uuid[])`,
      [ids]
    );
    await db.query(`DELETE FROM rik.entitlement_selections WHERE customer_id = ANY($1::uuid[])`, [ids]);
    await db.query(`DELETE FROM rik.customer_period_eligibility WHERE customer_id = ANY($1::uuid[])`, [ids]);
    // Before any period delete: rik_cpre_period_fk points at it.
    await clearRationEligibilityForCustomers(db, ids);
    await db.query(`DELETE FROM shared.auth_sessions WHERE principal_id = ANY($1::uuid[])`, [[...ids, staffId]]);
    await db.query(`DELETE FROM shared.customers WHERE id = ANY($1::uuid[])`, [ids]);
    await db.query(`DELETE FROM shared.user_roles WHERE user_id = $1`, [staffId]);
    await db.query(`DELETE FROM shared.users WHERE id = $1`, [staffId]);
    await db.query(`DELETE FROM rik.entitlement_periods WHERE id = ANY($1::uuid[])`, [[periodId, shortPeriodId]]);
    await app.close();
    await periodLock.release();
  });

  // =================================================================
  // 1-4. Getting in, and being kept out
  // =================================================================
  describe('only the signed-in customer reaches their own ration', () => {
    const ROUTES: [('get' | 'post'), string][] = [
      ['get', '/rik/entitlements/current'],
      ['post', '/rik/entitlements/validate'],
      ['post', '/rik/selections/quantity'],
      ['post', '/rik/selections/elections'],
      ['post', '/rik/selections/confirm'],
    ];

    for (const [method, path] of ROUTES) {
      it(`${method.toUpperCase()} ${path} without a token -> 401`, async () => {
        await request(server())[method](path).send({}).expect(401);
      });

      it(`${method.toUpperCase()} ${path} as staff -> 403`, async () => {
        const call = request(server())[method](path);
        await call.set('Authorization', `Bearer ${staffToken}`).send({}).expect(403);
      });
    }

    it('an authenticated customer opens Know Your Ration and gets their own figures', async () => {
      const body = await getEntitlement('NV');
      expect(body.dietaryPreference).toBe('NV');
      expect(body.eligibleDays).toBe(ELIGIBLE_DAYS);
      expect(body.period.id).toBe(periodId);
    });

    /**
     * The ownership boundary is structural: there is no customer id in
     * any request shape, so there is nothing to substitute. This asserts
     * that the route REFUSES one rather than quietly ignoring it —
     * ignoring would leave a reader unsure which id had been used.
     */
    it('refuses a request that tries to name another customer', async () => {
      await request(server())
        .get(`/rik/entitlements/current?customerId=${customers.PV}`)
        .set('Authorization', asCustomer('NV'))
        .expect(400);

      await request(server())
        .post('/rik/selections/quantity')
        .set('Authorization', asCustomer('NV'))
        .send({ provisionId: randomUUID(), quantity: 1, customerId: customers.PV })
        .expect(400);
    });

    it('two customers see two different rations from the same route', async () => {
      const [pv, nv] = await Promise.all([getEntitlement('PV'), getEntitlement('NV')]);
      expect(pv.dietaryPreference).toBe('PV');
      expect(nv.dietaryPreference).toBe('NV');
      expect(categoryOf(pv, 'MEAT')).toBeUndefined();
      expect(categoryOf(nv, 'MEAT')).toBeDefined();
    });
  });

  // =================================================================
  // 5-7. What each dietary preference is offered
  // =================================================================
  describe('dietary preference decides what the customer is shown', () => {
    it('a pure vegetarian is offered neither meat nor eggs', async () => {
      const body = await getEntitlement('PV');
      expect(categoryOf(body, 'MEAT')).toBeUndefined();
      expect(categoryOf(body, 'EGGS')).toBeUndefined();
    });

    it('a pure vegetarian receives that entitlement as milk instead, and is told so', async () => {
      const body = await getEntitlement('PV');
      const milk = categoryOf(body, 'MILK');
      expect(milk).toBeDefined();

      // The screen shows base + each automatic addition = daily total.
      // Asserted as that relationship, not as a restated constant.
      const added = milk!.automaticConversions.reduce((sum, c) => sum + c.toDailyQty, 0);
      expect(milk!.effectiveDailyQty).toBe(milk!.dailyScale + added);
      expect(milk!.automaticConversions.length).toBeGreaterThanOrEqual(2);
      expect(milk!.automaticConversions.every((c) => typeof c.description === 'string')).toBe(true);
      expect(milk!.effectiveDailyQty).toBeGreaterThan(milk!.dailyScale);
    });

    it('an egg-eating vegetarian is offered eggs but no meat category', async () => {
      const body = await getEntitlement('EV');
      expect(categoryOf(body, 'EGGS')).toBeDefined();
      expect(categoryOf(body, 'MEAT')).toBeUndefined();
    });

    it('a non-vegetarian is offered both meat and eggs', async () => {
      const body = await getEntitlement('NV');
      expect(categoryOf(body, 'MEAT')).toBeDefined();
      expect(categoryOf(body, 'EGGS')).toBeDefined();
    });

    it('cheese is offered to PV and EV but not to NV, exactly as configured', async () => {
      const [pv, ev, nv] = await Promise.all([getEntitlement('PV'), getEntitlement('EV'), getEntitlement('NV')]);
      expect(categoryOf(pv, 'CHEESE_NUTRAMUL')).toBeDefined();
      expect(categoryOf(ev, 'CHEESE_NUTRAMUL')).toBeDefined();
      expect(categoryOf(nv, 'CHEESE_NUTRAMUL')).toBeUndefined();
    });
  });

  // =================================================================
  // 8-9. The two sections the home screen is built from
  // =================================================================
  describe('the home screen is built entirely from the response', () => {
    it('returns fresh and dry categories, each with a name and a unit', async () => {
      const body = await getEntitlement('NV');
      expect(body.fresh.length).toBeGreaterThan(0);
      expect(body.dry.length).toBeGreaterThan(0);
      for (const category of [...body.fresh, ...body.dry]) {
        expect(typeof category.name).toBe('string');
        expect(category.name.length).toBeGreaterThan(0);
        expect(['g', 'ml', 'piece']).toContain(category.unit);
      }
    });

    it('gives every category the figures the screen displays, already calculated', async () => {
      const body = await getEntitlement('NV');
      for (const category of [...body.fresh, ...body.dry]) {
        expect(category.eligibleDays).toBe(ELIGIBLE_DAYS);
        // The one relationship the customer checks by eye.
        expect(category.totalEntitlement).toBe(category.effectiveDailyQty * category.eligibleDays);
        expect(category.remaining).toBe(category.totalEntitlement - category.consumed);
      }
    });

    it('filters to one issue day when asked, without changing which pool an item belongs to', async () => {
      const dryOnly = await getEntitlement('NV', '?issuePeriod=DRY');
      const everything = await getEntitlement('NV');

      const cerealsDry = categoryOf(dryOnly, 'CEREALS');
      const cerealsAll = categoryOf(everything, 'CEREALS');
      expect(cerealsDry).toBeDefined();

      // Bread is a DRY entitlement issued on the FRESH day: filtering to
      // DRY removes the item, and the category it came from stays put.
      const breadAll = cerealsAll!.provisions.filter((p) => p.issuePeriod === 'FRESH');
      expect(breadAll.length).toBeGreaterThan(0);
      expect(cerealsDry!.provisions.every((p) => p.issuePeriod === 'DRY')).toBe(true);
      expect(cerealsDry!.totalEntitlement).toBe(cerealsAll!.totalEntitlement);
    });

    it('reports an item issued on a different day from its own category', async () => {
      const body = await getEntitlement('NV');
      const cereals = categoryOf(body, 'CEREALS');
      const bread = cereals!.provisions.find((p) => p.issuePeriod === 'FRESH');
      expect(bread).toBeDefined();
      // Its entitlement still comes from the dry category it is listed in.
      expect(body.dry.some((c) => c.code === 'CEREALS')).toBe(true);
    });
  });

  // =================================================================
  // 10-11. Shared pools and splitting
  // =================================================================
  describe('a shared entitlement, split across several items', () => {
    afterEach(async () => {
      await clearSelection('NV');
    });

    it('reports what each chosen item costs the shared balance', async () => {
      const before = await getEntitlement('NV');
      const cereals = categoryOf(before, 'CEREALS')!;
      const rice = cereals.provisions.find((p) => p.consumptionRatio === 1)!;

      const res = await request(server())
        .post('/rik/selections/quantity')
        .set('Authorization', asCustomer('NV'))
        .send({ provisionId: rice.provisionId, quantity: 2000 })
        .expect(201);

      expect(res.body.result.ok).toBe(true);
      const after = categoryOf(res.body.entitlement as EntitlementBody, 'CEREALS')!;
      const line = after.provisions.find((p) => p.provisionId === rice.provisionId)!;

      expect(line.selectedQuantity).toBe(2000);
      // The per-line cost the summary shows — server-computed, so the
      // browser never multiplies a quantity by a ratio.
      expect(line.selectedPoolEquivalentQty).toBe(2000 * line.consumptionRatio);
      expect(after.consumed).toBe(line.selectedPoolEquivalentQty);
      expect(after.remaining).toBe(after.totalEntitlement - after.consumed);
    });

    it('spends one balance across several items, richer ones costing more', async () => {
      const body = await getEntitlement('NV');
      const cereals = categoryOf(body, 'CEREALS')!;
      const plain = cereals.provisions.filter((p) => p.consumptionRatio === 1 && p.issuePeriod === 'DRY');
      const rich = cereals.provisions.find((p) => p.consumptionRatio > 1)!;

      expect(plain.length).toBeGreaterThanOrEqual(2);
      expect(rich).toBeDefined();

      await request(server())
        .post('/rik/selections/quantity')
        .set('Authorization', asCustomer('NV'))
        .send({ provisionId: plain[0]!.provisionId, quantity: 2000 })
        .expect(201);
      await request(server())
        .post('/rik/selections/quantity')
        .set('Authorization', asCustomer('NV'))
        .send({ provisionId: plain[1]!.provisionId, quantity: 3000 })
        .expect(201);
      const last = await request(server())
        .post('/rik/selections/quantity')
        .set('Authorization', asCustomer('NV'))
        .send({ provisionId: rich.provisionId, quantity: 500 })
        .expect(201);

      const after = categoryOf(last.body.entitlement as EntitlementBody, 'CEREALS')!;
      const lines = after.provisions.filter((p) => p.selectedQuantity > 0);
      expect(lines).toHaveLength(3);

      // Three items, one balance: the total used is the sum of what each
      // one cost, and the richer item cost more than it weighed.
      const summed = lines.reduce((sum, p) => sum + p.selectedPoolEquivalentQty, 0);
      expect(after.consumed).toBe(summed);
      expect(after.remaining).toBe(after.totalEntitlement - summed);

      const richLine = lines.find((p) => p.provisionId === rich.provisionId)!;
      expect(richLine.selectedPoolEquivalentQty).toBeGreaterThan(richLine.selectedQuantity);
    });

    it('leaves the other categories untouched when one is spent', async () => {
      const before = await getEntitlement('NV');
      const salt = categoryOf(before, 'SALT')!;
      const cereals = categoryOf(before, 'CEREALS')!;
      const rice = cereals.provisions.find((p) => p.consumptionRatio === 1)!;

      const res = await request(server())
        .post('/rik/selections/quantity')
        .set('Authorization', asCustomer('NV'))
        .send({ provisionId: rice.provisionId, quantity: 1000 })
        .expect(201);

      const saltAfter = categoryOf(res.body.entitlement as EntitlementBody, 'SALT')!;
      expect(saltAfter.remaining).toBe(salt.remaining);
      expect(saltAfter.consumed).toBe(0);
    });

    it('removes a line when the quantity is set back to zero', async () => {
      const body = await getEntitlement('NV');
      const cereals = categoryOf(body, 'CEREALS')!;
      const rice = cereals.provisions.find((p) => p.consumptionRatio === 1)!;

      await request(server())
        .post('/rik/selections/quantity')
        .set('Authorization', asCustomer('NV'))
        .send({ provisionId: rice.provisionId, quantity: 1500 })
        .expect(201);

      const cleared = await request(server())
        .post('/rik/selections/quantity')
        .set('Authorization', asCustomer('NV'))
        .send({ provisionId: rice.provisionId, quantity: 0 })
        .expect(201);

      const after = categoryOf(cleared.body.entitlement as EntitlementBody, 'CEREALS')!;
      expect(after.consumed).toBe(0);
      expect(after.provisions.find((p) => p.provisionId === rice.provisionId)!.selectedQuantity).toBe(0);
    });
  });

  // =================================================================
  // 12. Alternatives the customer chooses between
  // =================================================================
  describe('elective alternatives', () => {
    afterEach(async () => {
      await clearSelection('NV');
    });

    it('offers the non-vegetarian a choice, marked as not yet taken', async () => {
      const body = await getEntitlement('NV');
      const withOptions = [...body.fresh, ...body.dry].filter((c) => c.conversionOptions.length > 0);
      expect(withOptions.length).toBeGreaterThan(0);
      for (const category of withOptions) {
        for (const option of category.conversionOptions) {
          expect(option.selected).toBe(false);
          expect(typeof option.conversionId).toBe('string');
          expect(option.toDailyQty).toBeGreaterThan(0);
        }
      }
    });

    it('increases the target entitlement when an alternative is taken, and marks it chosen', async () => {
      const before = await getEntitlement('NV');
      const eggs = categoryOf(before, 'EGGS')!;
      const option = eggs.conversionOptions[0]!;

      const res = await request(server())
        .post('/rik/selections/elections')
        .set('Authorization', asCustomer('NV'))
        .send({ conversionIds: [option.conversionId] })
        .expect(201);

      const after = categoryOf(res.body.entitlement as EntitlementBody, 'EGGS')!;
      expect(after.effectiveDailyQty).toBeGreaterThan(eggs.effectiveDailyQty);
      expect(after.conversionOptions.find((o) => o.conversionId === option.conversionId)!.selected).toBe(true);
      expect(after.totalEntitlement).toBe(after.effectiveDailyQty * after.eligibleDays);
    });

    it('surrenders the source entitlement rather than counting it twice', async () => {
      const before = await getEntitlement('NV');
      const meatBefore = categoryOf(before, 'MEAT')!;
      const eggs = categoryOf(before, 'EGGS')!;
      const meatToEggs = eggs.conversionOptions.find((o) => o.code.startsWith('MEAT_TO_EGGS'))!;
      expect(meatBefore.totalEntitlement).toBeGreaterThan(0);

      const res = await request(server())
        .post('/rik/selections/elections')
        .set('Authorization', asCustomer('NV'))
        .send({ conversionIds: [meatToEggs.conversionId] })
        .expect(201);

      const body = res.body.entitlement as EntitlementBody;
      const meatAfter = categoryOf(body, 'MEAT');
      // The meat entitlement is gone; it has become eggs.
      expect(meatAfter?.totalEntitlement ?? 0).toBe(0);
      expect(categoryOf(body, 'EGGS')!.effectiveDailyQty).toBeGreaterThan(eggs.effectiveDailyQty);
    });

    /**
     * Two alternatives drawn from the SAME source entitlement cannot
     * both be taken — the meat entitlement can become eggs or milk, not
     * both. An egg-eating vegetarian is the case where the seed
     * configures two such options.
     *
     * Note the de-duplication: one conversion is offered on both the
     * category it comes FROM and the category it goes TO, so the same
     * id legitimately appears twice in the response.
     */
    it('refuses two alternatives that spend the same entitlement', async () => {
      const body = await getEntitlement('EV');
      const byId = new Map(
        [...body.fresh, ...body.dry].flatMap((c) => c.conversionOptions).map((o) => [o.conversionId, o])
      );
      const distinct = [...byId.values()];

      const bySource = new Map<string, typeof distinct>();
      for (const option of distinct) {
        bySource.set(option.fromPoolId, [...(bySource.get(option.fromPoolId) ?? []), option]);
      }
      const sharedSource = [...bySource.values()].find((group) => group.length >= 2);
      expect(sharedSource).toBeDefined();

      const res = await request(server())
        .post('/rik/selections/elections')
        .set('Authorization', asCustomer('EV'))
        .send({ conversionIds: sharedSource!.map((o) => o.conversionId) })
        .expect(201);

      expect(res.body.result.ok).toBe(false);
      expect(res.body.result.reason).toBe('CONFLICTING_ELECTIONS');
      expect(typeof res.body.result.message).toBe('string');

      // Refused, so neither was taken.
      const after = res.body.entitlement as EntitlementBody;
      expect([...after.fresh, ...after.dry].flatMap((c) => c.conversionOptions).every((o) => !o.selected)).toBe(true);
      await clearSelection('EV');
    });

    it('accepts one of those two on its own', async () => {
      const body = await getEntitlement('EV');
      const byId = new Map(
        [...body.fresh, ...body.dry].flatMap((c) => c.conversionOptions).map((o) => [o.conversionId, o])
      );
      const first = [...byId.values()][0]!;

      const res = await request(server())
        .post('/rik/selections/elections')
        .set('Authorization', asCustomer('EV'))
        .send({ conversionIds: [first.conversionId] })
        .expect(201);

      expect(res.body.result.ok).toBe(true);
      await clearSelection('EV');
    });

    it('takes an alternative back when an empty choice is sent', async () => {
      const body = await getEntitlement('NV');
      const eggs = categoryOf(body, 'EGGS')!;
      const option = eggs.conversionOptions[0]!;

      await request(server())
        .post('/rik/selections/elections')
        .set('Authorization', asCustomer('NV'))
        .send({ conversionIds: [option.conversionId] })
        .expect(201);

      const res = await request(server())
        .post('/rik/selections/elections')
        .set('Authorization', asCustomer('NV'))
        .send({ conversionIds: [] })
        .expect(201);

      const after = categoryOf(res.body.entitlement as EntitlementBody, 'EGGS')!;
      expect(after.effectiveDailyQty).toBe(eggs.effectiveDailyQty);
      expect(after.conversionOptions.every((o) => !o.selected)).toBe(true);
    });
  });

  // =================================================================
  // 13-14. Choosing a quantity, and being told no
  // =================================================================
  describe('choosing a quantity', () => {
    afterEach(async () => {
      await clearSelection('NV');
    });

    it('pre-flights a quantity without writing anything', async () => {
      const body = await getEntitlement('NV');
      const cereals = categoryOf(body, 'CEREALS')!;
      const rice = cereals.provisions.find((p) => p.consumptionRatio === 1)!;

      const res = await request(server())
        .post('/rik/entitlements/validate')
        .set('Authorization', asCustomer('NV'))
        .send({ provisionId: rice.provisionId, quantity: 1000 })
        .expect(201);
      expect(res.body.result.ok).toBe(true);

      const after = await getEntitlement('NV');
      expect(categoryOf(after, 'CEREALS')!.consumed).toBe(0);
    });

    it('refuses more than the entitlement, and explains itself in numbers', async () => {
      const body = await getEntitlement('NV');
      const cereals = categoryOf(body, 'CEREALS')!;
      const rich = cereals.provisions.find((p) => p.consumptionRatio > 1 && p.issuePeriod === 'DRY')!;

      const tooMuch = Math.ceil(cereals.remaining / rich.consumptionRatio) + 100;
      const res = await request(server())
        .post('/rik/selections/quantity')
        .set('Authorization', asCustomer('NV'))
        .send({ provisionId: rich.provisionId, quantity: tooMuch })
        .expect(201);

      expect(res.body.result.ok).toBe(false);
      expect(res.body.result.reason).toBe('EXCEEDS_ENTITLEMENT');
      // Everything the message needs, so the screen never has to compute
      // the shortfall itself.
      expect(res.body.result.detail.entitlement).toBe(cereals.totalEntitlement);
      expect(res.body.result.detail.remaining).toBeDefined();
      expect(res.body.result.detail.requestedEquivalent).toBeGreaterThan(res.body.result.detail.remaining);
      expect(typeof res.body.result.message).toBe('string');
    });

    it('writes nothing when it refuses', async () => {
      const body = await getEntitlement('NV');
      const cereals = categoryOf(body, 'CEREALS')!;
      const rich = cereals.provisions.find((p) => p.consumptionRatio > 1 && p.issuePeriod === 'DRY')!;

      const res = await request(server())
        .post('/rik/selections/quantity')
        .set('Authorization', asCustomer('NV'))
        .send({ provisionId: rich.provisionId, quantity: 99_999 })
        .expect(201);
      expect(res.body.result.ok).toBe(false);

      // The refused change is absent from the entitlement it returned,
      // and from a fresh read.
      expect(categoryOf(res.body.entitlement as EntitlementBody, 'CEREALS')!.consumed).toBe(0);
      expect(categoryOf(await getEntitlement('NV'), 'CEREALS')!.consumed).toBe(0);
    });

    it('accepts exactly the ceiling it advertised', async () => {
      const body = await getEntitlement('NV');
      const cereals = categoryOf(body, 'CEREALS')!;
      const rice = cereals.provisions.find((p) => p.consumptionRatio === 1 && p.issuePeriod === 'DRY')!;

      const res = await request(server())
        .post('/rik/selections/quantity')
        .set('Authorization', asCustomer('NV'))
        .send({ provisionId: rice.provisionId, quantity: rice.maxSelectableQuantity })
        .expect(201);

      expect(res.body.result.ok).toBe(true);
      expect(categoryOf(res.body.entitlement as EntitlementBody, 'CEREALS')!.remaining).toBe(0);
    });

    it('refuses a negative quantity outright', async () => {
      const body = await getEntitlement('NV');
      const rice = categoryOf(body, 'CEREALS')!.provisions[0]!;
      await request(server())
        .post('/rik/selections/quantity')
        .set('Authorization', asCustomer('NV'))
        .send({ provisionId: rice.provisionId, quantity: -5 })
        .expect(400);
    });
  });

  // =================================================================
  // 15-16. Per-item limits, and what is not available yet
  // =================================================================
  describe('per-item limits', () => {
    afterEach(async () => {
      await clearSelection('NV');
    });

    it('reports a maximum quantity where the facility set one', async () => {
      const body = await getEntitlement('NV');
      const capped = [...body.fresh, ...body.dry]
        .flatMap((c) => c.provisions)
        .filter((p) => p.maxQuantity !== null);
      expect(capped.length).toBeGreaterThan(0);
      for (const provision of capped) {
        expect(provision.maxSelectableQuantity).toBeLessThanOrEqual(provision.maxQuantity!);
      }
    });

    it('refuses more than that maximum, naming the limit', async () => {
      const body = await getEntitlement('NV');
      const capped = [...body.fresh, ...body.dry]
        .flatMap((c) => c.provisions)
        .find((p) => p.maxQuantity !== null)!;

      const res = await request(server())
        .post('/rik/selections/quantity')
        .set('Authorization', asCustomer('NV'))
        .send({ provisionId: capped.provisionId, quantity: capped.maxQuantity! + 1 })
        .expect(201);

      expect(res.body.result.ok).toBe(false);
      expect(res.body.result.reason).toBe('EXCEEDS_MAX_QUANTITY');
      expect(res.body.result.detail.maxQuantity).toBe(capped.maxQuantity);
    });

    it('reports a maximum number of packs where the facility set one', async () => {
      const body = await getEntitlement('PV');
      const packed = [...body.fresh, ...body.dry]
        .flatMap((c) => c.provisions)
        .filter((p) => p.maxPacks !== null && p.packSize !== null);
      expect(packed.length).toBeGreaterThan(0);
      for (const provision of packed) {
        expect(provision.maxSelectableQuantity).toBeLessThanOrEqual(provision.maxPacks! * provision.packSize!);
      }
    });

    it('refuses more packs than allowed, naming the limit', async () => {
      const body = await getEntitlement('PV');
      const packed = [...body.fresh, ...body.dry]
        .flatMap((c) => c.provisions)
        .find((p) => p.maxPacks !== null && p.packSize !== null)!;

      const res = await request(server())
        .post('/rik/selections/quantity')
        .set('Authorization', asCustomer('PV'))
        .send({ provisionId: packed.provisionId, quantity: (packed.maxPacks! + 1) * packed.packSize! })
        .expect(201);

      expect(res.body.result.ok).toBe(false);
      expect(['EXCEEDS_MAX_PACKS', 'EXCEEDS_MAX_QUANTITY', 'EXCEEDS_ENTITLEMENT']).toContain(res.body.result.reason);
      await clearSelection('PV');
    });

    /**
     * The oats rule, and the reason it is a backend concern. The
     * customer app must not know that thirty days is the threshold, or
     * that a threshold exists — it shows the sentence the engine wrote.
     */
    it('withholds an item from a customer with too few eligible days, and says why', async () => {
      const res = await request(server())
        .get(`/rik/entitlements/current?periodId=${shortPeriodId}`)
        .set('Authorization', `Bearer ${shortCustomerToken}`)
        .expect(200);

      const body = res.body as EntitlementBody;
      expect(body.eligibleDays).toBe(SHORT_ELIGIBLE_DAYS);

      const withMinimum = [...body.fresh, ...body.dry].flatMap((c) => c.unavailableProvisions);
      expect(withMinimum.length).toBeGreaterThan(0);

      const oats = withMinimum.find((p) => p.minEligibleDays !== null)!;
      expect(oats.minEligibleDays).toBeGreaterThan(SHORT_ELIGIBLE_DAYS);
      expect(oats.reason).toContain(String(oats.minEligibleDays));
      expect(oats.reason.length).toBeGreaterThan(10);

      // It is withheld, not merely flagged.
      const selectable = [...body.fresh, ...body.dry].flatMap((c) => c.provisions.map((p) => p.code));
      expect(selectable).not.toContain(oats.code);
    });

    it('offers that same item once the customer has enough eligible days', async () => {
      const body = await getEntitlement('NV');
      const selectable = [...body.fresh, ...body.dry].flatMap((c) => c.provisions);
      const withMinimum = selectable.filter((p) => p.minEligibleDays !== null);
      expect(withMinimum.length).toBeGreaterThan(0);
      for (const provision of withMinimum) {
        expect(provision.minEligibleDays!).toBeLessThanOrEqual(ELIGIBLE_DAYS);
      }
      // And nothing is withheld from this customer for that reason.
      expect([...body.fresh, ...body.dry].flatMap((c) => c.unavailableProvisions)).toHaveLength(0);
    });

    it('never quotes a dietary exclusion as an "unavailable" item', async () => {
      // A pure vegetarian is simply not shown meat. Listing it as
      // unavailable would be worse than silence.
      const body = await getEntitlement('PV');
      const unavailable = [...body.fresh, ...body.dry].flatMap((c) => c.unavailableProvisions);
      expect(unavailable.every((p) => p.minEligibleDays !== null)).toBe(true);
    });
  });

  // =================================================================
  // 17-20. Pack size, and what the response must never invent
  // =================================================================
  describe('pack size is reported, never invented', () => {
    it('sends null where the facility recorded no pack size', async () => {
      const body = await getEntitlement('NV');
      const all = [...body.fresh, ...body.dry].flatMap((c) => c.provisions);
      const unpacked = all.filter((p) => p.packSize === null);
      expect(unpacked.length).toBeGreaterThan(0);
      for (const provision of unpacked) {
        expect(provision.packSize).toBeNull();
        expect(provision.packSize).not.toBe(0);
      }
    });

    it('keeps pack size and entitlement separate', async () => {
      const body = await getEntitlement('NV');
      const salt = categoryOf(body, 'SALT')!;
      const packed = salt.provisions.find((p) => p.packSize !== null);
      if (packed) {
        // The two figures are independent; the pack does not cap or
        // define the allowance.
        expect(salt.totalEntitlement).toBe(salt.effectiveDailyQty * salt.eligibleDays);
        expect(salt.totalEntitlement).not.toBe(packed.packSize);
      }
      expect(salt.totalEntitlement).toBeGreaterThan(0);
    });

    it('never sends a negative or zero entitlement figure', async () => {
      const body = await getEntitlement('NV');
      for (const category of [...body.fresh, ...body.dry]) {
        expect(category.totalEntitlement).toBeGreaterThan(0);
        expect(category.consumed).toBeGreaterThanOrEqual(0);
        expect(category.remaining).toBeGreaterThanOrEqual(0);
        for (const provision of category.provisions) {
          expect(provision.consumptionRatio).toBeGreaterThan(0);
          expect(provision.maxSelectableQuantity).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it('omits an inactive provision entirely', async () => {
      const body = await getEntitlement('NV');
      const codes = [...body.fresh, ...body.dry].flatMap((c) => c.provisions.map((p) => p.code));
      const inactive = await db.query<{ code: string }>(
        `SELECT code FROM rik.provisions WHERE NOT is_active`
      );
      for (const row of inactive) {
        expect(codes).not.toContain(row.code);
      }
      expect(codes.length).toBeGreaterThan(0);
    });
  });

  // =================================================================
  // 21-22. When the basis is missing
  // =================================================================
  describe('an honest answer when the basis is incomplete', () => {
    it('asks a customer with no dietary preference to set one, with a code the app can act on', async () => {
      const res = await request(server())
        .get('/rik/entitlements/current')
        .set('Authorization', `Bearer ${noDietToken}`)
        .expect(400);

      expect(res.body.details.reason).toBe('DIETARY_PREFERENCE_NOT_SET');
      expect(res.body.message).toMatch(/dietary preference/i);
      // Emphatically not a default: no entitlement is returned at all.
      expect(res.body.fresh).toBeUndefined();
      expect(res.body.dry).toBeUndefined();
    });

    it('says plainly when eligible days are not recorded', async () => {
      const res = await request(server())
        .get('/rik/entitlements/current')
        .set('Authorization', `Bearer ${noDaysToken}`)
        .expect(404);

      expect(res.body.details.reason).toBe('ELIGIBILITY_NOT_RECORDED');
      expect(res.body.fresh).toBeUndefined();
    });

    it('distinguishes a period that does not exist from one that is simply closed', async () => {
      const res = await request(server())
        .get(`/rik/entitlements/current?periodId=${randomUUID()}`)
        .set('Authorization', asCustomer('NV'))
        .expect(404);
      expect(res.body.details.reason).toBe('PERIOD_NOT_FOUND');
    });

    it('never leaks a stack trace or a table name to the customer', async () => {
      const res = await request(server())
        .get('/rik/entitlements/current')
        .set('Authorization', `Bearer ${noDietToken}`)
        .expect(400);
      const text = JSON.stringify(res.body);
      expect(text).not.toMatch(/\bselect\b|\brik\.|\bshared\.|at Object\.|node_modules/i);
    });
  });

  // =================================================================
  // 23. Confirming
  // =================================================================
  describe('confirming a selection', () => {
    it('confirms the customer’s own draft and reports it back', async () => {
      const body = await getEntitlement('EV');
      const cereals = categoryOf(body, 'CEREALS')!;
      const rice = cereals.provisions.find((p) => p.consumptionRatio === 1 && p.issuePeriod === 'DRY')!;

      await request(server())
        .post('/rik/selections/quantity')
        .set('Authorization', asCustomer('EV'))
        .send({ provisionId: rice.provisionId, quantity: 1000 })
        .expect(201);

      // STEP 11E: confirming now carries the availability acknowledgement
      // and a fulfillment choice. An intentional contract change — a
      // confirmation without them is not a complete record. The STEP 11E
      // suite owns the fulfillment assertions; this one still owns
      // ownership and the confirmed figures.
      const locations = await request(server())
        .get('/rik/fulfillment/pickup-locations')
        .set('Authorization', asCustomer('EV'))
        .expect(200);

      const res = await request(server())
        .post('/rik/selections/confirm')
        .set('Authorization', asCustomer('EV'))
        .send({
          availabilityAcknowledged: true,
          fulfillmentType: 'PICKUP',
          pickupLocationId: locations.body.items[0].id,
        })
        .expect(201);

      expect(res.body.status).toBe('CONFIRMED');
      expect(typeof res.body.selectionId).toBe('string');
      expect(categoryOf(res.body.entitlement as EntitlementBody, 'CEREALS')!.consumed).toBe(1000);

      // The confirmed selection belongs to this customer and no other.
      const owner = await db.query<{ customer_id: string }>(
        `SELECT customer_id FROM rik.entitlement_selections WHERE id = $1`,
        [res.body.selectionId]
      );
      expect(owner[0]!.customer_id).toBe(customers.EV);
    });

    it('refuses to confirm twice', async () => {
      const res = await request(server())
        .post('/rik/selections/confirm')
        .set('Authorization', asCustomer('EV'))
        .send({ availabilityAcknowledged: true, fulfillmentType: 'DELIVERY', deliveryAddress: 'Block 4, Qtr 12' })
        .expect(400);
      expect(res.body.details.reason).toBe('ALREADY_CONFIRMED');
    });
  });
});
