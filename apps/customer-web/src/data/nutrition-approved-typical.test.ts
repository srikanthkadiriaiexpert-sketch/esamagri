import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import {
  hasItemLevelRecord,
  isPublishable,
  ITEM_LEVEL_PROVISION_CODES,
  nutritionCodes,
  nutritionFor,
  PUBLICATION_POLICY,
  PUBLISH_COMPOSITION_TABLE_VALUES,
} from './rikNutrition';
import { rikNutritionIfctWithheld as rikNutrition } from './rikNutritionIfctWithheld';
import {
  APPROVED_TYPICAL_VALUES,
  type ApprovedTypicalValue,
} from './rikNutritionApprovedValues';
import {
  EXCLUDED_FROM_TYPICAL_VALUES,
  REVIEW_TOTALS,
  TYPICAL_VALUE_GROUP_RATIONALE,
} from './rikNutritionTypicalValueReview';
import {
  PRELIMINARY_DATA_QUALITY,
  preliminaryNutritionFor,
  PUBLISH_PRELIMINARY_GROUP_AVERAGES,
  rikNutritionPreliminary,
} from './rikNutritionPreliminary';
import {
  APPROVED_TYPICAL_VALUE_PROVISIONS,
  approvedTypicalCodes,
  approvedTypicalNutritionFor,
  PUBLISH_APPROVED_TYPICAL_VALUES,
  TYPICAL_VALUES_DISCLAIMER,
} from './rikNutritionApproved';

/**
 * THE APPROVED TYPICAL-VALUE PATHWAY.
 *
 * Eight provisions are published from the workbook, by the decision of
 * 9 November 2026, because for each of them the food group is nutritionally
 * homogeneous — refined oil is nearly pure fat, refined sugar nearly pure
 * sucrose, the "egg" group one food — so the group average and the item value
 * coincide. The other 176 records stay unavailable.
 *
 * What this file has to prove is narrower than "it works": that the pathway
 * cannot widen on its own. The dangerous failure is not a wrong number on
 * screen, it is the list quietly growing, or the category rule being widened
 * to make an inconsistency go away.
 */

const APPROVED = [
  'EGGS_TABLE',
  'OIL_GROUNDNUT',
  'OIL_RICE_BRAN',
  'OIL_SUNFLOWER_500',
  'OIL_SUNFLOWER_1000',
  'OIL_MUSTARD_500',
  'OIL_MUSTARD_1000',
  'SUGAR',
] as const;

/**
 * THE ALLOWLIST NOW HOLDS 101 PROVISIONS, NOT 8.
 *
 * The original eight were approved on 9 November. On 10 November approximate
 * typical values were approved for every suitable, confidently matched product,
 * so that customers stop seeing "unavailable" where a reasonable figure exists.
 * The eight are still there, inside the 101.
 *
 * What did NOT change is that the list is explicit. 28 workbook records still
 * carry a usable figure and are still not published, because their food group
 * would misdescribe them; 51 hold a measured value that must not be downgraded;
 * 4 have no established values at all. Every one of those decisions is written
 * down in rikNutritionTypicalValueReview and checked below.
 */
