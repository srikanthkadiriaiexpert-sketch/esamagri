-- ===========================================================================
--  0063  PIF category soft deletion
-- ===========================================================================
--
--  WHAT THIS IS. One nullable column on pif.categories, and the rebuild of
--  one existing unique index so that a soft-deleted name stops blocking a
--  new one. It writes NO ROW. Not one category, product, order or RIK record
--  is updated, and the postconditions prove it with a fingerprint taken
--  before the first ALTER and compared after the last one.
--
--  WHY A COLUMN AND NOT `active`. pif.products has carried `deleted_at
--  timestamptz` since migration 0011 and every read path in apps/api already
--  honours `deleted_at IS NULL`. pif.categories never got the same column,
--  so until now the only marker available for a category was `active`, which
--  means something else entirely: a deactivated category is one the facility
--  has taken off the shelf and intends to switch back on, which is exactly
--  why the Admin Portal is written to keep showing it. Soft deletion and
--  deactivation are two different states and they need two different
--  columns. This migration gives categories the column products already had.
--
--  WHY NULLABLE WITH NO DEFAULT. NULL means "not deleted", the same meaning
--  it carries on pif.products. Every one of the 178 existing categories
--  therefore reads as not deleted the instant the column appears, which is
--  the correct starting state and the reason this file can add the column
--  without touching a single row.
--
--  WHY THE IDENTITY INDEX IS REBUILT (section 3). Migration 0061 created
--
--    pif_categories_identity_uq ON (business_slug, parent_id, lower(name))
--      NULLS NOT DISTINCT
--
--  Without a `WHERE deleted_at IS NULL` clause, a soft-deleted category goes
--  on reserving its name for ever. Eight of the fourteen legacy names about
--  to be soft-deleted are ordinary words a facility would plausibly type
--  again -- Dairy, Beverages, Household, Rice, Staples, Pulses, Grains,
--  Cooking Oil -- and insertCategory() does not write business_slug, so a
--  new top-level "Dairy" would carry exactly the same (NULL, NULL, 'dairy')
--  key as the soft-deleted one and be refused. Making the index partial is
--  what turns "soft-deleted" into "really gone, as far as new records are
--  concerned" while the row itself stays in place for restoration. It alters
--  no id, no relationship and no name.
--
--  IF YOU DO NOT WANT THE INDEX REBUILD, delete section 3 and the two
--  postconditions that mention pif_categories_identity_uq. The column on its
--  own is still valid and the soft delete still works; only name reuse stays
--  blocked. Nothing else in this file depends on section 3.
--
--  THE SCHEMA CONTRACT DOES NOT MOVE. No table and no view is added, so the
--  count stays 70 / 5 and apps/api/src/database/schema-contract.ts needs no
--  edit -- that file counts tables and views and states explicitly that
--  columns are not counted. The postconditions re-assert 70 / 5.
--
--  RIK IS NOT TOUCHED. Not a table, not a trigger, not a function, not a
--  privilege, not a row. Every object this file names is in schema `pif`.
--
--  NO BEGIN AND NO COMMIT, DELIBERATELY. Migration 0059 was correct SQL that
--  reported success from inside a transaction whose COMMIT never reached the
--  server, and rolled back after the notice had printed. One DO block under
--  autocommit is its own transaction: it commits when it completes and there
--  is nothing trailing to lose. The SELECTs after the block read COMMITTED
--  rows -- they are the evidence, not the RAISE NOTICE.
--
--  NO `SET ROLE`, for the reason recorded at length in 0061: pif.categories
--  and pif.products are owned by `postgres` in this database, ALTER TABLE
--  requires ownership, and as esamagri_owner the information_schema
--  preconditions silently see zero columns. This file matches 0057-0062 and
--  runs as the connecting superuser.
--
--  HOW TO RUN IT, when approved:
--
--    "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres ^
--      -d esamagri_staging -v ON_ERROR_STOP=1 ^
--      -f 0063_pif_category_soft_delete_pgadmin.sql
--
--  Then re-run the verification SELECTs in a FRESH psql session. A migration
--  is not applied until a new connection can see its effects.
--
--  THIS FILE DOES NOT SOFT-DELETE ANYTHING. It only makes soft deletion
--  possible. The 14 categories and 21 products are soft-deleted by the
--  separate data script, which refuses to run until this migration is in.
-- ===========================================================================

DO $$
DECLARE
  v_fingerprint_before text;
  v_fingerprint_after  text;
  v_tables             integer;
  v_views              integer;
  v_cols               integer;
  v_approved           integer;
  v_freshmart          integer;
  v_grocers            integer;
  v_legacy             integer;
  v_total              integer;
  v_nullable           text;
  v_type               text;
