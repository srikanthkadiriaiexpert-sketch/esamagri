# STEP 14E — FRESH VEGETABLES FINAL REPORT

**e Samagri · RIK (Ration in Kind) · Base Victualling Yard, Visakhapatnam**

| | |
|---|---|
| **Step** | STEP 14E — Fresh Vegetables category image |
| **Date** | 24 September 2026 |
| **Scope** | **Fresh Vegetables only** |
| **Milk / Meat / Eggs** | **Untouched** — not re-extracted, not replaced; migrations 0035, 0036, 0037 unmodified |
| **Result** | **PASS** — 813 tests passed, 0 failed · 0 type errors · 0 lint findings · build successful |

---

## A. Source

| | |
|---|---|
| Source path | `…/uploads/4f100c8d-image.png` |
| MD5 | **`5d21b48c0fc4e32d41247da38887c24c`** |
| Dimensions / format / mode | **1774 × 887 · PNG · RGB** |
| Byte-identical to Steps 14B, 14C and 14D | **CONFIRMED** — all three scratch copies carry the same MD5 |
| Scratch copy | `/tmp/claude-0/cat14e/src/fresh-sheet-original.png`, copied unchanged |

**Pool code read from the live database, not assumed:** `VEGETABLES` — display name **"Fresh Vegetables"**, `FRESH`, unit `g`, display order 40. The asset path follows the established convention, `/catalogue/rik/category/vegetables.png`.

---

## B. Extraction

### B.1 Tile geometry, measured

Card grid re-measured from the caption band: column gutters at 2–8 | 430–439 | 884–892 | 1325–1334 | 1765–1771; row gutters at 1–9 | 456–467 | 875–885. Fresh Vegetables is the **top-right** card, x 1335–1764, y 10–455.

**This card's artwork is tighter against the border than any so far — there is no white gap on either side.** The boundary was therefore settled by **saturation**, not brightness:

| | saturation | verdict |
|---|---|---|
| x 1337, 1338 | 6.1, 7.5 | neutral → **card border** |
| **x 1339** | **45.8** | coloured → **artwork begins** |
| **x 1760** | **31.3** | coloured → **artwork ends** |
| x 1761, 1762, 1763 | 7.0, 6.0, 3.8 | neutral → **card border** |
| y 12, 13 | 6.0, 4.7 | neutral → **card border** |

| # | Measurement | Value |
|---|---|---|
| Tile bounding box | | **x 1339–1760, y 14–375** (422 × 362) |
| Artwork bounding box | | **x 1341–1758, y 19–373** (418 × 355) |
| Caption-strip boundary | | background begins **y 376** (1 row below the tile); glyphs "Fresh Vegetables" **y 397–435** (22 rows below) |
| Neighbour boundaries | | Milk ends x 378 · Meat ends x 876 · **Eggs ends x 1266** · Fruits/Onion/Potato on the bottom row, y 472–844 |
| Components found | | **3** |
| Retained / rejected | | **1 retained** (126,309 px) / **2 rejected** (1 px each) |
| Final | | **800 × 800 RGB PNG**, 539,858 bytes, **78% fill** (subject 624 × 530), **1.493× LANCZOS** |
| MD5 | | **`88a44298751f8f833512900b60be6a82`** |

The bottom boundary was checked rather than inherited: this card's artwork runs far lower than Meat's or Eggs'. The last **coloured** row is 374, y 375 is the grey contact shadow, and y 376 carries nothing darker than 238 at saturation 6. Tile bottom 375 keeps all of it and excludes the strip.

### B.2 The approved extraction rule

The Step 14D rule was used: threshold → close → dilate + label → keep ≥ 400 px → **fill enclosed interior holes** → whiten background only → resize.

**On this subject the hole-filling step found nothing to fill — 0 enclosed holes.** The vegetables are dense and saturated, so the threshold traced the whole silhouette, exactly as on Meat.

