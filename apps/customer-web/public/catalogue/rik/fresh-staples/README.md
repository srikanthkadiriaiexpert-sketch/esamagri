# RIK fresh staple thumbnails

Seven product thumbnails for the RIK Fresh **staple allowances** — Milk, Eggs,
Onion, Potato and the three Meat items. They are the counterpart to the
seventy variety thumbnails in `../fresh/`, and they are kept apart from them
deliberately: see "Why a separate folder" below.

They are referenced from the database, not from code: each row in
`rik.provisions` carries the path to its own picture in `image_ref`, and the
customer screen renders whatever that column says. Nothing in the application
derives a filename from a provision name.

## What is here

| File | Provision `code` | Provision name | Pool |
| --- | --- | --- | --- |
| `milk__fresh-500ml-coupon.png` | `MILK_FRESH` | Fresh Milk | `MILK` |
| `eggs__table.png` | `EGGS_TABLE` | Eggs | `EGGS` |
| `onion__fresh.png` | `ONION_FRESH` | Onion | `ONION_GARLIC` |
| `potato__fresh.png` | `POTATO_FRESH` | Potato | `POTATO` |
| `meat__chicken-fowl.png` | `MEAT_CHICKEN` | Chicken / Fowl | `MEAT` |
| `meat__fish.png` | `MEAT_FISH` | Fish | `MEAT` |
| `meat__mutton.png` | `MEAT_MUTTON` | **Meat** | `MEAT` |

Two notes on that table, both recorded rather than silently tidied:

* **`MEAT_MUTTON` is displayed as "Meat", not "Mutton".** The picture is of
  mutton, which is what the client supplied for that provision. The mapping
  was confirmed before it was applied; the provision name was deliberately
  **not** changed, because renaming a provision is a business decision and not
  part of an image integration.
* The milk picture shows a milk bottle **and** a physical RIK 500 ml coupon
  together. That is the client's intended subject for this provision, not two
  products in one frame, and it is why the file is not split further. The
  coupon denomination itself is a separate, not-yet-implemented change; this
  picture does not depend on it and does not implement it.

## Where they came from

Every file was extracted from a single client-supplied seven-product sheet
(1536 × 1024, SHA-256 `47d4d226fc46d870…`), which is the only visual source.
No image was generated, redrawn, enhanced, sharpened, recoloured, composited
or replaced, and none came from the internet.

Processing, in full — three steps and nothing else:

1. **Crop to one tile's photograph.** The sheet lays out four tiles above
   three, each with a green caption bar beneath the picture. Gutters and bars
   were located by measuring the image, not by eye: near-white column runs at
   x = 0–9, 378–390, 762–774, 1145–1156, 1527–1535; caption bars at
   y = 415–486 (upper row) and y = 894–969 (lower row). **No caption text is
   inside any crop.**
2. **Centre-square.** The shorter side of each tile, centred.
3. **Resize to 800 × 800** with a Lanczos filter, aspect preserved.

The exact boxes used, in source coordinates:

| File | Tile photo | Centre-square box (L, T, R, B) | Square |
| --- | --- | --- | --- |
| `milk__fresh-500ml-coupon.png` | 368 × 406 | (10, 28, 378, 396) | 368 |
| `eggs__table.png` | 371 × 406 | (391, 26, 762, 397) | 371 |
| `onion__fresh.png` | 370 × 406 | (775, 27, 1145, 397) | 370 |
| `potato__fresh.png` | 370 × 406 | (1157, 27, 1527, 397) | 370 |
| `meat__chicken-fowl.png` | 497 × 392 | (62, 502, 454, 894) | 392 |
| `meat__fish.png` | 489 × 392 | (572, 502, 964, 894) | 392 |
| `meat__mutton.png` | 498 × 392 | (1082, 502, 1474, 894) | 392 |

All seven were checked before being brought into the repository: correct
product-to-filename mapping, no caption text, no borders, no neighbouring
product, nothing cut off, no duplicates. The milk crop was checked
specifically for the coupon, which sits low and right in its tile and is the
one element a careless centre-crop would have clipped.

They are used here as produced and must not be re-cropped, renamed,
re-exported or "improved" in place. If a picture needs to change, replace the
file and say so here.

## Format

800 × 800, RGB PNG — the same format as `../fresh/`.

Unlike those, these are **photographs with their own backgrounds** (marble,
wooden boards, cloth), not products isolated on white. Cutting them out would
mean altering the client's artwork, so it was not done. The two styles rarely
meet on screen: these seven sit in the Milk, Eggs, Onion, Potato and Meat
categories, the seventy in Vegetables and Fruits.

### On resolution

These are **sharper than the rest of the catalogue**, for once. The
vegetable/fruit sheet holds seventy products in 1536 × 1024, so each is around
114 × 97 px and is enlarged roughly five to seven times to fill 800 × 800.
This sheet holds seven, so each is 368–498 px and is enlarged only about
2.0–2.2 times.

### On file size

About 650 KiB each (4.5 MB for seven), against a mean of 244 KiB in
`../fresh/` and 350 KiB in `../dry/`. Photographs compress worse than products
on flat white; the size is in the subject, not in the encoding. A JPEG or WebP
variant would be smaller, and was deliberately not taken: one format across
the whole catalogue is worth more than a few hundred kilobytes that are only
ever fetched on demand.

