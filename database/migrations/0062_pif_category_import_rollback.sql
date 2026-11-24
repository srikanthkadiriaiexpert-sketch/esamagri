-- ===========================================================================
-- Rollback for migration 0062: remove the 164 imported PIF categories
-- ===========================================================================
--
-- WHAT THIS REMOVES. Exactly the 164 rows migration 0062 inserted, named by
-- primary key, one id at a time, and NOTHING ELSE:
--   01a1998e-4400-7062-8062-000000000001 .. -000000000021   the 21 mains
--   01a1998e-4400-7062-8062-000000000022 .. -000000000164   the 143 subs
--
-- WHAT IT REFUSES TO DO, BY DESIGN. It never issues
--   DELETE FROM pif.categories WHERE business_slug IS NOT NULL
-- which is the obvious shortcut and the wrong one: it would also destroy any
-- category an administrator has added since 0062 ran. The id list below is
-- the whole definition of what this rollback owns. A row carrying a
-- business_slug that is not in the list is somebody else's, and this script
-- stops rather than touching it.
--
-- WHAT IT PROTECTS.
--   * The 14 legacy categories (business_slug IS NULL). Counted before and
--     after, and fingerprinted across every column.
--   * The 21 products, 8 orders and 13 order items. Counted before and after.
--     If any product has since been filed under one of the 164 categories,
--     this rollback REFUSES rather than cascade-breaking the catalogue --
--     recategorise those products first and decide deliberately.
--   * Everything in rik.* and shared.*, which this script does not name.
--
-- ORDER OF REMOVAL. Subcategories first, then mains. pif_categories_parent_fk
-- and 0061's composite pif_categories_parent_business_fk both point at the
-- parent row, so deleting a main while its subcategories exist would fail.
--
-- HOW TO RUN IT. One statement, one transaction, no BEGIN and no COMMIT --
-- the DO block is atomic and either removes all 164 rows or none. There are
-- no psql backslash meta-commands, so it runs in psql and in the pgAdmin
-- Query Tool alike.
--
--   psql -U postgres -d esamagri_staging -v ON_ERROR_STOP=1 \
--        -f 0062_pif_category_import_rollback.sql
--
-- NO SET ROLE HERE, AND THAT IS DELIBERATE. pif.categories is owned by
-- postgres; esamagri_owner is NOLOGIN and owns nothing, and a SET ROLE to it
-- makes information_schema report zero columns on a table that is plainly
-- there. Run this as postgres.
-- ===========================================================================

DO $rollback$
DECLARE
  n_cols        integer;
  n_cats        integer;
  n_legacy      integer;
  n_business    integer;
  n_batch       integer;
  n_foreign     integer;
  n_deleted     integer;
  n_products    integer;
  n_orders      integer;
  n_order_items integer;
  n_tables      integer;
  n_views       integer;
  n_bad         integer;
  fp_before     text;
  fp_after      text;
