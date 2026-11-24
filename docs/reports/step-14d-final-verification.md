# STEP 14D — EGGS FINAL VERIFICATION

**e Samagri · RIK (Ration in Kind) · Base Victualling Yard, Visakhapatnam**

| | |
|---|---|
| **Step** | STEP 14D — Eggs category image |
| **Mode** | **VERIFICATION ONLY** — nothing created, modified, regenerated, re-extracted or deleted |
| **Date** | 24 September 2026 |
| **Final status** | **PASS WITH WARNINGS** — no defect in the Eggs work; the warnings are pre-existing, already-accepted items and one cosmetic observation |

Every figure below was re-measured against the live repository, the live database and the deployed file during this run. Nothing is quoted from the Step 14D report.

---

## A. Source

| | |
|---|---|
| Original source path | `…/uploads/4f100c8d-image.png` |
| MD5 | **`5d21b48c0fc4e32d41247da38887c24c`** |
| Dimensions | **1774 × 887** |
| Format / mode | **PNG / RGB** |
| Same sheet as Milk (14B) and Meat (14C) | **CONFIRMED** — both of their scratch copies carry the identical MD5 |

---

## B. Extraction

| | |
|---|---|
| Eggs source tile coordinates | **x 898–1319, y 14–375** (422 × 362), strictly inside the card border (left x 895–897, right x 1320–1322, top y 12–13) |
| Eggs artwork bounding box | **x 912–1309, y 62–373** on the sheet (398 × 312) |
| Caption-strip boundary | background begins **y 376** — 1 row below the tile; glyphs "Eggs" **y 397–435** — 22 rows below |
| Connected components found | **2** |
| Retained | **1** — 68,725 px thresholded **+ 16,127 px of enclosed interior holes = 84,852 px** |
| Rejected | **1** — a single stray pixel, below the 400 px floor |
| Method | threshold `min(RGB) < 246` → close → dilate + label → keep ≥ 400 px → **fill enclosed holes** → whiten background only → 1.568× LANCZOS onto 800 × 800 at 78% fill |

### The amended rule, proven by construction rather than by reading the script

The brief asks not to rely on the script's description. So the asset was derived from the sheet **twice** — once under the original rule and once under the amended one — and the deployed file compared against both:

```
deployed == AMENDED-rule render  (holes filled before whitening) : True
deployed == ORIGINAL-rule render (holes whitened)                : False
the two rules do produce different files                         : True
```

The deployed file can only have come from the amended rule.

- Enclosed interior holes rescued: **16,127 px**, min-channel range **246–255** — every one at or above the threshold, so filling them can only ever preserve near-white artwork and can never pull a dark region into the subject.
- Genuine interior egg pixels are therefore classified as artwork: **0 of 16,127 hole pixels were altered** by the render.
- The threshold-hole problem is eliminated: **0** newly-created pure-white interior regions, against **4 regions totalling 12,071 px** in the rejected candidate.

### Re-derivation

The extraction was re-run from the original sheet during this verification:

```
re-derived  728b6f5c933a57562bfc97e3964b52d5
deployed    728b6f5c933a57562bfc97e3964b52d5
in dist/    728b6f5c933a57562bfc97e3964b52d5
re-derived == deployed == built : True
```

---

## C. Pixel-Preservation QC

**Measured at source scale, before the 800 × 800 presentation resize** — which is the only place where preservation can be judged without interpolation in the way.

| # | Measurement | Rejected candidate | **Deployed asset** |
|---|---|---|---|
| 1 | Genuine source-artwork pixels altered | 16.10% | **0 of 84,852 = 0.0000%** |
| 2 | Maximum per-pixel deviation | 9 / 255 | **0 / 255** |
| 3 | Mean pixel difference over the silhouette | — | **0.000000** |
| 4 | Source pure-white px inside the artwork | 15 | **15** |
| 5 | Rendered pure-white px inside the artwork | 13,679 | **15** |
| 6 | Newly-created pure-white interior regions | 12,071 px in 4 regions (largest 4,569) | **0 px in 0 regions** |
| 7 | Threshold-shaped / jagged boundary inside an egg | present | **none** — 0 of 16,127 hole px altered |
| 8 | Complete egg silhouette preserved | — | **yes** — 84,852 px, single component, bbox 398 × 312 |
| 9 | Interior gradients / highlights intact | — | **yes** — 0 of 80,459 strictly-interior px changed; **236 distinct grey levels in the source, 236 in the render** |

