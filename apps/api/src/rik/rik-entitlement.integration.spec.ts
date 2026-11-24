import { Test, type TestingModule } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../app.module';
import { DatabaseService } from '../database/database.service';
import {
  clearRationEligibilityForPeriods,
  seedBothRationTypes,
} from './test-support/seed-ration-eligibility';
import { TokenService } from '../auth/services/token.service';
import { RikEntitlementService } from './services/rik-entitlement.service';
import { RikSelectionValidationService } from './services/rik-selection-validation.service';
import { RikEligibilityService, type EntitlementBasis } from './services/rik-eligibility.service';
import { EntitlementConfigRepository } from './repositories/entitlement-config.repository';
import { CurrentPeriodLock } from './test-support/current-period-lock';

/**
 * RIK entitlement engine — integration, against the REAL configuration
 * in the database.
 *
 * The point of this suite is stated in STEP 11B Section 19: it must
 * verify the ENGINE against DATABASE CONFIGURATION, not re-assert
 * constants that the engine itself hard-codes. So nothing below reads a
 * scale or a ratio out of the source: every expected figure is either
 *
 *   (a) a number from the approved specification, proving the seeded
 *       configuration produces it, or
 *   (b) derived from the configuration read back from the database,
 *       proving the engine honours whatever is configured.
 *
 * The last block proves the property that matters most: change a row,
 * and the engine changes with it — inside a rolled-back transaction, so
 * the seed is never permanently modified.
 */
