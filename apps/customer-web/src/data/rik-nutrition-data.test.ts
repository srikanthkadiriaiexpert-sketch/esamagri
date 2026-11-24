import { describe, it, expect } from 'vitest';
import {
  DELIBERATELY_UNMAPPED,
  IFCT_CITATION,
  IFCT_SOURCE,
  KJ_PER_KCAL,
  kcalFromKJ,
  NUTRIENT_ROWS,
  nutritionCodes,
  nutritionDescriptions,
  nutritionFor,
  PUBLISH_COMPOSITION_TABLE_VALUES,
  type NutritionRecord,
} from './rikNutrition';
import { rikNutritionIfctWithheld as rikNutrition } from './rikNutritionIfctWithheld';

/**
 * THE DATASET ITSELF, not the screen that draws it.
 *
 * nutrition-info.test.tsx mocks this module with a fixture, so it proves the
 * page renders whatever it is given. Nothing proved the data. This file does,
 * and it guards the three things that would do real damage if they slipped:
 *
 *   THE PUBLICATION GATE. ICMR-NIN's licence forbids storing IFCT 2017 data
 *   in a product without written permission. Until that letter exists the
 *   flag is false and NOTHING may reach a caller. The first describe block
 *   fails loudly if anyone flips it, so turning it on is a deliberate,
 *   reviewed act rather than an accident.
 *
 *   EVERY MANDATORY FIELD, ON EVERY RECORD. The approved policy makes energy,
 *   carbohydrate, total fat and dietary fibre mandatory. A record missing one
 *   must not exist at all — a half-populated table is worse than no table.
 *
 *   NO INVENTED ENERGY. IFCT publishes energy in kJ only. Every kcal figure
 *   must be exactly its own record's kJ put through the published factor, so
 *   the two can never disagree and no hand-typed kcal can creep in.
 */

const ALL = Object.entries(rikNutrition);
const MANDATORY = ['energyKcal', 'carbohydrateG', 'fatG', 'fibreG'] as const;

/** The expected size of the eligible set, after the approved exclusions. */
const ELIGIBLE_COUNT = 51;

/**
 * READS THE 51 IFCT RECORDS FROM ./rikNutritionIfctWithheld, not from the
 * `rikNutrition` map, because that map is now empty on purpose: the records
 * were moved out so they would stop being bundled into the customer app (see
 * that module's header). They are aliased back to `rikNutrition` here so the
 * assertions below keep testing the same 51 records they always tested.
 *
 * A test may import that module. A production module may not.
 */
describe('the publication gate', () => {
  it('is CLOSED — IFCT values are not published without written NIN permission', () => {
    // If this fails, either permission was obtained and this test should be
    // updated as part of that decision, or someone flipped a flag they should
    // not have. There is no third possibility.
    expect(PUBLISH_COMPOSITION_TABLE_VALUES).toBe(false);
  });

  it('yields no record to any caller while the gate is closed', () => {
    for (const [code] of ALL) {
      expect(nutritionFor(code)).toBeNull();
    }
    expect(nutritionCodes()).toEqual([]);
  });

  it('still holds the researched records, so nothing was lost to close the gate', () => {
    // The gate withholds; it does not delete. This is what makes turning it
    // on a one-line change rather than a re-transcription.
    expect(ALL.length).toBe(ELIGIBLE_COUNT);
  });

  it('gates composition-table records specifically, not every record', () => {
    // A manufacturer-declared label, when one is ever supplied, carries no
    // such licence condition and must not be caught by this gate.
    const gated = ALL.filter(([, r]) => r.dataQuality === 'composition-table');
    expect(gated.length).toBe(ELIGIBLE_COUNT);
  });
});

describe('every record is complete and sourced', () => {
  it.each(ALL)('%s has all four mandatory fields', (_code, record) => {
    for (const field of MANDATORY) {
      const value = (record as NutritionRecord)[field];
      expect(value, `${field} is mandatory`).not.toBeUndefined();
      expect(typeof value).toBe('number');
    }
  });

  it.each(ALL)('%s carries its IFCT code, page, sample count and citation', (_code, record) => {
    expect(record.source).toBe(IFCT_SOURCE);
    expect(record.citation).toBe(IFCT_CITATION);
    expect(record.dataQuality).toBe('composition-table');
    // The food code is what makes a figure auditable against the printed page.
    expect(record.sourceCode).toMatch(/^[A-L]\d{3}$/);
    expect(record.sourceFood.length).toBeGreaterThan(2);
    // Pages 41-55 are the printed tables these rows were read from.
    expect(record.printedPage).toBeGreaterThanOrEqual(41);
    expect(record.printedPage).toBeLessThanOrEqual(55);
    expect(record.sampleCount).toBeGreaterThanOrEqual(1);
  });

  it.each(ALL)('%s states the per-100g basis and the raw state', (_code, record) => {
    expect(record.basis).toBe('per 100 g edible portion');
    expect(record.state).toBe('raw');
  });

  it('records no total sugars, because IFCT does not publish them for these foods', () => {
    // Absent, never zero. A zero here would be a claim the source never made.
    for (const [, record] of ALL) expect(record.sugarsG).toBeUndefined();
  });
});

