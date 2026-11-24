# STEP 14C — MEAT CATEGORY IMAGE EXTRACTION + QC + INTEGRATION

**e Samagri · RIK (Ration in Kind) · Base Victualling Yard, Visakhapatnam**

| | |
|---|---|
| **Step** | STEP 14C — Meat category image |
| **Date** | 24 September 2026 |
| **Scope** | **Meat only.** No other Fresh category, no Dry category. |
| **Architecture** | The Step 14B architecture, reused unchanged — no new table, column, field, permission or role |
| **Result** | **COMPLETE** — 799 tests passed, 0 failed · 0 type errors · 0 lint errors · build successful |

---

## A. EXTRACTION

### A.1 The source (Phase 1)

| | |
|---|---|
| Source path | the original combined Fresh category sheet uploaded with the Step 14B brief — `…/uploads/4f100c8d-image.png` |
| MD5 | `5d21b48c0fc4e32d41247da38887c24c` — **identical** to the file Step 14B extracted Milk from |
| Dimensions | **1774 × 887** |
| Mode / format | **RGB / PNG** |
| Confirmed contents | 7 Fresh categories in 2 rows — top: **Milk · Meat · Eggs · Fresh Vegetables**; bottom: **Fresh Fruits · Onion · Potato** |
| Scratch copy | `/tmp/claude-0/cat14c/src/fresh-sheet-original.png`, copied unchanged (MD5 matches) |

This is the original upload, not a screenshot and not a regenerated image: the byte-identical MD5 to the Step 14B source is the proof.

### A.2 Card geometry, measured from the sheet

The card grid was measured, not assumed, from the brightness profile across the caption band:

```
column gutters : 2-8 | 430-439 | 884-892 | 1325-1334 | 1765-1771
row    gutters : 1-9 | 456-467 | 875-885
→ Meat is the second card of the top row: x 440-883, y 10-455
```

### A.3 The one thing that differs from the Milk run, and why

Every card on this sheet is drawn with a thin neutral border. On the **Milk** card that border is faint enough to fall above the threshold and never enter the mask — Step 14B's run reported *"1 of 5 components kept"*, the other four being small stray fragments. On the **Meat** card the border is solid:

| | pixels in mask | mean saturation | verdict |
|---|---|---|---|
| x = 442, 443 | 289, 293 | 4.0, 4.4 | card border (neutral) |
| x = 444 | 102 | **37.0** | artwork's soft edge |
| x = 880, 881 | 350, 195 | 4.5, 4.4 | card border (neutral) |
| y = 12 | 422 of 436 | 5.5 | card border (neutral) |

Run with Step 14B's tile rectangle unchanged, that border became a ring touching all four edges, the dilation welded it to the artwork, and the result was **one component with a bounding box of the entire tile** — a frame around the picture.

So the tile was taken **strictly inside the border**. The border was told apart from the artwork beside it by **saturation**: the border columns are neutral (saturation ≈ 4) and light (darkest 234); the artwork's own leftmost column, x 444, has saturation 75 and reaches black. The extraction **method** is Step 14B's, unchanged; only the rectangle differs, because the sheet differs.

### A.4 The extraction

Script retained at `/tmp/claude-0/cat14c/extract_meat.py`.

```
tile:       x 444-879  y 16-375   (436 × 360)
components: 1 found, 1 kept, 0 rejected
subject bbox in tile: x 2-433  y 41-357   (432 × 317)
  = absolute on sheet: x 446-877  y 57-373
source subject 432 × 317  ->  canvas 800 × 800, subject 624 × 458 (78% fill)
upscale factor 1.444×  (LANCZOS)
```

Operations performed, in full: crop to the measured tile · threshold gently off the card's white · close the mask · link fragments with a short dilation · label and keep components carrying real area · crop to the subject bounding box · whiten outside the subject's own soft edge and shadow · centre on an 800 × 800 white canvas at 78% fill with one LANCZOS resize.

**Nothing else.** No regeneration, no redraw, no recolour, no stylization, no sharpening, no text, no logo, no border, no watermark, no substitution. The complete Meat artwork — beef cuts, chicken, fish, parsley garnish — is retained in full.

### A.5 Output

