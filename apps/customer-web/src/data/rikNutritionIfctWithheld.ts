/**
 * THE 51 IFCT ITEM-LEVEL RECORDS — PRESERVED HERE, AND KEPT OUT OF THE BUNDLE.
 *
 * =====================================================================
 * WHY THIS MODULE EXISTS AT ALL
 * =====================================================================
 *
 * These 51 records were transcribed from ICMR-NIN's Indian Food Composition
 * Tables 2017. That book's own front matter permits reproduction for personal
 * use with acknowledgement, but states that no part of it may be "stored or
 * reproduced in any electronic format for creating a product" without prior
 * written permission from the National Institute of Nutrition, Hyderabad.
 *
 * `PUBLISH_COMPOSITION_TABLE_VALUES` has therefore been false since the data
 * arrived, and `nutritionFor` refuses every one of these records. But a closed
 * runtime gate does not keep the figures out of the JavaScript we ship: while
 * the records sat in the `rikNutrition` map, and `nutritionFor` read that map,
 * and a customer screen imported `nutritionFor`, the bundler had no choice but
 * to include all 51 rows. Anyone with the shipped bundle could read them.
 * A gate that refuses to DISPLAY data is not a gate that refuses to STORE it.
 *
 * So the data was moved here, to a module no production code imports. The
 * import graph, not a boolean, is what now keeps it out: a bundler cannot
 * include a module nothing reaches.
 *
 * =====================================================================
 * THE ONE RULE THAT GOVERNS THIS FILE
 * =====================================================================
 *
 * NO PRODUCTION MODULE MAY IMPORT THIS FILE. Tests may; a screen, a hook, a
 * route, a context or anything reachable from `src/main.tsx` may not. Adding
 * such an import puts all 51 records straight back into the customer bundle,
 * silently, with no visible change to the app.
 *
 * `nutrition-ifct-bundle-exclusion.test.ts` walks the real dependency graph
 * from `src/main.tsx` and fails if this module is reachable, so that mistake
 * cannot pass review unnoticed. Do not add this module to that test's
 * allowlist in order to make a build work.
 *
 * =====================================================================
 * WHAT IS STILL SAFE TO SHIP
 * =====================================================================
 *
 * `ITEM_LEVEL_PROVISION_CODES` in ./rikNutrition holds our OWN provision
 * codes — no nutrient figures, no third-party content — and that list, not
 * this map, is what the screen consults to know a provision has a measured
 * record. It was deliberately written as a standalone list rather than
 * derived from this map, precisely so this move would not break it.
 *
 * =====================================================================
 * WHEN PERMISSION ARRIVES
 * =====================================================================
 *
 * Do NOT re-import this module from a screen. Publishing these figures is a
 * change to the publication policy in ./rikNutrition plus a deliberate
 * decision about where the records live, taken together, with the licence
 * position recorded. The data staying out of the bundle is the safe default,
 * and it should take a considered change to undo.
 */

import {
  IFCT_CITATION,
  IFCT_SOURCE,
  KJ_PER_KCAL,
  kcalFromKJ,
  type NutritionRecord,
} from './rikNutrition';

/** One food as printed in IFCT 2017, before any sourcing boilerplate. */
interface IfctFood {
  readonly sourceFood: string;
  readonly sampleCount: number;
  readonly printedPage: number;
  /** ENERC, in kJ, exactly as printed. The kcal figure is derived from this. */
  readonly energyKJ: number;
  readonly proteinG: number;
  readonly carbohydrateG: number;
  readonly fibreG: number;
  readonly fatG: number;
}

const BASIS = 'per 100 g edible portion';

/**
 * The IFCT 2017 rows this feature uses, keyed by the table's own food code.
 *
 * Each row is read from the printed page named in `printedPage`. A food is
 * defined once here and pointed at by the provisions it genuinely describes,
 * so two provisions of the same food cannot drift apart by a typo.
 *
 * Column order on the printed page is WATER, PROTCNT, ASH, FATCE, FIBTG,
 * FIBINS, FIBSOL, CHOAVLDF, ENERC. Only the five fields this feature shows
 * are carried over; ash, water and the fibre split are not displayed and are
 * deliberately not stored, so there is no unused half-transcription to rot.
 */
