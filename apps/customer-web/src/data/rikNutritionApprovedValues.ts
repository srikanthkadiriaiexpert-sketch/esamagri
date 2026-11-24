/**
 * THE APPROVED TYPICAL NUTRITION VALUES — THE ONLY FIGURES THE APP SHIPS.
 *
 * 101 records, copied from the workbook transcription in
 * ./rikNutritionPreliminary, which holds 184. The other 83 are not here, and
 * the reasons are recorded per record in ./rikNutritionTypicalValueReview.
 *
 * =====================================================================
 * WHY THIS MODULE EXISTS AT ALL
 * =====================================================================
 *
 * The figures could have been read straight out of the 184-record workbook
 * module. They were, once. Importing it to serve a subset put all 184 records
 * into the customer bundle — the ones never approved for display included,
 * readable by anyone holding the bundle. The publication gate was working
 * perfectly the whole time, because A GATE ON WHAT IS DISPLAYED IS NOT A GATE
 * ON WHAT IS SHIPPED.
 *
 * So the approved figures live here, in a module that imports nothing, and the
 * workbook is no longer reachable from any screen.
 *
 * =====================================================================
 * THESE ARE COPIES, AND TESTS PROVE IT
 * =====================================================================
 *
 * Every number was copied mechanically from the workbook record named by
 * `workbookRow`. Nothing is recalculated, converted, rounded or inferred.
 *
 * Copying by hand is how data drifts, so it is not left to trust.
 * nutrition-approved-typical.test.ts reads the workbook — a TEST may, since
 * nothing there ships — and asserts every record here is field-for-field
 * identical to its workbook row, that the code sets agree, and that no record
 * here belongs to a provision holding a measured value. A typo, a dropped
 * nutrient or a workbook revision fails those tests.
 *
 * =====================================================================
 * WHAT THESE FIGURES ARE, AND WHAT THEY ARE NOT
 * =====================================================================
 *
 * They are BROAD FOOD-GROUP AVERAGES, approved for customer display as
 * approximations. They are not measurements of the named product. The screen
 * therefore shows them under a fixed qualifier and shows no source name or
 * citation against them — see TYPICAL_VALUES_DISCLAIMER in
 * ./rikNutritionApproved.
 *
 * Each record is here because its food group genuinely describes the product.
 * A product whose group average would misdescribe it is excluded even though a
 * figure exists for it: ghee is not mixed dairy, bread is not flour, a masala
 * is not the dish it is named after.
 *
 * =====================================================================
 * A BLANK IS NOT A ZERO
 * =====================================================================
 *
 * The workbook left total sugars, the fatty-acid split, sodium and cholesterol
 * blank for every one of its 184 records, so those fields are absent here and
 * the screen omits those rows. Absent means "not stated" and must never be
 * filled in with 0, which would assert a figure nobody measured.
 *
 * The zeros that ARE here are real values: refined oil genuinely contains no
 * protein, carbohydrate or fibre, and sugar genuinely contains no fat. The
 * screen prints those.
 */

/** One approved record, in the workbook's own units. */
export interface ApprovedTypicalValue {
  /** The workbook row this was copied from, so any figure can be traced back. */
  readonly workbookRow: number;
  /** The product name exactly as the workbook spells it. Not rendered. */
  readonly workbookName: string;

  readonly energyKcal?: number;
  readonly proteinG?: number;
  readonly carbohydrateG?: number;
  readonly fibreG?: number;
  readonly fatG?: number;
  /** Blank in the workbook for all 184 records. Absent, never zero. */
  readonly totalSugarsG?: number;
}

/**
 * Provision code to approved figures, grouped by the food group whose average
 * each carries. The food group is recorded per code in
 * APPROVED_TYPICAL_VALUE_PROVISIONS; the reasoning lives in the review module.
 */