BEGIN
  -- =========================================================================
  -- PRECONDITIONS. Each one aborts the whole block, so a refusal removes
  -- nothing at all.
  -- =========================================================================

  -- 1. The columns 0062 wrote must exist, or there is nothing to roll back
  --    and we are probably looking at the wrong database.
  SELECT count(*) INTO n_cols
    FROM information_schema.columns
   WHERE table_schema = 'pif' AND table_name = 'categories'
     AND column_name IN ('business_slug', 'slug', 'approved_image_ref');
  IF n_cols <> 3 THEN
    RAISE EXCEPTION
      'Rollback 0062 refused: pif.categories shows % of the three columns 0061 adds, expected 3, so migration 0062 cannot have been applied. IF THIS SAYS 0, the session may have no privilege on the table rather than the columns being absent: information_schema hides columns you hold no privilege on. Check current_user and whether a SET ROLE is in force.',
      n_cols;
  END IF;

  -- 2. Stage the id list. This, and only this, is what the rollback owns.
  CREATE TEMP TABLE rb_0062 (id uuid PRIMARY KEY) ON COMMIT DROP;
  INSERT INTO rb_0062 (id) VALUES
    ('01a1998e-4400-7062-8062-000000000001'), ('01a1998e-4400-7062-8062-000000000002'), ('01a1998e-4400-7062-8062-000000000003'), ('01a1998e-4400-7062-8062-000000000004'),
    ('01a1998e-4400-7062-8062-000000000005'), ('01a1998e-4400-7062-8062-000000000006'), ('01a1998e-4400-7062-8062-000000000007'), ('01a1998e-4400-7062-8062-000000000008'),
    ('01a1998e-4400-7062-8062-000000000009'), ('01a1998e-4400-7062-8062-000000000010'), ('01a1998e-4400-7062-8062-000000000011'), ('01a1998e-4400-7062-8062-000000000012'),
    ('01a1998e-4400-7062-8062-000000000013'), ('01a1998e-4400-7062-8062-000000000014'), ('01a1998e-4400-7062-8062-000000000015'), ('01a1998e-4400-7062-8062-000000000016'),
    ('01a1998e-4400-7062-8062-000000000017'), ('01a1998e-4400-7062-8062-000000000018'), ('01a1998e-4400-7062-8062-000000000019'), ('01a1998e-4400-7062-8062-000000000020'),
    ('01a1998e-4400-7062-8062-000000000021'), ('01a1998e-4400-7062-8062-000000000022'), ('01a1998e-4400-7062-8062-000000000023'), ('01a1998e-4400-7062-8062-000000000024'),
    ('01a1998e-4400-7062-8062-000000000025'), ('01a1998e-4400-7062-8062-000000000026'), ('01a1998e-4400-7062-8062-000000000027'), ('01a1998e-4400-7062-8062-000000000028'),
    ('01a1998e-4400-7062-8062-000000000029'), ('01a1998e-4400-7062-8062-000000000030'), ('01a1998e-4400-7062-8062-000000000031'), ('01a1998e-4400-7062-8062-000000000032'),
    ('01a1998e-4400-7062-8062-000000000033'), ('01a1998e-4400-7062-8062-000000000034'), ('01a1998e-4400-7062-8062-000000000035'), ('01a1998e-4400-7062-8062-000000000036'),
    ('01a1998e-4400-7062-8062-000000000037'), ('01a1998e-4400-7062-8062-000000000038'), ('01a1998e-4400-7062-8062-000000000039'), ('01a1998e-4400-7062-8062-000000000040'),
    ('01a1998e-4400-7062-8062-000000000041'), ('01a1998e-4400-7062-8062-000000000042'), ('01a1998e-4400-7062-8062-000000000043'), ('01a1998e-4400-7062-8062-000000000044'),
    ('01a1998e-4400-7062-8062-000000000045'), ('01a1998e-4400-7062-8062-000000000046'), ('01a1998e-4400-7062-8062-000000000047'), ('01a1998e-4400-7062-8062-000000000048'),
    ('01a1998e-4400-7062-8062-000000000049'), ('01a1998e-4400-7062-8062-000000000050'), ('01a1998e-4400-7062-8062-000000000051'), ('01a1998e-4400-7062-8062-000000000052'),
    ('01a1998e-4400-7062-8062-000000000053'), ('01a1998e-4400-7062-8062-000000000054'), ('01a1998e-4400-7062-8062-000000000055'), ('01a1998e-4400-7062-8062-000000000056'),
    ('01a1998e-4400-7062-8062-000000000057'), ('01a1998e-4400-7062-8062-000000000058'), ('01a1998e-4400-7062-8062-000000000059'), ('01a1998e-4400-7062-8062-000000000060'),
    ('01a1998e-4400-7062-8062-000000000061'), ('01a1998e-4400-7062-8062-000000000062'), ('01a1998e-4400-7062-8062-000000000063'), ('01a1998e-4400-7062-8062-000000000064'),
    ('01a1998e-4400-7062-8062-000000000065'), ('01a1998e-4400-7062-8062-000000000066'), ('01a1998e-4400-7062-8062-000000000067'), ('01a1998e-4400-7062-8062-000000000068'),
    ('01a1998e-4400-7062-8062-000000000069'), ('01a1998e-4400-7062-8062-000000000070'), ('01a1998e-4400-7062-8062-000000000071'), ('01a1998e-4400-7062-8062-000000000072'),
    ('01a1998e-4400-7062-8062-000000000073'), ('01a1998e-4400-7062-8062-000000000074'), ('01a1998e-4400-7062-8062-000000000075'), ('01a1998e-4400-7062-8062-000000000076'),
    ('01a1998e-4400-7062-8062-000000000077'), ('01a1998e-4400-7062-8062-000000000078'), ('01a1998e-4400-7062-8062-000000000079'), ('01a1998e-4400-7062-8062-000000000080'),
    ('01a1998e-4400-7062-8062-000000000081'), ('01a1998e-4400-7062-8062-000000000082'), ('01a1998e-4400-7062-8062-000000000083'), ('01a1998e-4400-7062-8062-000000000084'),
    ('01a1998e-4400-7062-8062-000000000085'), ('01a1998e-4400-7062-8062-000000000086'), ('01a1998e-4400-7062-8062-000000000087'), ('01a1998e-4400-7062-8062-000000000088'),
    ('01a1998e-4400-7062-8062-000000000089'), ('01a1998e-4400-7062-8062-000000000090'), ('01a1998e-4400-7062-8062-000000000091'), ('01a1998e-4400-7062-8062-000000000092'),
    ('01a1998e-4400-7062-8062-000000000093'), ('01a1998e-4400-7062-8062-000000000094'), ('01a1998e-4400-7062-8062-000000000095'), ('01a1998e-4400-7062-8062-000000000096'),
    ('01a1998e-4400-7062-8062-000000000097'), ('01a1998e-4400-7062-8062-000000000098'), ('01a1998e-4400-7062-8062-000000000099'), ('01a1998e-4400-7062-8062-000000000100'),
    ('01a1998e-4400-7062-8062-000000000101'), ('01a1998e-4400-7062-8062-000000000102'), ('01a1998e-4400-7062-8062-000000000103'), ('01a1998e-4400-7062-8062-000000000104'),
    ('01a1998e-4400-7062-8062-000000000105'), ('01a1998e-4400-7062-8062-000000000106'), ('01a1998e-4400-7062-8062-000000000107'), ('01a1998e-4400-7062-8062-000000000108'),
    ('01a1998e-4400-7062-8062-000000000109'), ('01a1998e-4400-7062-8062-000000000110'), ('01a1998e-4400-7062-8062-000000000111'), ('01a1998e-4400-7062-8062-000000000112'),
    ('01a1998e-4400-7062-8062-000000000113'), ('01a1998e-4400-7062-8062-000000000114'), ('01a1998e-4400-7062-8062-000000000115'), ('01a1998e-4400-7062-8062-000000000116'),
    ('01a1998e-4400-7062-8062-000000000117'), ('01a1998e-4400-7062-8062-000000000118'), ('01a1998e-4400-7062-8062-000000000119'), ('01a1998e-4400-7062-8062-000000000120'),
    ('01a1998e-4400-7062-8062-000000000121'), ('01a1998e-4400-7062-8062-000000000122'), ('01a1998e-4400-7062-8062-000000000123'), ('01a1998e-4400-7062-8062-000000000124'),
    ('01a1998e-4400-7062-8062-000000000125'), ('01a1998e-4400-7062-8062-000000000126'), ('01a1998e-4400-7062-8062-000000000127'), ('01a1998e-4400-7062-8062-000000000128'),
    ('01a1998e-4400-7062-8062-000000000129'), ('01a1998e-4400-7062-8062-000000000130'), ('01a1998e-4400-7062-8062-000000000131'), ('01a1998e-4400-7062-8062-000000000132'),
    ('01a1998e-4400-7062-8062-000000000133'), ('01a1998e-4400-7062-8062-000000000134'), ('01a1998e-4400-7062-8062-000000000135'), ('01a1998e-4400-7062-8062-000000000136'),
    ('01a1998e-4400-7062-8062-000000000137'), ('01a1998e-4400-7062-8062-000000000138'), ('01a1998e-4400-7062-8062-000000000139'), ('01a1998e-4400-7062-8062-000000000140'),
    ('01a1998e-4400-7062-8062-000000000141'), ('01a1998e-4400-7062-8062-000000000142'), ('01a1998e-4400-7062-8062-000000000143'), ('01a1998e-4400-7062-8062-000000000144'),
    ('01a1998e-4400-7062-8062-000000000145'), ('01a1998e-4400-7062-8062-000000000146'), ('01a1998e-4400-7062-8062-000000000147'), ('01a1998e-4400-7062-8062-000000000148'),
    ('01a1998e-4400-7062-8062-000000000149'), ('01a1998e-4400-7062-8062-000000000150'), ('01a1998e-4400-7062-8062-000000000151'), ('01a1998e-4400-7062-8062-000000000152'),
    ('01a1998e-4400-7062-8062-000000000153'), ('01a1998e-4400-7062-8062-000000000154'), ('01a1998e-4400-7062-8062-000000000155'), ('01a1998e-4400-7062-8062-000000000156'),
    ('01a1998e-4400-7062-8062-000000000157'), ('01a1998e-4400-7062-8062-000000000158'), ('01a1998e-4400-7062-8062-000000000159'), ('01a1998e-4400-7062-8062-000000000160'),
    ('01a1998e-4400-7062-8062-000000000161'), ('01a1998e-4400-7062-8062-000000000162'), ('01a1998e-4400-7062-8062-000000000163'), ('01a1998e-4400-7062-8062-000000000164');

  SELECT count(*) INTO n_cols FROM pg_temp.rb_0062;
  IF n_cols <> 164 THEN
    RAISE EXCEPTION 'Rollback 0062 refused: the id list holds % entries, expected 164. This file has been edited.', n_cols;
  END IF;

  -- 3. Migration 0062 must actually be applied: all 164 ids present.
  SELECT count(*) INTO n_batch
    FROM pif.categories c JOIN pg_temp.rb_0062 r ON r.id = c.id;
  IF n_batch = 0 THEN
    RAISE EXCEPTION
      'Rollback 0062 refused: none of the 164 imported ids are present in pif.categories, so 0062 appears not to be applied. Before concluding that, check current_user and whether a SET ROLE is in force.';
  END IF;
  IF n_batch <> 164 THEN
    RAISE EXCEPTION
      'Rollback 0062 refused: % of the 164 imported ids are present, not all of them. Something has already removed part of the batch; resolve that by hand rather than letting this script guess.',
      n_batch;
  END IF;

  -- 4. Every row carrying a business_slug must belong to this batch. If an
  --    administrator has added a category since 0062, STOP: it is not ours
  --    to delete, and deleting its parent would break it.
  SELECT count(*) INTO n_foreign
    FROM pif.categories c
   WHERE c.business_slug IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_temp.rb_0062 r WHERE r.id = c.id);
  IF n_foreign <> 0 THEN
    RAISE EXCEPTION
      'Rollback 0062 refused: % categories carry a business_slug but are NOT part of the 0062 batch -- they were created after the import. This rollback deletes only its own 164 ids and will not orphan or remove anybody else''s rows. Remove or repoint those % rows deliberately first.',
      n_foreign, n_foreign;
  END IF;

  -- 5. No product may be filed under one of the 164. 0062 filed none, so a
  --    non-zero count here means real catalogue work has happened since.
  SELECT count(*) INTO n_bad
    FROM pif.products p JOIN pg_temp.rb_0062 r ON r.id = p.category_id;
  IF n_bad <> 0 THEN
    RAISE EXCEPTION
      'Rollback 0062 refused: % products are filed under categories this rollback would delete. Recategorise them first. Removing their category would either fail on pif_products_category_fk or strand the products.',
      n_bad;
  END IF;

  -- 6. The 14 legacy rows must all be there, and the records 0062 promised
  --    not to touch must still read as they did.
  SELECT count(*) INTO n_legacy      FROM pif.categories WHERE business_slug IS NULL;
  SELECT count(*) INTO n_products    FROM pif.products;
  SELECT count(*) INTO n_orders      FROM pif.orders;
  SELECT count(*) INTO n_order_items FROM pif.order_items;
  IF n_legacy <> 14 THEN
    RAISE EXCEPTION
      'Rollback 0062 refused: % legacy categories present, expected 14. The pre-import baseline is not intact; investigate before rolling back.', n_legacy;
  END IF;
  IF n_products <> 21 OR n_orders <> 8 OR n_order_items <> 13 THEN
    RAISE EXCEPTION
      'Rollback 0062 refused: products/orders/order_items read % / % / %, expected the 21 / 8 / 13 baseline. Investigate before rolling back.',
      n_products, n_orders, n_order_items;
  END IF;

  -- 7. Fingerprint the legacy rows so their survival is proved afterwards.
  SELECT md5(string_agg(
           coalesce(id::text,'~') || '|' || coalesce(name,'~') || '|' ||
           coalesce(parent_id::text,'~') || '|' || active::text || '|' ||
           coalesce(description,'~') || '|' || coalesce(image_ref,'~') || '|' ||
           sort_order::text || '|' || coalesce(created_by::text,'~') || '|' ||
           coalesce(updated_by::text,'~') || '|' || coalesce(business_slug,'~') || '|' ||
           coalesce(slug,'~') || '|' || coalesce(approved_image_ref,'~'),
           E'\n' ORDER BY id))
    INTO fp_before
    FROM pif.categories
   WHERE business_slug IS NULL;

  -- =========================================================================
  -- DELETE 1 of 2: the 143 subcategories. Children before parents.
  -- =========================================================================
  DELETE FROM pif.categories c
   USING pg_temp.rb_0062 r
   WHERE c.id = r.id
     AND c.parent_id IS NOT NULL;

  GET DIAGNOSTICS n_deleted = ROW_COUNT;
  IF n_deleted <> 143 THEN
    RAISE EXCEPTION 'Rollback 0062 refused: deleted % subcategories, expected 143.', n_deleted;
  END IF;

  -- =========================================================================
  -- DELETE 2 of 2: the 21 main categories, now childless.
  -- =========================================================================
  DELETE FROM pif.categories c
   USING pg_temp.rb_0062 r
   WHERE c.id = r.id
     AND c.parent_id IS NULL;

  GET DIAGNOSTICS n_deleted = ROW_COUNT;
  IF n_deleted <> 21 THEN
    RAISE EXCEPTION 'Rollback 0062 refused: deleted % main categories, expected 21.', n_deleted;
  END IF;

  -- =========================================================================
  -- POST-ROLLBACK ASSERTIONS.
  -- =========================================================================

  -- 1. Back to exactly the 14 legacy rows, unchanged in every column.
  SELECT count(*) INTO n_cats     FROM pif.categories;
  SELECT count(*) INTO n_legacy   FROM pif.categories WHERE business_slug IS NULL;
  SELECT count(*) INTO n_business FROM pif.categories WHERE business_slug IS NOT NULL;
  IF n_cats <> 14 OR n_legacy <> 14 OR n_business <> 0 THEN
    RAISE EXCEPTION
      'Rollback 0062 failed: pif.categories holds % rows (% legacy, % still carrying a business_slug), expected 14 / 14 / 0.',
      n_cats, n_legacy, n_business;
  END IF;

  SELECT md5(string_agg(
           coalesce(id::text,'~') || '|' || coalesce(name,'~') || '|' ||
           coalesce(parent_id::text,'~') || '|' || active::text || '|' ||
           coalesce(description,'~') || '|' || coalesce(image_ref,'~') || '|' ||
           sort_order::text || '|' || coalesce(created_by::text,'~') || '|' ||
           coalesce(updated_by::text,'~') || '|' || coalesce(business_slug,'~') || '|' ||
           coalesce(slug,'~') || '|' || coalesce(approved_image_ref,'~'),
           E'\n' ORDER BY id))
    INTO fp_after
    FROM pif.categories
   WHERE business_slug IS NULL;
  IF fp_after IS DISTINCT FROM fp_before THEN
    RAISE EXCEPTION
      'Rollback 0062 failed: the 14 legacy category rows changed. Fingerprint was %, is now %. This rollback must delete only its own 164 rows.',
      fp_before, fp_after;
  END IF;

  -- 2. None of the 164 ids survive.
  SELECT count(*) INTO n_batch
    FROM pif.categories c JOIN pg_temp.rb_0062 r ON r.id = c.id;
  IF n_batch <> 0 THEN
    RAISE EXCEPTION 'Rollback 0062 failed: % of the 164 imported ids are still present.', n_batch;
  END IF;

  -- 3. The records this rollback promised not to touch.
  SELECT count(*) INTO n_products    FROM pif.products;
  SELECT count(*) INTO n_orders      FROM pif.orders;
  SELECT count(*) INTO n_order_items FROM pif.order_items;
  IF n_products <> 21 OR n_orders <> 8 OR n_order_items <> 13 THEN
    RAISE EXCEPTION
      'Rollback 0062 failed: products/orders/order_items are now % / % / %, expected 21 / 8 / 13.',
      n_products, n_orders, n_order_items;
  END IF;

  -- 4. The schema contract. This rollback drops no table, view or column:
  --    the three columns from 0061 stay, and only 0061''s own rollback
  --    removes them.
  SELECT count(*) INTO n_tables FROM information_schema.tables
   WHERE table_type = 'BASE TABLE' AND table_schema IN ('shared', 'rik', 'pif');
  SELECT count(*) INTO n_views  FROM information_schema.views
   WHERE table_schema IN ('shared', 'rik', 'pif');
  IF n_tables <> 70 OR n_views <> 5 THEN
    RAISE EXCEPTION
      'Rollback 0062 failed: schema contract is now % tables / % views, expected 70 / 5.', n_tables, n_views;
  END IF;

  SELECT count(*) INTO n_cols
    FROM information_schema.columns
   WHERE table_schema = 'pif' AND table_name = 'categories';
  IF n_cols <> 14 THEN
    RAISE EXCEPTION
      'Rollback 0062 failed: pif.categories has % columns, expected 14. This rollback removes rows, never columns -- 0061''s rollback is what removes business_slug, slug and approved_image_ref.',
      n_cols;
  END IF;

  RAISE NOTICE 'Rollback 0062 complete: 164 imported categories removed (143 subcategories, then 21 main categories).';
  RAISE NOTICE '  pif.categories: back to 14 legacy rows, unchanged (fingerprint %).', fp_after;
  RAISE NOTICE '  Untouched as asserted: 21 products, 8 orders, 13 order items, 70 tables, 5 views, 14 columns.';
  RAISE NOTICE '  Migration 0061 remains applied. Its three columns are still present, as intended.';
