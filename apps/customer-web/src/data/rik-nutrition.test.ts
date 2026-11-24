import { describe, it, expect } from 'vitest';
import {
  approx,
  DATA_QUALITY_LABELS,
  DELIBERATELY_UNMAPPED,
  formatNutrient,
  IFCT_CITATION,
  kcalFromKJ,
  LEGACY_RESEARCH_CODES,
  nutrientLowerBound,
  nutritionCodes,
  nutritionDescriptions,
  nutritionFor,
  PUBLISH_COMPOSITION_TABLE_VALUES,
  range,
  NUTRIENT_ROWS,
  type NutritionRecord,
} from './rikNutrition';
import { rikNutritionIfctWithheld as rikNutrition } from './rikNutritionIfctWithheld';

/**
 * The nutrition dataset's own rules.
 *
 * The important ones are NEGATIVE. This file must never drift into a second
 * catalogue, must never assert a number nobody can check, and must never
 * quietly turn a supplied range into a single figure. So the tests below
 * police the dataset's shape and its honesty, and deliberately do NOT demand
 * coverage — partial coverage is the designed state and must never fail a
 * build.
 *
 * =====================================================================
 * UPDATED FOR THE APPROVED POLICY OF 6 NOVEMBER 2026
 * =====================================================================
 *
 * This file previously asserted three things that the approved policy
 * deliberately REVERSES. They are called out here rather than quietly
 * deleted, because each was a correct test of the old dataset and the reason
 * it changed matters more than the change:
 *
 *   "records NO energy and NO sugars" — energy is now MANDATORY, taken from
 *   IFCT 2017's published kJ and converted with the source's own factor. The
 *   rule that test protected (no Atwater figure invented from nutrients) is
 *   still protected, now by `derives every kcal from its own published kJ`.
 *   Sugars are still absent and still asserted absent.
 *
 *   "marks every populated entry as an approximate reference" — inverted.
 *   Every entry is now a composition-table record, and the approximations
 *   were removed rather than relabelled. Asserted the other way round below.
 *
 *   The spot-checks against the owner's table for raw white rice and table
 *   salt — those entries are gone, and so are the branded rices they keyed
 *   on. Replaced by a spot-check against the printed IFCT page.
 *
 * COVERAGE TESTS NOW READ THE DATASET, NOT `nutritionCodes()`. While the
 * publication gate is closed `nutritionCodes()` is empty by design, so a
 * coverage assertion written against it would pass while checking nothing.
 * Anything auditing what the dataset HOLDS reads `rikNutrition` directly;
 * only tests about what a screen can SHOW go through `nutritionFor`.
 */

/**
 * Every provision code in the approved RIK catalogue.
 *
 * Extracted from the project's own seed migrations — 0026 (the dry and fresh
 * configuration), 0032 (the 44 vegetable and 26 fruit varieties) and 0053
 * (the fresh-milk coupon) — and it comes to 190, which is exactly the number
 * of active provisions the live catalogue reports. A nutrition entry keyed on
 * anything outside this set can never match a real product, so it fails here
 * rather than silently showing nothing at runtime.
 */