Measurement 9's grey-level count is the direct answer to "are the gradients intact": flattening destroys levels, and none were lost.

### Chaining the source-scale proof to the shipped file

```
the shipped canvas contains EXACTLY the LANCZOS resize of the unaltered crop : True
everything outside that box is pure white                                    : True
```

So the **only** difference between the source artwork and the shipped file is the 1.568× LANCZOS enlargement — the same presentation convention approved for Milk (1.705×) and Meat (1.444×). That is resampling, not alteration, and it is reported separately as the brief requires.

### Not declared PASS on a small average

The brief warns that a low mean difference can hide a shape defect, and it is right — the rejected candidate's mean was small too. The discriminating metric is **enclosed pure white**: for each row of the subject, the white lying *between* the first and last non-white pixel.

```
deployed asset (holes filled first) :  0.339% enclosed, longest run  39 px
rejected candidate (holes whitened) : 15.297% enclosed, longest run  97 px
```

A 45× separation. This is the metric the regression test asserts, and §I records that the test was proven to fail on the rejected file before being trusted on this one.

---

## D. Visual QC

Compared at three scales against an untouched reference built from the same bounding box with the same LANCZOS factor and **no masking at all**.

| Item | Result |
|---|---|
| Clean white / light neutral background | **PASS** — 66.94% pure `(255,255,255)`; outer 8-px ring **100.000%** pure white; darkest pixel in the outer 40-px band **255** |
| Complete Eggs artwork | **PASS** — one blob ≥ 50 px, bbox 624 × 489; five eggs and the contact shadow, nothing clipped |
| No Milk contamination | **PASS** — Milk artwork x 94–378; **519 px** of empty sheet before the tile |
| No Meat contamination | **PASS** — Meat artwork x 444–876; **21 px** of empty sheet before the tile |
| No Fresh Vegetables contamination | **PASS** — tile ends x 1319; Vegetables begins x 1339, **19 px** later |
| No Fresh Fruits contamination | **PASS** — bottom row y 472–844, **97 rows** below the tile |
| No Onion contamination | **PASS** — same |
| No Potato contamination | **PASS** — same |
| No caption | **PASS** — tile ends 22 rows above the glyphs |
| No text | **PASS** — 0 dark glyph-like blobs outside the subject band |
| No logo | **PASS** — same test; 0 speckles further than 6 px from the subject |
| No watermark | **PASS** — 83 faint low-saturation pixels outside the artwork, in 19 regions, **largest 14 px, none further than 9.8 px** from the subject: edge ringing, not a mark over background |
| No border | **PASS** — no row or column >97% non-white; all four canvas edges entirely pure white |
| No artificial enhancement | **PASS** — §C.1–9 |
| No recolouring | **PASS** — 0/255 deviation; 236 grey levels preserved exactly |
| No sharpening | **PASS** — no interior pixel written at all |
| No stylization | **PASS** — same |
| No jagged threshold boundary | **PASS** — 0 newly-created pure-white interior regions |
| Mobile suitability | **PASS** — 78% fill; at 56 × 56, 30% of the thumbnail carries the subject; max difference from the untouched reference **6 levels, mean 0.193** |

**Full size** — identical egg shading; the only visible difference is the surround, where the reference keeps the card's faint off-white and the asset is pure white. That is the intended background whitening.
**Enlarged** (the egg that carried the artefact, 4×) — smooth continuous shading in both; no flat patch, no stair-stepped contour.
**56 × 56** — indistinguishable.

---

## E. Asset / HTTP Verification

