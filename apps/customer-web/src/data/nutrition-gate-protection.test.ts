import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { rikNutrition } from './rikNutrition';
import { rikNutritionPreliminary } from './rikNutritionPreliminary';
import { rikNutritionIfctWithheld } from './rikNutritionIfctWithheld';

/**
 * THE PUBLICATION GATE'S STRUCTURAL GUARD.
 *
 * The gate is enforced inside `nutritionFor`, which is the single point every
 * screen goes through. But the raw `rikNutrition` map is also exported — it
 * has to be, because the audit tests in rik-nutrition.test.ts and
 * rik-nutrition-data.test.ts check the dataset itself, and a gated accessor
 * would report an empty dataset and prove nothing.
 *
 * That leaves one hole: a production module could `import { rikNutrition }`
 * and render IFCT figures with nothing to stop it, bypassing the gate
 * entirely. ICMR-NIN's licence forbids storing their data in a product
 * without written permission, so that would not be a styling bug — it would
 * be a licence breach shipped to customers.
 *
 * This file closes the hole by reading the source tree. It fails if any
 * NON-TEST module under src/ reaches the raw map, by import, by namespace
 * import, by require, by dynamic import, or by bare identifier. Test files
 * are exempt by design; that exemption is the approved audit usage, and it is
 * listed explicitly below rather than left implicit, so moving or renaming an
 * audit file has to be a deliberate act.
 *
 * WHY A SOURCE SCAN RATHER THAN A TYPE TRICK. Marking the export `@internal`
 * or renaming it would be advisory only — nothing fails a build. A lint rule
 * would work but is not wired into this project's test command, which is what
 * actually runs in review. Reading the files is crude and completely reliable.
 */

/**
 * customer-web/src, located by looking for the data module itself.
 *
 * NOT derived from `import.meta.url`: Vite rewrites that during transform, so
 * it is not a file: URL under vitest and `fileURLToPath` throws on it. Nor
 * from a bare `process.cwd()`, which differs depending on whether the run was
 * started in apps/customer-web or at the repo root. Searching for a known
 * landmark handles both, and throws loudly rather than silently scanning the
 * wrong tree — which would make every assertion below pass for nothing.
 */
function findSrcRoot(): string {
  const landmark = path.join('data', 'rikNutrition.ts');
  let dir = process.cwd();
  for (let up = 0; up < 6; up += 1) {
    for (const candidate of [
      path.join(dir, 'src'),
      dir,
      path.join(dir, 'apps', 'customer-web', 'src'),
    ]) {
      if (existsSync(path.join(candidate, landmark))) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`could not locate customer-web/src from ${process.cwd()}`);
}

const SRC_ROOT = findSrcRoot();

/**
 * The maps under guard, each with the module that owns it and a matcher for
 * import specifiers that resolve to it.
 *
 * THREE MAPS NOW. `rikNutritionPreliminary` holds the 184 food-group averages,
 * which are the data most dangerous to leak — they are not item-specific, so
 * displaying one against a named product would misstate that product.
 * `rikNutritionIfctWithheld` holds the 51 transcribed IFCT records, moved out
 * of data/rikNutrition.ts on 9 November 2026 so that a bundler would stop
 * including them in the customer app. All three get the same treatment.
 *
 * The specifier patterns are anchored, so `./rikNutritionPreliminary` and
 * `./rikNutritionIfctWithheld` do not match the `rikNutrition` rule, nor it
 * theirs. That matters here more than usual: `rikNutritionIfctWithheld`
 * contains `rikNutrition` as a prefix, and an unanchored pattern would quietly
 * conflate the empty shipped store with the withheld dataset.
 */
const GUARDED = [
  { map: 'rikNutrition', module: 'data/rikNutrition.ts', spec: /(^|\/)rikNutrition(\.ts)?$/ },
  { map: 'rikNutritionPreliminary', module: 'data/rikNutritionPreliminary.ts', spec: /(^|\/)rikNutritionPreliminary(\.ts)?$/ },
  { map: 'rikNutritionIfctWithheld', module: 'data/rikNutritionIfctWithheld.ts', spec: /(^|\/)rikNutritionIfctWithheld(\.ts)?$/ },
] as const;

/**
 * THE GATE LAYER — the modules that are allowed to read a raw map, because
 * they are the thing doing the gating.
 *
 * data/rikNutritionApproved.ts USED TO BE ON THIS LIST, because it read the
 * preliminary map directly to serve the eight approved provisions. As of
 * 10 November 2026 it does not: the eight figures live in
 * data/rikNutritionApprovedValues.ts and the workbook is no longer imported by
 * anything that ships. Its exemption was therefore removed rather than left
 * lying around, so that re-adding a workbook import there fails this scan.
 *
 * Everything NOT on this list must go through an accessor. Adding a module
 * here is a deliberate act and should be rare: it widens the set of code that
 * can see unpublished figures.
 */
const GATE_LAYER_MODULES: readonly string[] = [
  'data/rikNutrition.ts',
  'data/rikNutritionPreliminary.ts',
  // Owns the withheld IFCT map rather than reading someone else's. It is not
  // reachable from src/main.tsx at all — nutrition-ifct-bundle-exclusion.test.ts
  // walks the real import graph and fails if it ever becomes reachable — so it
  // is listed here only because this scanner classifies by "is it a test file",
  // and this module is neither a test nor shipped code.
  'data/rikNutritionIfctWithheld.ts',
];

/**
 * The files permitted to touch the raw map. The dataset audits and the
 * module itself, and nothing else. Every entry must exist, so a renamed or
 * deleted audit file fails here instead of silently widening the exemption.
 */
const APPROVED_RAW_MAP_USERS = [
  'data/rikNutrition.ts',
  'data/rikNutritionPreliminary.ts',
  'data/nutrition-approved-typical.test.ts',
  'routes/rik/nutrition-approved-display.test.tsx',
  'data/rik-nutrition.test.ts',
  'data/rik-nutrition-data.test.ts',
  'data/nutrition-gate-protection.test.ts',
  'data/nutrition-publication-gate.test.ts',
  // Reaches the module through vi.mock + importOriginal, which is how it
  // substitutes its own fixture. That is mocking, not rendering, so it cannot
  // leak a figure — but it does touch the module and so is listed here.
  'routes/rik/nutrition-info.test.tsx',
  'routes/rik/nutrition-info-gate.test.tsx',
  // Defines the withheld map, and the suite that proves it stays out of the
  // production import graph.
  'data/rikNutritionIfctWithheld.ts',
  'data/nutrition-ifct-bundle-exclusion.test.ts',
];

const isTestFile = (rel: string) => /\.(test|spec)\.(ts|tsx)$/.test(rel);

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const abs = path.join(dir, entry);
    if (statSync(abs).isDirectory()) {
      if (entry === 'node_modules') continue;
      sourceFiles(abs, acc);
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry) && !/\.d\.ts$/.test(entry)) {
      acc.push(path.relative(SRC_ROOT, abs).split(path.sep).join('/'));
    }
  }
  return acc;
}