const KNOWN_CODES = new Set([
  'BG_AMUL_BUTTER', 'BG_AMUL_GHEE', 'CER_ATTA_AASHIRVAAD', 'CER_ATTA_AMUL', 'CER_ATTA_PILLSBURY',
  'CER_BREAD_BROWN', 'CER_BREAD_MULTIGRAIN', 'CER_BREAD_PAV', 'CER_BREAD_SANDWICH',
  'CER_BURGER_BUN', 'CER_CREAM_ROLL', 'CER_CUP_CAKE', 'CER_HAKKA_NOODLES', 'CER_MAGGI',
  'CER_MAIDA', 'CER_MILLETS', 'CER_PIZZA_BASE', 'CER_RICE_HERITAGE', 'CER_RICE_ROZANA',
  'CER_RICE_SONA_MASOORI', 'CER_RICE_SUPER_BASMATI', 'CER_RUSK', 'CH_BLOCK', 'CH_MOZZARELLA',
  'CH_PANEER', 'CH_SLICES', 'CH_SPREAD', 'CH_TIN', 'CND_AMCHUR_MASALA', 'CND_CHANA_MASALA',
  'CND_CHICKEN_MASALA', 'CND_CHOLE_MASALA', 'CND_CORIANDER_POWDER', 'CND_CORIANDER_SEEDS',
  'CND_CUMIN_SEEDS', 'CND_EVEREST_CHILLY_POWDER', 'CND_GARAM_MASALA', 'CND_GARLIC',
  'CND_KITCHEN_KING_MASALA', 'CND_PANI_PURI_MASALA', 'CND_PAV_BHAJI_MASALA', 'CND_RASAM_MASALA',
  'CND_SABJI_MASALA', 'CND_SAMBAR_MASALA', 'CND_SHAHI_BIRYANI_MASALA', 'CND_SHAHI_PANEER_MASALA',
  'CND_TAMARIND', 'CND_TANDOORI_MASALA', 'CND_TURMERIC_POWDER', 'COFFEE_COLUMBIAN', 'COFFEE_LOOSE',
  'DAL_CORNFLAKES', 'DAL_CORN_FLOUR', 'DAL_CUSTARD', 'DAL_DALIYA', 'DAL_L_CHANNA_DAL',
  'DAL_L_DAL_ARHAR', 'DAL_L_KABULI_CHANA', 'DAL_L_MASOOR_DAL_WHOLE', 'DAL_L_MOONG_YELLOW',
  'DAL_L_RAJMA', 'DAL_L_URD_DAL_WHOLE', 'DAL_L_URD_DAL_WITHOUT_SKIN', 'DAL_OATS',
  'DAL_P_FORTUNE_BESAN', 'DAL_P_TATA_ARHAR', 'DAL_P_TATA_BLACK_CHANA', 'DAL_P_TATA_KABULI_CHANA',
  'DAL_P_TATA_MASOOR_SPLIT', 'DAL_P_TATA_MOONG_WHOLE', 'DAL_P_TATA_MOONG_WITHOUT_SKIN',
  'DAL_P_TATA_PEAS_DRIED', 'DAL_P_TATA_RAJMA', 'DAL_P_TATA_URD_SPLIT',
  'DAL_P_TATA_URD_WITHOUT_SKIN', 'DAL_SAGO', 'DAL_SEMOLINA', 'EGGS_TABLE', 'FRUIT_APPLE_SHIMLA',
  'FRUIT_APRICOT', 'FRUIT_BANANA_ROBUSTA', 'FRUIT_CHICKOO', 'FRUIT_CUSTARD_APPLE',
  'FRUIT_DRAGON_FRUIT', 'FRUIT_DRY', 'FRUIT_FRESH', 'FRUIT_GRAPES_BLACK_S_L', 'FRUIT_GRAPES_S_L',
  'FRUIT_KINNU', 'FRUIT_KIWI', 'FRUIT_LITCHI', 'FRUIT_MANGO_BANGANPALLI', 'FRUIT_MANGO_DASHERI',
  'FRUIT_MANGO_LANGRA', 'FRUIT_MUSAMBI_SWEET_LEMON', 'FRUIT_MUSKMELON', 'FRUIT_ORANGE',
  'FRUIT_PAPAYA', 'FRUIT_PEARS', 'FRUIT_PINEAPPLE', 'FRUIT_PLUM', 'FRUIT_POMEGRANATE',
  'FRUIT_SOUR_LIME', 'FRUIT_STRAWBERRY', 'FRUIT_THAI_GUAVA', 'FRUIT_WATERMELON', 'GARLIC_FRESH',
  'GMW_AJWAIN', 'GMW_ANISE_SEEDS', 'GMW_ASAFOETIDA', 'GMW_BAY_LEAF', 'GMW_CINNAMON_STICK',
  'GMW_CLOVES', 'GMW_FENUGREEK', 'GMW_KASHMIRI_CHILLI', 'GMW_LARGE_CARDAMOM', 'GMW_POPPY_SEEDS',
  'GMW_WHOLE_PEPPER', 'JAGGERY', 'MEAT_CHICKEN', 'MEAT_FISH', 'MEAT_MUTTON', 'MILK_FRESH',
  'MILK_FRESH_COUPON', 'MILK_TD', 'NU_AMULPRO', 'NU_BOOST', 'NU_BOURNVITA', 'NU_HORLICKS',
  'NU_MUESLI', 'OIL_GROUNDNUT', 'OIL_HYDROGENATED', 'OIL_MUSTARD_1000', 'OIL_MUSTARD_500',
  'OIL_RICE_BRAN', 'OIL_SUNFLOWER_1000', 'OIL_SUNFLOWER_500', 'ONION_FRESH',
  'POTATO_ALT_VEGETABLES', 'POTATO_FRESH', 'SALT_TABLE', 'SUGAR', 'TEA_CHAHAT', 'TEA_LOOSE',
  'TEA_WAGH_BAKRI', 'VEG_ARVI', 'VEG_ASPARAGUS', 'VEG_BABY_CORN', 'VEG_BEANS_FRENCH',
  'VEG_BEANS_LONG', 'VEG_BEETROOT', 'VEG_BITTER_GUARD', 'VEG_BOTTLE_GUARD',
  'VEG_BRINJAL_PURPLE_AND_GREEN', 'VEG_BROCCOLI', 'VEG_CABBAGE', 'VEG_CAPSICUM',
  'VEG_CAPSICUM_RED', 'VEG_CAPSICUM_YELLOW', 'VEG_CARROT_COUNTRY', 'VEG_CARROT_RED',
  'VEG_CAULIFLOWER', 'VEG_CHILLY_GREEN', 'VEG_CLUSTER_BEANS', 'VEG_CORIANDER_GREEN', 'VEG_COWPEAS',
  'VEG_CUCUMBER', 'VEG_CURRY_LEAVES', 'VEG_DRUM_STICK', 'VEG_FRESH', 'VEG_GINGER_GREEN',
  'VEG_KHOL_KHOL', 'VEG_KUNDRI', 'VEG_LADIE_S_FINGER', 'VEG_LEEK', 'VEG_MARROW', 'VEG_MINT_GREEN',
  'VEG_MUSHROOM', 'VEG_PARWAL', 'VEG_PEAS_GREEN', 'VEG_PUMPKIN', 'VEG_RADISH', 'VEG_RIBBED_GUARD',
  'VEG_SNAKE_GUARD', 'VEG_SPINACH_COUNTRY', 'VEG_SPRING_ONION', 'VEG_TINDA', 'VEG_TOMATO_RED',
  'VEG_TURNIP', 'VEG_ZIMIKAND'
]);

