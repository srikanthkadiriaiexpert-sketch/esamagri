import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';
import {
  isPublishable,
  ITEM_LEVEL_PROVISION_CODES,
  nutritionCodes,
  nutritionFor,
  PUBLICATION_POLICY,
  PUBLISH_COMPOSITION_TABLE_VALUES,
  rikNutrition,
} from './rikNutrition';
import { rikNutritionIfctWithheld } from './rikNutritionIfctWithheld';
import {
  approvedTypicalCodes,
  approvedTypicalNutritionFor,
  PUBLISH_APPROVED_TYPICAL_VALUES,
} from './rikNutritionApproved';
import {
  PRELIMINARY_DATA_QUALITY,
  PUBLISH_PRELIMINARY_GROUP_AVERAGES,
  rikNutritionPreliminary,
} from './rikNutritionPreliminary';
import { APPROVED_TYPICAL_VALUES } from './rikNutritionApprovedValues';

/**
 * THE WITHHELD NUTRITION DATA MUST NOT REACH THE CUSTOMER BUNDLE.
 *
 * Two datasets are kept out: the 51 transcribed IFCT records, and the 83
 * workbook records not approved for display. Only the 101 approved typical
 * values ship, from a standalone module.
 *
 * =====================================================================
 * WHAT THIS FILE IS FOR, AND WHY A FLAG WAS NOT ENOUGH
 * =====================================================================
 *
 * `PUBLISH_COMPOSITION_TABLE_VALUES` has been false since these records were
 * transcribed, so no customer has ever been SHOWN one. That was never the
 * same thing as not SHIPPING them. While the 51 records sat in the
 * `rikNutrition` map, and `nutritionFor` read that map, and NutritionInfoPage
 * imported `nutritionFor`, a bundler had no choice: all 51 rows went into the
 * JavaScript we serve, in plaintext, for anyone to read. The gate governed
 * the screen, not the download.
 *
 * The records were therefore moved to ./rikNutritionIfctWithheld, a module no
 * production code imports. What keeps them out of the bundle now is the shape
 * of the import graph, and this file is what holds that shape in place.
 *
 * =====================================================================
 * HOW THE PROOF WORKS
 * =====================================================================
 *
 * It does not grep for suspicious strings and hope. It walks the REAL static
 * dependency graph outward from `src/main.tsx` — the app's only entry point —
 * following every relative `import`, `export ... from` and `import()` it finds,
 * and reports the set of modules a bundler would therefore have to include.
 * The withheld module must not be in that set.
 *
 * Three properties make the walk trustworthy rather than reassuring:
 *
 *   IT CANNOT PASS BY FINDING NOTHING. The reachable set must contain the
 *   modules we know are in the app, and must exceed a floor of modules. A walk
 *   that silently stopped at main.tsx would fail, not pass.
 *
 *   IT CANNOT PASS BY FAILING TO RESOLVE. Every relative specifier must
 *   resolve to a file on disk. An unresolvable import is a failure, not a
 *   skipped edge, because a skipped edge is exactly how a real import would
 *   hide from this test.
 *
 *   IT CHECKS THE DATA, NOT ONLY THE FILENAME. Independently of the module
 *   graph, no reachable production file may contain an IFCT transcription —
 *   tested with the field-qualified forms (`energyKJ: 1472`, `sourceFood:
 *   'Wheat flour, refined'`) that only ever occur in a transcribed record. So
 *   copying the figures into a screen would fail this suite too, even though
 *   it would leave the import graph untouched.
 *
 * WHAT THIS FILE CANNOT DO is read a bundle that has not been built. The last
 * test here checks `dist/` when one exists and is newer than the source, and
 * says plainly that it is skipping when it does not. The graph proof above is
 * what stands on its own.
 *
 * IF A TEST HERE FAILS, the fix is to remove the production import, never to
 * widen the allowlist.
 */

// --------------------------------------------------------------------------
// locating the tree
// --------------------------------------------------------------------------

