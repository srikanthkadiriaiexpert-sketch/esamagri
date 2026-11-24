import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../app.module';
import { TokenService } from '../auth/services/token.service';
import { DatabaseService } from '../database/database.service';
import { RikEntitlementService } from './services/rik-entitlement.service';
import { RikSelectionValidationService } from './services/rik-selection-validation.service';
import { RikEligibilityService, type EntitlementBasis } from './services/rik-eligibility.service';
import { CurrentPeriodLock } from './test-support/current-period-lock';

/**
 * Migration 0053 — Fresh Milk as a PHYSICAL 500 ml COUPON.
 *
 * WHAT IS BEING TESTED, AND WHY IT IS WORTH TESTING AT ALL. The coupon is a
 * provision counted in whole units whose consumption ratio is 500, so almost
 * everything below is the entitlement engine behaving exactly as it always
 * has — and that is the point. The figures an officer is offered are not
 * computed anywhere new: floor(remaining / 500) is `maxProvisionQuantity`,
 * which has floored pool balances since STEP 11. These tests pin the ARITHMETIC
 * to the facility's own worked examples so that a later change to the engine,
 * the ratio or the scale cannot quietly move what an officer may take.
 *
 * Three things genuinely are new and each has its own tests:
 *   - a quantity must be a WHOLE number of coupons (whole_units_only);
 *   - loose millilitre Fresh Milk is RETIRED from the officer's catalogue
 *     without being deleted or end-dated;
 *   - the rule is scoped to this one provision, so cereals keep their pack
 *     behaviour and eggs stay divisible.
 *
 * NO HTTP AND NO STAFF ACCOUNT. Every assertion here is about the engine's
 * arithmetic and the validation rules, which is where the behaviour lives.
 * The suite takes the shared current-period lock because it creates a ration
 * period, and a global exclusion constraint allows only one at a time.
 */
