import {
  hasItemLevelRecord,
  type NutritionRecord,
} from './rikNutrition';
import { APPROVED_TYPICAL_VALUES } from './rikNutritionApprovedValues';

/**
 * THE APPROVED TYPICAL-VALUE RECORDS, AND THE GATE THAT RELEASES THEM.
 *
 * =====================================================================
 * WHAT IS APPROVED, AND BY WHOSE DECISION
 * =====================================================================
 *
 * Approximate typical values from the workbook are approved for customer
 * display for every suitable, confidently matched RIK product, so that
 * customers stop seeing "unavailable" wherever a reasonable figure exists.
 * Broad food-group averages are acceptable under that decision, and a product
 * is not excluded merely for being packaged or branded.
 *
 * 101 provisions qualify. The decision does NOT extend to:
 *
 *   - giving a product the average of a food group it does not belong to
 *     (ghee is not mixed dairy, bread is not flour, a masala is not the dish
 *     it is named after);
 *   - guessing at a product that cannot be matched reliably;
 *   - publishing a record the workbook left without established values;
 *   - replacing a measured, item-level value with a broad average.
 *
 * The 28 workbook records that had a usable figure and were still not approved
 * are listed with a written reason each in ./rikNutritionTypicalValueReview,
 * alongside the food-group rationales. That module is test-only: the reasoning
 * is worth keeping and is of no use to a customer's browser.
 *
 * =====================================================================
 * THREE GATES, THREE SCOPES, NO SHARED SWITCHES
 * =====================================================================
 *
 * `isPublishable` + `nutritionFor`   govern the rikNutrition store, by
 *                                    evidence category. Still refusing
 *                                    everything: the composition-table licence
 *                                    position is unresolved.
 * `preliminaryNutritionFor`          governs the 184-record workbook. Still
 *                                    closed.
 * this module                        governs these 101 provisions, from a
 *                                    standalone data module that ships only
 *                                    them.
 *
 * A record reached through this module would be REFUSED by `isPublishable`,
 * because `PUBLICATION_POLICY['approximate-reference']` is 'never'. That is
 * not a leak and not an oversight — the category stays refused so that no
 * approximate figure can reach a customer except through the explicit
 * allowlist below, and a test asserts the inconsistency so nobody later
 * "fixes" it by widening the category rule.
 *
 * =====================================================================
 * THE MEASURED RECORDS ARE NEVER DOWNGRADED
 * =====================================================================
 *
 * 51 provisions hold a measured, item-level record. None is on this list, and
 * `approvedTypicalNutritionFor` refuses them a second time at runtime via
 * `hasItemLevelRecord`. Over those 51 the group average is out by a median 38%
 * and by up to 467% — green chilli reads 240 kcal against a measured 42.3 —
 * so falling back to an average would publish the figure already known to be
 * wrong. Those provisions stay unavailable until their own values are cleared.
 *
 * ADDING TO THIS LIST IS A REVIEWED DECISION. It is a hand-written map, not a
 * filter over the workbook, precisely so that no record can arrive here as a
 * side effect of someone changing a rule somewhere else.
 */

/**
 * PUBLICATION CONTROL for the approved typical values. Dedicated to the
 * provisions on the allowlist below and nothing else.
 *
 * It does not release the composition-table records (see
 * PUBLISH_COMPOSITION_TABLE_VALUES, still false) and it does not release the
 * rest of the workbook (see PUBLISH_PRELIMINARY_GROUP_AVERAGES, still false).
 */
export const PUBLISH_APPROVED_TYPICAL_VALUES = true;

/**
 * The customer-facing qualifier shown against every one of these figures.
 *
 * Exported so the screen and its tests use one string, and so it cannot drift
 * into language that implies a measurement of the specific product.
 */
export const TYPICAL_VALUES_DISCLAIMER =
  'Approximate typical nutrition values per 100 g. Actual values may vary.';

/**
 * Provision code to the food group whose average it carries. THE LIST IS THE
 * POLICY: a provision absent from this map cannot be published by this
 * pathway, whatever the workbook holds for it.
 *
 * The food group recorded here is the workbook's own `foodGroupProxy` for that
 * record — a test asserts it, so this map can never quietly reassign a product
 * to a different group than the workbook put it in. Why each group's average
 * is accepted is in TYPICAL_VALUE_GROUP_RATIONALE in the review module.
 */
