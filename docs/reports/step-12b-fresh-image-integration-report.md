# STEP 12B — RIK FRESH CATALOGUE IMAGE INTEGRATION

**e Samagri · Base Victualling Yard, Visakhapatnam**
**Module:** RIK (Ration in Kind)
**Status:** complete, awaiting approval
**Date:** 23 September 2026

---

## 1. Objective

Attach the seventy verified fresh-catalogue thumbnails — 44 Fresh Vegetable
varieties and 26 Fresh Fruit varieties — to the provisions they belong to,
using the `image_ref` field STEP 12A created.

This was an image integration and nothing else. One database column was written
on seventy rows, seventy files were added to the customer app's asset folder,
and tests were added. **No application source code was changed at all** — not
one line of the API, the customer app or the admin app. That is the result STEP
12A was designed for: the screens already read whatever `image_ref` says, so
giving the catalogue its pictures needed data, not code.

---

## 2. Image source

The seventy PNG files produced and QC verified in STEP 12A, used byte-for-byte
as verified. Nothing was regenerated, modified, cropped, enhanced, renamed or
recreated. Byte-identity with the delivered set was confirmed by comparing the
combined MD5 of all seventy files before and after they were brought into the
repository:

```
delivered set   1c4d3157c38a2545ce733edf56794dec
in repository   1c4d3157c38a2545ce733edf56794dec
```

Each file is 800 × 800 RGB PNG on a pure white background, with no text, no
border and no neighbouring product.

---

## 3. Mapping result — 70 / 70

Every one of the seventy is attached, and each is attached to exactly one
provision. The mapping was not typed by hand: the migration was generated from
the live provision codes, and the generator refuses to emit anything unless the
display name resolves to exactly one provision, the counts come to 44 and 26,
and no generic placeholder is touched.

| Check | Result |
|---|---|
| Files supplied | 70 |
| Provisions matched | 70 |
| Unmatched files | 0 |
| Ambiguous names | 0 |
| Pictures attached to more than one provision | 0 |
| Provisions with a picture but no file on disk | 0 |
| Files on disk with no provision pointing at them | 0 |

The last two are a genuine two-way check: every `image_ref` in the database
resolves to a real file, and every file in the folder is referenced by exactly
one provision. Neither direction has a stray.

**Keyed on the provision CODE, not the display name.** A code is stable; a
display name is editable from the RIK Admin dashboard. Keying on the name would
have silently mis-attached a picture the first time an administrator corrected a
spelling. The display name appears in a comment beside every row of the
migration so the mapping stays readable, but it takes no part in the match.

### 3.1 Vegetable count

| | |
|---|---|
| Fresh Vegetable varieties | **44** |
| With a picture | **44** |
| Provisions in the VEGETABLES pool | 45 (the 44 varieties + the generic `VEG_FRESH`) |
| `VEG_FRESH` picture | none, deliberately |

### 3.2 Fruit count

| | |
|---|---|
| Fresh Fruit varieties | **26** |
| With a picture | **26** |
| Provisions in the FRUITS pool | 28 (the 26 varieties + `FRUIT_FRESH` and `FRUIT_DRY`) |
| `FRUIT_FRESH` / `FRUIT_DRY` pictures | none, deliberately |

### 3.3 Across the whole catalogue

| Pool | Provisions | With a picture |
|---|---|---|
| VEGETABLES | 45 | 44 |
| FRUITS | 28 | 26 |
| ONION_GARLIC | 2 | 0 |
| POTATO | 2 | 0 |
| every dry pool | 112 | 0 |
| **Total** | **189** | **70** |

The dry catalogue is deliberately untouched — it has its own step, which has not
been started.

---

## 4. Storage approach

The repository already had a convention and it was followed rather than
replaced: static assets live in the customer app's `public/` folder, in a named
subfolder with a README recording their provenance, and are referenced by a
root-relative path. That is exactly how `public/brand/e-samagri-logo.jpg` works
today.

| | |
|---|---|
| Files | `apps/customer-web/public/catalogue/rik/fresh/*.png` |
| Reference stored in `image_ref` | `/catalogue/rik/fresh/01_arvi.png` and so on |
| Provenance note | `apps/customer-web/public/catalogue/rik/fresh/README.md` |
| Total size | 17 MB |