const ALL_FILES = sourceFiles(SRC_ROOT);
const read = (rel: string) => readFileSync(path.join(SRC_ROOT, rel), 'utf8');

/** Does this specifier resolve to ANY guarded nutrition data module? */
const pointsAtDataModule = (spec: string) => GUARDED.some((g) => g.spec.test(spec));

/** Which guarded map does this specifier belong to? */
const guardFor = (spec: string) => GUARDED.find((g) => g.spec.test(spec));

interface Breach {
  readonly file: string;
  readonly how: string;
  readonly snippet: string;
}

/**
 * Every way a module could get its hands on the raw map.
 *
 * Deliberately over-inclusive: it would rather flag an odd-looking line for a
 * human to read than let a real bypass through. `nutritionFor`, `NUTRIENT_ROWS`,
 * `formatNutrient`, the types and the documentation maps are all fine, so a
 * normal consumer trips nothing.
 */
/**
 * The same source with comments blanked out, line numbering preserved.
 *
 * WHY THIS IS NEEDED. The guard is about code. But the modules it scans
 * EXPLAIN themselves at length, and those explanations name the very modules
 * under guard — "the figures used to be read from ./rikNutritionPreliminary"
 * is the sort of sentence that stops the next person putting them back. Scanned
 * naively, the full stop at the end of that sentence looks exactly like a
 * member access, and the guard fails on its own documentation.
 *
 * A comment ships nothing and reads nothing, so comments are removed before
 * any rule runs. String and template literals are left intact, because a
 * bypass could hide in one and because the detector's own self-test feeds it
 * code as strings.
 *
 * Replaced character-for-character with spaces, newlines kept, so the line
 * numbers this file reports still point at the real line.
 */
