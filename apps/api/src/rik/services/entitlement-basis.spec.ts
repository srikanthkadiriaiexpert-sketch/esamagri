import {
  DietaryPreferenceNotSetError,
  EligibilityNotRecordedError,
  PeriodNotFoundError,
  RikEligibilityService,
  basisFromRow,
  eligibleDaysFor,
  missingRationTypes,
  rationTypeLabel,
  type BasisRow,
  type EntitlementBasis,
} from './rik-eligibility.service';
import {
  CrossRationTypeConversionError,
  RikEntitlementService,
} from './rik-entitlement.service';
import { RikConversionService } from './rik-conversion.service';
import type {
  EntitlementConfiguration,
  PoolConversionRecord,
  PoolRecord,
  PoolScaleRecord,
  ProvisionRecord,
} from '../repositories/entitlement-config.repository';
import {
  verificationStatusFor,
  type OfficerEligibilityGapRow,
} from '../repositories/customer-eligibility-figures.repository';
import { basisFromSnapshot, type RuleSnapshot } from './rik-selection-validation.service';

/**
 * FRESH AND DRY ELIGIBLE DAYS ARE TWO INDEPENDENT FIGURES.
 *
 * Everything in this file is pure: no database, no Nest container, no
 * migration, no pool. The entitlement engine's own entry point
 * (`calculateFromConfiguration`) takes the configuration as an argument, so
 * the arithmetic that decides what an officer may draw can be exercised
 * against hand-built rows and asserted to the digit.
 *
 * The rules under test, in the words they were approved in:
 *
 *   * the Fresh figure (0-30) and the Dry figure (0-60) are separate, and
 *     are never added, averaged or borrowed from one another;
 *   * a pool is scaled by the figure for ITS OWN ration type;
 *   * Bread belongs to the Dry cereals pool even though it is physically
 *     issued on a Fresh day, so a bread entitlement is Dry days' worth;
 *   * a published zero is an entitlement of nothing, and an unpublished
 *     figure is not a zero — the two are reported differently and neither
 *     is ever substituted for the other;
 *   * no default of 10 or 30 days is substituted for a missing figure;
 *   * the minimum-eligible-days rule (oats at 30) is judged on the pool's
 *     own ration type;
 *   * a selection confirmed before this change replays exactly as it was.
 */

// ------------------------------------------------------------------ fixtures

const PERIOD = '11111111-1111-1111-1111-111111111111';
const CUSTOMER = '22222222-2222-2222-2222-222222222222';

const MILK = 'pool-milk';
const EGGS = 'pool-eggs';
const CEREALS = 'pool-cereals';

function pool(id: string, code: string, rationType: 'FRESH' | 'DRY', unit: string): PoolRecord {
  return {
    id,
    code,
    name: code,
    ration_type: rationType,
    unit,
    description: null,
    image_ref: null,
    display_order: 1,
  };
}

function scale(poolId: string, dietaryPreference: 'PV' | 'EV' | 'NV', dailyQty: string): PoolScaleRecord {
  return { id: `scale-${poolId}-${dietaryPreference}`, pool_id: poolId, dietary_preference: dietaryPreference, daily_qty: dailyQty, notes: null };
}

function provision(over: Partial<ProvisionRecord> & { id: string; pool_id: string; code: string }): ProvisionRecord {
  return {
    name: over.code,
    brand: null,
    image_ref: null,
    pack_unit: null,
    unit: 'g',
    consumption_ratio: '1',
    pack_size: null,
    is_loose: true,
    is_customer_selectable: true,
    whole_units_only: false,
    max_quantity: null,
    max_packs: null,
    min_eligible_days: null,
    issue_period: 'DRY',
    dietary_preference: null,
    display_order: 1,
    ...over,
  };
}

function conversion(
  over: Partial<PoolConversionRecord> & { id: string; code: string; from_pool_id: string; to_pool_id: string }
): PoolConversionRecord {
  return {
    from_qty: '1',
    to_qty: '1',
    mode: 'AUTOMATIC',
    dietary_preference: null,
    description: null,
    display_order: 1,
    ...over,
  };
}

/**
 * Two pools of different ration types with deliberately different scales,
 * so a figure applied to the wrong pool cannot produce the right total by
 * coincidence: 250 ml/day of milk (Fresh) and 1,000 g/day of cereals (Dry).
 *
 * BREAD IS THE CASE THAT MATTERS. Its pool is CEREALS (Dry) and its
 * `issue_period` is FRESH — it is handed out on a Fresh issue day. Every
 * assertion about bread is an assertion that the engine scales by the POOL's
 * ration type and never by the provision's issue period.
 */
