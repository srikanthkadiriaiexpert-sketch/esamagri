import { describe, it, expect } from 'vitest';
import {
  isPublishable,
  PUBLICATION_POLICY,
  nutritionCodes,
  nutritionFor,
  PUBLISH_COMPOSITION_TABLE_VALUES,
  type DataQuality,
  type NutritionRecord,
} from './rikNutrition';
import { rikNutritionIfctWithheld as rikNutrition } from './rikNutritionIfctWithheld';
import {
  PRELIMINARY_DATA_QUALITY,
  PRELIMINARY_WORKBOOK,
  preliminaryNutritionFor,
  PUBLISH_PRELIMINARY_GROUP_AVERAGES,
  rikNutritionPreliminary,
} from './rikNutritionPreliminary';

/**
 * THE PUBLICATION GATE, AND THE TWO CATEGORIES THAT MUST NEVER SLIP THROUGH.
 *
 * The gate used to ask one question — "is this a composition-table record?" —
 * and let every other evidence category straight through. That was a hole with
 * a name: the 184 preliminary food-group averages are `approximate-reference`,
 * so the moment anything wired them in they would have rendered to customers,
 * with the IFCT flag still false and every existing test still green.
 *
 * `isPublishable` now denies by default and decides one category at a time.
 * This file is the proof, and it is deliberately written against BOTH the
 * synthetic truth table and the 235 real records, because the two fail in
 * different ways: a logic slip shows up in the first, a mislabelled record in
 * the second.
 *
 * THE ASSERTION THAT MATTERS MOST is that `approximate-reference` is withheld
 * WITHOUT reference to any flag. If releasing it ever becomes the policy, that
 * is a reviewed decision with its own switch — never a side effect of turning
 * on the IFCT flag, which answers an entirely different question (does NIN's
 * licence permit shipping their figures) from "is this number about this
 * product at all".
 */

const ALL_CATEGORIES: readonly DataQuality[] = [
  'approximate-reference',
  'composition-table',
  'manufacturer-declared',
];

/** A minimal record, so the category under test is the only variable. */
const recordOf = (dataQuality: DataQuality): NutritionRecord => ({
  basis: 'per 100 g',
  state: 'raw',
  source: 'Test source',
  sourceFood: 'Test food',
  dataQuality,
  energyKcal: 100,
});

/**
 * READS THE 51 IFCT RECORDS FROM ./rikNutritionIfctWithheld, not from the
 * `rikNutrition` map, because that map is now empty on purpose: the records
 * were moved out so they would stop being bundled into the customer app (see
 * that module's header). They are aliased back to `rikNutrition` here so the
 * assertions below keep testing the same 51 records they always tested.
 *
 * A test may import that module. A production module may not.
 */
describe('isPublishable — the policy, one category at a time', () => {
  it('publishes a manufacturer-declared label', () => {
    // The maker's own published statement about their own product: item
    // specific, and carrying no third-party licence condition.
    expect(isPublishable(recordOf('manufacturer-declared'))).toBe(true);
  });

  it('WITHHOLDS composition-table while the IFCT flag is false', () => {
    expect(PUBLISH_COMPOSITION_TABLE_VALUES).toBe(false);
    expect(isPublishable(recordOf('composition-table'))).toBe(false);
  });

  it('WITHHOLDS approximate-reference, and does not consult any flag to do it', () => {
    expect(isPublishable(recordOf('approximate-reference'))).toBe(false);
    // The flag is false today, so the line above alone would also pass under
    // the OLD gate. What makes this meaningful is the next test.
  });

  it('would STILL withhold approximate-reference if the IFCT flag were turned on', () => {
    // This CANNOT be proved from behaviour: the IFCT flag is a compile-time
    // constant and it is false, so a fixed `false` and a flag-tracking `false`
    // are indistinguishable at runtime. It is proved from the policy table,
    // which states the rule for each category independently of the flag.
    expect(PUBLICATION_POLICY['approximate-reference']).toBe('never');
    // 'never' is not 'ifct-licence', so no value of the flag can release it.
    expect(PUBLICATION_POLICY['approximate-reference']).not.toBe('ifct-licence');
    // Exactly one category is governed by that flag.
    const flagGoverned = ALL_CATEGORIES.filter((c) => PUBLICATION_POLICY[c] === 'ifct-licence');
    expect(flagGoverned).toEqual(['composition-table']);
    // And the fixed answers, stated plainly.
    expect(isPublishable(recordOf('approximate-reference'))).toBe(false);
    expect(isPublishable(recordOf('manufacturer-declared'))).toBe(true);
  });

  it('declares a rule for every evidence category, with no category defaulted', () => {
    // The Record<DataQuality, PublicationRule> type means a new category
    // cannot compile without an entry here; this asserts the table's contents.
    expect(Object.keys(PUBLICATION_POLICY).sort()).toEqual([...ALL_CATEGORIES].sort());
    expect(PUBLICATION_POLICY['manufacturer-declared']).toBe('always');
    expect(PUBLICATION_POLICY['composition-table']).toBe('ifct-licence');
  });

  it('publishes nothing but manufacturer-declared under the current policy', () => {
    const publishable = ALL_CATEGORIES.filter((c) => isPublishable(recordOf(c)));
    expect(publishable).toEqual(['manufacturer-declared']);
  });

  it('decides every category the type admits — none falls through', () => {
    // If a new DataQuality member is added, the exhaustive switch in
    // isPublishable fails to compile. This asserts the list this file tests
    // against is still the whole list.
    for (const c of ALL_CATEGORIES) {
      expect(typeof isPublishable(recordOf(c)), c).toBe('boolean');
    }
    expect(new Set(ALL_CATEGORIES).size).toBe(3);
  });
});

