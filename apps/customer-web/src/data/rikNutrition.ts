/**
 * Nutrition information for RIK provisions — a LOOKUP, never a catalogue.
 *
 * THE LIVE CATALOGUE IS THE PRODUCT LIST. `GET /rik/catalogue` decides which
 * provisions exist, what they are called, whose brand they carry, what they
 * look like and how they are packed. This file holds nutrition and nothing
 * else. Nutrition eligibility controls ONLY whether a table appears on the
 * Nutrition Info page. It has never had, and must never acquire, any bearing
 * on catalogue membership, entitlement, availability or ordering.
 *
 * KEYED ON THE PROVISION CODE, never the database id. `rik_provisions_code_uq`
 * makes `code` unique and it survives a rename; the uuid differs between
 * environments, so a uuid-keyed file would mismatch silently the moment a
 * database is rebuilt.
 *
 * =====================================================================
 * NOT PUBLISHED YET. READ THIS BEFORE CHANGING THE FLAG.
 * =====================================================================
 *
 * `PUBLISH_COMPOSITION_TABLE_VALUES` is false, and until it is true NOTHING
 * in this file reaches a customer. `nutritionFor` returns null for every
 * composition-table record while the flag is off, so the Nutrition Info page
 * shows "Nutrition information currently unavailable." for every provision.
 *
 * The gate itself is `isPublishable`, which DENIES BY DEFAULT and decides one
 * evidence category at a time. Under the policy of 7 November 2026 only
 * 'manufacturer-declared' records may be shown; 'composition-table' waits on
 * the NIN letter, and 'approximate-reference' is never publishable.
 *
 * The flag is not a convenience. IFCT 2017's own copyright page permits
 * reproduction for personal use with acknowledgement, but withholds
 * permission for data to be "stored or reproduced in any electronic format
 * for creating a product" without the prior written permission of the
 * National Institute of Nutrition, Hyderabad. Shipping these figures inside
 * e-Samagri is exactly that. The flag turns true when, and only when, that
 * written permission exists. Turning it on without the letter is a licence
 * breach, not a release decision.
 *
 * =====================================================================
 * THE 51 RECORDS THEMSELVES NOW LIVE IN ./rikNutritionIfctWithheld
 * =====================================================================
 *
 * This module keeps the TYPES, the publication policy, the gate, the value
 * formatting and the value-free `ITEM_LEVEL_PROVISION_CODES` list. The 51
 * transcribed IFCT records, the `IFCT_FOODS` rows behind them and the `ifct()`
 * builder were moved to ./rikNutritionIfctWithheld on 9 November 2026, so that
 * they stop being bundled into the customer app.
 *
 * The reason, in one sentence: a closed runtime gate stops a figure being
 * DISPLAYED but not being SHIPPED, and while those records sat in the
 * `rikNutrition` map below — which `nutritionFor` reads, and which a customer
 * screen imports — the bundler had to include all 51 rows in plaintext,
 * gate or no gate.
 *
 * The sourcing notes that follow therefore describe data held in that module.
 * They are kept here because they document the RULES this feature is built on,
 * which the policy and the gate in this file still enforce.
 *
 * =====================================================================
 * WHERE THESE NUMBERS COME FROM
 * =====================================================================
 *
 * Longvah, T., Ananthan, R., Bhaskarachary, K. and Venkaiah, K. (2017).
 * Indian Food Composition Tables 2017, National Institute of Nutrition,
 * Indian Council of Medical Research, Hyderabad, Telangana, India.
 *
 * Every figure below was read from the printed tables of the official
 * NIN-hosted PDF, pages 41-55, on 6 November 2026. Each food records the
 * page it was read from. Nothing here is interpolated, averaged across
 * foods, or carried over from another table. Values are per 100 g edible
 * portion, raw, which is the convention IFCT states.
 *
 * The transcription was verified two ways before use:
 *
 *   PROXIMATE SUM. water + protein + ash + total fat + total dietary fibre
 *   + available carbohydrate sums to 100.00 (+/- 0.02) for all 51 foods. A
 *   misread or misaligned column cannot survive that test.
 *
 *   ENERGY CROSS-CHECK. The published kJ agrees with the proximates under
 *   the Atwater system to within the spread expected from IFCT's per-group
 *   factors (its Table 4). The published figure is what is stored; nothing
 *   here recomputes energy from nutrients, which is why only the sum test
 *   is treated as decisive.
 *
 * IFCT reports a standard deviation beside most figures (e.g. 1489+/-10).
 * The mean is stored, as the tables print it, and `sampleCount` records how
 * many samples it is a mean of. A single-sample food (n = 1) is marked as
 * such rather than quietly presented like a six-sample one.
 *
 * =====================================================================
 * ENERGY: PUBLISHED IN KILOJOULES, CONVERTED TO KILOCALORIES
 * =====================================================================
 *
 * IFCT 2017 section 3.6 (page 28) states that food energy is expressed in
 * kilojoules, Atwater-based, and gives the conversion itself: "Food energy
 * in kilojoules (kJ) can be converted using the formula 1 kcal = 4.18 kJ".
 * Page 41's column heading reads KJ over ENERC. There is no kcal column.
 *
 * So `energyKJ` is the published figure and `energyKcal` is derived from it
 * by `kcalFromKJ`, which applies NIN's own stated factor of 4.18 and nothing
 * else. That is an exact unit conversion of one published number, not an
 * estimate, and emphatically not energy calculated from nutrient contents —
 * which this file still refuses to do. Both figures are stored, both are
 * displayed, and the derived one is labelled as converted everywhere it
 * appears. If the conversion is ever questioned, `energyKJ` is the figure of
 * record.
 *
 * =====================================================================
 * WHICH PROVISIONS ARE HERE, AND WHY THE REST ARE NOT
 * =====================================================================
 *
 * The approved eligibility policy admits unbranded, single-ingredient raw
 * foods whose identity and state can be verified, and which have all four
 * mandatory fields: energy, carbohydrate, total fat and dietary fibre.
 * Protein is optional; it happens to be present for all 51.
 *
 * Excluded, by that policy:
 *
 *   BRANDED OR PACKAGED. Includes provision 006 (All Purpose Flour 1 kg),
 *   excluded by name, and the branded basmati rices, which IFCT has no row
 *   for in any case.
 *
 *   LOOSE COMMODITIES. Excluded outright by the 6 November decisions. This
 *   removed five dals that were High-confidence IFCT matches — see
 *   DELIBERATELY_UNMAPPED. They are excluded by policy, not for want of
 *   data, and reversing that decision restores them immediately.
 *
 *   PREPARED, MIXED OR BLENDED. Masala blends, proprietary formulations,
 *   and compounded asafoetida, which is cut with flour and gum while IFCT
 *   G019 is the pure resin.
 *
 *   AMBIGUOUS VARIETY OR PREPARATION STATE. Where IFCT splits a food by
 *   variety and the issued variety is unknown, there is no defensible single
 *   row to use. Apple, tomato, potato, watermelon, pumpkin, cucumber, snake
 *   gourd, cabbage, carrot "country", rajma, whole masoor and mushroom all
 *   sit here. Each becomes eligible the moment the facility states which
 *   variety it issues. These are PENDING, not refused.
 *
 * THE APPROXIMATE-REFERENCE VALUES ARE GONE. The 71 entries previously in
 * this file came from a reference table supplied on 24 October 2026 as
 * approximate ranges. They were never checked against a published source and
 * carried no energy at all. The approved policy forbids estimated values in a
 * verified nutrition display, so they have been removed and NOT replaced by
 * anything invented. The 'approximate-reference' data quality remains in the
 * type, unused, because removing it would discard the distinction that keeps
 * the three evidence categories from blurring.
 *
 * TWO CODES ARE NOT CATALOGUE PROVISIONS. '001' and '006' come from the Phase 1
 * research table and are not among the 190 approved provision codes. They are
 * treated as legacy research references and are never added to the catalogue.
 * See LEGACY_RESEARCH_CODES.
 *
 * If a reference food is not a defensible match for what an officer actually
 * receives, LEAVE IT OUT. A wrong match misleads exactly as much as a wrong
 * number.
 */