function configuration(): EntitlementConfiguration {
  return {
    asOf: '2026-11-30',
    pools: [pool(MILK, 'MILK', 'FRESH', 'ml'), pool(CEREALS, 'CEREALS', 'DRY', 'g')],
    scales: [scale(MILK, 'NV', '250'), scale(CEREALS, 'NV', '1000'), scale(MILK, 'PV', '250'), scale(CEREALS, 'PV', '1000')],
    conversions: [],
    provisions: [
      provision({ id: 'prov-milk', pool_id: MILK, code: 'MILK_POUCH', unit: 'ml', issue_period: 'FRESH' }),
      // Dry pool, Fresh issue day. The whole point.
      provision({ id: 'prov-bread', pool_id: CEREALS, code: 'BREAD', unit: 'g', issue_period: 'FRESH' }),
      provision({ id: 'prov-oats', pool_id: CEREALS, code: 'OATS', unit: 'g', issue_period: 'DRY', min_eligible_days: 30 }),
    ],
  };
}

function basis(over: Partial<EntitlementBasis> = {}): EntitlementBasis {
  return {
    customerId: CUSTOMER,
    periodId: PERIOD,
    dietaryPreference: 'NV',
    eligibleDays: 0,
    freshEligibleDays: 10,
    dryEligibleDays: 30,
    asOf: '2026-11-30',
    ...over,
  };
}

function engine(): RikEntitlementService {
  // `calculateFromConfiguration` takes the configuration as an argument and
  // reads nothing else, so the repository is never called. The eligibility
  // service's db is never called either — only its pure predicates are used.
  return new RikEntitlementService(
    null as never,
    new RikConversionService(),
    new RikEligibilityService(null as never)
  );
}

function row(over: Partial<BasisRow> = {}): BasisRow {
  return {
    dietary_preference: 'NV',
    eligible_days: null,
    fresh_eligible_days: null,
    dry_eligible_days: null,
    period_id: PERIOD,
    period_end: '2026-11-30',
    ...over,
  };
}

function gapRow(over: Partial<OfficerEligibilityGapRow> = {}): OfficerEligibilityGapRow {
  return {
    customer_id: CUSTOMER,
    rik_id: 'RIK-0001',
    name: 'An Officer',
    official_name: null,
    fresh_eligible_days: null,
    dry_eligible_days: null,
    fresh_in_latest_applied_batch: null,
    dry_in_latest_applied_batch: null,
    ...over,
  };
}

const findPool = (c: ReturnType<RikEntitlementService['calculateFromConfiguration']>, code: string) =>
  [...c.fresh, ...c.dry].find((p) => p.code === code);

// -------------------------------------------------------- reading the figure

describe('eligibleDaysFor — one figure per ration type, and no other', () => {
  it('reads the Fresh figure for FRESH and the Dry figure for DRY', () => {
    const b = basis({ freshEligibleDays: 10, dryEligibleDays: 30 });
    expect(eligibleDaysFor(b, 'FRESH')).toBe(10);
    expect(eligibleDaysFor(b, 'DRY')).toBe(30);
  });

  it('never returns one type’s figure for the other', () => {
    const b = basis({ freshEligibleDays: 7, dryEligibleDays: 41 });
    expect(eligibleDaysFor(b, 'FRESH')).not.toBe(41);
    expect(eligibleDaysFor(b, 'DRY')).not.toBe(7);
  });

  it('passes a missing figure through as null rather than zero', () => {
    expect(eligibleDaysFor(basis({ freshEligibleDays: null }), 'FRESH')).toBeNull();
    expect(eligibleDaysFor(basis({ dryEligibleDays: null }), 'DRY')).toBeNull();
  });

  it('keeps a published zero as zero, which is not the same as missing', () => {
    expect(eligibleDaysFor(basis({ freshEligibleDays: 0 }), 'FRESH')).toBe(0);
    expect(eligibleDaysFor(basis({ freshEligibleDays: 0 }), 'FRESH')).not.toBeNull();
  });
});