**No second image-storage architecture was invented.** No object-storage client,
no upload endpoint, no image-serving route, no resolver layer. The column holds
a path; the screen renders it.

**No image bytes were put in the database.** The existing architecture has no
requirement for that, and binary in a row would have made the catalogue table
unreadable in every tool the facility uses to inspect it.

The folder is namespaced `rik/fresh` so the dry catalogue, and PIF later, each
get their own without a rename.

### 4.1 Service-worker precache — checked, and correctly excluded

Seventeen megabytes of pictures next to a PWA is worth checking rather than
assuming. It was checked, and the existing configuration already does the right
thing: `vite.config.ts` precaches the app shell only, so the precache is still
**9 entries, 375.54 KiB** after the images were added. Confirmed by building and
reading the generated `dist/sw.js` — no catalogue path appears in it.

A first visit therefore still downloads ~376 KiB before the app is usable, not
17 MB. The images are fetched as ordinary static assets, as they are viewed.

The consequence, stated plainly: **the catalogue pictures are not available
offline.** Making them so means a workbox runtime-caching rule scoped to
`/catalogue/`, which is a decision to take deliberately rather than a side
effect of adding files. It was not taken here, because this step is image
integration and nothing else.

---

## 5. Database changes

One migration: **`database/migrations/0033_rik_fresh_catalogue_images.sql`**.

| Property | How it is met |
|---|---|
| **Deterministic** | 70 literal `(code, path)` pairs generated from the live catalogue; no pattern matching, no name derivation, no randomness. |
| **Idempotent** | Re-ran immediately after the first run: `UPDATE 70`, then `UPDATE 0`. The `IS DISTINCT FROM` guard means a re-run does not even touch `updated_at`. |
| **Limited strictly to `image_ref`** | One `UPDATE ... SET image_ref, updated_at`. No `INSERT`, no `DELETE`, no `ALTER`, no other column. |
| **Safe for confirmed selections** | Writes no table a confirmed selection reads. Proved by test, not asserted. |

It ends in a verification block that fails the migration outright on any of:
fewer or more than 44 vegetable pictures; fewer or more than 26 fruit pictures;
any picture on a generic placeholder; any picture pointing outside this step's
own folder; any picture attached to more than one provision.

### 5.1 Nothing else changed

The full provision table, the pools, the scales and the conversions were dumped
before the migration and again after the entire test suite had run. Every
non-`image_ref` field is byte-identical:

| Snapshot | Result |
|---|---|
| `rik.provisions` (19 columns: code, name, brand, pack size, pack unit, unit, ratio, pool, issue period, display order, diet, loose, selectable, limits, active, effective dates) | **identical** |
| `rik.entitlement_pools` | **identical** |
| `rik.pool_scales` | **identical** |
| `rik.pool_conversions` | **identical** |

| Structure | Before | After |
|---|---|---|
| Tables | 56 | **56** |
| Views | 5 | **5** |
| Roles | 6 | **6** |
| Permissions | 20 | **20** |
| Entitlement pools | 18 | **18** |
| Pool scales | 50 | **50** |
| Conversions | 7 | **7** |
| Provisions | 189 | **189** |
| Provisions with a picture | 0 | **70** |

The schema contract guard verified 56 tables / 5 views at application boot on
every one of the 22 API test suites.

---

## 6. API and UI verification

### 6.1 Customer

The customer entitlement API carries `imageRef` through for both available and
unavailable provisions, and was checked over real HTTP: `VEG_TOMATO_RED` comes
back as `/catalogue/rik/fresh/42_tomato-red.png`. Every non-null `imageRef` in
the response matches the expected path shape, and none contains a provision id.

The customer screens show, in this order:

> **[ picture ] · Provision name · Brand (if recorded) · Pack size and unit (if recorded)**

on the category screen, the checkout review and the "not available to you this
period" list.

Still absent, and tested for: no provision id, no pool id, no provision code, no
consumption ratio, no "SKU", "pool" or other internal term. A front-end test
scans the whole rendered page for internal identifiers and fails if any appear.