| | |
|---|---|
| Pool code (from the database, not invented) | **`MEAT`** — `SELECT code … WHERE ration_type='FRESH'` returns `MEAT \| Meat \| FRESH \| g \| 20` |
| Asset path | `apps/customer-web/public/catalogue/rik/category/meat.png` |
| Format | 800 × 800 RGB PNG, 459,066 bytes |
| MD5 | `14eb4d751fdefcec0687fa592c9295e0` |

---

## B. QUALITY CONTROL (Phase 3)

| # | Check | Result |
|---|---|---|
| 1 | **Source tile bounding box** | x 444–879, y 16–375 (436 × 360), strictly inside the card border on all four sides |
| 2 | **Artwork bounding box** | absolute on sheet **x 446–877, y 57–373** (432 × 317) |
| 3 | **Caption-strip exclusion** | last artwork row **372**; tile bottom **375** → 3 rows clear. Caption background begins **376** (1 row below the tile); the word "Meat" begins **397** (22 rows below the tile) |
| 4 | **Connected components retained** | **1** — the complete Meat arrangement as a single silhouette |
| 5 | **Components rejected** | **0.** No neighbour could be reached: Milk's artwork ends at x 378 (65 px of empty sheet before the tile) and Eggs' begins at x 965 (85 px after it) |
| 6 | **Final dimensions** | **800 × 800 RGB PNG** |
| 7 | **Artwork fill** | **78%** — subject 624 × 458, margins 88 px left and right, 171 px top and bottom (exactly centred) |
| 8 | **Background cleanliness** | 63.30% of the canvas is pure `(255,255,255)`; the outer 8-px ring is **100.000%** pure white; the darkest pixel anywhere in the outer 40-px band is **255**. 22 residual speckles totalling 95 px (**0.0148%** of the canvas, faintest value 238) — all LANCZOS edge ringing, **0** of them further than 6 px from the subject |
| 9 | **Neighbour contamination** | **PASS** — structurally impossible (see 5); no Milk, Eggs or Vegetables pixel is inside the tile |
| 10 | **Caption contamination** | **PASS** — no dark blob ≥ 30 px anywhere outside the subject band; the caption glyph rows (397–427) are 22 rows below the tile |
| 11 | **Text / logo / watermark** | **PASS** — one connected blob ≥ 50 px in the whole image, and it is the artwork |
| 12 | **Border contamination** | **PASS** — no row and no column of the final image is >97% non-white; all four border lines lie outside the tile |
| 13 | **Mobile suitability** | **PASS** — single centred subject at 78% fill, high contrast against white, legible at card size; identical geometry to the approved Milk cover |
| 14 | **Final image MD5** | **`14eb4d751fdefcec0687fa592c9295e0`** |

**QC verdict: PASS.** Proceeded to integration.

---

## C. INTEGRATION (Phase 4)

**`database/migrations/0036_rik_category_image_meat.sql`** — one migration, one row, one column.

It adds **no** column, constraint, table or index: `rik.entitlement_pools.image_ref` and its `CHECK` were created and approved in Step 14B (migration 0035). This is a one-row data change to a presentation field, keyed on the **pool code** (stable) rather than the name (editable from the admin dashboard).

Its verification block RAISEs unless: 18 pools exist · exactly **2** category pictures exist · the Meat path is exactly the expected one · **the Milk path is still exactly what 0035 set** · no pool other than Milk and Meat has a picture · `rik.provisions` still has 173 pictures.

**Idempotency proven.** Applied twice: the first run set the row, the second performed `UPDATE 0`, left `updated_at` untouched (Milk `05:00:44`, Meat `05:29:29` — unchanged by the re-run) and passed the verification block.

Architecture constraints, each honoured:

| Constraint | Status |
|---|---|
| No second category table | Not created — the column sits on the existing pool |
| No additional image field | None — the existing `image_ref` / `imageRef` pathway carries it end to end |
| No new permission, role, or PURCHASING role | 20 permissions, 6 roles, no PURCHASING — asserted in the DB and in tests |
| Admin stays the image-only inline editor | Unchanged; name, unit, ration type and effective dates remain unexposed, with a test asserting their absence |
| Existing `rik.entitlement.adjust` permission | Unchanged — no authorisation code was touched |

---

## D. DATABASE BEFORE / AFTER VERIFICATION (Phase 5)

Snapshots taken before any change and re-taken after everything, same method as Step 14B, compared byte for byte:

| Snapshot | Rows | Result |
|---|---|---|
| Pools — code, name, ration type, unit, description, display order, active, effective dates | 18 | **IDENTICAL** |
| Provision `image_ref`, every provision | 189 | **IDENTICAL** |
| Pool scales | 50 | **IDENTICAL** |
| Pool conversions | 7 | **IDENTICAL** |
| RBAC — every permission and every role | 26 | **IDENTICAL** |

The **only** difference anywhere in the database is one line of the pool-image snapshot:

```diff
- MEAT|~
+ MEAT|/catalogue/rik/category/meat.png
```

Explicit assertions:

```
Milk image_ref unchanged                     : true   (/catalogue/rik/category/milk.png)
Meat image_ref set to the expected path      : true   (/catalogue/rik/category/meat.png)
Category pools still NULL                    : 16
Provision pictures                           : 173 of 189   (unchanged)
Roles / permissions                          : 6 / 20
PURCHASING role present                      : false
Meat-pool provisions carrying a picture      : 0 of 3   (Meat, Fish, Chicken / Fowl)
```

No business-rule data changed: no pool code, name, unit, ration type, description, display order, active flag or effective date; no scale; no conversion; no provision; no role; no permission.

---

## E. TESTS

**7 tests added. No existing assertion was weakened, removed or relaxed.**

### E.1 API — `rik-category-images.integration.spec.ts` (8 → 11)

```
✓ TEST 1  — a pool without a category picture still works everywhere
✓ TEST 2  — a pool with a picture returns it as imageRef
✓ TEST 3  — Milk returns the correct imageRef, and that file exists
✓ TEST 4  — Milk and Meat are the ONLY pools with a picture, by design
✓ TEST 5  — a category picture and a provision picture never cross over
✓ TEST 6  — existing provision pictures are unaffected
✓ TEST 7  — setting and clearing a category picture changes no entitlement figure
✓ TEST 8  — the category picture is RIK_ADMIN work under the permission that existed
✓ TEST 9  — Meat returns the correct imageRef, and that file exists          (new)
✓ TEST 10 — the Meat cover is not shown against Meat, Fish or Chicken        (new)
✓ TEST 11 — adding the Meat cover moved no figure and left Milk alone        (new)
```

TEST 9 reads the file from disk, checks the PNG magic bytes, reads **800 × 800 out of the IHDR chunk**, and asserts the Meat and Milk files are not byte-identical — two categories quietly sharing one picture would satisfy every weaker check.

TEST 10 first asserts the Meat pool really is shared (more than one provision), because that is the condition that makes the rest of the test matter, then asserts none of Meat, Fish or Chicken / Fowl carries the cover.

TEST 11 pins Meat's rule-bearing fields (`Meat` / `g` / `FRESH`), its active scale (`NV 260.0000`), and that **Milk's picture is exactly where Step 14B left it**.

**Existing tests were scoped, not relaxed.** TEST 4 previously asserted the literal list `['MILK']`. It now asserts the exact set **and each one's exact path**, driven by a single `WITH_PICTURE` table, *plus* two assertions it did not have before: the five remaining Fresh categories are still null **by name**, and **every** Dry category is still null. TEST 1's count is now derived from that table rather than hard-coded. TEST 5 and TEST 6 now run their cross-over checks over every category that has a picture instead of over Milk alone. The net effect is a stronger suite: a picture cannot be added anywhere without the exact set being restated in one place.

### E.2 Customer web — `know-your-ration.test.tsx` (+3)

```
✓ shows Meat its own cover, and Milk its own, on the same list
✓ falls back to the placeholder when the Meat cover fails to load
✓ never puts the Meat cover on Meat, Fish or Chicken inside the category
```

The first asserts the two `src` attributes differ from each other, not merely that each is non-null. The third walks every `img` on the category page and asserts none carries the category path.

### E.3 Admin web — `rik-config.test.tsx` (+1)

```
✓ edits one category’s image without touching another that already has one
```

With Milk (already pictured) and Meat (not) both listed, opening the Meat row's editor opens it **only** there, the patch names `pool-meat` and sends `{ imageRef }` alone, and `pool-milk` is never the subject of a request.

---

## F. TYPECHECK / LINT / BUILD