**The amended rule still mattered here**, for its second effect: it also scopes the flat-white tidy-up to *outside* the silhouette. Measured both ways on this artwork:

| | interior pixels altered | newly-created pure-white interior px |
|---|---|---|
| Amended rule (shipped) | **0 (0.0000%)** | **0** |
| Original rule | 718 (0.5684%), max deviation 7 | 718 px in 246 regions, largest 29 |

Small — invisible, unlike the Eggs case — but not nothing, and the shipped asset has none of it.

---

## C. Pixel-Preservation QC

Measured **at source scale, before the 800 × 800 interpolation**.

| # | Measurement | Value |
|---|---|---|
| 1 | Genuine source-artwork pixels | **126,309** |
| 2 | Genuine source-artwork pixels altered | **0** |
| 3 | Percentage altered | **0.0000%** |
| 4 | Maximum per-pixel deviation | **0 / 255** |
| 5 | Mean pixel difference | **0.000000** |
| 6 | Source pure-white px inside artwork | **327** |
| 7 | Rendered pure-white px inside artwork | **327** |
| 8 | Newly-created interior pure-white regions | **0 px in 0 regions** |
| 9 | Longest enclosed-white run | **184 px** — see below |
| 10 | Threshold-shaped / jagged boundary | **none** |
| 11 | Genuine gradients / highlights preserved | **0 of 121,120** strictly-interior px changed; **256 → 256** grey levels, **101,008 → 101,008** distinct RGB colours |

The extraction script asserts the invariant before saving (`assert np.array_equal(crop[sil], untouched[sil])`) rather than trusting it.

### Measurement 9 explained — and why it is not a defect

Enclosed white measures **1.894%** with a longest run of **184 px**, well above Eggs' 0.339% / 39 px. That figure is not flattening; this arrangement has **genuine gaps** — between the cucumbers and the beans, and through the lettuce leaves — where the card background legitimately shows through. Three independent checks confirm it:

- **0.0000%** of interior pixels were altered, so nothing was carved out.
- **100%** of the pixels outside the silhouette but inside its bounding box were **already ≥ 246 in the source** — every one is true card background, not vegetable.
- The **same metric applied to the untouched source crop** gives **2.182%, longest run 127 px**. Scaled by the 1.493× enlargement, 127 × 1.493 ≈ 190 — matching the 184 px measured on the canvas. The gaps are in the artwork, and the extraction slightly *reduced* the figure rather than creating it.

### Resampling, separated

```
the canvas contains EXACTLY the LANCZOS resize of the unaltered crop : True
everything outside that box is pure white                            : True
```

So the only difference between source artwork and shipped file is the 1.493× LANCZOS enlargement — the convention shared with Milk (1.705×), Meat (1.444×) and Eggs (1.568×).

---

## D. Visual QC

| Item | Result |
|---|---|
| Complete Fresh Vegetables artwork | **PASS** — lettuce, broccoli, red cabbage, carrots, three peppers, three tomatoes, cucumbers and beans all present |
| No clipping | **PASS** — artwork x 1339–1760 / y 19–375 sits within the tile; the pixels immediately beyond each edge are card border at saturation < 8. Edge zooms show leaf tips fading naturally into white, with no cut line |
| No Milk contamination | **PASS** — Milk ends x 378; **960 px** of sheet before the tile |
| No Meat contamination | **PASS** — Meat ends x 876; **462 px** before the tile |
| No Eggs contamination | **PASS** — Eggs ends x 1266; **72 px** before the tile |
| No Fresh Fruits contamination | **PASS** — bottom row y 472–844, **97 rows** below the tile |
| No Onion contamination | **PASS** — same |
| No Potato contamination | **PASS** — same |
| No caption | **PASS** — strip background 1 row below the tile, glyphs 22 rows below |
| No text | **PASS** — 0 dark glyph-like blobs outside the subject band |
| No logo | **PASS** — one blob ≥ 50 px; 0 speckles further than 6 px from the subject |
| No watermark | **PASS** — 27 faint low-saturation px outside the artwork |
| No border | **PASS** — no row or column >97% non-white; all four canvas edges entirely pure white |
| No artificial enhancement | **PASS** — 0.0000% of 126,309 interior px altered |
| No recolouring | **PASS** — 0/255 deviation; 101,008 distinct RGB colours in source and render alike |
| No sharpening | **PASS** — no interior pixel written at all |
| No stylization | **PASS** — same |
| No jagged mask boundary | **PASS** — 0 newly-created interior pure-white regions |
| Clean background | **PASS** — 55.70% pure white; outer 8-px ring **100.000%**; darkest pixel in the outer 40-px band **255** |
| Mobile suitability | **PASS** — 78% fill; at 56 × 56, 46% of the thumbnail carries the subject and 39% of it is coloured; max difference from the untouched reference **5 levels, mean 0.081** |

