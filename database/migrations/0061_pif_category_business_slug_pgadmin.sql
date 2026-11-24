-- ===========================================================================
--  0061  PIF category business identity, slug and approved artwork reference
-- ===========================================================================
--
--  WHAT THIS IS. Three nullable columns on pif.categories, the constraints
--  that govern them, and four indexes. It writes NO ROW. Not one existing
--  category or product is updated, and the postconditions prove it with a
--  fingerprint taken before the first ALTER and compared after the last one.
--
--  WHY NULLABLE (decision D4). The 14 legacy categories predate the concept
--  of a business. NULL means "pre-business legacy row" and is the honest
--  value; forcing a made-up one on them would rewrite records you asked to
--  leave untouched. It is also the precise handle every later step needs:
--  `business_slug IS NULL` selects exactly the 14, `IS NOT NULL` exactly the
--  164 that 0062 will import.
--
--  WHY A COMPOSITE FOREIGN KEY RATHER THAN A TRIGGER. A subcategory must
--  belong to its parent's business. A CHECK cannot see another row, so the
--  obvious alternative is to extend `category_parent_valid` — existing,
--  working, approved code that governs the two-level rule. This migration
--  does not touch it. Instead `UNIQUE (id, business_slug)` plus
--  `FOREIGN KEY (parent_id, business_slug) REFERENCES (id, business_slug)`
--  enforces the same thing declaratively. MATCH SIMPLE is the default, so a
--  row whose business_slug is NULL is not checked at all: the legacy rows,
--  `Dals` under `Pulses` included, satisfy it without being rewritten.
--
--  WHY THE SLUG UNIQUE INDEX IS PARTIAL. Without the WHERE clause, 14 legacy
--  rows all holding (NULL, NULL) would collide with each other under
--  NULLS NOT DISTINCT and the index could not be created. The partial index
--  enforces "one slug per business" exactly where that means something.
--
--  THE SCHEMA CONTRACT DOES NOT MOVE. No table and no view is added, so the
--  count stays 70 / 5 and apps/api/src/database/schema-contract.ts needs no
--  edit. The postconditions re-assert that.
--
--  RIK IS NOT TOUCHED. Not a table, not a trigger, not a function, not a
--  privilege, not a row. Every object this file names is in schema `pif`.
--
--  NO BEGIN AND NO COMMIT, DELIBERATELY. Migration 0059 was correct SQL that
--  reported success from inside a transaction whose COMMIT never reached the
--  server, and rolled back after the notice had printed. One DO block under
--  autocommit is its own transaction: it commits when it completes and there
--  is nothing trailing to lose. The SELECTs after the block read COMMITTED
--  rows — they are the evidence, not the RAISE NOTICE.
--
--  HOW TO RUN IT, when approved:
--
--    "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres ^
--      -d esamagri_staging -v ON_ERROR_STOP=1 ^
--      -f 0061_pif_category_business_slug_pgadmin.sql
--
--  Then re-run the three verification SELECTs in a FRESH psql session. A
--  migration is not applied until a new connection can see its effects.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  NO `SET ROLE` HERE, AND THAT IS DELIBERATE.
--
--  Earlier migrations in this project open with `SET ROLE esamagri_owner;`,
--  because migration 0018 intended that role to own every object in shared,
--  rik and pif. In THIS database it does not: pif.categories and pif.products
--  are owned by `postgres`, and esamagri_owner holds no privilege on them.
--
--  Switching to it broke this file in a way worth recording. PostgreSQL's
--  information_schema shows only the columns of tables the current role has
--  some privilege on, so as esamagri_owner the precondition below counted ZERO
--  columns on a table that plainly has eleven — while to_regclass, which reads
--  the catalogue and is NOT privilege-filtered, found the table perfectly well.
--  One check could see the table, the very next could not.
--
--  Removing the line is a fix and not a workaround: every ALTER TABLE below
--  requires OWNERSHIP of the table, which esamagri_owner does not have here, so
--  no amount of making the preconditions privilege-proof would let this file
--  run as that role. It also keeps the objects added here consistent with the
--  ownership the tables actually have, instead of creating a mixture.
--
--  Migrations 0057 to 0060 were applied to this database with no SET ROLE at
--  all, as the connecting superuser. This file now matches them.
--
--  Changing who owns these tables would be the proper long-term repair. That is
--  a privilege change across the whole database, it could disturb the API's own
--  role, and it belongs in its own reviewed migration — not in this one.
-- ---------------------------------------------------------------------------

