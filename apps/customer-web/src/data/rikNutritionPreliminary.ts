/**
 * PRELIMINARY nutrition figures for RIK provisions — NOT FOR PUBLICATION.
 *
 * =====================================================================
 * WHAT THIS IS, AND WHY IT IS IN ITS OWN FILE
 * =====================================================================
 *
 * 184 rows transcribed from the workbook
 * "RIK_Nutrition_Preliminary_Chart_201_Items_Revised.xlsx", supplied on
 * 7 November 2026. They are BROAD FOOD-GROUP AVERAGES, not measurements of
 * these products.
 *
 * The workbook says so itself, on its Methodology sheet:
 *
 *   Purpose   "Preliminary research chart ... not a clinical prescription,
 *             lab analysis or publication-ready database."
 *   Estimates the group average is "used as a preliminary proxy, not as a
 *             product-specific measurement".
 *   Gate      "Do not publish these group averages in the app as verified
 *             item values."
 *
 * The arithmetic bears that out: the 201 workbook rows carry only 17 distinct
 * nutrient value-sets, one per food group. All 34 rows proxied as "vegetable"
 * read 35 kcal, whether the food is capsicum, pumpkin or mushroom.
 *
 * SO IT IS KEPT COMPLETELY SEPARATE FROM data/rikNutrition.ts. That file
 * holds 51 item-level IFCT 2017 records, read from the printed tables. These
 * two must never be merged, and for 51 provisions this file is the WORSE
 * source — for fresh garlic the IFCT figure is 123.9 kcal against this
 * workbook's 35, and for green chilli 42.3 against 240, because green chilli
 * was given the dried-spice proxy. Nothing here overwrites, modifies or
 * shadows a single one of those 51 records.
 *
 * =====================================================================
 * IT CANNOT REACH A CUSTOMER
 * =====================================================================
 *
 * Three independent reasons, any one of which is sufficient:
 *
 *   1. `PUBLISH_PRELIMINARY_GROUP_AVERAGES` is false, and
 *      `preliminaryNutritionFor` returns null while it is.
 *   2. Every record is `approximate-reference`, which `isPublishable` in
 *      data/rikNutrition.ts rejects unconditionally — there is no flag that
 *      releases that category.
 *   3. No screen imports this module. The Nutrition Info page reads
 *      `nutritionFor`, which only ever consults `rikNutrition`.
 *
 * A test asserts all three, and the source scanner in
 * nutrition-gate-protection.test.ts fails the build if a production module
 * reaches this map directly.
 *
 * =====================================================================
 * THE VALUES ARE AS SUPPLIED
 * =====================================================================
 *
 * Copied cell for cell, decimals preserved, nothing rounded or recomputed.
 * A blank cell becomes an ABSENT FIELD, never 0 — and the blanks are
 * wholesale: the workbook supplies no total sugars, no saturated,
 * mono-unsaturated, poly-unsaturated or trans fat, no sodium and no
 * cholesterol for ANY row, so those six fields are absent throughout. The
 * workbook is explicit that they must not be derived from total fat.
 *
 * `basis`, `source` and `foodGroupProxy` are stored verbatim, including the
 * four rows whose basis reads "Not established" and which therefore carry no
 * values and no source at all.
 *
 * Also held back, and not in this file: 15 rows whose provision codes are not
 * among the 190 approved catalogue provisions, and 2 rows whose product name
 * came through as the UI placeholder "No picture" (workbook rows 31 and 167).
 * Those remain unmatched by instruction; they are not guessed.
 */

/** The only evidence category this file holds. Kept explicit, not inferred. */
export type PreliminaryDataQuality = 'approximate-reference';

export interface PreliminaryNutritionRecord {
  /** Row number in the source workbook, so any figure can be traced back. */
  readonly workbookRow: number;
  /** The product name exactly as the workbook spells it. */
  readonly workbookName: string;
  /** The category exactly as the workbook spells it. */
  readonly workbookCategory: string;
  readonly brand?: string;
  readonly packSize?: string;
  /** The food group whose average was used. The reason this is not item data. */
  readonly foodGroupProxy?: string;
  /** Verbatim basis string from the workbook. Never inferred. */
  readonly basis: string;
  /** Verbatim source string from the workbook. Absent where the workbook left it blank. */
  readonly source?: string;

  /** Absent means the workbook left the cell blank. It NEVER means zero. */
  readonly energyKcal?: number;
  readonly proteinG?: number;
  readonly carbohydrateG?: number;
  readonly totalSugarsG?: number;
  readonly fibreG?: number;
  readonly fatG?: number;
  readonly saturatedFatG?: number;
  readonly monounsaturatedFatG?: number;
  readonly polyunsaturatedFatG?: number;
  readonly transFatG?: number;
  readonly sodiumMg?: number;
  readonly cholesterolMg?: number;
}

/** The workbook these figures came from, named once. */
export const PRELIMINARY_WORKBOOK = 'RIK_Nutrition_Preliminary_Chart_201_Items_Revised.xlsx';

/** When the workbook was transcribed into this file. */
export const PRELIMINARY_LAST_UPDATED = '2026-11-07';

/**
 * Every record here is an approximate reference value. Stated as a constant so
 * a test can assert it rather than trusting 184 hand-written literals.
 */
export const PRELIMINARY_DATA_QUALITY: PreliminaryDataQuality = 'approximate-reference';

/**
 * PUBLICATION GATE for the preliminary figures. False, and a separate decision
 * from the IFCT flag — these are group averages, not item values, and the two
 * questions must never share a switch.
 *
 * Turning this true is NOT sufficient to display anything: `isPublishable`
 * rejects 'approximate-reference' outright, so a reviewed decision to publish
 * any of this would have to change that function too, deliberately.
 */
export const PUBLISH_PRELIMINARY_GROUP_AVERAGES = false;

/**
 * Provision code to preliminary record. 184 entries, one per matched workbook
 * row, keyed on the approved catalogue provision code.
 */