/**
 * The `src` directory, found by landmark rather than by `import.meta.url`.
 *
 * Vite rewrites `import.meta.url` under Vitest, so `fileURLToPath(new
 * URL('.', import.meta.url))` throws here. This walks up from the working
 * directory looking for the two landmarks that identify this app's source
 * tree, and throws loudly if it cannot find them — a silent fallback would
 * turn every assertion below into a test of an empty directory.
 */
function findSrcRoot(): string {
  let dir = process.cwd();
  for (let up = 0; up < 6; up += 1) {
    const candidate = path.join(dir, 'src');
    if (
      existsSync(path.join(candidate, 'main.tsx')) &&
      existsSync(path.join(candidate, 'data', 'rikNutrition.ts'))
    ) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `could not locate the customer-web src directory from ${process.cwd()}; ` +
      'this suite cannot verify anything without it'
  );
}

const SRC = findSrcRoot();
const PKG_ROOT = path.dirname(SRC);
const rel = (abs: string) => path.relative(SRC, abs).split(path.sep).join('/');

const WITHHELD = 'data/rikNutritionIfctWithheld.ts';
const PRELIMINARY = 'data/rikNutritionPreliminary.ts';

// --------------------------------------------------------------------------
// the dependency walk
// --------------------------------------------------------------------------

/** Candidate on-disk files for one specifier, in the order a bundler tries. */
function resolveCandidates(fromFile: string, spec: string): readonly string[] {
  const base = path.resolve(path.dirname(fromFile), spec.split('?')[0] ?? spec);
  return [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ];
}

/**
 * Every relative module specifier in one file.
 *
 * The gap between `import` and `from` is matched with `[^;]*?` so a statement
 * can span lines but can never run past its own semicolon into the next
 * statement's specifier.
 */
function specifiersIn(source: string): readonly string[] {
  const found: string[] = [];
  const patterns = [
    /(?:^|\n)\s*import\s+[^;]*?\s*from\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*export\s+[^;]*?\s*from\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const spec = match[1];
      if (spec !== undefined && spec.startsWith('.')) found.push(spec);
    }
  }
  return found;
}

interface Graph {
  readonly reachable: ReadonlySet<string>;
  readonly unresolved: readonly string[];
  readonly edges: number;
}

/** Walks outward from an entry file, following relative imports only. */
function walk(entryRelative: string): Graph {
  const entry = path.join(SRC, entryRelative);
  if (!existsSync(entry)) throw new Error(`entry point missing: ${entryRelative}`);

  const reachable = new Set<string>();
  const unresolved: string[] = [];
  const queue = [entry];
  let edges = 0;

  while (queue.length > 0) {
    const file = queue.pop()!;
    const key = rel(file);
    if (reachable.has(key)) continue;
    reachable.add(key);

    // Stylesheets and assets carry no imports we care about.
    if (!/\.(ts|tsx|js|jsx)$/.test(file)) continue;

    const source = readFileSync(file, 'utf-8');
    for (const spec of specifiersIn(source)) {
      edges += 1;
      const hit = resolveCandidates(file, spec).find(
        (candidate) => existsSync(candidate) && statSync(candidate).isFile()
      );
      if (hit === undefined) unresolved.push(`${key} -> ${spec}`);
      else queue.push(hit);
    }
  }

  return { reachable, unresolved, edges };
}

const graph = walk('main.tsx');
const productionFiles = [...graph.reachable].filter((f) => /\.(ts|tsx)$/.test(f));

// --------------------------------------------------------------------------
// the walk must be worth believing before it is used as evidence
// --------------------------------------------------------------------------

describe('the dependency walk itself', () => {
  it('resolved every relative import it found', () => {
    expect(graph.unresolved, 'unresolvable imports hide real edges').toEqual([]);
  });

  it('actually traversed the app rather than stopping at the entry point', () => {
    expect(graph.edges).toBeGreaterThan(200);
    expect(productionFiles.length).toBeGreaterThan(60);
  });

  it('reached the modules the customer app is known to contain', () => {
    for (const known of [
      'main.tsx',
      'app/App.tsx',
      'routes/rik/NutritionInfoPage.tsx',
      'data/rikNutrition.ts',
      'data/rikNutritionApproved.ts',
      'lib/api/rik-catalogue-api.ts',
      'design-system/Header.tsx',
    ]) {
      expect(graph.reachable.has(known), `${known} should be reachable`).toBe(true);
    }
  });

  it('pulled in no test file, so test-only imports prove nothing here', () => {
    const tests = productionFiles.filter((f) => /\.test\.tsx?$/.test(f) || f.startsWith('test/'));
    expect(tests).toEqual([]);
  });
});

