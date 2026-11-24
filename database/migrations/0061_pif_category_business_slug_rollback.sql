-- ===========================================================================
--  0061  ROLLBACK — remove the business identity, slug and approved artwork
--                   reference from pif.categories
-- ===========================================================================
--
--  WHAT THIS IS. The exact reverse of 0061. It drops eleven named objects and
--  then three columns, and proves afterwards that pif.categories is back in
--  its post-0050 shape with all 14 rows byte-identical.
--
--  DEPENDENCY ORDER IS NOT OPTIONAL. Each step below exists because
--  PostgreSQL would refuse the next one otherwise, or because dropping in a
--  different order would lose information silently:
--
--    1. pif_categories_parent_business_fk  — the foreign key DEPENDS on the
--       unique constraint it references. Drop the key first or PostgreSQL
--       refuses step 2 with "cannot drop ... because other objects depend".
--    2. pif_categories_id_business_uq      — now free.
--    3. the three CHECK constraints         — independent of each other.
--    4. the three pif.categories indexes    — independent.
--    5. the three pif.products indexes and
--       pif_products_category_required_chk  — independent.
--    6. the three columns, LAST. Dropping a column would cascade to anything
--       above that still named it, which is exactly the silent removal this
--       script is written to avoid: every object is dropped BY NAME first, so
--       the postcondition can prove each one is gone rather than assuming a
--       cascade took it.
--
--  WHY IT REFUSES WHEN ANY ROW HAS A BUSINESS. If 0062 has run, or a staff
--  member has created a business-owned category, dropping business_slug and
--  slug would silently discard their values. This script stops instead and
--  tells you to roll back 0062 first. That is the rollback ORDER the plan
--  specifies: 0063 -> 0062 -> 0061.
--
--  WHAT IT DOES NOT TOUCH. pif_categories_parent_fk (migration 0011) and the
--  trigger category_parent_valid with its function (migration 0050) — 0061
--  never altered them, and the postconditions prove they are still present
--  and byte-identical. No order, no order item, no product row is read for
--  anything other than counting, and none is written.
--
--  RUN IT the same way as the migration, in a session of its own:
--
--    "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres ^
--      -d esamagri_staging -v ON_ERROR_STOP=1 ^
--      -f 0061_pif_category_business_slug_rollback.sql
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

