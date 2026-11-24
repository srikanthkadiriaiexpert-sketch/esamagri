# RIK category cover pictures

Eighteen covers, one for every entitlement pool in the RIK catalogue.

A **category** picture is the cover of a whole allowance — Milk, Cereals,
Dal — and belongs to `rik.entitlement_pools.image_ref`. A **provision**
picture is the item an officer actually takes and belongs to
`rik.provisions.image_ref` (see `../fresh/README.md` and `../dry/README.md`).
They are different columns on different tables and neither substitutes for the
other. Nothing in the application derives a filename from a category name, so
renaming a category cannot silently break its cover.

## The eighteen

| Pool code | Category | File |
|---|---|---|
| MILK | Milk | `milk.png` |
| MEAT | Meat | `meat.png` |
| EGGS | Eggs | `eggs.png` |
| VEGETABLES | Fresh Vegetables | `vegetables.png` |
| FRUITS | Fresh Fruits | `fruits.png` |
| ONION_GARLIC | Onion / Garlic | `onion.png` |
| POTATO | Potato | `potato.png` |
| CEREALS | Cereals | `cereals.png` |
| DAL | Dal | `dal.png` |
| DALIYA | Daliya | `daliya.png` |
| HYDROGENATED_OIL | Hydrogenated Oil | `hydrogenated-oil.png` |
| SUGAR_JAGGERY | Sugar / Jaggery | `sugar-jaggery.png` |
| SALT | Salt | `salt.png` |
| TEA_COFFEE | Tea / Coffee | `tea-coffee.png` |
| BUTTER_GHEE | Butter / Ghee | `butter-ghee.png` |
| CHEESE_NUTRAMUL | Cheese / Nutramul | `cheese-nutramul.png` |
| CONDIMENTS | Condiments | `condiments.png` |
| GARAM_MASALA_WHOLE | Garam Masala (Whole) | `garam-masala-whole.png` |

The database is the mapping, not this table: each path above is written to its
pool by a migration (0035–0042), and the integration suite restates the whole
set so that a cover cannot be added, moved or dropped without being declared.

## Where they came from

**The first four** — Milk, Meat, Eggs and Fresh Vegetables — were extracted
from client-supplied catalogue sheets in STEPS 14B to 14E and are used
byte-for-byte as verified then. They are untouched by the later work.

**The other fourteen** were supplied directly by the client on 9 October 2026,
one image per category, replacing the artwork that was lost with the container
and recorded as an open restoration item at the recovery gate. Nothing was
generated, redrawn, enhanced, recoloured or replaced, and none came from the
internet.

Twelve of the fourteen arrived as 1536 × 1024 landscape. Each was **padded**
to a square on its own background colour — sampled from its own corners,
(254, 254, 254) in every case — and then resized once with a Lanczos filter to
the 800 × 800 the other covers use. **Padded, never cropped:** the card renders
with `object-cover`, so a centre crop of, say, the masala sheet would have cut
the outer packets out of the picture entirely. The remaining two arrived
square at 1254 × 1254 and were resized only. No other change was made to any
of them.

## Format

800 × 800, RGB PNG, white background, aspect ratio preserved. The customer
screen renders them at 56 × 56 with `object-cover`, and falls back to its
neutral placeholder if the file is missing or fails to load.

## Two images were supplied and are deliberately unused

The client also supplied a milk bottle and a meat/fish/chicken composite.
Milk and Meat already carry client artwork integrated and verified in STEPS
14B and 14C, and replacing a verified asset was not part of this task — so
both new images were left out rather than overwriting work that is approved
and closed. They remain available if the facility would prefer them.
