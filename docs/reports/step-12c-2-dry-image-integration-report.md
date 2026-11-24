# STEP 12C-2 — DRY CATALOGUE IMAGE INTEGRATION

**e Samagri · RIK Catalogue · Base Victualling Yard, Visakhapatnam**
**Status:** complete, awaiting approval
**Date:** 23 September 2026

---

## 1. Objective and result

Attach the 103 verified dry-catalogue thumbnails from STEP 12C-1 to the
provisions they belong to, using `image_ref`, keyed on provision code.

| | |
|---|---|
| Dry provisions total | **106** |
| Dry provisions with a picture | **103** |
| Dry provisions deliberately without one | **3** |
| Images placed | **103** |
| Provision codes sharing a picture | **0** |
| Provisions carrying more than one picture | **0** |
| Provisions created, deleted or retired | **0** |
| Non-`image_ref` fields changed | **0** |

**No application source code was changed.** The only changes are the migration,
the image files, their README, and tests. The screens already render whatever
`image_ref` says.

---

## 2. Images loaded

The 103 files approved in STEP 12C-1, used byte-for-byte as verified. Byte
identity with the approved set was confirmed by comparing the combined MD5 of
all 103 files before and after they were brought into the repository:

```
approved 12C-1 set   ddaf7205da74fe5054c1574a947992e3
in repository        ddaf7205da74fe5054c1574a947992e3
```

| | |
|---|---|
| Location | `apps/customer-web/public/catalogue/rik/dry/<category>/*.png` |
| Reference stored | `/catalogue/rik/dry/oil/oil__mustard-oil__500ml.png`, and so on |
| Provenance note | `apps/customer-web/public/catalogue/rik/dry/README.md` |
| Size | 36 MB across 11 category folders |

The same convention as the fresh set: static assets in the customer app's
`public/` folder, referenced by a root-relative path. No second storage
architecture was introduced, and no image bytes were put in the database.

**Two-way file check.** Every one of the 103 `image_ref` values resolves to a
file that exists, and every file in the folder is referenced by exactly one
provision. Neither direction has a stray.

---

## 3. Database change

One migration: **`database/migrations/0034_rik_dry_catalogue_images.sql`**.

| Requirement | How it is met |
|---|---|
| Updates `image_ref` only | a single `UPDATE ... SET image_ref, updated_at` |
| Identifies records by stable code | 103 literal `(code, path)` pairs; display names appear only in comments and take no part in the match |
| Creates zero rows | no `INSERT` anywhere in the file |
| Deletes zero rows | no `DELETE` anywhere in the file |
| Modifies no non-image field | no other column is named |
| Same result if run repeatedly | verified: `UPDATE 103`, then `UPDATE 0` |

Because the display name is editable from the RIK Admin dashboard and the code
is not, the migration keys on the code. Keying on the name would silently
mis-attach a picture the first time an administrator corrected a spelling.

The migration ends in a verification block that fails outright on any of: a dry
count other than 106; a dry picture count other than 103; any of the three
intentionally-imageless provisions acquiring a picture; the fresh count moving
off 70; any picture attached to more than one provision; the four oil SKUs not
having four distinct paths; or any of the four oil rows no longer reading
500/1000 with unit `g` and `pack_unit` NULL.

### 3.1 Before / after field comparison

Every provision field except `image_ref`, plus pools, scales, conversions, the
fresh image mapping and the RBAC seed, were dumped before the migration and
again after the entire test suite had run:

| Snapshot | Result |
|---|---|
| `rik.provisions` — code, name, brand, pack_size, pack_unit, unit, consumption_ratio, pool, issue_period, display_order, dietary_preference, is_loose, is_customer_selectable, max_quantity, max_packs, min_eligible_days, is_active, effective_from, effective_to | **identical** |
| `rik.entitlement_pools` | **identical** |
| `rik.pool_scales` | **identical** |
| `rik.pool_conversions` | **identical** |
| Fresh `image_ref` mapping (73 rows) | **identical** |
| Roles + permissions | **identical** |

---

## 4. The four oil SKUs — verified independently