describe('missingRationTypes — absence, never a zero', () => {
  it('is empty when both figures are published', () => {
    expect(missingRationTypes(basis({ freshEligibleDays: 10, dryEligibleDays: 30 }))).toEqual([]);
  });

  it('is empty when a published figure is zero', () => {
    expect(missingRationTypes(basis({ freshEligibleDays: 0, dryEligibleDays: 0 }))).toEqual([]);
  });

  it('names only the type that has no figure', () => {
    expect(missingRationTypes(basis({ freshEligibleDays: null, dryEligibleDays: 30 }))).toEqual(['FRESH']);
    expect(missingRationTypes(basis({ freshEligibleDays: 10, dryEligibleDays: null }))).toEqual(['DRY']);
  });

  it('names both when neither is published', () => {
    expect(missingRationTypes(basis({ freshEligibleDays: null, dryEligibleDays: null }))).toEqual(['FRESH', 'DRY']);
  });
});

describe('rationTypeLabel', () => {
  it('writes the types the way an officer reads them', () => {
    expect(rationTypeLabel('FRESH')).toBe('Fresh');
    expect(rationTypeLabel('DRY')).toBe('Dry');
  });
});

// ----------------------------------------------------- the basis from a row

describe('basisFromRow — what the stored columns are allowed to mean', () => {
  it('refuses when the facility has published no figure of any kind', () => {
    expect(() => basisFromRow(row(), CUSTOMER, PERIOD)).toThrow(EligibilityNotRecordedError);
  });

  it('lets an officer with only a Fresh figure draw their Fresh ration', () => {
    const b = basisFromRow(row({ fresh_eligible_days: 10 }), CUSTOMER, PERIOD);
    expect(b.freshEligibleDays).toBe(10);
    expect(b.dryEligibleDays).toBeNull();
  });

  it('treats the legacy figure as both types for a pre-0066 officer', () => {
    const b = basisFromRow(row({ eligible_days: 21 }), CUSTOMER, PERIOD);
    expect(b.freshEligibleDays).toBe(21);
    expect(b.dryEligibleDays).toBe(21);
    expect(b.eligibleDays).toBe(21);
  });

  it('NEVER fills a missing per-type figure from the legacy figure once either type is published', () => {
    // The safeguard: a Fresh sheet of 10 days must not hand this officer
    // 30 Dry days because an old single figure said 30.
    const b = basisFromRow(row({ eligible_days: 30, fresh_eligible_days: 10 }), CUSTOMER, PERIOD);
    expect(b.freshEligibleDays).toBe(10);
    expect(b.dryEligibleDays).toBeNull();
    expect(b.dryEligibleDays).not.toBe(30);
  });

  it('does not substitute the legacy figure for a published zero either', () => {
    const b = basisFromRow(row({ eligible_days: 30, fresh_eligible_days: 0 }), CUSTOMER, PERIOD);
    expect(b.freshEligibleDays).toBe(0);
    expect(b.dryEligibleDays).toBeNull();
  });

  it('substitutes no default of 10 or 30 days anywhere', () => {
    const b = basisFromRow(row({ dry_eligible_days: 45 }), CUSTOMER, PERIOD);
    expect(b.freshEligibleDays).toBeNull();
    expect(b.dryEligibleDays).toBe(45);
  });

  it('reports a legacy figure of zero where none is stored, and scales nothing by it', () => {
    const b = basisFromRow(row({ fresh_eligible_days: 10, dry_eligible_days: 30 }), CUSTOMER, PERIOD);
    expect(b.eligibleDays).toBe(0);
  });

  it('refuses a customer with no dietary preference, and says which problem it is', () => {
    expect(() => basisFromRow(row({ dietary_preference: null, eligible_days: 10 }), CUSTOMER, PERIOD)).toThrow(
      DietaryPreferenceNotSetError
    );
  });

  it('refuses a period that does not exist', () => {
    expect(() => basisFromRow(undefined, CUSTOMER, PERIOD)).toThrow(PeriodNotFoundError);
    expect(() => basisFromRow(row({ period_id: null }), CUSTOMER, PERIOD)).toThrow(PeriodNotFoundError);
  });

  it('resolves configuration as at the period’s own end date', () => {
    const b = basisFromRow(row({ eligible_days: 10, period_end: '2026-03-31' }), CUSTOMER, PERIOD);
    expect(b.asOf).toBe('2026-03-31');
  });
});

// ------------------------------------------------------------ the arithmetic