export const APPROVED_TYPICAL_VALUES: Readonly<Record<string, ApprovedTypicalValue>> = {
  // --- oil (6) --- 
  // 900 kcal per 100 g.

  OIL_GROUNDNUT: {
    workbookRow: 6,
    workbookName: 'Groundnut Oil',
    energyKcal: 900,
    proteinG: 0,
    carbohydrateG: 0,
    fibreG: 0,
    fatG: 100,
  },

  OIL_RICE_BRAN: {
    workbookRow: 7,
    workbookName: 'Rice Bran Oil',
    energyKcal: 900,
    proteinG: 0,
    carbohydrateG: 0,
    fibreG: 0,
    fatG: 100,
  },

  OIL_SUNFLOWER_500: {
    workbookRow: 8,
    workbookName: 'Sunflower Refined Oil',
    energyKcal: 900,
    proteinG: 0,
    carbohydrateG: 0,
    fibreG: 0,
    fatG: 100,
  },

  OIL_SUNFLOWER_1000: {
    workbookRow: 9,
    workbookName: 'Sunflower Refined Oil',
    energyKcal: 900,
    proteinG: 0,
    carbohydrateG: 0,
    fibreG: 0,
    fatG: 100,
  },

  OIL_MUSTARD_500: {
    workbookRow: 10,
    workbookName: 'Mustard Oil',
    energyKcal: 900,
    proteinG: 0,
    carbohydrateG: 0,
    fibreG: 0,
    fatG: 100,
  },

  OIL_MUSTARD_1000: {
    workbookRow: 11,
    workbookName: 'Mustard Oil',
    energyKcal: 900,
    proteinG: 0,
    carbohydrateG: 0,
    fibreG: 0,
    fatG: 100,
  },

  // --- sugar (2) --- 
  // 400 kcal per 100 g.

  SUGAR: {
    workbookRow: 2,
    workbookName: 'Sugar',
    energyKcal: 400,
    proteinG: 0,
    carbohydrateG: 100,
    fibreG: 0,
    fatG: 0,
  },

  JAGGERY: {
    workbookRow: 3,
    workbookName: 'Jaggery',
    energyKcal: 400,
    proteinG: 0,
    carbohydrateG: 100,
    fibreG: 0,
    fatG: 0,
  },

  // --- egg (1) --- 
  // 147 kcal per 100 g.

  EGGS_TABLE: {
    workbookRow: 15,
    workbookName: 'Eggs',
    energyKcal: 147,
    proteinG: 13.3,
    carbohydrateG: 1,
    fibreG: 0,
    fatG: 10,
  },

  // --- milk (1) --- 
  // 72 kcal per 100 g.

  MILK_FRESH_COUPON: {
    workbookRow: 168,
    workbookName: 'Fresh Milk (500 ml coupon)',
    energyKcal: 72,
    proteinG: 3.1,
    carbohydrateG: 5,
    fibreG: 0,
    fatG: 4.2,
  },

  // --- milk products (6) --- 
  // 337 kcal per 100 g.

  CH_PANEER: {
    workbookRow: 66,
    workbookName: 'Paneer',
    energyKcal: 337,
    proteinG: 21.6,
    carbohydrateG: 16,
    fibreG: 0,
    fatG: 18.6,
  },

  CH_SLICES: {
    workbookRow: 67,
    workbookName: 'Cheese Slices',
    energyKcal: 337,
    proteinG: 21.6,
    carbohydrateG: 16,
    fibreG: 0,
    fatG: 18.6,
  },

  CH_BLOCK: {
    workbookRow: 68,
    workbookName: 'Cheese Block',
    energyKcal: 337,
    proteinG: 21.6,
    carbohydrateG: 16,
    fibreG: 0,
    fatG: 18.6,
  },

  CH_SPREAD: {
    workbookRow: 69,
    workbookName: 'Cheese Spread',
    energyKcal: 337,
    proteinG: 21.6,
    carbohydrateG: 16,
    fibreG: 0,
    fatG: 18.6,
  },

  CH_MOZZARELLA: {
    workbookRow: 70,
    workbookName: 'Cheese Mozzarella',
    energyKcal: 337,
    proteinG: 21.6,
    carbohydrateG: 16,
    fibreG: 0,
    fatG: 18.6,
  },

  CH_TIN: {
    workbookRow: 71,
    workbookName: 'Cheese TD / Tin Cheese',
    energyKcal: 337,
    proteinG: 21.6,
    carbohydrateG: 16,
    fibreG: 0,
    fatG: 18.6,
  },

  // --- meat (2) --- 
  // 250 kcal per 100 g.

  MEAT_MUTTON: {
    workbookRow: 118,
    workbookName: 'Meat',
    energyKcal: 250,
    proteinG: 20.8,
    carbohydrateG: 0,
    fibreG: 0,
    fatG: 6.8,
  },

  MEAT_CHICKEN: {
    workbookRow: 120,
    workbookName: 'Chicken / Fowl',
    energyKcal: 250,
    proteinG: 20.8,
    carbohydrateG: 0,
    fibreG: 0,
    fatG: 6.8,
  },

  // --- fish (1) --- 
  // 110 kcal per 100 g.

  MEAT_FISH: {
    workbookRow: 119,
    workbookName: 'Fish',
    energyKcal: 110,
    proteinG: 18.4,
    carbohydrateG: 2,
    fibreG: 0,
    fatG: 3.1,
  },

  // --- cereal (11) --- 
  // 343 kcal per 100 g.

  DAL_SAGO: {
    workbookRow: 78,
    workbookName: 'Sago',
    energyKcal: 343,
    proteinG: 9.3,
    carbohydrateG: 72,
    fibreG: 6,
    fatG: 1.2,
  },

  DAL_CORN_FLOUR: {
    workbookRow: 79,
    workbookName: 'Corn Flour',
    energyKcal: 343,
    proteinG: 9.3,
    carbohydrateG: 72,
    fibreG: 6,
    fatG: 1.2,
  },

  DAL_CUSTARD: {
    workbookRow: 80,
    workbookName: 'Custard Powder',
    energyKcal: 343,
    proteinG: 9.3,
    carbohydrateG: 72,
    fibreG: 6,
    fatG: 1.2,
  },

  DAL_OATS: {
    workbookRow: 81,
    workbookName: 'Oats',
    energyKcal: 343,
    proteinG: 9.3,
    carbohydrateG: 72,
    fibreG: 6,
    fatG: 1.2,
  },

  DAL_CORNFLAKES: {
    workbookRow: 82,
    workbookName: 'Cornflakes',
    energyKcal: 343,
    proteinG: 9.3,
    carbohydrateG: 72,
    fibreG: 6,
    fatG: 1.2,
  },

  CER_RICE_SUPER_BASMATI: {
    workbookRow: 107,
    workbookName: 'Super Basmati Rice (Dawat)',
    energyKcal: 343,
    proteinG: 9.3,
    carbohydrateG: 72,
    fibreG: 6,
    fatG: 1.2,
  },

  CER_RICE_ROZANA: {
    workbookRow: 108,
    workbookName: 'Rozana Basmati Rice (Dawat)',
    energyKcal: 343,
    proteinG: 9.3,
    carbohydrateG: 72,
    fibreG: 6,
    fatG: 1.2,
  },

  CER_RICE_HERITAGE: {
    workbookRow: 109,
    workbookName: 'Heritage Basmati Rice (Dawat)',
    energyKcal: 343,
    proteinG: 9.3,
    carbohydrateG: 72,
    fibreG: 6,
    fatG: 1.2,
  },

  CER_ATTA_AASHIRVAAD: {
    workbookRow: 111,
    workbookName: 'Aashirvaad Atta',
    energyKcal: 343,
    proteinG: 9.3,
    carbohydrateG: 72,
    fibreG: 6,
    fatG: 1.2,
  },

  CER_ATTA_PILLSBURY: {
    workbookRow: 112,
    workbookName: 'Pillsbury Chakki Fresh Atta',
    energyKcal: 343,
    proteinG: 9.3,
    carbohydrateG: 72,
    fibreG: 6,
    fatG: 1.2,
  },

  CER_ATTA_AMUL: {
    workbookRow: 113,
    workbookName: 'Atta',
    energyKcal: 343,
    proteinG: 9.3,
    carbohydrateG: 72,
    fibreG: 6,
    fatG: 1.2,
  },

  // --- millet (1) --- 
  // 330 kcal per 100 g.

  CER_MILLETS: {
    workbookRow: 117,
    workbookName: 'Millets',
    energyKcal: 330,
    proteinG: 9.9,
    carbohydrateG: 65,
    fibreG: 7,
    fatG: 2.7,
  },

  // --- pulse (19) --- 
  // 323 kcal per 100 g.

  DAL_P_TATA_ARHAR: {
    workbookRow: 148,
    workbookName: 'Arhar',
    energyKcal: 323,
    proteinG: 22.8,
    carbohydrateG: 49,
    fibreG: 12,
    fatG: 3,
  },

  DAL_P_TATA_KABULI_CHANA: {
    workbookRow: 149,
    workbookName: 'Kabuli Chana',
    energyKcal: 323,
    proteinG: 22.8,
    carbohydrateG: 49,
    fibreG: 12,
    fatG: 3,
  },

  DAL_P_TATA_MOONG_WITHOUT_SKIN: {
    workbookRow: 150,
    workbookName: 'Moong without skin',
    energyKcal: 323,
    proteinG: 22.8,
    carbohydrateG: 49,
    fibreG: 12,
    fatG: 3,
  },

  DAL_P_TATA_URD_WITHOUT_SKIN: {
    workbookRow: 151,
    workbookName: 'Urd without skin',
    energyKcal: 323,
    proteinG: 22.8,
    carbohydrateG: 49,
    fibreG: 12,
    fatG: 3,
  },

  DAL_P_TATA_MOONG_WHOLE: {
    workbookRow: 152,
    workbookName: 'Moong whole',
    energyKcal: 323,
    proteinG: 22.8,
    carbohydrateG: 49,
    fibreG: 12,
    fatG: 3,
  },

  DAL_P_TATA_MASOOR_SPLIT: {
    workbookRow: 153,
    workbookName: 'Masoor split',
    energyKcal: 323,
    proteinG: 22.8,
    carbohydrateG: 49,
    fibreG: 12,
    fatG: 3,
  },

  DAL_P_TATA_BLACK_CHANA: {
    workbookRow: 154,
    workbookName: 'Black Chana',
    energyKcal: 323,
    proteinG: 22.8,
    carbohydrateG: 49,
    fibreG: 12,
    fatG: 3,
  },

  DAL_P_TATA_URD_SPLIT: {
    workbookRow: 155,
    workbookName: 'Urd split',
    energyKcal: 323,
    proteinG: 22.8,
    carbohydrateG: 49,
    fibreG: 12,
    fatG: 3,
  },

  DAL_P_FORTUNE_BESAN: {
    workbookRow: 156,
    workbookName: 'Besan',
    energyKcal: 323,
    proteinG: 22.8,
    carbohydrateG: 49,
    fibreG: 12,
    fatG: 3,
  },

  DAL_P_TATA_RAJMA: {
    workbookRow: 157,
    workbookName: 'Rajma',
    energyKcal: 323,
    proteinG: 22.8,
    carbohydrateG: 49,
    fibreG: 12,
    fatG: 3,
  },

  DAL_P_TATA_PEAS_DRIED: {
    workbookRow: 158,
    workbookName: 'Peas dried',
    energyKcal: 323,
    proteinG: 22.8,
    carbohydrateG: 49,
    fibreG: 12,
    fatG: 3,
  },

  DAL_L_DAL_ARHAR: {
    workbookRow: 159,
    workbookName: 'Dal Arhar (loose)',
    energyKcal: 323,
    proteinG: 22.8,
    carbohydrateG: 49,
    fibreG: 12,
    fatG: 3,
  },

  DAL_L_KABULI_CHANA: {
    workbookRow: 160,
    workbookName: 'Kabuli Chana (loose)',
    energyKcal: 323,
    proteinG: 22.8,
    carbohydrateG: 49,
    fibreG: 12,
    fatG: 3,
  },

  DAL_L_MOONG_YELLOW: {
    workbookRow: 161,
    workbookName: 'Moong Yellow (loose)',
    energyKcal: 323,
    proteinG: 22.8,
    carbohydrateG: 49,
    fibreG: 12,
    fatG: 3,
  },

  DAL_L_CHANNA_DAL: {
    workbookRow: 162,
    workbookName: 'Channa Dal (loose)',
    energyKcal: 323,
    proteinG: 22.8,
    carbohydrateG: 49,
    fibreG: 12,
    fatG: 3,
  },

  DAL_L_URD_DAL_WITHOUT_SKIN: {
    workbookRow: 163,
    workbookName: 'Urd Dal without skin (loose)',
    energyKcal: 323,
    proteinG: 22.8,
    carbohydrateG: 49,
    fibreG: 12,
    fatG: 3,
  },

  DAL_L_MASOOR_DAL_WHOLE: {
    workbookRow: 164,
    workbookName: 'Masoor Dal whole (loose)',
    energyKcal: 323,
    proteinG: 22.8,
    carbohydrateG: 49,
    fibreG: 12,
    fatG: 3,
  },

  DAL_L_URD_DAL_WHOLE: {
    workbookRow: 165,
    workbookName: 'Urd Dal whole (loose)',
    energyKcal: 323,
    proteinG: 22.8,
    carbohydrateG: 49,
    fibreG: 12,
    fatG: 3,
  },

  DAL_L_RAJMA: {
    workbookRow: 166,
    workbookName: 'Rajma (loose)',
    energyKcal: 323,
    proteinG: 22.8,
    carbohydrateG: 49,
    fibreG: 12,
    fatG: 3,
  },

  // --- vegetable (14) --- 
  // 35 kcal per 100 g.

  VEG_ASPARAGUS: {
    workbookRow: 22,
    workbookName: 'Asparagus',
    energyKcal: 35,
    proteinG: 1.8,
    carbohydrateG: 5,
    fibreG: 2,
    fatG: 0.4,
  },

  VEG_BEANS_FRENCH: {
    workbookRow: 24,
    workbookName: 'Beans French',
    energyKcal: 35,
    proteinG: 1.8,
    carbohydrateG: 5,
    fibreG: 2,
    fatG: 0.4,
  },

  VEG_BEANS_LONG: {
    workbookRow: 25,
    workbookName: 'Beans Long',
    energyKcal: 35,
    proteinG: 1.8,
    carbohydrateG: 5,
    fibreG: 2,
    fatG: 0.4,
  },

  VEG_BITTER_GUARD: {
    workbookRow: 27,
    workbookName: 'Bitter Guard',
    energyKcal: 35,
    proteinG: 1.8,
    carbohydrateG: 5,
    fibreG: 2,
    fatG: 0.4,
  },

  VEG_BOTTLE_GUARD: {
    workbookRow: 28,
    workbookName: 'Bottle Guard',
    energyKcal: 35,
    proteinG: 1.8,
    carbohydrateG: 5,
    fibreG: 2,
    fatG: 0.4,
  },

  VEG_BROCCOLI: {
    workbookRow: 30,
    workbookName: 'Broccoli',
    energyKcal: 35,
    proteinG: 1.8,
    carbohydrateG: 5,
    fibreG: 2,
    fatG: 0.4,
  },

  VEG_CABBAGE: {
    workbookRow: 32,
    workbookName: 'Cabbage',
    energyKcal: 35,
    proteinG: 1.8,
    carbohydrateG: 5,
    fibreG: 2,
    fatG: 0.4,
  },

  VEG_CUCUMBER: {
    workbookRow: 43,
    workbookName: 'Cucumber',
    energyKcal: 35,
    proteinG: 1.8,
    carbohydrateG: 5,
    fibreG: 2,
    fatG: 0.4,
  },

  VEG_KUNDRI: {
    workbookRow: 48,
    workbookName: 'Kundri',
    energyKcal: 35,
    proteinG: 1.8,
    carbohydrateG: 5,
    fibreG: 2,
    fatG: 0.4,
  },

  VEG_MARROW: {
    workbookRow: 51,
    workbookName: 'Marrow',
    energyKcal: 35,
    proteinG: 1.8,
    carbohydrateG: 5,
    fibreG: 2,
    fatG: 0.4,
  },

  VEG_MUSHROOM: {
    workbookRow: 53,
    workbookName: 'Mushroom',
    energyKcal: 35,
    proteinG: 1.8,
    carbohydrateG: 5,
    fibreG: 2,
    fatG: 0.4,
  },

  VEG_PUMPKIN: {
    workbookRow: 56,
    workbookName: 'Pumpkin',
    energyKcal: 35,
    proteinG: 1.8,
    carbohydrateG: 5,
    fibreG: 2,
    fatG: 0.4,
  },

  VEG_SNAKE_GUARD: {
    workbookRow: 59,
    workbookName: 'Snake Guard',
    energyKcal: 35,
    proteinG: 1.8,
    carbohydrateG: 5,
    fibreG: 2,
    fatG: 0.4,
  },

  VEG_TOMATO_RED: {
    workbookRow: 63,
    workbookName: 'Tomato Red',
    energyKcal: 35,
    proteinG: 1.8,
    carbohydrateG: 5,
    fibreG: 2,
    fatG: 0.4,
  },

  // --- root (5) --- 
  // 59 kcal per 100 g.

  VEG_ARVI: {
    workbookRow: 21,
    workbookName: 'Arvi',
    energyKcal: 59,
    proteinG: 1.5,
    carbohydrateG: 12,
    fibreG: 2,
    fatG: 0.2,
  },

  VEG_CARROT_COUNTRY: {
    workbookRow: 36,
    workbookName: 'Carrot Country',
    energyKcal: 59,
    proteinG: 1.5,
    carbohydrateG: 12,
    fibreG: 2,
    fatG: 0.2,
  },

  VEG_RADISH: {
    workbookRow: 57,
    workbookName: 'Radish',
    energyKcal: 59,
    proteinG: 1.5,
    carbohydrateG: 12,
    fibreG: 2,
    fatG: 0.2,
  },

  VEG_TURNIP: {
    workbookRow: 64,
    workbookName: 'Turnip',
    energyKcal: 59,
    proteinG: 1.5,
    carbohydrateG: 12,
    fibreG: 2,
    fatG: 0.2,
  },

  POTATO_FRESH: {
    workbookRow: 90,
    workbookName: 'Potato',
    energyKcal: 59,
    proteinG: 1.5,
    carbohydrateG: 12,
    fibreG: 2,
    fatG: 0.2,
  },

  // --- leafy (2) --- 
  // 45 kcal per 100 g.

  VEG_LEEK: {
    workbookRow: 50,
    workbookName: 'Leek',
    energyKcal: 45,
    proteinG: 3.8,
    carbohydrateG: 5,
    fibreG: 2,
    fatG: 0.7,
  },

  VEG_SPRING_ONION: {
    workbookRow: 61,
    workbookName: 'Spring Onion',
    energyKcal: 45,
    proteinG: 3.8,
    carbohydrateG: 5,
    fibreG: 2,
    fatG: 0.7,
  },

  // --- fruit (12) --- 
  // 59 kcal per 100 g.

  FRUIT_APPLE_SHIMLA: {
    workbookRow: 121,
    workbookName: 'Apple Shimla',
    energyKcal: 59,
    proteinG: 1,
    carbohydrateG: 11,
    fibreG: 2,
    fatG: 0.6,
  },

  FRUIT_GRAPES_S_L: {
    workbookRow: 127,
    workbookName: 'Grapes S/L',
    energyKcal: 59,
    proteinG: 1,
    carbohydrateG: 11,
    fibreG: 2,
    fatG: 0.6,
  },

  FRUIT_KINNU: {
    workbookRow: 128,
    workbookName: 'Kinnu',
    energyKcal: 59,
    proteinG: 1,
    carbohydrateG: 11,
    fibreG: 2,
    fatG: 0.6,
  },

  FRUIT_MUSKMELON: {
    workbookRow: 130,
    workbookName: 'Muskmelon',
    energyKcal: 59,
    proteinG: 1,
    carbohydrateG: 11,
    fibreG: 2,
    fatG: 0.6,
  },

  FRUIT_SOUR_LIME: {
    workbookRow: 132,
    workbookName: 'Sour Lime',
    energyKcal: 59,
    proteinG: 1,
    carbohydrateG: 11,
    fibreG: 2,
    fatG: 0.6,
  },

  FRUIT_WATERMELON: {
    workbookRow: 133,
    workbookName: 'Watermelon',
    energyKcal: 59,
    proteinG: 1,
    carbohydrateG: 11,
    fibreG: 2,
    fatG: 0.6,
  },

  FRUIT_MANGO_DASHERI: {
    workbookRow: 135,
    workbookName: 'Mango Dasheri',
    energyKcal: 59,
    proteinG: 1,
    carbohydrateG: 11,
    fibreG: 2,
    fatG: 0.6,
  },

  FRUIT_MANGO_LANGRA: {
    workbookRow: 136,
    workbookName: 'Mango Langra',
    energyKcal: 59,
    proteinG: 1,
    carbohydrateG: 11,
    fibreG: 2,
    fatG: 0.6,
  },

  FRUIT_APRICOT: {
    workbookRow: 137,
    workbookName: 'Apricot',
    energyKcal: 59,
    proteinG: 1,
    carbohydrateG: 11,
    fibreG: 2,
    fatG: 0.6,
  },

  FRUIT_THAI_GUAVA: {
    workbookRow: 143,
    workbookName: 'Thai Guava',
    energyKcal: 59,
    proteinG: 1,
    carbohydrateG: 11,
    fibreG: 2,
    fatG: 0.6,
  },

  FRUIT_KIWI: {
    workbookRow: 144,
    workbookName: 'Kiwi',
    energyKcal: 59,
    proteinG: 1,
    carbohydrateG: 11,
    fibreG: 2,
    fatG: 0.6,
  },

  FRUIT_DRAGON_FRUIT: {
    workbookRow: 145,
    workbookName: 'Dragon Fruit',
    energyKcal: 59,
    proteinG: 1,
    carbohydrateG: 11,
    fibreG: 2,
    fatG: 0.6,
  },

  // --- spice (18) --- 
  // 240 kcal per 100 g.

  GMW_ANISE_SEEDS: {
    workbookRow: 171,
    workbookName: 'Anise Seeds',
    energyKcal: 240,
    proteinG: 8.5,
    carbohydrateG: 31,
    fibreG: 17,
    fatG: 10,
  },

  GMW_BAY_LEAF: {
    workbookRow: 172,
    workbookName: 'Bay Leaf',
    energyKcal: 240,
    proteinG: 8.5,
    carbohydrateG: 31,
    fibreG: 17,
    fatG: 10,
  },

  GMW_ASAFOETIDA: {
    workbookRow: 175,
    workbookName: 'Asafoetida',
    energyKcal: 240,
    proteinG: 8.5,
    carbohydrateG: 31,
    fibreG: 17,
    fatG: 10,
  },

  GMW_KASHMIRI_CHILLI: {
    workbookRow: 178,
    workbookName: 'Kashmiri Chilli',
    energyKcal: 240,
    proteinG: 8.5,
    carbohydrateG: 31,
    fibreG: 17,
    fatG: 10,
  },

  GMW_CINNAMON_STICK: {
    workbookRow: 180,
    workbookName: 'Cinnamon Stick',
    energyKcal: 240,
    proteinG: 8.5,
    carbohydrateG: 31,
    fibreG: 17,
    fatG: 10,
  },

  CND_EVEREST_CHILLY_POWDER: {
    workbookRow: 181,
    workbookName: 'Chilly Powder',
    energyKcal: 240,
    proteinG: 8.5,
    carbohydrateG: 31,
    fibreG: 17,
    fatG: 10,
  },

  CND_CORIANDER_POWDER: {
    workbookRow: 183,
    workbookName: 'Coriander Powder',
    energyKcal: 240,
    proteinG: 8.5,
    carbohydrateG: 31,
    fibreG: 17,
    fatG: 10,
  },

  CND_PANI_PURI_MASALA: {
    workbookRow: 185,
    workbookName: 'Pani Puri Masala',
    energyKcal: 240,
    proteinG: 8.5,
    carbohydrateG: 31,
    fibreG: 17,
    fatG: 10,
  },

  CND_SABJI_MASALA: {
    workbookRow: 186,
    workbookName: 'Sabji Masala',
    energyKcal: 240,
    proteinG: 8.5,
    carbohydrateG: 31,
    fibreG: 17,
    fatG: 10,
  },

  CND_TANDOORI_MASALA: {
    workbookRow: 187,
    workbookName: 'Tandoori Masala',
    energyKcal: 240,
    proteinG: 8.5,
    carbohydrateG: 31,
    fibreG: 17,
    fatG: 10,
  },

  CND_RASAM_MASALA: {
    workbookRow: 188,
    workbookName: 'Rasam Masala',
    energyKcal: 240,
    proteinG: 8.5,
    carbohydrateG: 31,
    fibreG: 17,
    fatG: 10,
  },

  CND_KITCHEN_KING_MASALA: {
    workbookRow: 189,
    workbookName: 'Kitchen King Masala',
    energyKcal: 240,
    proteinG: 8.5,
    carbohydrateG: 31,
    fibreG: 17,
    fatG: 10,
  },

  CND_GARAM_MASALA: {
    workbookRow: 191,
    workbookName: 'Garam Masala',
    energyKcal: 240,
    proteinG: 8.5,
    carbohydrateG: 31,
    fibreG: 17,
    fatG: 10,
  },

  CND_SHAHI_BIRYANI_MASALA: {
    workbookRow: 192,
    workbookName: 'Shahi Biryani Masala',
    energyKcal: 240,
    proteinG: 8.5,
    carbohydrateG: 31,
    fibreG: 17,
    fatG: 10,
  },

  CND_CHOLE_MASALA: {
    workbookRow: 193,
    workbookName: 'Chole Masala',
    energyKcal: 240,
    proteinG: 8.5,
    carbohydrateG: 31,
    fibreG: 17,
    fatG: 10,
  },

  CND_AMCHUR_MASALA: {
    workbookRow: 194,
    workbookName: 'Amchur Masala',
    energyKcal: 240,
    proteinG: 8.5,
    carbohydrateG: 31,
    fibreG: 17,
    fatG: 10,
  },

  CND_PAV_BHAJI_MASALA: {
    workbookRow: 196,
    workbookName: 'Pav Bhaji Masala',
    energyKcal: 240,
    proteinG: 8.5,
    carbohydrateG: 31,
    fibreG: 17,
    fatG: 10,
  },

  CND_SAMBAR_MASALA: {
    workbookRow: 197,
    workbookName: 'Sambar Masala',
    energyKcal: 240,
    proteinG: 8.5,
    carbohydrateG: 31,
    fibreG: 17,
    fatG: 10,
  },
};