/**
 * Provision codes named in the exclusion list that are NOT among the 190
 * approved catalogue codes above.
 *
 * '001' and '006' come from the Phase 1 research table and are not in the seed
 * migrations that KNOWN_CODES is drawn from, so they are legacy research
 * references rather than active provisions. The data module declares them
 * itself in LEGACY_RESEARCH_CODES, and this allowlist is READ FROM THAT
 * DECLARATION rather than restated here — so a third legacy code cannot be
 * slipped past the orphan test by editing this file alone, and the two
 * statements can never disagree.
 */
const EXCLUSIONS_OUTSIDE_THE_CATALOGUE = new Set(Object.keys(LEGACY_RESEARCH_CODES));

/**
 * READS THE 51 IFCT RECORDS FROM ./rikNutritionIfctWithheld, not from the
 * `rikNutrition` map, because that map is now empty on purpose: the records
 * were moved out so they would stop being bundled into the customer app (see
 * that module's header). They are aliased back to `rikNutrition` here so the
 * assertions below keep testing the same 51 records they always tested.
 *
 * A test may import that module. A production module may not.
 */
describe('the RIK nutrition dataset', () => {
  it('has the full catalogue to check against', () => {
    // Guards the fixture itself: if this number moves, the list above was
    // edited and the orphan test below is no longer checking what it claims.
    expect(KNOWN_CODES.size).toBe(190);
  });

  it('claims no provision code that does not exist — a typo or a retired item fails here', () => {
    // Reads the dataset, not nutritionCodes(), so the check still bites while
    // the publication gate is closed.
    const unknown = Object.keys(rikNutrition).filter((code) => !KNOWN_CODES.has(code));
    // If this fails, either the code is misspelled or the provision was
    // retired. Both mean the entry can never match, so it must be corrected
    // or removed rather than left to fail silently at runtime.
    expect(unknown).toEqual([]);
  });

  it('does NOT require every provision to have an entry — partial coverage is valid', () => {
    // Stated as a test so nobody later "fixes" the dataset by filling the
    // gaps with guesses. An absent entry is a supported, correct state.
    const held = Object.keys(rikNutrition).length;
    expect(held).toBeGreaterThan(0);
    expect(held).toBeLessThan(KNOWN_CODES.size);
  });

  it('holds exactly the 51 provisions the approved policy admits', () => {
    expect(Object.keys(rikNutrition).length).toBe(51);
  });

  it('gives every entry a basis, a state, a source, a reference food and a data quality', () => {
    for (const [code, record] of Object.entries(rikNutrition)) {
      expect(record.basis, `${code} basis`).toBeTruthy();
      expect(record.state, `${code} state`).toBeTruthy();
      expect(record.source, `${code} source`).toBeTruthy();
      // Without this, nobody can audit whether the match was defensible.
      expect(record.sourceFood, `${code} sourceFood`).toBeTruthy();
      // Without this, an approximation could be read as a declared figure.
      expect(DATA_QUALITY_LABELS[record.dataQuality], `${code} dataQuality`).toBeTruthy();
    }
  });

  it('never stores a nutrient as null — an unknown value is absent, not zero', () => {
    for (const [code, record] of Object.entries(rikNutrition)) {
      for (const row of NUTRIENT_ROWS) {
        // Cast through `unknown`: NutritionRecord has no index signature, so a
        // direct assertion to Record<string, unknown> is a TS2352 error. Carried
        // over from the original file, where it went unnoticed because
        // tsconfig.app.json excludes test files from the type check.
        const value = (record as unknown as Record<string, unknown>)[row.key];
        expect(value === null, `${code}.${row.key} must be absent, never null`).toBe(false);
        if (value === undefined) continue;
        if (typeof value === 'number') {
          expect(Number.isFinite(value), `${code}.${row.key}`).toBe(true);
          continue;
        }
        const v = value as { kind: string; min?: number; max?: number; value?: number };
        expect(['range', 'approx'], `${code}.${row.key} kind`).toContain(v.kind);
        if (v.kind === 'range') {
          expect(Number.isFinite(v.min), `${code}.${row.key} min`).toBe(true);
          expect(Number.isFinite(v.max), `${code}.${row.key} max`).toBe(true);
          // A range whose ends are the wrong way round would make the
          // lower-bound claim test meaningless.
          expect(v.max!, `${code}.${row.key}`).toBeGreaterThanOrEqual(v.min!);
        } else {
          expect(Number.isFinite(v.value), `${code}.${row.key} value`).toBe(true);
        }
      }
    }
  });

  it('records every mandatory field, because a half-filled table is worse than none', () => {
    // Energy, carbohydrate, total fat and dietary fibre are mandatory under
    // the approved policy. Protein is optional — and present anyway.
    for (const [code, record] of Object.entries(rikNutrition)) {
      expect(typeof record.energyKcal, `${code} energyKcal`).toBe('number');
      expect(typeof record.energyKJ, `${code} energyKJ`).toBe('number');
      expect(typeof record.carbohydrateG, `${code} carbohydrateG`).toBe('number');
      expect(typeof record.fatG, `${code} fatG`).toBe('number');
      expect(typeof record.fibreG, `${code} fibreG`).toBe('number');
    }
  });

  it('records NO sugars, because IFCT does not publish them for these foods', () => {
    // Absent, never zero. A zero here would be a claim the source never made.
    for (const [code, record] of Object.entries(rikNutrition)) {
      expect(record.sugarsG, `${code} sugarsG`).toBeUndefined();
    }
  });

  it('answers null for a provision it does not describe', () => {
    expect(nutritionFor('NO_SUCH_PROVISION_CODE')).toBeNull();
  });

  it('actually carries data — the file is not empty', () => {
    expect(Object.keys(rikNutrition).length).toBeGreaterThan(50);
  });
});

