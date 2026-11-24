# STEP 14D — EGGS CATEGORY IMAGE: QC BLOCKER RESOLVED, INTEGRATED

**e Samagri · RIK (Ration in Kind) · Base Victualling Yard, Visakhapatnam**

| | |
|---|---|
| **Step** | STEP 14D — Eggs category image |
| **Date** | 24 September 2026 |
| **Scope** | **Eggs only.** Extraction method amended for Eggs and subsequent Fresh categories |
| **Milk / Meat** | **Untouched** — not re-extracted, not replaced; migrations 0035 and 0036 unmodified |
| **Result** | **PASS** — 806 tests passed, 0 failed · 0 type errors · 0 lint errors · build successful |

---

## A. SOURCE IDENTIFICATION

| | |
|---|---|
| Source path | `…/uploads/4f100c8d-image.png` |
| MD5 | **`5d21b48c0fc4e32d41247da38887c24c`** |
| Dimensions / format / mode | **1774 × 887 · PNG · RGB** |
| Byte-identical to Steps 14B and 14C | **CONFIRMED** |
| Scratch copy | `/tmp/claude-0/cat14d/src/fresh-sheet-original.png`, copied unchanged |

The previously generated Eggs candidates were **deleted before re-extraction**, so the run read only the original sheet. Pool code read from the database: **`EGGS`**.

---

## B. THE AMENDED RULE, AND THE EXTRACTION

### B.1 What changed, and only for Eggs onward

The subject mask is `min(RGB) < 246`. On a white subject the brightest part of each egg sits **above** that threshold, so it never enters the mask and the silhouette comes out with enclosed holes exactly where the artwork is lightest. The background-whitening step then flattens those holes — which are egg, not background — to pure white.

The amendment, in one sentence: **enclosed holes inside the subject silhouette are filled before any background whitening, and the filled silhouette decides only *which* source pixels are the subject, never *what they contain*.**

Two consequences, both deliberate:

- **Nothing inside the filled silhouette is written to** — not the surround whitening, not the flat-white tidy-up that follows it. The script asserts this before saving: `assert np.array_equal(crop[sil], untouched[sil])`.
- The flat-white tidy-up still runs **outside** the silhouette, across the three-pixel band kept for the subject's soft edge, so the surround is as clean as Milk's and Meat's.

Holes can only be pixels the threshold rejected — that is, at 246 or brighter. Confirmed at run time: the hole pixels' min-channel range is **246–255**. Filling them can therefore only ever preserve near-white artwork; it can never pull a dark region into the subject.

**Not applied retroactively.** Milk and Meat were not re-extracted. Meat would be unaffected in any case — its silhouette has zero interior holes, so the amended rule is a no-op on it.

### B.2 Measurements 1–8

The Eggs card carries the same thin neutral border every card does — left **x 895–897**, right **x 1320–1322**, top **y 12–13** — and the tile was taken strictly inside it.

| # | Measurement | Value |
|---|---|---|
| 1 | Source tile bounding box | **x 898–1319, y 14–375** (422 × 362) |
| 2 | Artwork bounding box | **x 912–1309, y 62–373** on the sheet (398 × 312) |
| 3 | Components found | **2** |
| 4 | Retained / rejected | **1 retained** (68,725 px thresholded + 16,127 px enclosed holes = 84,852 px) / **1 rejected** (a single stray pixel) |
| 5 | Caption-strip boundary | background begins **y 376** (1 row below the tile); glyphs "Eggs" **y 397–435** (22 rows below) |
| 6 | Final dimensions | **800 × 800 RGB PNG**, 166,959 bytes |
| 7 | Fill percentage | **78%** — subject 624 × 489, margins 88 / 88, centred |
| 8 | MD5 | **`728b6f5c933a57562bfc97e3964b52d5`** |

Resize: **1.568× LANCZOS**, the same presentation convention as Milk (1.705×) and Meat (1.444×).

---

## C. VISUAL QC

### C.1 The pixel-level proof that the defect is gone

Measured **at source scale, before any resampling** — which is where preservation can be judged without interpolation in the way:

| | Rejected candidate | **Shipped asset** |
|---|---|---|
| **A.** Source artwork pixels altered during extraction | 16.10% | **0 of 84,852 = 0.0000%** |
| **B.** Maximum per-pixel deviation inside the silhouette | 9 / 255 | **0 / 255** |
| **C.** Pure-white pixels inside the silhouette — source → rendered | 15 → 13,679 | **15 → 15** |
| **D.** Strictly-interior source pixels changed | — | **0 of 80,459 = 0.0000%** |
| **E.** Enclosed hole pixels altered by the render | 12,071 | **0 of 16,127** |
| **E.** Flat pure-white patches > 50 px inside the silhouette | 4 patches, 12,071 px | **0** |

