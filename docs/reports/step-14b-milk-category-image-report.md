# STEP 14B — MILK CATEGORY IMAGE INTEGRATION

**e Samagri · RIK (Ration in Kind) · Base Victualling Yard, Visakhapatnam**

| | |
|---|---|
| **Step** | STEP 14B — Category image architecture + Milk integration |
| **Date** | 24 September 2026 |
| **Scope** | Approved category-image architecture, implemented. **Milk only.** |
| **Result** | **COMPLETE** — 792 tests passed, 0 failed · 0 type errors · 0 lint errors · build successful |

---

## 1. What was approved and what was built

The client approved, and this step implemented, exactly one addition: **a nullable
`image_ref` column on `rik.entitlement_pools`**, carrying the path to a category's cover
picture, surfaced as `imageRef` on the existing customer entitlement payload and editable
on the existing RIK Admin pools screen.

**One category was populated: MILK.** The other seventeen pools have `image_ref = NULL`
and behave exactly as they did before this step.

**A category picture is not a provision picture.** The catalogue now has two levels and
they are deliberately separate:

| Level | Column | What it shows | Managed on |
|---|---|---|---|
| Category | `rik.entitlement_pools.image_ref` | the cover of a whole allowance — Milk, Meat, Cereals | RIK Admin → Entitlement pools |
| Provision | `rik.provisions.image_ref` | the individual item an officer takes home | RIK Admin → SKU master |

Neither substitutes for the other. Six tests exist solely to prove they never cross over.

## 2. The migration

**`database/migrations/0035_rik_category_images.sql`** — one migration, additive only.

- Part 1 adds `image_ref text` with `ADD COLUMN IF NOT EXISTS`, plus the same non-blank
  `CHECK` that `rik.provisions.image_ref` already carries
  (`rik_entitlement_pools_image_ref_chk`).
- Part 2 sets `image_ref` for **`MILK` only**, keyed on the **pool code** — a code is
  stable, a display name is editable from the admin dashboard, and keying on the name
  would silently mis-attach a picture the first time a spelling was corrected.
- A trailing `DO $$ … $$` block RAISEs unless: 18 pools exist, exactly 1 category picture
  exists, the Milk path is exactly the expected one, no pool other than Milk has a
  picture, and `rik.provisions` still has 173 pictures.

**Idempotency proven, not asserted.** Applied twice. The second run emitted
`NOTICE: column "image_ref" … already exists, skipping`, performed `UPDATE 0`, left
`updated_at` untouched, and passed the verification block.

**Verified live state:**

```
image_ref                text, nullable        YES
rik_entitlement_pools_image_ref_chk
  CHECK ((image_ref IS NULL) OR (btrim(image_ref) <> ''::text))
pools: 18        pools with a picture: 1        MILK → /catalogue/rik/category/milk.png
provisions: 189  provisions with a picture: 173 (unchanged)
```

Migrations on disk: **35** (34 before this step + 0035). Schema contract unchanged at
**56 tables / 5 views** — verified at API boot in every integration suite.

## 3. The image, and its provenance

| | |
|---|---|
| Source sheet | the combined Fresh category sheet supplied with the brief, 1774 × 887 RGB, MD5 `5d21b48c0fc4e32d41247da38887c24c` |
| Tile | first tile of the top row (Milk), sheet coordinates x 11–428, y 12–453 |
| Caption strip | excluded — artwork taken to y 375 only, measured from the sheet, not assumed |
| Subject found | 1 connected component kept of 5; bounding box on the sheet x 49–414, y 23–373 (366 × 351) |
| Output | 800 × 800 RGB PNG, subject 624 × 598 — 78 % fill, LANCZOS, 1.705× |
| Deployed to | `apps/customer-web/public/catalogue/rik/category/milk.png` |
| MD5 | `402ff278109db5e14d01bd43cecc0289` — **identical** to the extracted file |
| Extractor | `/tmp/claude-0/cat/extract_milk.py`, retained and re-runnable |

**The exact extracted image was used.** It was not regenerated, redrawn, recoloured,
sharpened, captioned, or substituted. The only operations were: crop to the measured
tile, isolate the subject by connected component, whiten the surround outside the
subject's own soft edge and shadow, and centre on an 800 × 800 canvas — the identical
pipeline used for the 173 approved provision images. The deployed byte stream and the
extraction output have the same MD5, which is the proof.

The file is also present in the production build at
`apps/customer-web/dist/catalogue/rik/category/milk.png` (155,512 bytes).

## 4. API — the existing payload, one field wider

No new endpoint, no new route, no new permission, no new role.