describe('the engine scales each pool by its own ration type', () => {
  it('gives 10 Fresh days of milk and 30 Dry days of cereals from one basis', () => {
    const c = engine().calculateFromConfiguration(
      basis({ freshEligibleDays: 10, dryEligibleDays: 30 }),
      configuration()
    );
    expect(findPool(c, 'MILK')!.totalEntitlement).toBe(2500); // 250 x 10
    expect(findPool(c, 'CEREALS')!.totalEntitlement).toBe(30000); // 1000 x 30
  });

  it('reports on each pool the figure it was actually scaled by', () => {
    const c = engine().calculateFromConfiguration(
      basis({ freshEligibleDays: 10, dryEligibleDays: 30 }),
      configuration()
    );
    expect(findPool(c, 'MILK')!.eligibleDays).toBe(10);
    expect(findPool(c, 'CEREALS')!.eligibleDays).toBe(30);
  });

  it('never adds, averages or exchanges the two figures', () => {
    const c = engine().calculateFromConfiguration(
      basis({ freshEligibleDays: 10, dryEligibleDays: 30 }),
      configuration()
    );
    const milk = findPool(c, 'MILK')!.totalEntitlement;
    expect(milk).not.toBe(250 * 40); // added
    expect(milk).not.toBe(250 * 20); // averaged
    expect(milk).not.toBe(250 * 30); // the other type's figure
  });

  it('carries both published figures on the result', () => {
    const c = engine().calculateFromConfiguration(
      basis({ freshEligibleDays: 10, dryEligibleDays: 30 }),
      configuration()
    );
    expect(c.freshEligibleDays).toBe(10);
    expect(c.dryEligibleDays).toBe(30);
  });

  it('scales a Dry pool by Dry days at the Dry maximum of 60, and a Fresh pool at the Fresh maximum of 30', () => {
    const c = engine().calculateFromConfiguration(
      basis({ freshEligibleDays: 30, dryEligibleDays: 60 }),
      configuration()
    );
    expect(findPool(c, 'MILK')!.totalEntitlement).toBe(7500);
    expect(findPool(c, 'CEREALS')!.totalEntitlement).toBe(60000);
  });

  it('reproduces the old single-figure result for a pre-0066 officer', () => {
    // Both types stand in from the legacy figure, so every pool is scaled
    // by 21 — exactly what the previous engine did with one figure.
    const b = basisFromRow(row({ eligible_days: 21 }), CUSTOMER, PERIOD);
    const c = engine().calculateFromConfiguration(b, configuration());
    expect(findPool(c, 'MILK')!.totalEntitlement).toBe(250 * 21);
    expect(findPool(c, 'CEREALS')!.totalEntitlement).toBe(1000 * 21);
  });
});

describe('Bread belongs to the Dry cereals pool, whatever day it is handed over', () => {
  it('scales bread’s pool by Dry days even though bread is issued on a Fresh day', () => {
    const c = engine().calculateFromConfiguration(
      basis({ freshEligibleDays: 10, dryEligibleDays: 30 }),
      configuration()
    );
    const cereals = findPool(c, 'CEREALS')!;
    const bread = cereals.provisions.find((p) => p.code === 'BREAD');

    expect(bread).toBeDefined();
    expect(bread!.issuePeriod).toBe('FRESH');
    expect(cereals.rationType).toBe('DRY');
    expect(cereals.eligibleDays).toBe(30);
    expect(cereals.totalEntitlement).toBe(30000);
    expect(cereals.totalEntitlement).not.toBe(1000 * 10); // scaled by Fresh days
  });

  it('keeps bread on the Fresh issue list while still drawing on the Dry pool', () => {
    const c = engine().calculateFromConfiguration(
      basis({ freshEligibleDays: 10, dryEligibleDays: 30 }),
      configuration(),
      { issuePeriod: 'FRESH' }
    );
    const cereals = findPool(c, 'CEREALS')!;
    expect(cereals.provisions.map((p) => p.code)).toEqual(['BREAD']);
    expect(cereals.eligibleDays).toBe(30);
  });

  it('refuses bread when the DRY figure is missing, even though the Fresh figure is published', () => {
    const c = engine().calculateFromConfiguration(
      basis({ freshEligibleDays: 10, dryEligibleDays: null }),
      configuration()
    );
    expect(findPool(c, 'CEREALS')).toBeUndefined();
    expect(findPool(c, 'MILK')).toBeDefined();
  });
});