DO $migration$
DECLARE
  n_cols        integer;
  n_cats        integer;
  n_products    integer;
  n_orders      integer;
  n_order_items integer;
  n_bad         integer;
  n_tables      integer;
  n_views       integer;
  fingerprint   text;
  after_print   text;
  trig_before   text;
  trig_after    text;
  fk_before     text;
  fk_after      text;
BEGIN
  -- -------------------------------------------------------------------
  -- 0. The right database, and only the right database.
  -- -------------------------------------------------------------------
  IF current_database() <> 'esamagri_staging' THEN
    RAISE EXCEPTION
      'Migration 0061 refused: connected to database %, expected esamagri_staging.',
      current_database();
  END IF;

  -- -------------------------------------------------------------------
  -- 1. Preconditions. Every one of these refuses rather than guesses.
  -- -------------------------------------------------------------------
  IF to_regclass('pif.categories') IS NULL THEN
    RAISE EXCEPTION 'Migration 0061 refused: pif.categories does not exist.';
  END IF;
  IF to_regclass('pif.products') IS NULL THEN
    RAISE EXCEPTION 'Migration 0061 refused: pif.products does not exist.';
  END IF;

  -- Already applied, in whole or in part? Refuse rather than half-apply.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'pif' AND table_name = 'categories'
       AND column_name IN ('business_slug', 'slug', 'approved_image_ref')
  ) THEN
    RAISE EXCEPTION
      'Migration 0061 refused: business_slug, slug or approved_image_ref already exists on pif.categories. This migration has already been applied, in whole or in part.';
  END IF;

  -- The post-0050 shape, exactly: 0011 created 4 columns, 0050 added 7.
  -- Step 2's inspection measured 11. Anything else means something has
  -- altered this table that no migration in this project accounts for.
  SELECT count(*) INTO n_cols FROM information_schema.columns
   WHERE table_schema = 'pif' AND table_name = 'categories';
  IF n_cols <> 11 THEN
    RAISE EXCEPTION
      'Migration 0061 refused: pif.categories has % columns, expected 11 (4 from 0011 + 7 from 0050). IF THIS SAYS 0, the session has no privilege on the table rather than the table being empty: information_schema hides columns you hold no privilege on. Check current_user and whether a SET ROLE is in force.',
      n_cols;
  END IF;

  SELECT count(*) INTO n_cats FROM pif.categories;
  IF n_cats <> 14 THEN
    RAISE EXCEPTION
      'Migration 0061 refused: expected 14 legacy categories, found %. Re-run the Step 2 inspection before proceeding.',
      n_cats;
  END IF;

  -- R2-a, re-asserted HERE AND NOW rather than trusted from an inspection
  -- taken on another day. The product-category CHECK in section 6 cannot be
  -- added if any product has no category, and a count from last week is not
  -- evidence about this moment.
  SELECT count(*) INTO n_bad FROM pif.products WHERE category_id IS NULL;
  IF n_bad <> 0 THEN
    RAISE EXCEPTION
      'Migration 0061 refused: % product(s) have no category, so pif_products_category_required_chk cannot be added. Re-file them onto categories first, or remove that constraint from this migration and re-review.',
      n_bad;
  END IF;

  -- Remembered so the postconditions can prove nothing moved.
  SELECT count(*) INTO n_products    FROM pif.products;
  SELECT count(*) INTO n_orders      FROM pif.orders;
  SELECT count(*) INTO n_order_items FROM pif.order_items;

  -- Every existing category row, over the columns that exist BEFORE this
  -- migration. If one byte of this changes, the migration fails.
  SELECT string_agg(
           id::text || '|' || name || '|' || coalesce(parent_id::text, '-') || '|' ||
           coalesce(description, '-') || '|' || coalesce(image_ref, '-') || '|' ||
           sort_order::text || '|' || active::text || '|' ||
           coalesce(created_by::text, '-') || '|' ||
           created_at::text || '|' || updated_at::text,
           ',' ORDER BY id)
    INTO fingerprint
    FROM pif.categories;

  -- The two-level rule's own machinery, recorded so we can prove it is
  -- untouched. This migration must not alter either.
  SELECT pg_get_functiondef(p.oid) INTO trig_before
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'pif' AND p.proname = 'trg_validate_category_parent';
  IF trig_before IS NULL THEN
    RAISE EXCEPTION 'Migration 0061 refused: pif.trg_validate_category_parent() not found. Apply 0050 first.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'category_parent_valid'
       AND tgrelid = 'pif.categories'::regclass AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Migration 0061 refused: trigger category_parent_valid not found on pif.categories.';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO fk_before
    FROM pg_constraint
   WHERE conname = 'pif_categories_parent_fk' AND conrelid = 'pif.categories'::regclass;
  IF fk_before IS NULL THEN
    RAISE EXCEPTION 'Migration 0061 refused: pif_categories_parent_fk not found. Apply 0011 first.';
  END IF;

  -- -------------------------------------------------------------------
  -- 2. The three columns. All nullable; no DEFAULT, so no row is rewritten.
  -- -------------------------------------------------------------------
  ALTER TABLE pif.categories ADD COLUMN business_slug      text;
  ALTER TABLE pif.categories ADD COLUMN slug               text;
  ALTER TABLE pif.categories ADD COLUMN approved_image_ref text;

  -- -------------------------------------------------------------------
  -- 3. What the values may be (decisions D5, D7, R5-a).
  --
  --    A CHECK and not a lookup table: pif.businesses would move the schema
  --    contract from 70 tables to 71, which is a separately approved change.
  --    The two slugs are already fixed in the Customer App's businesses.ts
  --    and are the only two with kind: 'shop'.
  -- -------------------------------------------------------------------
  ALTER TABLE pif.categories
    ADD CONSTRAINT pif_categories_business_chk
    CHECK (business_slug IS NULL OR business_slug IN ('grocers', 'fresh-mart'));

  ALTER TABLE pif.categories
    ADD CONSTRAINT pif_categories_slug_format_chk
    CHECK (slug IS NULL OR slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

  -- A business-owned category must carry a slug. This is the constraint that
  -- obliges the server to derive one, which categorySlug() now does.
  ALTER TABLE pif.categories
    ADD CONSTRAINT pif_categories_slug_required_chk
    CHECK (business_slug IS NULL OR slug IS NOT NULL);

  -- -------------------------------------------------------------------
  -- 4. A child belongs to its parent's business — declaratively.
  --    The FK is ADDED beside pif_categories_parent_fk (migration 0011),
  --    which stays exactly as it is. Nothing is dropped and re-added, so no
  --    existing row is revalidated in a way that could fail this migration.
  -- -------------------------------------------------------------------
  ALTER TABLE pif.categories
    ADD CONSTRAINT pif_categories_id_business_uq UNIQUE (id, business_slug);

  ALTER TABLE pif.categories
    ADD CONSTRAINT pif_categories_parent_business_fk
    FOREIGN KEY (parent_id, business_slug)
    REFERENCES pif.categories (id, business_slug);

  -- -------------------------------------------------------------------
  -- 5. Uniqueness and ordering.
  --
  --    The first index is PARTIAL on purpose — see the header. The second
  --    needs NULLS NOT DISTINCT (PostgreSQL 15+; this server is 16.15) or it
  --    would not bite on top-level rows, where parent_id is NULL.
  -- -------------------------------------------------------------------
  CREATE UNIQUE INDEX pif_categories_business_slug_uq
    ON pif.categories (business_slug, slug)
    WHERE business_slug IS NOT NULL AND slug IS NOT NULL;

  CREATE UNIQUE INDEX pif_categories_identity_uq
    ON pif.categories (business_slug, parent_id, lower(name)) NULLS NOT DISTINCT;

  CREATE INDEX pif_categories_business_sort_idx
    ON pif.categories (business_slug, parent_id, sort_order);

  -- -------------------------------------------------------------------
  -- 6. pif.products: three indexes for the 7,150-SKU catalogue, and the
  --    R2-a constraint whose precondition section 1 just proved.
  --
  --    NO COLUMN IS ADDED TO pif.products (decision D6). A product's
  --    business is derived through its category, which is why the category
  --    must now be present.
  -- -------------------------------------------------------------------
  CREATE INDEX pif_products_category_active_idx
    ON pif.products (category_id, active, available) WHERE deleted_at IS NULL;

  CREATE INDEX pif_products_count_idx
    ON pif.products (category_id) WHERE deleted_at IS NULL AND active;

  CREATE INDEX pif_products_brand_trgm_idx
    ON pif.products USING gin (brand gin_trgm_ops);

  ALTER TABLE pif.products
    ADD CONSTRAINT pif_products_category_required_chk CHECK (category_id IS NOT NULL);

  -- -------------------------------------------------------------------
  -- 7. What the columns mean, recorded in the database itself.
  -- -------------------------------------------------------------------
  COMMENT ON COLUMN pif.categories.business_slug IS
    'Which PIF shop owns this category: grocers or fresh-mart. NULL marks a pre-business legacy row from migration 0019 or the demonstration catalogue.';
  COMMENT ON COLUMN pif.categories.slug IS
    'Stable navigation key, identical to the slug in the approved frontend tree (apps/customer-web/src/lib/businesses/category-tree.ts). Unique per business. NULL on legacy rows. Derived by one rule, implemented once in apps/api/src/pif/services/category-slug.ts: lowercase; & becomes "and"; punctuation becomes a hyphen.';
  COMMENT ON COLUMN pif.categories.approved_image_ref IS
    'The approved green-banner artwork path for this category, written ONCE by migration 0062 and never by the upload API. image_ref holds the live value a staff member may replace; this column is what "restore approved artwork" restores from.';

  -- -------------------------------------------------------------------
  -- 8. Postconditions. Each one its own exception, so a failure says which.
  -- -------------------------------------------------------------------

  -- 8a. The three columns exist, are text, and are nullable.
  SELECT count(*) INTO n_cols FROM information_schema.columns
   WHERE table_schema = 'pif' AND table_name = 'categories'
     AND column_name IN ('business_slug', 'slug', 'approved_image_ref')
     AND data_type = 'text' AND is_nullable = 'YES';
  IF n_cols <> 3 THEN
    RAISE EXCEPTION 'Migration 0061 failed: expected 3 new nullable text columns, found %.', n_cols;
  END IF;

  -- 8b. Exactly 14 columns now (11 + 3).
  SELECT count(*) INTO n_cols FROM information_schema.columns
   WHERE table_schema = 'pif' AND table_name = 'categories';
  IF n_cols <> 14 THEN
    RAISE EXCEPTION 'Migration 0061 failed: pif.categories has % columns, expected 14.', n_cols;
  END IF;

  -- 8c. All six named constraints are present.
  SELECT count(*) INTO n_cols FROM pg_constraint
   WHERE conname IN ('pif_categories_business_chk', 'pif_categories_slug_format_chk',
                     'pif_categories_slug_required_chk', 'pif_categories_id_business_uq',
                     'pif_categories_parent_business_fk')
     AND conrelid = 'pif.categories'::regclass;
  IF n_cols <> 5 THEN
    RAISE EXCEPTION 'Migration 0061 failed: expected 5 new constraints on pif.categories, found %.', n_cols;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'pif_products_category_required_chk' AND conrelid = 'pif.products'::regclass
  ) THEN
    RAISE EXCEPTION 'Migration 0061 failed: pif_products_category_required_chk is not in place.';
  END IF;

  -- 8d. All six named indexes are present.
  SELECT count(*) INTO n_cols FROM pg_indexes
   WHERE schemaname = 'pif'
     AND indexname IN ('pif_categories_business_slug_uq', 'pif_categories_identity_uq',
                       'pif_categories_business_sort_idx', 'pif_products_category_active_idx',
                       'pif_products_count_idx', 'pif_products_brand_trgm_idx');
  IF n_cols <> 6 THEN
    RAISE EXCEPTION 'Migration 0061 failed: expected 6 new indexes, found %.', n_cols;
  END IF;

  -- 8e. THE ROW FINGERPRINT. Not one of the 14 categories was rewritten.
  SELECT string_agg(
           id::text || '|' || name || '|' || coalesce(parent_id::text, '-') || '|' ||
           coalesce(description, '-') || '|' || coalesce(image_ref, '-') || '|' ||
           sort_order::text || '|' || active::text || '|' ||
           coalesce(created_by::text, '-') || '|' ||
           created_at::text || '|' || updated_at::text,
           ',' ORDER BY id)
    INTO after_print
    FROM pif.categories;
  IF after_print IS DISTINCT FROM fingerprint THEN
    RAISE EXCEPTION 'Migration 0061 failed: an existing category row changed. This migration must write no row.';
  END IF;

  -- 8f. The new columns are NULL on every existing row.
  SELECT count(*) INTO n_bad FROM pif.categories
   WHERE business_slug IS NOT NULL OR slug IS NOT NULL OR approved_image_ref IS NOT NULL;
  IF n_bad <> 0 THEN
    RAISE EXCEPTION 'Migration 0061 failed: % row(s) carry a value in a new column. This migration seeds none.', n_bad;
  END IF;

  -- 8g. The two-level machinery is byte-identical, and 0011's FK survives.
  SELECT pg_get_functiondef(p.oid) INTO trig_after
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'pif' AND p.proname = 'trg_validate_category_parent';
  IF trig_after IS DISTINCT FROM trig_before THEN
    RAISE EXCEPTION 'Migration 0061 failed: pif.trg_validate_category_parent() was altered. It must not be.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'category_parent_valid'
       AND tgrelid = 'pif.categories'::regclass AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Migration 0061 failed: trigger category_parent_valid is gone.';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO fk_after
    FROM pg_constraint
   WHERE conname = 'pif_categories_parent_fk' AND conrelid = 'pif.categories'::regclass;
  IF fk_after IS DISTINCT FROM fk_before THEN
    RAISE EXCEPTION 'Migration 0061 failed: pif_categories_parent_fk was altered. It must not be.';
  END IF;

  -- 8h. NOT ONE ROW ANYWHERE. Categories, products, and the order history.
  IF (SELECT count(*) FROM pif.categories)  <> n_cats        THEN
    RAISE EXCEPTION 'Migration 0061 failed: the category count changed.';
  END IF;
  IF (SELECT count(*) FROM pif.products)    <> n_products    THEN
    RAISE EXCEPTION 'Migration 0061 failed: the product count changed.';
  END IF;
  IF (SELECT count(*) FROM pif.orders)      <> n_orders      THEN
    RAISE EXCEPTION 'Migration 0061 failed: the order count changed. This migration must not touch orders.';
  END IF;
  IF (SELECT count(*) FROM pif.order_items) <> n_order_items THEN
    RAISE EXCEPTION 'Migration 0061 failed: the order item count changed. This migration must not touch order items.';
  END IF;

  -- 8i. The schema contract is unmoved: no table, no view was added.
  SELECT count(*) INTO n_tables FROM information_schema.tables
   WHERE table_type = 'BASE TABLE' AND table_schema IN ('shared', 'rik', 'pif');
  SELECT count(*) INTO n_views FROM information_schema.views
   WHERE table_schema IN ('shared', 'rik', 'pif');
  IF n_tables <> 70 OR n_views <> 5 THEN
    RAISE EXCEPTION
      'Migration 0061 failed: schema contract moved to % tables / % views, expected 70 / 5.',
      n_tables, n_views;
  END IF;

  RAISE NOTICE '0061: 3 columns, 6 constraints, 6 indexes added. % categories, % products, % orders, % order items — all unchanged. Read the SELECTs below; THEY are the committed truth, not this notice.',
    n_cats, n_products, n_orders, n_order_items;