describe('the publication gate', () => {
  it('is closed, so no IFCT figure reaches a screen without written NIN permission', () => {
    // IFCT 2017's licence forbids storing its data in a product without the
    // prior written permission of NIN. Until that letter exists this must be
    // false, and nothing may be rendered.
    expect(PUBLISH_COMPOSITION_TABLE_VALUES).toBe(false);
    for (const code of Object.keys(rikNutrition)) {
      expect(nutritionFor(code), code).toBeNull();
    }
    expect(nutritionCodes()).toEqual([]);
  });

  it('withholds without deleting, so permission is a one-line change', () => {
    // The gate must not be implemented by emptying the dataset — that would
    // mean re-transcribing 51 foods the day permission arrives.
    expect(Object.keys(rikNutrition).length).toBe(51);
  });
});

describe('products that must stay unavailable', () => {
  it('holds no entry for any deliberately unmapped provision', () => {
    // Reads the dataset directly: with the gate closed, a nutritionFor-based
    // check would pass even if an excluded product HAD been given a record.
    const leaked = Object.keys(DELIBERATELY_UNMAPPED).filter((code) => rikNutrition[code] !== undefined);
    // Proprietary formulations, blended masalas, loose commodities, packaged
    // products and foods of ambiguous variety. Each needs its own evidence,
    // or a decision, not a generic profile.
    expect(leaked).toEqual([]);
  });

  it('names only real provisions in its exclusion list', () => {
    const unknown = Object.keys(DELIBERATELY_UNMAPPED).filter(
      (code) => !KNOWN_CODES.has(code) && !EXCLUSIONS_OUTSIDE_THE_CATALOGUE.has(code)
    );
    expect(unknown).toEqual([]);
  });

  it('gives a reason for every exclusion', () => {
    for (const [code, reason] of Object.entries(DELIBERATELY_UNMAPPED)) {
      expect(reason.length, `${code} reason`).toBeGreaterThan(10);
    }
  });

  it('keeps every branded nutrition drink and Amul product unavailable', () => {
    for (const code of ['NU_HORLICKS', 'NU_BOURNVITA', 'NU_BOOST', 'NU_AMULPRO', 'NU_MUESLI',
                        'BG_AMUL_GHEE', 'BG_AMUL_BUTTER', 'CH_PANEER', 'CER_ATTA_AMUL']) {
      expect(rikNutrition[code], code).toBeUndefined();
    }
  });

  it('keeps every blended masala unavailable', () => {
    const masalas = [...KNOWN_CODES].filter((c) => c.startsWith('CND_') && c.endsWith('_MASALA'));
    expect(masalas.length).toBeGreaterThan(5);
    for (const code of masalas) expect(rikNutrition[code], code).toBeUndefined();
  });

  it('keeps every loose commodity unavailable, by policy rather than for want of data', () => {
    // The 6 November decisions exclude loose products outright. Five of these
    // were High-confidence IFCT matches; the data exists and is not used.
    for (const code of ['DAL_L_CHANNA_DAL', 'DAL_L_DAL_ARHAR', 'DAL_L_MOONG_YELLOW',
                        'DAL_L_URD_DAL_WHOLE', 'DAL_L_URD_DAL_WITHOUT_SKIN']) {
      expect(rikNutrition[code], code).toBeUndefined();
      expect(DELIBERATELY_UNMAPPED[code], code).toMatch(/loose/i);
    }
    // And no loose provision anywhere in the dataset.
    for (const code of Object.keys(rikNutrition)) expect(code).not.toMatch(/_L_/);
  });

  it('documents EVERY unpublished catalogue provision, with no silent gaps', () => {
    // 190 approved provisions, 51 published, so 139 must each carry a written
    // reason. Without this, an item could be dropped from the Nutrition Info
    // section with nothing on record to say why — which is how a policy
    // decision quietly becomes an accident.
    const unpublished = [...KNOWN_CODES].filter((code) => rikNutrition[code] === undefined);
    expect(unpublished.length).toBe(139);
    const undocumented = unpublished.filter((code) => DELIBERATELY_UNMAPPED[code] === undefined);
    expect(undocumented, 'every unpublished provision needs a documented reason').toEqual([]);
  });

  it('names the five branded rices as branded, not as merely ambiguous', () => {
    // Corrected on 7 November 2026. These were classified PENDING while the
    // policy excludes branded products outright, so the reason had to say so.
    for (const code of ['CER_RICE_SONA_MASOORI', 'CER_RICE_HERITAGE', 'CER_RICE_ROZANA',
                        'CER_RICE_SUPER_BASMATI', '001']) {
      expect(rikNutrition[code], code).toBeUndefined();
      expect(DELIBERATELY_UNMAPPED[code], code).toMatch(/branded product; excluded under the agreed policy/i);
    }
  });

  it('treats 001 and 006 as legacy research codes, never as catalogue provisions', () => {
    for (const code of Object.keys(LEGACY_RESEARCH_CODES)) {
      // Not in the approved catalogue, and must never be added to it.
      expect(KNOWN_CODES.has(code), `${code} must not be an approved provision`).toBe(false);
      // No nutrition record, and a documented reason all the same.
      expect(rikNutrition[code], code).toBeUndefined();
      expect(DELIBERATELY_UNMAPPED[code], code).toBeDefined();
      expect(LEGACY_RESEARCH_CODES[code], code).toMatch(/not an approved catalogue provision/i);
    }
    // Exactly two, so a third cannot be added without this test being changed.
    expect(Object.keys(LEGACY_RESEARCH_CODES).sort()).toEqual(['001', '006']);
  });

  it('keeps the packaged flour and the compounded asafoetida unavailable', () => {
    expect(rikNutrition['006']).toBeUndefined();
    expect(rikNutrition['GMW_ASAFOETIDA']).toBeUndefined();
    // Maida itself is in, as an unbranded single-ingredient commodity.
    expect(rikNutrition['CER_MAIDA']).toBeDefined();
  });
});