describe('a missing figure is not a zero', () => {
  it('leaves out the pools of a ration type with no published figure', () => {
    const c = engine().calculateFromConfiguration(
      basis({ freshEligibleDays: null, dryEligibleDays: 30 }),
      configuration()
    );
    expect(c.fresh).toEqual([]);
    expect(c.dry).toHaveLength(1);
    expect(findPool(c, 'CEREALS')!.totalEntitlement).toBe(30000);
  });

  it('does NOT report a missing figure as an entitlement of zero', () => {
    const c = engine().calculateFromConfiguration(
      basis({ freshEligibleDays: null, dryEligibleDays: 30 }),
      configuration()
    );
    expect(findPool(c, 'MILK')).toBeUndefined();
  });

  it('DOES report a published zero as a pool with an entitlement of zero', () => {
    const c = engine().calculateFromConfiguration(
      basis({ freshEligibleDays: 0, dryEligibleDays: 30 }),
      configuration()
    );
    const milk = findPool(c, 'MILK');
    expect(milk).toBeDefined();
    expect(milk!.eligibleDays).toBe(0);
    expect(milk!.totalEntitlement).toBe(0);
    expect(milk!.remaining).toBe(0);
  });

  it('leaves out everything when neither figure is published', () => {
    const c = engine().calculateFromConfiguration(
      basis({ freshEligibleDays: null, dryEligibleDays: null }),
      configuration()
    );
    expect(c.fresh).toEqual([]);
    expect(c.dry).toEqual([]);
  });
});

describe('the minimum-eligible-days rule is judged on the pool’s own ration type', () => {
  it('offers oats at 30 Dry days', () => {
    const c = engine().calculateFromConfiguration(
      basis({ freshEligibleDays: 10, dryEligibleDays: 30 }),
      configuration()
    );
    const cereals = findPool(c, 'CEREALS')!;
    expect(cereals.provisions.map((p) => p.code)).toContain('OATS');
    expect(cereals.unavailableProvisions.map((p) => p.code)).not.toContain('OATS');
  });

  it('withholds oats at 29 Dry days, and says why', () => {
    const c = engine().calculateFromConfiguration(
      basis({ freshEligibleDays: 10, dryEligibleDays: 29 }),
      configuration()
    );
    const cereals = findPool(c, 'CEREALS')!;
    expect(cereals.provisions.map((p) => p.code)).not.toContain('OATS');
    const blocked = cereals.unavailableProvisions.find((p) => p.code === 'OATS');
    expect(blocked).toBeDefined();
    expect(blocked!.reason).toContain('30');
    expect(blocked!.reason).toContain('29');
  });

  it('does NOT let a large Fresh figure unlock a Dry provision', () => {
    // 30 Fresh days would satisfy the oats minimum if the wrong figure
    // were read. The cereals pool is Dry and has 10 days.
    const c = engine().calculateFromConfiguration(
      basis({ freshEligibleDays: 30, dryEligibleDays: 10 }),
      configuration()
    );
    const cereals = findPool(c, 'CEREALS')!;
    expect(cereals.provisions.map((p) => p.code)).not.toContain('OATS');
    expect(cereals.unavailableProvisions.map((p) => p.code)).toContain('OATS');
  });

  it('does NOT let a small Fresh figure withhold a Dry provision', () => {
    const c = engine().calculateFromConfiguration(
      basis({ freshEligibleDays: 1, dryEligibleDays: 60 }),
      configuration()
    );
    expect(findPool(c, 'CEREALS')!.provisions.map((p) => p.code)).toContain('OATS');
  });
});