describe('the approved list is exactly the reviewed list', () => {
  it('holds 101 provisions, and the original eight are among them', () => {
    expect(Object.keys(APPROVED_TYPICAL_VALUE_PROVISIONS)).toHaveLength(101);
    for (const code of APPROVED) {
      expect(APPROVED_TYPICAL_VALUE_PROVISIONS[code], `${code} must still be approved`).toBeDefined();
      expect(approvedTypicalNutritionFor(code), code).not.toBeNull();
    }
  });

  it('publishes every provision on the list and nothing else', () => {
    expect([...approvedTypicalCodes()].sort()).toEqual(
      Object.keys(APPROVED_TYPICAL_VALUE_PROVISIONS).sort()
    );
  });

  it('records the food group for each, and the group is the workbook\'s own', () => {
    // The map may never reassign a product to a different food group than the
    // workbook put it in — that is what "do not assign unrelated food-group
    // values" means in code.
    for (const [code, group] of Object.entries(APPROVED_TYPICAL_VALUE_PROVISIONS)) {
      expect(rikNutritionPreliminary[code]?.foodGroupProxy, `${code} group`).toBe(group);
    }
  });

  it('justifies every food group in writing', () => {
    const groups = new Set(Object.values(APPROVED_TYPICAL_VALUE_PROVISIONS));
    expect(groups.size).toBeGreaterThan(10);
    for (const group of groups) {
      const why = TYPICAL_VALUE_GROUP_RATIONALE[group];
      expect(why, `${group} needs a written rationale`).toBeTruthy();
      expect(why!.length, group).toBeGreaterThan(40);
    }
  });

  it('refuses the 28 reviewed exclusions, every one of which has a figure', () => {
    expect(Object.keys(EXCLUDED_FROM_TYPICAL_VALUES)).toHaveLength(28);
    for (const [code, why] of Object.entries(EXCLUDED_FROM_TYPICAL_VALUES)) {
      expect(rikNutritionPreliminary[code]?.energyKcal, `${code} has a workbook figure`).toBeDefined();
      expect(approvedTypicalNutritionFor(code), `${code} must stay unavailable`).toBeNull();
      expect(why.length, `${code} needs a written reason`).toBeGreaterThan(40);
    }
  });

  it('still refuses the ones a group average would misdescribe', () => {
    // Named individually because these are the cases worth not regressing:
    // concentrated milk fat, a malted drink powder, fried noodles, a masala
    // wearing another food's proxy, and a baked hydrated product.
    for (const code of ['BG_AMUL_GHEE', 'NU_HORLICKS', 'CER_MAGGI', 'CND_CHICKEN_MASALA', 'CER_BREAD_BROWN', 'FRUIT_DRY']) {
      expect(EXCLUDED_FROM_TYPICAL_VALUES[code], `${code} should be a reviewed exclusion`).toBeTruthy();
      expect(approvedTypicalNutritionFor(code), code).toBeNull();
    }
  });

  it('now publishes the loose commodities, superseding the 6 November exclusion', () => {
    // They were held back on 6 November for being loose rather than packed.
    // The 10 November decision is explicit that packaging is not a reason to
    // exclude an otherwise suitable product, so the loose dals are published.
    // Asserted rather than deleted, so the reversal is visible in the suite.
    const loose = Object.keys(rikNutritionPreliminary).filter(
      (c) => /\(loose\)/i.test(rikNutritionPreliminary[c]!.workbookName)
    );
    expect(loose).toHaveLength(8);
    for (const code of loose) {
      expect(approvedTypicalNutritionFor(code), code).not.toBeNull();
      expect(APPROVED_TYPICAL_VALUE_PROVISIONS[code], code).toBe('pulse');
    }
  });

  it('reconciles to the 184 workbook records, with nothing unaccounted for', () => {
    expect(Object.keys(rikNutritionPreliminary)).toHaveLength(184);
    expect(approvedTypicalCodes()).toHaveLength(REVIEW_TOTALS.approved);

    const noValues = Object.values(rikNutritionPreliminary).filter(
      (r) => r.energyKcal === undefined
    );
    expect(noValues).toHaveLength(REVIEW_TOTALS.withoutEstablishedValues);
    expect(ITEM_LEVEL_PROVISION_CODES.size).toBe(REVIEW_TOTALS.holdingMeasuredRecords);

    expect(
      REVIEW_TOTALS.approved +
        REVIEW_TOTALS.excluded +
        REVIEW_TOTALS.holdingMeasuredRecords +
        REVIEW_TOTALS.withoutEstablishedValues
    ).toBe(184);
  });

  it('classifies every candidate exactly once — approved or excluded, never both', () => {
    const candidates = Object.keys(rikNutritionPreliminary).filter(
      (code) =>
        rikNutritionPreliminary[code]!.energyKcal !== undefined &&
        !ITEM_LEVEL_PROVISION_CODES.has(code)
    );
    expect(candidates).toHaveLength(REVIEW_TOTALS.candidates);

    const both = candidates.filter(
      (c) => APPROVED_TYPICAL_VALUE_PROVISIONS[c] !== undefined && EXCLUDED_FROM_TYPICAL_VALUES[c] !== undefined
    );
    const neither = candidates.filter(
      (c) => APPROVED_TYPICAL_VALUE_PROVISIONS[c] === undefined && EXCLUDED_FROM_TYPICAL_VALUES[c] === undefined
    );
    expect(both, 'a record cannot be both approved and excluded').toEqual([]);
    expect(neither, 'every candidate needs a decision').toEqual([]);
  });

  it('never publishes a provision that holds a measured record', () => {
    for (const code of ITEM_LEVEL_PROVISION_CODES) {
      expect(APPROVED_TYPICAL_VALUE_PROVISIONS[code], `${code} must not be on the list`).toBeUndefined();
      expect(approvedTypicalNutritionFor(code), code).toBeNull();
    }
  });
});

