-- ===========================================================================
--  0063 ROLLBACK  Remove PIF category soft deletion
-- ===========================================================================
--
--  WHAT THIS IS. The exact reverse of 0063: it restores
--  pif_categories_identity_uq to the non-partial form migration 0061 created,
--  then drops pif.categories.deleted_at. It writes no row either.
--
--  IT REFUSES TO RUN IF ANY CATEGORY IS SOFT-DELETED, and that is the whole
--  point of the first precondition. Dropping the column would silently
--  destroy the only record of which categories had been soft-deleted and
--  when -- an irreversible data loss disguised as a rollback. If you mean to
--  undo the soft deletion, run the recovery script FIRST (it sets deleted_at
--  back to NULL on exactly the affected rows), confirm 0 soft-deleted
--  categories, and only then run this file.
--
--  IT ALSO REFUSES IF RESTORING THE NON-PARTIAL INDEX WOULD FAIL. While the
--  index is partial, two rows may legitimately share an identity as long as
--  one of them is soft-deleted. Once the WHERE clause goes, that pair
--  collides. The second precondition looks for such a pair and names it
--  rather than letting CREATE UNIQUE INDEX fail halfway.
--
--  ORDER MATTERS. The index must be rebuilt BEFORE the column is dropped,
--  because the partial index depends on deleted_at: dropping the column
--  first would take the index with it and leave the table with no identity
--  constraint at all for the rest of the statement.
--
--  RIK IS NOT TOUCHED. Every object named here is in schema `pif`.
--
--  NO BEGIN, NO COMMIT, NO SET ROLE -- for the reasons recorded in 0061 and
--  in the forward file.
--
--  HOW TO RUN IT, if rollback is required:
--
--    "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres ^
--      -d esamagri_staging -v ON_ERROR_STOP=1 ^
--      -f 0063_pif_category_soft_delete_rollback.sql
-- ===========================================================================

DO $$
DECLARE
  v_soft_deleted integer;
  v_clashes      integer;
  v_clash_name   text;
  v_cols         integer;
  v_total        integer;
  v_tables       integer;
  v_views        integer;
BEGIN
  -- =====================================================================
  -- 1. PRECONDITIONS.
  -- =====================================================================

  IF to_regclass('pif.categories') IS NULL THEN
    RAISE EXCEPTION '0063 rollback: pif.categories does not exist - wrong database?';
  END IF;

  SELECT count(*) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'pif' AND table_name = 'categories';
  IF v_cols = 0 THEN
    RAISE EXCEPTION
      '0063 rollback: information_schema shows 0 columns on pif.categories - that is a privilege problem, not an empty table. Connect as postgres and do not SET ROLE.';
  END IF;

  SELECT count(*) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'pif' AND table_name = 'categories' AND column_name = 'deleted_at';
  IF v_cols = 0 THEN
    RAISE NOTICE '0063 rollback: deleted_at is already absent - nothing to undo';
    RETURN;
  END IF;

  -- (a) Nothing may be soft-deleted. See the header.
  SELECT count(*) INTO v_soft_deleted
    FROM pif.categories WHERE deleted_at IS NOT NULL;
  IF v_soft_deleted <> 0 THEN
    RAISE EXCEPTION
      '0063 rollback: % categories are soft-deleted. Dropping deleted_at would destroy the record of which ones. Run the recovery script first, confirm 0 soft-deleted categories, then re-run this file. - ABORTING',
      v_soft_deleted;
  END IF;

  -- (b) The non-partial index must be creatable.
  SELECT count(*), min(name) INTO v_clashes, v_clash_name
    FROM (
      SELECT min(name) AS name
        FROM pif.categories
       GROUP BY business_slug, parent_id, lower(name)
      HAVING count(*) > 1
    ) AS dupes;
  IF v_clashes > 0 THEN
    RAISE EXCEPTION
      '0063 rollback: % identity collision(s) exist (e.g. "%"). The non-partial unique index cannot be restored until they are resolved. - ABORTING',
      v_clashes, v_clash_name;
  END IF;

  SELECT count(*) INTO v_total FROM pif.categories;

  RAISE NOTICE '0063 rollback: preconditions passed. % categories, 0 soft-deleted.', v_total;

  -- =====================================================================
  -- 2. RESTORE THE 0061 INDEX (before dropping the column it depends on).
  -- =====================================================================

  DROP INDEX IF EXISTS pif.pif_categories_identity_uq;

  CREATE UNIQUE INDEX pif_categories_identity_uq
    ON pif.categories (business_slug, parent_id, lower(name))
    NULLS NOT DISTINCT;

  -- =====================================================================
  -- 3. DROP THE COLUMN.
  -- =====================================================================

  ALTER TABLE pif.categories
    DROP COLUMN IF EXISTS deleted_at;

  -- =====================================================================
  -- 4. POSTCONDITIONS.
  -- =====================================================================

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'pif' AND table_name = 'categories'
                AND column_name = 'deleted_at') THEN
    RAISE EXCEPTION '0063 rollback: deleted_at is still present';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname = 'pif' AND indexname = 'pif_categories_identity_uq') THEN
    RAISE EXCEPTION '0063 rollback: pif_categories_identity_uq was not restored';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes
              WHERE schemaname = 'pif' AND indexname = 'pif_categories_identity_uq'
                AND indexdef LIKE '%WHERE%') THEN
    RAISE EXCEPTION '0063 rollback: pif_categories_identity_uq is still partial';
  END IF;

  IF (SELECT count(*) FROM pif.categories) <> v_total THEN
    RAISE EXCEPTION '0063 rollback: category count changed - ABORTING';
  END IF;

  SELECT count(*) INTO v_tables
    FROM information_schema.tables
   WHERE table_schema IN ('shared', 'rik', 'pif') AND table_type = 'BASE TABLE';
  SELECT count(*) INTO v_views
    FROM information_schema.views
   WHERE table_schema IN ('shared', 'rik', 'pif');
  IF v_tables <> 70 OR v_views <> 5 THEN
    RAISE EXCEPTION '0063 rollback: schema contract moved - % tables, % views', v_tables, v_views;
  END IF;

  RAISE NOTICE '0063 rollback: complete. deleted_at dropped, 0061 index restored, 0 rows written.';
END;
$$;

-- ---------------------------------------------------------------------------
--  COMMITTED VERIFICATION.
-- ---------------------------------------------------------------------------

SELECT count(*) AS deleted_at_columns_remaining
  FROM information_schema.columns
 WHERE table_schema = 'pif' AND table_name = 'categories' AND column_name = 'deleted_at';
-- expect: 0

SELECT indexname, indexdef
  FROM pg_indexes
 WHERE schemaname = 'pif' AND indexname = 'pif_categories_identity_uq';
-- expect: no WHERE clause in indexdef

SELECT count(*) AS categories_total FROM pif.categories;
-- expect: 178