function stripComments(text: string): string {
  type Mode = 'code' | 'line' | 'block' | 'single' | 'double' | 'template';
  let mode: Mode = 'code';
  let out = '';
  let i = 0;

  while (i < text.length) {
    const char = text[i]!;
    const pair = text.slice(i, i + 2);

    if (mode === 'code') {
      if (pair === '//') { mode = 'line'; out += '  '; i += 2; continue; }
      if (pair === '/*') { mode = 'block'; out += '  '; i += 2; continue; }
      if (char === "'") mode = 'single';
      else if (char === '"') mode = 'double';
      else if (char === '`') mode = 'template';
      out += char;
      i += 1;
      continue;
    }

    if (mode === 'line') {
      if (char === '\n') { mode = 'code'; out += '\n'; } else out += ' ';
      i += 1;
      continue;
    }

    if (mode === 'block') {
      if (pair === '*/') { mode = 'code'; out += '  '; i += 2; continue; }
      out += char === '\n' ? '\n' : ' ';
      i += 1;
      continue;
    }

    // inside a string literal: copied through, escapes skipped
    if (char === '\\') { out += text.slice(i, i + 2); i += 2; continue; }
    if (
      (mode === 'single' && char === "'") ||
      (mode === 'double' && char === '"') ||
      (mode === 'template' && char === '`')
    ) {
      mode = 'code';
    }
    out += char;
    i += 1;
  }

  return out;
}

/** Every way a single source text could reach a guarded map. */
function breachesInText(source: string, label: string): Breach[] {
  const rel = label;
  const text = stripComments(source);
  const found: Breach[] = [];

  // 1. Static imports from the data module: inspect the BINDINGS, not the path,
  //    because every legitimate consumer also names the module in its path.
  const importRe = /import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  for (let m = importRe.exec(text); m !== null; m = importRe.exec(text)) {
    const [, clause, spec] = m;
    if (!pointsAtDataModule(spec!)) continue;

    if (/^\*\s+as\s+/.test(clause!.trim())) {
      found.push({ file: rel, how: 'namespace import exposes the raw map', snippet: m[0]!.slice(0, 120) });
      continue;
    }
    const braces = /\{([\s\S]*)\}/.exec(clause!);
    // A default import of this module is impossible (it has none), but a bare
    // clause with no braces is still not something to wave through.
    if (braces === null) {
      found.push({ file: rel, how: 'non-named import of the data module', snippet: m[0]!.slice(0, 120) });
      continue;
    }
    const guarded = guardFor(spec!)!.map;
    for (const raw of braces[1]!.split(',')) {
      const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]!.trim();
      if (name === guarded) {
        found.push({ file: rel, how: `imports the raw ${guarded} map`, snippet: raw.trim() });
      }
    }
  }

  // 2. require() and dynamic import() of the module.
  const dynRe = /(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (let m = dynRe.exec(text); m !== null; m = dynRe.exec(text)) {
    if (pointsAtDataModule(m[1]!)) {
      found.push({ file: rel, how: 'require()/dynamic import() of the data module', snippet: m[0]! });
    }
  }

  // 3. A bare `rikNutrition[...]` / `rikNutritionPreliminary.` member access.
  //    Catches a module that obtained a map some other way, and re-exports.
  //    The longer name is tested first so the shorter pattern cannot claim it;
  //    `rikNutritionPreliminary[` is not a `rikNutrition` match in any case,
  //    because the character after the prefix is 'P', not '[' or '.'.
  for (const g of [...GUARDED].reverse()) {
    const bareRe = new RegExp(`(?<![.\\w$])${g.map}\\s*(\\[|\\.(?!ts))`, 'g');
    for (let m = bareRe.exec(text); m !== null; m = bareRe.exec(text)) {
      const line = text.slice(0, m.index).split('\n').length;
      found.push({ file: rel, how: `direct member access on the raw ${g.map} map (line ${line})`, snippet: m[0]! });
    }
  }

  return found;
}

function breachesIn(rel: string): Breach[] {
  return breachesInText(read(rel), rel);
}