// --------------------------------------------------------------------------
// the exclusion itself
// --------------------------------------------------------------------------

describe('the 51 IFCT records are outside the production graph', () => {
  it('does not reach the withheld module from the app entry point', () => {
    expect(
      graph.reachable.has(WITHHELD),
      'a production module imports the withheld IFCT data; remove that import rather than ' +
        'editing this test'
    ).toBe(false);
  });

  /**
   * THE WORKBOOK MODULE IS OUT OF THE GRAPH TOO, AS OF 10 NOVEMBER 2026.
   *
   * It was reachable until now, and this suite said so rather than hiding it.
   * The approved pathway read its eight figures straight out of the 184-row
   * workbook, and importing that module for eight records brought all 184 into
   * the bundle — the 176 that were deliberately NOT approved included. The gate
   * held: those 176 could never be displayed. But they shipped, which is the
   * same shown-versus-shipped gap this whole suite exists to close, in a second
   * place.
   *
   * The eight figures now live in ./rikNutritionApprovedValues, a standalone
   * module that imports nothing, and nutrition-approved-typical.test.ts asserts
   * they are still field-for-field identical to their workbook rows. So the
   * copy is checked against its source on every run, while the source itself
   * stays out of the customer bundle.
   */
  it('does not reach the 184-row workbook module either', () => {
    expect(
      graph.reachable.has(PRELIMINARY),
      'a production module imports the 184-row workbook; the eight approved figures ' +
        'live in rikNutritionApprovedValues, so remove that import rather than editing this test'
    ).toBe(false);
  });

  it('reaches the standalone approved values instead, and only those', () => {
    expect(graph.reachable.has('data/rikNutritionApprovedValues.ts')).toBe(true);
    expect(Object.keys(APPROVED_TYPICAL_VALUES)).toHaveLength(101);
    // The gate on the unapproved remainder still exists; they are simply not
    // here to gate. 101 of the workbook's 184 ship; the other 83 do not.
    expect(PUBLISH_PRELIMINARY_GROUP_AVERAGES).toBe(false);
    expect(PRELIMINARY_DATA_QUALITY).toBe('approximate-reference');
    expect(PUBLICATION_POLICY[PRELIMINARY_DATA_QUALITY]).toBe('never');
    expect(Object.keys(rikNutritionPreliminary)).toHaveLength(184);
    expect(184 - Object.keys(APPROVED_TYPICAL_VALUES).length).toBe(83);
  });

  it('does not reach the publication review either — it is test-only prose', () => {
    expect(graph.reachable.has('data/rikNutritionTypicalValueReview.ts')).toBe(false);
  });

  it('carries no unapproved workbook figure in any reachable production file', () => {
    // The distinctive form a workbook record takes. None of the 176 may appear
    // in shipped code, by import or by anyone pasting one in.
    const approved = new Set(Object.keys(APPROVED_TYPICAL_VALUES));
    const fingerprints: string[] = [];
    for (const [code, record] of Object.entries(rikNutritionPreliminary)) {
      if (approved.has(code)) continue;
      fingerprints.push(`workbookRow: ${String(record.workbookRow)},`);
    }
    expect(fingerprints.length).toBe(83);

    const offences: string[] = [];
    for (const file of productionFiles) {
      if (file === 'data/rikNutritionApprovedValues.ts') continue;
      const source = readFileSync(path.join(SRC, file), 'utf-8');
      for (const print of fingerprints) {
        if (source.includes(print)) offences.push(`${file}: ${print}`);
      }
    }
    expect(offences, 'an unapproved workbook row has been copied into shipped code').toEqual([]);
  });

  /**
   * THE RULE IS ABOUT IMPORTS, NOT ABOUT THE NAME.
   *
   * A production module may NAME either withheld dataset in a comment — several
   * do, because explaining where the data went and why is the whole reason the
   * next person will not put it back. What no production module may do is
   * import one. So this scans every file for a real import statement, and the
   * allowlist covers importers only.
   */
  it('is imported only by tests, and by exactly the tests we expect', () => {
    const files: string[] = [];
    const walkDir = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walkDir(full);
        else if (/\.(ts|tsx)$/.test(entry.name)) files.push(rel(full));
      }
    };
    walkDir(SRC);
    expect(files.length, 'the scan must see a real source tree').toBeGreaterThan(100);

    const importersOf = (moduleBasename: string) => {
      const pattern = new RegExp(
        String.raw`(?:^|\n)\s*(?:import|export)[^;]*?from\s*['"][^'"]*` + moduleBasename + String.raw`['"]`
      );
      return files.filter(
        (f) => f !== `data/${moduleBasename}.ts` && pattern.test(readFileSync(path.join(SRC, f), 'utf-8'))
      );
    };

    for (const moduleName of ['rikNutritionIfctWithheld', 'rikNutritionPreliminary']) {
      const importers = importersOf(moduleName);
      const production = importers.filter((f) => !/\.test\.tsx?$/.test(f));
      expect(production, `only tests may import ${moduleName}`).toEqual([]);
      expect(importers.length, `${moduleName} should still be audited by tests`).toBeGreaterThan(0);
    }
  });

  it('carries no IFCT transcription in any reachable production file', () => {
    const fingerprints: string[] = [];
    for (const record of Object.values(rikNutritionIfctWithheld)) {
      if (record.energyKJ !== undefined) fingerprints.push(`energyKJ: ${String(record.energyKJ)}`);
      if (record.sourceFood !== undefined) fingerprints.push(`sourceFood: '${record.sourceFood}'`);
    }
    // 51 records, each contributing both forms.
    expect(fingerprints).toHaveLength(102);

    const offences: string[] = [];
    for (const file of productionFiles) {
      const source = readFileSync(path.join(SRC, file), 'utf-8');
      for (const print of fingerprints) {
        if (source.includes(print)) offences.push(`${file}: ${print}`);
      }
    }
    expect(offences, 'an IFCT figure has been copied into shipped code').toEqual([]);
  });

  it('carries no IFCT scaffolding in any reachable production file', () => {
    const offences: string[] = [];
    for (const file of productionFiles) {
      const source = readFileSync(path.join(SRC, file), 'utf-8');
      // Declaration and subscript forms, not the bare name: data/rikNutrition.ts
      // still EXPLAINS in prose where IFCT_FOODS went, and a comment ships
      // nothing. What must not appear is the table itself or a read of it.
      for (const marker of [
        'const IFCT_FOODS',
        'IFCT_FOODS[',
        'interface IfctFood',
        'printedPage: ',
        'sampleCount: ',
      ]) {
        if (source.includes(marker)) offences.push(`${file}: ${marker}`);
      }
    }
    expect(offences).toEqual([]);
  });

  it('leaves the shipped store empty, so nutritionFor can yield nothing', () => {
    expect(Object.keys(rikNutrition)).toEqual([]);
    expect(nutritionCodes()).toEqual([]);
    for (const code of ITEM_LEVEL_PROVISION_CODES) {
      expect(nutritionFor(code), code).toBeNull();
    }
  });
});