/** What a value describes, so a reader knows what they are comparing. */
export type NutritionState = 'raw' | 'dry' | 'fresh' | 'cooked' | 'ready-to-eat';

/** Where a record's figures came from. These are never used interchangeably. */
export type DataQuality = 'approximate-reference' | 'composition-table' | 'manufacturer-declared';

/** What the screen prints under a record, so the reader can judge the figures. */
export const DATA_QUALITY_LABELS: Readonly<Record<DataQuality, string>> = {
  'approximate-reference': 'Approximate reference values — may vary by food variety and product.',
  'composition-table': 'Transcribed from a published food-composition table.',
  'manufacturer-declared': 'As declared on this product’s label.',
};

/**
 * PUBLICATION GATE for IFCT-sourced figures. False until ICMR-NIN grants
 * written permission to store IFCT 2017 data electronically in this product.
 *
 * Do not flip this to shorten a demo. The licence condition is quoted in this
 * file's header.
 *
 * NOTE: this flag governs ONE evidence category. It is no longer the whole
 * gate — `isPublishable` below is, and it denies by default. Turning this
 * flag true releases composition-table records and nothing else.
 */
export const PUBLISH_COMPOSITION_TABLE_VALUES = false;

/**
 * WHAT MAY A CUSTOMER SEE? The whole publication policy, as data.
 *
 * DENY BY DEFAULT, AND BY CATEGORY. The previous gate asked only "is this a
 * composition-table record?", which meant any OTHER evidence category passed
 * straight through. That was a real hole: the preliminary food-group averages
 * in rikNutritionPreliminary.ts are `approximate-reference`, so under the old
 * rule they would have been shown to customers the moment anything wired them
 * in — with the IFCT flag still false and every existing test still green.
 *
 * WRITTEN AS A TABLE, NOT AS BRANCHES, for two reasons. A `Record` keyed on
 * DataQuality means a NEW evidence category cannot compile until somebody
 * decides what to do with it, so forgetting to decide fails the build instead
 * of leaking. And it makes the policy directly assertable: a test can read
 * that 'approximate-reference' is 'never' rather than trying to infer it from
 * behaviour, which is impossible to do honestly while the IFCT flag is false
 * (a fixed `false` and a flag-tracking `false` look identical).
 *
 *   'always'      publishable now, under the current policy.
 *   'never'       not publishable, and no flag releases it.
 *   'ifct-licence' publishable only once PUBLISH_COMPOSITION_TABLE_VALUES is
 *                 true, which waits on written permission from ICMR-NIN.
 */
export type PublicationRule = 'always' | 'never' | 'ifct-licence';

export const PUBLICATION_POLICY: Readonly<Record<DataQuality, PublicationRule>> = {
  /**
   * The product's own label: the maker's published statement about their own
   * product. Item-specific by definition, and carries no third-party licence
   * condition. The only category publishable under the current policy.
   */
  'manufacturer-declared': 'always',

  /**
   * Item-level IFCT 2017 figures. Accurate, and the right data — but NIN's
   * licence forbids shipping their figures inside a product without prior
   * written permission, so the flag below governs them.
   */
  'composition-table': 'ifct-licence',

  /**
   * Group averages and supplied approximations. NEVER publishable: they are
   * not item-specific, so showing one against a named product would misstate
   * what that product contains. Releasing any of these needs its own reviewed
   * decision and its own switch — deliberately NOT a reuse of the IFCT flag,
   * which answers an entirely different question.
   */
  'approximate-reference': 'never',
};

/** May this record be shown to a customer? */
export function isPublishable(record: NutritionRecord): boolean {
  switch (PUBLICATION_POLICY[record.dataQuality]) {
    case 'always':
      return true;
    case 'never':
      return false;
    case 'ifct-licence':
      return PUBLISH_COMPOSITION_TABLE_VALUES;
  }
}

