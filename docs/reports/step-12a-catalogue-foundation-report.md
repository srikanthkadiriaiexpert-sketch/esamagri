# STEP 12A — RIK CATALOGUE FOUNDATION

**e Samagri · Base Victualling Yard, Visakhapatnam**
**Module:** RIK (Ration in Kind)
**Status:** complete, awaiting approval
**Date:** 23 September 2026

---

## 1. What was asked for, and what was built

The catalogue the RIK module had until now was a list of provision rows whose
*names* were doing three jobs at once. "Amul Paneer 200g" was a brand, an item
and a pack size written as one string, which meant the same item stocked from a
second dairy had to become a second, differently-named row that read like a
duplicate; it meant a pack size could only be changed by editing a name; and it
meant a picture had nowhere to live at all.

STEP 12A separates those three jobs into three fields, loads the seventy named
fresh varieties the facility supplied, and puts all of it under the RIK Admin
dashboard. It is a change to **data and to how data is described**. It is not a
change to what anybody is entitled to, and the larger part of the work — and of
the testing — went into making that second sentence demonstrable rather than
merely asserted.

Nothing in the entitlement engine was modified. Not one line.

---

## 2. Entitlement separation — the four fresh pools are untouched

The four pools named in the kickoff already existed with exactly the scales
given, and they were verified rather than rewritten:

| Pool | Daily scale | Status |
|---|---|---|
| FRESH VEGETABLES | 170 g/day | unchanged |
| FRESH ONION | 60 g/day | unchanged |
| FRESH POTATO | 110 g/day | unchanged |
| FRESH FRUITS | 230 g/day | unchanged |

Onion and potato remain **separate allowances with pools of their own**. No
onion or potato provision was moved into the general vegetable pool, and no
conversion between them was added. A catalogue variety *belongs to* a pool; it
never creates one. This is asserted in SCENARIOS 5, 6, 7 and 8, which read the
live scales and pool identities rather than trusting a fixture.

One point worth recording plainly: **Spring Onion** is one of the forty-four
varieties the facility listed under Fresh Vegetables, and it stays there. It is
a green vegetable, not the bulb the 60 g onion scale is for. The test that
looks for onion and potato strays checks against the onion and potato
*provisions* by name rather than against the word "onion" appearing anywhere,
so Spring Onion passes deliberately and visibly, not by accident.

---

## 3. The 44 Fresh Vegetable varieties

All forty-four names supplied by the facility were loaded into the existing
VEGETABLES pool, under codes derived by one mechanical rule (uppercase, non-
alphanumerics to underscore, `VEG_` prefix) so no name was re-spelled by hand.

- Names were **not renamed**, normalised, corrected or Anglicised.
- **No vegetable was added** from general knowledge. The loader was generated
  from the supplied list and the count is machine-checked, so a forty-fifth
  would have failed the migration as loudly as a forty-third.
- **No variety was inferred** where the list seemed incomplete.

Each is `unit = g`, `consumption_ratio = 1.000000`, `issue_period = FRESH`,
customer-selectable, effective from 1 January 2026, with pack size, pack unit,
brand and image all null — because the facility supplied none and nothing was
invented to fill them.

SCENARIOS 1 and 3 count them and check every one of those properties.

---

## 4. The 26 Fresh Fruit varieties

Loaded on exactly the same terms into the existing FRUITS pool under a `FRUIT_`
prefix: twenty-six names, unchanged, nothing added, nothing inferred, all
fresh, all one-for-one, all unbranded and unpictured. SCENARIOS 2 and 3.

The client's terminology was kept as given. Identifiers are derived from the
names mechanically; the names themselves are untouched.

---

## 5. Brand is now a field, not part of a name

`rik.provisions.brand` was added (nullable text, non-blank). Brands were then
lifted out of eighteen names where the leading token is unmistakably a company:

| Brand | Items |
|---|---|
| Amul | Butter, Ghee, Atta, Paneer |
| Everest | Chilly Powder |
| Fortune | Besan |
| Tata | ten pulses, plus Muesli |
| Wagh Bakri | Elaichi Tea |