describe('RIK Fresh Milk 500 ml coupon (migration 0053, integration, real PostgreSQL)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let entitlement: RikEntitlementService;
  let validation: RikSelectionValidationService;
  let eligibility: RikEligibilityService;
  let tokenService: TokenService;
  let periodLock: CurrentPeriodLock;
  /** One real customer session, so the PRESENTER is exercised, not only the engine. */
  let customerToken = '';

  const runId = randomUUID().slice(0, 8);
  const digits = runId.replace(/[^0-9]/g, '').padEnd(6, '7');

  /** code -> customer id. One customer per (diet, eligible days) case. */
  const people: Record<string, string> = {};
  let periodId = '';

  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));

  const provisionId = async (code: string): Promise<string> => {
    const rows = await db.query<{ id: string }>(`SELECT id FROM rik.provisions WHERE code = $1`, [code]);
    return rows[0]!.id;
  };
  const conversionId = async (code: string): Promise<string> => {
    const rows = await db.query<{ id: string }>(`SELECT id FROM rik.pool_conversions WHERE code = $1`, [code]);
    return rows[0]!.id;
  };
  const basisFor = (who: string): Promise<EntitlementBasis> =>
    eligibility.resolveBasis(people[who]!, periodId);

  type Calc = Awaited<ReturnType<RikEntitlementService['calculate']>>;
  const pool = (calc: Calc, code: string) => [...calc.fresh, ...calc.dry].find((p) => p.code === code);
  const item = (calc: Calc, poolCode: string, provisionCode: string) =>
    pool(calc, poolCode)?.provisions.find((p) => p.code === provisionCode);

  /**
   * The MILK pool as the officer's own screen would show it RIGHT NOW.
   *
   * Reads the stored draft first and feeds it to the engine, which is exactly
   * what GET /rik/entitlements/current does. Calling `calculate` with no
   * options would compute a clean slate and quietly report nothing selected —
   * these tests are about what a selection does to a shared pool, so they
   * have to read it back the way the screen does.
   */
  const milkOf = async (who: string) => {
    const basis = await basisFor(who);
    const state = await validation.loadDraftState(basis.customerId, periodId);
    const calc = await entitlement.calculate(basis, {
      selectedQuantities: state.quantities,
      electedConversionIds: state.electedConversionIds,
    });
    return {
      calc,
      total: pool(calc, 'MILK')!.totalEntitlement,
      consumed: pool(calc, 'MILK')!.consumed,
      remaining: pool(calc, 'MILK')!.remaining,
      coupons: item(calc, 'MILK', 'MILK_FRESH_COUPON'),
      td: item(calc, 'MILK', 'MILK_TD'),
    };
  };

  const clearSelection = async (who: string) => {
    await db.query(
      `UPDATE rik.entitlement_selections SET status = 'CANCELLED', cancelled_at = now()
        WHERE status = 'CONFIRMED' AND customer_id = $1`,
      [people[who]!]
    );
    await db.query(`DELETE FROM rik.entitlement_selections WHERE customer_id = $1`, [people[who]!]);
  };

  /** (diet, eligible days) for every case the facility asked to see. */
  const CASES: ReadonlyArray<readonly [string, 'PV' | 'EV' | 'NV', number]> = [
    ['NV10', 'NV', 10],
    ['NV7', 'NV', 7],
    ['PV30', 'PV', 30],
    ['PV7', 'PV', 7],
    ['EV10', 'EV', 10],
    ['EV7', 'EV', 7],
  ];

  beforeAll(async () => {
    periodLock = await CurrentPeriodLock.acquire();

    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    db = app.get(DatabaseService);
    entitlement = app.get(RikEntitlementService);
    validation = app.get(RikSelectionValidationService);
    eligibility = app.get(RikEligibilityService);
    tokenService = app.get(TokenService);

    // Residue from an aborted run would collide with the period exclusion
    // constraint, so the suite clears its own fixtures first and stays
    // re-runnable.
    await db.query(
      `UPDATE rik.entitlement_selections SET status = 'CANCELLED', cancelled_at = now()
        WHERE status = 'CONFIRMED'
          AND customer_id IN (SELECT id FROM shared.customers WHERE name LIKE 'Jest coupon%')`
    );
    await db.query(
      `DELETE FROM rik.entitlement_selections
        WHERE customer_id IN (SELECT id FROM shared.customers WHERE name LIKE 'Jest coupon%')`
    );
    await db.query(
      `DELETE FROM rik.customer_period_eligibility
        WHERE period_id IN (SELECT id FROM rik.entitlement_periods WHERE name LIKE 'Jest coupon%')`
    );
    await db.query(`DELETE FROM shared.customers WHERE name LIKE 'Jest coupon%'`);
    await db.query(`DELETE FROM rik.entitlement_periods WHERE name LIKE 'Jest coupon%'`);

    const p = await db.query<{ id: string }>(
      `INSERT INTO rik.entitlement_periods (id, name, start_date, end_date, status)
       VALUES (shared.uuid_generate_v7(), $1, $2::date, $3::date, 'ACTIVE') RETURNING id`,
      [`Jest coupon ${runId}`, iso(monthStart), iso(monthEnd)]
    );
    periodId = p[0]!.id;

    let n = 0;
    for (const [key, diet, days] of CASES) {
      const row = await db.query<{ id: string }>(
        `INSERT INTO shared.customers (id, mobile_number, name, is_active, dietary_preference)
         VALUES (shared.uuid_generate_v7(), $1, $2, true, $3) RETURNING id`,
        [`+9177${digits.slice(0, 5)}${n}`, `Jest coupon ${key} ${runId}`, diet]
      );
      people[key] = row[0]!.id;
      if (key === 'NV10') {
        customerToken = tokenService.signAccessToken({
          principalType: 'CUSTOMER',
          principalId: row[0]!.id,
        });
      }
      await db.query(
        `INSERT INTO rik.customer_period_eligibility (customer_id, period_id, eligible_days)
         VALUES ($1, $2, $3)`,
        [row[0]!.id, periodId, days]
      );
      n += 1;
    }
  });

  afterAll(async () => {
    const ids = Object.values(people);
    if (ids.length > 0) {
      await db.query(
        `UPDATE rik.entitlement_selections SET status = 'CANCELLED', cancelled_at = now()
          WHERE status = 'CONFIRMED' AND customer_id = ANY($1::uuid[])`,
        [ids]
      );
      await db.query(`DELETE FROM rik.entitlement_selections WHERE customer_id = ANY($1::uuid[])`, [ids]);
      await db.query(`DELETE FROM rik.customer_period_eligibility WHERE customer_id = ANY($1::uuid[])`, [ids]);
      await db.query(`DELETE FROM shared.customers WHERE id = ANY($1::uuid[])`, [ids]);
    }
    if (ids.length > 0) {
      await db.query(`DELETE FROM shared.auth_sessions WHERE principal_id = ANY($1::uuid[])`, [ids]);
    }
    if (periodId) await db.query(`DELETE FROM rik.entitlement_periods WHERE id = $1`, [periodId]);
    await app?.close();
    await periodLock?.release();
  });

  // =====================================================================
  // 1. The configuration itself
  // =====================================================================
  describe('the coupon is configured as one provision and nothing more', () => {
    it('is counted in whole units at 500 ml each, in the existing MILK pool', async () => {
      const rows = await db.query<{
        unit: string;
        consumption_ratio: string;
        pack_size: string | null;
        pack_unit: string | null;
        whole_units_only: boolean;
        is_customer_selectable: boolean;
        image_ref: string | null;
        pool_code: string;
      }>(
        `SELECT v.unit, v.consumption_ratio::text AS consumption_ratio, v.pack_size::text AS pack_size,
                v.pack_unit, v.whole_units_only, v.is_customer_selectable, v.image_ref,
                p.code AS pool_code
           FROM rik.provisions v JOIN rik.entitlement_pools p ON p.id = v.pool_id
          WHERE v.code = 'MILK_FRESH_COUPON'`
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({
        unit: 'piece',
        consumption_ratio: '500.000000',
        // NOT a pack size: pack_size is denominated in the provision's own
        // unit, so 500 here would mean "a pack of 500 coupons".
        pack_size: null,
        pack_unit: 'coupon',
        whole_units_only: true,
        is_customer_selectable: true,
        image_ref: '/catalogue/rik/fresh-staples/milk__fresh-500ml-coupon.png',
        pool_code: 'MILK',
      });
    });

    it('is the ONLY provision in the catalogue counted in whole units', async () => {
      const rows = await db.query<{ code: string }>(
        `SELECT code FROM rik.provisions WHERE whole_units_only ORDER BY code`
      );
      expect(rows.map((r) => r.code)).toEqual(['MILK_FRESH_COUPON']);
    });

    it('tells the CUSTOMER APP that the coupon is counted in whole units', async () => {
      // The engine knowing this is not enough: the figure has to survive the
      // controller's presenter to reach the browser, where it sets the
      // quantity box's step. It was dropped there once, silently, because a
      // service-level test cannot see a presenter.
      const calc = await entitlement.calculate(await basisFor('NV10'));
      const coupon = item(calc, 'MILK', 'MILK_FRESH_COUPON')!;
      expect(coupon.wholeUnitsOnly).toBe(true);
      expect(item(calc, 'MILK', 'MILK_TD')!.wholeUnitsOnly).toBe(false);

      const presented = await request(app.getHttpServer())
        .get('/rik/entitlements/current')
        .query({ periodId })
        .set('Authorization', `Bearer ${customerToken}`)
        .set('X-Esamagri-Session', 'customer')
        .expect(200);

      const milk = presented.body.fresh.find((c: { code: string }) => c.code === 'MILK');
      const served = milk.provisions.find((p: { code: string }) => p.code === 'MILK_FRESH_COUPON');
      expect(served).toMatchObject({
        unit: 'piece',
        packUnit: 'coupon',
        consumptionRatio: 500,
        wholeUnitsOnly: true,
      });
      const td = milk.provisions.find((p: { code: string }) => p.code === 'MILK_TD');
      expect(td.wholeUnitsOnly).toBe(false);
      // And the retired loose-millilitre provision is not offered at all.
      expect(milk.provisions.map((p: { code: string }) => p.code).sort()).toEqual([
        'MILK_FRESH_COUPON',
        'MILK_TD',
      ]);
    });

    it('added no table, status, screen or workflow — one provision row, one column', async () => {
      const tables = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM information_schema.tables
          WHERE table_schema IN ('shared','rik','pif') AND table_type = 'BASE TABLE'`
      );
      expect(tables[0]!.n).toBe('68');
      const provisions = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM rik.provisions`);
      expect(provisions[0]!.n).toBe('190');
    });
  });

  // =====================================================================
  // 2. The facility's worked examples
  // =====================================================================
  describe('whole coupons, from the officer’s own entitlement', () => {
    it('10 eligible days = 2,500 ml = 5 coupons, and taking all five leaves nothing', async () => {
      await clearSelection('NV10');
      const before = await milkOf('NV10');
      expect(before.total).toBe(2500);
      expect(before.coupons!.maxSelectableQuantity).toBe(5);
      expect(before.td!.maxSelectableQuantity).toBe(1000); // 2500 / 2.5

      const { result } = await validation.setQuantity(
        await basisFor('NV10'),
        await provisionId('MILK_FRESH_COUPON'),
        5
      );
      expect(result.ok).toBe(true);

      const after = await milkOf('NV10');
      expect(after.consumed).toBe(2500);
      expect(after.remaining).toBe(0);
      expect(after.coupons!.selectedPoolEquivalentQty).toBe(2500);
      expect(after.td!.maxSelectableQuantity).toBe(0);
    });

    it('7 eligible days = 1,750 ml = 3 coupons (1,500 ml), leaving 250 ml for Milk TD', async () => {
      await clearSelection('NV7');
      const before = await milkOf('NV7');
      expect(before.total).toBe(1750);
      // Not 3.5. The engine floors, so the officer is never offered a
      // coupon that cannot be issued.
      expect(before.coupons!.maxSelectableQuantity).toBe(3);

      const { result } = await validation.setQuantity(
        await basisFor('NV7'),
        await provisionId('MILK_FRESH_COUPON'),
        3
      );
      expect(result.ok).toBe(true);

      const after = await milkOf('NV7');
      expect(after.consumed).toBe(1500);
      expect(after.remaining).toBe(250);
      // The remainder is not forfeited: 250 ml buys exactly 100 g of Milk TD
      // at the approved 2.5 ratio.
      expect(after.td!.maxSelectableQuantity).toBe(100);
    });

    it('100 g of Milk TD first costs 250 ml, leaving 2,250 ml = 4 coupons and 250 ml over', async () => {
      await clearSelection('NV10');
      const basis = await basisFor('NV10');
      const td = await validation.setQuantity(basis, await provisionId('MILK_TD'), 100);
      expect(td.result.ok).toBe(true);

      const mid = await milkOf('NV10');
      expect(mid.consumed).toBe(250);
      expect(mid.remaining).toBe(2250);
      expect(mid.coupons!.maxSelectableQuantity).toBe(4);

      const coupons = await validation.setQuantity(
        await basisFor('NV10'),
        await provisionId('MILK_FRESH_COUPON'),
        4
      );
      expect(coupons.result.ok).toBe(true);

      const after = await milkOf('NV10');
      expect(after.consumed).toBe(2250); // 250 + 2,000
      expect(after.remaining).toBe(250);
    });
  });

  // =====================================================================
  // 3. Refusals
  // =====================================================================
  describe('what is refused, and what survives a refusal', () => {
    it('refuses a sixth coupon on a five-coupon entitlement, and writes nothing', async () => {
      await clearSelection('NV10');
      const basis = await basisFor('NV10');
      await validation.setQuantity(basis, await provisionId('MILK_FRESH_COUPON'), 5);

      const { result } = await validation.setQuantity(
        await basisFor('NV10'),
        await provisionId('MILK_FRESH_COUPON'),
        6
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.reason).toBe('EXCEEDS_ENTITLEMENT');

      // The five already chosen are untouched — a refusal is not a reset.
      const after = await milkOf('NV10');
      expect(after.coupons!.selectedQuantity).toBe(5);
      expect(after.consumed).toBe(2500);
    });

    it('refuses a combination whose COMBINED equivalent exceeds the pool', async () => {
      await clearSelection('NV10');
      const basis = await basisFor('NV10');
      await validation.setQuantity(basis, await provisionId('MILK_FRESH_COUPON'), 3); // 1,500 ml

      // 401 g of Milk TD is 1,002.5 ml, for 2,502.5 ml against 2,500.
      const { result } = await validation.setQuantity(
        await basisFor('NV10'),
        await provisionId('MILK_TD'),
        401
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.reason).toBe('EXCEEDS_ENTITLEMENT');

      // 400 g lands exactly on the entitlement and is accepted.
      const exact = await validation.setQuantity(
        await basisFor('NV10'),
        await provisionId('MILK_TD'),
        400
      );
      expect(exact.result.ok).toBe(true);
      expect((await milkOf('NV10')).remaining).toBe(0);
    });

    it('refuses HALF a coupon — a physical coupon cannot be issued in halves', async () => {
      await clearSelection('NV10');
      const { result } = await validation.setQuantity(
        await basisFor('NV10'),
        await provisionId('MILK_FRESH_COUPON'),
        2.5
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.reason).toBe('WHOLE_UNITS_ONLY');
      expect(result.message).toContain('whole coupons');

      // Nothing was written.
      expect((await milkOf('NV10')).consumed).toBe(0);

      // And a whole number of the same size is accepted, so the refusal is
      // about the fraction and not about the quantity.
      const whole = await validation.setQuantity(
        await basisFor('NV10'),
        await provisionId('MILK_FRESH_COUPON'),
        2
      );
      expect(whole.result.ok).toBe(true);
    });

    it('still accepts a fractional quantity of Milk TD, which is weighed, not counted', async () => {
      await clearSelection('NV10');
      const { result } = await validation.setQuantity(
        await basisFor('NV10'),
        await provisionId('MILK_TD'),
        2.5
      );
      expect(result.ok).toBe(true);
    });
  });

  // =====================================================================
  // 4. PV / EV / NV — the approved conversions are untouched
  // =====================================================================
  describe('dietary preferences and conversions still decide the entitlement', () => {
    it('PV receives eggs and meat as milk automatically: 1,000 ml a day', async () => {
      await clearSelection('PV30');
      const m = await milkOf('PV30');
      expect(pool(m.calc, 'MILK')!.effectiveDailyQty).toBe(1000);
      expect(m.total).toBe(30000);
      expect(m.coupons!.maxSelectableQuantity).toBe(60);
      // And a pure vegetarian is still offered no eggs and no meat at all.
      expect(pool(m.calc, 'EGGS')).toBeUndefined();
      expect(pool(m.calc, 'MEAT')).toBeUndefined();
    });

    it('PV with 7 eligible days = 7,000 ml = 14 coupons exactly, with nothing over', async () => {
      await clearSelection('PV7');
      const m = await milkOf('PV7');
      expect(m.total).toBe(7000);
      expect(m.coupons!.maxSelectableQuantity).toBe(14);
    });

    it('EV electing meat-to-milk gets 750 ml a day: 15 coupons over 10 days', async () => {
      await clearSelection('EV10');
      await validation.setElections(await basisFor('EV10'), [await conversionId('MEAT_TO_MILK_EV')]);
      const m = await milkOf('EV10');
      expect(pool(m.calc, 'MILK')!.effectiveDailyQty).toBe(750);
      expect(m.total).toBe(7500);
      expect(m.coupons!.maxSelectableQuantity).toBe(15);
    });

    it('the same election over 7 days gives 10 coupons and 250 ml over', async () => {
      await clearSelection('EV7');
      await validation.setElections(await basisFor('EV7'), [await conversionId('MEAT_TO_MILK_EV')]);
      const before = await milkOf('EV7');
      expect(before.total).toBe(5250);
      expect(before.coupons!.maxSelectableQuantity).toBe(10);

      await validation.setQuantity(await basisFor('EV7'), await provisionId('MILK_FRESH_COUPON'), 10);
      const after = await milkOf('EV7');
      expect(after.consumed).toBe(5000);
      expect(after.remaining).toBe(250);
    });

    it('EV electing meat-to-EGGS leaves the coupon count untouched — that conversion feeds eggs', async () => {
      await clearSelection('EV10');
      await validation.setElections(await basisFor('EV10'), [await conversionId('MEAT_TO_EGGS_EV')]);
      const m = await milkOf('EV10');
      expect(pool(m.calc, 'MILK')!.effectiveDailyQty).toBe(250);
      expect(m.coupons!.maxSelectableQuantity).toBe(5);
    });

    it('NV declining eggs for milk gets 500 ml a day: 10 coupons, and no eggs', async () => {
      await clearSelection('NV10');
      await validation.setElections(await basisFor('NV10'), [await conversionId('EGGS_TO_MILK_NV')]);
      const m = await milkOf('NV10');
      expect(pool(m.calc, 'MILK')!.effectiveDailyQty).toBe(500);
      expect(m.total).toBe(5000);
      expect(m.coupons!.maxSelectableQuantity).toBe(10);

      const eggs = pool(m.calc, 'EGGS');
      expect(eggs?.surrenderedByElection ?? true).toBe(true);
    });
  });

  // =====================================================================
  // 5. Loose millilitre Fresh Milk is retired, not deleted
  // =====================================================================
  describe('the loose millilitre Fresh Milk it replaces', () => {
    it('is not offered to the officer at all — not even as an unavailable item', async () => {
      await clearSelection('NV10');
      const calc = await entitlement.calculate(await basisFor('NV10'));
      const milk = pool(calc, 'MILK')!;
      expect(milk.provisions.map((p) => p.code).sort()).toEqual(['MILK_FRESH_COUPON', 'MILK_TD']);
      expect(milk.unavailableProvisions.map((p) => p.code)).not.toContain('MILK_FRESH');
    });

    it('refuses a request that names it directly, saying why', async () => {
      await clearSelection('NV10');
      const { result } = await validation.setQuantity(
        await basisFor('NV10'),
        await provisionId('MILK_FRESH'),
        500
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.reason).toBe('PROVISION_UNAVAILABLE');
      expect(result.message).toContain('issued at the counter');
    });

    it('is still an ACTIVE, in-window row — retired by selectability, never end-dated', async () => {
      const rows = await db.query<{
        is_active: boolean;
        effective_to: string | null;
        is_customer_selectable: boolean;
        unit: string;
        consumption_ratio: string;
        image_ref: string | null;
      }>(
        `SELECT is_active, effective_to::text AS effective_to, is_customer_selectable,
                unit, consumption_ratio::text AS consumption_ratio, image_ref
           FROM rik.provisions WHERE code = 'MILK_FRESH'`
      );
      expect(rows[0]).toEqual({
        is_active: true,
        effective_to: null,
        is_customer_selectable: false,
        unit: 'ml',
        consumption_ratio: '1.000000',
        // The coupon photograph moved to the provision it depicts; this row
        // must not be left showing a coupon it no longer represents.
        image_ref: null,
      });
    });

    it('holds the coupon picture exactly once across the whole catalogue', async () => {
      const rows = await db.query<{ code: string }>(
        `SELECT code FROM rik.provisions
          WHERE image_ref = '/catalogue/rik/fresh-staples/milk__fresh-500ml-coupon.png'`
      );
      expect(rows.map((r) => r.code)).toEqual(['MILK_FRESH_COUPON']);
    });
  });

  // =====================================================================
  // 6. Nothing else changed
  // =====================================================================
  describe('every other provision behaves exactly as it did', () => {
    it('Milk TD keeps its name, its gram unit and its 2.5 ratio', async () => {
      const rows = await db.query<{ name: string; unit: string; consumption_ratio: string; whole: boolean }>(
        `SELECT name, unit, consumption_ratio::text AS consumption_ratio, whole_units_only AS whole
           FROM rik.provisions WHERE code = 'MILK_TD'`
      );
      expect(rows[0]).toEqual({
        name: 'Milk TD / Milkmaid',
        unit: 'g',
        consumption_ratio: '2.500000',
        whole: false,
      });
    });

    it('the MILK daily scale is still 250 ml for every dietary preference', async () => {
      const rows = await db.query<{ dietary_preference: string; daily_qty: string }>(
        `SELECT s.dietary_preference, s.daily_qty::text AS daily_qty
           FROM rik.pool_scales s JOIN rik.entitlement_pools p ON p.id = s.pool_id
          WHERE p.code = 'MILK' AND s.is_active ORDER BY s.dietary_preference`
      );
      expect(rows.map((r) => [r.dietary_preference, Number(r.daily_qty)])).toEqual([
        ['EV', 250],
        ['NV', 250],
        ['PV', 250],
      ]);
    });

    it('CEREAL PACK BEHAVIOUR IS UNCHANGED: 300 g of Maggi is still accepted', async () => {
      await clearSelection('NV10');
      // 300 is not a multiple of the 280 g pack. Before this change that was
      // accepted, and it still is — the whole-units rule did not leak into
      // pack sizes, which are a ceiling and not a step.
      const { result } = await validation.setQuantity(
        await basisFor('NV10'),
        await provisionId('CER_MAGGI'),
        300
      );
      expect(result.ok).toBe(true);
    });

    it('and the 2-packet Maggi ceiling still binds at 600 g', async () => {
      await clearSelection('NV10');
      const { result } = await validation.setQuantity(
        await basisFor('NV10'),
        await provisionId('CER_MAGGI'),
        600
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.reason).toBe('EXCEEDS_MAX_PACKS');
    });

    it('eggs are still divisible — the rule did not leak to other counted items', async () => {
      await clearSelection('NV10');
      // Not an endorsement of half an egg; an assertion that nothing about
      // the egg entitlement changed when the coupon arrived.
      const { result } = await validation.setQuantity(
        await basisFor('NV10'),
        await provisionId('EGGS_TABLE'),
        1.5
      );
      expect(result.ok).toBe(true);
    });
  });
});