/** The citation IFCT 2017 instructs users to give. Printed with every record. */
export const IFCT_CITATION =
  'Longvah, T., Ananthan, R., Bhaskarachary, K. and Venkaiah, K. (2017). ' +
  'Indian Food Composition Tables 2017, National Institute of Nutrition, ' +
  'Indian Council of Medical Research, Hyderabad, Telangana, India.';

/** The short source name shown on screen. */
export const IFCT_SOURCE = 'ICMR-NIN Indian Food Composition Tables 2017';

/**
 * NIN's own published conversion factor, from IFCT 2017 section 3.6:
 * "1 kcal = 4.18 kJ". Not 4.184, not 4.1868 — the figure the source states,
 * so the conversion is theirs and not ours.
 */
export const KJ_PER_KCAL = 4.18;

/**
 * Kilojoules to kilocalories, to one decimal place.
 *
 * One decimal because the published kJ are whole numbers and a second decimal
 * would imply precision the source does not offer. Exported so a test can
 * assert the factor and the rounding rather than trust them.
 */
export function kcalFromKJ(kj: number): number {
  return Math.round((kj / KJ_PER_KCAL) * 10) / 10;
}

/** A supplied range, e.g. protein 7-8 g. Kept whole; never averaged. */
export interface NutrientRange {
  readonly kind: 'range';
  readonly min: number;
  readonly max: number;
}

/** A value the source states as approximate, e.g. fat "~100 g" in a pure oil. */
export interface NutrientApprox {
  readonly kind: 'approx';
  readonly value: number;
}

/**
 * A nutrient value. A plain number is an EXACT figure — which is what every
 * record in this file now carries, because IFCT prints exact means. `range`
 * and `approx` remain for a future source that states one.
 */
export type NutrientValue = number | NutrientRange | NutrientApprox;

export function range(min: number, max: number): NutrientRange {
  return { kind: 'range', min, max };
}

export function approx(value: number): NutrientApprox {
  return { kind: 'approx', value };
}

/**
 * How a value reads on screen: '7-8 g', '~100 g', '0 g'.
 *
 * An en dash, not a hyphen, because this is a numeric range. There is no
 * branch that produces a midpoint.
 */
export function formatNutrient(value: NutrientValue, unit: string): string {
  if (typeof value === 'number') return `${value} ${unit}`;
  if (value.kind === 'approx') return `~${value.value} ${unit}`;
  return `${value.min}–${value.max} ${unit}`;
}

/**
 * The lowest figure a value admits — the only figure a "source of" claim may
 * be tested against, so that the claim holds across the whole supplied range
 * rather than only at its optimistic end.
 */
export function nutrientLowerBound(value: NutrientValue): number {
  if (typeof value === 'number') return value;
  if (value.kind === 'approx') return value.value;
  return value.min;
}

export interface NutritionRecord {
  /** Normally 'per 100 g edible portion'; 'per 100 ml' for liquids. Always stated. */
  readonly basis: string;
  /** Whether the figures describe the food raw, dry, fresh, cooked or ready to eat. */
  readonly state: NutritionState;
  /** The table or label the figures came from. */
  readonly source: string;
  /**
   * The reference food actually matched — this is what lets somebody audit
   * the match rather than trust it.
   */
  readonly sourceFood: string;
  /** Which of the three evidence categories this record belongs to. */
  readonly dataQuality: DataQuality;

  /** The source's own food code, e.g. IFCT 'A018'. Kept so a row is traceable. */
  readonly sourceCode?: string;
  /** The full citation the source requires. */
  readonly citation?: string;
  /** How many analysed samples the printed mean is drawn from. */
  readonly sampleCount?: number;
  /** The page of the printed source the figures were read from. */
  readonly printedPage?: number;

  /**
   * Every nutrient is OPTIONAL and absence means "the source does not support
   * this field". It never means zero. Undefined and 0 are different answers
   * and the screen renders them differently.
   */
  readonly energyKcal?: NutrientValue;
  /** The energy figure AS PUBLISHED. `energyKcal` is derived from this. */
  readonly energyKJ?: NutrientValue;
  readonly proteinG?: NutrientValue;
  readonly carbohydrateG?: NutrientValue;
  readonly fibreG?: NutrientValue;
  readonly fatG?: NutrientValue;
  readonly sugarsG?: NutrientValue;

  /** Anything a reader needs in order to read the figures correctly. */
  readonly notes?: string;
}

/**
 * Provision code to nutrition record — DELIBERATELY EMPTY.
 *
 * The 51 IFCT item-level records that used to sit here now live in
 * ./rikNutritionIfctWithheld, which no production module imports. The reason
 * is in that file's header, and the short version is this: a runtime gate
 * stops a figure being DISPLAYED, it does not stop it being SHIPPED. Because
 * `nutritionFor` below reads this map, and a customer screen imports
 * `nutritionFor`, every record in this map lands in the JavaScript we serve,
 * readable by anyone, gate or no gate.
 *
 * So the map is empty, and `nutritionFor` consequently returns null for every
 * provision. That is not a behaviour change: `PUBLISH_COMPOSITION_TABLE_VALUES`
 * is false and `isPublishable` already refused all 51, so no customer has ever
 * seen one of these figures. What changed is that they are no longer in the
 * bundle to be found.
 *
 * DO NOT REPOPULATE THIS MAP by importing ./rikNutritionIfctWithheld here.
 * That single import would put all 51 records back into the customer bundle
 * while every test still passed and the screen looked identical. If these
 * figures are ever cleared for publication, that is a policy decision taken
 * with the licence position recorded — see the end of the withheld module.
 *
 * The approved typical values from the workbook are a SEPARATE pathway with
 * its own control; see ./rikNutritionApproved. Nothing here releases those,
 * and nothing there releases these.
 */
export const rikNutrition: Readonly<Record<string, NutritionRecord>> = {};