### 6.2 Admin

Unchanged and working. `GET /admin/rik/config/provisions` returns
`imageRef: "/catalogue/rik/fresh/11_cabbage.png"` for Cabbage, and
`PATCH /admin/rik/config/provisions/:id` sets, changes and clears it.

The SKU master screen's create form and inline editor both carry the image
reference field STEP 12A added, and the table marks rows that have no picture.

---

## 7. Fallback verification

The placeholder was already in place from STEP 12A and was **not** removed,
weakened or bypassed. All three cases are covered:

| Case | Behaviour | Where it is proved |
|---|---|---|
| `image_ref` is NULL | Placeholder (a neutral carton outline, labelled "No picture recorded for …") | front-end test, and API test 10 confirming the server sends `null` and never `""` |
| The file is missing or the path is stale | `onError` swaps in the same placeholder; the item is still offered | new front-end test, added in this step |
| An empty string is written | Impossible — the database CHECK from migration 0031 rejects it | API test 10 attempts it and is refused |

The middle case is the one this step made worth testing: before 12B no provision
had a picture, so a *recorded but unloadable* picture could not occur. It can
now, so there is a test that fires an image error and asserts the placeholder
takes over and the provision is still listed.

---

## 8. Tests added

**15 new tests. All pass.**

`apps/api/src/rik/rik-fresh-images.integration.spec.ts` — 14 tests, real
PostgreSQL, real HTTP:

| # | Test |
|---|---|
| 1 | Exactly 44 Fresh Vegetable provisions carry a picture |
| 2 | Exactly 26 Fresh Fruit provisions carry a picture |
| 3 | No picture is attached to the wrong provision — all 70 checked by code, both directions, no duplicates |
| 3b | Every attached picture is a real file on disk, and is a real PNG (magic bytes) |
| 4 | Spring Onion gets the spring onion; the onion pool gets nothing |
| 5 | Brinjal (Purple & Green) is one provision with one picture |
| 6 | Grapes Black S/L and Grapes S/L stay separate, one picture each |
| 7 | Musambi/Sweet Lemon maps correctly and is not confused with Sour Lime |
| 8 | The generic placeholder provisions were given no picture |
| 9 | The customer API returns the correct `imageRef` |
| 10 | An item with no picture is served `null`, so the screen falls back |
| 11 | Changing a picture leaves a confirmed selection exactly as recorded |
| 12 | Attaching and clearing a picture changes no entitlement figure |
| — | The picture is RIK_ADMIN work under the permission that already existed |

`apps/customer-web/src/routes/rik/ration/know-your-ration.test.tsx` — 1 test:
a recorded picture that fails to load falls back to the placeholder, and the
provision is still offered.

Tests 11 and 12 are the substantive ones. Test 11 confirms a selection, changes
the item's picture through the admin API, and re-reads the record: snapshot,
quantity, ratio, pool equivalent and reference number all byte-identical. Test
12 computes the full entitlement, clears a picture, recomputes, restores it and
recomputes again — every scale, eligible-day count, total, consumed figure,
remaining figure, ratio, ceiling and pack size identical each time.

---

## 9. Full verification results

| Gate | Command | Result |
|---|---|---|
| Schema contract | verified at boot, 22× | **56 tables / 5 views** |
| Typecheck | `tsc --noEmit` (api, admin-web, customer-web) | **clean** |
| Lint | `npm run lint` (all workspaces, `--max-warnings=0`) | **clean** |
| Build | `npm run build` (all workspaces) | **success** |
| Tests | `npm run test --workspaces` | **753 passed, 0 failed** |

### 9.1 Exact final totals

| Workspace | Suites / files | Tests | Result |
|---|---|---|---|
| `@esamagri/api` | 22 | **544** | all pass |
| `@esamagri/customer-web` | 6 | **105** | all pass |
| `@esamagri/admin-web` | 8 | **92** | all pass |
| `@esamagri/config` | 2 | **12** | all pass |
| **Total** | **38** | **753** | **753 passed, 0 failed** |