Compared at full size, enlarged (both tight edges) and 56 × 56 against an untouched reference built from the same bounding box with the same LANCZOS factor and no masking.

---

## E. Asset / HTTP Verification

| | |
|---|---|
| Path | `apps/customer-web/public/catalogue/rik/category/vegetables.png` |
| Valid PNG · dimensions · mode | signature valid; IHDR **800 × 800**; **RGB** |
| MD5 | **`88a44298751f8f833512900b60be6a82`** |
| Production build contains the same file | **BYTE-IDENTICAL** (`cmp`) — as are eggs, meat and milk |
| Served over HTTP | **200 · `image/png` · 539,858 bytes · MD5 `88a44298…`**, decodes as 800 × 800 RGB |
| A category without a picture | `fruits.png` → **404**, which is why the placeholder is correct there |

The asset was copied, not regenerated, during deployment.

---

## F. Database Verification

| Snapshot | Rows | Result |
|---|---|---|
| Pool rule-bearing fields | 18 | **IDENTICAL** |
| Provision `image_ref` | 189 | **IDENTICAL** |
| Pool scales | 50 | **IDENTICAL** |
| Pool conversions | 7 | **IDENTICAL** |
| RBAC | 26 | **IDENTICAL** |
| **Fresh Vegetables provisions, every field** | **45** | **IDENTICAL** |

The only difference anywhere:

```diff
- VEGETABLES|~
+ VEGETABLES|/catalogue/rik/category/vegetables.png
```

| Required confirmation | Result |
|---|---|
| Only Fresh Vegetables `image_ref` changed | **CONFIRMED** |
| Milk / Meat / Eggs unchanged | **CONFIRMED** — all three paths exactly as their steps left them |
| Remaining 14 pools NULL | **CONFIRMED** — FRUITS, ONION_GARLIC, POTATO and all 11 Dry |
| All 189 provision `image_ref` unchanged | **CONFIRMED** — 173 with a picture |
| Scales / conversions / RBAC unchanged | **CONFIRMED** — 50 / 7 / 6 roles · 20 permissions |
| No entitlement or business-rule field changed | **CONFIRMED** |
| No new roles · permissions · PURCHASING | **CONFIRMED** |
| Fresh Vegetables provisions untouched | **CONFIRMED** — 45 rows byte-identical; **44 of 45** still carry their own provision picture |

Migration `0038_rik_category_image_vegetables.sql` adds no column, constraint, table or index. Its verification block RAISEs unless 18 pools exist, exactly 4 have a picture, the Fresh Vegetables path is exact, **Milk, Meat and Eggs each still hold their own approved path**, no pool outside the four has one, and `rik.provisions` still has 173. **Idempotency proven** — applied twice, second run `UPDATE 0`, no `updated_at` moved.

---

## G. Application Verification