describe('the 51 IFCT records cannot bypass the gate', () => {
  it('holds 51 composition-table records', () => {
    const entries = Object.entries(rikNutrition);
    expect(entries.length).toBe(51);
    for (const [code, r] of entries) expect(r.dataQuality, code).toBe('composition-table');
  });

  it('yields none of them through nutritionFor', () => {
    for (const code of Object.keys(rikNutrition)) {
      expect(nutritionFor(code), code).toBeNull();
      expect(isPublishable(rikNutrition[code]!), code).toBe(false);
    }
    expect(nutritionCodes()).toEqual([]);
  });
});

describe('the 184 preliminary group averages cannot bypass the gate', () => {
  const entries = Object.entries(rikNutritionPreliminary);

  it('holds 184 records, every one an approximate reference', () => {
    expect(entries.length).toBe(184);
    expect(PRELIMINARY_DATA_QUALITY).toBe('approximate-reference');
    // The category is declared once, and isPublishable rejects it outright.
    expect(isPublishable(recordOf(PRELIMINARY_DATA_QUALITY))).toBe(false);
  });

  it('is gated by its own flag, which is OFF', () => {
    expect(PUBLISH_PRELIMINARY_GROUP_AVERAGES).toBe(false);
    for (const [code] of entries) expect(preliminaryNutritionFor(code), code).toBeNull();
  });

  it('is not reachable through nutritionFor — the two stores stay separate', () => {
    // nutritionFor consults rikNutrition only. A preliminary-only provision
    // must therefore be unknown to it, flag or no flag.
    const preliminaryOnly = entries.map(([c]) => c).filter((c) => rikNutrition[c] === undefined);
    expect(preliminaryOnly.length).toBeGreaterThan(100);
    for (const code of preliminaryOnly) expect(nutritionFor(code), code).toBeNull();
  });
});

describe('the preliminary values were not merged into the IFCT records', () => {
  const shared = Object.keys(rikNutritionPreliminary).filter((c) => rikNutrition[c] !== undefined);

  it('shares provisions with the IFCT set, which is exactly why merging was the risk', () => {
    expect(shared.length).toBe(51);
  });

  it.each(shared)('%s keeps its IFCT provenance, not the workbook source', (code) => {
    const ifct = rikNutrition[code]!;
    expect(ifct.dataQuality).toBe('composition-table');
    expect(ifct.source).toMatch(/Indian Food Composition Tables 2017/);
    expect(ifct.sourceCode).toMatch(/^[A-L]\d{3}$/);
    expect(ifct.printedPage).toBeGreaterThanOrEqual(41);
    // Nothing from the workbook leaked across.
    expect(ifct.source).not.toMatch(/Dietary Guidelines/);
    expect(JSON.stringify(ifct)).not.toContain('foodGroupProxy');
    expect(JSON.stringify(ifct)).not.toContain('broad food-group average');
  });

  it('kept the ACCURATE figure where the two sources disagree', () => {
    // Maida: IFCT 1472 kJ -> 352.2 kcal. The workbook's cereal proxy says 343.
    const maida = rikNutrition['CER_MAIDA']!;
    expect(maida.energyKJ).toBe(1472);
    expect(maida.energyKcal).toBe(352.2);
    expect(rikNutritionPreliminary['CER_MAIDA']!.energyKcal).toBe(343);
    expect(maida.energyKcal).not.toBe(343);

    // Capsicum: IFCT 68 kJ -> 16.3 kcal against the vegetable proxy's 35.
    const capsicum = rikNutrition['VEG_CAPSICUM']!;
    expect(capsicum.energyKJ).toBe(68);
    expect(rikNutritionPreliminary['VEG_CAPSICUM']!.energyKcal).toBe(35);
    expect(capsicum.energyKcal).not.toBe(35);
  });
});