`Amul Paneer 200g` is now **Provision = Paneer, Brand = Amul, Pack size = 200
g** — three columns, exactly as the kickoff required.

**Brands were deliberately NOT extracted** where the leading word is not a
maker: Boost, Horlicks, Bournvita and Amulpro, where the name *is* the product
name; Columbian Coffee, where the leading word is an origin; and Chahat Society
Tea, where the reading is ambiguous. Guessing at these would have been worse
than leaving them, and they can be corrected from the dashboard in seconds now
that the field exists.

No provision was duplicated because a brand changed. Two brands of one item are
**two rows sharing a name and differing by brand**, each with its own id, pack
size and availability, and each individually identifiable — proved in SCENARIO
15, which creates a second paneer and checks that the screen shows one name,
two brands and two distinct rows.

SCENARIO 9 asserts that **no provision name anywhere still contains the brand
recorded beside it**, and migration 0032 now fails outright if one does.

---

## 6. Pack size is catalogue data, not entitlement

Pack sizes were already stored in `rik.provisions.pack_size`. What STEP 12A did
was stop the figure being said twice: fifty-four names ended with their own
pack size ("Oats 600g", "Mustard Oil 1kg") and those suffixes were stripped,
leaving the figure in the column the engine and the screens already read.

The three the kickoff named are intact and editable, read from the row rather
than from code:

| Item | Pack size |
|---|---|
| Maggi | 280 g |
| Hakka Noodles | 1 kg (1000 g) |
| All Purpose Flour / Maida | 500 g |

**No pack size is hard-coded anywhere in the application.** SCENARIO 11 reads
all three from the database and additionally checks that the names no longer
contain a digit.

A visible benefit of the strip: `Mustard Oil 1kg` and `Mustard Oil 500g` are now
**one provision name with two pack sizes** rather than two items that looked
unrelated. The same is true of Sunflower Refined Oil.

**No cereal entitlement ratio was changed.** Pack size and entitlement remain
independent — a 500 g pack against a 600 g allowance is normal, and both the
pack-sizes screen and the customer screen say so in those words.

---

## 7. Units

`rik.provisions.pack_unit` was added, constrained by the database to exactly the
eight units the kickoff lists: **g, kg, ml, litre, piece, packet, tin, box**.

This is a **separate field from `unit`**, and the distinction is the single most
important design decision in this step:

- `unit` is the **entitlement unit** — the unit `consumption_ratio` is applied
  in. The engine's CHECK constrains it to `g`, `ml`, `piece`, because those are
  the only things the calculation can be performed in. It was **not altered**;
  widening it would have changed arithmetic, which §13 forbids.
- `pack_unit` is **presentation only** — the noun for the container. Nothing in
  the engine, the eligibility service or the selection logic reads it.

**No unit was invented for any SKU.** Exactly one row carries a pack unit today:
Amul Ghee, recorded as a `tin`, because "tin" was the only container noun any
existing name actually carried. Every other row has `pack_unit = NULL` and shows
its entitlement unit, because the facility's data does not say otherwise.

SCENARIO 12 asserts the allowed set and proves the database itself rejects a
ninth value.

---

## 8. Images

`rik.provisions.image_ref` was added (nullable text, non-blank) — the storage
reference the kickoff asked to have in place now.

- **No image was invented.**
- **No image was taken from the internet.**
- All 189 provisions currently have `image_ref = NULL`, which is the honest
  state.

The customer screen renders a neutral placeholder — an outline of a carton,
depicting nothing in particular — whenever no picture is recorded, and also
whenever a recorded picture fails to load. It never substitutes a lookalike.
SCENARIO 13 proves a blank string cannot be stored in place of a picture; the
front-end tests cover both the placeholder and a recorded image.

---

## 9. Admin catalogue management — no SQL required

Both existing RIK Admin screens were extended. Nothing new was bolted on:

**SKU master (screen 4 of 7)** — now has a Brand column, shows "Unbranded"
where there is none, marks rows with no picture, and its create form and inline
editor both take **brand, pack unit and image reference** alongside the fields
they already had. The Name field's hint reads: *"The item itself. Keep the
brand and the pack size out of it."*

