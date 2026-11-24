/**
 * THE PUBLICATION REVIEW BEHIND THE APPROVED TYPICAL VALUES — TEST-ONLY.
 *
 * NO PRODUCTION MODULE IMPORTS THIS FILE, and that is the point: it is the
 * written reasoning for every publication decision, which is worth keeping and
 * is of no use to a customer's browser. Keeping it out of the import graph
 * keeps several kilobytes of prose out of the bundle, and
 * nutrition-ifct-bundle-exclusion.test.ts fails if a screen ever imports it.
 *
 * =====================================================================
 * THE DECISION THIS RECORDS
 * =====================================================================
 *
 * Approximate typical values from the workbook are approved for customer
 * display for every suitable, confidently matched product, so that customers
 * stop seeing "unavailable" where a reasonable figure exists. Food-group
 * averages are acceptable. Packaging is not a reason to exclude. The decision
 * does not extend to assigning a product the average of a food group it does
 * not belong to, nor to guessing at a product that cannot be matched.
 *
 * So each of the 129 workbook records that could have been published is either
 * APPROVED, with the food group whose average it carries and a written reason
 * why that group describes it, or EXCLUDED, with a written reason why it does
 * not. A test asserts every one of the 129 appears in exactly one of the two,
 * so neither list can quietly grow a gap.
 *
 * =====================================================================
 * THE TWO CATEGORIES THAT ARE NOT REVIEWED HERE
 * =====================================================================
 *
 * 51 PROVISIONS HOLD A MEASURED, ITEM-LEVEL RECORD. They are not candidates
 * for a group average at all: a provision with a measurement must never be
 * shown an average instead. Over those 51 the group average is out by a median
 * 38% and by up to 467% — green chilli reads 240 kcal against a measured
 * 42.3, having been given the dried-spice proxy — so falling back would publish
 * the figure already known to be wrong. Their own measured values stay withheld
 * while the composition-table licence position is unresolved, which is why
 * those provisions still show as unavailable.
 *
 * 4 WORKBOOK RECORDS CARRY NO ESTABLISHED VALUES (salt and three teas and
 * coffees, basis "Not established"). There is nothing to publish.
 */

/**
 * Food group to the reason its average is accepted as an approximation for the
 * products assigned to it.
 */
export const TYPICAL_VALUE_GROUP_RATIONALE: Readonly<Record<string, string>> = {
  'oil':
    'Refined edible oil is very nearly pure fat, which makes the group nutritionally ' +
    'homogeneous: 900 kcal and 100 g fat hold for any of these oils, and the zeros for ' +
    'protein, carbohydrate and fibre are real values rather than gaps.',
  'sugar':
    'Refined sugar and jaggery are both very nearly all sucrose, so the group average ' +
    'describes either within a few per cent. Jaggery carries some moisture and minerals, ' +
    'which is why it is an approximation and not a measurement.',
  'egg':
    'The workbook\'s egg group is a single food, so the group average and the item value ' +
    'are the same number. Unbranded, unprocessed, one ingredient, no variety question.',
  'milk':
    'Fresh liquid milk is what the group describes, so the average applies directly.',
  'milk products':
    'Cheeses and paneer cluster near the group average. The concentrated milk fats and ' +
    'the malted beverage powders in the same workbook category do not, and are excluded ' +
    'rather than described by it.',
  'meat':
    'Red meat and poultry cluster near the group average, though cut, trim and skin move ' +
    'any individual piece around it.',
  'fish':
    'Finfish cluster near the group average on energy and protein, well clear of the ' +
    'meat group, and the single fish line in the catalogue is not specific to a species.',
  'cereal':
    'Dry cereal grains and their plain flours cluster tightly on energy and on all four ' +
    'mandatory macronutrients. Baked, fried, sweetened or compounded cereal products do ' +
    'not, and are excluded.',
  'millet':
    'The product is itself named at food-group level ("Millets"), so the millet group ' +
    'average and the item value are the same thing.',
  'pulse':
    'Dry pulses and plain pulse flours cluster tightly on energy and macronutrients, ' +
    'whether sold loose or in a standard pack.',
  'vegetable':
    'Fresh non-starchy vegetables cluster at low energy and high water, so the group ' +
    'average is the right order of magnitude for every one of them. Individual items vary ' +
    'within the group — a watermelon-like water content sits below the average and a ' +
    'dense pod sits above it — which is what the customer-facing note is for.',
  'root':
    'Roots and tubers cluster above leafy and fruiting vegetables on carbohydrate and ' +
    'energy, and the group average separates them from those lighter vegetables.',
  'leafy':
    'Leafy greens and alliums used as greens cluster at low energy, and the group average ' +
    'describes that cluster.',
  'fruit':
    'Fresh fruit clusters at low energy with sugars as the main contributor. Individual ' +
    'items vary within the group, the very watery ones most of all.',
  'spice':
    'Dried spices cluster on energy, and a spice blend is still a spice. These are the ' +
    'coarsest estimates in the set: a blend\\u2019s energy moves with its recipe and ' +
    'especially with how much salt it carries, which no group average can capture.',
};

