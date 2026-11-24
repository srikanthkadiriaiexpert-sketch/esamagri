# Migration 0055 — business identity for PIF catalogues

**Design for approval. Nothing in this document has been executed.**
No SQL was run, no migration file was written, no database was touched.

17 October 2026

---

## 1. What problem this solves

Grocers and Fresh Mart must keep separate catalogues, separate stock and
separate order history, inside the one PIF module. Today nothing in the
database can tell one from the other.

Three candidates were examined and all three rejected:

| Candidate | Why it does not work |
| --- | --- |
| `pif.products.brand` | It is the **manufacturer** — Amul, Tata, Yard Fresh. It is copied onto every order line as sold and has its own blank-cell rule in the importer. Overloading it would corrupt order history and lose the manufacturer. |
| `variant_group` / `variant_label` | Means "same product, different pack" — Sunflower Oil 1 L and 5 L. Wrong meaning. |
| A third category level | `pif.categories` enforces two levels by trigger (`trg_validate_category_parent`). Business → Category → Subcategory is three. Weakening that trigger changes a shared structural rule and is not worth it. |

Nothing existing fits. One new column is the minimum honest change.

## 2. The design

A nullable `business` column on three tables, constrained to two values,
following the project's own existing style (`pack_unit` already uses a CHECK
list rather than an enum type).

```sql
ALTER TABLE pif.categories  ADD COLUMN IF NOT EXISTS business text;
ALTER TABLE pif.products    ADD COLUMN IF NOT EXISTS business text;
ALTER TABLE pif.order_items ADD COLUMN IF NOT EXISTS business text;

ALTER TABLE pif.categories ADD CONSTRAINT pif_categories_business_chk
  CHECK (business IS NULL OR business IN ('grocers','fresh_mart'));
-- the same constraint on pif.products and pif.order_items
```

### Why each table

| Table | Why it needs the column |
| --- | --- |
| `categories` | A category belongs to exactly one catalogue. |
| `products` | `category_id` is **nullable**, so a product cannot reliably inherit its business from a category. Inventory and admin filtering key off the product. |
| `order_items` | It already snapshots `sku`, `product_name`, `brand`, `unit`, `pack_size`, `pack_unit` and the tax rate. Business belongs in that same snapshot, so an order still says which shop it was placed with after a product is moved or retired. |

### Why nullable

Every existing row stays `NULL` and means "from before businesses existed".
Nothing is backfilled by the schema change itself, nothing is rewritten, and
no existing query changes meaning. The two historical order lines are not
touched.

### Inventory, carts and admin

- **Inventory** (`pif.inventory`) keys on `product_id`. A product carries its
  business, so stock cannot cross between catalogues without a product
  moving. **No column is needed on `pif.inventory`.**
- **Carts** are client state (`localStorage`, keyed per module and owner) and
  hold product ids. The business is read from the product. **No schema
  change.**
- **Admin permissions** are unchanged by this migration. Filtering the admin
  product list by business is a query change, not a permission change.

### One guard worth having

A subcategory must not sit under a parent of a different business. Enforced
in the database rather than hoped for in the admin panel:

```sql
-- a BEFORE INSERT OR UPDATE trigger on pif.categories, alongside the
-- existing parent-validation trigger, not replacing it
IF NEW.parent_id IS NOT NULL
   AND (SELECT business FROM pif.categories WHERE id = NEW.parent_id)
       IS DISTINCT FROM NEW.business
THEN RAISE EXCEPTION 'pif.categories: % does not match its parent''s business', NEW.id;
END IF;
```

## 3. Preconditions

1. Migrations 0052, 0053 and 0054 applied. **Verified in `esamagri_demo` on
   17 October**: 190 provisions, 180 RIK pictures, 14 PIF category pictures,
   `whole_units_only` present.
2. A fresh `pg_dump` taken and its size checked.
3. There is **no migration history table** in this project. 0055 must
   therefore assert its own starting state in a `DO $$` verification block,
   as 0054 does, rather than assume an order.

## 4. Data steps, after the schema change

Separate statements, each reversible, in this order:

1. **Insert** 164 category rows — 19 Grocers mains + 135 subs, 2 Fresh Mart
   mains + 8 subs — each with `business` set. Pure `INSERT`; no existing row
   is touched. Slugs come from the generated tree the application already
   navigates.
2. **Assign** the 21 real products: set `business = 'grocers'` and move
   `category_id` to the new subcategory. The mapping is listed in the Phase 1
   assessment and needs your confirmation on two rows — Filter Coffee 200 g
   (Coffee or Instant Coffee) and Mixture Namkeen 200 g (Namkeen or Mixtures).
3. **Retire** the old 14 categories with `active = false`. **Not deleted, not
   renamed, not reparented** — their ids survive, so any reference resolves.
4. **Leave the four Rehearsal rows exactly as they are.** No category change,
   no business, no deletion. They keep their two order-line references and
   stop appearing to shoppers because they carry no business.

Verified before writing this: only `pif.categories.parent_id` and
`pif.products.category_id` reference `pif.categories`. **No order, invoice,
inventory or POS table has a foreign key to categories**, so retiring the old
14 cannot break order history.

## 5. Rollback

| Step | How it is undone |
| --- | --- |
| Columns and constraints | `ALTER TABLE … DROP COLUMN business` on the three tables. Returns the database to exactly its present state. |
| 164 inserted categories | `DELETE FROM pif.categories WHERE business IS NOT NULL` — they are new rows with no dependants at that point. |
| 21 product moves | Reversible only if the prior `category_id` was captured. **The migration must write the old value into a scratch table first**, or the move is one-way. This is the single genuinely irreversible step and the reason it must be a separate statement from the schema change. |
| Retiring the old 14 | `UPDATE … SET active = true`. |

No step deletes a product, an order, an order line or a price.

## 6. RIK protection

This migration touches `pif.*` only. It issues **no** statement against any
`rik.*` table, function, trigger or view, and does not read entitlement data.

Its verification block will nevertheless re-assert RIK's state afterwards —
190 provisions, 180 pictures, 18 pool covers — the same guard 0054 carries,
so that a migration which somehow disturbed RIK fails loudly instead of
passing quietly.

## 7. What needs your approval before a line of SQL is written

1. The column name: `business`. Alternatives: `catalogue`, `shop`.
2. The two values: `'grocers'` and `'fresh_mart'`.
3. The product mapping, and the two judgement calls named in §4.
4. That retiring the old 14 categories with `active = false` — rather than
   deleting them — is what you want.
5. That the four Rehearsal rows stay untouched and flagged.

## 8. Testing, before it goes anywhere near Windows

The container holds a scratch database restored from the shipped snapshot.
0055 would be applied there first, then: the full API integration suite, a
check that the 21 products resolve under their new categories, a check that
the two historical order lines still read correctly, and the RIK assertions.
Only after that would a migration file be offered for transfer.

**None of that has been done. No migration file exists yet.**