describe('the eight carry the workbook figures unchanged', () => {
  it.each([
    ['EGGS_TABLE', 147, 13.3, 1, 0, 10],
    ['OIL_GROUNDNUT', 900, 0, 0, 0, 100],
    ['OIL_RICE_BRAN', 900, 0, 0, 0, 100],
    ['OIL_SUNFLOWER_500', 900, 0, 0, 0, 100],
    ['OIL_SUNFLOWER_1000', 900, 0, 0, 0, 100],
    ['OIL_MUSTARD_500', 900, 0, 0, 0, 100],
    ['OIL_MUSTARD_1000', 900, 0, 0, 0, 100],
    ['SUGAR', 400, 0, 100, 0, 0],
  ] as const)('%s matches the workbook cell for cell', (code, kcal, protein, carb, fibre, fat) => {
    const record = approvedTypicalNutritionFor(code)!;
    expect(record.energyKcal).toBe(kcal);
    expect(record.proteinG).toBe(protein);
    expect(record.carbohydrateG).toBe(carb);
    expect(record.fibreG).toBe(fibre);
    expect(record.fatG).toBe(fat);
    // And identical to the underlying workbook record — no recalculation.
    const raw = rikNutritionPreliminary[code]!;
    expect(record.energyKcal).toBe(raw.energyKcal);
    expect(record.fatG).toBe(raw.fatG);
  });

  it('states the per-100-g basis on every record', () => {
    for (const code of APPROVED) expect(approvedTypicalNutritionFor(code)!.basis).toBe('per 100 g');
  });
});

describe('a stated zero is data; a missing nutrient is not zero', () => {
  it('keeps the real zeros — oil has no carbohydrate, sugar has no fat', () => {
    // These are values the workbook states, not gaps, and they must survive.
    const oil = approvedTypicalNutritionFor('OIL_SUNFLOWER_1000')!;
    expect(oil.carbohydrateG).toBe(0);
    expect(oil.proteinG).toBe(0);
    expect(oil.fibreG).toBe(0);
    const sugar = approvedTypicalNutritionFor('SUGAR')!;
    expect(sugar.fatG).toBe(0);
    expect(sugar.proteinG).toBe(0);
    // A stated zero is not undefined.
    expect(oil.carbohydrateG).not.toBeUndefined();
  });

  it('leaves a nutrient the workbook never supplied UNDEFINED, never 0', () => {
    // The workbook supplies no sugars, fatty-acid fractions, sodium or
    // cholesterol for any row. None may appear as a zero.
    for (const code of APPROVED) {
      const record = approvedTypicalNutritionFor(code)!;
      expect(record.sugarsG, `${code} sugars`).toBeUndefined();
      expect(record.energyKJ, `${code} kJ`).toBeUndefined();
      expect(record.sugarsG, `${code}`).not.toBe(0);
    }
  });
});

describe('no source name, citation or internal reference travels to the screen', () => {
  it.each(APPROVED)('%s carries no citation, source code, page or notes', (code) => {
    const record = approvedTypicalNutritionFor(code)!;
    expect(record.citation).toBeUndefined();
    expect(record.sourceCode).toBeUndefined();
    expect(record.printedPage).toBeUndefined();
    expect(record.sampleCount).toBeUndefined();
    expect(record.notes).toBeUndefined();
  });

  it('names no source organisation in anything the record exposes for display', () => {
    for (const code of APPROVED) {
      const record = approvedTypicalNutritionFor(code)!;
      const shown = `${record.basis} ${record.state} ${record.sourceFood}`;
      expect(shown).not.toMatch(/ICMR|NIN|IFCT|INDB|Anuvaad|Dietary Guidelines|Longvah/i);
    }
  });

  it('keeps the workbook provenance INTERNALLY, so it is traceable', () => {
    // Suppressed from the screen, not discarded.
    const raw = rikNutritionPreliminary['SUGAR']!;
    expect(raw.source).toMatch(/ICMR-NIN Dietary Guidelines/);
    expect(raw.workbookRow).toBeGreaterThan(0);
    expect(raw.foodGroupProxy).toBe('sugar');
  });
});