**Pack sizes and limits (screen 5 of 7)** — now has a Pack unit column and a
pack-unit selector in the row editor, beside the pack size it already managed.

Availability was already manageable from these screens (retire/restore, and the
customer-selectable flag) and was not touched.

A RIK Admin can therefore **create a provision, set or change its brand, its
pack size, its pack unit, its picture and its availability entirely from the
dashboard.** SCENARIOS 14, 15, 16 and 17 do exactly that over HTTP, and two
front-end tests do it through the rendered screen.

---

## 10. Security — existing RBAC, smallest possible change

**No permission was added. No role was added. No role was weakened.**

Catalogue writes go through the routes that already existed
(`POST/PATCH /admin/rik/config/provisions`) under the permission that already
governed them: **`rik.product.manage`**, which is RIK_ADMIN-exclusive. The new
fields are additional columns on an existing write, so no new authorisation
surface was created and therefore no additive permission change was necessary.

- Roles: still **6**. PURCHASING was **not** created.
- Permissions: still **20**.
- Every non-RIK_ADMIN staff role is refused a catalogue write with 403;
  anonymous is 401.

SCENARIO 18 asserts all of the above against the live seed.

---

## 11. Confirmed selections are unaffected

A confirmed RIK selection records what was chosen in its own immutable
`rule_snapshot`, and its line items carry their own quantity, ratio and pool
equivalent. Renaming an item, rebranding it, repacking it or giving it a
picture afterwards therefore cannot reach it, and database triggers refuse the
edit even if something tried.

SCENARIO 20 confirms a selection, then re-describes the item every way STEP 12A
allows — new name, new brand, new pack unit, new picture, new pack size — and
re-reads the record: snapshot, quantity, ratio and pool equivalent are
byte-identical, and the snapshot still reads "Amul" and "200.0000" whatever the
catalogue says today. The same test re-runs the entitlement calculation before
and after and finds every figure unchanged.

---

## 12. Customer display

A catalogue item now introduces itself with four things, in this order:

> **[ picture ] · Provision name · Brand · Pack size and unit**

on both the category screen and the checkout review, and on the "not available
to you this period" list.

What is deliberately **absent** is as much the point:

- no provision id, no pool id, no provision code;
- no "SKU", "consumption ratio", "pool", "entitlement pool" or any other
  internal term;
- no picture where none was recorded — a placeholder instead.

The brand is rendered from its own field as a line of its own, never folded
back into the name. The pack reads as the measure plus the container where
there is one ("200 g packet", "500 g tin") and as the measure alone otherwise.
A front-end test scans the entire rendered page for internal identifiers and
fails if any appear.

---

## 13. The entitlement engine was not modified

To state it exactly:

| | |
|---|---|
| Daily scales | untouched |
| Entitlement calculations | untouched |
| Conversion ratios | untouched |
| Dietary rules | untouched |
| Eligibility logic | untouched |
| Shared-pool mathematics | untouched |
| Historical calculation | untouched |
| Confirmation logic | untouched |

The three new fields travel from the repository through the service view to the
controller presenter as **presentation data only**. No branch of any
calculation reads `brand`, `image_ref` or `pack_unit`; the code carries a
comment saying so at each point they pass through.

The frontend continues to calculate nothing. Every entitlement figure on every
screen is the server's.

---

## 14. Schema work

Two migrations, both additive, both idempotent.

**`0031_rik_catalogue_fields.sql`** — adds `brand`, `image_ref` and `pack_unit`
to `rik.provisions`, each with a non-blank CHECK, `pack_unit` additionally
constrained to the eight allowed units; plus an index on `brand` and one on
`(pool_id, name)` for the brand-grouped listing.

**No new table was created**, and this was a deliberate decision worth
recording. `rik.provisions` already *is* the individually-selectable variant —
it has its own ratio, pack size, unit, limits, issue period and flags — and
everything else in the system addresses a provision by id:
`rik.entitlement_selection_items.provision_id`, the rule snapshot, and the whole
STEP 11B engine. A separate `provision_variants` table would have meant
rewriting the engine, which §13 forbids. So the kickoff's
`Paneer → {Amul 200 g, Brand X 200 g, Brand Y 500 g}` tree is stored as rows
sharing `(pool_id, name)` and differing by brand and pack — a **presentation**
grouping, not a storage level.