/**
 * PROVISION CODES THAT ARE NOT APPROVED CATALOGUE PROVISIONS.
 *
 * '001' and '006' appear in the Phase 1 research table but are NOT among the
 * 190 approved provision codes seeded by migrations 0026, 0032 and 0053. They
 * are therefore treated as LEGACY RESEARCH REFERENCES, not active provisions:
 *
 *   - Neither is, or may become, a catalogue provision. Nothing here adds a
 *     code to the catalogue; the catalogue is defined by the database and
 *     served by `GET /rik/catalogue`, and this file cannot alter it.
 *   - Both are recorded in DELIBERATELY_UNMAPPED so the reason they carry no
 *     nutrition is written down rather than inferred.
 *   - Both are excluded on their own merits as well: '001' is a branded rice
 *     and '006' is a packaged flour.
 *
 * The orphan test in rik-nutrition.test.ts — which fails if the exclusion list
 * names a provision that does not exist — reads this map as its allowlist, so
 * a THIRD legacy code cannot be added without appearing here deliberately.
 */
export const LEGACY_RESEARCH_CODES: Readonly<Record<string, string>> = {
  '001': 'Research table only ("Rozana Basmathi Rice 5 kg"); not an approved catalogue provision.',
  '006': 'Research table only ("All Purpose Flour 1 kg"); not an approved catalogue provision.',
};

/**
 * Provisions deliberately left without nutrition, and the reason for each.
 *
 * COMPLETE AS OF 7 NOVEMBER 2026. Every one of the 139 approved catalogue
 * provisions that carries no nutrition record appears below, plus the two
 * legacy research codes. There is no unpublished provision whose absence is
 * undocumented, and a test asserts that — so the next person to exclude
 * something has to say why, in writing, here.
 *
 * A test also asserts that none of these appears in `rikNutrition`, so a
 * future well-meaning addition cannot quietly contradict a policy decision.
 * This map is documentation with teeth; it is not consulted at render time,
 * because a provision with no record already shows the unavailable message.
 */