describe('the disclaimer', () => {
  it('is the exact approved wording', () => {
    expect(TYPICAL_VALUES_DISCLAIMER).toBe(
      'Approximate typical nutrition values per 100 g. Actual values may vary.'
    );
  });

  it('claims no measurement or verification', () => {
    expect(TYPICAL_VALUES_DISCLAIMER).not.toMatch(/laborator|verified|tested|measured|certified|exact/i);
    expect(TYPICAL_VALUES_DISCLAIMER).toMatch(/approximate/i);
  });

  it('applies to every approved record, because all eight are that category', () => {
    for (const code of APPROVED) {
      expect(approvedTypicalNutritionFor(code)!.dataQuality).toBe('approximate-reference');
    }
  });
});

describe('the three publication controls stay in their own lanes', () => {
  it('the approved-typical control is on, and governs only the approved list', () => {
    expect(PUBLISH_APPROVED_TYPICAL_VALUES).toBe(true);
    expect(approvedTypicalCodes()).toHaveLength(REVIEW_TOTALS.approved);
  });

  it('the IFCT control is still OFF', () => {
    expect(PUBLISH_COMPOSITION_TABLE_VALUES).toBe(false);
  });

  it('the bulk preliminary control is still OFF', () => {
    expect(PUBLISH_PRELIMINARY_GROUP_AVERAGES).toBe(false);
    // So the raw workbook pathway yields nothing, including for the eight.
    for (const code of APPROVED) expect(preliminaryNutritionFor(code), code).toBeNull();
  });

  it('the CATEGORY rule for approximate-reference is still "never" — deliberately', () => {
    // The eight are approved per record, NOT by widening the category. This
    // assertion exists so nobody "tidies up" the apparent inconsistency by
    // changing the policy table, which would release all 184 at once.
    expect(PUBLICATION_POLICY['approximate-reference']).toBe('never');
    expect(PRELIMINARY_DATA_QUALITY).toBe('approximate-reference');
  });

  it('isPublishable still refuses the category, and that is the design', () => {
    const record = approvedTypicalNutritionFor('SUGAR')!;
    // A record released by the approved pathway would be refused by the
    // category gate. Two gates, two scopes; neither releases the other's data.
    expect(isPublishable(record)).toBe(false);
    expect(approvedTypicalNutritionFor('SUGAR')).not.toBeNull();
  });
});

describe('the 51 item-level records are unchanged and unpublished', () => {
  it('still holds 51, all composition-table', () => {
    const entries = Object.entries(rikNutrition);
    expect(entries.length).toBe(51);
    for (const [code, r] of entries) expect(r.dataQuality, code).toBe('composition-table');
  });

  it('yields none of them to any caller', () => {
    for (const code of Object.keys(rikNutrition)) expect(nutritionFor(code), code).toBeNull();
    expect(nutritionCodes()).toEqual([]);
  });

  it('lists all 51 codes for the no-downgrade rule', () => {
    expect(ITEM_LEVEL_PROVISION_CODES.size).toBe(51);
    for (const code of Object.keys(rikNutrition)) expect(hasItemLevelRecord(code), code).toBe(true);
  });

  it('never shows a typical value for a provision that has a measured one', () => {
    // The rule that matters most. None of the 51 may reach the approved
    // pathway, and none of the eight may be one of the 51.
    for (const code of Object.keys(rikNutrition)) {
      expect(approvedTypicalNutritionFor(code), code).toBeNull();
    }
    for (const code of APPROVED) expect(hasItemLevelRecord(code), code).toBe(false);
  });

  it('keeps the maida figure measured, not the workbook average', () => {
    const maida = rikNutrition['CER_MAIDA']!;
    expect(maida.energyKJ).toBe(1472);
    expect(maida.energyKcal).toBe(352.2);
    // The workbook's cereal proxy says 343; it must not have been merged in.
    expect(rikNutritionPreliminary['CER_MAIDA']!.energyKcal).toBe(343);
    expect(maida.energyKcal).not.toBe(343);
  });
});