const IFCT_FOODS = {
  A018: {
    sourceFood: 'Wheat flour, refined', sampleCount: 6, printedPage: 41,
    energyKJ: 1472, proteinG: 10.36, carbohydrateG: 74.27, fibreG: 2.76, fatG: 0.76,
  },
  A022: {
    sourceFood: 'Wheat, semolina', sampleCount: 6, printedPage: 42,
    energyKJ: 1396, proteinG: 11.38, carbohydrateG: 68.43, fibreG: 9.72, fatG: 0.74,
  },
  C033: {
    sourceFood: 'Spinach', sampleCount: 6, printedPage: 45,
    energyKJ: 102, proteinG: 2.14, carbohydrateG: 2.05, fibreG: 2.38, fatG: 0.64,
  },
  D031: {
    sourceFood: 'Brinjal - all varieties', sampleCount: 6, printedPage: 46,
    energyKJ: 106, proteinG: 1.48, carbohydrateG: 3.52, fibreG: 3.98, fatG: 0.32,
  },
  D033: {
    sourceFood: 'Capsicum, green', sampleCount: 6, printedPage: 46,
    energyKJ: 68, proteinG: 1.11, carbohydrateG: 1.84, fibreG: 2.06, fatG: 0.34,
  },
  D034: {
    sourceFood: 'Capsicum, red', sampleCount: 4, printedPage: 47,
    energyKJ: 83, proteinG: 1.47, carbohydrateG: 2.14, fibreG: 2.19, fatG: 0.47,
  },
  D035: {
    sourceFood: 'Capsicum, yellow', sampleCount: 4, printedPage: 47,
    energyKJ: 78, proteinG: 1.35, carbohydrateG: 1.95, fibreG: 2.19, fatG: 0.41,
  },
  D036: {
    sourceFood: 'Cauliflower', sampleCount: 6, printedPage: 47,
    energyKJ: 96, proteinG: 2.15, carbohydrateG: 2.03, fibreG: 3.71, fatG: 0.44,
  },
  D039: {
    sourceFood: 'Cluster beans', sampleCount: 6, printedPage: 47,
    energyKJ: 168, proteinG: 3.55, carbohydrateG: 4.91, fibreG: 4.83, fatG: 0.37,
  },
  D042: {
    sourceFood: 'Corn, baby', sampleCount: 6, printedPage: 47,
    energyKJ: 306, proteinG: 2.69, carbohydrateG: 11.66, fibreG: 6.09, fatG: 1.33,
  },
  D046: {
    sourceFood: 'Drumstick', sampleCount: 6, printedPage: 47,
    energyKJ: 123, proteinG: 2.62, carbohydrateG: 3.76, fibreG: 6.83, fatG: 0.12,
  },
  D053: {
    sourceFood: 'Knol-Khol', sampleCount: 6, printedPage: 47,
    energyKJ: 67, proteinG: 1.58, carbohydrateG: 1.39, fibreG: 2.75, fatG: 0.35,
  },
  D056: {
    sourceFood: 'Ladies finger', sampleCount: 6, printedPage: 48,
    energyKJ: 115, proteinG: 2.08, carbohydrateG: 3.62, fibreG: 4.08, fatG: 0.22,
  },
  D060: {
    sourceFood: 'Parwar', sampleCount: 6, printedPage: 48,
    energyKJ: 101, proteinG: 1.40, carbohydrateG: 3.54, fibreG: 2.61, fatG: 0.30,
  },
  D061: {
    sourceFood: 'Peas, fresh', sampleCount: 6, printedPage: 48,
    energyKJ: 340, proteinG: 7.25, carbohydrateG: 11.88, fibreG: 6.32, fatG: 0.13,
  },
  D068: {
    sourceFood: 'Ridge gourd', sampleCount: 6, printedPage: 48,
    energyKJ: 55, proteinG: 0.91, carbohydrateG: 1.72, fibreG: 1.81, fatG: 0.14,
  },
  D073: {
    sourceFood: 'Tinda, tender', sampleCount: 6, printedPage: 48,
    energyKJ: 58, proteinG: 1.02, carbohydrateG: 1.90, fibreG: 2.00, fatG: 0.17,
  },
  E012: {
    sourceFood: 'Banana, ripe, robusta', sampleCount: 6, printedPage: 49,
    energyKJ: 440, proteinG: 1.23, carbohydrateG: 23.63, fibreG: 1.94, fatG: 0.33,
  },
  E016: {
    sourceFood: 'Custard apple', sampleCount: 1, printedPage: 49,
    energyKJ: 414, proteinG: 1.62, carbohydrateG: 20.38, fibreG: 5.10, fatG: 0.67,
  },
  E027: {
    sourceFood: 'Grapes, seedless, round, black', sampleCount: 5, printedPage: 50,
    energyKJ: 374, proteinG: 1.24, carbohydrateG: 19.86, fibreG: 1.15, fatG: 0.35,
  },
  E034: {
    sourceFood: 'Lime, sweet, pulp', sampleCount: 6, printedPage: 50,
    energyKJ: 114, proteinG: 0.76, carbohydrateG: 5.18, fibreG: 2.07, fatG: 0.20,
  },
  E035: {
    sourceFood: 'Litchi', sampleCount: 4, printedPage: 50,
    energyKJ: 225, proteinG: 0.99, carbohydrateG: 11.41, fibreG: 1.34, fatG: 0.26,
  },
  E036: {
    sourceFood: 'Mango, ripe, banganapalli', sampleCount: 6, printedPage: 50,
    energyKJ: 175, proteinG: 0.54, carbohydrateG: 8.18, fibreG: 1.88, fatG: 0.55,
  },
  E047: {
    sourceFood: 'Orange, pulp', sampleCount: 6, printedPage: 51,
    energyKJ: 156, proteinG: 0.70, carbohydrateG: 7.92, fibreG: 1.29, fatG: 0.13,
  },
  E049: {
    sourceFood: 'Papaya, ripe', sampleCount: 6, printedPage: 51,
    energyKJ: 100, proteinG: 0.42, carbohydrateG: 4.61, fibreG: 2.83, fatG: 0.16,
  },
  E051: {
    sourceFood: 'Pear', sampleCount: 6, printedPage: 51,
    energyKJ: 157, proteinG: 0.36, carbohydrateG: 8.09, fibreG: 4.48, fatG: 0.27,
  },
  E053: {
    sourceFood: 'Pineapple', sampleCount: 6, printedPage: 51,
    energyKJ: 180, proteinG: 0.52, carbohydrateG: 9.42, fibreG: 3.46, fatG: 0.16,
  },
  E054: {
    sourceFood: 'Plum', sampleCount: 3, printedPage: 51,
    energyKJ: 238, proteinG: 0.64, carbohydrateG: 12.10, fibreG: 2.07, fatG: 0.40,
  },
  E055: {
    sourceFood: 'Pomegranate, maroon seeds', sampleCount: 6, printedPage: 51,
    energyKJ: 229, proteinG: 1.33, carbohydrateG: 11.58, fibreG: 2.83, fatG: 0.15,
  },
  E060: {
    sourceFood: 'Sapota', sampleCount: 6, printedPage: 52,
    energyKJ: 307, proteinG: 0.92, carbohydrateG: 13.90, fibreG: 9.60, fatG: 1.26,
  },
  E063: {
    sourceFood: 'Strawberry', sampleCount: 6, printedPage: 52,
    energyKJ: 103, proteinG: 0.97, carbohydrateG: 3.40, fibreG: 2.50, fatG: 0.56,
  },
  E064: {
    sourceFood: 'Tamarind, pulp', sampleCount: 6, printedPage: 52,
    energyKJ: 1207, proteinG: 2.92, carbohydrateG: 67.35, fibreG: 5.31, fatG: 0.15,
  },
  F001: {
    sourceFood: 'Beet root', sampleCount: 6, printedPage: 52,
    energyKJ: 149, proteinG: 1.95, carbohydrateG: 6.18, fibreG: 3.31, fatG: 0.14,
  },
  F003: {
    sourceFood: 'Carrot, red', sampleCount: 4, printedPage: 52,
    energyKJ: 160, proteinG: 1.04, carbohydrateG: 6.71, fibreG: 4.49, fatG: 0.47,
  },
  F017: {
    sourceFood: 'Yam, elephant', sampleCount: 6, printedPage: 53,
    energyKJ: 353, proteinG: 2.56, carbohydrateG: 17.46, fibreG: 4.17, fatG: 0.14,
  },
  G008: {
    sourceFood: 'Chillies, green - all varieties', sampleCount: 6, printedPage: 53,
    energyKJ: 177, proteinG: 2.36, carbohydrateG: 5.86, fibreG: 4.77, fatG: 0.72,
  },
  G009: {
    sourceFood: 'Coriander leaves', sampleCount: 6, printedPage: 53,
    energyKJ: 130, proteinG: 3.52, carbohydrateG: 1.93, fibreG: 4.66, fatG: 0.70,
  },
  G010: {
    sourceFood: 'Curry leaves', sampleCount: 6, printedPage: 54,
    energyKJ: 266, proteinG: 7.41, carbohydrateG: 4.51, fibreG: 16.83, fatG: 1.06,
  },
  G011: {
    sourceFood: 'Garlic, big clove', sampleCount: 6, printedPage: 54,
    energyKJ: 518, proteinG: 6.92, carbohydrateG: 21.93, fibreG: 5.22, fatG: 0.16,
  },
  G014: {
    sourceFood: 'Ginger, fresh', sampleCount: 6, printedPage: 54,
    energyKJ: 230, proteinG: 2.22, carbohydrateG: 8.97, fibreG: 5.36, fatG: 0.85,
  },
  G016: {
    sourceFood: 'Mint leaves', sampleCount: 4, printedPage: 54,
    energyKJ: 155, proteinG: 4.66, carbohydrateG: 2.39, fibreG: 5.89, fatG: 0.65,
  },
  G017: {
    sourceFood: 'Onion, big', sampleCount: 6, printedPage: 54,
    energyKJ: 201, proteinG: 1.50, carbohydrateG: 9.56, fibreG: 2.45, fatG: 0.24,
  },
  G021: {
    sourceFood: 'Cardamom, black', sampleCount: 4, printedPage: 54,
    energyKJ: 1132, proteinG: 6.69, carbohydrateG: 52.53, fibreG: 23.46, fatG: 2.80,
  },
  G023: {
    sourceFood: 'Cloves', sampleCount: 6, printedPage: 54,
    energyKJ: 781, proteinG: 5.86, carbohydrateG: 18.73, fibreG: 34.52, fatG: 8.41,
  },
  G024: {
    sourceFood: 'Coriander seeds', sampleCount: 6, printedPage: 54,
    energyKJ: 1125, proteinG: 10.66, carbohydrateG: 12.98, fibreG: 44.81, fatG: 17.47,
  },
  G025: {
    sourceFood: 'Cumin seeds', sampleCount: 6, printedPage: 54,
    energyKJ: 1274, proteinG: 13.91, carbohydrateG: 22.62, fibreG: 30.35, fatG: 16.64,
  },
  G026: {
    sourceFood: 'Fenugreek seeds', sampleCount: 6, printedPage: 54,
    energyKJ: 983, proteinG: 25.41, carbohydrateG: 10.57, fibreG: 47.55, fatG: 5.72,
  },
  G029: {
    sourceFood: 'Omum (ajwain)', sampleCount: 6, printedPage: 54,
    energyKJ: 1495, proteinG: 15.89, carbohydrateG: 24.53, fibreG: 20.58, fatG: 21.11,
  },
  G031: {
    sourceFood: 'Pepper, black', sampleCount: 6, printedPage: 55,
    energyKJ: 910, proteinG: 10.12, carbohydrateG: 36.22, fibreG: 33.16, fatG: 2.74,
  },
  G032: {
    sourceFood: 'Poppy seeds', sampleCount: 6, printedPage: 55,
    energyKJ: 1768, proteinG: 20.31, carbohydrateG: 12.37, fibreG: 26.68, fatG: 30.38,
  },
  G033: {
    sourceFood: 'Turmeric powder', sampleCount: 6, printedPage: 55,
    energyKJ: 1174, proteinG: 7.66, carbohydrateG: 49.22, fibreG: 21.38, fatG: 5.03,
  },
} as const satisfies Readonly<Record<string, IfctFood>>;