END
$rollback$;

-- ===========================================================================
-- VERIFICATION. Committed reads, no psql meta-commands.
-- ===========================================================================

-- 1. Expect 14 / 14 / 0 / 0.
SELECT (SELECT count(*) FROM pif.categories)                                 AS categories_total,
       (SELECT count(*) FROM pif.categories WHERE business_slug IS NULL)     AS legacy_remaining,
       (SELECT count(*) FROM pif.categories WHERE business_slug IS NOT NULL) AS still_imported,
       (SELECT count(*) FROM pif.categories
         WHERE id BETWEEN '01a1998e-4400-7062-8062-000000000001'::uuid
                      AND '01a1998e-4400-7062-8062-000000000164'::uuid)      AS batch_rows_left;

-- 2. Expect 21 / 8 / 13 / 70 / 5 / 14 -- nothing else changed.
SELECT (SELECT count(*) FROM pif.products)                                          AS products,
       (SELECT count(*) FROM pif.orders)                                            AS orders,
       (SELECT count(*) FROM pif.order_items)                                       AS order_items,
       (SELECT count(*) FROM information_schema.tables
         WHERE table_type = 'BASE TABLE' AND table_schema IN ('shared','rik','pif')) AS tables,
       (SELECT count(*) FROM information_schema.views
         WHERE table_schema IN ('shared','rik','pif'))                              AS views,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'pif' AND table_name = 'categories')                   AS category_columns;

-- 3. The 14 legacy categories as they stand.
SELECT id, name, parent_id, active, sort_order, image_ref
  FROM pif.categories
 ORDER BY parent_id NULLS FIRST, name;