| | |
|---|---|
| Path | `apps/customer-web/public/catalogue/rik/category/eggs.png` |
| PNG signature | **valid** — `89 50 4E 47 0D 0A 1A 0A` |
| Dimensions | **800 × 800** from the IHDR chunk, and **(800, 800) RGB PNG** as decoded |
| Bytes | 166,959 |
| MD5 | **`728b6f5c933a57562bfc97e3964b52d5`** |
| Production build contains the asset | **yes** — `dist/catalogue/rik/category/eggs.png` |
| `public/` and `dist/` byte-identical | **CONFIRMED** (`cmp`) — for eggs, meat and milk alike |
| Served over HTTP from the build | **HTTP 200 · `image/png` · 166,959 bytes · MD5 `728b6f5c…`** |
| A category without a picture | `vegetables.png` → **HTTP 404**, which is why the placeholder is the correct behaviour there |

---

## F. Database Verification

No change was made. Compared against the **pre-0037 snapshot**, by the same method used in Steps 14B and 14C:

| Snapshot | Rows | Result |
|---|---|---|
| Pool rule-bearing fields — code, name, ration type, unit, description, display order, active, effective dates | 18 | **IDENTICAL** |
| Provision `image_ref` | 189 | **IDENTICAL** |
| Pool scales | 50 | **IDENTICAL** |
| Pool conversions | 7 | **IDENTICAL** |
| RBAC — every permission and role | 26 | **IDENTICAL** |

The only difference anywhere:

```diff
- EGGS|~
+ EGGS|/catalogue/rik/category/eggs.png
```

| Required confirmation | Result |
|---|---|
| Only `EGGS.image_ref` changed in migration 0037 | **CONFIRMED** |
| `MILK` = `/catalogue/rik/category/milk.png` | **unchanged** |
| `MEAT` = `/catalogue/rik/category/meat.png` | **unchanged** |
| Remaining 15 pools NULL | **CONFIRMED** — VEGETABLES, FRUITS, ONION_GARLIC, POTATO and all 11 Dry |
| All 189 provision `image_ref` unchanged | **CONFIRMED** — 173 with a picture, as before |
| Scales unchanged | **CONFIRMED** — 50 |
| Conversions unchanged | **CONFIRMED** — 7 |
| RBAC unchanged | **CONFIRMED** — 6 roles / 20 permissions |
| No entitlement / business-rule field changed | **CONFIRMED** |
| No new roles · no new permissions · no PURCHASING | **CONFIRMED** |

**The Eggs-pool provision, every field, read live:**

| code | name | unit | pack_size | brand | image_ref | ratio | is_active |
|---|---|---|---|---|---|---|---|
| `EGGS_TABLE` | Eggs | piece | NULL | NULL | **NULL** | 1.000000 | t |

The category cover did not reach it.

---

## G. Milk / Meat Regression

| | Milk | Meat |
|---|---|---|
| `image_ref` | `/catalogue/rik/category/milk.png` — **unchanged** | `/catalogue/rik/category/meat.png` — **unchanged** |
| Resolves over HTTP | **200**, `image/png`, 155,512 bytes | **200**, `image/png`, 459,066 bytes |
| MD5 | **`402ff278109db5e14d01bd43cecc0289`** — matches Step 14B | **`14eb4d751fdefcec0687fa592c9295e0`** — matches Step 14C |
| Asset file mtime | 04:45 (Step 14B) | 05:29 (Step 14C) |
| Migration | `0035` unmodified, mtime 04:45 | `0036` unmodified, mtime 05:29 |

Neither asset was modified, re-extracted or replaced. The amended rule was **not** applied retroactively.

---

## H. Application Verification