/**
 * Builds the displayable record for one IFCT food.
 *
 * This is the ONLY place a kcal figure comes into being, and it comes from
 * `energyKJ` via `kcalFromKJ`. There is no path by which a kcal value can be
 * typed in by hand, so the stored kJ and the shown kcal cannot disagree.
 */
function ifct(code: keyof typeof IFCT_FOODS): NutritionRecord {
  const food = IFCT_FOODS[code];
  const samples =
    food.sampleCount === 1
      ? 'A single analysed sample.'
      : `Mean of ${food.sampleCount} analysed samples.`;

  return {
    basis: BASIS,
    state: 'raw',
    source: IFCT_SOURCE,
    sourceFood: food.sourceFood,
    dataQuality: 'composition-table',
    sourceCode: code,
    citation: IFCT_CITATION,
    sampleCount: food.sampleCount,
    printedPage: food.printedPage,
    energyKJ: food.energyKJ,
    energyKcal: kcalFromKJ(food.energyKJ),
    proteinG: food.proteinG,
    carbohydrateG: food.carbohydrateG,
    fibreG: food.fibreG,
    fatG: food.fatG,
    notes:
      `Energy is published in kilojoules only (${food.energyKJ} kJ); the kcal ` +
      `figure is an exact conversion using the source's own formula, ` +
      `1 kcal = ${KJ_PER_KCAL} kJ. ${samples} Read from page ${food.printedPage}.`,
  };
}

