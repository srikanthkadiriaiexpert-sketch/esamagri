import 'reflect-metadata';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { AppModule } from '../app.module';
import { DatabaseService } from '../database/database.service';
import { imageUrl } from './pif.controller';

/**
 * Migration 0054 — the PIF shop's category pictures.
 *
 * WHAT THE CHANGE WAS. Eight photographs cropped from one client-supplied
 * sheet into `apps/customer-web/public/catalogue/pif/category/`, and
 * `image_ref` written on the PIF categories that name them. No API change and
 * no frontend change: `imageUrl()` already passes through a ref that does not
 * begin with `pif/`, which is exactly why a static asset was chosen over an
 * upload — an upload lives on the API's disk and reaches no bundle.
 *
 * TWO DATABASES, ONE SPEC. The categories this migration names are DEMO
 * CATALOGUE data (`database/demo/demo-catalogue.sql`); the Jest database has
 * never been seeded with that catalogue and holds only three of the fourteen
 * names, among a hundred-odd Jest fixtures. So the assertions below are
 * written to be true of ANY database:
 *
 *   - the files are checked on disk, which is environment-independent;
 *   - every PIF category ref, whatever database this runs in, must point into
 *     the PIF folder at a file that actually exists — that catches a typo
 *     wherever it happens;
 *   - the documented mapping is asserted for every named category that is
 *     PRESENT, and the test states how many it checked, so it cannot pass by
 *     silently checking nothing.
 *
 * SHARED PICTURES ARE DELIBERATE HERE. Unlike every RIK image step, this one
 * does NOT assert one picture per row: the client's sheet is a thirty-category
 * taxonomy and this catalogue has fourteen categories in two levels. What is
 * asserted instead is the EXACT sharing, so an accidental duplicate still
 * fails. See the folder's README.
 */