**Tests passing: 753. Tests failing: 0.**
Added by STEP 12B: **+15** (14 API, 1 customer-web). STEP 12A closed at 738.

### 9.2 Confirmations required by Step 9

| | |
|---|---|
| Tables unchanged | ✅ 56 |
| Views unchanged | ✅ 5 |
| Roles unchanged | ✅ 6, no PURCHASING |
| Permissions unchanged | ✅ 20 |
| Entitlement pools unchanged | ✅ 18, byte-identical |
| Pool scales unchanged | ✅ 50, byte-identical |
| Conversions unchanged | ✅ 7, byte-identical |
| Provision count unchanged | ✅ 189 |
| Only intended `image_ref` values changed | ✅ 70 set, all other 19 catalogue columns byte-identical |
| Residual test data | ✅ 0 rows |

---

## 10. Files changed

**Added**

| File | What |
|---|---|
| `database/migrations/0033_rik_fresh_catalogue_images.sql` | 70 `image_ref` assignments + verification block |
| `apps/customer-web/public/catalogue/rik/fresh/*.png` | the 70 verified thumbnails, byte-for-byte |
| `apps/customer-web/public/catalogue/rik/fresh/README.md` | provenance, format, resolution limitation, caching note |
| `apps/api/src/rik/rik-fresh-images.integration.spec.ts` | the 14 integration tests |

**Modified**

| File | What |
|---|---|
| `apps/customer-web/src/routes/rik/ration/know-your-ration.test.tsx` | one test for the broken-image fallback, plus its `fireEvent` import |

**Application source changed: none.** No API file, no customer-app component, no
admin-app component, no configuration file. The only non-test change outside the
migration is the asset folder and its README.

---

## 11. Warnings and things worth knowing

**(a) The pictures are soft, and that is in the source.** The client catalogue
sheet is 1536 × 1024 for all seventy products together, so each product is about
114 × 97 px in the original and is enlarged roughly five times to fill an
800 × 800 canvas. They will not look as crisp as thumbnails photographed at full
size. No sharpening was applied because that would alter the products'
appearance. Replacing them with higher-resolution originals is a drop-in change
— same filenames, same paths, no database or code change — because `image_ref`
points at the path, not at the pixels.

**(b) 17 MB now lives in the repository.** Correct for this architecture, and it
does not reach the PWA precache (see 4.1), but it is worth a conscious decision
before the dry catalogue adds its own set. If the total becomes awkward, the
answer is object storage with `image_ref` holding an absolute URL — which the
column already supports without a schema change.

**(c) The catalogue is not available offline.** Stated in 4.1. Flagged, not
fixed, because fixing it is a caching decision rather than an image-integration
one.

**(d) The admin dashboard shows the image reference as text, not as a preview.**
That is unchanged from STEP 12A and within scope. Worth noting for later: the
admin app is served from its own origin, so a root-relative `/catalogue/...`
path would not resolve there. If an image preview is ever added to the admin
screens, the images need a shared origin — or the column needs absolute URLs.
Nothing is broken today; this is a note for whoever adds that preview.

**(e) The generic placeholders now look conspicuous — and this is the open
decision from STEP 12A, unchanged.** `VEG_FRESH` ("Fresh Vegetables") and
`FRUIT_FRESH` ("Fresh Fruits") sit beside 44 and 26 pictured varieties and show
the empty-frame placeholder, because they are not varieties and none of the
seventy pictures depicts them. Giving them a picture would mean picking one
variety's photograph to stand for "vegetables in general", which is exactly the
kind of invention the brief rules out.

This makes the STEP 12A recommendation more visible rather than changing it:
retire `VEG_FRESH` and `FRUIT_FRESH` so the named varieties are the only
vegetable and fruit choices, and keep `FRUIT_DRY`, which is a real provision.
If you agree, no code or SQL is needed — RIK Admin → RIK Configuration → SKU
master → filter to the pool → **Retire** on each row. It is effective-dated and
reversible, and it leaves every confirmed selection exactly as recorded.

---

## STOP

**STEP 12B is complete and stops here**, as instructed.

Dry-category image integration has **not** been started. No entitlement logic was
changed. No catalogue structure was modified. Awaiting your approval.