describe('RIK entitlement engine (integration, real PostgreSQL configuration)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  /**
   * This suite's 30-day period covers today, and only one period may.
   * Taken so the STEP 11D suite, which needs the same window for the
   * routes that resolve the current period, waits rather than colliding.
   */
  let periodLock: CurrentPeriodLock;
  let entitlement: RikEntitlementService;
  let validation: RikSelectionValidationService;
  let eligibility: RikEligibilityService;
  let configRepo: EntitlementConfigRepository;
  let tokenService: TokenService;

  const runId = randomUUID().slice(0, 8);
  const digits = runId.replace(/[^0-9]/g, '').padEnd(7, '3');

  /**
   * Periods are derived from the calendar at run time, never written as
   * literals (BD-E).
   *
   * This suite used to hardcode 2026-09-01 … 2026-09-30 with the comment
   * "contains today". It did, in September. The moment the calendar left that
   * month, `findCurrent()` resolved nothing, `GET /rik/entitlements/current`
   * answered 404, and a correct production path looked like a regression. A
   * fixture that is only true for one month is a time bomb, so the dates are
   * computed instead — the same pattern five other RIK suites already use.
   *
   * `back` counts whole months backwards: 0 is the month containing today, 1
   * the month before it. `Date.UTC(y, m + 1, 0)` is the last day of month `m`,
   * so February and the December/January turn need no special case.
   */
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const monthStart = (back: number) =>
    new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back, 1));
  const monthEnd = (back: number) =>
    new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back + 1, 0));

  const customers: Record<'PV' | 'EV' | 'NV', string> = { PV: '', EV: '', NV: '' };
  let periodId = '';
  let period31Id = '';

  /** Resolve a provision id by its configured code — never by name matching in the engine. */
  const provisionId = async (code: string): Promise<string> => {
    const rows = await db.query<{ id: string }>(`SELECT id FROM rik.provisions WHERE code = $1`, [code]);
    return rows[0]!.id;
  };
  const poolId = async (code: string): Promise<string> => {
    const rows = await db.query<{ id: string }>(`SELECT id FROM rik.entitlement_pools WHERE code = $1`, [code]);
    return rows[0]!.id;
  };
  const conversionId = async (code: string): Promise<string> => {
    const rows = await db.query<{ id: string }>(`SELECT id FROM rik.pool_conversions WHERE code = $1`, [code]);
    return rows[0]!.id;
  };

  const basisFor = async (diet: 'PV' | 'EV' | 'NV', period = periodId): Promise<EntitlementBasis> =>
    eligibility.resolveBasis(customers[diet], period);

  const pool = (calc: Awaited<ReturnType<RikEntitlementService['calculate']>>, code: string) =>
    [...calc.fresh, ...calc.dry].find((p) => p.code === code);

  /**
   * STEP 11E made confirmation carry an availability acknowledgement and
   * a fulfillment choice — an intentional contract change, since a
   * confirmation without them is not a complete record. These two tests
   * are about the rule SNAPSHOT, not about fulfillment, so they supply
   * the simplest valid one and leave the fulfillment assertions to the
   * STEP 11E suite.
   */
  const confirmPickup = async () => {
    // Resolved from configuration rather than named here, so renaming a
    // pickup point does not break a test about rule snapshots.
    const rows = await db.query<{ id: string }>(
      `SELECT id FROM rik.pickup_locations WHERE is_active ORDER BY display_order LIMIT 1`
    );
    return {
      availabilityAcknowledged: true,
      fulfillmentType: 'PICKUP',
      pickupLocationId: rows[0]!.id,
    };
  };

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
    configRepo = app.get(EntitlementConfigRepository);
    tokenService = app.get(TokenService);

    // The period table carries a global no-overlap exclusion constraint,
    // so residue from an aborted run would block this one. Clear it first
    // to keep the suite re-runnable.
    // A CONFIRMED selection is protected from deletion by design
    // (migration 0027), so cleanup follows the documented path: cancel,
    // then remove. This also exercises that protection every run.
    await db.query(
      `UPDATE rik.entitlement_selections SET status = 'CANCELLED', cancelled_at = now()
        WHERE status = 'CONFIRMED'
          AND customer_id IN (SELECT id FROM shared.customers WHERE name LIKE 'Jest RIK%')`
    );
    await db.query(
      `DELETE FROM rik.entitlement_selections
        WHERE customer_id IN (SELECT id FROM shared.customers WHERE name LIKE 'Jest RIK%')`
    );
    await db.query(
      `DELETE FROM rik.customer_period_eligibility
        WHERE period_id IN (SELECT id FROM rik.entitlement_periods WHERE name LIKE 'Jest RIK%')`
    );
    await db.query(
      `DELETE FROM rik.customer_period_ration_eligibility
        WHERE period_id IN (SELECT id FROM rik.entitlement_periods WHERE name LIKE 'Jest RIK%')`
    );
    await db.query(`DELETE FROM shared.customers WHERE name LIKE 'Jest RIK%'`);
    await db.query(`DELETE FROM rik.entitlement_periods WHERE name LIKE 'Jest RIK%'`);

    // Two periods: one carrying 30 eligible days, one carrying 31. The first
    // is the month containing today, so it is also what findCurrent()
    // resolves. The eligible-day figures below are inserted explicitly and do
    // not depend on how many days the calendar month happens to have.
    const p30 = await db.query<{ id: string }>(
      `INSERT INTO rik.entitlement_periods (id, name, start_date, end_date, status)
       VALUES (shared.uuid_generate_v7(), $1, $2::date, $3::date, 'ACTIVE') RETURNING id`,
      [`Jest RIK 30d ${runId}`, iso(monthStart(0)), iso(monthEnd(0))]
    );
    periodId = p30[0]!.id;

    const p31 = await db.query<{ id: string }>(
      `INSERT INTO rik.entitlement_periods (id, name, start_date, end_date, status)
       VALUES (shared.uuid_generate_v7(), $1, $2::date, $3::date, 'ACTIVE') RETURNING id`,
      [`Jest RIK 31d ${runId}`, iso(monthStart(1)), iso(monthEnd(1))]
    );
    period31Id = p31[0]!.id;

    let n = 0;
    for (const diet of ['PV', 'EV', 'NV'] as const) {
      const row = await db.query<{ id: string }>(
        `INSERT INTO shared.customers (id, mobile_number, name, is_active, dietary_preference)
         VALUES (shared.uuid_generate_v7(), $1, $2, true, $3) RETURNING id`,
        [`+9178${digits.slice(0, 5)}${n}${n}`, `Jest RIK ${diet} ${runId}`, diet]
      );
      customers[diet] = row[0]!.id;
      await db.query(
        `INSERT INTO rik.customer_period_eligibility (customer_id, period_id, eligible_days)
         VALUES ($1, $2, 30), ($1, $3, 31)`,
        [row[0]!.id, periodId, period31Id]
      );
      /**
       * THE PER-RATION-TYPE FIGURES, WHICH ARE WHAT THE ENGINE NOW SCALES BY.
       *
       * Both are seeded to the SAME 30 days as the legacy row, so every
       * quantity this suite asserts comes out exactly as it did when one
       * figure drove both types. The point of the seed is that the engine is
       * exercised on its real path — reading
       * `rik.customer_period_ration_eligibility` — rather than on the
       * pre-0066 fallback.
       *
       * `period31Id` IS DELIBERATELY LEFT WITHOUT PER-TYPE ROWS. Its legacy
       * figure is 31 days, and the facility's approved Fresh maximum is 30
       * (`rik_cpre_caps_chk`), so there is no legal Fresh row to write. That
       * period therefore exercises the pre-0066 fallback — neither per-type
       * figure present, so the legacy figure stands in for both — which is
       * the other half of the behaviour that must keep working.
       */
      await seedBothRationTypes(db, row[0]!.id, periodId, 30);
      n += 1;
    }
  });

  afterAll(async () => {
    const ids = Object.values(customers);
    await db.query(
      `UPDATE rik.entitlement_selections SET status = 'CANCELLED', cancelled_at = now()
        WHERE status = 'CONFIRMED' AND customer_id = ANY($1::uuid[])`,
      [ids]
    );
    await db.query(
      `DELETE FROM rik.entitlement_selections WHERE customer_id = ANY($1::uuid[])`,
      [ids]
    );
    await db.query(`DELETE FROM rik.customer_period_eligibility WHERE customer_id = ANY($1::uuid[])`, [ids]);
    await clearRationEligibilityForPeriods(db, [periodId, period31Id]);
    await db.query(`DELETE FROM shared.auth_sessions WHERE principal_id = ANY($1::uuid[])`, [ids]);
    await db.query(`DELETE FROM shared.customers WHERE id = ANY($1::uuid[])`, [ids]);
    await db.query(`DELETE FROM rik.entitlement_periods WHERE id = ANY($1::uuid[])`, [[periodId, period31Id]]);
    await app.close();
    await periodLock.release();
  });

  const clearSelection = async (diet: 'PV' | 'EV' | 'NV') => {
    await db.query(
      `UPDATE rik.entitlement_selections SET status = 'CANCELLED', cancelled_at = now()
        WHERE status = 'CONFIRMED' AND customer_id = $1`,
      [customers[diet]]
    );
    await db.query(`DELETE FROM rik.entitlement_selections WHERE customer_id = $1`, [customers[diet]]);
  };

  // ======================================================= base entitlement
  describe('A/B — base entitlement scales by eligible days, never by calendar month', () => {
    const expected30: Record<string, number> = {
      MILK: 7500, CEREALS: 13500, DAL: 1200, SALT: 600, ONION_GARLIC: 1800,
    };
    const expected31: Record<string, number> = {
      MILK: 7750, CEREALS: 13950, DAL: 1240, SALT: 620, ONION_GARLIC: 1860,
    };

    for (const [code, total] of Object.entries(expected30)) {
      it(`30 eligible days: ${code} = ${total}`, async () => {
        const calc = await entitlement.calculate(await basisFor('NV'));
        expect(pool(calc, code)?.totalEntitlement).toBe(total);
      });
    }

    for (const [code, total] of Object.entries(expected31)) {
      it(`31 eligible days: ${code} = ${total}`, async () => {
        const calc = await entitlement.calculate(await basisFor('NV', period31Id));
        expect(pool(calc, code)?.totalEntitlement).toBe(total);
      });
    }

    it('every pool total equals its configured daily scale times eligible days', async () => {
      const basis = await basisFor('NV');
      const config = await configRepo.loadConfiguration(basis.asOf);
      const calc = await entitlement.calculate(basis);

      for (const view of [...calc.fresh, ...calc.dry]) {
        const scale = config.scales.find(
          (s) => s.pool_id === view.poolId && s.dietary_preference === 'NV'
        );
        const automatic = config.conversions
          .filter((c) => c.to_pool_id === view.poolId && c.mode === 'AUTOMATIC' && (c.dietary_preference === null || c.dietary_preference === 'NV'))
          .reduce((sum, c) => sum + Number(c.to_qty), 0);
        const expectedDaily = Number(scale?.daily_qty ?? 0) + automatic;
        expect(view.totalEntitlement).toBeCloseTo(expectedDaily * basis.eligibleDays, 4);
      }
    });
  });

  // ============================================================ dietary rules
  describe('C/D/E — dietary applicability comes from configuration', () => {
    it('PV: no meat pool and no eggs pool at all', async () => {
      const calc = await entitlement.calculate(await basisFor('PV'));
      expect(pool(calc, 'MEAT')).toBeUndefined();
      expect(pool(calc, 'EGGS')).toBeUndefined();
    });

    it('EV: no meat pool, but eggs apply', async () => {
      const calc = await entitlement.calculate(await basisFor('EV'));
      expect(pool(calc, 'MEAT')).toBeUndefined();
      expect(pool(calc, 'EGGS')?.effectiveDailyQty).toBe(2);
    });

    it('NV: meat and eggs both apply', async () => {
      const calc = await entitlement.calculate(await basisFor('NV'));
      expect(pool(calc, 'MEAT')?.effectiveDailyQty).toBe(260);
      expect(pool(calc, 'EGGS')?.effectiveDailyQty).toBe(2);
    });

    it('Cheese/Nutramul applies to PV and EV but not NV', async () => {
      const pv = await entitlement.calculate(await basisFor('PV'));
      const ev = await entitlement.calculate(await basisFor('EV'));
      const nv = await entitlement.calculate(await basisFor('NV'));
      expect(pool(pv, 'CHEESE_NUTRAMUL')?.effectiveDailyQty).toBe(50);
      expect(pool(ev, 'CHEESE_NUTRAMUL')?.effectiveDailyQty).toBe(50);
      expect(pool(nv, 'CHEESE_NUTRAMUL')).toBeUndefined();
    });
  });

  // ==================================================== automatic conversions
  describe('F — AUTOMATIC conversions (PV milk)', () => {
    it('PV milk is 1,000 ml/day: 250 base + 250 for eggs + 500 for meat', async () => {
      const calc = await entitlement.calculate(await basisFor('PV'));
      const milk = pool(calc, 'MILK');
      expect(milk?.dailyScale).toBe(250);
      expect(milk?.effectiveDailyQty).toBe(1000);
      expect(milk?.automaticConversions).toHaveLength(2);
    });

    it('PV milk over 30 eligible days is 30,000 ml', async () => {
      const calc = await entitlement.calculate(await basisFor('PV'));
      expect(pool(calc, 'MILK')?.totalEntitlement).toBe(30000);
    });

    it('the 1,000 ml figure is derived from configuration, not assumed', async () => {
      const basis = await basisFor('PV');
      const config = await configRepo.loadConfiguration(basis.asOf);
      const milkPoolId = await poolId('MILK');
      const base = Number(
        config.scales.find((s) => s.pool_id === milkPoolId && s.dietary_preference === 'PV')!.daily_qty
      );
      const auto = config.conversions
        .filter((c) => c.to_pool_id === milkPoolId && c.mode === 'AUTOMATIC' && c.dietary_preference === 'PV')
        .reduce((sum, c) => sum + Number(c.to_qty), 0);

      const calc = await entitlement.calculate(basis);
      expect(pool(calc, 'MILK')?.effectiveDailyQty).toBe(base + auto);
    });

    it('NV milk has no automatic conversion — 250 ml/day', async () => {
      const calc = await entitlement.calculate(await basisFor('NV'));
      expect(pool(calc, 'MILK')?.effectiveDailyQty).toBe(250);
    });
  });

  // ===================================================== elective conversions
  describe('R/S/T — ELECTIVE conversions', () => {
    afterEach(async () => {
      await clearSelection('EV');
      await clearSelection('NV');
    });

    it('EV meat -> eggs gives 6 eggs/day (2 base + 4 converted)', async () => {
      const basis = await basisFor('EV');
      await validation.setElections(basis, [await conversionId('MEAT_TO_EGGS_EV')]);
      const calc = await entitlement.calculate(basis, {
        electedConversionIds: [await conversionId('MEAT_TO_EGGS_EV')],
      });
      expect(pool(calc, 'EGGS')?.effectiveDailyQty).toBe(6);
      expect(pool(calc, 'EGGS')?.totalEntitlement).toBe(180);
    });

    it('EV meat -> milk gives 750 ml/day and leaves eggs at 2/day', async () => {
      const basis = await basisFor('EV');
      const elected = [await conversionId('MEAT_TO_MILK_EV')];
      const calc = await entitlement.calculate(basis, { electedConversionIds: elected });
      expect(pool(calc, 'MILK')?.effectiveDailyQty).toBe(750);
      expect(pool(calc, 'EGGS')?.effectiveDailyQty).toBe(2);
    });

    it('the two EV meat alternatives cannot be taken together', async () => {
      const basis = await basisFor('EV');
      const { result } = await validation.setElections(basis, [
        await conversionId('MEAT_TO_EGGS_EV'),
        await conversionId('MEAT_TO_MILK_EV'),
      ]);
      expect(result.ok).toBe(false);
      if (!result.ok && 'reason' in result) expect(result.reason).toBe('CONFLICTING_ELECTIONS');
    });

    it('NV eggs -> milk surrenders the egg entitlement', async () => {
      const basis = await basisFor('NV');
      const elected = [await conversionId('EGGS_TO_MILK_NV')];
      const calc = await entitlement.calculate(basis, { electedConversionIds: elected });
      expect(pool(calc, 'MILK')?.effectiveDailyQty).toBe(500);
      expect(pool(calc, 'EGGS')?.effectiveDailyQty).toBe(0);
      expect(pool(calc, 'EGGS')?.surrenderedByElection).toBe(true);
    });

    it('NV meat -> eggs surrenders meat and raises eggs to 6/day', async () => {
      const basis = await basisFor('NV');
      const elected = [await conversionId('MEAT_TO_EGGS_NV')];
      const calc = await entitlement.calculate(basis, { electedConversionIds: elected });
      expect(pool(calc, 'EGGS')?.effectiveDailyQty).toBe(6);
      expect(pool(calc, 'MEAT')?.effectiveDailyQty).toBe(0);
    });
  });

  // ============================================================= shared pools
  describe('G/H/U/V — shared pools and split selections', () => {
    afterEach(() => clearSelection('NV'));

    it('Onion/Garlic: 400 g onion off 1,800 g leaves 1,400 g, i.e. 233 g of garlic', async () => {
      const basis = await basisFor('NV');
      const onion = await provisionId('ONION_FRESH');
      const garlic = await provisionId('GARLIC_FRESH');

      const { calculation } = await validation.setQuantity(basis, onion, 400);
      const og = pool(calculation, 'ONION_GARLIC')!;
      expect(og.consumed).toBe(400);
      expect(og.remaining).toBe(1400);

      const garlicView = og.provisions.find((p) => p.provisionId === garlic)!;
      expect(garlicView.consumptionRatio).toBe(6);
      expect(garlicView.maxSelectableQuantity).toBe(233);
    });

    it('Sugar/Jaggery share one balance at the configured 2:1', async () => {
      const basis = await basisFor('NV');
      const sugar = await provisionId('SUGAR');
      const jaggery = await provisionId('JAGGERY');

      const { calculation } = await validation.setQuantity(basis, sugar, 900);
      const sj = pool(calculation, 'SUGAR_JAGGERY')!;
      expect(sj.totalEntitlement).toBe(2700);
      expect(sj.remaining).toBe(1800);
      expect(sj.provisions.find((p) => p.provisionId === jaggery)!.maxSelectableQuantity).toBe(900);
    });

    it('Cereals: 1,000 g pizza base at 1:4.5 consumes 4,500 g, leaving 9,000 g', async () => {
      const basis = await basisFor('NV');
      const { calculation } = await validation.setQuantity(basis, await provisionId('CER_PIZZA_BASE'), 1000);
      const cereals = pool(calculation, 'CEREALS')!;
      expect(cereals.totalEntitlement).toBe(13500);
      expect(cereals.consumed).toBe(4500);
      expect(cereals.remaining).toBe(9000);
    });

    it('a cereal split across four provisions aggregates against one pool', async () => {
      const basis = await basisFor('NV');
      await validation.setQuantity(basis, await provisionId('CER_RICE_ROZANA'), 2000); // 1:1   -> 2000
      await validation.setQuantity(basis, await provisionId('CER_ATTA_AMUL'), 3000); // 1:1   -> 3000
      await validation.setQuantity(basis, await provisionId('CER_BREAD_PAV'), 500); //  1:3   -> 1500
      const { calculation } = await validation.setQuantity(basis, await provisionId('CER_RUSK'), 400); // 1:3 -> 1200

      const cereals = pool(calculation, 'CEREALS')!;
      expect(cereals.consumed).toBe(2000 + 3000 + 1500 + 1200);
      expect(cereals.remaining).toBe(13500 - 7700);
    });

    it('every configured cereal ratio is applied as pool-units-per-provision-unit', async () => {
      const basis = await basisFor('NV');
      for (const [code, expectedRatio] of [
        ['CER_PIZZA_BASE', 4.5],
        ['CER_BREAD_PAV', 3],
        ['CER_RUSK', 3],
        ['CER_CUP_CAKE', 7.5],
        ['CER_RICE_SUPER_BASMATI', 1.5],
        ['CER_RICE_ROZANA', 1],
      ] as const) {
        await clearSelection('NV');
        const { calculation } = await validation.setQuantity(basis, await provisionId(code), 100);
        expect(pool(calculation, 'CEREALS')!.consumed).toBeCloseTo(100 * expectedRatio, 4);
      }
    });
  });

  // ================================================== over-entitlement, limits
  describe('I/J/K/L — server-side enforcement', () => {
    afterEach(() => clearSelection('NV'));

    it('rejects a selection that would exceed the pool, with a structured error', async () => {
      const basis = await basisFor('NV');
      const pizza = await provisionId('CER_PIZZA_BASE');
      // Consume all but 2,000 g of the 13,500 g pool.
      await validation.setQuantity(basis, await provisionId('CER_RICE_ROZANA'), 11500);

      const { result } = await validation.setQuantity(basis, pizza, 500); // 500 * 4.5 = 2250
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected rejection');
      expect(result.reason).toBe('EXCEEDS_ENTITLEMENT');
      expect(result.detail.entitlement).toBe(13500);
      expect(result.detail.alreadyConsumed).toBe(11500);
      expect(result.detail.requestedEquivalent).toBe(2250);
      expect(result.detail.remaining).toBe(2000);
      expect(result.detail.poolCode).toBe('CEREALS');
    });

    it('a rejected selection is not written', async () => {
      const basis = await basisFor('NV');
      await validation.setQuantity(basis, await provisionId('CER_RICE_ROZANA'), 13500);
      await validation.setQuantity(basis, await provisionId('CER_PIZZA_BASE'), 500);
      const state = await validation.loadDraftState(basis.customerId, basis.periodId);
      expect(state.quantities.has(await provisionId('CER_PIZZA_BASE'))).toBe(false);
    });

    it('accepts a selection landing exactly on the entitlement', async () => {
      const basis = await basisFor('NV');
      const { result } = await validation.setQuantity(basis, await provisionId('CER_RICE_ROZANA'), 13500);
      expect(result.ok).toBe(true);
    });

    it('enforces the configured maximum quantity (Millets 1,000 g)', async () => {
      const basis = await basisFor('NV');
      const { result } = await validation.setQuantity(basis, await provisionId('CER_MILLETS'), 1500);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('EXCEEDS_MAX_QUANTITY');
        expect(result.detail.maxQuantity).toBe(1000);
      }
    });

    it('enforces the configured maximum packs (Paneer, 3 x 200 g)', async () => {
      const basis = await basisFor('PV');
      const { result } = await validation.setQuantity(basis, await provisionId('CH_PANEER'), 800);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('EXCEEDS_MAX_PACKS');
        expect(result.detail.maxPacks).toBe(3);
      }
      await clearSelection('PV');
    });

    it('allows exactly the maximum number of packs', async () => {
      const basis = await basisFor('PV');
      const { result } = await validation.setQuantity(basis, await provisionId('CH_PANEER'), 600);
      expect(result.ok).toBe(true);
      await clearSelection('PV');
    });

    it('refuses a provision that is not customer-selectable (loose tea)', async () => {
      const basis = await basisFor('NV');
      const { result } = await validation.setQuantity(basis, await provisionId('TEA_LOOSE'), 10);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('PROVISION_UNAVAILABLE');
    });

    it('refuses a pool that does not apply to the diet (PV selecting meat)', async () => {
      const basis = await basisFor('PV');
      const { result } = await validation.setQuantity(basis, await provisionId('MEAT_MUTTON'), 100);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('POOL_NOT_APPLICABLE');
    });
  });

  // ================================================== minimum eligible days
  describe('L — Oats requires 30 eligible days', () => {
    let shortCustomer = '';
    let shortPeriod = '';

    beforeAll(async () => {
      const p = await db.query<{ id: string }>(
        `INSERT INTO rik.entitlement_periods (id, name, start_date, end_date, status)
         VALUES (shared.uuid_generate_v7(), $1, $2::date, $3::date, 'ACTIVE') RETURNING id`,
        [`Jest RIK short ${runId}`, iso(monthStart(2)), iso(monthEnd(2))]
      );
      shortPeriod = p[0]!.id;
      const c = await db.query<{ id: string }>(
        `INSERT INTO shared.customers (id, mobile_number, name, is_active, dietary_preference)
         VALUES (shared.uuid_generate_v7(), $1, $2, true, 'NV') RETURNING id`,
        [`+9177${digits.slice(0, 5)}99`, `Jest RIK short ${runId}`]
      );
      shortCustomer = c[0]!.id;
      await db.query(
        `INSERT INTO rik.customer_period_eligibility (customer_id, period_id, eligible_days) VALUES ($1,$2,20)`,
        [shortCustomer, shortPeriod]
      );
      // Both per-type figures at the same 20 days, so this suite's oats
      // assertions are unchanged and the engine reads its real source.
      await seedBothRationTypes(db, shortCustomer, shortPeriod, 20);
    });

    afterAll(async () => {
      await db.query(
        `UPDATE rik.entitlement_selections SET status = 'CANCELLED', cancelled_at = now()
          WHERE status = 'CONFIRMED' AND customer_id = $1`,
        [shortCustomer]
      );
      await db.query(`DELETE FROM rik.entitlement_selections WHERE customer_id = $1`, [shortCustomer]);
      await db.query(`DELETE FROM rik.customer_period_eligibility WHERE customer_id = $1`, [shortCustomer]);
      // Before the period delete: rik_cpre_period_fk points at it.
      await clearRationEligibilityForPeriods(db, [shortPeriod]);
      await db.query(`DELETE FROM shared.customers WHERE id = $1`, [shortCustomer]);
      await db.query(`DELETE FROM rik.entitlement_periods WHERE id = $1`, [shortPeriod]);
    });

    it('is offered at 30 eligible days', async () => {
      const calc = await entitlement.calculate(await basisFor('NV'));
      const oats = await provisionId('DAL_OATS');
      expect(pool(calc, 'DALIYA')!.provisions.some((p) => p.provisionId === oats)).toBe(true);
    });

    it('is withheld at 20 eligible days, and the API refuses it', async () => {
      const basis = await eligibility.resolveBasis(shortCustomer, shortPeriod);
      const calc = await entitlement.calculate(basis);
      const oats = await provisionId('DAL_OATS');
      expect(pool(calc, 'DALIYA')!.provisions.some((p) => p.provisionId === oats)).toBe(false);

      const { result } = await validation.setQuantity(basis, oats, 600);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('MIN_ELIGIBLE_DAYS_NOT_MET');
    });
  });

  // =========================================== Fresh/Dry, bread, garlic split
  describe('P/Q — ration type, issue period and pool isolation', () => {
    it('bread is a DRY entitlement pool physically issued FRESH', async () => {
      const calc = await entitlement.calculate(await basisFor('NV'));
      const cereals = pool(calc, 'CEREALS')!;
      expect(cereals.rationType).toBe('DRY');
      const bread = cereals.provisions.find((p) => p.code === 'CER_BREAD_SANDWICH')!;
      expect(bread.issuePeriod).toBe('FRESH');
    });

    it('bread consumption is deducted from Cereals — 1,600 g leaves 11,900 g', async () => {
      const basis = await basisFor('NV');
      await clearSelection('NV');
      const { calculation } = await validation.setQuantity(basis, await provisionId('CER_BREAD_SANDWICH'), 1600);
      expect(pool(calculation, 'CEREALS')!.remaining).toBe(11900);
      await clearSelection('NV');
    });

    it('filtering by FRESH issue period still reports the DRY cereal pool', async () => {
      const calc = await entitlement.calculate(await basisFor('NV'), { issuePeriod: 'FRESH' });
      const cereals = pool(calc, 'CEREALS')!;
      expect(cereals.rationType).toBe('DRY');
      expect(cereals.provisions.every((p) => p.issuePeriod === 'FRESH')).toBe(true);
      expect(cereals.provisions.length).toBeGreaterThan(0);
    });

    it('fresh garlic and dry condiment garlic are different pools that do not interact', async () => {
      const basis = await basisFor('NV');
      await clearSelection('NV');
      const { calculation } = await validation.setQuantity(basis, await provisionId('GARLIC_FRESH'), 100);

      expect(pool(calculation, 'ONION_GARLIC')!.consumed).toBe(600); // 100 * 6
      expect(pool(calculation, 'CONDIMENTS')!.consumed).toBe(0);

      const { calculation: after } = await validation.setQuantity(basis, await provisionId('CND_GARLIC'), 100);
      expect(pool(after, 'CONDIMENTS')!.consumed).toBe(100); // 1:1, its own pool
      expect(pool(after, 'ONION_GARLIC')!.consumed).toBe(600); // unchanged
      await clearSelection('NV');
    });
  });

  // ===================================================== pack size vs entitlement
  describe('Pack size is catalogue information, never the entitlement', () => {
    it('salt entitlement is 600 g at 30 days even though the pack is 500 g', async () => {
      const calc = await entitlement.calculate(await basisFor('NV'));
      const salt = pool(calc, 'SALT')!;
      expect(salt.totalEntitlement).toBe(600);
      expect(salt.provisions.find((p) => p.code === 'SALT_TABLE')!.packSize).toBe(500);
    });
  });

  // ============================================================== concurrency
  describe('Concurrency — two simultaneous requests cannot overspend a pool', () => {
    afterEach(() => clearSelection('NV'));

    it('parallel selections against the same pool serialise and respect the balance', async () => {
      const basis = await basisFor('NV');
      const rice = await provisionId('CER_RICE_ROZANA');
      const atta = await provisionId('CER_ATTA_AMUL');

      // Each alone fits (8,000 <= 13,500); together they do not (16,000).
      const [a, b] = await Promise.all([
        validation.setQuantity(basis, rice, 8000),
        validation.setQuantity(basis, atta, 8000),
      ]);

      const okCount = [a.result.ok, b.result.ok].filter(Boolean).length;
      expect(okCount).toBe(1);

      const state = await validation.loadDraftState(basis.customerId, basis.periodId);
      const total = [...state.quantities.values()].reduce((s, q) => s + q, 0);
      expect(total).toBeLessThanOrEqual(13500);
    });
  });

  // ======================================================= historical snapshot
  describe('M — a confirmed selection is reproducible after configuration changes', () => {
    it('recalculates from its own snapshot, not from live configuration', async () => {
      const basis = await basisFor('NV');
      await clearSelection('NV');
      await validation.setQuantity(basis, await provisionId('CER_RICE_ROZANA'), 1000);
      const { selectionId } = await validation.confirm(basis, await confirmPickup());

      const fromSnapshot = await validation.recalculateFromSnapshot(selectionId, basis.customerId);
      expect(fromSnapshot).not.toBeNull();
      const cereals = [...fromSnapshot!.fresh, ...fromSnapshot!.dry].find((p) => p.code === 'CEREALS')!;
      expect(cereals.totalEntitlement).toBe(13500);
      expect(cereals.consumed).toBe(1000);

      const row = await db.query<{ has: boolean }>(
        `SELECT rule_snapshot IS NOT NULL AS has FROM rik.entitlement_selections WHERE id = $1`,
        [selectionId]
      );
      expect(row[0]!.has).toBe(true);
      await clearSelection('NV');
    });

    it('the snapshot carries pools, scales, conversions, provisions and the basis', async () => {
      const basis = await basisFor('NV');
      await clearSelection('NV');
      await validation.setQuantity(basis, await provisionId('SUGAR'), 500);
      const { selectionId } = await validation.confirm(basis, await confirmPickup());

      const rows = await db.query<{ snapshot: Record<string, unknown> }>(
        `SELECT rule_snapshot AS snapshot FROM rik.entitlement_selections WHERE id = $1`,
        [selectionId]
      );
      const snapshot = rows[0]!.snapshot;
      for (const key of ['basis', 'pools', 'scales', 'conversions', 'provisions', 'items']) {
        expect(snapshot).toHaveProperty(key);
      }
      await clearSelection('NV');
    });
  });

  // ======================================== the property that matters most
  describe('N/O + Section 20 — configuration drives behaviour, with no code change', () => {
    /**
     * Mutate configuration, assert, then restore — all inside one
     * transaction. If an assertion throws, the transaction rolls back and
     * the seed is restored anyway, so the approved configuration is never
     * permanently modified whichever way the test goes.
     */
    const withTemporaryConfig = async (
      mutate: string,
      assertions: (client: import('pg').PoolClient) => Promise<void>
    ) => {
      await db.withTransaction(async (client) => {
        const before = await client.query<{ id: string; v: string }>(
          `SELECT id::text, daily_qty::text AS v FROM rik.pool_scales`
        );
        await client.query(mutate);
        await assertions(client);
        // Restore in-transaction so a passing test commits nothing.
        for (const row of before.rows) {
          await client.query(`UPDATE rik.pool_scales SET daily_qty = $2 WHERE id = $1`, [row.id, row.v]);
        }
      });
    };

    it('changing the milk scale from 250 to 300 changes the calculation', async () => {
      const basis = await basisFor('NV');
      await withTemporaryConfig(
        `UPDATE rik.pool_scales SET daily_qty = 300
           WHERE pool_id = (SELECT id FROM rik.entitlement_pools WHERE code='MILK')
             AND dietary_preference = 'NV'`,
        async (client) => {
          const config = await configRepo.loadConfiguration(basis.asOf, client);
          const calc = entitlement.calculateFromConfiguration(basis, config);
          expect(pool(calc, 'MILK')!.effectiveDailyQty).toBe(300);
          expect(pool(calc, 'MILK')!.totalEntitlement).toBe(9000); // 300 x 30
        }
      );

      // The seed is untouched.
      const restored = await entitlement.calculate(await basisFor('NV'));
      expect(pool(restored, 'MILK')!.effectiveDailyQty).toBe(250);
      expect(pool(restored, 'MILK')!.totalEntitlement).toBe(7500);
    });

    it('changing a conversion ratio changes consumption, with no code change', async () => {
      const basis = await basisFor('NV');
      const pizza = await provisionId('CER_PIZZA_BASE');

      await db.withTransaction(async (client) => {
        const before = await client.query<{ v: string }>(
          `SELECT consumption_ratio::text AS v FROM rik.provisions WHERE code = 'CER_PIZZA_BASE'`
        );
        await client.query(`UPDATE rik.provisions SET consumption_ratio = 9 WHERE code = 'CER_PIZZA_BASE'`);

        const config = await configRepo.loadConfiguration(basis.asOf, client);
        const calc = entitlement.calculateFromConfiguration(basis, config, {
          selectedQuantities: new Map([[pizza, 1000]]),
        });
        expect(pool(calc, 'CEREALS')!.consumed).toBe(9000); // 1000 x 9, not x 4.5

        await client.query(`UPDATE rik.provisions SET consumption_ratio = $1 WHERE code = 'CER_PIZZA_BASE'`, [
          before.rows[0]!.v,
        ]);
      });

      const config = await configRepo.loadConfiguration((await basisFor('NV')).asOf);
      expect(Number(config.provisions.find((p) => p.code === 'CER_PIZZA_BASE')!.consumption_ratio)).toBe(4.5);
    });

    it('deactivating a provision removes it from the customer offer', async () => {
      const basis = await basisFor('NV');
      await db.withTransaction(async (client) => {
        await client.query(`UPDATE rik.provisions SET is_active = false WHERE code = 'CER_PIZZA_BASE'`);
        const config = await configRepo.loadConfiguration(basis.asOf, client);
        const calc = entitlement.calculateFromConfiguration(basis, config);
        expect(pool(calc, 'CEREALS')!.provisions.some((p) => p.code === 'CER_PIZZA_BASE')).toBe(false);
        await client.query(`UPDATE rik.provisions SET is_active = true WHERE code = 'CER_PIZZA_BASE'`);
      });

      const after = await configRepo.loadConfiguration((await basisFor('NV')).asOf);
      expect(after.provisions.some((p) => p.code === 'CER_PIZZA_BASE')).toBe(true);
    });

    it('an effective-date window that has closed removes the rule', async () => {
      const basis = await basisFor('NV');
      await db.withTransaction(async (client) => {
        await client.query(
          `UPDATE rik.provisions SET effective_to = DATE '2026-06-30' WHERE code = 'CER_PIZZA_BASE'`
        );
        const config = await configRepo.loadConfiguration(basis.asOf, client);
        expect(config.provisions.some((p) => p.code === 'CER_PIZZA_BASE')).toBe(false);
        await client.query(`UPDATE rik.provisions SET effective_to = NULL WHERE code = 'CER_PIZZA_BASE'`);
      });

      const after = await configRepo.loadConfiguration((await basisFor('NV')).asOf);
      expect(after.provisions.some((p) => p.code === 'CER_PIZZA_BASE')).toBe(true);
    });
  });

  // ================================================================== the API
  describe('Know Your Ration API — ownership and shape', () => {
    it('requires authentication', async () => {
      await request(app.getHttpServer()).get('/rik/entitlements/current').expect(401);
    });

    it('a staff principal cannot read a customer entitlement', async () => {
      const staff = await db.query<{ id: string }>(
        `SELECT id FROM shared.users WHERE username = 'bootstrap_super_admin'`
      );
      const token = tokenService.signAccessToken({ principalType: 'STAFF', principalId: staff[0]!.id });
      await request(app.getHttpServer())
        .get('/rik/entitlements/current')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('returns FRESH and DRY sections for the authenticated customer only', async () => {
      const token = tokenService.signAccessToken({
        principalType: 'CUSTOMER',
        principalId: customers.NV,
      });
      const res = await request(app.getHttpServer())
        .get('/rik/entitlements/current')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.dietaryPreference).toBe('NV');
      expect(res.body.eligibleDays).toBe(30);
      expect(Array.isArray(res.body.fresh)).toBe(true);
      expect(Array.isArray(res.body.dry)).toBe(true);
      expect(res.body.fresh.some((p: { code: string }) => p.code === 'MEAT')).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain('customerId');
    });
  });
});