export const APPROVED_TYPICAL_VALUE_PROVISIONS: Readonly<Record<string, string>> = {
  OIL_GROUNDNUT: 'oil',
  OIL_RICE_BRAN: 'oil',
  OIL_SUNFLOWER_500: 'oil',
  OIL_SUNFLOWER_1000: 'oil',
  OIL_MUSTARD_500: 'oil',
  OIL_MUSTARD_1000: 'oil',
  SUGAR: 'sugar',
  JAGGERY: 'sugar',
  EGGS_TABLE: 'egg',
  MILK_FRESH_COUPON: 'milk',
  CH_PANEER: 'milk products',
  CH_SLICES: 'milk products',
  CH_BLOCK: 'milk products',
  CH_SPREAD: 'milk products',
  CH_MOZZARELLA: 'milk products',
  CH_TIN: 'milk products',
  MEAT_MUTTON: 'meat',
  MEAT_CHICKEN: 'meat',
  MEAT_FISH: 'fish',
  DAL_SAGO: 'cereal',
  DAL_CORN_FLOUR: 'cereal',
  DAL_CUSTARD: 'cereal',
  DAL_OATS: 'cereal',
  DAL_CORNFLAKES: 'cereal',
  CER_RICE_SUPER_BASMATI: 'cereal',
  CER_RICE_ROZANA: 'cereal',
  CER_RICE_HERITAGE: 'cereal',
  CER_ATTA_AASHIRVAAD: 'cereal',
  CER_ATTA_PILLSBURY: 'cereal',
  CER_ATTA_AMUL: 'cereal',
  CER_MILLETS: 'millet',
  DAL_P_TATA_ARHAR: 'pulse',
  DAL_P_TATA_KABULI_CHANA: 'pulse',
  DAL_P_TATA_MOONG_WITHOUT_SKIN: 'pulse',
  DAL_P_TATA_URD_WITHOUT_SKIN: 'pulse',
  DAL_P_TATA_MOONG_WHOLE: 'pulse',
  DAL_P_TATA_MASOOR_SPLIT: 'pulse',
  DAL_P_TATA_BLACK_CHANA: 'pulse',
  DAL_P_TATA_URD_SPLIT: 'pulse',
  DAL_P_FORTUNE_BESAN: 'pulse',
  DAL_P_TATA_RAJMA: 'pulse',
  DAL_P_TATA_PEAS_DRIED: 'pulse',
  DAL_L_DAL_ARHAR: 'pulse',
  DAL_L_KABULI_CHANA: 'pulse',
  DAL_L_MOONG_YELLOW: 'pulse',
  DAL_L_CHANNA_DAL: 'pulse',
  DAL_L_URD_DAL_WITHOUT_SKIN: 'pulse',
  DAL_L_MASOOR_DAL_WHOLE: 'pulse',
  DAL_L_URD_DAL_WHOLE: 'pulse',
  DAL_L_RAJMA: 'pulse',
  VEG_ASPARAGUS: 'vegetable',
  VEG_BEANS_FRENCH: 'vegetable',
  VEG_BEANS_LONG: 'vegetable',
  VEG_BITTER_GUARD: 'vegetable',
  VEG_BOTTLE_GUARD: 'vegetable',
  VEG_BROCCOLI: 'vegetable',
  VEG_CABBAGE: 'vegetable',
  VEG_CUCUMBER: 'vegetable',
  VEG_KUNDRI: 'vegetable',
  VEG_MARROW: 'vegetable',
  VEG_MUSHROOM: 'vegetable',
  VEG_PUMPKIN: 'vegetable',
  VEG_SNAKE_GUARD: 'vegetable',
  VEG_TOMATO_RED: 'vegetable',
  VEG_ARVI: 'root',
  VEG_CARROT_COUNTRY: 'root',
  VEG_RADISH: 'root',
  VEG_TURNIP: 'root',
  POTATO_FRESH: 'root',
  VEG_LEEK: 'leafy',
  VEG_SPRING_ONION: 'leafy',
  FRUIT_APPLE_SHIMLA: 'fruit',
  FRUIT_GRAPES_S_L: 'fruit',
  FRUIT_KINNU: 'fruit',
  FRUIT_MUSKMELON: 'fruit',
  FRUIT_SOUR_LIME: 'fruit',
  FRUIT_WATERMELON: 'fruit',
  FRUIT_MANGO_DASHERI: 'fruit',
  FRUIT_MANGO_LANGRA: 'fruit',
  FRUIT_APRICOT: 'fruit',
  FRUIT_THAI_GUAVA: 'fruit',
  FRUIT_KIWI: 'fruit',
  FRUIT_DRAGON_FRUIT: 'fruit',
  GMW_ANISE_SEEDS: 'spice',
  GMW_BAY_LEAF: 'spice',
  GMW_ASAFOETIDA: 'spice',
  GMW_KASHMIRI_CHILLI: 'spice',
  GMW_CINNAMON_STICK: 'spice',
  CND_EVEREST_CHILLY_POWDER: 'spice',
  CND_CORIANDER_POWDER: 'spice',
  CND_PANI_PURI_MASALA: 'spice',
  CND_SABJI_MASALA: 'spice',
  CND_TANDOORI_MASALA: 'spice',
  CND_RASAM_MASALA: 'spice',
  CND_KITCHEN_KING_MASALA: 'spice',
  CND_GARAM_MASALA: 'spice',
  CND_SHAHI_BIRYANI_MASALA: 'spice',
  CND_CHOLE_MASALA: 'spice',
  CND_AMCHUR_MASALA: 'spice',
  CND_PAV_BHAJI_MASALA: 'spice',
  CND_SAMBAR_MASALA: 'spice',
};