// --------------------------------------------------------------------------
// preserved, not deleted
// --------------------------------------------------------------------------

describe('the 51 records are preserved for internal and test use', () => {
  it('still holds all 51, with the four mandatory fields on every one', () => {
    const codes = Object.keys(rikNutritionIfctWithheld);
    expect(codes).toHaveLength(51);
    for (const [code, record] of Object.entries(rikNutritionIfctWithheld)) {
      expect(record.energyKcal, code).toBeDefined();
      expect(record.carbohydrateG, code).toBeDefined();
      expect(record.fatG, code).toBeDefined();
      expect(record.fibreG, code).toBeDefined();
      expect(record.dataQuality, code).toBe('composition-table');
    }
  });

  it('matches the value-free code list exactly, so neither can drift', () => {
    expect(Object.keys(rikNutritionIfctWithheld).sort()).toEqual(
      [...ITEM_LEVEL_PROVISION_CODES].sort()
    );
  });

  it('is still refused by the publication gate, module move notwithstanding', () => {
    expect(PUBLISH_COMPOSITION_TABLE_VALUES).toBe(false);
    expect(PUBLICATION_POLICY['composition-table']).toBe('ifct-licence');
    for (const [code, record] of Object.entries(rikNutritionIfctWithheld)) {
      expect(isPublishable(record), code).toBe(false);
    }
  });
});