| Check | Evidence | Result |
|---|---|---|
| `GET /rik/entitlements/current` returns `EGGS → imageRef = /catalogue/rik/category/eggs.png` | asserted over real HTTP against real PostgreSQL in `rik-category-images` TEST 12, which passed in this run | **PASS** |
| repository → service → controller → DTO → client pathway | `imageRef`/`image_ref` present at every hop: repository 5 · service 6 · controller 3 · DTO 4 · customer client 3 · customer card 1 · admin client 4 | **PASS** |
| Customer Eggs card receives the server-provided value | `know-your-ration.test.tsx` asserts the card's `src`; a sibling test feeds a deliberately different path and fails if the screen ever composes one from the pool code | **PASS** |
| Eggs image renders | served **200 / `image/png`**, MD5 matches; decoded 800 × 800 RGB | **PASS** |
| Categories with NULL `imageRef` still use the placeholder | tested; `vegetables.png` legitimately 404s because no file exists | **PASS** |
| Broken-image fallback still works | tested for Eggs specifically — the cover falls back and the allowance stays on screen | **PASS** |
| Admin editor sends only `{ imageRef }` | `updatePool(pool.id, { imageRef: value })` is the **only** `updatePool` call on the pools screen; a test checks the payload's key list is exactly `['imageRef']` | **PASS** |
| Admin editor exposes no name, unit, rationType, effectiveFrom or effectiveTo | `CategoryImageEditor` renders exactly one `TextInput` (`aria-label="Category image for <code>"`) plus Save and Cancel. Every `setName` / `setUnit` / `setRationType` / `setEffectiveFrom` on the file belongs to `CreatePoolForm`, the add-a-pool panel | **PASS** |

No hardcoded category path exists anywhere in application source.

*One distinction, carried forward from the Step 14C verification and unchanged:* this guarantee is that the **editor** cannot send a rule-bearing field. The endpoint it calls, `PATCH /admin/rik/config/pools/:id`, is the general pool-configuration endpoint from Step 11C and still accepts those fields, as pool administration requires. See §L, W-1.

---

## I. Tests

| Workspace | Suites | Tests | Failed | Skipped |
|---|---|---|---|---|
| `apps/api` (Jest, real PostgreSQL) | 24 | **577** | 0 | 0 |
| `apps/customer-web` (Vitest) | 6 | **118** | 0 | 0 |
| `apps/admin-web` (Vitest) | 8 | **99** | 0 | 0 |
| `packages/config` (Vitest) | 2 | **12** | 0 | 0 |
| **Total** | **40** | **806 passed** | **0** | **0** |

No test was modified during this verification.

**No test weakened, removed or relaxed in Step 14D.** The category-image set legitimately expanded from `{Milk, Meat}` to `{Milk, Meat, Eggs}`, and because Step 14C had already reduced that fact to a single `WITH_PICTURE` table the change was four lines: the table gained a row (every count derives from it, so the "pools without a picture" figure followed 16 → 15 automatically), `FRESH_WITHOUT_PICTURE` lost `'EGGS'` while still naming the other four individually, one test title, and one customer fixture. The "every Dry category is still null" check, the per-name Fresh checks and the cross-over checks are all exactly as strong as before — and the suite **gained** TEST 14, which is stricter than anything preceding it.

**TEST 14 was proven able to fail.** It decodes the shipped PNG with no image library — inflating the IDAT stream and undoing the per-scanline filters, Paeth included — because no size, signature or magic-byte check can separate two builds of the same artwork. Substituting the rejected candidate made it fail with `Received: 0.15297…` against `Expected: < 0.02`; the correct asset was then restored and its MD5 re-checked. A regression test that cannot fail is worth nothing.

---