/**
 * The approved typical-value record for a provision, in the shape the screen
 * renders, or null.
 *
 * FOUR CONDITIONS, ALL REQUIRED:
 *
 *   1. the control above is on;
 *   2. the provision is on the approved list;
 *   3. the provision has no item-level record — belt and braces, since the
 *      screen checks this too. A provision with a measured value must never be
 *      shown a group average instead;
 *   4. the standalone data module actually holds a figure for it.
 *
 * WHAT IS DELIBERATELY NOT CARRIED ACROSS: no `citation`, no `sourceCode`, no
 * `printedPage`, no `sampleCount`, no `notes`, no workbook row number, and not
 * the workbook's own source string — which names ICMR-NIN and would therefore
 * put a source name into a module that ships. `source` is required by the type
 * and is filled with a generic description instead.
 * `sourceFood` holds the workbook's product name, which the screen does not
 * render for this category.
 *
 * A STATED ZERO IS DATA. Oil really does contain no carbohydrate and sugar
 * really does contain no fat. Those zeros are copied through as zeros, while a
 * nutrient the workbook never supplied stays `undefined` — the two are
 * different answers and the screen renders them differently.
 */
export function approvedTypicalNutritionFor(code: string): NutritionRecord | null {
  if (!PUBLISH_APPROVED_TYPICAL_VALUES) return null;
  if (APPROVED_TYPICAL_VALUE_PROVISIONS[code] === undefined) return null;
  if (hasItemLevelRecord(code)) return null;

  const source = APPROVED_TYPICAL_VALUES[code];
  if (source === undefined || source.energyKcal === undefined) return null;

  return {
    basis: 'per 100 g',
    state: 'raw',
    dataQuality: 'approximate-reference',
    // `NutritionRecord.source` is required, so it is filled with a generic
    // description of WHAT the figure is, naming no organisation and no
    // publication. The screen does not render a source line for this category
    // at all, and a test scans the rendered DOM to confirm no source name
    // reaches it; this value exists to satisfy the type, not to be read.
    source: 'Approximate typical values',
    sourceFood: source.workbookName,
    energyKcal: source.energyKcal,
    proteinG: source.proteinG,
    carbohydrateG: source.carbohydrateG,
    fibreG: source.fibreG,
    fatG: source.fatG,
    // Blank for every workbook row, so absent here. Never zero.
    sugarsG: source.totalSugarsG,
  };
}

/** The approved provision codes that actually yield a record. */
export function approvedTypicalCodes(): readonly string[] {
  return Object.keys(APPROVED_TYPICAL_VALUE_PROVISIONS).filter(
    (code) => approvedTypicalNutritionFor(code) !== null
  );
}