**`0032_rik_catalogue_load.sql`** — loads the 44 + 26 varieties, lifts the 18
brands, records the one pack unit, strips the pack sizes out of 54 names, and
ends in a verification block that raises rather than leaving a half-loaded
catalogue.

Schema contract: **56 tables / 5 views, unchanged** — verified at application
boot on every one of the 21 API test suites.

---

## 15. What was loaded, and what was not

**Loaded:** 70 named fresh varieties; 18 brand values; 1 pack unit; 54 name
corrections.

**Not loaded, deliberately:** no prices, no contract rates, no MRP, no supplier
or vendor information, no quantities unrelated to pack size, and nothing from
PIF.

SCENARIO 4 proves this structurally rather than by inspection: STEP 12A added
three columns and no commercial one, so `rik.provisions` has nowhere for a
price, rate, cost, MRP, supplier or vendor to have been put.

Catalogue state after the step:

| Pool | Provisions |
|---|---|
| VEGETABLES | 45 (44 named + 1 pre-existing generic) |
| FRUITS | 28 (26 named + 2 pre-existing generic) |
| ONION_GARLIC | 2 |
| POTATO | 2 |
| **All pools** | **189 provisions · 18 branded · 1 with a pack unit · 0 with an image** |

---

## 16. Search and filter

The existing pool filter on the SKU master was reused as-is. No new search
surface was added, because the kickoff asked for none and the screens already
narrow by pool. Brand is now a sortable, scannable column, which is what makes
two brands of one item legible without any new filtering.

---

## 17. Test scenarios

Twenty numbered scenarios, in
`apps/api/src/rik/rik-catalogue.integration.spec.ts`, run over real HTTP against
real PostgreSQL. **All 20 pass.**

| # | Scenario |
|---|---|
| 1 | The vegetable pool holds exactly 44 named varieties |
| 2 | The fruit pool holds exactly 26 named varieties |
| 3 | Every loaded variety is fresh, in grams, one-for-one, selectable |
| 4 | No variety carries a price, a supplier or a contract rate |
| 5 | The four fresh scales are still 170, 60, 110 and 230 g a day |
| 6 | Onion and potato keep pools of their own, each still stocked |
| 7 | The onion and potato provisions did not leak into the vegetable pool |
| 8 | Loading 70 varieties added no pool and no scale |
| 9 | No provision name still contains the brand recorded beside it |
| 10 | No provision name ends with the pack size recorded beside it |
| 11 | The facility's pack sizes are catalogue data, readable without code |
| 12 | A pack unit is only ever one of the eight the facility uses |
| 13 | An item with no picture has none, rather than a borrowed one |
| 14 | Admin creates an item carrying a brand, a pack unit and a picture |
| 15 | A second brand of one item is a second row, not a renamed duplicate |
| 16 | Admin edits the brand, the pack unit and the picture of an item |
| 17 | An unknown pack unit is refused, and nothing is written |
| 18 | Catalogue work is RIK_ADMIN under the permissions that existed |
| 19 | The change is audited with its new fields, before and after |
| 20 | A rebrand, repack and new picture leave the entitlement and a confirmed record identical |

Four supporting front-end tests were added beside them: two on the admin SKU
master (recording brand/pack unit/image without the brand entering the name;
the brand column telling two rows of one item apart) and two on the customer
category screen (placeholder, name, brand, pack, and no internal identifier
anywhere on the page; a recorded picture when the facility has one).

---

## 18. Full verification — exact final totals

Every suite, every workspace, run to completion. **No partial run.**

| Workspace | Suites / files | Tests | Result |
|---|---|---|---|
| `@esamagri/api` | 21 | **530** | all pass |
| `@esamagri/customer-web` | 6 | **104** | all pass |
| `@esamagri/admin-web` | 8 | **92** | all pass |
| `@esamagri/config` | 2 | **12** | all pass |
| **Total** | **37** | **738** | **738 passed, 0 failed** |