describe('the preliminary data is stored as supplied', () => {
  const entries = Object.entries(rikNutritionPreliminary);

  it('names the workbook it came from', () => {
    expect(PRELIMINARY_WORKBOOK).toBe('RIK_Nutrition_Preliminary_Chart_201_Items_Revised.xlsx');
  });

  it.each(entries)('%s records a verbatim basis and workbook row', (_code, r) => {
    expect(r.basis === 'Per 100 g raw weight — broad food-group average' || r.basis === 'Not established').toBe(true);
    expect(r.workbookRow).toBeGreaterThanOrEqual(1);
    expect(r.workbookRow).toBeLessThanOrEqual(201);
    expect(r.workbookName.length).toBeGreaterThan(0);
  });

  it('keeps the single supplied source string, and omits it where the workbook did', () => {
    const SRC = 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3';
    for (const [code, r] of entries) {
      if (r.energyKcal === undefined) {
        // The four "Not established" rows carry no values and no source.
        expect(r.source, code).toBeUndefined();
        expect(r.basis, code).toBe('Not established');
      } else {
        expect(r.source, code).toBe(SRC);
      }
    }
  });

  it('leaves the seven nutrients the workbook never supplied ABSENT, never zero', () => {
    // Total sugars, the four fatty-acid fractions, sodium and cholesterol are
    // blank for all 201 workbook rows. The workbook is explicit that the fatty
    // acids must not be derived from total fat.
    for (const [code, r] of entries) {
      expect(r.totalSugarsG, code).toBeUndefined();
      expect(r.saturatedFatG, code).toBeUndefined();
      expect(r.monounsaturatedFatG, code).toBeUndefined();
      expect(r.polyunsaturatedFatG, code).toBeUndefined();
      expect(r.transFatG, code).toBeUndefined();
      expect(r.sodiumMg, code).toBeUndefined();
      expect(r.cholesterolMg, code).toBeUndefined();
    }
  });

  it('carries values on 180 rows and none on the 4 with no established basis', () => {
    const withValues = entries.filter(([, r]) => r.energyKcal !== undefined);
    expect(withValues.length).toBe(180);
    expect(entries.length - withValues.length).toBe(4);
  });

  it('preserves the supplied decimals exactly', () => {
    // Spot-checks straight off the workbook: the vegetable, pulse and oil proxies.
    const veg = rikNutritionPreliminary['VEG_CAPSICUM']!;
    expect(veg.energyKcal).toBe(35);
    expect(veg.proteinG).toBe(1.8);
    expect(veg.carbohydrateG).toBe(5);
    expect(veg.fibreG).toBe(2);
    expect(veg.fatG).toBe(0.4);
    expect(veg.foodGroupProxy).toBe('vegetable');
  });

  it('records the food-group proxy, so no figure can be mistaken for item data', () => {
    for (const [code, r] of entries) {
      if (r.energyKcal !== undefined) expect(r.foodGroupProxy, code).toBeTruthy();
    }
  });

  it('is group-average data: 184 records collapse to a handful of value sets', () => {
    // The structural proof that these are not product measurements. If this
    // count ever rises sharply, the data has been replaced by something else
    // and the "approximate-reference" labelling needs revisiting.
    const tuples = new Set(
      entries
        .filter(([, r]) => r.energyKcal !== undefined)
        .map(([, r]) => `${r.energyKcal}|${r.proteinG}|${r.carbohydrateG}|${r.fibreG}|${r.fatG}`)
    );
    expect(tuples.size).toBeLessThanOrEqual(20);
    expect(tuples.size).toBeGreaterThan(1);
  });
});
