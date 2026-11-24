# STEP 14C — FINAL MEAT VERIFICATION

**e Samagri · RIK (Ration in Kind) · Base Victualling Yard, Visakhapatnam**

| | |
|---|---|
| **Step** | STEP 14C — Meat category image |
| **Mode** | **VERIFICATION ONLY** — nothing was created, modified, migrated or deleted |
| **Date** | 24 September 2026 |
| **Final status** | **PASS WITH WARNINGS** (see §H — no defect in this step's work; the warnings are one wording distinction and carried-forward open items) |

Every figure below was re-measured against the live repository, the live database and the deployed asset during this run. Nothing is quoted from the Step 14C report.

---

## A. EXTRACTION

### A.1 The original sheet was used — proven by re-derivation

| | |
|---|---|
| Original upload | `…/uploads/4f100c8d-image.png`, MD5 **`5d21b48c0fc4e32d41247da38887c24c`** |
| Scratch copy | `/tmp/claude-0/cat14c/src/fresh-sheet-original.png`, **same MD5** |
| Dimensions / mode / format | **1774 × 887 · RGB · PNG** |
| Contents confirmed | Milk · Meat · Eggs · Fresh Vegetables (top) / Fresh Fruits · Onion · Potato (bottom) |
| Same sheet as Step 14B | **Yes** — byte-identical MD5 to the Milk source |

The extraction script was **re-run from that sheet during this verification**, and the result compared:

```
re-derived from the sheet  14eb4d751fdefcec0687fa592c9295e0
deployed in public/        14eb4d751fdefcec0687fa592c9295e0
in the production build    14eb4d751fdefcec0687fa592c9295e0
re-derived == deployed == built : True
```

The deployed image is reproducible from the original sheet, bit for bit. It is not a screenshot, not a regenerated image, and not a substitution.

### A.2 Meat was extracted only from that sheet

```
tile        : x 444-879  y 16-375   (436 × 360)
components  : 1 found, 1 kept, 0 rejected
subject bbox: x 446-877  y 57-373 on the sheet   (432 × 317)
resize      : 1.444× LANCZOS  ->  624 × 458 on an 800 × 800 canvas
```

### A.3 Caption strip excluded

| | |
|---|---|
| Last artwork row on the sheet | y **372** |
| Tile bottom edge | y **375** — 3 rows of clearance |
| Caption strip background begins | y **376** — **1 row below the tile** |
| Caption glyph rows ("Meat") | y **397–427** — **22 rows below the tile** |

The tile ends before the strip begins, so the caption is excluded by construction, not by filtering.

### A.4 No other category's artwork is present

Artwork extents re-measured inside each card on the top row:

| Card | Artwork x | Artwork y |
|---|---|---|
| Milk | 94 – 378 | 23 – 375 |
| **MEAT (the tile: x 444–879)** | **444 – 876** | **58 – 372** |
| Eggs | 965 – 1266 | 108 – 367 |
| Fresh Vegetables | 1339 – 1761 | 19 – 375 |

- Milk ends at x 378 → **65 px of empty sheet** before the tile begins.
- The tile ends at x 879 → **85 px of empty sheet** before Eggs begins.
- Fresh Fruits, Onion and Potato are on the **bottom row** (y 468–931); the tile is y 16–375.

No pixel of Milk, Eggs, Fresh Vegetables, Fresh Fruits, Onion or Potato can be inside x 444–879, y 16–375. Contamination is structurally impossible, and the single connected subject confirms it.

### A.5 The image (items 5, 6 and 7 of the brief)

| | |
|---|---|
| **5. Path** | **`/catalogue/rik/category/meat.png`** — served from `apps/customer-web/public/catalogue/rik/category/meat.png` |
| **6. Format** | **800 × 800 · RGB · PNG** (IHDR reads 800 × 800), 459,066 bytes |
| **7a. Artwork bounding box** | on the source sheet **x 446–877, y 57–373 (432 × 317)**; on the canvas **x 88–711, y 171–628 (624 × 458)** |
| **7b. Fill percentage** | **78%** — margins 88 px left and right, 171 px top and bottom (exactly centred) |
| **7c. MD5** | **`14eb4d751fdefcec0687fa592c9295e0`** |

---

## B. VISUAL QC

| Check | Measurement | Verdict |
|---|---|---|
| **Background clean** | 63.30% of the canvas is pure `(255,255,255)`; the outer 8-px ring is **100.000%** pure white; the darkest pixel in the outer 40-px band is **255**; one blob ≥ 50 px (the artwork) | **PASS** |
| **No neighbouring artwork** | 65 px / 85 px of empty sheet either side of the tile; bottom-row categories 93 px below it; one connected subject | **PASS** |
| **No caption / text** | 0 dark blobs ≥ 30 px anywhere outside the subject band; caption glyphs are 22 rows below the tile | **PASS** |
| **No logo** | Same test — no isolated mark of any size away from the artwork | **PASS** |
| **No watermark** | 19,753 faint low-saturation pixels exist, of which **19,658 (99.5%) lie inside the artwork silhouette** — they are the fish's pale flank and the contact shadow. Only **8** faint pixels lie outside the artwork. A watermark covers background; nothing here does | **PASS** |
| **No border** | No row and no column is >97% non-white; rows 0 and 799 and columns 0 and 799 are **entirely pure white** | **PASS** |
| **No recolouring / redrawing / stylization** | Deployed pixels resampled back to source scale and compared against the untouched sheet region: mean \|difference\| **1.08 / 255**; RGB means **source (186.0, 133.0, 117.3)** vs **deployed (185.9, 133.0, 117.3)**; mean saturation **78.9 vs 78.9**; edge energy **10.47 vs 10.27** (lower, i.e. resampling softens — the opposite of sharpening) | **PASS** |
| **Mobile suitability** | Single centred subject at 78% fill; 24.9% of the canvas carries colour against white; at 56 × 56 card size 38% of the thumbnail is subject, and the beef, chicken and fish remain individually readable | **PASS** |

Visual inspection at full size and at card size was performed alongside the Milk cover; the two read as one set.

---

## C. INTEGRATION

| | |
|---|---|
| Migration | `database/migrations/0036_rik_category_image_meat.sql` — one row, one column |
| Column / constraint added | **None.** `image_ref` and its `CHECK` came from Step 14B (0035) |
| Migrations on disk | **36** |
| Category assets on disk | `meat.png`, `milk.png` — and nothing else |
| Served over HTTP from the production build | `/catalogue/rik/category/meat.png` → **HTTP 200, `image/png`, 459,066 bytes, MD5 `14eb4d75…`** |
| Milk still served | `/catalogue/rik/category/milk.png` → **HTTP 200**, 155,512 bytes |
| A category without a picture | `/catalogue/rik/category/eggs.png` → **HTTP 404** — no file exists, which is why the placeholder is the correct behaviour |

---

## D. DATABASE VERIFICATION

Snapshots taken before migration 0036 were re-compared against the live database during this run, byte for byte:

| Snapshot | Rows | Result |
|---|---|---|
| Pools — code, name, ration type, unit, description, display order, active flag, effective dates | 18 | **IDENTICAL** |
| Provision `image_ref`, every provision | 189 | **IDENTICAL** |
| Pool scales | 50 | **IDENTICAL** |
| Pool conversions | 7 | **IDENTICAL** |
| RBAC — every permission and every role | 26 | **IDENTICAL** |

The only difference anywhere is one line of the pool-image snapshot:

```diff
- MEAT|~
+ MEAT|/catalogue/rik/category/meat.png
```

| Required check | Result |
|---|---|
| Only `MEAT.image_ref` changed | **CONFIRMED** — every other pool field is byte-identical |
| `MILK.image_ref` unchanged | **CONFIRMED** — `/catalogue/rik/category/milk.png` |
| Other 16 pools remain NULL | **CONFIRMED** — BUTTER_GHEE, CEREALS, CHEESE_NUTRAMUL, CONDIMENTS, DAL, DALIYA, **EGGS**, FRUITS, GARAM_MASALA_WHOLE, HYDROGENATED_OIL, ONION_GARLIC, POTATO, SALT, SUGAR_JAGGERY, TEA_COFFEE, VEGETABLES |
| All 189 provision `image_ref` unchanged | **CONFIRMED** — 173 of 189 carry a picture, as before |
| Scales unchanged | **CONFIRMED** — 50 rows identical |
| Conversions unchanged | **CONFIRMED** — 7 rows identical |
| RBAC unchanged | **CONFIRMED** — 6 roles / 20 permissions |
| No business-rule field changed | **CONFIRMED** |
| No new roles | **CONFIRMED** — 6 |
| No new permissions | **CONFIRMED** — 20 |
| No PURCHASING role | **CONFIRMED** — absent |

### The three Meat-pool provisions, every field, read live

| code | name | unit | pack_size | pack_unit | brand | image_ref | ratio | is_active |
|---|---|---|---|---|---|---|---|---|
| `MEAT_CHICKEN` | Chicken / Fowl | g | NULL | NULL | NULL | **NULL** | 1.485714 | t |
| `MEAT_FISH` | Fish | g | NULL | NULL | NULL | **NULL** | 0.604651 | t |
| `MEAT_MUTTON` | Meat | g | NULL | NULL | NULL | **NULL** | 1.000000 | t |

Not modified: the category cover did not reach any of them, and their conversion ratios — the numbers the engine actually multiplies by — are untouched.

---

## E. APPLICATION

| Required check | Evidence | Result |
|---|---|---|
| Meat `imageRef` returned by the category API | `rik-category-images` TEST 9: `GET /rik/entitlements/current` over real HTTP returns `imageRef = /catalogue/rik/category/meat.png` for `MEAT`. Pathway traced through repository → service → controller → client | **PASS** |
| Customer category card receives it | `know-your-ration.test.tsx`: the Meat card's `<img src>` is the server's path; a second test proves the path is taken from the response, not composed from the pool code | **PASS** |
| Meat image renders | Fetched over HTTP from the production build: **200, `image/png`, MD5 matches**. TEST 9 also reads the file from disk, checks the PNG magic bytes and reads 800 × 800 from the IHDR chunk | **PASS** |
| Placeholder still works without an `imageRef` | Tests cover both cases: a category with `imageRef = null` shows the placeholder and still opens with its entitlement intact, and a recorded cover that fails to load falls back to the same placeholder | **PASS** |
| Admin editor allows `image_ref` only | `CategoryImageEditor` renders exactly one input (`aria-label="Category image for <code>"`) plus Save and Cancel, and issues `updatePool(pool.id, { imageRef: value })` — the only `updatePool` call on the screen. A test asserts the payload's key list is exactly `['imageRef']`. **See warning W-1** | **PASS (UI)** |
| Editor does not expose name, unit, rationType, effective dates | Every `setName` / `setUnit` / `setRationType` / `setEffectiveFrom` on the file belongs to `CreatePoolForm` (the add-a-pool panel). The row shows `effectiveFrom` / `effectiveTo` read-only through `EffectiveWindow`. A test asserts those labels are absent while the editor is open | **PASS** |

---

## F. TESTS, TYPECHECK, LINT, BUILD

| Workspace | Suites | Tests |
|---|---|---|
| `apps/api` (Jest, real PostgreSQL) | 24 | **574** |
| `apps/customer-web` (Vitest) | 6 | **115** |
| `apps/admin-web` (Vitest) | 8 | **98** |
| `packages/config` (Vitest) | 2 | **12** |
| **Total** | **40** | **799 passed, 0 failed** |

| Gate | Result |
|---|---|
| `npm run typecheck` (all 5 workspaces) | exit 0 — **0 errors** |
| `npm run lint` — `eslint . --max-warnings=0` | exit 0 — **0 errors, 0 warnings** (log contains only the three echoed commands) |
| `npm run build` (production) | exit 0 — **successful** |

Build output: admin-web 312.80 kB JS / 13.57 kB CSS · customer-web 358.72 kB JS / 24.83 kB CSS · PWA precache 9 entries (375.83 KiB).

**No test was weakened, removed or relaxed.** Step 14C scoped four existing assertions and, in doing so, made them stricter: the "only these pools have a picture" test now checks the exact set **and each path** from one table, and gained two assertions it never had — the five remaining Fresh categories asserted null **by name**, and **every** Dry category asserted null.

---

## G. FILES CHANGED

Step 14B's work (04:45–05:01) and Step 14C's (05:29–05:34) separate cleanly by modification time.

**Step 14C changed exactly six files — and zero application source files:**

| File | Change |
|---|---|
| `apps/customer-web/public/catalogue/rik/category/meat.png` | **new** — the extracted asset |
| `database/migrations/0036_rik_category_image_meat.sql` | **new** — sets `image_ref` for `MEAT` only |
| `apps/api/src/rik/rik-category-images.integration.spec.ts` | 3 tests added; 4 scoped and strengthened |
| `apps/customer-web/src/routes/rik/ration/know-your-ration.test.tsx` | Meat fixture + 3 tests |
| `apps/admin-web/src/routes/rik-config/rik-config.test.tsx` | 1 test |
| `docs/reports/step-14c-meat-category-image-report.md` | **new** — the Step 14C report |

Every file carrying the `imageRef` pathway — repository, entitlement service, both controllers, the DTO, the admin service and repository, both API clients, `CatalogueItem.tsx`, `KnowYourRationPage.tsx`, `PoolsPage.tsx` — was last modified between **04:46 and 04:51**, during Step 14B. None was touched by Step 14C.

### This verification changed nothing

| | |
|---|---|
| Source tree (538 files, per-file MD5) | **IDENTICAL** before and after this run |
| `rik.entitlement_pools`, all fields, 18 rows | **IDENTICAL** before and after |
| `rik.provisions`, all fields, 189 rows | **IDENTICAL** before and after |

---

## H. WARNINGS AND ISSUES

No defect was found in Step 14C's work. Two observations and one carry-forward:

### W-1 — "image_ref only" is a property of the editor, not of the endpoint

The Step 14C brief asks to confirm the admin editor "allows image_ref only". It does: the editor renders one input and sends `{ imageRef }` alone, and no other row editor exists on the pools screen.

What should not be inferred is a **server-side** restriction. `updatePool` calls `PATCH /admin/rik/config/pools/:id`, the general pool-configuration endpoint created in **Step 11C**, and its `UpdatePoolDto` still accepts `name`, `rationType`, `unit`, `description`, `displayOrder`, `effectiveFrom`, `effectiveTo` and `isActive` — as it must, since pool configuration depends on it. Step 14B added `imageRef` to that existing DTO; it did not narrow it, and narrowing it would break pool administration.

So the guarantee is: *the category-image editor cannot send a rule-bearing field*. It is not: *the server would refuse one*. No action is proposed — this is the pre-existing architecture, and it is recorded so the distinction is not mislaid later.

### W-2 — 22 residual edge speckles (cosmetic)

95 px in total, 0.0148% of the canvas, faintest value 238 against white, **none further than 6 px from the artwork**. LANCZOS ringing at the subject edge; the approved Milk asset has the same characteristic. Invisible at any card size. **No action proposed.**

### Carried forward, untouched, still open

Not findings of this verification — they are the items the client has already accepted as open, re-confirmed as unchanged:

- **W1** — eleven active provisions without an item picture, which includes Meat, Fish and Chicken / Fowl. **Still true after this step**, because a category cover is not a provision picture.
- **W2** — `OIL_HYDROGENATED` customer-selectable without a picture.
- **W3** — catalogue images outside the PWA precache (9 entries, 375.83 KiB, unchanged) and enlarged from low-resolution sheets; the Meat asset is a 1.444× upscale, the same convention as Milk.
- **Oil pack-unit discrepancy** — OPEN, awaiting client business confirmation. No `pack_size`, `unit`, `pack_unit`, image text or entitlement arithmetic was changed; no migration was created for it.

---

## I. FINAL STATUS

### **PASS WITH WARNINGS**

Every check in the brief passed. The warnings are **W-1** (a wording distinction worth recording, not a defect), **W-2** (cosmetic, sub-0.02%), and the Step 13 items the client has already accepted as open.

**Meat only.** Milk unchanged. **Eggs not started.** No other Fresh category and no Dry category was touched.

---

**STEP 14C — FINAL MEAT VERIFICATION: PASS WITH WARNINGS**