| Provision code | Image | Pack size shown | Distinct file? |
|---|---|---|---|
| `OIL_SUNFLOWER_500` | `/catalogue/rik/dry/oil/oil__sunflower-refined-oil__500ml.png` | **500 ml** | ✅ |
| `OIL_SUNFLOWER_1000` | `/catalogue/rik/dry/oil/oil__sunflower-refined-oil__1litre.png` | **1 Litre** | ✅ |
| `OIL_MUSTARD_500` | `/catalogue/rik/dry/oil/oil__mustard-oil__500ml.png` | **500 ml** | ✅ |
| `OIL_MUSTARD_1000` | `/catalogue/rik/dry/oil/oil__mustard-oil__1litre.png` | **1 Litre** | ✅ |

Four provisions, four distinct `image_ref` values, four distinct files —
checked **by file content**, not only by filename, because a copy-paste slip
would otherwise give two SKUs different names for the same bytes. A front-end
test additionally renders both sunflower pack sizes together and asserts the
two rows show different images, since an officer cannot tell the packs apart by
name alone.

---

## 5. KNOWN CATALOGUE DATA DISCREPANCY — OIL PACK UNIT

**This is recorded, not resolved.**

- The database currently records the oil pack sizes as **500** and **1000**
  with the **entitlement unit `g`**.
- **`pack_unit` is NULL** on all four rows.
- The approved images display **"500 ml"** and **"1 Litre"**.
- **No database correction was made.** `pack_size`, `pack_unit` and `unit` were
  not touched on any row, in this step or in the migration.
- **This requires separate business confirmation** if the client wants the
  catalogue measurement corrected.

The image label and the stored figure are therefore expressed in different
units for the same pack. An image label is not evidence about a stored
quantity, so nothing was inferred from it.

Two readings are possible and they are materially different: either these packs
really are 500 g and 1000 g and the images are worded wrongly, or the oil is
sold by volume and the catalogue is holding a volume in a gram-typed field — in
which case the oil entitlement is being counted in grams against a litre-based
pack. **Deciding between them is a business question, not a migration.**

To make sure this cannot be closed quietly, **TEST 13 pins the stored values**:
if anyone ever "tidies" `pack_size`, `unit` or `pack_unit` on these four rows to
match the picture, the suite fails and says so. The migration header and the
asset folder's README carry the same warning.

---

## 6. Three provisions deliberately without a picture

| Code | Name | `image_ref` |
|---|---|---|
| `OIL_HYDROGENATED` | Hydrogenated Oil | **NULL** |
| `TEA_LOOSE` | Tea (loose, counter issue) | **NULL** |
| `COFFEE_LOOSE` | Coffee (loose, counter issue) | **NULL** |

No supplied sheet depicts them and **nothing was substituted**. Lending one of
them another product's photograph would misrepresent what an officer is
choosing.

The customer API serves `null` for these — never an empty string, which the
database CHECK makes impossible — and the customer screen shows its existing
neutral placeholder, labelled "No picture recorded for …". The fallback was not
removed, weakened or bypassed, and it still covers all three cases: a null
reference, a missing file, and a reference that fails to load.

---

## 7. Customer UI verification

Verified across the dry categories:

| Check | Result |
|---|---|
| Correct image per provision | ✅ one-to-one by code, both directions |
| Correct existing catalogue name | ✅ served from the row, not from the picture |
| Correct existing brand | ✅ unchanged; absent where the catalogue records none |
| Correct existing pack size | ✅ the server's figure, never read off the image |
| Correct category | ✅ each image sits under its own pool's folder |
| No cross-SKU image mapping | ✅ no picture serves two codes; no fresh/dry crossover |
| Missing-image fallback | ✅ placeholder for all three, plus for a broken path |
| Oil variants show the intended image | ✅ each pack size renders its own file |

The screens still show **[image] · name · brand · pack size and unit**, with no
provision id, pool id, code or internal terminology — a test scans the rendered
page for internal identifiers and fails if any appear.

---

## 8. Regression tests

**14 new tests. All pass.** Thirteen in
`apps/api/src/rik/rik-dry-images.integration.spec.ts` against real PostgreSQL
and real HTTP, plus one in the customer app.