export const DELIBERATELY_UNMAPPED: Readonly<Record<string, string>> = {
  // AMBIGUOUS VARIETY OR PREPARATION STATE — pending, not refused.
  //  IFCT splits each of these foods by variety and the issued variety is not
  //  recorded, so there is no defensible single row to use. Each becomes
  //  eligible the moment the facility states which variety it issues. These are
  //  the 22 PENDING provisions in the classification.
  CND_CORIANDER_POWDER:
    'Ambiguous variety or preparation state. Ground coriander seed; IFCT has no separate ' +
    'powder row. Becomes eligible once the issued variety is confirmed.',
  DAL_DALIYA:
    'Ambiguous variety or preparation state. Dalia = broken/bulgur wheat. Becomes eligible ' +
    'once the issued variety is confirmed.',
  DAL_L_MASOOR_DAL_WHOLE:
    'Ambiguous variety or preparation state. IFCT splits brown vs yellowish whole lentil; ' +
    'brown row used. Confirm which the facility issues. Becomes eligible once the issued ' +
    'variety is confirmed.',
  DAL_L_RAJMA:
    'Ambiguous variety or preparation state. IFCT splits rajmah black/brown/red; brown row ' +
    'used. Confirm variety. Becomes eligible once the issued variety is confirmed.',
  FRUIT_APPLE_SHIMLA:
    'Ambiguous variety or preparation state. IFCT splits big/small/green/Kashmir; "big" ' +
    'used. Becomes eligible once the issued variety is confirmed.',
  FRUIT_GRAPES_S_L:
    'Ambiguous variety or preparation state. Seedless; colour unstated, green row used. ' +
    'Becomes eligible once the issued variety is confirmed.',
  FRUIT_MUSKMELON:
    'Ambiguous variety or preparation state. IFCT splits orange/yellow flesh; orange used. ' +
    'Becomes eligible once the issued variety is confirmed.',
  FRUIT_THAI_GUAVA:
    'Ambiguous variety or preparation state. White-flesh guava row; Thai guava is normally ' +
    'white-fleshed. Becomes eligible once the issued variety is confirmed.',
  FRUIT_WATERMELON:
    'Ambiguous variety or preparation state. IFCT splits dark green (sugar baby) and pale ' +
    'green; dark green used. Becomes eligible once the issued variety is confirmed.',
  GMW_KASHMIRI_CHILLI:
    'Ambiguous variety or preparation state. IFCT has one dry red chilli row, not ' +
    'Kashmiri-specific. Becomes eligible once the issued variety is confirmed.',
  POTATO_FRESH:
    'Ambiguous variety or preparation state. IFCT splits brown-skin big/small and red skin; ' +
    'brown big used. Confirm. Becomes eligible once the issued variety is confirmed.',
  VEG_ARVI:
    'Ambiguous variety or preparation state. Colocasia. Extraction merged the name cell; ' +
    'values are from the F004 row. Becomes eligible once the issued variety is confirmed.',
  VEG_BEANS_FRENCH:
    'Ambiguous variety or preparation state. IFCT splits country and hybrid; country used. ' +
    'Becomes eligible once the issued variety is confirmed.',
  VEG_CABBAGE:
    'Ambiguous variety or preparation state. Green cabbage row. Becomes eligible once the ' +
    'issued variety is confirmed.',
  VEG_CARROT_COUNTRY:
    'Ambiguous variety or preparation state. IFCT has orange and red carrot; red used. ' +
    'Confirm which "country" denotes. Becomes eligible once the issued variety is ' +
    'confirmed.',
  VEG_CUCUMBER:
    'Ambiguous variety or preparation state. IFCT splits elongate/short/round; green ' +
    'elongate used. Becomes eligible once the issued variety is confirmed.',
  VEG_KUNDRI:
    'Ambiguous variety or preparation state. Kundru = kovai (ivy gourd); big row used. ' +
    'Becomes eligible once the issued variety is confirmed.',
  VEG_MUSHROOM:
    'Ambiguous variety or preparation state. Button mushroom, fresh. Confirm variety ' +
    'issued. Becomes eligible once the issued variety is confirmed.',
  VEG_PUMPKIN:
    'Ambiguous variety or preparation state. IFCT splits green cylindrical / orange round; ' +
    'green used. Becomes eligible once the issued variety is confirmed.',
  VEG_SNAKE_GUARD:
    'Ambiguous variety or preparation state. IFCT splits long pale/dark and short; short ' +
    'used. Becomes eligible once the issued variety is confirmed.',
  VEG_SPRING_ONION:
    'Ambiguous variety or preparation state. IFCT row is onion stalk. Becomes eligible once ' +
    'the issued variety is confirmed.',
  VEG_TOMATO_RED:
    'Ambiguous variety or preparation state. IFCT splits ripe hybrid and ripe local; hybrid ' +
    'used. Becomes eligible once the issued variety is confirmed.',

  // BRANDED OR PACKAGED — excluded under the agreed policy.
  //  The brand decides the exclusion: a manufacturer's own label is the only
  //  thing that can describe a branded pack. The five rices and provision 006
  //  were moved here from PENDING on 7 November 2026 for exactly that reason.
  '001':
    'Branded product; excluded under the agreed policy. Also a legacy research code: it ' +
    'appears in the Phase 1 research table as "Rozana Basmathi Rice 5 kg" but is NOT one of ' +
    'the 190 approved catalogue provisions, so it is a research reference rather than an ' +
    'active provision.',
  BG_AMUL_BUTTER: 'Branded/packaged - excluded from this phase by instruction.',
  BG_AMUL_GHEE: 'Branded/packaged - excluded from this phase by instruction.',
  CER_ATTA_AASHIRVAAD:
    'Branded packaged product - manufacturer label applies, not a generic composition row.',
  CER_ATTA_AMUL: 'Branded/packaged - excluded from this phase by instruction.',
  CER_ATTA_PILLSBURY: 'Branded packaged product - manufacturer label applies, not a generic composition row.',
  CER_BREAD_SANDWICH: 'Branded/packaged - excluded from this phase by instruction.',
  CER_MAGGI: 'Proprietary branded formulation - only the maker\'s label can describe it.',
  CER_RICE_HERITAGE:
    'Branded product; excluded under the agreed policy. IFCT also has no basmati-specific ' +
    'row, so no defensible match exists either way.',
  CER_RICE_ROZANA:
    'Branded product; excluded under the agreed policy. IFCT also has no basmati-specific ' +
    'row, so no defensible match exists either way.',
  CER_RICE_SONA_MASOORI:
    'Branded product; excluded under the agreed policy. Sona Masoori is a raw milled rice ' +
    'and "Bell" is a trade name, but the brand decides exclusion regardless of the match.',
  CER_RICE_SUPER_BASMATI:
    'Branded product; excluded under the agreed policy. IFCT also has no basmati-specific ' +
    'row, so no defensible match exists either way.',
  CH_PANEER: 'Branded/packaged - excluded from this phase by instruction.',
  CND_EVEREST_CHILLY_POWDER: 'Branded/packaged - excluded from this phase by instruction.',
  DAL_P_FORTUNE_BESAN: 'Branded/packaged - excluded from this phase by instruction.',
  DAL_P_TATA_ARHAR: 'Branded/packaged - excluded from this phase by instruction.',
  DAL_P_TATA_BLACK_CHANA: 'Branded/packaged - excluded from this phase by instruction.',
  DAL_P_TATA_KABULI_CHANA: 'Branded/packaged - excluded from this phase by instruction.',
  DAL_P_TATA_MASOOR_SPLIT: 'Branded/packaged - excluded from this phase by instruction.',
  DAL_P_TATA_MOONG_WHOLE: 'Branded/packaged - excluded from this phase by instruction.',
  DAL_P_TATA_MOONG_WITHOUT_SKIN: 'Branded/packaged - excluded from this phase by instruction.',
  DAL_P_TATA_PEAS_DRIED: 'Branded/packaged - excluded from this phase by instruction.',
  DAL_P_TATA_RAJMA: 'Branded/packaged - excluded from this phase by instruction.',
  DAL_P_TATA_URD_SPLIT: 'Branded/packaged - excluded from this phase by instruction.',
  DAL_P_TATA_URD_WITHOUT_SKIN: 'Branded/packaged - excluded from this phase by instruction.',
  NU_AMULPRO: 'Proprietary branded formulation - only the maker\'s label can describe it.',
  NU_BOOST: 'Proprietary branded formulation - only the maker\'s label can describe it.',
  NU_BOURNVITA: 'Proprietary branded formulation - only the maker\'s label can describe it.',
  NU_HORLICKS: 'Proprietary branded formulation - only the maker\'s label can describe it.',
  NU_MUESLI: 'Branded/packaged - excluded from this phase by instruction.',
  TEA_CHAHAT: 'Proprietary branded formulation - only the maker\'s label can describe it.',
  TEA_WAGH_BAKRI: 'Branded/packaged - excluded from this phase by instruction.',

  // LOOSE COMMODITIES — excluded by policy, not for want of data.
  //  All five were High-confidence IFCT matches. The data exists and is not
  //  used. Reversing that policy decision restores them immediately.
  DAL_L_CHANNA_DAL: 'Loose commodity — excluded by policy. IFCT match was High confidence; data exists.',
  DAL_L_DAL_ARHAR: 'Loose commodity — excluded by policy. IFCT match was High confidence; data exists.',
  DAL_L_MOONG_YELLOW: 'Loose commodity — excluded by policy. IFCT match was High confidence; data exists.',
  DAL_L_URD_DAL_WHOLE: 'Loose commodity — excluded by policy. IFCT match was High confidence; data exists.',
  DAL_L_URD_DAL_WITHOUT_SKIN:
    'Loose commodity — excluded by policy. IFCT match was High confidence; data exists.',

  // BLENDED, COMPOUNDED OR MIXED — no single food to describe.
  CND_AMCHUR_MASALA:
    'Blended masala - a mixture whose composition depends on its own recipe; no single IFCT ' +
    'food applies.',
  CND_CHANA_MASALA:
    'Blended masala - a mixture whose composition depends on its own recipe; no single IFCT ' +
    'food applies.',
  CND_CHICKEN_MASALA:
    'Blended masala - a mixture whose composition depends on its own recipe; no single IFCT ' +
    'food applies.',
  CND_CHOLE_MASALA:
    'Blended masala - a mixture whose composition depends on its own recipe; no single IFCT ' +
    'food applies.',
  CND_GARAM_MASALA:
    'Blended masala - a mixture whose composition depends on its own recipe; no single IFCT ' +
    'food applies.',
  CND_KITCHEN_KING_MASALA:
    'Blended masala - a mixture whose composition depends on its own recipe; no single IFCT ' +
    'food applies.',
  CND_PANI_PURI_MASALA:
    'Blended masala - a mixture whose composition depends on its own recipe; no single IFCT ' +
    'food applies.',
  CND_PAV_BHAJI_MASALA:
    'Blended masala - a mixture whose composition depends on its own recipe; no single IFCT ' +
    'food applies.',
  CND_RASAM_MASALA:
    'Blended masala - a mixture whose composition depends on its own recipe; no single IFCT ' +
    'food applies.',
  CND_SABJI_MASALA:
    'Blended masala - a mixture whose composition depends on its own recipe; no single IFCT ' +
    'food applies.',
  CND_SAMBAR_MASALA:
    'Blended masala - a mixture whose composition depends on its own recipe; no single IFCT ' +
    'food applies.',
  CND_SHAHI_BIRYANI_MASALA:
    'Blended masala - a mixture whose composition depends on its own recipe; no single IFCT ' +
    'food applies.',
  CND_SHAHI_PANEER_MASALA:
    'Blended masala - a mixture whose composition depends on its own recipe; no single IFCT ' +
    'food applies.',
  CND_TANDOORI_MASALA:
    'Blended masala - a mixture whose composition depends on its own recipe; no single IFCT ' +
    'food applies.',
  FRUIT_DRY: 'Not a single food - a mixture.',
  GMW_ASAFOETIDA:
    'Blended/compounded product — commercial asafoetida is cut with flour and gum; IFCT ' +
    'G019 is pure resin.',

  // PREPARED OR PROCESSED — IFCT Table 1 holds no equivalent.
  CER_BREAD_BROWN:
    'Processed bakery/noodle product - IFCT Table 1 holds no equivalent; composition ' +
    'depends on the recipe.',
  CER_BREAD_MULTIGRAIN:
    'Processed bakery/noodle product - IFCT Table 1 holds no equivalent; composition ' +
    'depends on the recipe.',
  CER_BREAD_PAV:
    'Processed bakery/noodle product - IFCT Table 1 holds no equivalent; composition ' +
    'depends on the recipe.',
  CER_BURGER_BUN:
    'Processed bakery/noodle product - IFCT Table 1 holds no equivalent; composition ' +
    'depends on the recipe.',
  CER_CREAM_ROLL:
    'Processed bakery/noodle product - IFCT Table 1 holds no equivalent; composition ' +
    'depends on the recipe.',
  CER_CUP_CAKE:
    'Processed bakery/noodle product - IFCT Table 1 holds no equivalent; composition ' +
    'depends on the recipe.',
  CER_HAKKA_NOODLES:
    'Processed bakery/noodle product - IFCT Table 1 holds no equivalent; composition ' +
    'depends on the recipe.',
  CER_PIZZA_BASE:
    'Processed bakery/noodle product - IFCT Table 1 holds no equivalent; composition ' +
    'depends on the recipe.',
  CER_RUSK:
    'Processed bakery/noodle product - IFCT Table 1 holds no equivalent; composition ' +
    'depends on the recipe.',

  // NO SOURCEABLE IFCT ROW — a mandatory field cannot be obtained.
  //  Either the food has no Table 1 row at all, or its IFCT group publishes no
  //  dietary fibre or carbohydrate, which fails a mandatory field outright.
  CER_MILLETS:
    'Ambiguous: IFCT has separate rows for bajra, jowar, ragi, samai and varagu. Needs the ' +
    'specific millet.',
  CH_BLOCK: 'Cheese is not in IFCT Table 1; the only dairy rows (L group) carry no fibre or carbohydrate.',
  CH_MOZZARELLA:
    'Cheese is not in IFCT Table 1; the only dairy rows (L group) carry no fibre or ' +
    'carbohydrate.',
  CH_SLICES: 'Cheese is not in IFCT Table 1; the only dairy rows (L group) carry no fibre or carbohydrate.',
  CH_SPREAD: 'Cheese is not in IFCT Table 1; the only dairy rows (L group) carry no fibre or carbohydrate.',
  CH_TIN: 'Cheese is not in IFCT Table 1; the only dairy rows (L group) carry no fibre or carbohydrate.',
  CND_GARLIC:
    'IFCT garlic rows are FRESH garlic (G011-G013). Dry garlic is a different state; raw ' +
    'values must not be used.',
  COFFEE_COLUMBIAN: 'No IFCT Table 1 row for tea or coffee.',
  DAL_CORNFLAKES: 'No IFCT Table 1 row for this processed product.',
  DAL_CORN_FLOUR: 'No IFCT Table 1 row for this processed product.',
  DAL_CUSTARD: 'No IFCT Table 1 row for this processed product.',
  DAL_L_KABULI_CHANA:
    'IFCT B002 "Bengal gram, whole" is the desi/kala chana. Kabuli (white) chickpea is a ' +
    'different cultivar and IFCT lists no separate row. REQUIRES MANUAL CONFIRMATION before ' +
    'any match is accepted.',
  DAL_OATS: 'No IFCT Table 1 row for this processed product.',
  DAL_SAGO: 'No IFCT Table 1 row for this processed product.',
  EGGS_TABLE: 'IFCT M group publishes no dietary fibre or carbohydrate - fails two mandatory nutrients.',
  FRUIT_APRICOT:
    'IFCT has dried and processed apricot only; a fresh apricot row does not exist. State ' +
    'mismatch.',
  FRUIT_DRAGON_FRUIT: 'No IFCT Table 1 row.',
  FRUIT_KINNU: 'Kinnow is not in IFCT; the orange-pulp row is a different fruit and must not be substituted.',
  FRUIT_KIWI: 'No IFCT Table 1 row.',
  FRUIT_MANGO_DASHERI:
    'IFCT lists banganapalli, gulabkhas, himsagar, kesar, neelam, paheri and totapari only ' +
    '- not dasheri or langra.',
  FRUIT_MANGO_LANGRA:
    'IFCT lists banganapalli, gulabkhas, himsagar, kesar, neelam, paheri and totapari only ' +
    '- not dasheri or langra.',
  FRUIT_SOUR_LIME:
    'IFCT E033 is lemon JUICE and its fibre columns are blank; sour lime fruit is not the ' +
    'same food.',
  GMW_ANISE_SEEDS: 'No IFCT Table 1 row for this spice.',
  GMW_BAY_LEAF: 'No IFCT Table 1 row for this spice.',
  GMW_CINNAMON_STICK: 'No IFCT Table 1 row for this spice.',
  JAGGERY:
    'IFCT I001 Jaggery cane publishes no dietary fibre (below detectable limit) - fails a ' +
    'mandatory nutrient.',
  MEAT_CHICKEN: 'IFCT N/O/P groups publish no dietary fibre or carbohydrate - fails two mandatory nutrients.',
  MEAT_FISH: 'IFCT N/O/P groups publish no dietary fibre or carbohydrate - fails two mandatory nutrients.',
  MEAT_MUTTON: 'IFCT N/O/P groups publish no dietary fibre or carbohydrate - fails two mandatory nutrients.',
  MILK_FRESH:
    'IFCT L group publishes no dietary fibre - fails a mandatory nutrient. Milkmaid ' +
    '(condensed) has no row at all.',
  MILK_FRESH_COUPON:
    'IFCT L group publishes no dietary fibre - fails a mandatory nutrient. Milkmaid ' +
    '(condensed) has no row at all.',
  MILK_TD:
    'IFCT L group publishes no dietary fibre - fails a mandatory nutrient. Milkmaid ' +
    '(condensed) has no row at all.',
  OIL_GROUNDNUT: 'Edible oils are not in IFCT Table 1 (no fibre or carbohydrate columns apply).',
  OIL_MUSTARD_1000: 'Edible oils are not in IFCT Table 1 (no fibre or carbohydrate columns apply).',
  OIL_MUSTARD_500: 'Edible oils are not in IFCT Table 1 (no fibre or carbohydrate columns apply).',
  OIL_RICE_BRAN: 'Edible oils are not in IFCT Table 1 (no fibre or carbohydrate columns apply).',
  OIL_SUNFLOWER_1000: 'Edible oils are not in IFCT Table 1 (no fibre or carbohydrate columns apply).',
  OIL_SUNFLOWER_500: 'Edible oils are not in IFCT Table 1 (no fibre or carbohydrate columns apply).',
  POTATO_ALT_VEGETABLES: 'Entitlement substitution placeholder, not a specific food.',
  SALT_TABLE: 'No IFCT Table 1 row for refined sugar or salt.',
  SUGAR: 'No IFCT Table 1 row for refined sugar or salt.',
  VEG_ASPARAGUS: 'No IFCT Table 1 row for this vegetable.',
  VEG_BEANS_LONG: 'No IFCT Table 1 row for this vegetable.',
  VEG_BITTER_GUARD:
    'IFCT splits this gourd into several shape/colour rows; the provision does not say ' +
    'which.',
  VEG_BOTTLE_GUARD:
    'IFCT splits this gourd into several shape/colour rows; the provision does not say ' +
    'which.',
  VEG_BROCCOLI: 'No IFCT Table 1 row for this vegetable.',
  VEG_COWPEAS: 'No IFCT Table 1 row for this vegetable.',
  VEG_FRESH: 'Frozen/mixed product - IFCT foods are raw; state mismatch, and mixes have no single row.',
  VEG_LEEK: 'No IFCT Table 1 row for this vegetable.',
  VEG_MARROW: 'No IFCT Table 1 row for this vegetable.',
  VEG_RADISH:
    'IFCT splits radish four ways (elongate/round x red/white skin); the provision does not ' +
    'say which.',
  VEG_TURNIP: 'No IFCT Table 1 row for this vegetable.',

  // GENERIC OR PLACEHOLDER PROVISIONS — they name no single food.
  COFFEE_LOOSE:
    'A loose commodity, excluded by policy, and a generic provision that names no single ' +
    'food for a composition row to describe.',
  FRUIT_FRESH:
    'A generic placeholder covering whatever fruit is issued that period. It names no ' +
    'single food, so no composition row can describe it.',
  OIL_HYDROGENATED:
    'Edible oils and fats are not in IFCT Table 1, so the mandatory carbohydrate and ' +
    'dietary fibre fields cannot be sourced at all.',
  TEA_LOOSE:
    'A loose commodity, excluded by policy, and a generic provision that names no single ' +
    'food for a composition row to describe.',

  // LEGACY RESEARCH CODES — not approved catalogue provisions.
  //  See LEGACY_RESEARCH_CODES above.
  '006':
    'Packaged product (1 kg pack); excluded by name in the approved decisions. The same ' +
    'food as CER_MAIDA. Also a legacy research code: it is NOT one of the 190 approved ' +
    'catalogue provisions.',
};