| File | Change |
|---|---|
| `repositories/entitlement-config.repository.ts` | `PoolRecord.image_ref`; `image_ref` added to the pool SELECT |
| `services/rik-entitlement.service.ts` | `PoolEntitlementView.imageRef`; mapped from the pool row |
| `rik.controller.ts` | category presenter emits `imageRef` |
| `repositories/entitlement-config-admin.repository.ts` | `AdminPoolRow.image_ref`, `PoolWriteInput.imageRef`, `image_ref` in `POOL_COLUMNS`, in `insertPool`, and in `updatePool`'s SET builder |
| `services/rik-admin-config.service.ts` | `imageRef` on create and patch inputs, through `optionalText()`; recorded in the pool audit row |
| `dto/rik-admin-config.dto.ts` | `imageRef?: string \| null` on `CreatePoolDto` and `UpdatePoolDto` — `@IsOptional @IsString @Length(0, 500)` |
| `rik-admin.controller.ts` | `poolView` returns `imageRef` |

The entitlement engine reads this column nowhere. It is presentation only.

## 5. Customer UI — Know Your Ration

| File | Change |
|---|---|
| `lib/api/rik-entitlement-api.ts` | `EntitlementCategory.imageRef: string \| null` |
| `routes/rik/ration/CatalogueItem.tsx` | new `CategoryImage` component, reusing the existing `ImagePlaceholder` |
| `routes/rik/ration/KnowYourRationPage.tsx` | renders `<CategoryImage>` on each category row |

**No path is hardcoded in frontend code.** Verified: `grep` for any
`catalogue/rik/category` literal across both apps' non-test source returns nothing. The
`src` attribute comes from the server's `imageRef` and nowhere else — one test feeds a
deliberately different recorded path and fails if the screen ever composes one from the
pool code.

A category with `imageRef = null` shows the existing neutral placeholder, and the row
still opens and still shows its entitlement. A recorded picture that fails to load falls
back to the same placeholder. A missing cover is never a missing allowance.

## 6. Admin UI — and a scope decision to record

`apps/admin-web/src/routes/rik-config/PoolsPage.tsx` gained a **Category image** column
and an **Image** action beside Retire/Restore.

**Scope decision, stated because the brief asked for it.** The pools screen had **no edit
form for an existing pool at all** — it could create, retire and restore, and nothing
else. Building a general pool editor would have meant exposing `name`, `unit`,
`rationType` and the effective dates, which are **rule-bearing fields** that decide what
is calculated for every officer on the pool. That is substantial unrelated work and a
materially larger risk surface than a picture path warrants.

Rather than expand scope, an **image-only inline editor** was added: one text box, Save,
Cancel. It deliberately does not expose name, unit, ration type or dates, and a test
asserts their absence. Clearing the box sends `null`, not `''` — the column's CHECK
rejects blank, so an empty string would be a 400 for something an administrator is
entitled to do. The create-a-pool form also gained the field.

Both paths use the **pre-existing** `rik.entitlement.adjust` permission. No permission
was created, no role was created, and **no PURCHASING role exists**.

## 7. Data safety — before / after, proven by diff

Five snapshots were taken before any change and re-taken after everything, in the same
format, and compared byte for byte:

| Snapshot | Rows | Result |
|---|---|---|
| Pools — code, name, ration type, unit, description, display order, active, effective dates | 18 | **IDENTICAL** |
| Provision `image_ref`, every provision | 189 | **IDENTICAL** |
| Pool scales — pool, dietary preference, daily qty, active, effective from | 50 | **IDENTICAL** |
| Pool conversions — code, from/to qty, mode, dietary preference, active | 7 | **IDENTICAL** |
| RBAC — every permission and every role | 26 | **IDENTICAL** |

So: all 18 pools remain · no code changed · no name changed · no unit changed · no scale
changed · no conversion changed · no provision changed · no provision picture changed ·
RBAC unchanged at **6 roles / 20 permissions**. The only column that moved in the entire
database is `rik.entitlement_pools.image_ref`, on one row.

## 8. Tests — 19 added, none weakened

**`apps/api/src/rik/rik-category-images.integration.spec.ts`** (new, 8 tests, real
PostgreSQL over HTTP):

```
✓ TEST 1 — a pool without a category picture still works everywhere
✓ TEST 2 — a pool with a picture returns it as imageRef
✓ TEST 3 — Milk returns the correct imageRef, and that file exists
✓ TEST 4 — Milk is the ONLY pool with a picture, by design
✓ TEST 5 — a category picture and a provision picture never cross over
✓ TEST 6 — existing provision pictures are unaffected
✓ TEST 7 — setting and clearing a category picture changes no entitlement figure
✓ TEST 8 — the category picture is RIK_ADMIN work under the permission that existed
```