describe('energy: published in kJ, converted to kcal and never invented', () => {
  it('uses the factor the source itself prints', () => {
    // IFCT 2017 section 3.6: "1 kcal = 4.18 kJ". Not 4.184.
    expect(KJ_PER_KCAL).toBe(4.18);
  });

  it('converts to one decimal place', () => {
    expect(kcalFromKJ(1472)).toBe(352.2);
    expect(kcalFromKJ(418)).toBe(100);
    expect(kcalFromKJ(100)).toBe(23.9);
  });

  it.each(ALL)('%s publishes kJ and derives kcal from that same kJ', (_code, record) => {
    const kj = record.energyKJ;
    const kcal = record.energyKcal;
    expect(typeof kj).toBe('number');
    expect(typeof kcal).toBe('number');
    // The whole point: the shown kcal IS the stored kJ converted. If someone
    // hand-edits either figure, this fails.
    expect(kcal).toBe(kcalFromKJ(kj as number));
    // kJ are printed as whole numbers in the tables.
    expect(Number.isInteger(kj)).toBe(true);
  });

  it.each(ALL)('%s says in its notes that the kcal figure was converted', (_code, record) => {
    expect(record.notes).toMatch(/published in kilojoules only/);
    expect(record.notes).toMatch(/1 kcal = 4\.18 kJ/);
    expect(record.notes).toContain(`${record.energyKJ as number} kJ`);
  });

  it('shows the published figure next to the converted one', () => {
    const keys = NUTRIENT_ROWS.map((r) => r.key);
    expect(keys).toContain('energyKJ');
    // Adjacent, and converted first, so the conversion is never invisible.
    expect(keys.indexOf('energyKJ')).toBe(keys.indexOf('energyKcal') + 1);
    const kjRow = NUTRIENT_ROWS.find((r) => r.key === 'energyKJ');
    expect(kjRow?.unit).toBe('kJ');
    expect(kjRow?.label).toMatch(/published/i);
    const kcalRow = NUTRIENT_ROWS.find((r) => r.key === 'energyKcal');
    expect(kcalRow?.label).toMatch(/converted/i);
  });
});

describe('the approved exclusions hold', () => {
  it('contains no record for a deliberately unmapped provision', () => {
    for (const code of Object.keys(DELIBERATELY_UNMAPPED)) {
      expect(rikNutrition[code], `${code} must stay unmapped`).toBeUndefined();
    }
  });

  it('excludes provision 006 and the loose dals by name', () => {
    for (const code of [
      '006',
      'DAL_L_CHANNA_DAL',
      'DAL_L_DAL_ARHAR',
      'DAL_L_MOONG_YELLOW',
      'DAL_L_URD_DAL_WHOLE',
      'DAL_L_URD_DAL_WITHOUT_SKIN',
      'GMW_ASAFOETIDA',
    ]) {
      expect(rikNutrition[code]).toBeUndefined();
      expect(DELIBERATELY_UNMAPPED[code]).toBeDefined();
    }
  });

  it('holds no loose provision at all', () => {
    for (const [code] of ALL) expect(code).not.toMatch(/_L_|LOOSE/i);
  });

  it('retains no approximate-reference value', () => {
    // The 71 owner-supplied approximations were removed, not relabelled.
    // Relabelling would have turned an estimate into a false claim.
    for (const [, record] of ALL) expect(record.dataQuality).not.toBe('approximate-reference');
  });
});

describe('composition descriptions stay honest', () => {
  it('claims "source of dietary fibre" only at or above 3 g', () => {
    for (const [, record] of ALL) {
      const said = nutritionDescriptions(record).includes('Source of dietary fibre');
      expect(said).toBe((record.fibreG as number) >= 3);
    }
  });

  it('makes no medical claim anywhere in the dataset', () => {
    const prose = ALL.map(([, r]) => `${r.notes ?? ''} ${r.sourceFood}`).join(' ');
    expect(prose).not.toMatch(/cure|prevent|treat|disease|healthy|slimming/i);
  });
});