/**
 * The record for a provision, or null.
 *
 * THE PUBLICATION GATE LIVES HERE, deliberately at the single point every
 * screen goes through, rather than in the page. Nothing a caller can do
 * reaches a record that `isPublishable` rejects — including a caller written
 * by somebody who has never read this file.
 */
export function nutritionFor(code: string): NutritionRecord | null {
  const record = rikNutrition[code];
  if (record === undefined) return null;
  if (!isPublishable(record)) return null;
  return record;
}

/**
 * THE PROVISIONS THAT HOLD AN ITEM-LEVEL RECORD — codes only, no values.
 *
 * A plain list of our own provision codes. It carries no nutrient data and no
 * third-party content, so it is safe to ship even while the records themselves
 * are withheld, which is exactly why it exists as a separate list rather than
 * being derived from the record map.
 *
 * It backs one rule: a provision that HAS a measured value is never shown a
 * food-group average in its place, not even while that value is withheld. On
 * the 51 provisions holding both, the average is out by a median 38% and by up
 * to 467% (green chilli reads 240 kcal against a measured 42.3, having been
 * given the dried-spice proxy). Falling back would publish the figure we know
 * to be wrong while the accurate one waits on permission.
 */
export const ITEM_LEVEL_PROVISION_CODES: ReadonlySet<string> = new Set([
  'CER_MAIDA', 'DAL_SEMOLINA', 'CND_CORIANDER_SEEDS',
  'CND_CUMIN_SEEDS', 'CND_TAMARIND', 'CND_TURMERIC_POWDER',
  'FRUIT_BANANA_ROBUSTA', 'FRUIT_CHICKOO', 'FRUIT_CUSTARD_APPLE',
  'FRUIT_GRAPES_BLACK_S_L', 'FRUIT_LITCHI', 'FRUIT_MANGO_BANGANPALLI',
  'FRUIT_MUSAMBI_SWEET_LEMON', 'FRUIT_ORANGE', 'FRUIT_PAPAYA',
  'FRUIT_PEARS', 'FRUIT_PINEAPPLE', 'FRUIT_PLUM',
  'FRUIT_POMEGRANATE', 'FRUIT_STRAWBERRY', 'VEG_BABY_CORN',
  'VEG_BEETROOT', 'VEG_BRINJAL_PURPLE_AND_GREEN', 'VEG_CAPSICUM',
  'VEG_CAPSICUM_RED', 'VEG_CAPSICUM_YELLOW', 'VEG_CARROT_RED',
  'VEG_CAULIFLOWER', 'VEG_CHILLY_GREEN', 'VEG_CLUSTER_BEANS',
  'VEG_CORIANDER_GREEN', 'VEG_CURRY_LEAVES', 'VEG_DRUM_STICK',
  'VEG_GINGER_GREEN', 'VEG_KHOL_KHOL', 'VEG_LADIE_S_FINGER',
  'VEG_MINT_GREEN', 'VEG_PARWAL', 'VEG_PEAS_GREEN',
  'VEG_RIBBED_GUARD', 'VEG_SPINACH_COUNTRY', 'VEG_TINDA',
  'VEG_ZIMIKAND', 'GMW_AJWAIN', 'GMW_CLOVES',
  'GMW_FENUGREEK', 'GMW_LARGE_CARDAMOM', 'GMW_POPPY_SEEDS',
  'GMW_WHOLE_PEPPER', 'GARLIC_FRESH', 'ONION_FRESH',
]);