## J. Typecheck / Lint / Build

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` (5 workspaces) | exit **0** — **0 type errors** |
| Lint | `npm run lint` → `eslint . --max-warnings=0` (3 workspaces) | exit **0** — **0 errors, 0 warnings** |
| Build | `npm run build` | exit **0** — **successful** |

Build output: admin-web 312.80 kB JS / 13.57 kB CSS · customer-web 358.72 kB JS / 24.83 kB CSS · PWA precache **9 entries (375.83 KiB)**, unchanged.

---

## K. Files Changed

**Step 14D changed six files. Zero application source files.**

| Category | File |
|---|---|
| **1. Eggs implementation** | *none* — the Step 14B architecture carried the third category without a line of change |
| **2. Migration** | `database/migrations/0037_rik_category_image_eggs.sql` (new) |
| **3. Tests** | `apps/api/src/rik/rik-category-images.integration.spec.ts` · `apps/customer-web/src/routes/rik/ration/know-your-ration.test.tsx` · `apps/admin-web/src/routes/rik-config/rik-config.test.tsx` |
| **4. Documentation** | `docs/reports/step-14d-eggs-category-image-report.md` (new) |
| **5. Asset** | `apps/customer-web/public/catalogue/rik/category/eggs.png` (new) |

**No unrelated source file was modified.** Every file carrying the `imageRef` pathway — repository ×2, services ×2, controllers ×2, DTO, both API clients, `CatalogueItem.tsx`, `KnowYourRationPage.tsx`, `PoolsPage.tsx` — has a modification time between **04:46 and 04:51**, during Step 14B, and none was touched by Step 14C or 14D.

### This verification run changed nothing

| | |
|---|---|
| Repository (542 files, per-file MD5) | **IDENTICAL** before and after |
| `rik.entitlement_pools`, all fields, 18 rows | **IDENTICAL** before and after |
| `rik.provisions`, all fields, 189 rows | **IDENTICAL** before and after |
| Migrations on disk | 37 |
| Category assets on disk | `eggs.png`, `meat.png`, `milk.png` — and nothing else |

Re-derivation and QC renders were written to scratch only, never to the repository.

---

## L. Warnings

**No defect in the Eggs work.**

### W-1 — "image_ref only" is a property of the editor, not of the endpoint *(carried from the Step 14C verification, unchanged)*

The admin editor sends `{ imageRef }` alone and exposes no rule-bearing field — verified again above. What should not be inferred is a server-side restriction: `PATCH /admin/rik/config/pools/:id` is the general pool-configuration endpoint created in Step 11C and still accepts `name`, `rationType`, `unit`, `description`, `displayOrder`, `effectiveFrom`, `effectiveTo` and `isActive`, as pool administration requires. Recorded so the distinction is not mislaid. **No action proposed.**

### W-2 — Two extraction rules now exist in the catalogue *(your decision, recorded)*

Milk and Meat were built under the original rule and are approved and closed; Eggs and subsequent Fresh categories use the amended rule. In practice it affects exactly one asset: Meat's silhouette has zero interior holes, so it is identical under both rules, and only **Milk** actually differs. If ever reconciled, that is a Milk re-issue step of its own. **No action proposed.**

### W-3 — 38 residual edge speckles *(cosmetic)*

223 px, 0.0348% of the canvas, none further than 6 px from the artwork; the faint-pixel analysis found the largest such region to be 14 px at a maximum distance of 9.8 px. LANCZOS ringing at the subject edge; Milk and Meat show the same. Invisible at any card size. **No action proposed.**

### Carry-forward warnings — confirmed untouched

| Item | State |
|---|---|
| **Step 13 W1** — active provisions without an individual provision image | **OPEN, untouched.** `EGGS_TABLE.image_ref` is NULL, verified above |
| **Step 13 W2** — Hydrogenated Oil without a provision image | **OPEN, untouched** |
| **Step 13 W3** — catalogue images outside the PWA precache (9 entries, 375.83 KiB, unchanged) / source-image resolution limitation (Eggs is a 1.568× upscale) | **OPEN, untouched** |
| **Oil pack-unit discrepancy** | **OPEN, untouched** — no `pack_size`, `unit`, `pack_unit`, image text or entitlement arithmetic changed; no migration created |

**CATEGORY IMAGE ≠ PROVISION IMAGE.** The Eggs category cover does **not** resolve W1 for Eggs. The Eggs pool now has a cover for the whole allowance; its provision `EGGS_TABLE` still has no picture of its own, and W1 remains open on exactly the same terms as before this step.

---

## M. Final Status

### **PASS WITH WARNINGS**

Every verification requirement passed. The previous interior-alteration defect is proven gone — **0.0000%** of source artwork altered, max deviation **0/255**, mean difference **0.000000**, pure-white count **15 → 15**, **0** newly-created interior regions, **236 → 236** grey levels — with the amended rule proven by construction rather than by reading the script, and with a regression test demonstrated to fail on the rejected file.

The warnings are one wording distinction (W-1), one recorded consequence of your own decision (W-2), one cosmetic observation (W-3), and the four already-accepted Step 13 items, all untouched.

**Eggs only.** Milk and Meat unchanged. Fresh Vegetables not started.

---

**STEP 14D — EGGS: PASS WITH WARNINGS**