**Resampling, reported separately as the brief requires.** The only difference between the source crop and the delivered canvas is the 1.568× LANCZOS enlargement. It was verified that the canvas contains *exactly* the LANCZOS resize of the unaltered crop (`array_equal` → `True`). Round-tripping the canvas back to source scale differs on 12.15% of silhouette pixels by at most 10 levels, mean 1.16 — that is interpolation arithmetic, inherent to the enlargement convention already approved for Milk and Meat, and it is not an alteration of the artwork.

**The shape test, not the average test.** The brief warns that a low mean difference can hide a shape defect, and it is right: the rejected candidate's mean difference was small too. The discriminating measurement is **enclosed pure white** — for each row of the subject, the white lying *between* the first and last non-white pixel:

```
shipped (holes filled first) :  0.339% enclosed, longest run  39 px
rejected (holes whitened)    : 15.297% enclosed, longest run  97 px
```

A 45× separation. This is the metric TEST 14 asserts, and §G.1 records that it was proven to fail on the rejected file.

### C.2 The rest of the QC

| Check | Evidence | Verdict |
|---|---|---|
| Background clean | 66.94% pure `(255,255,255)`; outer 8-px ring **100.000%** pure white; darkest pixel in the outer 40-px band **255**; 1 blob ≥ 50 px | **PASS** |
| No Milk contamination | Milk artwork ends x 378 → **519 px** of empty sheet before the tile | **PASS** |
| No Meat contamination | Meat artwork ends x 876 → **21 px** of empty sheet before the tile at x 898 | **PASS** |
| No Fresh Vegetables contamination | tile ends x 1319 → Vegetables begins x 1339, **19 px** later | **PASS** |
| No Fresh Fruits / Onion / Potato | all on the bottom row, y 472–844; the tile is y 14–375 — **97 rows** above | **PASS** |
| No caption contamination | tile ends 1 row above the strip, 22 above the glyphs; 0 dark blobs ≥ 30 px outside the subject band | **PASS** |
| No text / no logo / no watermark | one connected blob ≥ 50 px, and it is the artwork | **PASS** |
| No border | no row or column >97% non-white; all four canvas edges entirely pure white | **PASS** |
| No recolouring / redrawing / stylization / sharpening | 0.0000% of interior pixels altered — §C.1 | **PASS** |
| Mobile suitability | 78% fill; at 56 × 56, 30% of the thumbnail carries the subject; max difference from the untouched reference **6 levels, mean 0.193** (the rejected candidate: 7 / 0.40) | **PASS** |

### C.3 Visual comparison at three scales

Compared against an untouched reference built from the same bounding box with the same LANCZOS factor and **no masking at all**:

- **Full size** — identical egg shading; the only visible difference is the surround, where the reference keeps the card's faint off-white and the asset is pure white. That is the intended background whitening.
- **Enlarged inspection** (top egg, 4×, the region where the rejected candidate showed the artefact) — smooth continuous shading in both. No flat patch, no jagged threshold contour.
- **56 × 56 card size** — indistinguishable; max 6 levels.

Attachments: `qc2-eggs-fullsize.png`, `qc2-eggs-zoom.png`, `qc2-eggs-cardsize.png`.

**QC verdict: PASS.** Proceeded to integration.

---

## D. INTEGRATION

`database/migrations/0037_rik_category_image_eggs.sql` — one row, one column. No column, constraint, table, index, permission or role added; the architecture is Step 14B's, unchanged.

Its verification block RAISEs unless: 18 pools · exactly **3** category pictures · the Eggs path exact · **the Milk path still exactly what 0035 set** · **the Meat path still exactly what 0036 set** · no pool outside those three has a picture · `rik.provisions` still has 173 pictures.

**Idempotency proven.** Applied twice: second run `UPDATE 0`, `updated_at` untouched (Milk 05:39:39, Meat 05:29:29 — neither moved; Eggs 05:56:26).

The admin editor is unchanged: still image-only, still `updatePool(pool.id, { imageRef })`, still exposing no name, unit, ration type or effective dates, still under the pre-existing `rik.entitlement.adjust`.

---

## E. DATABASE BEFORE / AFTER

| Snapshot | Rows | Result |
|---|---|---|
| Pools — code, name, ration type, unit, description, display order, active, effective dates | 18 | **IDENTICAL** |
| Provision `image_ref`, every provision | 189 | **IDENTICAL** |
| Pool scales | 50 | **IDENTICAL** |
| Pool conversions | 7 | **IDENTICAL** |
| RBAC — every permission and role | 26 | **IDENTICAL** |