export const rikNutritionPreliminary: Readonly<Record<string, PreliminaryNutritionRecord>> = {
  BG_AMUL_BUTTER: {
    workbookRow: 14, workbookName: 'Butter', workbookCategory: 'Butter / Ghee', brand: 'Amul', packSize: '100 g', foodGroupProxy: 'milk products', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 337, proteinG: 21.6, carbohydrateG: 16, fibreG: 0, fatG: 18.6,
  },
  BG_AMUL_GHEE: {
    workbookRow: 13, workbookName: 'Ghee', workbookCategory: 'Butter / Ghee', brand: 'Amul', packSize: '500 tin', foodGroupProxy: 'milk products', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 337, proteinG: 21.6, carbohydrateG: 16, fibreG: 0, fatG: 18.6,
  },
  CER_ATTA_AASHIRVAAD: {
    workbookRow: 111, workbookName: 'Aashirvaad Atta', workbookCategory: 'Cereals', packSize: '1,000 g', foodGroupProxy: 'cereal', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 343, proteinG: 9.3, carbohydrateG: 72, fibreG: 6, fatG: 1.2,
  },
  CER_ATTA_AMUL: {
    workbookRow: 113, workbookName: 'Atta', workbookCategory: 'Cereals', brand: 'Amul', packSize: '1,000 g', foodGroupProxy: 'cereal', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 343, proteinG: 9.3, carbohydrateG: 72, fibreG: 6, fatG: 1.2,
  },
  CER_ATTA_PILLSBURY: {
    workbookRow: 112, workbookName: 'Pillsbury Chakki Fresh Atta', workbookCategory: 'Cereals', packSize: '1,000 g', foodGroupProxy: 'cereal', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 343, proteinG: 9.3, carbohydrateG: 72, fibreG: 6, fatG: 1.2,
  },
  CER_BREAD_BROWN: {
    workbookRow: 99, workbookName: 'Brown Bread', workbookCategory: 'Cereals', packSize: '400 g', foodGroupProxy: 'cereal', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 343, proteinG: 9.3, carbohydrateG: 72, fibreG: 6, fatG: 1.2,
  },
  CER_BREAD_MULTIGRAIN: {
    workbookRow: 100, workbookName: 'Multigrain Bread', workbookCategory: 'Cereals', packSize: '400 g', foodGroupProxy: 'cereal', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 343, proteinG: 9.3, carbohydrateG: 72, fibreG: 6, fatG: 1.2,
  },
  CER_BREAD_PAV: {
    workbookRow: 101, workbookName: 'Pav Bread', workbookCategory: 'Cereals', packSize: '300 g', foodGroupProxy: 'cereal', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 343, proteinG: 9.3, carbohydrateG: 72, fibreG: 6, fatG: 1.2,
  },
  CER_BREAD_SANDWICH: {
    workbookRow: 98, workbookName: 'Sandwich Bread', workbookCategory: 'Cereals', brand: 'fresh choice', packSize: '400 g', foodGroupProxy: 'cereal', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 343, proteinG: 9.3, carbohydrateG: 72, fibreG: 6, fatG: 1.2,
  },
  CER_BURGER_BUN: {
    workbookRow: 106, workbookName: 'Burger Bun', workbookCategory: 'Cereals', packSize: '60 g', foodGroupProxy: 'cereal', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 343, proteinG: 9.3, carbohydrateG: 72, fibreG: 6, fatG: 1.2,
  },
  CER_CREAM_ROLL: {
    workbookRow: 105, workbookName: 'Cream Roll', workbookCategory: 'Cereals', packSize: '100 g', foodGroupProxy: 'cereal', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 343, proteinG: 9.3, carbohydrateG: 72, fibreG: 6, fatG: 1.2,
  },
  CER_CUP_CAKE: {
    workbookRow: 103, workbookName: 'Cup Cake', workbookCategory: 'Cereals', packSize: '100 g', foodGroupProxy: 'cereal', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 343, proteinG: 9.3, carbohydrateG: 72, fibreG: 6, fatG: 1.2,
  },
  CER_HAKKA_NOODLES: {
    workbookRow: 115, workbookName: 'Hakka Noodles', workbookCategory: 'Cereals', packSize: '1,000 g', foodGroupProxy: 'cereal', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 343, proteinG: 9.3, carbohydrateG: 72, fibreG: 6, fatG: 1.2,
  },
  CER_MAGGI: {
    workbookRow: 114, workbookName: 'Maggi', workbookCategory: 'Cereals', packSize: '280 g', foodGroupProxy: 'cereal', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 343, proteinG: 9.3, carbohydrateG: 72, fibreG: 6, fatG: 1.2,
  },
  CER_MAIDA: {
    workbookRow: 116, workbookName: 'All Purpose Flour / Maida', workbookCategory: 'Cereals', packSize: '500 g', foodGroupProxy: 'cereal', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 343, proteinG: 9.3, carbohydrateG: 72, fibreG: 6, fatG: 1.2,
  },
  CER_MILLETS: {
    workbookRow: 117, workbookName: 'Millets', workbookCategory: 'Cereals', foodGroupProxy: 'millet', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 330, proteinG: 9.9, carbohydrateG: 65, fibreG: 7, fatG: 2.7,
  },
  CER_PIZZA_BASE: {
    workbookRow: 104, workbookName: 'Pizza Base', workbookCategory: 'Cereals', packSize: '200 g', foodGroupProxy: 'cereal', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 343, proteinG: 9.3, carbohydrateG: 72, fibreG: 6, fatG: 1.2,
  },
  CER_RICE_HERITAGE: {
    workbookRow: 109, workbookName: 'Heritage Basmati Rice (Dawat)', workbookCategory: 'Cereals', packSize: '1,000 g', foodGroupProxy: 'cereal', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 343, proteinG: 9.3, carbohydrateG: 72, fibreG: 6, fatG: 1.2,
  },
  CER_RICE_ROZANA: {
    workbookRow: 108, workbookName: 'Rozana Basmati Rice (Dawat)', workbookCategory: 'Cereals', packSize: '1,000 g', foodGroupProxy: 'cereal', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 343, proteinG: 9.3, carbohydrateG: 72, fibreG: 6, fatG: 1.2,
  },
  CER_RICE_SONA_MASOORI: {
    workbookRow: 110, workbookName: 'Bell Rice Sona Masoori', workbookCategory: 'Cereals', packSize: '5,000 g', foodGroupProxy: 'pulse', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 323, proteinG: 22.8, carbohydrateG: 49, fibreG: 12, fatG: 3,
  },
  CER_RICE_SUPER_BASMATI: {
    workbookRow: 107, workbookName: 'Super Basmati Rice (Dawat)', workbookCategory: 'Cereals', packSize: '1,000 g', foodGroupProxy: 'cereal', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 343, proteinG: 9.3, carbohydrateG: 72, fibreG: 6, fatG: 1.2,
  },
  CER_RUSK: {
    workbookRow: 102, workbookName: 'Rusk', workbookCategory: 'Cereals', packSize: '250 g', foodGroupProxy: 'cereal', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 343, proteinG: 9.3, carbohydrateG: 72, fibreG: 6, fatG: 1.2,
  },
  CH_BLOCK: {
    workbookRow: 68, workbookName: 'Cheese Block', workbookCategory: 'Cheese / Nutramul', packSize: '200 g', foodGroupProxy: 'milk products', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 337, proteinG: 21.6, carbohydrateG: 16, fibreG: 0, fatG: 18.6,
  },
  CH_MOZZARELLA: {
    workbookRow: 70, workbookName: 'Cheese Mozzarella', workbookCategory: 'Cheese / Nutramul', packSize: '200 g', foodGroupProxy: 'milk products', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 337, proteinG: 21.6, carbohydrateG: 16, fibreG: 0, fatG: 18.6,
  },
  CH_PANEER: {
    workbookRow: 66, workbookName: 'Paneer', workbookCategory: 'Cheese / Nutramul', brand: 'Amul', packSize: '200 g', foodGroupProxy: 'milk products', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 337, proteinG: 21.6, carbohydrateG: 16, fibreG: 0, fatG: 18.6,
  },
  CH_SLICES: {
    workbookRow: 67, workbookName: 'Cheese Slices', workbookCategory: 'Cheese / Nutramul', packSize: '200 g', foodGroupProxy: 'milk products', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 337, proteinG: 21.6, carbohydrateG: 16, fibreG: 0, fatG: 18.6,
  },
  CH_SPREAD: {
    workbookRow: 69, workbookName: 'Cheese Spread', workbookCategory: 'Cheese / Nutramul', packSize: '200 g', foodGroupProxy: 'milk products', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 337, proteinG: 21.6, carbohydrateG: 16, fibreG: 0, fatG: 18.6,
  },
  CH_TIN: {
    workbookRow: 71, workbookName: 'Cheese TD / Tin Cheese', workbookCategory: 'Cheese / Nutramul', packSize: '400 g', foodGroupProxy: 'milk products', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 337, proteinG: 21.6, carbohydrateG: 16, fibreG: 0, fatG: 18.6,
  },
  CND_AMCHUR_MASALA: {
    workbookRow: 194, workbookName: 'Amchur Masala', workbookCategory: 'Condiments', packSize: '50 g', foodGroupProxy: 'spice', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 240, proteinG: 8.5, carbohydrateG: 31, fibreG: 17, fatG: 10,
  },
  CND_CHANA_MASALA: {
    workbookRow: 195, workbookName: 'Chana Masala', workbookCategory: 'Condiments', packSize: '50 g', foodGroupProxy: 'pulse', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 323, proteinG: 22.8, carbohydrateG: 49, fibreG: 12, fatG: 3,
  },
  CND_CHICKEN_MASALA: {
    workbookRow: 190, workbookName: 'Chicken Masala', workbookCategory: 'Condiments', packSize: '50 g', foodGroupProxy: 'meat', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 250, proteinG: 20.8, carbohydrateG: 0, fibreG: 0, fatG: 6.8,
  },
  CND_CHOLE_MASALA: {
    workbookRow: 193, workbookName: 'Chole Masala', workbookCategory: 'Condiments', packSize: '50 g', foodGroupProxy: 'spice', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 240, proteinG: 8.5, carbohydrateG: 31, fibreG: 17, fatG: 10,
  },
  CND_CORIANDER_POWDER: {
    workbookRow: 183, workbookName: 'Coriander Powder', workbookCategory: 'Condiments', packSize: '100 g', foodGroupProxy: 'spice', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 240, proteinG: 8.5, carbohydrateG: 31, fibreG: 17, fatG: 10,
  },
  CND_CORIANDER_SEEDS: {
    workbookRow: 199, workbookName: 'Coriander Seeds', workbookCategory: 'Condiments', packSize: '100 g', foodGroupProxy: 'spice', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 240, proteinG: 8.5, carbohydrateG: 31, fibreG: 17, fatG: 10,
  },
  CND_CUMIN_SEEDS: {
    workbookRow: 198, workbookName: 'Cumin Seeds', workbookCategory: 'Condiments', packSize: '100 g', foodGroupProxy: 'spice', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 240, proteinG: 8.5, carbohydrateG: 31, fibreG: 17, fatG: 10,
  },
  CND_EVEREST_CHILLY_POWDER: {
    workbookRow: 181, workbookName: 'Chilly Powder', workbookCategory: 'Condiments', brand: 'Everest', packSize: '100 g', foodGroupProxy: 'spice', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 240, proteinG: 8.5, carbohydrateG: 31, fibreG: 17, fatG: 10,
  },
  CND_GARAM_MASALA: {
    workbookRow: 191, workbookName: 'Garam Masala', workbookCategory: 'Condiments', packSize: '50 g', foodGroupProxy: 'spice', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 240, proteinG: 8.5, carbohydrateG: 31, fibreG: 17, fatG: 10,
  },
  CND_GARLIC: {
    workbookRow: 201, workbookName: 'Garlic 100g (dry condiment)', workbookCategory: 'Condiments', packSize: '100 g', foodGroupProxy: 'spice', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 240, proteinG: 8.5, carbohydrateG: 31, fibreG: 17, fatG: 10,
  },
  CND_KITCHEN_KING_MASALA: {
    workbookRow: 189, workbookName: 'Kitchen King Masala', workbookCategory: 'Condiments', packSize: '50 g', foodGroupProxy: 'spice', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 240, proteinG: 8.5, carbohydrateG: 31, fibreG: 17, fatG: 10,
  },
  CND_PANI_PURI_MASALA: {
    workbookRow: 185, workbookName: 'Pani Puri Masala', workbookCategory: 'Condiments', packSize: '50 g', foodGroupProxy: 'spice', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 240, proteinG: 8.5, carbohydrateG: 31, fibreG: 17, fatG: 10,
  },
  CND_PAV_BHAJI_MASALA: {
    workbookRow: 196, workbookName: 'Pav Bhaji Masala', workbookCategory: 'Condiments', packSize: '50 g', foodGroupProxy: 'spice', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 240, proteinG: 8.5, carbohydrateG: 31, fibreG: 17, fatG: 10,
  },
  CND_RASAM_MASALA: {
    workbookRow: 188, workbookName: 'Rasam Masala', workbookCategory: 'Condiments', packSize: '50 g', foodGroupProxy: 'spice', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 240, proteinG: 8.5, carbohydrateG: 31, fibreG: 17, fatG: 10,
  },
  CND_SABJI_MASALA: {
    workbookRow: 186, workbookName: 'Sabji Masala', workbookCategory: 'Condiments', packSize: '50 g', foodGroupProxy: 'spice', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 240, proteinG: 8.5, carbohydrateG: 31, fibreG: 17, fatG: 10,
  },
  CND_SAMBAR_MASALA: {
    workbookRow: 197, workbookName: 'Sambar Masala', workbookCategory: 'Condiments', packSize: '100 g', foodGroupProxy: 'spice', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 240, proteinG: 8.5, carbohydrateG: 31, fibreG: 17, fatG: 10,
  },
  CND_SHAHI_BIRYANI_MASALA: {
    workbookRow: 192, workbookName: 'Shahi Biryani Masala', workbookCategory: 'Condiments', packSize: '50 g', foodGroupProxy: 'spice', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 240, proteinG: 8.5, carbohydrateG: 31, fibreG: 17, fatG: 10,
  },
  CND_SHAHI_PANEER_MASALA: {
    workbookRow: 184, workbookName: 'Shahi Paneer Masala', workbookCategory: 'Condiments', packSize: '50 g', foodGroupProxy: 'milk products', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 337, proteinG: 21.6, carbohydrateG: 16, fibreG: 0, fatG: 18.6,
  },
  CND_TAMARIND: {
    workbookRow: 200, workbookName: 'Tamarind', workbookCategory: 'Condiments', packSize: '100 g', foodGroupProxy: 'spice', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 240, proteinG: 8.5, carbohydrateG: 31, fibreG: 17, fatG: 10,
  },
  CND_TANDOORI_MASALA: {
    workbookRow: 187, workbookName: 'Tandoori Masala', workbookCategory: 'Condiments', packSize: '50 g', foodGroupProxy: 'spice', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 240, proteinG: 8.5, carbohydrateG: 31, fibreG: 17, fatG: 10,
  },
  CND_TURMERIC_POWDER: {
    workbookRow: 182, workbookName: 'Turmeric Powder', workbookCategory: 'Condiments', packSize: '100 g', foodGroupProxy: 'spice', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 240, proteinG: 8.5, carbohydrateG: 31, fibreG: 17, fatG: 10,
  },
  COFFEE_COLUMBIAN: {
    workbookRow: 88, workbookName: 'Columbian Coffee', workbookCategory: 'Tea / Coffee', packSize: '50 g', basis: 'Not established',
  },
  DAL_CORNFLAKES: {
    workbookRow: 82, workbookName: 'Cornflakes', workbookCategory: 'Daliya', packSize: '500 g', foodGroupProxy: 'cereal', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 343, proteinG: 9.3, carbohydrateG: 72, fibreG: 6, fatG: 1.2,
  },
  DAL_CORN_FLOUR: {
    workbookRow: 79, workbookName: 'Corn Flour', workbookCategory: 'Daliya', packSize: '100 g', foodGroupProxy: 'cereal', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 343, proteinG: 9.3, carbohydrateG: 72, fibreG: 6, fatG: 1.2,
  },
  DAL_CUSTARD: {
    workbookRow: 80, workbookName: 'Custard Powder', workbookCategory: 'Daliya', packSize: '100 g', foodGroupProxy: 'cereal', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 343, proteinG: 9.3, carbohydrateG: 72, fibreG: 6, fatG: 1.2,
  },
  DAL_DALIYA: {
    workbookRow: 77, workbookName: 'Dalia', workbookCategory: 'Daliya', packSize: '500 g', foodGroupProxy: 'pulse', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 323, proteinG: 22.8, carbohydrateG: 49, fibreG: 12, fatG: 3,
  },
  DAL_L_CHANNA_DAL: {
    workbookRow: 162, workbookName: 'Channa Dal (loose)', workbookCategory: 'Dal', foodGroupProxy: 'pulse', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 323, proteinG: 22.8, carbohydrateG: 49, fibreG: 12, fatG: 3,
  },
  DAL_L_DAL_ARHAR: {
    workbookRow: 159, workbookName: 'Dal Arhar (loose)', workbookCategory: 'Dal', foodGroupProxy: 'pulse', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 323, proteinG: 22.8, carbohydrateG: 49, fibreG: 12, fatG: 3,
  },
  DAL_L_KABULI_CHANA: {
    workbookRow: 160, workbookName: 'Kabuli Chana (loose)', workbookCategory: 'Dal', foodGroupProxy: 'pulse', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 323, proteinG: 22.8, carbohydrateG: 49, fibreG: 12, fatG: 3,
  },
  DAL_L_MASOOR_DAL_WHOLE: {
    workbookRow: 164, workbookName: 'Masoor Dal whole (loose)', workbookCategory: 'Dal', foodGroupProxy: 'pulse', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 323, proteinG: 22.8, carbohydrateG: 49, fibreG: 12, fatG: 3,
  },
  DAL_L_MOONG_YELLOW: {
    workbookRow: 161, workbookName: 'Moong Yellow (loose)', workbookCategory: 'Dal', foodGroupProxy: 'pulse', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 323, proteinG: 22.8, carbohydrateG: 49, fibreG: 12, fatG: 3,
  },
  DAL_L_RAJMA: {
    workbookRow: 166, workbookName: 'Rajma (loose)', workbookCategory: 'Dal', foodGroupProxy: 'pulse', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 323, proteinG: 22.8, carbohydrateG: 49, fibreG: 12, fatG: 3,
  },
  DAL_L_URD_DAL_WHOLE: {
    workbookRow: 165, workbookName: 'Urd Dal whole (loose)', workbookCategory: 'Dal', foodGroupProxy: 'pulse', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 323, proteinG: 22.8, carbohydrateG: 49, fibreG: 12, fatG: 3,
  },
  DAL_L_URD_DAL_WITHOUT_SKIN: {
    workbookRow: 163, workbookName: 'Urd Dal without skin (loose)', workbookCategory: 'Dal', foodGroupProxy: 'pulse', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 323, proteinG: 22.8, carbohydrateG: 49, fibreG: 12, fatG: 3,
  },
  DAL_OATS: {
    workbookRow: 81, workbookName: 'Oats', workbookCategory: 'Daliya', packSize: '600 g', foodGroupProxy: 'cereal', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 343, proteinG: 9.3, carbohydrateG: 72, fibreG: 6, fatG: 1.2,
  },
  DAL_P_FORTUNE_BESAN: {
    workbookRow: 156, workbookName: 'Besan', workbookCategory: 'Dal', brand: 'Fortune', packSize: '500 g', foodGroupProxy: 'pulse', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 323, proteinG: 22.8, carbohydrateG: 49, fibreG: 12, fatG: 3,
  },
  DAL_P_TATA_ARHAR: {
    workbookRow: 148, workbookName: 'Arhar', workbookCategory: 'Dal', brand: 'Tata', packSize: '500 g', foodGroupProxy: 'pulse', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 323, proteinG: 22.8, carbohydrateG: 49, fibreG: 12, fatG: 3,
  },
  DAL_P_TATA_BLACK_CHANA: {
    workbookRow: 154, workbookName: 'Black Chana', workbookCategory: 'Dal', brand: 'Tata', packSize: '500 g', foodGroupProxy: 'pulse', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 323, proteinG: 22.8, carbohydrateG: 49, fibreG: 12, fatG: 3,
  },
  DAL_P_TATA_KABULI_CHANA: {
    workbookRow: 149, workbookName: 'Kabuli Chana', workbookCategory: 'Dal', brand: 'Tata', packSize: '500 g', foodGroupProxy: 'pulse', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 323, proteinG: 22.8, carbohydrateG: 49, fibreG: 12, fatG: 3,
  },
  DAL_P_TATA_MASOOR_SPLIT: {
    workbookRow: 153, workbookName: 'Masoor split', workbookCategory: 'Dal', brand: 'Tata', packSize: '500 g', foodGroupProxy: 'pulse', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 323, proteinG: 22.8, carbohydrateG: 49, fibreG: 12, fatG: 3,
  },
  DAL_P_TATA_MOONG_WHOLE: {
    workbookRow: 152, workbookName: 'Moong whole', workbookCategory: 'Dal', brand: 'Tata', packSize: '500 g', foodGroupProxy: 'pulse', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 323, proteinG: 22.8, carbohydrateG: 49, fibreG: 12, fatG: 3,
  },
  DAL_P_TATA_MOONG_WITHOUT_SKIN: {
    workbookRow: 150, workbookName: 'Moong without skin', workbookCategory: 'Dal', brand: 'Tata', packSize: '500 g', foodGroupProxy: 'pulse', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 323, proteinG: 22.8, carbohydrateG: 49, fibreG: 12, fatG: 3,
  },
  DAL_P_TATA_PEAS_DRIED: {
    workbookRow: 158, workbookName: 'Peas dried', workbookCategory: 'Dal', brand: 'Tata', packSize: '500 g', foodGroupProxy: 'pulse', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 323, proteinG: 22.8, carbohydrateG: 49, fibreG: 12, fatG: 3,
  },
  DAL_P_TATA_RAJMA: {
    workbookRow: 157, workbookName: 'Rajma', workbookCategory: 'Dal', brand: 'Tata', packSize: '500 g', foodGroupProxy: 'pulse', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 323, proteinG: 22.8, carbohydrateG: 49, fibreG: 12, fatG: 3,
  },
  DAL_P_TATA_URD_SPLIT: {
    workbookRow: 155, workbookName: 'Urd split', workbookCategory: 'Dal', brand: 'Tata', packSize: '500 g', foodGroupProxy: 'pulse', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 323, proteinG: 22.8, carbohydrateG: 49, fibreG: 12, fatG: 3,
  },
  DAL_P_TATA_URD_WITHOUT_SKIN: {
    workbookRow: 151, workbookName: 'Urd without skin', workbookCategory: 'Dal', brand: 'Tata', packSize: '500 g', foodGroupProxy: 'pulse', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 323, proteinG: 22.8, carbohydrateG: 49, fibreG: 12, fatG: 3,
  },
  DAL_SAGO: {
    workbookRow: 78, workbookName: 'Sago', workbookCategory: 'Daliya', packSize: '200 g', foodGroupProxy: 'cereal', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 343, proteinG: 9.3, carbohydrateG: 72, fibreG: 6, fatG: 1.2,
  },
  DAL_SEMOLINA: {
    workbookRow: 83, workbookName: 'Semolina', workbookCategory: 'Daliya', packSize: '85 g', foodGroupProxy: 'cereal', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 343, proteinG: 9.3, carbohydrateG: 72, fibreG: 6, fatG: 1.2,
  },
  EGGS_TABLE: {
    workbookRow: 15, workbookName: 'Eggs', workbookCategory: 'Eggs', foodGroupProxy: 'egg', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 147, proteinG: 13.3, carbohydrateG: 1, fibreG: 0, fatG: 10,
  },
  FRUIT_APPLE_SHIMLA: {
    workbookRow: 121, workbookName: 'Apple Shimla', workbookCategory: 'Fresh Fruits', foodGroupProxy: 'fruit', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 59, proteinG: 1, carbohydrateG: 11, fibreG: 2, fatG: 0.6,
  },
  FRUIT_APRICOT: {
    workbookRow: 137, workbookName: 'Apricot', workbookCategory: 'Fresh Fruits', foodGroupProxy: 'fruit', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 59, proteinG: 1, carbohydrateG: 11, fibreG: 2, fatG: 0.6,
  },
  FRUIT_BANANA_ROBUSTA: {
    workbookRow: 125, workbookName: 'Banana Robusta', workbookCategory: 'Fresh Fruits', foodGroupProxy: 'fruit', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 59, proteinG: 1, carbohydrateG: 11, fibreG: 2, fatG: 0.6,
  },
  FRUIT_CHICKOO: {
    workbookRow: 146, workbookName: 'Chickoo', workbookCategory: 'Fresh Fruits', foodGroupProxy: 'fruit', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 59, proteinG: 1, carbohydrateG: 11, fibreG: 2, fatG: 0.6,
  },
  FRUIT_CUSTARD_APPLE: {
    workbookRow: 122, workbookName: 'Custard Apple', workbookCategory: 'Fresh Fruits', foodGroupProxy: 'fruit', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 59, proteinG: 1, carbohydrateG: 11, fibreG: 2, fatG: 0.6,
  },
  FRUIT_DRAGON_FRUIT: {
    workbookRow: 145, workbookName: 'Dragon Fruit', workbookCategory: 'Fresh Fruits', foodGroupProxy: 'fruit', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 59, proteinG: 1, carbohydrateG: 11, fibreG: 2, fatG: 0.6,
  },
  FRUIT_DRY: {
    workbookRow: 140, workbookName: 'Dry Fruits', workbookCategory: 'Fresh Fruits', foodGroupProxy: 'nuts', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 516, proteinG: 17.5, carbohydrateG: 18, fibreG: 9, fatG: 41.3,
  },
  FRUIT_GRAPES_BLACK_S_L: {
    workbookRow: 126, workbookName: 'Grapes Black S/L', workbookCategory: 'Fresh Fruits', foodGroupProxy: 'fruit', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 59, proteinG: 1, carbohydrateG: 11, fibreG: 2, fatG: 0.6,
  },
  FRUIT_GRAPES_S_L: {
    workbookRow: 127, workbookName: 'Grapes S/L', workbookCategory: 'Fresh Fruits', foodGroupProxy: 'fruit', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 59, proteinG: 1, carbohydrateG: 11, fibreG: 2, fatG: 0.6,
  },
  FRUIT_KINNU: {
    workbookRow: 128, workbookName: 'Kinnu', workbookCategory: 'Fresh Fruits', foodGroupProxy: 'fruit', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 59, proteinG: 1, carbohydrateG: 11, fibreG: 2, fatG: 0.6,
  },
  FRUIT_KIWI: {
    workbookRow: 144, workbookName: 'Kiwi', workbookCategory: 'Fresh Fruits', foodGroupProxy: 'fruit', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 59, proteinG: 1, carbohydrateG: 11, fibreG: 2, fatG: 0.6,
  },
  FRUIT_LITCHI: {
    workbookRow: 138, workbookName: 'Litchi', workbookCategory: 'Fresh Fruits', foodGroupProxy: 'fruit', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 59, proteinG: 1, carbohydrateG: 11, fibreG: 2, fatG: 0.6,
  },
  FRUIT_MANGO_BANGANPALLI: {
    workbookRow: 123, workbookName: 'Mango Banganpalli', workbookCategory: 'Fresh Fruits', foodGroupProxy: 'fruit', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 59, proteinG: 1, carbohydrateG: 11, fibreG: 2, fatG: 0.6,
  },
  FRUIT_MANGO_DASHERI: {
    workbookRow: 135, workbookName: 'Mango Dasheri', workbookCategory: 'Fresh Fruits', foodGroupProxy: 'fruit', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 59, proteinG: 1, carbohydrateG: 11, fibreG: 2, fatG: 0.6,
  },
  FRUIT_MANGO_LANGRA: {
    workbookRow: 136, workbookName: 'Mango Langra', workbookCategory: 'Fresh Fruits', foodGroupProxy: 'fruit', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 59, proteinG: 1, carbohydrateG: 11, fibreG: 2, fatG: 0.6,
  },
  FRUIT_MUSAMBI_SWEET_LEMON: {
    workbookRow: 129, workbookName: 'Musambi/Sweet Lemon', workbookCategory: 'Fresh Fruits', foodGroupProxy: 'fruit', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 59, proteinG: 1, carbohydrateG: 11, fibreG: 2, fatG: 0.6,
  },
  FRUIT_MUSKMELON: {
    workbookRow: 130, workbookName: 'Muskmelon', workbookCategory: 'Fresh Fruits', foodGroupProxy: 'fruit', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 59, proteinG: 1, carbohydrateG: 11, fibreG: 2, fatG: 0.6,
  },
  FRUIT_ORANGE: {
    workbookRow: 124, workbookName: 'Orange', workbookCategory: 'Fresh Fruits', foodGroupProxy: 'fruit', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 59, proteinG: 1, carbohydrateG: 11, fibreG: 2, fatG: 0.6,
  },
  FRUIT_PAPAYA: {
    workbookRow: 131, workbookName: 'Papaya', workbookCategory: 'Fresh Fruits', foodGroupProxy: 'fruit', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 59, proteinG: 1, carbohydrateG: 11, fibreG: 2, fatG: 0.6,
  },
  FRUIT_PEARS: {
    workbookRow: 139, workbookName: 'Pears', workbookCategory: 'Fresh Fruits', foodGroupProxy: 'fruit', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 59, proteinG: 1, carbohydrateG: 11, fibreG: 2, fatG: 0.6,
  },
  FRUIT_PINEAPPLE: {
    workbookRow: 134, workbookName: 'Pineapple', workbookCategory: 'Fresh Fruits', foodGroupProxy: 'fruit', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 59, proteinG: 1, carbohydrateG: 11, fibreG: 2, fatG: 0.6,
  },
  FRUIT_PLUM: {
    workbookRow: 141, workbookName: 'Plum', workbookCategory: 'Fresh Fruits', foodGroupProxy: 'fruit', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 59, proteinG: 1, carbohydrateG: 11, fibreG: 2, fatG: 0.6,
  },
  FRUIT_POMEGRANATE: {
    workbookRow: 147, workbookName: 'Pomegranate', workbookCategory: 'Fresh Fruits', foodGroupProxy: 'fruit', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 59, proteinG: 1, carbohydrateG: 11, fibreG: 2, fatG: 0.6,
  },
  FRUIT_SOUR_LIME: {
    workbookRow: 132, workbookName: 'Sour Lime', workbookCategory: 'Fresh Fruits', foodGroupProxy: 'fruit', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 59, proteinG: 1, carbohydrateG: 11, fibreG: 2, fatG: 0.6,
  },
  FRUIT_STRAWBERRY: {
    workbookRow: 142, workbookName: 'Strawberry', workbookCategory: 'Fresh Fruits', foodGroupProxy: 'fruit', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 59, proteinG: 1, carbohydrateG: 11, fibreG: 2, fatG: 0.6,
  },
  FRUIT_THAI_GUAVA: {
    workbookRow: 143, workbookName: 'Thai Guava', workbookCategory: 'Fresh Fruits', foodGroupProxy: 'fruit', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 59, proteinG: 1, carbohydrateG: 11, fibreG: 2, fatG: 0.6,
  },
  FRUIT_WATERMELON: {
    workbookRow: 133, workbookName: 'Watermelon', workbookCategory: 'Fresh Fruits', foodGroupProxy: 'fruit', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 59, proteinG: 1, carbohydrateG: 11, fibreG: 2, fatG: 0.6,
  },
  GARLIC_FRESH: {
    workbookRow: 5, workbookName: 'Garlic (Fresh)', workbookCategory: 'Onion / Garlic', foodGroupProxy: 'vegetable', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 35, proteinG: 1.8, carbohydrateG: 5, fibreG: 2, fatG: 0.4,
  },
  GMW_AJWAIN: {
    workbookRow: 177, workbookName: 'Ajwain', workbookCategory: 'Garam Masala (Whole)', packSize: '50 g', foodGroupProxy: 'spice', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 240, proteinG: 8.5, carbohydrateG: 31, fibreG: 17, fatG: 10,
  },
  GMW_ANISE_SEEDS: {
    workbookRow: 171, workbookName: 'Anise Seeds', workbookCategory: 'Garam Masala (Whole)', packSize: '50 g', foodGroupProxy: 'spice', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 240, proteinG: 8.5, carbohydrateG: 31, fibreG: 17, fatG: 10,
  },
  GMW_ASAFOETIDA: {
    workbookRow: 175, workbookName: 'Asafoetida', workbookCategory: 'Garam Masala (Whole)', packSize: '50 g', foodGroupProxy: 'spice', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 240, proteinG: 8.5, carbohydrateG: 31, fibreG: 17, fatG: 10,
  },
  GMW_BAY_LEAF: {
    workbookRow: 172, workbookName: 'Bay Leaf', workbookCategory: 'Garam Masala (Whole)', packSize: '50 g', foodGroupProxy: 'spice', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 240, proteinG: 8.5, carbohydrateG: 31, fibreG: 17, fatG: 10,
  },
  GMW_CINNAMON_STICK: {
    workbookRow: 180, workbookName: 'Cinnamon Stick', workbookCategory: 'Garam Masala (Whole)', packSize: '50 g', foodGroupProxy: 'spice', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 240, proteinG: 8.5, carbohydrateG: 31, fibreG: 17, fatG: 10,
  },
  GMW_CLOVES: {
    workbookRow: 170, workbookName: 'Cloves', workbookCategory: 'Garam Masala (Whole)', packSize: '50 g', foodGroupProxy: 'spice', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 240, proteinG: 8.5, carbohydrateG: 31, fibreG: 17, fatG: 10,
  },
  GMW_FENUGREEK: {
    workbookRow: 173, workbookName: 'Fenugreek', workbookCategory: 'Garam Masala (Whole)', packSize: '50 g', foodGroupProxy: 'spice', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 240, proteinG: 8.5, carbohydrateG: 31, fibreG: 17, fatG: 10,
  },
  GMW_KASHMIRI_CHILLI: {
    workbookRow: 178, workbookName: 'Kashmiri Chilli', workbookCategory: 'Garam Masala (Whole)', packSize: '100 g', foodGroupProxy: 'spice', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 240, proteinG: 8.5, carbohydrateG: 31, fibreG: 17, fatG: 10,
  },
  GMW_LARGE_CARDAMOM: {
    workbookRow: 179, workbookName: 'Large Cardamom', workbookCategory: 'Garam Masala (Whole)', packSize: '50 g', foodGroupProxy: 'spice', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 240, proteinG: 8.5, carbohydrateG: 31, fibreG: 17, fatG: 10,
  },
  GMW_POPPY_SEEDS: {
    workbookRow: 174, workbookName: 'Poppy Seeds', workbookCategory: 'Garam Masala (Whole)', packSize: '50 g', foodGroupProxy: 'spice', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 240, proteinG: 8.5, carbohydrateG: 31, fibreG: 17, fatG: 10,
  },
  GMW_WHOLE_PEPPER: {
    workbookRow: 176, workbookName: 'Whole Pepper', workbookCategory: 'Garam Masala (Whole)', packSize: '50 g', foodGroupProxy: 'spice', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 240, proteinG: 8.5, carbohydrateG: 31, fibreG: 17, fatG: 10,
  },
  JAGGERY: {
    workbookRow: 3, workbookName: 'Jaggery', workbookCategory: 'Sugar / Jaggery', packSize: '500 g', foodGroupProxy: 'sugar', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 400, proteinG: 0, carbohydrateG: 100, fibreG: 0, fatG: 0,
  },
  MEAT_CHICKEN: {
    workbookRow: 120, workbookName: 'Chicken / Fowl', workbookCategory: 'Meat', packSize: '1,000 g', foodGroupProxy: 'meat', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 250, proteinG: 20.8, carbohydrateG: 0, fibreG: 0, fatG: 6.8,
  },
  MEAT_FISH: {
    workbookRow: 119, workbookName: 'Fish', workbookCategory: 'Meat', foodGroupProxy: 'fish', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 110, proteinG: 18.4, carbohydrateG: 2, fibreG: 0, fatG: 3.1,
  },
  MEAT_MUTTON: {
    workbookRow: 118, workbookName: 'Meat', workbookCategory: 'Meat', packSize: '1,000 g', foodGroupProxy: 'meat', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 250, proteinG: 20.8, carbohydrateG: 0, fibreG: 0, fatG: 6.8,
  },
  MILK_FRESH_COUPON: {
    workbookRow: 168, workbookName: 'Fresh Milk (500 ml coupon)', workbookCategory: 'Milk', foodGroupProxy: 'milk', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 72, proteinG: 3.1, carbohydrateG: 5, fibreG: 0, fatG: 4.2,
  },
  MILK_TD: {
    workbookRow: 169, workbookName: 'Milk TD / Milkmaid', workbookCategory: 'Milk', packSize: '400 g', foodGroupProxy: 'milk', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 72, proteinG: 3.1, carbohydrateG: 5, fibreG: 0, fatG: 4.2,
  },
  NU_AMULPRO: {
    workbookRow: 72, workbookName: 'Amulpro', workbookCategory: 'Cheese / Nutramul', packSize: '500 g', foodGroupProxy: 'milk products', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 337, proteinG: 21.6, carbohydrateG: 16, fibreG: 0, fatG: 18.6,
  },
  NU_BOOST: {
    workbookRow: 75, workbookName: 'Boost', workbookCategory: 'Cheese / Nutramul', packSize: '500 g', foodGroupProxy: 'milk products', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 337, proteinG: 21.6, carbohydrateG: 16, fibreG: 0, fatG: 18.6,
  },
  NU_BOURNVITA: {
    workbookRow: 74, workbookName: 'Bournavita', workbookCategory: 'Cheese / Nutramul', packSize: '500 g', foodGroupProxy: 'milk products', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 337, proteinG: 21.6, carbohydrateG: 16, fibreG: 0, fatG: 18.6,
  },
  NU_HORLICKS: {
    workbookRow: 73, workbookName: 'Horlicks', workbookCategory: 'Cheese / Nutramul', packSize: '500 g', foodGroupProxy: 'milk products', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 337, proteinG: 21.6, carbohydrateG: 16, fibreG: 0, fatG: 18.6,
  },
  NU_MUESLI: {
    workbookRow: 76, workbookName: 'Muesli', workbookCategory: 'Cheese / Nutramul', brand: 'Tata', foodGroupProxy: 'cereal', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 343, proteinG: 9.3, carbohydrateG: 72, fibreG: 6, fatG: 1.2,
  },
  OIL_GROUNDNUT: {
    workbookRow: 6, workbookName: 'Groundnut Oil', workbookCategory: 'Hydrogenated Oil', packSize: '1,000 g', foodGroupProxy: 'oil', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 900, proteinG: 0, carbohydrateG: 0, fibreG: 0, fatG: 100,
  },
  OIL_MUSTARD_1000: {
    workbookRow: 11, workbookName: 'Mustard Oil', workbookCategory: 'Hydrogenated Oil', packSize: '1,000 g', foodGroupProxy: 'oil', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 900, proteinG: 0, carbohydrateG: 0, fibreG: 0, fatG: 100,
  },
  OIL_MUSTARD_500: {
    workbookRow: 10, workbookName: 'Mustard Oil', workbookCategory: 'Hydrogenated Oil', packSize: '500 g', foodGroupProxy: 'oil', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 900, proteinG: 0, carbohydrateG: 0, fibreG: 0, fatG: 100,
  },
  OIL_RICE_BRAN: {
    workbookRow: 7, workbookName: 'Rice Bran Oil', workbookCategory: 'Hydrogenated Oil', packSize: '1,000 g', foodGroupProxy: 'oil', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 900, proteinG: 0, carbohydrateG: 0, fibreG: 0, fatG: 100,
  },
  OIL_SUNFLOWER_1000: {
    workbookRow: 9, workbookName: 'Sunflower Refined Oil', workbookCategory: 'Hydrogenated Oil', packSize: '1,000 g', foodGroupProxy: 'oil', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 900, proteinG: 0, carbohydrateG: 0, fibreG: 0, fatG: 100,
  },
  OIL_SUNFLOWER_500: {
    workbookRow: 8, workbookName: 'Sunflower Refined Oil', workbookCategory: 'Hydrogenated Oil', packSize: '500 g', foodGroupProxy: 'oil', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 900, proteinG: 0, carbohydrateG: 0, fibreG: 0, fatG: 100,
  },
  ONION_FRESH: {
    workbookRow: 4, workbookName: 'Onion', workbookCategory: 'Onion / Garlic', foodGroupProxy: 'vegetable', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 35, proteinG: 1.8, carbohydrateG: 5, fibreG: 2, fatG: 0.4,
  },
  POTATO_ALT_VEGETABLES: {
    workbookRow: 91, workbookName: 'Fresh Vegetables (in lieu of potato)', workbookCategory: 'Potato', foodGroupProxy: 'root', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 59, proteinG: 1.5, carbohydrateG: 12, fibreG: 2, fatG: 0.2,
  },
  POTATO_FRESH: {
    workbookRow: 90, workbookName: 'Potato', workbookCategory: 'Potato', foodGroupProxy: 'root', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 59, proteinG: 1.5, carbohydrateG: 12, fibreG: 2, fatG: 0.2,
  },
  SALT_TABLE: {
    workbookRow: 16, workbookName: 'Salt', workbookCategory: 'Salt', packSize: '500 g', basis: 'Not established',
  },
  SUGAR: {
    workbookRow: 2, workbookName: 'Sugar', workbookCategory: 'Sugar / Jaggery', packSize: '1,000 g', foodGroupProxy: 'sugar', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 400, proteinG: 0, carbohydrateG: 100, fibreG: 0, fatG: 0,
  },
  TEA_CHAHAT: {
    workbookRow: 86, workbookName: 'Chahat Society Tea', workbookCategory: 'Tea / Coffee', packSize: '250 g', basis: 'Not established',
  },
  TEA_WAGH_BAKRI: {
    workbookRow: 87, workbookName: 'Elaichi Tea', workbookCategory: 'Tea / Coffee', brand: 'Wagh Bakri', packSize: '250 g', basis: 'Not established',
  },
  VEG_ARVI: {
    workbookRow: 21, workbookName: 'Arvi', workbookCategory: 'Fresh Vegetables', foodGroupProxy: 'root', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 59, proteinG: 1.5, carbohydrateG: 12, fibreG: 2, fatG: 0.2,
  },
  VEG_ASPARAGUS: {
    workbookRow: 22, workbookName: 'Asparagus', workbookCategory: 'Fresh Vegetables', foodGroupProxy: 'vegetable', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 35, proteinG: 1.8, carbohydrateG: 5, fibreG: 2, fatG: 0.4,
  },
  VEG_BABY_CORN: {
    workbookRow: 23, workbookName: 'Baby Corn', workbookCategory: 'Fresh Vegetables', foodGroupProxy: 'vegetable', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 35, proteinG: 1.8, carbohydrateG: 5, fibreG: 2, fatG: 0.4,
  },
  VEG_BEANS_FRENCH: {
    workbookRow: 24, workbookName: 'Beans French', workbookCategory: 'Fresh Vegetables', foodGroupProxy: 'vegetable', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 35, proteinG: 1.8, carbohydrateG: 5, fibreG: 2, fatG: 0.4,
  },
  VEG_BEANS_LONG: {
    workbookRow: 25, workbookName: 'Beans Long', workbookCategory: 'Fresh Vegetables', foodGroupProxy: 'vegetable', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 35, proteinG: 1.8, carbohydrateG: 5, fibreG: 2, fatG: 0.4,
  },
  VEG_BEETROOT: {
    workbookRow: 26, workbookName: 'Beetroot', workbookCategory: 'Fresh Vegetables', foodGroupProxy: 'root', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 59, proteinG: 1.5, carbohydrateG: 12, fibreG: 2, fatG: 0.2,
  },
  VEG_BITTER_GUARD: {
    workbookRow: 27, workbookName: 'Bitter Guard', workbookCategory: 'Fresh Vegetables', foodGroupProxy: 'vegetable', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 35, proteinG: 1.8, carbohydrateG: 5, fibreG: 2, fatG: 0.4,
  },
  VEG_BOTTLE_GUARD: {
    workbookRow: 28, workbookName: 'Bottle Guard', workbookCategory: 'Fresh Vegetables', packSize: '600 g', foodGroupProxy: 'vegetable', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 35, proteinG: 1.8, carbohydrateG: 5, fibreG: 2, fatG: 0.4,
  },
  VEG_BRINJAL_PURPLE_AND_GREEN: {
    workbookRow: 29, workbookName: 'Brinjal (Purple & Green)', workbookCategory: 'Fresh Vegetables', foodGroupProxy: 'vegetable', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 35, proteinG: 1.8, carbohydrateG: 5, fibreG: 2, fatG: 0.4,
  },
  VEG_BROCCOLI: {
    workbookRow: 30, workbookName: 'Broccoli', workbookCategory: 'Fresh Vegetables', packSize: '350 g', foodGroupProxy: 'vegetable', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 35, proteinG: 1.8, carbohydrateG: 5, fibreG: 2, fatG: 0.4,
  },
  VEG_CABBAGE: {
    workbookRow: 32, workbookName: 'Cabbage', workbookCategory: 'Fresh Vegetables', packSize: '500 g', foodGroupProxy: 'vegetable', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 35, proteinG: 1.8, carbohydrateG: 5, fibreG: 2, fatG: 0.4,
  },
  VEG_CAPSICUM: {
    workbookRow: 33, workbookName: 'Capsicum', workbookCategory: 'Fresh Vegetables', foodGroupProxy: 'vegetable', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 35, proteinG: 1.8, carbohydrateG: 5, fibreG: 2, fatG: 0.4,
  },
  VEG_CAPSICUM_RED: {
    workbookRow: 34, workbookName: 'Capsicum Red', workbookCategory: 'Fresh Vegetables', foodGroupProxy: 'vegetable', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 35, proteinG: 1.8, carbohydrateG: 5, fibreG: 2, fatG: 0.4,
  },
  VEG_CAPSICUM_YELLOW: {
    workbookRow: 35, workbookName: 'Capsicum Yellow', workbookCategory: 'Fresh Vegetables', foodGroupProxy: 'vegetable', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 35, proteinG: 1.8, carbohydrateG: 5, fibreG: 2, fatG: 0.4,
  },
  VEG_CARROT_COUNTRY: {
    workbookRow: 36, workbookName: 'Carrot Country', workbookCategory: 'Fresh Vegetables', foodGroupProxy: 'root', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 59, proteinG: 1.5, carbohydrateG: 12, fibreG: 2, fatG: 0.2,
  },
  VEG_CARROT_RED: {
    workbookRow: 37, workbookName: 'Carrot Red', workbookCategory: 'Fresh Vegetables', foodGroupProxy: 'root', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 59, proteinG: 1.5, carbohydrateG: 12, fibreG: 2, fatG: 0.2,
  },
  VEG_CAULIFLOWER: {
    workbookRow: 38, workbookName: 'Cauliflower', workbookCategory: 'Fresh Vegetables', packSize: '400 g', foodGroupProxy: 'vegetable', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 35, proteinG: 1.8, carbohydrateG: 5, fibreG: 2, fatG: 0.4,
  },
  VEG_CHILLY_GREEN: {
    workbookRow: 39, workbookName: 'Chilly Green', workbookCategory: 'Fresh Vegetables', foodGroupProxy: 'spice', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 240, proteinG: 8.5, carbohydrateG: 31, fibreG: 17, fatG: 10,
  },
  VEG_CLUSTER_BEANS: {
    workbookRow: 40, workbookName: 'Cluster Beans', workbookCategory: 'Fresh Vegetables', foodGroupProxy: 'vegetable', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 35, proteinG: 1.8, carbohydrateG: 5, fibreG: 2, fatG: 0.4,
  },
  VEG_CORIANDER_GREEN: {
    workbookRow: 41, workbookName: 'Coriander Green', workbookCategory: 'Fresh Vegetables', foodGroupProxy: 'leafy', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 45, proteinG: 3.8, carbohydrateG: 5, fibreG: 2, fatG: 0.7,
  },
  VEG_COWPEAS: {
    workbookRow: 42, workbookName: 'Cowpeas', workbookCategory: 'Fresh Vegetables', foodGroupProxy: 'pulse', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 323, proteinG: 22.8, carbohydrateG: 49, fibreG: 12, fatG: 3,
  },
  VEG_CUCUMBER: {
    workbookRow: 43, workbookName: 'Cucumber', workbookCategory: 'Fresh Vegetables', foodGroupProxy: 'vegetable', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 35, proteinG: 1.8, carbohydrateG: 5, fibreG: 2, fatG: 0.4,
  },
  VEG_CURRY_LEAVES: {
    workbookRow: 44, workbookName: 'Curry Leaves', workbookCategory: 'Fresh Vegetables', foodGroupProxy: 'leafy', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 45, proteinG: 3.8, carbohydrateG: 5, fibreG: 2, fatG: 0.7,
  },
  VEG_DRUM_STICK: {
    workbookRow: 45, workbookName: 'Drum Stick', workbookCategory: 'Fresh Vegetables', foodGroupProxy: 'vegetable', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 35, proteinG: 1.8, carbohydrateG: 5, fibreG: 2, fatG: 0.4,
  },
  VEG_GINGER_GREEN: {
    workbookRow: 46, workbookName: 'Ginger Green', workbookCategory: 'Fresh Vegetables', foodGroupProxy: 'vegetable', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 35, proteinG: 1.8, carbohydrateG: 5, fibreG: 2, fatG: 0.4,
  },
  VEG_KHOL_KHOL: {
    workbookRow: 47, workbookName: 'Khol Khol', workbookCategory: 'Fresh Vegetables', foodGroupProxy: 'vegetable', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 35, proteinG: 1.8, carbohydrateG: 5, fibreG: 2, fatG: 0.4,
  },
  VEG_KUNDRI: {
    workbookRow: 48, workbookName: 'Kundri', workbookCategory: 'Fresh Vegetables', foodGroupProxy: 'vegetable', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 35, proteinG: 1.8, carbohydrateG: 5, fibreG: 2, fatG: 0.4,
  },
  VEG_LADIE_S_FINGER: {
    workbookRow: 49, workbookName: 'Ladie\'s Finger', workbookCategory: 'Fresh Vegetables', foodGroupProxy: 'vegetable', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 35, proteinG: 1.8, carbohydrateG: 5, fibreG: 2, fatG: 0.4,
  },
  VEG_LEEK: {
    workbookRow: 50, workbookName: 'Leek', workbookCategory: 'Fresh Vegetables', foodGroupProxy: 'leafy', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 45, proteinG: 3.8, carbohydrateG: 5, fibreG: 2, fatG: 0.7,
  },
  VEG_MARROW: {
    workbookRow: 51, workbookName: 'Marrow', workbookCategory: 'Fresh Vegetables', foodGroupProxy: 'vegetable', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 35, proteinG: 1.8, carbohydrateG: 5, fibreG: 2, fatG: 0.4,
  },
  VEG_MINT_GREEN: {
    workbookRow: 52, workbookName: 'Mint Green', workbookCategory: 'Fresh Vegetables', foodGroupProxy: 'leafy', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 45, proteinG: 3.8, carbohydrateG: 5, fibreG: 2, fatG: 0.7,
  },
  VEG_MUSHROOM: {
    workbookRow: 53, workbookName: 'Mushroom', workbookCategory: 'Fresh Vegetables', packSize: '200 g', foodGroupProxy: 'vegetable', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 35, proteinG: 1.8, carbohydrateG: 5, fibreG: 2, fatG: 0.4,
  },
  VEG_PARWAL: {
    workbookRow: 54, workbookName: 'Parwal', workbookCategory: 'Fresh Vegetables', foodGroupProxy: 'vegetable', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 35, proteinG: 1.8, carbohydrateG: 5, fibreG: 2, fatG: 0.4,
  },
  VEG_PEAS_GREEN: {
    workbookRow: 55, workbookName: 'Peas Green', workbookCategory: 'Fresh Vegetables', foodGroupProxy: 'vegetable', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 35, proteinG: 1.8, carbohydrateG: 5, fibreG: 2, fatG: 0.4,
  },
  VEG_PUMPKIN: {
    workbookRow: 56, workbookName: 'Pumpkin', workbookCategory: 'Fresh Vegetables', foodGroupProxy: 'vegetable', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 35, proteinG: 1.8, carbohydrateG: 5, fibreG: 2, fatG: 0.4,
  },
  VEG_RADISH: {
    workbookRow: 57, workbookName: 'Radish', workbookCategory: 'Fresh Vegetables', foodGroupProxy: 'root', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 59, proteinG: 1.5, carbohydrateG: 12, fibreG: 2, fatG: 0.2,
  },
  VEG_RIBBED_GUARD: {
    workbookRow: 58, workbookName: 'Ribbed Guard', workbookCategory: 'Fresh Vegetables', foodGroupProxy: 'vegetable', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 35, proteinG: 1.8, carbohydrateG: 5, fibreG: 2, fatG: 0.4,
  },
  VEG_SNAKE_GUARD: {
    workbookRow: 59, workbookName: 'Snake Guard', workbookCategory: 'Fresh Vegetables', foodGroupProxy: 'vegetable', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 35, proteinG: 1.8, carbohydrateG: 5, fibreG: 2, fatG: 0.4,
  },
  VEG_SPINACH_COUNTRY: {
    workbookRow: 60, workbookName: 'Spinach Country', workbookCategory: 'Fresh Vegetables', foodGroupProxy: 'leafy', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 45, proteinG: 3.8, carbohydrateG: 5, fibreG: 2, fatG: 0.7,
  },
  VEG_SPRING_ONION: {
    workbookRow: 61, workbookName: 'Spring Onion', workbookCategory: 'Fresh Vegetables', foodGroupProxy: 'leafy', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 45, proteinG: 3.8, carbohydrateG: 5, fibreG: 2, fatG: 0.7,
  },
  VEG_TINDA: {
    workbookRow: 62, workbookName: 'Tinda', workbookCategory: 'Fresh Vegetables', foodGroupProxy: 'vegetable', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 35, proteinG: 1.8, carbohydrateG: 5, fibreG: 2, fatG: 0.4,
  },
  VEG_TOMATO_RED: {
    workbookRow: 63, workbookName: 'Tomato Red', workbookCategory: 'Fresh Vegetables', foodGroupProxy: 'vegetable', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 35, proteinG: 1.8, carbohydrateG: 5, fibreG: 2, fatG: 0.4,
  },
  VEG_TURNIP: {
    workbookRow: 64, workbookName: 'Turnip', workbookCategory: 'Fresh Vegetables', foodGroupProxy: 'root', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 59, proteinG: 1.5, carbohydrateG: 12, fibreG: 2, fatG: 0.2,
  },
  VEG_ZIMIKAND: {
    workbookRow: 65, workbookName: 'Zimikand', workbookCategory: 'Fresh Vegetables', foodGroupProxy: 'root', basis: 'Per 100 g raw weight — broad food-group average', source: 'ICMR-NIN Dietary Guidelines for Indians 2024, Table 1.3', energyKcal: 59, proteinG: 1.5, carbohydrateG: 12, fibreG: 2, fatG: 0.2,
  },
};

/**
 * The preliminary record for a provision, or null.
 *
 * Returns null for everything while `PUBLISH_PRELIMINARY_GROUP_AVERAGES` is
 * false. It exists so that any future caller goes through a gate rather than
 * reading the map, in the same way `nutritionFor` guards the IFCT records.
 */
export function preliminaryNutritionFor(code: string): PreliminaryNutritionRecord | null {
  if (!PUBLISH_PRELIMINARY_GROUP_AVERAGES) return null;
  return rikNutritionPreliminary[code] ?? null;
}