Added by STEP 12A: **+24** (20 API scenarios, 2 admin-web, 2 customer-web).
Measured pre-12A baseline: **714** (API 510 + customer 104 + admin 90 +
config 12).

> **A correction to an earlier figure.** The STEP 11E report gave a total of
> 723. Measuring the same four workspaces today with STEP 12A's own tests
> excluded gives **714**. The 723 figure did not correspond to a full run of
> all four workspaces and should be disregarded; the numbers above are
> reproducible with `npm run test --workspaces`.

Other gates:

| Gate | Command | Result |
|---|---|---|
| Typecheck | `tsc --noEmit` (api, admin-web, customer-web) | clean |
| Lint | `npm run lint` (all workspaces, `--max-warnings=0`) | clean |
| Build | `npm run build` (all workspaces) | success |
| Schema contract | verified at boot, 21× | 56 tables / 5 views |
| Residual test data | 6 tables checked for `JEST%` / `Jest%` rows | 0 rows |

---

## 19. Scope discipline — what was NOT built

None of the following was implemented, started, stubbed or scaffolded:

RIK pickup staff workflow · delivery workflow · any PIF functionality ·
payments or pricing · inventory or stock tracking · supplier management ·
purchasing or a PURCHASING role · notifications · cancellation · any new
entitlement rule.

No existing RIK entitlement or checkout logic was rewritten or regressed.

---

## 20. Defects found, decisions taken, and what needs a decision from you

### A defect found and fixed during this step

Migration 0032's name-stripping statement originally used `\b` as a word
boundary. **PostgreSQL's regular expressions are not Perl's: `\b` there is the
backspace character**, not a word boundary (the word-boundary escapes are `\m`,
`\M` and `\y`). The WHERE clause matched fifty-four rows while the replacement
matched none of them, so every name was rewritten to itself and the pack sizes
silently stayed in the names. SCENARIO 10 caught it.

The pattern was corrected, the migration re-run (it is idempotent), and **two
new verification checks were added to the migration itself** so that neither a
name carrying its own pack size nor a name carrying its own brand can ever pass
again. Both now fail the migration outright.

### Decisions taken, and why

1. **Columns, not a variant table** — §14 (smallest additive migration) and §13
   (do not change the engine) together made this the only available choice.
2. **`pack_unit` separate from `unit`** — §7's unit list and the engine's
   calculable units are different sets; keeping them apart satisfies both
   without touching arithmetic.
3. **Brands lifted only where the leading token is unmistakably a company** —
   eighteen rows. Guessing at Boost, Horlicks, Columbian Coffee or Chahat
   Society Tea would have been inventing data.

### One item needing your decision

The pools now contain both the named varieties and the **pre-existing generic
placeholders** they were created with:

| Code | Name | Pool |
|---|---|---|
| `VEG_FRESH` | Fresh Vegetables | VEGETABLES |
| `FRUIT_FRESH` | Fresh Fruits | FRUITS |
| `FRUIT_DRY` | Dry Fruits | FRUITS |

`VEG_FRESH` and `FRUIT_FRESH` now sit alongside the 44 and 26 named varieties
and are selectable, which means an officer can take unspecified "Fresh
Vegetables" and bypass the variety choice entirely.

**These have been left active and untouched**, because retiring them is a
business decision about how the facility wants the counter to work, not a
technical one — and because doing it unilaterally would change what officers
can choose, which is precisely what §11 and §13 rule out.

**Recommendation:** retire `VEG_FRESH` and `FRUIT_FRESH` so the named varieties
are the only vegetable and fruit choices, and keep `FRUIT_DRY`, which is a
genuinely distinct provision rather than a placeholder.

**If you agree, no code or SQL is needed.** RIK Admin → RIK Configuration → SKU
master → filter to the pool → **Retire** on each row. Retirement is effective-
dated and reversible, and it leaves every confirmed selection that already used
them exactly as recorded.

---

## STOP

**STEP 12A is complete and stops here**, as instructed. No work on STEP 12B or
anything beyond has been started. Awaiting your approval.