describe('the raw nutrition map stays out of production code', () => {
  it('scans a real source tree — the guard is not vacuously green', () => {
    // Without this, a broken walker would make every assertion below pass.
    expect(ALL_FILES.length).toBeGreaterThan(50);
    for (const g of GUARDED) expect(ALL_FILES, g.module).toContain(g.module);
    for (const m of GATE_LAYER_MODULES) expect(ALL_FILES, m).toContain(m);
    expect(ALL_FILES).toContain('routes/rik/NutritionInfoPage.tsx');
  });

  it('is pointed at code that really does import the data module', () => {
    // The detector must be looking at the right thing. The page imports from
    // the module, so if this stops matching, the specifier test has rotted and
    // the whole scan would silently pass.
    const page = read('routes/rik/NutritionInfoPage.tsx');
    expect(page).toMatch(/from '(\.\.\/)+data\/rikNutrition'/);
  });

  it('finds no production module reaching the raw map', () => {
    // Every guarded module is excluded, not just rikNutrition.ts: each one
    // legitimately reads its OWN map inside its own gated accessor.
    const production = ALL_FILES.filter((f) => !isTestFile(f) && !GATE_LAYER_MODULES.includes(f));
    expect(production.length).toBeGreaterThan(50);

    const breaches = production.flatMap(breachesIn);
    // A failure here means a module can render IFCT figures without passing
    // the publication gate. Route it through `nutritionFor` instead.
    expect(
      breaches.map((b) => `${b.file}: ${b.how} — ${b.snippet}`),
      'production modules must use nutritionFor(), never the raw rikNutrition map'
    ).toEqual([]);
  });

  it('confirms the page uses the gated accessor only', () => {
    const page = read('routes/rik/NutritionInfoPage.tsx');
    expect(page).toMatch(/\bnutritionFor\b/);
    expect(breachesIn('routes/rik/NutritionInfoPage.tsx')).toEqual([]);
  });

  it('would actually catch a bypass, on text shaped like the real thing', () => {
    // Drives the REAL detector, not a copy of it — a copy drifts and then
    // proves nothing about the code that actually runs.
    const bypasses = [
      "import { rikNutrition } from '../../data/rikNutrition';",
      "import { rikNutrition as raw } from '../../data/rikNutrition';",
      "import * as nutrition from '../../data/rikNutrition';",
      "const r = rikNutrition['CER_MAIDA'];",
      "import { rikNutritionPreliminary } from '../../data/rikNutritionPreliminary';",
      "const p = rikNutritionPreliminary['VEG_CAPSICUM'];",
      "import { rikNutritionIfctWithheld } from '../../data/rikNutritionIfctWithheld';",
      "const w = rikNutritionIfctWithheld['CER_MAIDA'];",
      // Still caught with a comment on the same line, so comment-stripping
      // cannot be used to smuggle one past the scan.
      "import { rikNutrition } from '../../data/rikNutrition'; // needed for the audit",
    ];
    for (const source of bypasses) {
      expect(breachesInText(source, 'probe.ts').length, source).toBeGreaterThan(0);
    }

    // And the other direction: prose that NAMES a guarded module is not a
    // breach. Every one of these appears in the real modules.
    const prose = [
      '// the figures used to be read from ./rikNutritionPreliminary.',
      '/**\n * moved to ./rikNutritionIfctWithheld.\n */',
      '/* see rikNutrition.ts for the policy */',
      '// DO NOT REPOPULATE by importing ./rikNutritionIfctWithheld here.',
      // A bare ' * ...' line is only ever a fragment of the block above, so it
      // is given to the detector as the whole comment a real file contains.
    ];
    for (const source of prose) {
      expect(breachesInText(source, 'probe.ts'), source).toEqual([]);
    }
  });

  it('exempts only the approved audit files, and every one of them exists', () => {
    for (const rel of APPROVED_RAW_MAP_USERS) {
      expect(ALL_FILES, `${rel} is listed as an approved raw-map user`).toContain(rel);
    }
    // Any other test file reaching the raw map is allowed by the scan, but the
    // approved list is what documents the intent. If a new audit file appears,
    // add it here so the exemption stays a decision rather than an accident.
    const otherTestsUsingRawMap = ALL_FILES.filter(
      (f) => isTestFile(f) && !APPROVED_RAW_MAP_USERS.includes(f) && breachesIn(f).length > 0
    );
    expect(otherTestsUsingRawMap).toEqual([]);
  });

  it('keeps every raw map exported, so the dataset audits still work', () => {
    // The guard must not be "fixed" by deleting an export: that would blind
    // every integrity test in rik-nutrition-data.test.ts.
    //
    // `rikNutrition` IS NOW EMPTY, AND THAT IS THE POINT. The 51 IFCT records
    // moved to rikNutritionIfctWithheld on 9 November 2026 so a bundler would
    // stop shipping them; the shipped store holds nothing, while the dataset
    // audits read the same 51 records from the withheld module. The count
    // assertion moved with the data rather than being dropped, so deleting a
    // record still fails a test.
    expect(typeof rikNutrition).toBe('object');
    expect(Object.keys(rikNutrition).length).toBe(0);
    expect(typeof rikNutritionIfctWithheld).toBe('object');
    expect(Object.keys(rikNutritionIfctWithheld).length).toBe(51);
    expect(typeof rikNutritionPreliminary).toBe('object');
    expect(Object.keys(rikNutritionPreliminary).length).toBe(184);
  });

  it('finds no production module reaching the PRELIMINARY map either', () => {
    // Stated separately from the combined scan so a failure names the map that
    // leaked. No screen may read group averages, gated or not.
    const production = ALL_FILES.filter((f) => !isTestFile(f) && !GATE_LAYER_MODULES.includes(f));
    const leaks = production.flatMap(breachesIn).filter((b) => b.how.includes('Preliminary'));
    expect(leaks.map((b) => `${b.file}: ${b.how}`)).toEqual([]);
  });
});