## Why a separate folder

`../fresh/` is documented as seventy files from one client sheet, QC-verified
and used byte-for-byte. These seven come from a different sheet and had a
different treatment. Numbering them 71–77 in that folder would have quietly
undermined that provenance statement, and it would have meant rewriting the
seventy-row expectation table in
`apps/api/src/rik/rik-fresh-images.integration.spec.ts`, whose assertions are
scoped to the `/catalogue/rik/fresh/` prefix.

## Caching

Like the other catalogue folders, these files are **not** in the service
worker's precache — the precache is the app shell only. They are served as
ordinary static assets, on demand, and are not available offline.

Note for anyone refreshing the demo: adding files under `public/` does **not**
by itself trigger a rebuild in `demo-start.cjs`, whose checks are "no build
yet", "`.env` is newer than the build" and "the bundle does not carry
`VITE_API_BASE_URL`". A demo build has to be refreshed deliberately or these
pictures will be present in the source tree and missing from the running demo.

---

## Addendum, 22 October 2026 — four pictures that are NOT yet referenced

Four further files were added here from a second client-supplied sheet
(1536 × 1024, SHA-256 `ed86485a970e4e89…`), a 2 × 2 layout of four products
isolated on plain white, with no captions:

| File | Intended provision `code` | Provision name | Pool |
| --- | --- | --- | --- |
| `milk__td-milkmaid.png` | `MILK_TD` | Milk TD / Milkmaid | `MILK` |
| `fruits__dry.png` | `FRUIT_DRY` | Dry Fruits | `FRUITS` |
| `garlic__fresh.png` | `GARLIC_FRESH` | Garlic (Fresh) | `ONION_GARLIC` |
| `potato__alt-vegetables.png` | `POTATO_ALT_VEGETABLES` | Fresh Vegetables (in lieu of potato) | `POTATO` |

**THEY ARE NOT WIRED UP, AND THAT IS DELIBERATE.** All four provisions still
have `image_ref IS NULL`, so none of these files is served to anyone. Setting
those four columns is a database change, and four separate guards currently
assert that these provisions have no picture:

* `0033_rik_fresh_catalogue_images.sql` raises if `VEG_FRESH`, `FRUIT_FRESH`
  or **`FRUIT_DRY`** has a picture — they are named there as generic
  placeholders;
* `0052_rik_fresh_staple_images.sql` raises unless **`MILK_TD`** has
  `image_ref IS NULL`;
* `0053_rik_fresh_milk_coupon.sql` asserts the same for `MILK_TD` again;
* `rik-fresh-staple-images.integration.spec.ts` TEST 8 expects exactly **180**
  pictures across the whole catalogue (70 fresh + 103 dry + 7 staples), and
  TEST 9 checks that the provisions beside these pictures "did NOT quietly get
  one".

`0040` and `0041` additionally record, in writing, that `GARLIC_FRESH` and
`POTATO_ALT_VEGETABLES` "keep exactly the picture state they already have
(both have none)".

So attaching these four is a business decision with a migration behind it, not
an image task. Until that decision is taken and those guards are amended by
whoever owns them, these files sit here unused and the four provisions keep
showing the neutral placeholder. Nothing references them; deleting them would
change no behaviour.

### Processing

Four steps, and nothing else — no generation, redraw, enhancement, recolour or
replacement:

1. **Segment.** The four products are closer together than a 2 × 2 split
   allows: every one of them crosses a midline, so a quadrant cut would have
   clipped all four. Connected-component labelling on the off-white mask found
   exactly four blobs, which are the four products.
2. **Lift onto white.** Only the pixels belonging to that one component are
   copied onto a white canvas, so a neighbouring product can never appear in a
   crop however much padding is added.
3. **Square with balanced padding** — 7 % a side, product centred, aspect
   preserved, nothing scaled non-uniformly.
4. **Resize to 800 × 800** with a Lanczos filter.

Source boxes used, in source coordinates:

| File | Source bbox (L, T, R, B) | Product | Square before resize |
| --- | --- | --- | --- |
| `milk__td-milkmaid.png` | (147, 28, 546, 501) | 399 × 473 | 550 |
| `fruits__dry.png` | (698, 42, 1465, 461) | 767 × 419 | 892 |
| `garlic__fresh.png` | (53, 507, 630, 958) | 577 × 451 | 671 |
| `potato__alt-vegetables.png` | (668, 476, 1496, 944) | 828 × 468 | 963 |

All four were checked after export: 800 × 800 RGB PNG, every frame edge pure
white, no caption text, no border, no neighbouring product, and a clear margin
on all four sides so nothing is cut off.

Unlike the seven above, these four are **products isolated on white**, matching
`../fresh/` rather than this folder's photographs. They are kept here anyway
because they belong to the staple allowances (Milk, Fruits, Onion / Garlic,
Potato), not to the seventy-item vegetable and fruit sheet, and adding them to
`../fresh/` would have undermined that folder's "seventy files, one sheet"
provenance statement.