describe('RIK entitlement, ordering and pricing are untouched by nutrition code', () => {
  /** customer-web/src, located by landmark rather than by cwd or import.meta. */
  const SRC = (() => {
    const landmark = path.join('data', 'rikNutrition.ts');
    let dir = process.cwd();
    for (let up = 0; up < 6; up += 1) {
      for (const c of [path.join(dir, 'src'), dir, path.join(dir, 'apps', 'customer-web', 'src')]) {
        if (existsSync(path.join(c, landmark))) return c;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    throw new Error(`could not locate customer-web/src from ${process.cwd()}`);
  })();

  const NUTRITION_MODULES = [
    'data/rikNutrition.ts',
    'data/rikNutritionPreliminary.ts',
    'data/rikNutritionApproved.ts',
    'routes/rik/NutritionInfoPage.tsx',
  ];

  it('reads the real files — this check is not vacuous', () => {
    for (const rel of NUTRITION_MODULES) {
      expect(existsSync(path.join(SRC, rel)), rel).toBe(true);
    }
  });

  it('imports nothing from the entitlement, cart, order or pricing code', () => {
    const forbidden = /entitlement|useEntitlement|rik-issue|voucher|cart|checkout|order|price|packSize|consumption/i;
    for (const rel of NUTRITION_MODULES) {
      const text = readFileSync(path.join(SRC, rel), 'utf8');
      const imports = [...text.matchAll(/^import[\s\S]*?from\s+'([^']+)';/gm)].map((m) => m[1]!);
      const offending = imports.filter((spec) => forbidden.test(spec));
      expect(offending, `${rel} must not import entitlement/ordering code`).toEqual([]);
    }
  });

  it('leaves the entitlement sources untouched by this feature', () => {
    // Present and readable; nothing in the nutrition change edits them.
    for (const rel of ['routes/rik/ration/useEntitlement.ts', 'lib/api/rik-entitlement-api.ts']) {
      const p = path.join(SRC, rel);
      if (!existsSync(p)) continue;
      const text = readFileSync(p, 'utf8');
      expect(text).not.toMatch(/rikNutritionApproved|approvedTypicalNutritionFor|TYPICAL_VALUES_DISCLAIMER/);
    }
  });
});

/**
 * THE COPIED FIGURES MUST STILL MATCH THE WORKBOOK THEY WERE COPIED FROM.
 *
 * On 10 November 2026 the eight approved figures were copied out of the 184-row
 * workbook into data/rikNutritionApprovedValues.ts, so that serving eight
 * records would stop dragging all 184 into the customer bundle. That fixed the
 * exposure and introduced a new risk in its place: two copies of the same
 * numbers, free to drift apart.
 *
 * This suite is what makes the copy safe. It reads the workbook — a TEST may,
 * since nothing here ships — and checks the eight records field for field. A
 * typo in a figure, a dropped nutrient, a ninth record added to one list and
 * not the other, or a change to the workbook itself all fail here.
 *
 * SO "do not invent, recalculate or alter the figures" is not a promise about
 * how carefully the copy was made. It is checked on every run.
 */
describe('the shipped figures against the workbook', () => {
  it('covers exactly the approved codes, in both lists', () => {
    const shipped = Object.keys(APPROVED_TYPICAL_VALUES).sort();
    const allowed = Object.keys(APPROVED_TYPICAL_VALUE_PROVISIONS).sort();
    expect(shipped).toHaveLength(REVIEW_TOTALS.approved);
    expect(shipped).toEqual(allowed);
    expect([...approvedTypicalCodes()].sort()).toEqual(shipped);
  });

  it('matches its workbook row field for field, every nutrient, every record', () => {
    const NUTRIENTS = [
      'energyKcal', 'proteinG', 'carbohydrateG', 'fibreG', 'fatG', 'totalSugarsG',
    ] as const;

    for (const [code, shipped] of Object.entries(APPROVED_TYPICAL_VALUES)) {
      const workbook = rikNutritionPreliminary[code];
      expect(workbook, `${code} must exist in the workbook`).toBeDefined();
      if (workbook === undefined) continue;

      expect(shipped.workbookRow, `${code} workbookRow`).toBe(workbook.workbookRow);
      expect(shipped.workbookName, `${code} workbookName`).toBe(workbook.workbookName);
      // The workbook's `source` is NOT carried across. It names ICMR-NIN, and
      // this module ships, so carrying it would put a source name into the
      // bundle for figures the screen shows no source against. It stays in the
      // workbook module for internal traceability.
      expect(
        (shipped as unknown as Record<string, unknown>)['source'],
        `${code} must not ship a source name`
      ).toBeUndefined();

      for (const nutrient of NUTRIENTS) {
        expect(shipped[nutrient], `${code}.${nutrient}`).toBe(workbook[nutrient]);
      }
    }
  });

  it('names no organisation in the record the screen receives', () => {
    // `source` is required by NutritionRecord, so it carries a generic
    // description. It must never carry a publication or an institute.
    for (const code of Object.keys(APPROVED_TYPICAL_VALUES)) {
      const record = approvedTypicalNutritionFor(code)!;
      expect(record.source, code).toBe('Approximate typical values');
      expect(record.source, code).not.toMatch(
        /ICMR|NIN|IFCT|INDB|Anuvaad|Dietary Guidelines|Longvah|workbook/i
      );
      expect(record.citation, code).toBeUndefined();
      expect(record.sourceCode, code).toBeUndefined();
      expect(record.printedPage, code).toBeUndefined();
      expect(record.sampleCount, code).toBeUndefined();
      expect(record.notes, code).toBeUndefined();
    }
  });

  it('keeps a blank cell blank — sugars is absent, not zero, on every record', () => {
    for (const [code, shipped] of Object.entries(APPROVED_TYPICAL_VALUES)) {
      expect(shipped.totalSugarsG, `${code} sugars must be absent`).toBeUndefined();
      expect(rikNutritionPreliminary[code]?.totalSugarsG, code).toBeUndefined();
      // And it must not surface as a zero on the record the screen receives.
      expect(approvedTypicalNutritionFor(code)?.sugarsG, code).toBeUndefined();
    }
  });

  it('serves every nutrient exactly as the workbook pathway would have', () => {
    // Reconstructs from the workbook what the old implementation would have
    // served, and compares. Direct proof that moving the figures out of the
    // workbook module changed no displayed value, for all 101 records.
    //
    // ONE FIELD DIFFERS BY DESIGN: `source`. The old pathway copied the
    // workbook's ICMR-NIN string onto the record; this one carries a generic
    // description instead, because the module holding the figures now ships
    // and a source name has no business in it. The screen never rendered that
    // field for this category, so nothing a customer sees changes.
    for (const code of Object.keys(APPROVED_TYPICAL_VALUES)) {
      const workbook = rikNutritionPreliminary[code]!;
      expect(approvedTypicalNutritionFor(code), code).toEqual({
        basis: 'per 100 g',
        state: 'raw',
        source: 'Approximate typical values',
        sourceFood: workbook.workbookName,
        dataQuality: 'approximate-reference',
        energyKcal: workbook.energyKcal,
        proteinG: workbook.proteinG,
        carbohydrateG: workbook.carbohydrateG,
        fibreG: workbook.fibreG,
        fatG: workbook.fatG,
        sugarsG: workbook.totalSugarsG,
      });
    }
  });

  it('holds the real zeros, which are values and must survive the copy', () => {
    const oil: ApprovedTypicalValue | undefined = APPROVED_TYPICAL_VALUES['OIL_GROUNDNUT'];
    expect(oil?.energyKcal).toBe(900);
    expect(oil?.fatG).toBe(100);
    expect(oil?.proteinG).toBe(0);
    expect(oil?.carbohydrateG).toBe(0);
    expect(oil?.fibreG).toBe(0);

    const sugar = APPROVED_TYPICAL_VALUES['SUGAR'];
    expect(sugar?.energyKcal).toBe(400);
    expect(sugar?.carbohydrateG).toBe(100);
    expect(sugar?.fatG).toBe(0);

    const egg = APPROVED_TYPICAL_VALUES['EGGS_TABLE'];
    expect(egg?.energyKcal).toBe(147);
    expect(egg?.proteinG).toBe(13.3);
    expect(egg?.fatG).toBe(10);
  });

  it('ships nothing but the approved records — the module imports no dataset', () => {
    const source = readFileSync(path.join(__dirname, 'rikNutritionApprovedValues.ts'), 'utf-8');
    expect(source).not.toMatch(/(?:^|\n)\s*import\s/);
    expect(source).not.toMatch(/(?:^|\n)\s*export\s[^;]*?\sfrom\s/);
  });
});