/**
 * Does this provision have an item-level record at all?
 *
 * Deliberately value-free: it answers existence, not content, so it leaks
 * nothing through any gate.
 */
export function hasItemLevelRecord(code: string): boolean {
  return ITEM_LEVEL_PROVISION_CODES.has(code);
}

/**
 * The provision codes that currently yield a record — which is to say, the
 * codes a screen can actually display. Empty while the publication gate is
 * closed. Audit the full set through `rikNutrition` instead.
 */
export function nutritionCodes(): readonly string[] {
  return Object.keys(rikNutrition).filter((code) => nutritionFor(code) !== null);
}

/**
 * The rows the table prints, in order, with their labels and the units they
 * are expressed in.
 *
 * Energy leads because it is what most readers look for first, and the
 * published kilojoule figure sits immediately under the converted kcal so the
 * two are read together and the conversion is never invisible.
 */
export const NUTRIENT_ROWS = [
  { key: 'energyKcal', label: 'Energy (converted)', unit: 'kcal' },
  { key: 'energyKJ', label: 'Energy (as published)', unit: 'kJ' },
  { key: 'proteinG', label: 'Protein', unit: 'g' },
  { key: 'carbohydrateG', label: 'Carbohydrate', unit: 'g' },
  { key: 'fibreG', label: 'Dietary fibre', unit: 'g' },
  { key: 'fatG', label: 'Total fat', unit: 'g' },
  { key: 'sugarsG', label: 'Total sugars', unit: 'g' },
] as const satisfies ReadonlyArray<{ key: keyof NutritionRecord; label: string; unit: string }>;