END
$migration$;

-- ===========================================================================
--  Verification. These run after the DO block has committed, so what they
--  print is durable. Re-run them in a FRESH psql session as well.
-- ===========================================================================

\echo ''
\echo '--- 1. pif.categories columns: expect 14, the last three new and nullable'
SELECT ordinal_position, column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'pif' AND table_name = 'categories'
 ORDER BY ordinal_position;

\echo ''
\echo '--- 2. the new constraints and indexes, by name: expect 6 + 6'
SELECT 'constraint' AS kind, conname AS name
  FROM pg_constraint
 WHERE conname IN ('pif_categories_business_chk', 'pif_categories_slug_format_chk',
                   'pif_categories_slug_required_chk', 'pif_categories_id_business_uq',
                   'pif_categories_parent_business_fk', 'pif_products_category_required_chk')
   AND conrelid IN ('pif.categories'::regclass, 'pif.products'::regclass)
UNION ALL
SELECT 'index', indexname
  FROM pg_indexes
 WHERE schemaname = 'pif'
   AND indexname IN ('pif_categories_business_slug_uq', 'pif_categories_identity_uq',
                     'pif_categories_business_sort_idx', 'pif_products_category_active_idx',
                     'pif_products_count_idx', 'pif_products_brand_trgm_idx')
 ORDER BY kind, name;

\echo ''
\echo '--- 3. nothing moved: expect 14 / 0 new-column values / 21 / 8 / 13 / 70 / 5'
SELECT (SELECT count(*) FROM pif.categories)                                   AS categories,
       (SELECT count(*) FROM pif.categories
         WHERE business_slug IS NOT NULL OR slug IS NOT NULL
            OR approved_image_ref IS NOT NULL)                                 AS rows_with_new_values,
       (SELECT count(*) FROM pif.products)                                      AS products,
       (SELECT count(*) FROM pif.orders)                                        AS orders,
       (SELECT count(*) FROM pif.order_items)                                   AS order_items,
       (SELECT count(*) FROM information_schema.tables
         WHERE table_type = 'BASE TABLE'
           AND table_schema IN ('shared','rik','pif'))                          AS tables,
       (SELECT count(*) FROM information_schema.views
         WHERE table_schema IN ('shared','rik','pif'))                          AS views;