The only difference anywhere:

```diff
- EGGS|~
+ EGGS|/catalogue/rik/category/eggs.png
```

| Required check | Result |
|---|---|
| `MILK` = `/catalogue/rik/category/milk.png` | **unchanged** |
| `MEAT` = `/catalogue/rik/category/meat.png` | **unchanged** |
| `EGGS` = `/catalogue/rik/category/eggs.png` | **set, from NULL** |
| Remaining 15 pools | **all NULL** |
| Provision `image_ref` | 173 of 189 — **unchanged** |
| Business-rule fields | **none changed** |
| Roles / permissions / PURCHASING | **6 / 20 / absent** |
| Eggs-pool provisions carrying a picture | **0 of 1** |

---

## F. API / CUSTOMER / ADMIN VERIFICATION

| Check | Evidence | Result |
|---|---|---|
| `imageRef` returned by `GET /rik/entitlements/current` | TEST 12, over real HTTP: `EGGS` → `/catalogue/rik/category/eggs.png` | **PASS** |
| Customer card receives the server-provided path | `know-your-ration.test.tsx`: the Eggs card's `src` is the server's value; a sibling test proves the path is never composed from the pool code | **PASS** |
| Production build serves it | `HTTP 200 · image/png · 166,959 bytes`; `vegetables.png` → **404**, which is why the placeholder is correct there | **PASS** |
| Dimensions 800 × 800 | fetched file reads 800 × 800 RGB; TEST 12 also reads it from the IHDR chunk | **PASS** |
| MD5 matches the extracted asset | extracted `728b6f5c…` = deployed = in `dist/` = fetched over HTTP | **PASS** |
| Placeholder still used without `imageRef` | tested for the categories that have none | **PASS** |
| Broken-image fallback | tested: a recorded Eggs cover that fails to load falls back, and the allowance stays on screen | **PASS** |
| Admin editor sends only `{ imageRef }` | asserted, with the payload's key list checked exactly | **PASS** |
| Admin editor exposes no rule-bearing field | asserted absent while the editor is open | **PASS** |

---

## G. TESTS

**7 added. No existing assertion weakened, removed or relaxed.**

### G.1 API — `rik-category-images.integration.spec.ts` (11 → 14)

```
✓ TEST 12 — Eggs returns the correct imageRef, and that file exists
✓ TEST 13 — adding Eggs left Milk and Meat, and every figure, alone
✓ TEST 14 — the Eggs asset preserves the source artwork, not a flattened copy
```

TEST 13 pins Milk's and Meat's paths (the two approved, closed categories), Eggs' rule-bearing fields (`Eggs` / **`piece`** / `FRESH`), and its active scales (`EV 2.0000`, `NV 2.0000`).

**TEST 14 is the guard against this step's defect recurring.** The two builds of this artwork differ only in near-white interior pixels, so no size, hash-shape or magic-byte check separates them. TEST 14 therefore decodes the shipped PNG with no image library — inflating the IDAT stream and undoing the per-scanline filters, Paeth included — and measures **enclosed pure white** per row inside the subject box. Bounds: enclosed fraction < 2% and longest run < 60 px.

**The guard was proven to bite.** Temporarily substituting the rejected candidate for the shipped file made TEST 14 fail with `Received: 0.15297292968878798` against `Expected: < 0.02`; the correct asset was restored and its MD5 re-checked. A regression test that cannot fail is worth nothing, so this one was made to fail on purpose once.

### G.2 Customer web — `know-your-ration.test.tsx` (+3)

```
✓ gives Milk, Meat and Eggs three different covers on one list
✓ falls back to the placeholder when the Eggs cover fails to load
✓ never puts the Eggs cover on the Table Eggs provision row
```

The first asserts all three `src` values and that the set has size 3 — one shared picture would pass a weaker check.

### G.3 Admin web — `rik-config.test.tsx` (+1)

```
✓ sets a third category’s image without disturbing the two that have one
```

### G.4 The smallest possible assertion update, and why

The category-image set legitimately expanded from `{Milk, Meat}` to `{Milk, Meat, Eggs}`. Because Step 14C had already reduced that fact to **one table**, the update was four lines:

1. `WITH_PICTURE` gained `['EGGS', EGGS_IMAGE]`. Every count in the suite derives from this table, so TEST 1's "pools without a picture" figure followed automatically from 16 to 15.
2. `FRESH_WITHOUT_PICTURE` lost `'EGGS'` — it still names the four remaining Fresh categories individually, so filling one out of turn still fails by name.
3. TEST 4's title and one comment.
4. The customer fixture `EGGS_WITH_OPTIONS.imageRef` went from `null` to the path.