| Check | Result |
|---|---|
| `GET /rik/entitlements/current` returns `VEGETABLES → imageRef` | **PASS** — TEST 15, over real HTTP |
| repository → service → controller → DTO → client → card | **PASS** — unchanged since Step 14B; every hop carries the field |
| Customer card uses the returned `imageRef` | **PASS** |
| No hardcoded category path | **PASS** — `grep` across all three apps' non-test source returns nothing |
| Image renders / HTTP 200 | **PASS** |
| Placeholder remains functional for NULL categories | **PASS** |
| Broken-image fallback remains functional | **PASS** — tested for Fresh Vegetables specifically |
| Admin editor sends only `{ imageRef }` | **PASS** — `updatePool(pool.id, { imageRef: value })` is the only such call on the screen |
| Admin editor exposes no name, unit, rationType, effectiveFrom, effectiveTo | **PASS** — asserted absent while the editor is open |

---

## H. Tests

**7 added. No existing assertion weakened, removed or relaxed.**

### API — `rik-category-images.integration.spec.ts` (14 → 17)

```
✓ TEST 15 — Fresh Vegetables returns the correct imageRef, and that file exists
✓ TEST 16 — the Fresh Vegetables cover and its 45 provision pictures never swap
✓ TEST 17 — adding Fresh Vegetables left the other three, and every figure, alone
```

**TEST 16 is the sharpest cross-over test in the suite, and it only became possible now.** Fresh Vegetables is the first category whose provisions already carry pictures of their own — 44 of 45, set in Step 12B. Every earlier cover sat above provisions with none, so a leak showed up as *a picture where there had been a placeholder*. Here it would show up as **the wrong picture**: a crate of mixed vegetables against Tomato Red, or one tomato standing for the whole allowance. The test asserts no provision carries the cover or any category path, the cover appears in no provision row, and the count of provision pictures is still 44.

### Customer web — `know-your-ration.test.tsx` (+3)

```
✓ gives all four pictured categories their own cover on one list
✓ falls back to the placeholder when the Fresh Vegetables cover fails to load
✓ shows each vegetable its own picture, never the category cover
```

The fixture gives its provisions **real** picture paths — earlier category fixtures did not — so the third test asserts Tomato Red and Broccoli each keep their own `src` while the cover appears on neither.

### Admin web — `rik-config.test.tsx` (+1)

```
✓ sets a fourth category’s image while three already have one
```

### The smallest legitimate set update — six lines