BEGIN
  -- =====================================================================
  -- 1. PRECONDITIONS. Nothing is altered until every one of these holds.
  -- =====================================================================

  IF to_regclass('pif.categories') IS NULL THEN
    RAISE EXCEPTION '0063: pif.categories does not exist - wrong database?';
  END IF;
  IF to_regclass('pif.products') IS NULL THEN
    RAISE EXCEPTION '0063: pif.products does not exist - wrong database?';
  END IF;

  -- The column must not already be there. Re-running this file is safe
  -- (ADD COLUMN IF NOT EXISTS below), but we want to know which case we are in.
  SELECT count(*) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'pif' AND table_name = 'categories' AND column_name = 'deleted_at';
  IF v_cols > 0 THEN
    RAISE NOTICE '0063: pif.categories.deleted_at already present - this is a re-run';
  END IF;

  -- information_schema is privilege-filtered. A zero here means a privilege
  -- problem, not an empty table, so refuse rather than draw a wrong conclusion.
  SELECT count(*) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'pif' AND table_name = 'categories';
  IF v_cols = 0 THEN
    RAISE EXCEPTION
      '0063: information_schema shows 0 columns on pif.categories - this means the current role has no privilege on it, not that it is empty. Connect as postgres and do not SET ROLE.';
  END IF;

  -- The data this migration must leave exactly as it found it.
  SELECT count(*) INTO v_total     FROM pif.categories;
  SELECT count(*) INTO v_approved  FROM pif.categories WHERE business_slug IS NOT NULL;
  SELECT count(*) INTO v_freshmart FROM pif.categories WHERE business_slug = 'fresh-mart';
  SELECT count(*) INTO v_grocers   FROM pif.categories WHERE business_slug = 'grocers';
  SELECT count(*) INTO v_legacy    FROM pif.categories
   WHERE business_slug IS NULL AND created_by IS NULL;

  IF v_total <> 178 THEN
    RAISE EXCEPTION '0063: expected 178 categories, found % - ABORTING', v_total;
  END IF;
  IF v_approved <> 164 THEN
    RAISE EXCEPTION '0063: expected 164 approved categories, found % - ABORTING', v_approved;
  END IF;
  IF v_freshmart <> 10 THEN
    RAISE EXCEPTION '0063: expected 10 Fresh Mart categories, found % - ABORTING', v_freshmart;
  END IF;
  IF v_grocers <> 154 THEN
    RAISE EXCEPTION '0063: expected 154 Grocers categories, found % - ABORTING', v_grocers;
  END IF;
  IF v_legacy <> 14 THEN
    RAISE EXCEPTION '0063: expected 14 legacy categories, found % - ABORTING', v_legacy;
  END IF;

  -- Migration 0061 must be in, because section 3 rebuilds the index it created.
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname = 'pif' AND indexname = 'pif_categories_identity_uq') THEN
    RAISE EXCEPTION '0063: pif_categories_identity_uq not found - migration 0061 is not applied';
  END IF;

  -- A fingerprint of every category's identity, taken BEFORE the first ALTER.
  -- id::text keeps it order-stable without needing min(uuid), which
  -- PostgreSQL does not have.
  SELECT md5(string_agg(
           id::text || '|' || name || '|' || coalesce(parent_id::text, '-') || '|' ||
           coalesce(business_slug, '-') || '|' || active::text || '|' || sort_order::text,
           E'\n' ORDER BY id::text))
    INTO v_fingerprint_before
    FROM pif.categories;

  RAISE NOTICE '0063: preconditions passed. 178 categories, fingerprint %', v_fingerprint_before;

  -- =====================================================================
  -- 2. THE COLUMN.
  -- =====================================================================

  ALTER TABLE pif.categories
    ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

  COMMENT ON COLUMN pif.categories.deleted_at IS
    'Soft deletion. NULL means not deleted, exactly as on pif.products. Distinct from `active`, which means "temporarily off the shelf" and is deliberately still visible in the Admin Portal. Restore by setting this back to NULL; see 0063_pif_category_soft_delete_rollback.sql.';

  -- =====================================================================
  -- 3. REBUILD pif_categories_identity_uq AS PARTIAL.
  --
  --    See the header. Delete this whole section if you do not want it;
  --    the column above works without it.
  -- =====================================================================

  DROP INDEX IF EXISTS pif.pif_categories_identity_uq;

  CREATE UNIQUE INDEX pif_categories_identity_uq
    ON pif.categories (business_slug, parent_id, lower(name))
    NULLS NOT DISTINCT
    WHERE deleted_at IS NULL;

  -- =====================================================================
  -- 4. POSTCONDITIONS.
  -- =====================================================================

  SELECT data_type, is_nullable
    INTO v_type, v_nullable
    FROM information_schema.columns
   WHERE table_schema = 'pif' AND table_name = 'categories' AND column_name = 'deleted_at';

  IF v_type IS NULL THEN
    RAISE EXCEPTION '0063: deleted_at was not added';
  END IF;
  IF v_type <> 'timestamp with time zone' THEN
    RAISE EXCEPTION '0063: deleted_at has type %, expected timestamp with time zone', v_type;
  END IF;
  IF v_nullable <> 'YES' THEN
    RAISE EXCEPTION '0063: deleted_at must be nullable, is_nullable = %', v_nullable;
  END IF;

  -- NO ROW MAY HAVE BEEN SOFT-DELETED BY THIS FILE.
  --
  -- This also means 0063 must NOT be re-run after the soft-delete data script
  -- has run: it would find 14 rows here and abort. That is safe -- the whole DO
  -- block rolls back and nothing is changed -- but the message says so plainly
  -- rather than looking like a fault.
  IF (SELECT count(*) FROM pif.categories WHERE deleted_at IS NOT NULL) <> 0 THEN
    RAISE EXCEPTION
      '0063 refused: % categories already have deleted_at set, so this file is being re-run after the soft-delete data script. 0063 writes no row and will not run in that state. NOTHING HAS BEEN CHANGED - the whole block rolled back.',
      (SELECT count(*) FROM pif.categories WHERE deleted_at IS NOT NULL);
  END IF;

  -- NO ROW MAY HAVE CHANGED AT ALL.
  SELECT md5(string_agg(
           id::text || '|' || name || '|' || coalesce(parent_id::text, '-') || '|' ||
           coalesce(business_slug, '-') || '|' || active::text || '|' || sort_order::text,
           E'\n' ORDER BY id::text))
    INTO v_fingerprint_after
    FROM pif.categories;

  IF v_fingerprint_after <> v_fingerprint_before THEN
    RAISE EXCEPTION '0063: category data changed (% -> %) - ABORTING',
      v_fingerprint_before, v_fingerprint_after;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname = 'pif' AND indexname = 'pif_categories_identity_uq') THEN
    RAISE EXCEPTION '0063: pif_categories_identity_uq is missing after the rebuild';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname = 'pif' AND indexname = 'pif_categories_identity_uq'
                    AND indexdef LIKE '%deleted_at IS NULL%') THEN
    RAISE EXCEPTION '0063: pif_categories_identity_uq was rebuilt without the partial clause';
  END IF;

  -- The schema contract: 70 base tables, 5 views, unchanged.
  SELECT count(*) INTO v_tables
    FROM information_schema.tables
   WHERE table_schema IN ('shared', 'rik', 'pif') AND table_type = 'BASE TABLE';
  SELECT count(*) INTO v_views
    FROM information_schema.views
   WHERE table_schema IN ('shared', 'rik', 'pif');

  IF v_tables <> 70 THEN
    RAISE EXCEPTION '0063: expected 70 base tables, found %', v_tables;
  END IF;
  IF v_views <> 5 THEN
    RAISE EXCEPTION '0063: expected 5 views, found %', v_views;
  END IF;

  RAISE NOTICE '0063: applied. deleted_at added, identity index now partial, 0 rows written.';