// --------------------------------------------------------------------------
// Part A is untouched
// --------------------------------------------------------------------------

describe('the approved typical values still work', () => {
  it('keeps its own control on, independently of the IFCT one', () => {
    expect(PUBLISH_APPROVED_TYPICAL_VALUES).toBe(true);
    expect(PUBLICATION_POLICY['approximate-reference']).toBe('never');
  });

  it('publishes the full approved list, with figures', () => {
    expect(approvedTypicalCodes()).toHaveLength(101);
    // The original eight, unchanged by the expansion.
    expect(approvedTypicalNutritionFor('SUGAR')?.energyKcal).toBe(400);
    expect(approvedTypicalNutritionFor('OIL_SUNFLOWER_1000')?.energyKcal).toBe(900);
    expect(approvedTypicalNutritionFor('EGGS_TABLE')?.energyKcal).toBe(147);
    // And a sample of the records the 10 November decision added.
    expect(approvedTypicalNutritionFor('DAL_L_CHANNA_DAL')?.energyKcal).toBe(323);
    expect(approvedTypicalNutritionFor('CER_ATTA_AASHIRVAAD')?.energyKcal).toBe(343);
    expect(approvedTypicalNutritionFor('VEG_CABBAGE')?.energyKcal).toBe(35);
  });

  it('reaches the approved module from production, unlike the withheld one', () => {
    expect(graph.reachable.has('data/rikNutritionApproved.ts')).toBe(true);
    expect(graph.reachable.has(WITHHELD)).toBe(false);
  });
});

// --------------------------------------------------------------------------
// the built bundle, when there is one
// --------------------------------------------------------------------------

describe('the built bundle', () => {
  it('contains no IFCT figure, once it has been rebuilt', (ctx) => {
    const dist = path.join(PKG_ROOT, 'dist');
    if (!existsSync(dist)) {
      ctx.skip('no dist/ in this tree — nothing has been built here');
      return;
    }

    const scripts: string[] = [];
    const collect = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) collect(full);
        else if (entry.name.endsWith('.js')) scripts.push(full);
      }
    };
    collect(dist);
    expect(scripts.length, 'a dist/ with no JavaScript in it is not a build').toBeGreaterThan(0);

    const newestBuild = Math.max(...scripts.map((f) => statSync(f).mtimeMs));
    const sourceChanged = statSync(path.join(SRC, 'data', 'rikNutrition.ts')).mtimeMs;
    if (newestBuild < sourceChanged) {
      ctx.skip(
        'dist/ predates the current nutrition source, so it is the OLD bundle and would ' +
          'still contain the IFCT figures. Rebuild to re-arm this check.'
      );
      return;
    }

    const fingerprints = Object.values(rikNutritionIfctWithheld)
      .map((record) => record.sourceFood)
      .filter((food): food is string => food !== undefined && food.length > 8);
    expect(fingerprints.length).toBeGreaterThan(30);

    const offences: string[] = [];
    for (const script of scripts) {
      const code = readFileSync(script, 'utf-8');
      for (const print of fingerprints) {
        if (code.includes(print)) offences.push(`${path.basename(script)}: ${print}`);
      }
    }
    expect(offences, 'the shipped bundle still carries IFCT data').toEqual([]);
  });
});