The set expanded from `{Milk, Meat, Eggs}` to `{Milk, Meat, Eggs, Fresh Vegetables}`. Because Step 14C reduced that fact to one `WITH_PICTURE` table, the change was: the table gained a row (every count derives from it, so TEST 1's figure followed 15 → 14 automatically), `FRESH_WITHOUT_PICTURE` lost `'VEGETABLES'` while still naming the other three individually, the suite title, TEST 4's title, and one comment.

**Preserved in full:** the exact category set with each path, the per-name Fresh assertions, "every Dry category is still null", the image-path shape checks, and every cross-over check. The suite also **gained** TEST 16.

**A note on what was deliberately *not* added.** Eggs' TEST 14 guards against interior flattening by measuring enclosed white. That guard is meaningless here and was not copied: on this subject the flattening the original rule would cause is 718 px, and a statistical guard cannot separate it (197,498 vs 197,394 distinct colours; 14.28% vs 14.40% pure white). Writing one would give false confidence rather than protection, so the Fresh Vegetables tests assert what is actually provable.

### Totals

| Workspace | Suites | Tests | Failed | Skipped |
|---|---|---|---|---|
| `apps/api` (Jest, real PostgreSQL) | 24 | **580** | 0 | 0 |
| `apps/customer-web` (Vitest) | 6 | **121** | 0 | 0 |
| `apps/admin-web` (Vitest) | 8 | **100** | 0 | 0 |
| `packages/config` (Vitest) | 2 | **12** | 0 | 0 |
| **Total** | **40** | **813 passed** | **0** | **0** |

813 = 806 at Step 14D close + 7 added.

---

## I. Typecheck / Lint / Build

| Gate | Result |
|---|---|
| `npm run typecheck` (5 workspaces) | exit 0 — **0 type errors** |
| `npm run lint` — `eslint . --max-warnings=0` | exit 0 — **0 errors, 0 warnings** |
| `npm run build` | exit 0 — **successful**; PWA precache 9 entries (375.83 KiB), unchanged |

---

## J. Files Changed

**Five. Zero application source files.**

| Category | File |
|---|---|
| **1. Asset** | `apps/customer-web/public/catalogue/rik/category/vegetables.png` (new) |
| **2. Migration** | `database/migrations/0038_rik_category_image_vegetables.sql` (new) |
| **3. Tests** | `apps/api/src/rik/rik-category-images.integration.spec.ts` · `apps/customer-web/src/routes/rik/ration/know-your-ration.test.tsx` · `apps/admin-web/src/routes/rik-config/rik-config.test.tsx` |
| **4. Documentation** | this report (new) |
| **5. Application source** | **none** |

Every file carrying the `imageRef` pathway — repository ×2, services ×2, controllers ×2, DTO, both API clients, `CatalogueItem.tsx`, `KnowYourRationPage.tsx`, `PoolsPage.tsx` — has a modification time between **04:46 and 04:51**, during Step 14B. None was touched by 14C, 14D or 14E. Four categories have now been added without a line of application change.

Migrations on disk: **38**. Category assets: `eggs.png`, `meat.png`, `milk.png`, `vegetables.png`.

---

## K. Warnings

**No defect. No blocker.** Three observations, none new in kind:

**K-1 — Two extraction rules exist in the catalogue.** Milk and Meat were built under the original rule (approved, closed); Eggs and Fresh Vegetables under the amended one. Recorded, per your Step 14D decision. In practice only **Milk** differs materially between the rules. **No action proposed.**

**K-2 — "image_ref only" is a property of the editor, not of the endpoint.** The editor sends `{ imageRef }` alone; `PATCH /admin/rik/config/pools/:id` is the general pool-configuration endpoint from Step 11C and still accepts the rule-bearing fields, as pool administration requires. **No action proposed.**

**K-3 — 47 residual edge speckles**, 239 px, 0.0373% of the canvas, none further than 6 px from the artwork. LANCZOS ringing; all four assets show it. Invisible at card size. **No action proposed.**

### Carry-forward warnings — confirmed untouched

| Item | State |
|---|---|
| **Step 13 W1** — active provisions without an individual provision image | **OPEN, untouched** |
| **Step 13 W2** — Hydrogenated Oil without a provision image | **OPEN, untouched** |
| **Step 13 W3** — catalogue images outside the PWA precache (9 entries, 375.83 KiB) / source resolution limitation (Fresh Vegetables is a 1.493× upscale) | **OPEN, untouched** |
| **Oil pack-unit discrepancy** | **OPEN, untouched** |

**CATEGORY IMAGE ≠ PROVISION IMAGE.** The Fresh Vegetables cover resolves no provision-image warning. Its 45 provisions are exactly as they were: 44 carry their own picture, 1 does not, and W1 stands on the same terms as before this step.

---

## L. Final Status

### **PASS**

Extraction preserved the source artwork exactly — **0 of 126,309** interior pixels altered, **0/255** deviation, **327 → 327** pure-white pixels, **256 → 256** grey levels, **101,008 → 101,008** distinct colours — with the tile boundary settled by saturation on the tightest card so far, and the one figure that looked high (enclosed white) traced to genuine gaps in the artwork by three independent checks.

**Fresh Vegetables only.** Milk, Meat and Eggs unchanged. **Fresh Fruits, Onion, Potato and the Dry categories not started.**

---

**STEP 14E — FRESH VEGETABLES: PASS**