/**
 * Provision code to nutrition record.
 *
 * 51 provisions. Every one is unbranded, single-ingredient, of unambiguous
 * identity and state, and carries all four mandatory fields. A provision
 * absent from this map is not missing — see DELIBERATELY_UNMAPPED and the
 * header for why each is out.
 */
export const rikNutritionIfctWithheld: Readonly<Record<string, NutritionRecord>> = {

  // --- Cereals ---
  CER_MAIDA: ifct('A018'), // All Purpose Flour / Maida

  // --- Daliya ---
  DAL_SEMOLINA: ifct('A022'), // Semolina

  // --- Condiments ---
  CND_CORIANDER_SEEDS: ifct('G024'), // Coriander Seeds
  CND_CUMIN_SEEDS: ifct('G025'), // Cumin Seeds
  CND_TAMARIND: ifct('E064'), // Tamarind
  CND_TURMERIC_POWDER: ifct('G033'), // Turmeric Powder

  // --- Fresh Fruits ---
  FRUIT_BANANA_ROBUSTA: ifct('E012'), // Banana Robusta
  FRUIT_CHICKOO: ifct('E060'), // Chickoo
  FRUIT_CUSTARD_APPLE: ifct('E016'), // Custard Apple
  FRUIT_GRAPES_BLACK_S_L: ifct('E027'), // Grapes Black S/L
  FRUIT_LITCHI: ifct('E035'), // Litchi
  FRUIT_MANGO_BANGANPALLI: ifct('E036'), // Mango Banganpalli
  FRUIT_MUSAMBI_SWEET_LEMON: ifct('E034'), // Musambi/Sweet Lemon
  FRUIT_ORANGE: ifct('E047'), // Orange
  FRUIT_PAPAYA: ifct('E049'), // Papaya
  FRUIT_PEARS: ifct('E051'), // Pears
  FRUIT_PINEAPPLE: ifct('E053'), // Pineapple
  FRUIT_PLUM: ifct('E054'), // Plum
  FRUIT_POMEGRANATE: ifct('E055'), // Pomegranate
  FRUIT_STRAWBERRY: ifct('E063'), // Strawberry

  // --- Fresh Vegetables ---
  VEG_BABY_CORN: ifct('D042'), // Baby Corn
  VEG_BEETROOT: ifct('F001'), // Beetroot
  VEG_BRINJAL_PURPLE_AND_GREEN: ifct('D031'), // Brinjal (Purple & Green)
  VEG_CAPSICUM: ifct('D033'), // Capsicum
  VEG_CAPSICUM_RED: ifct('D034'), // Capsicum Red
  VEG_CAPSICUM_YELLOW: ifct('D035'), // Capsicum Yellow
  VEG_CARROT_RED: ifct('F003'), // Carrot Red
  VEG_CAULIFLOWER: ifct('D036'), // Cauliflower
  VEG_CHILLY_GREEN: ifct('G008'), // Chilly Green
  VEG_CLUSTER_BEANS: ifct('D039'), // Cluster Beans
  VEG_CORIANDER_GREEN: ifct('G009'), // Coriander Green
  VEG_CURRY_LEAVES: ifct('G010'), // Curry Leaves
  VEG_DRUM_STICK: ifct('D046'), // Drum Stick
  VEG_GINGER_GREEN: ifct('G014'), // Ginger Green
  VEG_KHOL_KHOL: ifct('D053'), // Khol Khol
  VEG_LADIE_S_FINGER: ifct('D056'), // Ladie's Finger
  VEG_MINT_GREEN: ifct('G016'), // Mint Green
  VEG_PARWAL: ifct('D060'), // Parwal
  VEG_PEAS_GREEN: ifct('D061'), // Peas Green
  VEG_RIBBED_GUARD: ifct('D068'), // Ribbed Guard
  VEG_SPINACH_COUNTRY: ifct('C033'), // Spinach Country
  VEG_TINDA: ifct('D073'), // Tinda
  VEG_ZIMIKAND: ifct('F017'), // Zimikand

  // --- Garam Masala (Whole) ---
  GMW_AJWAIN: ifct('G029'), // Ajwain
  GMW_CLOVES: ifct('G023'), // Cloves
  GMW_FENUGREEK: ifct('G026'), // Fenugreek
  GMW_LARGE_CARDAMOM: ifct('G021'), // Large Cardamom
  GMW_POPPY_SEEDS: ifct('G032'), // Poppy Seeds
  GMW_WHOLE_PEPPER: ifct('G031'), // Whole Pepper

  // --- Onion / Garlic ---
  GARLIC_FRESH: ifct('G011'), // Garlic (Fresh)
  ONION_FRESH: ifct('G017'), // Onion
};
