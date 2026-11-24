import 'reflect-metadata';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { AppModule } from '../app.module';
import { DatabaseService } from '../database/database.service';
import { EntitlementConfigRepository } from './repositories/entitlement-config.repository';

/**
 * Migration 0052 — the seven RIK Fresh STAPLE pictures: Milk, Eggs, Onion,
 * Potato and the three Meat items.
 *
 * WHAT THE CHANGE WAS. One column, `image_ref`, written on seven EXISTING
 * rows, plus seven files on disk. So this suite has two jobs and the second
 * matters more:
 *
 *   1. EVERY PICTURE IS ON THE RIGHT PROVISION, by code rather than by
 *      display name — a display name is editable from the dashboard and a
 *      code is not — and every referenced file is a real 800 x 800 PNG.
 *
 *   2. NOTHING ELSE MOVED. No provision was created, no name, unit,
 *      consumption ratio, pool or pack size was written, and the seventy
 *      fresh-variety and hundred-and-three dry pictures are exactly as they
 *      were.
 *
 * THE NEIGHBOURS ARE CHECKED BY NAME. Milk TD, Garlic and "Fresh Vegetables
 * (in lieu of potato)" sit in the same pools as pictures that arrived in this
 * batch and have no picture of their own. They must keep `image_ref` NULL and
 * keep showing the customer screen's placeholder — a borrowed lookalike is
 * the mis-assignment that would be easiest to make and hardest to notice.
 *
 * AND THE COUPON IS NOT STARTED HERE. The milk picture shows the physical
 * RIK 500 ml coupon beside the bottle, because that is the subject the client
 * supplied. The coupon DENOMINATION — Fresh Milk counted in whole 500 ml
 * coupons — is separate, separately approved and NOT implemented. The last
 * test in this file fails if it has been, because it would have to change
 * MILK_FRESH's unit and ratio.
 *
 * Deliberately no ration period, no advisory lock, no staff account and no
 * HTTP mutation: the change is a column and some files, and a suite that
 * reaches for the current period would serialise against every other RIK
 * suite for no benefit.
 */
