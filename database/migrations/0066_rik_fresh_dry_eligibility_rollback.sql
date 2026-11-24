-- ===================================================================
--  e-SAMAGRI — MIGRATION 0066 ROLLBACK
--  Undo: officer-wise FRESH and DRY eligible days
--
--  Run this in pgAdmin against:  esamagri_staging
--  Forward script:               0066_rik_fresh_dry_eligibility_pgadmin.sql
--
--  WHAT THIS UNDOES
--    Drops rik.customer_period_ration_eligibility and its two triggers,
--    removes the ration_type column from the two audit tables, and restores
--    rik.trg_apply_eligibility_adjustment() to its pre-0066 body.
--
--  WHAT IT CANNOT UNDO — READ THIS BEFORE RUNNING
--    Every FRESH and DRY eligible-days figure published since the migration.
--    Those figures live only in the table this script drops. Their AUDIT TRAIL
--    survives in rik.eligibility_adjustments (that table is append-only and
--    nothing here deletes a row from it), so what was published and by whom
--    remains on record — but the current figures themselves are gone and the
--    Admin Portal will report both types as "not uploaded" again.
--
--    Step 0 below COUNTS what would be lost and REFUSES to continue if there
--    is anything, unless you deliberately override it. That is the one
--    decision this script will not make for you.
--
--  WHAT IT NEVER TOUCHES
--    rik.customer_period_eligibility. The forward migration did not alter it,
--    so there is nothing here to restore: not a column, not a constraint, not
--    a trigger, not a row. The entitlement engine is unaffected in both
--    directions.
-- ===================================================================

BEGIN;

-- -------------------------------------------------------------------
-- 0. WHERE AM I, AND WHAT WOULD BE LOST?
-- -------------------------------------------------------------------
DO $$
DECLARE
  n_figures integer;
  n_audit   integer;
  -- ===============================================================
  --  SET THIS TO true ONLY IF YOU HAVE DECIDED TO DISCARD THE
  --  PUBLISHED FRESH AND DRY FIGURES COUNTED BELOW.
  -- ===============================================================
  discard_published_figures boolean := false;
BEGIN
  IF current_database() <> 'esamagri_staging' THEN
    RAISE EXCEPTION
      'Rollback 0066 refused: this is database %, not esamagri_staging.',
      current_database();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'rik' AND table_name = 'customer_period_ration_eligibility'
  ) THEN
    RAISE EXCEPTION
      'Rollback 0066 refused: rik.customer_period_ration_eligibility does not exist. Migration 0066 is not applied, so there is nothing to roll back.';
  END IF;

  SELECT count(*) INTO n_figures FROM rik.customer_period_ration_eligibility;
  SELECT count(*) INTO n_audit
    FROM rik.eligibility_adjustments WHERE ration_type IS NOT NULL;

  RAISE NOTICE 'Rollback 0066: % published fresh/dry figure(s) would be DELETED.', n_figures;
  RAISE NOTICE 'Rollback 0066: % audit row(s) record changes to them and will be KEPT.', n_audit;

  IF n_figures > 0 AND NOT discard_published_figures THEN
    RAISE EXCEPTION
      'Rollback 0066 refused: % fresh/dry figure(s) have been published and would be permanently lost. If you have decided to discard them, set discard_published_figures := true at the top of this DO block and run it again. Their history in rik.eligibility_adjustments is kept either way.',
      n_figures;
  END IF;

  IF n_figures = 0 THEN
    RAISE NOTICE 'Rollback 0066: nothing has been published yet, so nothing is lost.';
  END IF;

  -- Baseline, so step 3 can prove the legacy table was not disturbed.
  SELECT count(*) INTO n_figures FROM rik.customer_period_eligibility;
  PERFORM set_config('esamagri.r0066_legacy_rows', n_figures::text, true);
  SELECT coalesce(sum(eligible_days), 0) INTO n_figures FROM rik.customer_period_eligibility;
  PERFORM set_config('esamagri.r0066_legacy_sum', n_figures::text, true);
END $$;

-- -------------------------------------------------------------------
-- 1. RESTORE THE APPLY TRIGGER to its pre-0066 body.
-- -------------------------------------------------------------------
-- This is the body migration 0045 installed, reproduced exactly. It is
-- restored BEFORE the new table is dropped, so that at no point does the
-- function reference a table that no longer exists.
CREATE OR REPLACE FUNCTION rik.trg_apply_eligibility_adjustment() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  current_days integer;
BEGIN
  SELECT eligible_days INTO current_days
    FROM rik.customer_period_eligibility
   WHERE customer_id = NEW.customer_id AND period_id = NEW.period_id;

  -- The stated previous value must be the real one. Without this an
  -- adjustment could record a fiction — "18 to 20" against a row that
  -- actually held 15 — and the history would read plausibly and be wrong.
  IF coalesce(current_days, 0) <> NEW.previous_eligible_days THEN
    RAISE EXCEPTION
      'Eligible days have moved since this adjustment was prepared: the record now holds %, the adjustment claims %.',
      coalesce(current_days, 0), NEW.previous_eligible_days
      USING ERRCODE = 'serialization_failure';
  END IF;

  -- Transaction-local, so the protection trigger below can tell this write
  -- apart from any other. `true` scopes it to the transaction: it cannot leak
  -- into a later request on the same pooled connection.
  PERFORM set_config('rik.in_eligibility_adjustment', 'on', true);

  INSERT INTO rik.customer_period_eligibility
    (customer_id, period_id, eligible_days, notes, created_by, updated_by)
  VALUES
    (NEW.customer_id, NEW.period_id, NEW.new_eligible_days, NEW.reason, NEW.staff_id, NEW.staff_id)
  ON CONFLICT (customer_id, period_id) DO UPDATE
    SET eligible_days = NEW.new_eligible_days,
        notes         = NEW.reason,
        updated_by    = NEW.staff_id,
        updated_at    = now();

  PERFORM set_config('rik.in_eligibility_adjustment', 'off', true);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION rik.trg_apply_eligibility_adjustment() IS NULL;