describe('nutrient values', () => {
  it('prints a range as a range, and never as its midpoint', () => {
    expect(formatNutrient(range(7, 8), 'g')).toBe('7–8 g');
    // 7.5 is the number this feature must never invent.
    expect(formatNutrient(range(7, 8), 'g')).not.toContain('7.5');
  });

  it('prints an approximate value with its tilde', () => {
    expect(formatNutrient(approx(100), 'g')).toBe('~100 g');
  });

  it('prints an exact value plainly, including a real zero', () => {
    expect(formatNutrient(0, 'g')).toBe('0 g');
    expect(formatNutrient(12.5, 'g')).toBe('12.5 g');
  });

  it('takes the lowest figure a value admits', () => {
    expect(nutrientLowerBound(range(10, 25))).toBe(10);
    expect(nutrientLowerBound(approx(100))).toBe(100);
    expect(nutrientLowerBound(3)).toBe(3);
  });

  it('matches the printed IFCT page for a sampled entry', () => {
    // Spot-check against IFCT 2017 page 41, A018 "Wheat flour, refined":
    // PROTCNT 10.36, FATCE 0.76, FIBTG 2.76, CHOAVLDF 74.27, ENERC 1472 kJ.
    // Read off the printed table, not computed from anything.
    const maida = rikNutrition['CER_MAIDA'];
    expect(maida?.sourceCode).toBe('A018');
    expect(maida?.sourceFood).toBe('Wheat flour, refined');
    expect(maida?.printedPage).toBe(41);
    expect(maida?.proteinG).toBe(10.36);
    expect(maida?.fatG).toBe(0.76);
    expect(maida?.fibreG).toBe(2.76);
    expect(maida?.carbohydrateG).toBe(74.27);
    expect(maida?.energyKJ).toBe(1472);
    // 1472 / 4.18 = 352.153..., to one decimal.
    expect(maida?.energyKcal).toBe(352.2);
  });

  it('derives every kcal from its own published kJ, inventing none', () => {
    // This is the rule the old "records NO energy" test existed to protect,
    // restated for a dataset that now HAS energy. A hand-typed kcal, or one
    // computed from the nutrients via Atwater, fails here.
    for (const [code, record] of Object.entries(rikNutrition)) {
      expect(record.energyKcal, `${code} kcal must be its own kJ converted`)
        .toBe(kcalFromKJ(record.energyKJ as number));
      expect(Number.isInteger(record.energyKJ), `${code} kJ as printed`).toBe(true);
    }
  });

  it('uses the conversion factor the source itself publishes', () => {
    // IFCT 2017 section 3.6: "1 kcal = 4.18 kJ".
    expect(kcalFromKJ(418)).toBe(100);
    expect(kcalFromKJ(1472)).toBe(352.2);
  });

  it('says on every record that the kcal figure was converted', () => {
    for (const [code, record] of Object.entries(rikNutrition)) {
      expect(record.notes, `${code} notes`).toMatch(/published in kilojoules only/);
      expect(record.notes, `${code} notes`).toMatch(/1 kcal = 4\.18 kJ/);
    }
  });

  it('marks every populated entry as a composition-table figure, and keeps no approximation', () => {
    // The inverse of the old assertion. The 71 owner-supplied approximations
    // were REMOVED, not relabelled — relabelling an estimate as transcribed
    // would have turned an approximation into a false claim.
    for (const [code, record] of Object.entries(rikNutrition)) {
      expect(record.dataQuality, code).toBe('composition-table');
      expect(record.citation, code).toBe(IFCT_CITATION);
    }
    expect(DATA_QUALITY_LABELS['composition-table']).toMatch(/composition table/i);
    // The wording must still not assert independent verification.
    expect(DATA_QUALITY_LABELS['composition-table']).not.toMatch(/verified|certified|guaranteed/i);
    // And the approximate label, though now unused, must stay honest.
    expect(DATA_QUALITY_LABELS['approximate-reference']).toMatch(/approximate/i);
    expect(DATA_QUALITY_LABELS['approximate-reference']).not.toMatch(/verified|certified|guaranteed/i);
  });
});