DO $rollback$
DECLARE
  n_cols        integer;
  n_cats        integer;
  n_products    integer;
  n_orders      integer;
  n_order_items integer;
  n_bad         integer;
  n_left        integer;
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
  -- 0. The right database.
  -- -------------------------------------------------------------------
  IF current_database() <> 'esamagri_staging' THEN
    RAISE EXCEPTION
      'Rollback 0061 refused: connected to database %, expected esamagri_staging.',
      current_database();
  END IF;

  -- -------------------------------------------------------------------
  -- 1. Preconditions.
  -- -------------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'pif' AND table_name = 'categories' AND column_name = 'business_slug'
  ) THEN
    RAISE EXCEPTION
      'Rollback 0061 refused: business_slug is not visible on pif.categories, so 0061 appears not to be applied. Before concluding that, check current_user and whether a SET ROLE is in force: information_schema hides columns you hold no privilege on, so a restricted role sees no column that is plainly there.';
  END IF;

  -- THE GUARD THAT MATTERS. Any business-owned category means 0062 has run
  -- or staff have created one; dropping the columns would discard that.
  SELECT count(*) INTO n_bad FROM pif.categories WHERE business_slug IS NOT NULL;
  IF n_bad <> 0 THEN
    RAISE EXCEPTION
      'Rollback 0061 refused: % category(ies) carry a business_slug. Dropping these columns would silently discard their business and slug. Roll back 0062 first — the order is 0063, then 0062, then 0061.',
      n_bad;
  END IF;

  SELECT count(*) INTO n_bad FROM pif.categories WHERE slug IS NOT NULL;
  IF n_bad <> 0 THEN
    RAISE EXCEPTION
      'Rollback 0061 refused: % category(ies) carry a slug while having no business. Investigate before dropping the column.',
      n_bad;
  END IF;

  -- approved_image_ref is guarded on its own, and not merely as a side effect
  -- of the business_slug guard above. The two normally move together — 0062
  -- writes both for the same 164 rows — but "normally" is not a guarantee, and
  -- this column holds the ONLY database record of which approved artwork a
  -- category should be restored to. If it is ever populated independently (by
  -- hand, or by a later migration), dropping the column would destroy that
  -- record with nothing to recover it from. So: refuse.
  SELECT count(*) INTO n_bad FROM pif.categories WHERE approved_image_ref IS NOT NULL;
  IF n_bad <> 0 THEN
    RAISE EXCEPTION
      'Rollback 0061 refused: % category(ies) carry an approved_image_ref. Dropping this column would destroy the only record of their approved artwork. Roll back 0062 first — the order is 0063, then 0062, then 0061.',
      n_bad;
  END IF;

  SELECT count(*) INTO n_cats        FROM pif.categories;
  SELECT count(*) INTO n_products    FROM pif.products;
  SELECT count(*) INTO n_orders      FROM pif.orders;
  SELECT count(*) INTO n_order_items FROM pif.order_items;

  SELECT string_agg(
           id::text || '|' || name || '|' || coalesce(parent_id::text, '-') || '|' ||
           coalesce(description, '-') || '|' || coalesce(image_ref, '-') || '|' ||
           sort_order::text || '|' || active::text || '|' ||
           coalesce(created_by::text, '-') || '|' ||
           created_at::text || '|' || updated_at::text,
           ',' ORDER BY id)
    INTO fingerprint
    FROM pif.categories;

  SELECT pg_get_functiondef(p.oid) INTO trig_before
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'pif' AND p.proname = 'trg_validate_category_parent';
  SELECT pg_get_constraintdef(oid) INTO fk_before
    FROM pg_constraint
   WHERE conname = 'pif_categories_parent_fk' AND conrelid = 'pif.categories'::regclass;

  -- -------------------------------------------------------------------
  -- 2. The foreign key FIRST. It depends on the unique constraint below.
  -- -------------------------------------------------------------------
  ALTER TABLE pif.categories DROP CONSTRAINT IF EXISTS pif_categories_parent_business_fk;

  -- -------------------------------------------------------------------
  -- 3. Now the unique constraint it referenced.
  -- -------------------------------------------------------------------
  ALTER TABLE pif.categories DROP CONSTRAINT IF EXISTS pif_categories_id_business_uq;

  -- -------------------------------------------------------------------
  -- 4. The three CHECK constraints.
  -- -------------------------------------------------------------------
  ALTER TABLE pif.categories DROP CONSTRAINT IF EXISTS pif_categories_business_chk;
  ALTER TABLE pif.categories DROP CONSTRAINT IF EXISTS pif_categories_slug_format_chk;
  ALTER TABLE pif.categories DROP CONSTRAINT IF EXISTS pif_categories_slug_required_chk;

  -- -------------------------------------------------------------------
  -- 5. The three pif.categories indexes.
  -- -------------------------------------------------------------------
  DROP INDEX IF EXISTS pif.pif_categories_business_slug_uq;
  DROP INDEX IF EXISTS pif.pif_categories_identity_uq;
  DROP INDEX IF EXISTS pif.pif_categories_business_sort_idx;

  -- -------------------------------------------------------------------
  -- 6. The pif.products additions. The CHECK goes too: it was added by
  --    0061 and is not part of the pre-0061 schema.
  -- -------------------------------------------------------------------
  DROP INDEX IF EXISTS pif.pif_products_category_active_idx;
  DROP INDEX IF EXISTS pif.pif_products_count_idx;
  DROP INDEX IF EXISTS pif.pif_products_brand_trgm_idx;
  ALTER TABLE pif.products DROP CONSTRAINT IF EXISTS pif_products_category_required_chk;

  -- -------------------------------------------------------------------
  -- 7. The columns LAST, in reverse order of addition. By now nothing
  --    names them, so there is nothing left for a cascade to remove.
  -- -------------------------------------------------------------------
  ALTER TABLE pif.categories DROP COLUMN IF EXISTS approved_image_ref;
  ALTER TABLE pif.categories DROP COLUMN IF EXISTS slug;
  ALTER TABLE pif.categories DROP COLUMN IF EXISTS business_slug;

  -- -------------------------------------------------------------------
  -- 8. Postconditions.
  -- -------------------------------------------------------------------

  -- 8a. Back to the post-0050 shape: 11 columns, none of the three present.
  SELECT count(*) INTO n_cols FROM information_schema.columns
   WHERE table_schema = 'pif' AND table_name = 'categories';
  IF n_cols <> 11 THEN
    RAISE EXCEPTION 'Rollback 0061 failed: pif.categories has % columns, expected 11.', n_cols;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'pif' AND table_name = 'categories'
       AND column_name IN ('business_slug', 'slug', 'approved_image_ref')
  ) THEN
    RAISE EXCEPTION 'Rollback 0061 failed: one of the three columns is still present.';
  END IF;

  -- 8b. NONE of the eleven named objects survives.
  -- conrelid is filtered deliberately: pg_constraint.conname is not globally
  -- unique, so matching on the name alone could count a same-named constraint
  -- on an unrelated table and fail this rollback for no reason.
  SELECT count(*) INTO n_left FROM pg_constraint
   WHERE conname IN ('pif_categories_business_chk', 'pif_categories_slug_format_chk',
                     'pif_categories_slug_required_chk', 'pif_categories_id_business_uq',
                     'pif_categories_parent_business_fk', 'pif_products_category_required_chk')
     AND conrelid IN ('pif.categories'::regclass, 'pif.products'::regclass);
  IF n_left <> 0 THEN
    RAISE EXCEPTION 'Rollback 0061 failed: % of the 6 constraints 0061 added still exist.', n_left;
  END IF;

  SELECT count(*) INTO n_left FROM pg_indexes
   WHERE schemaname = 'pif'
     AND indexname IN ('pif_categories_business_slug_uq', 'pif_categories_identity_uq',
                       'pif_categories_business_sort_idx', 'pif_products_category_active_idx',
                       'pif_products_count_idx', 'pif_products_brand_trgm_idx');
  IF n_left <> 0 THEN
    RAISE EXCEPTION 'Rollback 0061 failed: % of the 6 indexes 0061 added still exist.', n_left;
  END IF;

  -- 8c. What 0061 never touched is still exactly as it was.
  SELECT pg_get_functiondef(p.oid) INTO trig_after
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'pif' AND p.proname = 'trg_validate_category_parent';
  IF trig_after IS NULL OR trig_after IS DISTINCT FROM trig_before THEN
    RAISE EXCEPTION 'Rollback 0061 failed: pif.trg_validate_category_parent() is missing or altered.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'category_parent_valid'
       AND tgrelid = 'pif.categories'::regclass AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Rollback 0061 failed: trigger category_parent_valid is gone.';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO fk_after
    FROM pg_constraint
   WHERE conname = 'pif_categories_parent_fk' AND conrelid = 'pif.categories'::regclass;
  IF fk_after IS NULL OR fk_after IS DISTINCT FROM fk_before THEN
    RAISE EXCEPTION 'Rollback 0061 failed: pif_categories_parent_fk is missing or altered.';
  END IF;

  -- 8d. Every one of the 14 rows is byte-identical to before this script ran.
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
    RAISE EXCEPTION 'Rollback 0061 failed: a category row changed. This script must write no row.';
  END IF;

  -- 8e. No row anywhere was added or lost.
  IF (SELECT count(*) FROM pif.categories)  <> n_cats        THEN
    RAISE EXCEPTION 'Rollback 0061 failed: the category count changed.';
  END IF;
  IF (SELECT count(*) FROM pif.products)    <> n_products    THEN
    RAISE EXCEPTION 'Rollback 0061 failed: the product count changed.';
  END IF;
  IF (SELECT count(*) FROM pif.orders)      <> n_orders      THEN
    RAISE EXCEPTION 'Rollback 0061 failed: the order count changed.';
  END IF;
  IF (SELECT count(*) FROM pif.order_items) <> n_order_items THEN
    RAISE EXCEPTION 'Rollback 0061 failed: the order item count changed.';
  END IF;

  -- 8f. The schema contract is where it started.
  SELECT count(*) INTO n_tables FROM information_schema.tables
   WHERE table_type = 'BASE TABLE' AND table_schema IN ('shared', 'rik', 'pif');
  SELECT count(*) INTO n_views FROM information_schema.views
   WHERE table_schema IN ('shared', 'rik', 'pif');
  IF n_tables <> 70 OR n_views <> 5 THEN
    RAISE EXCEPTION
      'Rollback 0061 failed: schema contract at % tables / % views, expected 70 / 5.',
      n_tables, n_views;
  END IF;

  RAISE NOTICE 'ROLLBACK 0061 COMPLETE: 11 objects and 3 columns removed. % categories, % products, % orders, % order items — all unchanged. Read the SELECTs below.',
    n_cats, n_products, n_orders, n_order_items;