describe('conversions stay inside one ration type', () => {
  function withEggsToMilk(mode: 'AUTOMATIC' | 'ELECTIVE' = 'AUTOMATIC'): EntitlementConfiguration {
    const config = configuration();
    config.pools.push(pool(EGGS, 'EGGS', 'FRESH', 'count'));
    config.scales.push(scale(EGGS, 'NV', '1'));
    config.conversions.push(
      conversion({
        id: 'conv-eggs-milk',
        code: 'EGGS_TO_MILK_PV',
        from_pool_id: EGGS,
        to_pool_id: MILK,
        from_qty: '1',
        to_qty: '50',
        mode,
        dietary_preference: 'PV',
      })
    );
    return config;
  }

  it('scales an automatic conversion by the surrendered pool’s ration type', () => {
    const c = engine().calculateFromConfiguration(
      basis({ dietaryPreference: 'PV', freshEligibleDays: 10, dryEligibleDays: 60 }),
      withEggsToMilk()
    );
    const milk = findPool(c, 'MILK')!;
    // 250 base + 50 converted = 300 ml/day, x 10 FRESH days. The Dry
    // figure of 60 is three times larger and must not appear anywhere.
    expect(milk.effectiveDailyQty).toBe(300);
    expect(milk.totalEntitlement).toBe(3000);
    expect(milk.automaticConversions[0]!.toTotalQty).toBe(500);
    expect(milk.automaticConversions[0]!.toTotalQty).not.toBe(3000);
  });

  it('refuses outright a conversion that crosses Fresh and Dry', () => {
    const config = configuration();
    config.conversions.push(
      conversion({ id: 'conv-bad', code: 'CEREALS_TO_MILK', from_pool_id: CEREALS, to_pool_id: MILK })
    );
    expect(() =>
      engine().calculateFromConfiguration(basis(), config)
    ).toThrow(CrossRationTypeConversionError);
  });

  it('names the conversion and both ration types when it refuses', () => {
    const config = configuration();
    config.conversions.push(
      conversion({ id: 'conv-bad', code: 'CEREALS_TO_MILK', from_pool_id: CEREALS, to_pool_id: MILK })
    );
    try {
      engine().calculateFromConfiguration(basis(), config);
      throw new Error('the calculation should have refused');
    } catch (err) {
      expect(err).toBeInstanceOf(CrossRationTypeConversionError);
      const e = err as CrossRationTypeConversionError;
      expect(e.conversionCode).toBe('CEREALS_TO_MILK');
      expect(e.fromRationType).toBe('DRY');
      expect(e.toRationType).toBe('FRESH');
      expect(e.message).toContain('CEREALS_TO_MILK');
    }
  });

  it('accepts the seeded shape — every configured conversion is Fresh to Fresh', () => {
    expect(() => engine().calculateFromConfiguration(basis({ dietaryPreference: 'PV' }), withEggsToMilk())).not.toThrow();
  });

  it('drops a conversion whose surrendered pool has no published figure', () => {
    const c = engine().calculateFromConfiguration(
      basis({ dietaryPreference: 'PV', freshEligibleDays: null, dryEligibleDays: 30 }),
      withEggsToMilk()
    );
    expect(c.fresh).toEqual([]);
  });
});

// ------------------------------------------------- the predicates in isolation

describe('isProvisionAvailable and unavailableReason take the days as an argument', () => {
  const service = new RikEligibilityService(null as never);
  const oats = provision({ id: 'prov-oats', pool_id: CEREALS, code: 'OATS', min_eligible_days: 30 });

  it('offers nothing against a figure that does not exist', () => {
    expect(service.isProvisionAvailable(oats, basis(), true, null)).toBe(false);
  });

  it('says the figure is awaited rather than that the officer has run out', () => {
    const reason = service.unavailableReason(oats, basis(), true, null);
    expect(reason).toContain('have not been published');
    expect(reason).not.toContain('requires at least');
  });

  it('compares the minimum against the figure it was given', () => {
    expect(service.isProvisionAvailable(oats, basis(), true, 30)).toBe(true);
    expect(service.isProvisionAvailable(oats, basis(), true, 29)).toBe(false);
  });

  it('quotes the officer’s own figure in the refusal', () => {
    expect(service.unavailableReason(oats, basis(), true, 12)).toBe(
      'This provision requires at least 30 eligible days; you have 12.'
    );
  });

  it('treats a published zero as a real figure and refuses on the minimum, not on absence', () => {
    expect(service.unavailableReason(oats, basis(), true, 0)).toContain('you have 0');
  });
});

// ------------------------------------------------------------ frozen history