describe('PIF category images (migration 0054, integration, real PostgreSQL + real files)', () => {
  let app: INestApplication;
  let db: DatabaseService;

  const BASE = '/catalogue/pif/category/';
  const RIK_BASES = ['/catalogue/rik/'];
  /** Where the customer app serves its static assets from. */
  const PUBLIC_DIR = join(__dirname, '..', '..', '..', 'customer-web', 'public');

  /** The documented mapping. Category name -> file, sharing included. */
  const EXPECTED: ReadonlyArray<readonly [string, string]> = [
    ['Pulses', 'dals-pulses-beans.png'],
    ['Dals', 'dals-pulses-beans.png'],
    ['Staples', 'atta-rice-grains.png'],
    ['Rice', 'atta-rice-grains.png'],
    ['Atta & Flours', 'atta-rice-grains.png'],
    ['Grains', 'atta-rice-grains.png'],
    ['Sugar & Salt', 'salt-sugar-sweeteners.png'],
    ['Oils & Ghee', 'oils-ghee.png'],
    ['Cooking Oil', 'oils-ghee.png'],
    ['Dairy', 'dairy-milk-eggs.png'],
    ['Milk & Curd', 'dairy-milk-eggs.png'],
    ['Snacks & Biscuits', 'snacks-biscuits-chocolates.png'],
    ['Beverages', 'tea-coffee.png'],
    ['Household', 'detergents-dishwashing.png'],
  ];

  const FILES = [...new Set(EXPECTED.map(([, f]) => f))];

  interface CategoryRow {
    name: string;
    image_ref: string | null;
  }

  const categories = () =>
    db.query<CategoryRow>(`SELECT name, image_ref FROM pif.categories ORDER BY name`);

  /**
   * A PNG's declared size, read from its IHDR rather than decoded. Returns
   * null when the file is not a PNG at all — which is the case this really
   * guards: a renamed JPEG or an empty file would pass "the file exists".
   */
  function pngSize(path: string): { width: number; height: number } | null {
    const b = readFileSync(path);
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (b.length < 24 || !signature.every((v, i) => b[i] === v)) return null;
    if (b.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(DatabaseService);
  });

  afterAll(async () => {
    await app?.close();
  });

  // ===================================================================
  // 1. The files
  // ===================================================================
  it('TEST 1 — all eight pictures are real 256 x 256 RGB PNGs on disk', () => {
    const problems: string[] = [];
    for (const file of FILES) {
      const path = join(PUBLIC_DIR, BASE, file);
      if (!existsSync(path)) {
        problems.push(`${file} is not on disk`);
        continue;
      }
      const size = pngSize(path);
      if (size === null) problems.push(`${file} is not a PNG`);
      else if (size.width !== 256 || size.height !== 256) {
        problems.push(`${file} is ${size.width} x ${size.height}, not 256 x 256`);
      }
    }
    expect(problems).toEqual([]);
    expect(FILES).toHaveLength(8);
  });

  it('TEST 2 — the folder documents its provenance, sharing and licensing', () => {
    const readme = join(PUBLIC_DIR, BASE, 'README.md');
    expect(existsSync(readme)).toBe(true);
    const text = readFileSync(readme, 'utf8');
    // The three things that must never be lost from this folder.
    expect(text).toMatch(/shared/i);
    expect(text).toMatch(/licen[cs]/i);
    expect(text).toMatch(/256 × 256|256 x 256/);
  });

  // ===================================================================
  // 2. The mapping, for whatever is present
  // ===================================================================
  it('TEST 3 — every named category that exists carries exactly its documented picture', async () => {
    const rows = await categories();
    const byName = new Map(rows.map((r) => [r.name, r.image_ref]));

    const present = EXPECTED.filter(([name]) => byName.has(name));
    const wrong = present
      .map(([name, file]) => ({ name, got: byName.get(name) ?? null, want: `${BASE}${file}` }))
      .filter((x) => x.got !== x.want);

    expect(wrong).toEqual([]);
    // Stated, so this test cannot pass by checking nothing: the Jest database
    // holds three of the fourteen, a demo database holds all fourteen.
    expect(present.length).toBeGreaterThanOrEqual(3);
  });

  it('TEST 4 — the sharing is exactly as documented, and no more', async () => {
    const rows = await categories();
    const uses = new Map<string, string[]>();
    for (const r of rows) {
      if (r.image_ref === null || !r.image_ref.startsWith(BASE)) continue;
      uses.set(r.image_ref, [...(uses.get(r.image_ref) ?? []), r.name]);
    }

    const allowed = new Map<string, string[]>();
    for (const [name, file] of EXPECTED) {
      const ref = `${BASE}${file}`;
      allowed.set(ref, [...(allowed.get(ref) ?? []), name]);
    }

    const unexpected: string[] = [];
    for (const [ref, names] of uses) {
      const permitted = allowed.get(ref) ?? [];
      for (const name of names) {
        if (!permitted.includes(name)) unexpected.push(`${name} -> ${ref}`);
      }
    }
    expect(unexpected).toEqual([]);
  });

  it('TEST 5 — every PIF category picture names a file that exists', async () => {
    const rows = await categories();
    const broken = rows
      .filter((r) => r.image_ref !== null)
      .filter((r) => !r.image_ref!.startsWith(BASE) || !existsSync(join(PUBLIC_DIR, r.image_ref!)))
      .map((r) => `${r.name}: ${r.image_ref}`);
    expect(broken).toEqual([]);
  });

  // ===================================================================
  // 3. The API serves it unchanged — no new plumbing was needed
  // ===================================================================
  it('TEST 6 — a static ref passes through imageUrl() untouched, an upload key does not', () => {
    // This passthrough is the whole reason no API change was needed.
    expect(imageUrl(`${BASE}dals-pulses-beans.png`)).toBe(`${BASE}dals-pulses-beans.png`);
    // An uploaded key still becomes a media URL, unchanged behaviour.
    expect(imageUrl('pif/categories/abc.png')).toBe('/pif/media/pif/categories/abc.png');
    // And a category with no picture still reports null, so the card falls
    // back to its placeholder rather than requesting a broken URL.
    expect(imageUrl(null)).toBeNull();
  });

  // ===================================================================
  // 4. PIF and RIK stay apart
  // ===================================================================
  it('TEST 7 — no PIF picture points into a RIK folder, and no RIK row into PIF', async () => {
    const rows = await categories();
    const leaked = rows
      .filter((r) => r.image_ref !== null && RIK_BASES.some((b) => r.image_ref!.startsWith(b)))
      .map((r) => r.name);
    expect(leaked).toEqual([]);

    const rikProvisions = await db.query<{ code: string }>(
      `SELECT code FROM rik.provisions WHERE image_ref LIKE '/catalogue/pif/%'`
    );
    expect(rikProvisions.map((r) => r.code)).toEqual([]);

    const rikPools = await db.query<{ code: string }>(
      `SELECT code FROM rik.entitlement_pools WHERE image_ref LIKE '/catalogue/pif/%'`
    );
    expect(rikPools.map((r) => r.code)).toEqual([]);
  });

  it('TEST 8 — the RIK picture sets are exactly as migration 0053 left them', async () => {
    const provisions = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM rik.provisions WHERE image_ref IS NOT NULL`
    );
    expect(provisions[0]!.n).toBe('180');
    const pools = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM rik.entitlement_pools WHERE image_ref IS NOT NULL`
    );
    expect(pools[0]!.n).toBe('18');
    const total = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM rik.provisions`);
    expect(total[0]!.n).toBe('190');
  });

  it('TEST 9 — this migration gave no PRODUCT a category picture', async () => {
    // Products may carry their own uploaded images; what must never happen is
    // a CATEGORY path landing on a product row.
    const rows = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pif.products WHERE image_ref LIKE '${BASE}%'`
    );
    expect(rows[0]!.n).toBe('0');
  });
});