/**
 * The workbook records NOT approved for display, and why. Each had a usable
 * figure and no measured record, so each is a deliberate decision rather than
 * an absence of data.
 */
export const EXCLUDED_FROM_TYPICAL_VALUES: Readonly<Record<string, string>> = {
  BG_AMUL_GHEE:
    'Nearly pure milk fat: about 900 kcal and 100 g fat per 100 g. The mixed-dairy ' +
    'average of 337 kcal and 18.6 g fat understates the fat roughly fivefold.',
  BG_AMUL_BUTTER:
    'About 717 kcal and 81 g fat per 100 g — the same mismatch with the mixed-dairy ' +
    'average as ghee.',
  VEG_COWPEAS:
    'Listed as a fresh vegetable but given the dried-pulse average. Fresh pods are ' +
    'roughly a seventh of that energy, so the two readings cannot both be right.',
  NU_AMULPRO:
    'A malted beverage powder, mostly malt extract and sugar with some milk solids. The ' +
    'mixed-dairy average misstates the fat in particular.',
  NU_HORLICKS:
    'See NU_AMULPRO — a malted beverage powder against a mixed-dairy average.',
  NU_BOURNVITA:
    'See NU_AMULPRO — a malted beverage powder against a mixed-dairy average.',
  NU_BOOST:
    'See NU_AMULPRO — a malted beverage powder against a mixed-dairy average.',
  NU_MUESLI:
    'A compounded mix of grains, nuts, dried fruit and sugar. The cereal average carries ' +
    'almost no fat and would understate both fat and energy.',
  DAL_DALIYA:
    'Broken wheat — a cereal — carrying the pulse average. The numbers happen to sit ' +
    'close together, but the group assignment is wrong and would not survive a workbook ' +
    'revision.',
  POTATO_ALT_VEGETABLES:
    'An entitlement placeholder — "Fresh Vegetables in lieu of potato" — not a named ' +
    'food. Whatever is actually issued decides the nutrition, so no food group applies to ' +
    'the line itself.',
  CER_BREAD_SANDWICH:
    'Baked and hydrated. Bread is roughly a third water, so the dry-flour cereal average ' +
    'overstates its energy by about that much.',
  CER_BREAD_BROWN:
    'See CER_BREAD_SANDWICH — baked and hydrated against a dry-flour average.',
  CER_BREAD_MULTIGRAIN:
    'See CER_BREAD_SANDWICH — baked and hydrated against a dry-flour average.',
  CER_BREAD_PAV:
    'See CER_BREAD_SANDWICH — baked and hydrated against a dry-flour average.',
  CER_RUSK:
    'Twice-baked and drier than bread, so the dry-flour cereal average does not describe ' +
    'it either — in the opposite direction from the breads.',
  CER_CUP_CAKE:
    'Fat and sugar are added in quantity. The cereal average is nearly fat-free and would ' +
    'understate the fat badly.',
  CER_PIZZA_BASE:
    'Baked, proved and hydrated; the same mismatch with a dry-flour average as the ' +
    'breads.',
  CER_CREAM_ROLL:
    'See CER_CUP_CAKE — added fat and sugar against a nearly fat-free average.',
  CER_BURGER_BUN:
    'See CER_BREAD_SANDWICH — baked and hydrated against a dry-flour average.',
  CER_RICE_SONA_MASOORI:
    'Rice — a cereal — carrying the pulse average. Same misassignment as DAL_DALIYA.',
  CER_MAGGI:
    'Fried instant noodles. Energy and fat both sit far above the cereal average.',
  CER_HAKKA_NOODLES:
    'The workbook does not establish whether these are fried or plain dried noodles, and ' +
    'the two differ by roughly a third on energy. Not reliably matched.',
  FRUIT_DRY:
    '"Dry Fruits" is an unspecified assortment. Almonds, raisins and dates differ by more ' +
    'than twofold on energy, so no single figure describes the product.',
  MILK_TD:
    '"Milk TD / Milkmaid" is ambiguous, and sweetened condensed milk runs about 320 kcal ' +
    'against the fresh-milk average of 72. Not reliably matched.',
  CND_SHAHI_PANEER_MASALA:
    'A spice blend carrying the milk-products average, presumably from its name. It is a ' +
    'masala, not a dairy product.',
  CND_CHICKEN_MASALA:
    'A spice blend carrying the meat average, presumably from its name. It is a masala, ' +
    'not meat.',
  CND_CHANA_MASALA:
    'A spice blend carrying the pulse average, presumably from its name. It is a masala, ' +
    'not a pulse.',
  CND_GARLIC:
    'The catalogue carries fresh garlic separately, with a measured value. Whether this ' +
    '100 g condiment line is dried or powdered garlic or the fresh bulb is not ' +
    'established, and the two differ by about 2.7x on energy.',
};

/** Counts the review reconciles to, asserted by the tests. */
export const REVIEW_TOTALS = {
  workbookRecords: 184,
  withoutEstablishedValues: 4,
  holdingMeasuredRecords: 51,
  candidates: 129,
  approved: 101,
  excluded: 28,
} as const;