| # | Test | Result |
|---|---|---|
| 1 | Exactly 103 dry provisions carry a picture | ✅ |
| 2 | Exactly 3 dry provisions deliberately have none | ✅ |
| 3 | Every provision code maps to exactly one picture, and that file exists | ✅ |
| 4 | No picture serves more than one provision code (173 refs, 173 distinct) | ✅ |
| 5 | The four oil SKUs have distinct pictures, distinct by content | ✅ |
| 6 | A provision with no picture is served `null`, so the screen falls back | ✅ |
| 7 | Image assignment changes no entitlement figure | ✅ |
| 8 | Image assignment leaves a confirmed selection exactly as recorded | ✅ |
| 9 | No provision was created, deleted or retired | ✅ |
| 10 | The fresh image mapping is untouched | ✅ |
| 11 | The assignment is idempotent | ✅ |
| 12 | Only `image_ref` carries this step; no other field is involved | ✅ |
| 13 | The four oil provisions retain their stored measurements exactly | ✅ |
| — | (customer app) Each pack size of one item shows its own picture | ✅ |

### 8.1 One existing assertion was narrowed — please note

STEP 12B's `TEST 3` contained "nothing outside the seventy has a picture". That
was correct when the fresh set was the only set with pictures; once the dry
catalogue had its own 103, it failed.

It was **scoped, not relaxed**. It now reads "no provision outside the seventy
carries a **fresh** picture", and a second assertion was **added** in the same
place: no fresh provision carries a non-fresh picture. The uniqueness check was
widened from the fresh set to the whole catalogue. A dry row that acquired a
fresh picture, or a fresh row that acquired a dry one, still fails — the
protection is stronger than before, not weaker.

---

## 9. Full verification

| Gate | Command | Result |
|---|---|---|
| Typecheck | `tsc --noEmit` (api, admin-web, customer-web) | **clean** |
| Lint | `npm run lint` (all workspaces, `--max-warnings=0`) | **clean, exit 0** |
| Build | `npm run build` (all workspaces) | **success** |
| Tests | `npm run test --workspaces` | **773 passed, 0 failed** |

### 9.1 Exact final totals

| Workspace | Suites / files | Tests |
|---|---|---|
| `@esamagri/api` | 23 | **563** |
| `@esamagri/customer-web` | 6 | **106** |
| `@esamagri/admin-web` | 8 | **92** |
| `@esamagri/config` | 2 | **12** |
| **Total** | **39** | **773 passed, 0 failed** |

Added by STEP 12C-2: **+14**. The 12B cleanup closed at 759.

### 9.2 Required confirmations

| | |
|---|---|
| 189 total provisions unchanged | ✅ 189 |
| 70 Fresh provisions still have images | ✅ 70, mapping byte-identical |
| 103 Dry provisions have images | ✅ 103 |
| 3 Dry provisions intentionally have none | ✅ `OIL_HYDROGENATED`, `TEA_LOOSE`, `COFFEE_LOOSE` |
| Entitlement pools unchanged | ✅ 18, byte-identical |
| Scales unchanged | ✅ 50, byte-identical |
| Conversions unchanged | ✅ 7, byte-identical |
| Roles unchanged | ✅ 6, no PURCHASING |
| Permissions unchanged | ✅ 20 |
| Tables / views | ✅ 56 / 5, verified at boot on all 23 API suites |
| Residual test data | ✅ 0 rows |
| Catalogue total with pictures | 173 (70 fresh + 103 dry) |

---

## 10. Files changed

**Added**

| File | What |
|---|---|
| `database/migrations/0034_rik_dry_catalogue_images.sql` | 103 `image_ref` assignments + verification block |
| `apps/customer-web/public/catalogue/rik/dry/**/*.png` | the 103 verified thumbnails, byte-for-byte |
| `apps/customer-web/public/catalogue/rik/dry/README.md` | provenance, the oil-variant note, the pack-unit warning |
| `apps/api/src/rik/rik-dry-images.integration.spec.ts` | the 13 integration tests |

**Modified**

| File | What |
|---|---|
| `apps/customer-web/src/routes/rik/ration/know-your-ration.test.tsx` | one test: each pack size of one item shows its own picture |
| `apps/api/src/rik/rik-fresh-images.integration.spec.ts` | TEST 3 scoped to the fresh folder, with an added cross-direction assertion (§8.1) |

**Application source changed: none.**

---

## 11. Scope

Not done, as instructed: no oil unit correction, no `pack_size` or `pack_unit`
change, no entitlement change, no new SKU, no provision created, deleted or
retired, no unrelated catalogue data touched.

## STOP

**STEP 12C-2 is complete and stops here.** Step 13 has not been started.
Awaiting approval, and — separately — a business decision on the oil pack unit
recorded in §5.