END;
$$;

-- ---------------------------------------------------------------------------
--  COMMITTED VERIFICATION. These read rows the DO block has committed.
-- ---------------------------------------------------------------------------

SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'pif' AND table_name = 'categories' AND column_name = 'deleted_at';
-- expect: deleted_at | timestamp with time zone | YES | (null)

SELECT count(*) AS categories_total,
       count(*) FILTER (WHERE deleted_at IS NULL)     AS not_deleted,
       count(*) FILTER (WHERE deleted_at IS NOT NULL) AS soft_deleted
  FROM pif.categories;
-- expect: 178 | 178 | 0

SELECT coalesce(business_slug, '(legacy)') AS shop,
       count(*) FILTER (WHERE parent_id IS NULL)     AS mains,
       count(*) FILTER (WHERE parent_id IS NOT NULL) AS subs,
       count(*)                                      AS total,
       count(*) FILTER (WHERE active)                AS active
  FROM pif.categories
 GROUP BY coalesce(business_slug, '(legacy)')
 ORDER BY 1;
-- expect: (legacy) 9/5/14 | fresh-mart 2/8/10 | grocers 19/135/154

SELECT indexname, indexdef
  FROM pg_indexes
 WHERE schemaname = 'pif' AND indexname = 'pif_categories_identity_uq';
-- expect the definition to end with: WHERE (deleted_at IS NULL)

SELECT (SELECT count(*) FROM information_schema.tables
         WHERE table_schema IN ('shared','rik','pif') AND table_type = 'BASE TABLE') AS tables,
       (SELECT count(*) FROM information_schema.views
         WHERE table_schema IN ('shared','rik','pif')) AS views;
-- expect: 70 | 5