| Workspace | Suites | Tests |
|---|---|---|
| `apps/api` (Jest, real PostgreSQL) | 24 | **574** |
| `apps/customer-web` (Vitest) | 6 | **115** |
| `apps/admin-web` (Vitest) | 8 | **98** |
| `packages/config` (Vitest) | 2 | **12** |
| **Total** | **40** | **799 passed, 0 failed** |

799 = 792 at Step 14B close + 7 added here.

| Gate | Result |
|---|---|
| `npm run typecheck` (all 5 workspaces) | **0 errors** |
| `npm run lint` — `eslint . --max-warnings=0` | **0 errors, 0 warnings** |
| `npm run build` (production) | **successful** |

Build output unchanged in shape: admin-web 312.80 kB JS / 13.57 kB CSS · customer-web 358.72 kB JS / 24.83 kB CSS · PWA precache 9 entries (375.83 KiB). The asset is present in the build at `apps/customer-web/dist/catalogue/rik/category/meat.png`, MD5 `14eb4d751fdefcec0687fa592c9295e0` — identical to the extraction output.

---

## G. FILES CHANGED

**Five files. Zero application source files.**

| File | Change |
|---|---|
| `database/migrations/0036_rik_category_image_meat.sql` | **new** — sets `image_ref` for the `MEAT` pool only |
| `apps/customer-web/public/catalogue/rik/category/meat.png` | **new** — the extracted asset, 800 × 800 RGB |
| `apps/api/src/rik/rik-category-images.integration.spec.ts` | 3 tests added; 4 existing tests scoped and strengthened |
| `apps/customer-web/src/routes/rik/ration/know-your-ration.test.tsx` | Meat fixture + 3 tests added |
| `apps/admin-web/src/routes/rik-config/rik-config.test.tsx` | 1 test added |

That **no application code changed at all** is the clearest evidence the Step 14B architecture was the right one: the repository, service, controller, DTO, API client, customer component and admin editor all carried the second category without modification.

Migrations on disk: **36**. `rik.entitlement_pools` column list unchanged from Step 14B. No path is hardcoded in frontend code — `grep` for `catalogue/rik/category` across all three apps' non-test source returns nothing.

---

## H. CONFIRMATION — ONLY MEAT WAS PROCESSED

| Category | `image_ref` after this step |
|---|---|
| Milk | `/catalogue/rik/category/milk.png` (Step 14B, untouched) |
| **Meat** | **`/catalogue/rik/category/meat.png` (this step)** |
| Eggs | NULL |
| Fresh Vegetables | NULL |
| Fresh Fruits | NULL |
| Onion / Garlic | NULL |
| Potato | NULL |
| All 11 Dry categories | NULL |

**Eggs was not started.** No other Fresh category and no Dry category was extracted, QC'd, integrated or touched in any way. Stopping here, as instructed.

---

## I. WARNINGS AND ISSUES

**No blockers. No defects. Nothing requiring broader architecture or business-rule change.**

Three observations, for the record:

**I-1 — The tile rectangle had to be derived for this card (resolved).** Reusing Step 14B's rectangle verbatim would have framed the picture with the card border. This is a property of the sheet, not of the method: the border is faint on the Milk card and solid on the Meat card. Resolved by measuring the border and cropping inside it; the extraction method itself is unchanged. Each remaining Fresh category will need its own measured rectangle for the same reason — no category should be extracted with another's coordinates.

**I-2 — 22 residual edge speckles, 95 px total (0.0148% of the canvas).** LANCZOS ringing immediately around the subject; none further than 6 px from it, faintest value 238 against white. The Milk asset has the same characteristic. Not visible at any card size. **No action proposed.**

**I-3 — Step 13 open items remain open and were not touched:** W1 (eleven active provisions without an item picture — which includes Meat, Fish and Chicken / Fowl, still true after this step, since a category cover is not a provision picture), W2 (`OIL_HYDROGENATED`), W3 (catalogue images outside the PWA precache; images enlarged from low-resolution sheets — the Meat asset is a 1.444× upscale, the same convention), and the **oil pack-unit discrepancy**, which remains OPEN and awaiting client business confirmation. No `pack_size`, `unit`, `pack_unit`, image text or entitlement arithmetic was changed, and no migration was created for it.

---

**STEP 14C — MEAT CATEGORY IMAGE INTEGRATION: COMPLETE**
