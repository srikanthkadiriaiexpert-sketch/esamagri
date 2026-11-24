# PIF category thumbnails

Eight photographs for the PIF shop's category cards, taken from a single
client-supplied sheet. They are referenced from the database — each row in
`pif.categories` carries the path in `image_ref` — and nothing in the
application derives a filename from a category name.

Kept deliberately apart from `../../rik/` (a different module, a different
schema) and from `apps/api/var/pif-media/` (the admin upload store, whose
files live on the API's disk and travel in no bundle).

## Source and provenance

| | |
| --- | --- |
| Source | One client-supplied 30-tile category sheet |
| Dimensions | 1536 × 1024, RGB PNG |
| SHA-256 | `0e49505603db9f67…` |
| Layout | 6 columns × 5 rows; each tile a photograph above a caption |

The sheet itself was **never modified**. It is not stored in the repository;
these eight files are what was taken from it.

## Processing — three steps, and nothing else

1. **Crop to one tile's photograph.** Card columns sit at x 34–265, 279–514,
   528–760, 774–1010, 1023–1260, 1274–1502. Within a card, the photograph is
   the *first* contiguous band of ink; the caption is a separate, much shorter
   band below it, so **no caption can be inside a crop**. This matters for
   *Snacks, Biscuits & Chocolates*, whose caption wraps to two lines and whose
   photograph therefore ends higher than its neighbours'.
2. **Centre-square** on the shorter side.
3. **Resize to 256 × 256** with a Lanczos filter, aspect preserved.

No sharpening, recolouring, retouching, compositing or background
replacement. Every crop was inspected: no caption text, no neighbouring tile,
no white band, nothing cut off.

### Exact boxes used, in source coordinates

| File | Tile | Photo band | Square | Box (L, T, R, B) |
| --- | --- | --- | --- | --- |
| `dairy-milk-eggs.png` | Dairy, Milk & Eggs | y 16–157 | 142 | (821, 16, 963, 158) |
| `atta-rice-grains.png` | Atta, Rice & Grains | y 16–156 | 141 | (1318, 16, 1459, 157) |
| `dals-pulses-beans.png` | Dals, Pulses & Beans | y 219–352 | 134 | (83, 219, 217, 353) |
| `oils-ghee.png` | Oils & Ghee | y 216–347 | 132 | (331, 216, 463, 348) |
| `salt-sugar-sweeteners.png` | Salt, Sugar & Sweeteners | y 218–346 | 129 | (828, 218, 957, 347) |
| `snacks-biscuits-chocolates.png` | Snacks, Biscuits & Chocolates | y 218–341 | 124 | (1080, 218, 1204, 342) |
| `tea-coffee.png` | Tea & Coffee | y 421–546 | 126 | (581, 421, 707, 547) |
| `detergents-dishwashing.png` | Detergents & Dishwashing | y 608–735 | 128 | (828, 608, 956, 736) |

## Format — and why 256, not 800

**256 × 256, RGB PNG.** The RIK sets are 800 × 800; this one is deliberately
not.

Thirty products share one 1536 × 1024 sheet, so each tile's photograph is only
about 130 px square. Enlarging that to 800 would be a six-fold blow-up and
would look soft. The category card renders the picture in a **48 × 48** circle
(`CategoryCard`), so 256 is still more than five times the displayed size on a
1× screen and nearly three times on a 2× screen — clean, and a fifth of the
bytes.

## Which category gets which picture

Fourteen categories, eight pictures. **Some categories share, by design.**

| Category | File | |
| --- | --- | --- |
| Pulses | `dals-pulses-beans.png` | |
| Dals | `dals-pulses-beans.png` | **shared** with its parent, Pulses |
| Staples | `atta-rice-grains.png` | |
| Rice | `atta-rice-grains.png` | **shared** with its parent, Staples |
| Atta & Flours | `atta-rice-grains.png` | **shared** with its parent, Staples |
| Grains | `atta-rice-grains.png` | **shared**; no products, so not shown to customers |
| Sugar & Salt | `salt-sugar-sweeteners.png` | |
| Oils & Ghee | `oils-ghee.png` | |
| Cooking Oil | `oils-ghee.png` | **shared**; no products, so not shown to customers |
| Dairy | `dairy-milk-eggs.png` | |
| Milk & Curd | `dairy-milk-eggs.png` | **shared** with its parent, Dairy |
| Snacks & Biscuits | `snacks-biscuits-chocolates.png` | |
| Beverages | `tea-coffee.png` | holds Bru coffee and Tata tea — *Drinks & Juices* would be wrong |
| Household | `detergents-dishwashing.png` | **inexact** — see below |

### Why the sharing exists

The client's sheet is built on a **thirty-category retail taxonomy**; this
catalogue has **fourteen categories in two levels**, and the two do not line
up. There is no rice-only, flour-only or curd-only tile on the sheet. Rather
than invent one or leave a placeholder, a child shares its parent's
photograph.

This is **not** the "one picture, one row" rule the RIK image migrations
assert. Migration 0054 asserts the exact sharing above instead, so an
*accidental* duplicate still fails while the documented ones pass. Four of the
twelve customer-visible categories have a picture of their own.

### Household is the inexact one

It holds *Lifebuoy Bathing Soap 100 g* and *Surf Detergent Powder 1 kg* — one
toiletry and one detergent. No single tile on the sheet depicts both.
*Detergents & Dishwashing* is the closest available and is used as the demo's
representation; it does **not** depict the whole category.

## Licensing — read before any deployment beyond the demo

Several of these photographs show **third-party packaging and trade dress**:

* `snacks-biscuits-chocolates.png` — Lay's, Kurkure, Oreo, Sunfeast
* `tea-coffee.png` — Tata Tea, Nescafé
* `detergents-dishwashing.png` — Surf Excel and detergent look-alikes

The other five (`dals-pulses-beans`, `atta-rice-grains`,
`salt-sugar-sweeteners`, `oils-ghee`, `dairy-milk-eggs`) are generic produce
and carry no such issue.

**No licence for any of this packaging has been verified, and none is
claimed.** `database/demo/demo-catalogue.sql` records the project's own
position: *"Shipping stock photography of groceries we do not own would be
someone else's copyright sitting in a government deployment."* These files are
integrated for the demonstration at the client's explicit instruction.
**Production or government deployment requires the client's approval or
appropriately licensed replacement artwork.**

Replacing them is a drop-in change — same filenames, same paths, no migration
and no code change — because `image_ref` points at a path rather than at
pixels.

## Serving and caching

`imageUrl()` in `apps/api/src/pif/pif.controller.ts` passes through any
`image_ref` that does not begin with `pif/`, so these paths are served
directly by the customer app as static assets. That is also why they reach the
Windows demo: static assets are copied into the build and carried in the
bundle, whereas files uploaded to `PIF_MEDIA_ROOT` live only on the API's disk.

Like the other catalogue folders, these files are **not** in the service
worker's precache and are fetched on demand.

Adding files under `public/` does **not** by itself trigger a rebuild in
`demo-start.cjs` — a demo build has to be refreshed deliberately, or the
pictures will be in the source tree and missing from the running demo.