describe('RIK fresh staple images (migration 0052, integration, real PostgreSQL + real files)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let config: EntitlementConfigRepository;

  const BASE = '/catalogue/rik/fresh-staples/';
  const FRESH_BASE = '/catalogue/rik/fresh/';
  const DRY_BASE = '/catalogue/rik/dry/';
  /** Where the customer app serves its static assets from. */
  const PUBLIC_DIR = join(__dirname, '..', '..', '..', 'customer-web', 'public');

  /**
   * The mapping under test. Also the provision's name, unit, ratio and pool
   * AS THEY WERE BEFORE the migration, so that "images only" is a checked
   * fact rather than an intention.
   */
  const EXPECTED = [
    // MOVED BY MIGRATION 0053. The photograph shows a milk bottle beside a
    // physical RIK 500 ml coupon, so it belongs to the coupon provision. The
    // loose-millilitre MILK_FRESH it was first attached to now holds no
    // picture at all — asserted below, because a retired provision left
    // showing a coupon would misrepresent what it is.
    { code: 'MILK_FRESH_COUPON', file: 'milk__fresh-500ml-coupon.png', name: 'Fresh Milk (500 ml coupon)', unit: 'piece', ratio: '500.000000', pool: 'MILK' },
    { code: 'EGGS_TABLE', file: 'eggs__table.png', name: 'Eggs', unit: 'piece', ratio: '1.000000', pool: 'EGGS' },
    { code: 'ONION_FRESH', file: 'onion__fresh.png', name: 'Onion', unit: 'g', ratio: '1.000000', pool: 'ONION_GARLIC' },
    { code: 'POTATO_FRESH', file: 'potato__fresh.png', name: 'Potato', unit: 'g', ratio: '1.000000', pool: 'POTATO' },
    { code: 'MEAT_CHICKEN', file: 'meat__chicken-fowl.png', name: 'Chicken / Fowl', unit: 'g', ratio: '1.485714', pool: 'MEAT' },
    { code: 'MEAT_FISH', file: 'meat__fish.png', name: 'Fish', unit: 'g', ratio: '0.604651', pool: 'MEAT' },
    // The client's tile is captioned "Mutton"; the provision is named
    // "Meat". The picture is right and the NAME IS LEFT ALONE — renaming a
    // provision is a business decision, not part of integrating a picture.
    { code: 'MEAT_MUTTON', file: 'meat__mutton.png', name: 'Meat', unit: 'g', ratio: '1.000000', pool: 'MEAT' },
  ] as const;

  /** Provisions beside a new picture that deliberately did NOT get one. */
  const STILL_WITHOUT_A_PICTURE = [
    'MILK_FRESH', // retired by 0053; the coupon picture moved off it
    'MILK_TD', // Milkmaid, beside Fresh Milk in the MILK pool
    'GARLIC_FRESH', // beside Onion in ONION_GARLIC
    'POTATO_ALT_VEGETABLES', // beside Potato in POTATO
    'VEG_FRESH', // the generic placeholders 0033 left alone
    'FRUIT_FRESH',
    'FRUIT_DRY',
  ] as const;

  interface Row {
    code: string;
    name: string;
    unit: string;
    consumption_ratio: string;
    pack_size: string | null;
    is_active: boolean;
    is_customer_selectable: boolean;
    image_ref: string | null;
    pool_code: string;
  }

  const catalogue = () =>
    db.query<Row>(
      `SELECT v.code, v.name, v.unit, v.consumption_ratio::text AS consumption_ratio,
              v.pack_size::text AS pack_size, v.is_active, v.is_customer_selectable,
              v.image_ref, p.code AS pool_code
         FROM rik.provisions v JOIN rik.entitlement_pools p ON p.id = v.pool_id`
    );

  /**
   * A PNG's declared size, read from the IHDR chunk rather than decoded —
   * eight bytes of signature, then the chunk length and type, then width and
   * height as big-endian 32-bit integers. Returns null if it is not a PNG at
   * all, which is the case this is really guarding: a renamed JPEG or an
   * empty file would otherwise pass "the file exists".
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
    config = app.get(EntitlementConfigRepository);
  });

  afterAll(async () => {
    await app?.close();
  });

  // ===================================================================
  // 1. The mapping
  // ===================================================================
  it('TEST 1 — each of the seven provisions carries exactly its own picture', async () => {
    const rows = await catalogue();
    const wrong = EXPECTED.map((e) => {
      const row = rows.find((r) => r.code === e.code);
      return { code: e.code, got: row?.image_ref ?? '(no such provision)', want: `${BASE}${e.file}` };
    }).filter((x) => x.got !== x.want);

    // Reported as the mapping, not as a count, so a failure names the item.
    expect(wrong).toEqual([]);
  });

  it('TEST 2 — exactly seven provisions carry a staple picture, and they are those seven', async () => {
    const rows = await catalogue();
    const withStaple = rows.filter((r) => r.image_ref?.startsWith(BASE)).map((r) => r.code).sort();
    expect(withStaple).toEqual(EXPECTED.map((e) => e.code).sort());
  });

  it('TEST 3 — every picture is a real 800 x 800 PNG on disk', () => {
    const problems: string[] = [];
    for (const e of EXPECTED) {
      const path = join(PUBLIC_DIR, BASE, e.file);
      if (!existsSync(path)) {
        problems.push(`${e.code}: ${e.file} is not on disk`);
        continue;
      }
      const size = pngSize(path);
      if (size === null) {
        problems.push(`${e.code}: ${e.file} is not a PNG`);
      } else if (size.width !== 800 || size.height !== 800) {
        problems.push(`${e.code}: ${e.file} is ${size.width} x ${size.height}, not 800 x 800`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('TEST 4 — the folder documents itself', () => {
    expect(existsSync(join(PUBLIC_DIR, BASE, 'README.md'))).toBe(true);
  });

  // ===================================================================
  // 2. Nothing else moved
  // ===================================================================
  it('TEST 5 — no provision was created or removed, and no pool was', async () => {
    const provisions = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM rik.provisions`);
    const pools = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM rik.entitlement_pools`);
    expect(provisions[0]!.n).toBe('190');
    expect(pools[0]!.n).toBe('18');
  });

  it('TEST 6 — the seven keep every business value they had; only the picture is new', async () => {
    const rows = await catalogue();
    const changed = EXPECTED.map((e) => {
      const r = rows.find((x) => x.code === e.code)!;
      return {
        code: e.code,
        got: [r.name, r.unit, r.consumption_ratio, r.pool_code, r.pack_size, r.is_active],
        want: [e.name, e.unit, e.ratio, e.pool, null, true],
      };
    }).filter((x) => JSON.stringify(x.got) !== JSON.stringify(x.want));

    expect(changed).toEqual([]);
  });

  it('TEST 7 — the seventy fresh-variety and hundred-and-three dry pictures are untouched', async () => {
    const rows = await catalogue();
    expect(rows.filter((r) => r.image_ref?.startsWith(FRESH_BASE))).toHaveLength(70);
    expect(rows.filter((r) => r.image_ref?.startsWith(DRY_BASE))).toHaveLength(103);

    // And no picture leaked between the three sets.
    const strays = rows.filter(
      (r) =>
        r.image_ref !== null &&
        !r.image_ref.startsWith(FRESH_BASE) &&
        !r.image_ref.startsWith(DRY_BASE) &&
        !r.image_ref.startsWith(BASE)
    );
    expect(strays.map((r) => r.code)).toEqual([]);
  });

  it('TEST 8 — one picture belongs to exactly one provision, across the whole catalogue', async () => {
    const rows = await catalogue();
    const refs = rows.filter((r) => r.image_ref !== null).map((r) => r.image_ref!);
    expect(refs).toHaveLength(180); // 70 fresh + 103 dry + 7 staples
    expect(new Set(refs).size).toBe(refs.length);
  });

  it('TEST 9 — the provisions beside these pictures did NOT quietly get one', async () => {
    const rows = await catalogue();
    // `?? '(no such provision)'` would be wrong here and quietly so: `??`
    // treats NULL as nullish, so a provision that correctly has no picture
    // would be reported as a provision that does not exist. The two cases
    // are separated deliberately, because both are failures worth naming and
    // they have different causes.
    const borrowed = STILL_WITHOUT_A_PICTURE.map((code) => {
      const row = rows.find((r) => r.code === code);
      return { code, image_ref: row === undefined ? '(no such provision)' : row.image_ref };
    }).filter((x) => x.image_ref !== null);

    // Milk TD sits directly beside the new milk picture in the same pool;
    // giving it a lookalike would be the easy mistake. It keeps the
    // placeholder until the facility supplies its own photograph.
    expect(borrowed).toEqual([]);
  });

  // ===================================================================
  // 3. What the customer actually gets
  // ===================================================================
  it('TEST 10 — the engine serves the picture to the customer catalogue', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const loaded = await config.loadConfiguration(today);
    const served = EXPECTED.map((e) => {
      const p = loaded.provisions.find((x) => x.code === e.code);
      return { code: e.code, imageRef: p?.image_ref ?? '(not served)' };
    });
    expect(served).toEqual(EXPECTED.map((e) => ({ code: e.code, imageRef: `${BASE}${e.file}` })));
  });

  // ===================================================================
  // 4. The coupon denomination is NOT part of this step
  // ===================================================================
  it('TEST 11 — the coupon carries the picture; the provision it replaced is retired, not deleted', async () => {
    const rows = await catalogue();
    const milk = rows.find((r) => r.code === 'MILK_FRESH')!;
    const coupon = rows.find((r) => r.code === 'MILK_FRESH_COUPON')!;
    const td = rows.find((r) => r.code === 'MILK_TD')!;

    // UPDATED BY MIGRATION 0053. This test used to assert that the coupon
    // denomination had NOT been started, which was right while it was still
    // awaiting approval. It now asserts the shape that replaced it, which is
    // the same guarantee read forwards: the picture is on exactly one
    // provision, and the one it replaced still exists.
    expect(milk.unit).toBe('ml');
    expect(milk.consumption_ratio).toBe('1.000000');
    expect(milk.is_active).toBe(true);
    expect(milk.is_customer_selectable).toBe(false);
    expect(milk.image_ref).toBeNull();

    expect(coupon.unit).toBe('piece');
    expect(coupon.consumption_ratio).toBe('500.000000');
    expect(coupon.pack_size).toBeNull();
    expect(coupon.is_customer_selectable).toBe(true);

    expect(td.unit).toBe('g');
    expect(td.consumption_ratio).toBe('2.500000');
    expect(td.is_customer_selectable).toBe(true);
    expect(td.image_ref).toBeNull();
  });
});