END
$rollback$;

-- ===========================================================================
--  Verification, after the block has committed.
-- ===========================================================================

\echo ''
\echo '--- 1. pif.categories columns: expect 11, none of the three new ones'
SELECT ordinal_position, column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'pif' AND table_name = 'categories'
 ORDER BY ordinal_position;

\echo ''
\echo '--- 2. the 11 objects 0061 added: expect ZERO rows'
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
                     'pif_products_count_idx', 'pif_products_brand_trgm_idx');

\echo ''
\echo '--- 3. what 0061 never touched: expect both rows present and unchanged'
SELECT 'pif_categories_parent_fk' AS object, pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
 WHERE conname = 'pif_categories_parent_fk' AND conrelid = 'pif.categories'::regclass
UNION ALL
SELECT 'category_parent_valid', 'trigger present on pif.categories'
  FROM pg_trigger
 WHERE tgname = 'category_parent_valid'
   AND tgrelid = 'pif.categories'::regclass AND NOT tgisinternal;

\echo ''
\echo '--- 4. nothing moved: expect 14 / 21 / 8 / 13 / 70 / 5'
SELECT (SELECT count(*) FROM pif.categories)  AS categories,
       (SELECT count(*) FROM pif.products)    AS products,
       (SELECT count(*) FROM pif.orders)      AS orders,
       (SELECT count(*) FROM pif.order_items) AS order_items,
       (SELECT count(*) FROM information_schema.tables
         WHERE table_type = 'BASE TABLE'
           AND table_schema IN ('shared','rik','pif'))   AS tables,
       (SELECT count(*) FROM information_schema.views
         WHERE table_schema IN ('shared','rik','pif'))   AS views;