-- -------------------------------------------------------------------
-- 2. DROP WHAT 0066 ADDED.
-- -------------------------------------------------------------------
-- The table's own triggers go with it. The protection FUNCTION is dropped
-- separately because a function is not owned by the table it guards.
DROP TABLE rik.customer_period_ration_eligibility;

DROP FUNCTION rik.trg_protect_ration_eligibility_value();

-- The audit columns. Dropping a column discards the FRESH/DRY labels on
-- adjustment rows but keeps every row: the figures those rows moved no longer
-- exist, so the label has nothing left to point at.
ALTER TABLE rik.eligibility_adjustments
  DROP CONSTRAINT rik_elig_adj_ration_type_chk,
  DROP COLUMN ration_type;

ALTER TABLE rik.eligibility_import_batches
  DROP CONSTRAINT rik_elig_batches_ration_type_chk,
  DROP COLUMN ration_type;

-- -------------------------------------------------------------------
-- 3. POSTCONDITIONS.
-- -------------------------------------------------------------------
DO $$
DECLARE
  n           integer;
  before_rows integer := nullif(current_setting('esamagri.r0066_legacy_rows', true), '')::integer;
  before_sum  integer := nullif(current_setting('esamagri.r0066_legacy_sum',  true), '')::integer;
  def         text;
BEGIN
  IF before_rows IS NULL OR before_sum IS NULL THEN
    RAISE EXCEPTION
      'Rollback 0066 failed: the step-0 baseline was not recorded, so the legacy table cannot be proved unchanged. Roll back this transaction and run the whole script again.';
  END IF;

  -- 3a. Everything 0066 added is gone.
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'rik' AND table_name = 'customer_period_ration_eligibility'
  ) THEN
    RAISE EXCEPTION 'Rollback 0066 failed: the new table still exists.';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'trg_protect_ration_eligibility_value') THEN
    RAISE EXCEPTION 'Rollback 0066 failed: rik.trg_protect_ration_eligibility_value() still exists.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'rik'
       AND table_name IN ('eligibility_adjustments', 'eligibility_import_batches')
       AND column_name = 'ration_type'
  ) THEN
    RAISE EXCEPTION 'Rollback 0066 failed: a ration_type column still exists.';
  END IF;

  -- 3b. The apply trigger is back to the legacy body and names only the
  --     legacy table.
  SELECT pg_get_functiondef('rik.trg_apply_eligibility_adjustment'::regproc) INTO def;
  IF def LIKE '%customer_period_ration_eligibility%' THEN
    RAISE EXCEPTION 'Rollback 0066 failed: the apply trigger still references the dropped table.';
  END IF;
  IF def NOT LIKE '%customer_period_eligibility%' THEN
    RAISE EXCEPTION 'Rollback 0066 failed: the apply trigger no longer writes the legacy table.';
  END IF;

  -- 3c. THE LEGACY TABLE WAS NOT DISTURBED, in this direction either.
  SELECT count(*) INTO n FROM rik.customer_period_eligibility;
  IF n <> before_rows THEN
    RAISE EXCEPTION 'Rollback 0066 failed: rik.customer_period_eligibility went from % row(s) to %.', before_rows, n;
  END IF;

  SELECT coalesce(sum(eligible_days), 0) INTO n FROM rik.customer_period_eligibility;
  IF n <> before_sum THEN
    RAISE EXCEPTION 'Rollback 0066 failed: sum(eligible_days) went from % to %.', before_sum, n;
  END IF;

  SELECT count(*) INTO n
    FROM pg_trigger
   WHERE tgrelid = 'rik.customer_period_eligibility'::regclass AND NOT tgisinternal;
  IF n <> 2 THEN
    RAISE EXCEPTION 'Rollback 0066 failed: the legacy table should have 2 triggers, it has %.', n;
  END IF;

  -- 3d. The audit table is still append-only and still holds its rows.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'rik.eligibility_adjustments'::regclass
       AND tgname = 'eligibility_adjustment_immutable'
  ) THEN
    RAISE EXCEPTION 'Rollback 0066 failed: the append-only guard on eligibility_adjustments is missing.';
  END IF;

  RAISE NOTICE 'ROLLBACK 0066 COMPLETE. Legacy eligibility unchanged: % row(s), sum %.', before_rows, before_sum;
END $$;

COMMIT;

-- ===================================================================
--  AFTER ROLLING BACK, the application code must be restored too, or the
--  Admin Portal will query a table that no longer exists:
--
--    Restore the ten files from
--      C:\esamagri\backups\fresh-dry-option1-2026-11-12-1903Z\
--    and delete the five files that feature added (listed in that folder's
--    MANIFEST-sha256.txt).
-- ===================================================================