describe('nutrition descriptions', () => {
  const base: NutritionRecord = {
    basis: 'per 100 g',
    state: 'raw',
    source: 'Test source',
    sourceFood: 'Test food',
    dataQuality: 'approximate-reference',
  };

  it('says nothing at all when the underlying values are absent', () => {
    // The rule that matters: no number, no claim.
    expect(nutritionDescriptions(base)).toEqual([]);
  });

  it('calls a food a source of fibre only at or above the published 3 g threshold', () => {
    expect(nutritionDescriptions({ ...base, fibreG: 2.9 })).toEqual([]);
    expect(nutritionDescriptions({ ...base, fibreG: 3 })).toContain('Source of dietary fibre');
  });

  it('tests a RANGE against its lowest figure, not its most flattering one', () => {
    // 2-5 g straddles the threshold, so the claim is not safe to make.
    expect(nutritionDescriptions({ ...base, fibreG: range(2, 5) })).toEqual([]);
    // 10-30 g clears it everywhere.
    expect(nutritionDescriptions({ ...base, fibreG: range(10, 30) })).toContain('Source of dietary fibre');
  });

  it('calls a food a source of protein only at or above 12% of energy', () => {
    // 100 kcal with 2 g protein = 8% — below the threshold.
    expect(nutritionDescriptions({ ...base, proteinG: 2, energyKcal: 100 })).toEqual([]);
    // 100 kcal with 3 g protein = 12% — at the threshold.
    expect(nutritionDescriptions({ ...base, proteinG: 3, energyKcal: 100 })).toContain('Source of protein');
  });

  it('makes no protein claim without an energy figure to measure it against', () => {
    expect(nutritionDescriptions({ ...base, proteinG: range(20, 24) })).toEqual([]);
  });

  it('makes no claim about preventing, treating or curing anything', () => {
    const everything = nutritionDescriptions({ ...base, fibreG: 10, proteinG: 20, energyKcal: 200 });
    const forbidden = /cure|prevent|treat|disease|heal|remedy|immun|detox/i;
    for (const description of everything) {
      expect(description, description).not.toMatch(forbidden);
    }
    // Nor anywhere in the dataset's own prose.
    const prose = Object.values(rikNutrition).map((r) => `${r.notes ?? ''} ${r.sourceFood}`).join(' ');
    expect(prose).not.toMatch(/cure|prevent|treat|disease|slimming/i);
  });
});