/**
 * A nutrition-content description, or none.
 *
 * ONLY TWO ARE OFFERED, and each applies a published threshold to a value
 * this file actually holds — the EU/Codex nutrition-claim conditions, which
 * are the usual basis for "source of" wording on a label:
 *
 *   source of dietary fibre   >= 3 g fibre per 100 g
 *   source of protein  >= 12% of energy from protein
 *
 * WITH A RANGE, THE TEST IS AGAINST ITS LOWEST FIGURE, so the claim holds
 * everywhere in the range the source allows rather than only at its
 * flattering end. A range of 2-5 g fibre earns no claim.
 *
 * They describe COMPOSITION and nothing else. No claim is made, or ever
 * should be made here, about preventing, treating or curing anything — and
 * where the underlying value is absent, there is no description at all,
 * because a claim with no number behind it is exactly what this feature must
 * not produce.
 */
export function nutritionDescriptions(record: NutritionRecord): readonly string[] {
  const descriptions: string[] = [];

  if (record.fibreG !== undefined && nutrientLowerBound(record.fibreG) >= 3) {
    descriptions.push('Source of dietary fibre');
  }

  if (record.proteinG !== undefined && record.energyKcal !== undefined) {
    const protein = nutrientLowerBound(record.proteinG);
    const energy = nutrientLowerBound(record.energyKcal);
    // 4 kcal per gram of protein is the standard Atwater factor.
    if (energy > 0 && (protein * 4) / energy >= 0.12) descriptions.push('Source of protein');
  }

  return descriptions;
}