describe('basisFromSnapshot — a confirmed selection replays as it was confirmed', () => {
  function snapshot(over: Partial<RuleSnapshot['basis']> & { version?: number } = {}): RuleSnapshot {
    const { version, ...basisOver } = over;
    return {
      version,
      basis: { dietaryPreference: 'NV', eligibleDays: 21, asOf: '2026-03-31', ...basisOver },
      pools: [],
      scales: [],
      conversions: [],
      provisions: [],
      elections: [],
      items: [],
    };
  }

  it('reads a version 1 snapshot’s single figure as both ration types', () => {
    const b = basisFromSnapshot(snapshot({ version: 1 }), CUSTOMER, PERIOD);
    expect(b.freshEligibleDays).toBe(21);
    expect(b.dryEligibleDays).toBe(21);
  });

  it('treats a snapshot with no version as version 1', () => {
    const b = basisFromSnapshot(snapshot(), CUSTOMER, PERIOD);
    expect(b.freshEligibleDays).toBe(21);
    expect(b.dryEligibleDays).toBe(21);
  });

  it('reads both figures from a version 2 snapshot', () => {
    const b = basisFromSnapshot(
      snapshot({ version: 2, freshEligibleDays: 10, dryEligibleDays: 45 }),
      CUSTOMER,
      PERIOD
    );
    expect(b.freshEligibleDays).toBe(10);
    expect(b.dryEligibleDays).toBe(45);
  });

  it('keeps a version 2 null as null and does NOT reach for the legacy figure', () => {
    const b = basisFromSnapshot(
      snapshot({ version: 2, freshEligibleDays: null, dryEligibleDays: 45 }),
      CUSTOMER,
      PERIOD
    );
    expect(b.freshEligibleDays).toBeNull();
    expect(b.freshEligibleDays).not.toBe(21);
  });

  it('keeps a version 2 published zero as zero', () => {
    const b = basisFromSnapshot(
      snapshot({ version: 2, freshEligibleDays: 0, dryEligibleDays: 45 }),
      CUSTOMER,
      PERIOD
    );
    expect(b.freshEligibleDays).toBe(0);
  });

  it('replays a version 1 selection to the same quantities the old engine produced', () => {
    const b = basisFromSnapshot(snapshot({ version: 1 }), CUSTOMER, PERIOD);
    const c = engine().calculateFromConfiguration(b, configuration());
    expect(findPool(c, 'MILK')!.totalEntitlement).toBe(250 * 21);
    expect(findPool(c, 'CEREALS')!.totalEntitlement).toBe(1000 * 21);
  });

  it('is unmoved by what the officer’s figures say today', () => {
    // The frozen snapshot is the only input. Changing today's figures
    // cannot move a confirmed quantity, because they are not consulted.
    const frozen = basisFromSnapshot(snapshot({ version: 2, freshEligibleDays: 10, dryEligibleDays: 30 }), CUSTOMER, PERIOD);
    const before = engine().calculateFromConfiguration(frozen, configuration());
    const again = engine().calculateFromConfiguration(
      basisFromSnapshot(snapshot({ version: 2, freshEligibleDays: 10, dryEligibleDays: 30 }), CUSTOMER, PERIOD),
      configuration()
    );
    expect(again.fresh.map((p) => p.totalEntitlement)).toEqual(before.fresh.map((p) => p.totalEntitlement));
    expect(again.dry.map((p) => p.totalEntitlement)).toEqual(before.dry.map((p) => p.totalEntitlement));
  });
});

// ------------------------------------------------- the derived staff statuses

describe('verificationStatusFor — derived from what exists, never stored', () => {
  it('reports a published figure above zero as published', () => {
    expect(verificationStatusFor(gapRow({ fresh_eligible_days: 10 }), 'FRESH')).toBe('PUBLISHED');
  });

  it('reports a published zero separately from a published figure', () => {
    expect(verificationStatusFor(gapRow({ fresh_eligible_days: 0 }), 'FRESH')).toBe('PUBLISHED_ZERO');
  });

  it('reports a missing figure generically when no applied sheet exists to be absent from', () => {
    expect(verificationStatusFor(gapRow({ fresh_in_latest_applied_batch: null }), 'FRESH')).toBe('MISSING');
  });

  it('reports absence from the latest upload ONLY when an applied batch proves it', () => {
    expect(verificationStatusFor(gapRow({ fresh_in_latest_applied_batch: false }), 'FRESH')).toBe(
      'MISSING_PROVEN_ABSENT'
    );
  });

  it('does not claim absence for an officer who WAS in the applied batch but has no figure', () => {
    expect(verificationStatusFor(gapRow({ fresh_in_latest_applied_batch: true }), 'FRESH')).toBe('MISSING');
  });

  it('reads the Fresh and Dry columns independently', () => {
    const r = gapRow({
      fresh_eligible_days: 10,
      dry_eligible_days: null,
      dry_in_latest_applied_batch: false,
    });
    expect(verificationStatusFor(r, 'FRESH')).toBe('PUBLISHED');
    expect(verificationStatusFor(r, 'DRY')).toBe('MISSING_PROVEN_ABSENT');
  });
});