**No assertion was relaxed.** The "every Dry category is still null" check, the per-name Fresh checks, and the cross-over checks all remain exactly as strong as they were, and the suite gained TEST 14, which is stricter than anything preceding it.

---

## H. TYPECHECK / LINT / BUILD

| Workspace | Suites | Tests |
|---|---|---|
| `apps/api` (Jest, real PostgreSQL) | 24 | **577** |
| `apps/customer-web` (Vitest) | 6 | **118** |
| `apps/admin-web` (Vitest) | 8 | **99** |
| `packages/config` (Vitest) | 2 | **12** |
| **Total** | **40** | **806 passed, 0 failed** |

806 = 799 at Step 14C close + 7 added.

| Gate | Result |
|---|---|
| `npm run typecheck` (5 workspaces) | exit 0 — **0 errors** |
| `npm run lint` — `eslint . --max-warnings=0` | exit 0 — **0 findings** |
| `npm run build` (production) | exit 0 — **successful**; PWA precache 9 entries (375.83 KiB), unchanged |

---

## I. FILES CHANGED

**Five. Zero application source files.**

| File | Change |
|---|---|
| `apps/customer-web/public/catalogue/rik/category/eggs.png` | **new** — the extracted asset |
| `database/migrations/0037_rik_category_image_eggs.sql` | **new** — sets `image_ref` for `EGGS` only |
| `apps/api/src/rik/rik-category-images.integration.spec.ts` | 3 tests added; 4-line set update (§G.4) |
| `apps/customer-web/src/routes/rik/ration/know-your-ration.test.tsx` | fixture `imageRef` + 3 tests |
| `apps/admin-web/src/routes/rik-config/rik-config.test.tsx` | 1 test |

Plus this report. Migrations on disk: **37**.

**Milk and Meat verifiably untouched:** `milk.png` still `402ff278109db5e14d01bd43cecc0289` (mtime 04:45, Step 14B); `meat.png` still `14eb4d751fdefcec0687fa592c9295e0` (mtime 05:29, Step 14C); migrations 0035 and 0036 unmodified at their original mtimes. No path is hardcoded in application source.

---

## J. WARNINGS AND ISSUES

**No defect. No blocker.** Two observations:

**J-1 — Two extraction rules now exist in the catalogue.** Milk and Meat were built under the original rule and are approved and closed; Eggs and subsequent Fresh categories use the amended rule. This is the decision you took, recorded so it is not mistaken later for an inconsistency. In practice it affects one asset: Meat's silhouette has no interior holes, so it is identical under both rules, and only **Milk** actually differs — 21.70% of its silhouette is flattened, which reads correctly because milk is a flat opaque white. If that is ever to be reconciled, it is a Milk re-issue step of its own, not something to fold into a category step.

**J-2 — 38 residual edge speckles**, 223 px, 0.0348% of the canvas, **none further than 6 px from the artwork**. LANCZOS ringing at the subject edge; Milk and Meat show the same. Invisible at any card size. No action proposed.

**Carried forward, untouched:** W1 (eleven active provisions without an item picture), W2 (`OIL_HYDROGENATED`), W3 (images outside the PWA precache, upscaled from low-resolution sheets — Eggs is 1.568×), and the **oil pack-unit discrepancy**, still OPEN awaiting client business confirmation.

---

## K. CONFIRMATION — ONLY EGGS WAS PROCESSED

| Category | `image_ref` |
|---|---|
| Milk | `/catalogue/rik/category/milk.png` — Step 14B, untouched |
| Meat | `/catalogue/rik/category/meat.png` — Step 14C, untouched |
| **Eggs** | **`/catalogue/rik/category/eggs.png` — this step** |
| Fresh Vegetables · Fresh Fruits · Onion / Garlic · Potato | NULL |
| All 11 Dry categories | NULL |

**Fresh Vegetables was not started.** No other Fresh category and no Dry category was extracted, integrated or touched. Provisions, scales, conversions and RBAC are unchanged.

---

## L. FINAL STATUS

### **PASS**

The blocker is resolved and proven resolved: **0.0000%** of the source artwork altered, max deviation **0/255**, pure-white count inside the silhouette **15 → 15**, and **no** threshold-shaped boundary anywhere — with a regression test that was made to fail on the rejected file before being trusted on the shipped one.

---

**STEP 14D — EGGS CATEGORY IMAGE INTEGRATION: COMPLETE**