TEST 3 checks the file's PNG magic bytes on disk, so a path recorded for a file that is
not there fails. TEST 4 asserts the six remaining Fresh categories are **still null** —
the deliberate state is pinned, so a future step cannot quietly populate them. TEST 8
walks all other roles for 403 and anonymous for 401, and re-asserts 6 roles / 20
permissions with no PURCHASING role.

**`apps/customer-web/.../know-your-ration.test.tsx`** (+6):

```
✓ shows the cover the server recorded for a category
✓ takes the path from the server and never builds one from the code
✓ shows the placeholder for a category with no picture, and still opens it
✓ falls back to the placeholder when a recorded cover fails to load
✓ never puts a category cover on a provision row
✓ never puts a provision picture on a category row
```

**`apps/admin-web/.../rik-config.test.tsx`** (+5):

```
✓ shows the recorded category image path, and says so when there is none
✓ sends only the category image when one is saved
✓ clears a category image by sending null, not an empty string
✓ shows the server's refusal of a category image without clearing the row
✓ offers no way to change a pool's name, unit or ration type beside its image
```

**No existing test was weakened and no business-rule assertion was changed to make
anything pass.** The only edits to existing test files were to **fixtures**: the four
`EntitlementCategory` fixtures in `know-your-ration.test.tsx`, the two in
`ration-checkout.test.tsx`, and the `ConfigPool` fixture in `rik-config.test.tsx` each
gained the new `imageRef` field the type now requires. No assertion was relaxed, removed
or rewritten.

## 9. Regression — exact totals

| Workspace | Suites | Tests |
|---|---|---|
| `apps/api` (Jest, real PostgreSQL) | 24 | **571** |
| `apps/customer-web` (Vitest) | 6 | **112** |
| `apps/admin-web` (Vitest) | 8 | **97** |
| `packages/config` (Vitest) | 2 | **12** |
| **Total** | **40** | **792 passed, 0 failed** |

792 = 773 at Step 13 approval + 19 added here.

| Gate | Result |
|---|---|
| `npm run typecheck` (all 5 workspaces) | **0 errors** |
| `npm run lint` — `eslint . --max-warnings=0` | **0 errors, 0 warnings** |
| `npm run build` (production) | **successful** |

Build output: admin-web 312.80 kB JS / 13.57 kB CSS · customer-web 358.72 kB JS /
24.83 kB CSS, PWA precache 9 entries (375.83 KiB — unchanged; catalogue images remain
outside the precache, per open item W3).

## 10. Constraints — each one, and how it was honoured

| Constraint | Honoured |
|---|---|
| Do NOT process Meat, Eggs, Fresh Vegetables, Fresh Fruits, Onion or Potato | Their `image_ref` is NULL; a test pins it |
| `image_ref` remains nullable | Column is `text`, nullable; 17 of 18 pools are NULL |
| Existing pools must keep working without images | Proven by test and by the untouched 792-test regression |
| Do not change pool codes / names / units / scales / conversions / business rules | Five before/after snapshots **IDENTICAL** |
| Do NOT add a new category table | None added; the column sits on the existing pool |
| Use the exact extracted image — no regenerate, redraw, recolour, text, sharpen, substitute | Deployed file MD5 = extraction MD5 |
| Do not hardcode the image path in frontend code | `grep` across both apps' source: no literal; `src` comes from `imageRef` |
| Do NOT create a permission / role / PURCHASING role | 20 permissions, 6 roles, no PURCHASING — snapshot identical, test asserts it |
| Stop rather than expand the admin UI unreasonably | Image-only editor added; the scope decision is recorded in §6 |
| Populate `image_ref` ONLY for Milk | 1 pool with a picture; the migration RAISEs otherwise |
| Do NOT weaken existing tests or change business-rule assertions | Only fixtures gained the new field; §8 |
| One migration for the additive change | `0035_rik_category_images.sql`, idempotent |

## 11. Not done, and deliberately so

- **Meat — not started.** This step stopped at Milk, as instructed.
- Eggs, Fresh Vegetables, Fresh Fruits, Onion / Garlic, Potato — no category picture.
- All eleven Dry categories — no category picture, no work of any kind.
- Step 14A's category-image QC gate remains open: the category images for the other
  categories were never supplied.

## 12. Open items carried forward, unchanged

None of the following was touched, and none is closed by this step:

- **W1** — eleven active provisions without an item picture. OPEN.
- **W2** — `OIL_HYDROGENATED` customer-selectable without a picture. OPEN.
- **W3** — catalogue images outside the PWA precache; images enlarged from
  low-resolution sheets. OPEN.
- **Oil pack-unit discrepancy** — `pack_size`, `unit`, `pack_unit`, image text and
  entitlement arithmetic untouched; no migration created. OPEN, awaiting client business
  confirmation.

---

**STEP 14B — MILK CATEGORY IMAGE INTEGRATION: COMPLETE**
