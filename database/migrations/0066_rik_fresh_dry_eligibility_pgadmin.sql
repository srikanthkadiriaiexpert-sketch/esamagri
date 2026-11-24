-- ===================================================================
--  e-SAMAGRI — MIGRATION 0066
--  Officer-wise FRESH and DRY eligible days
--
--  Run this in pgAdmin against:  esamagri_staging
--  Rollback script:              0066_rik_fresh_dry_eligibility_rollback.sql
--
--  WHAT THIS MIGRATION DOES
--    Creates ONE new table, rik.customer_period_ration_eligibility, holding
--    one row per officer per entitlement period per ration type, and teaches
--    the existing eligibility-adjustment trigger to write it.
--
--  WHAT THIS MIGRATION DOES NOT DO — AND THIS IS THE POINT
--    It does not touch rik.customer_period_eligibility. Not one column, not
--    one constraint, not the unique key, not either of its triggers, and not
--    one row of its data. That table keeps driving the entitlement engine
--    exactly as it does today, because the engine was explicitly excluded
--    from this work.
--
--    It changes NO entitlement calculation, pool, scale, conversion, ratio,
--    pack rule, provision, issue window, voucher, lapse or carry-forward
--    object. It writes no eligibility value. It is additive throughout.
--
--  WHY A SEPARATE TABLE RATHER THAN TWO COLUMNS
--    The engine reads eligibility with one query that selects
--    customer_period_eligibility.eligible_days and takes the first row.
--      * Ration type as ROWS on that table would make it return two rows and
--        pick one arbitrarily.
--      * Ration type as COLUMNS would work for reading, but publishing a
--        Fresh figure for an officer with no legacy row means INSERTING one,
--        and eligible_days is NOT NULL with no DEFAULT — so the insert would
--        have had to invent a legacy figure of 0, which the engine then reads.
--        In this database 2 of 3 officers have no legacy row, so that case is
--        the normal one, not an edge.
--    A table of its own has no legacy column to satisfy, so neither problem
--    arises and the engine's input is untouched by construction.
--
--  TRANSACTIONAL. One BEGIN/COMMIT. Every step checks its own precondition
--  and raises rather than continuing on a surprise.
-- ===================================================================

BEGIN;

-- -------------------------------------------------------------------
-- 0. WHERE AM I? Refuse to run anywhere but the intended database.
-- -------------------------------------------------------------------
DO $$
BEGIN
  IF current_database() <> 'esamagri_staging' THEN
    RAISE EXCEPTION
      'Migration 0066 refused: this is database %, not esamagri_staging.',
      current_database();
  END IF;
  RAISE NOTICE 'Migration 0066 starting on % as %', current_database(), current_user;
END $$;

-- -------------------------------------------------------------------
-- 1. PRECONDITIONS.
-- -------------------------------------------------------------------
DO $$
DECLARE
  n integer;
BEGIN
  -- 1a. Not already applied.
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'rik' AND table_name = 'customer_period_ration_eligibility'
  ) THEN
    RAISE EXCEPTION
      'Migration 0066 refused: rik.customer_period_ration_eligibility already exists. This migration has already been applied.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'rik' AND table_name = 'eligibility_adjustments'
       AND column_name = 'ration_type'
  ) THEN
    RAISE EXCEPTION
      'Migration 0066 refused: rik.eligibility_adjustments.ration_type already exists. This migration has already been applied, or applied in part.';
  END IF;

  -- 1b. The objects this migration depends on are all present.
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'shared.uuid_generate_v7'::regproc) THEN
    RAISE EXCEPTION 'Migration 0066 refused: shared.uuid_generate_v7() not found.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = 'shared.assert_customer_exists(uuid)'::regprocedure
  ) THEN
    RAISE EXCEPTION 'Migration 0066 refused: shared.assert_customer_exists(uuid) not found.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'rik.trg_apply_eligibility_adjustment'::regproc) THEN
    RAISE EXCEPTION 'Migration 0066 refused: rik.trg_apply_eligibility_adjustment() not found.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'rik.trg_validate_customer_ref'::regproc) THEN
    RAISE EXCEPTION 'Migration 0066 refused: rik.trg_validate_customer_ref() not found.';
  END IF;

  -- 1c. RECORD THE LEGACY TABLE'S STATE so step 4 can prove it did not move.
  SELECT count(*) INTO n FROM rik.customer_period_eligibility;
  RAISE NOTICE 'Before: rik.customer_period_eligibility holds % row(s).', n;
  PERFORM set_config('esamagri.m0066_legacy_rows', n::text, true);

  SELECT coalesce(sum(eligible_days), 0) INTO n FROM rik.customer_period_eligibility;
  RAISE NOTICE 'Before: sum(eligible_days) = %.', n;
  PERFORM set_config('esamagri.m0066_legacy_sum', n::text, true);
END $$;

-- -------------------------------------------------------------------
-- 2. THE NEW TABLE.
-- -------------------------------------------------------------------
CREATE TABLE rik.customer_period_ration_eligibility (
    id            uuid        DEFAULT shared.uuid_generate_v7() NOT NULL,
    customer_id   uuid        NOT NULL,
    period_id     uuid        NOT NULL,
    ration_type   text        NOT NULL,
    eligible_days integer     NOT NULL,
    notes         text,
    created_at    timestamptz DEFAULT now() NOT NULL,
    updated_at    timestamptz DEFAULT now() NOT NULL,
    created_by    uuid,
    updated_by    uuid,

    CONSTRAINT rik_cpre_pk PRIMARY KEY (id),

    -- One figure per officer per period per type. This is what makes a Fresh
    -- upload incapable of touching the Dry figure: they are different rows.
    CONSTRAINT rik_cpre_uq UNIQUE (customer_id, period_id, ration_type),

    CONSTRAINT rik_cpre_ration_type_chk
      CHECK (ration_type IN ('FRESH', 'DRY')),

    -- THE FACILITY'S APPROVED MAXIMUMS, in the one place that binds every
    -- writer including psql: Fresh 30 days, Dry 60. The application checks
    -- them too, so that a mistake is reported in the preview with the limit
    -- named rather than surfacing here as a raw constraint violation.
    CONSTRAINT rik_cpre_caps_chk
      CHECK (
        (ration_type = 'FRESH' AND eligible_days BETWEEN 0 AND 30)
        OR
        (ration_type = 'DRY'   AND eligible_days BETWEEN 0 AND 60)
      ),

    CONSTRAINT rik_cpre_notes_chk
      CHECK (notes IS NULL OR btrim(notes) <> ''),

    CONSTRAINT rik_cpre_period_fk
      FOREIGN KEY (period_id) REFERENCES rik.entitlement_periods(id)
);

ALTER TABLE rik.customer_period_ration_eligibility OWNER TO postgres;

COMMENT ON TABLE rik.customer_period_ration_eligibility IS
  'Migration 0066. Officer-wise FRESH and DRY eligible days: one row per customer, period and ration type. Supplied by RIK staff from the facility''s spreadsheets; never inferred from a calendar, an issue window or the other ration type. STORED AND DISPLAYED ONLY at this stage - the entitlement engine still calculates from rik.customer_period_eligibility.eligible_days, which this migration does not touch. A missing row means the facility has not published that figure, which is NOT the same as nought days and must never be shown as such.';

COMMENT ON COLUMN rik.customer_period_ration_eligibility.eligible_days IS
  'The facility''s figure for this ration type. Changed only by inserting a rik.eligibility_adjustments row carrying the same ration_type; a direct UPDATE is refused by rik_cpre_protect_value.';

-- There is no FOREIGN KEY to shared.customers here, deliberately: the legacy
-- eligibility table has none either, and validates the reference with the
-- trigger attached in step 2b. Using the same mechanism keeps one rule rather
-- than two, and respects whatever reason that choice was made for.
CREATE INDEX rik_cpre_period_type_idx
    ON rik.customer_period_ration_eligibility (period_id, ration_type);

CREATE INDEX rik_cpre_customer_idx
    ON rik.customer_period_ration_eligibility (customer_id);

-- -------------------------------------------------------------------
-- 2a. GRANTS — mirroring the legacy eligibility table exactly.
-- -------------------------------------------------------------------
DO $$
BEGIN
  -- esamagri_demo_app is the role the application connects as in staging and
  -- holds ALL on rik.customer_period_eligibility. The new table gets the same,
  -- so the adjustment path works as it does today. Direct writes are stopped
  -- by the trigger in step 2c, not by withholding the privilege - the same
  -- arrangement the legacy table uses.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'esamagri_demo_app') THEN
    GRANT ALL ON TABLE rik.customer_period_ration_eligibility TO esamagri_demo_app;
    RAISE NOTICE 'Granted ALL to esamagri_demo_app.';
  ELSE
    RAISE NOTICE 'Role esamagri_demo_app not present; no grant made to it.';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rik') THEN
    GRANT SELECT, INSERT, UPDATE ON TABLE rik.customer_period_ration_eligibility TO app_rik;
    RAISE NOTICE 'Granted SELECT, INSERT, UPDATE to app_rik.';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_reporting_rik' ) THEN
    GRANT SELECT ON TABLE rik.customer_period_ration_eligibility TO app_reporting_rik;
    RAISE NOTICE 'Granted SELECT to app_reporting_rik.';
  END IF;
END $$;

-- -------------------------------------------------------------------
-- 2b. CUSTOMER REFERENCE VALIDATION — reusing the existing function.
-- -------------------------------------------------------------------
-- rik.trg_validate_customer_ref() reads only NEW.customer_id, so it is
-- generic. Attaching the SAME function rather than writing a second one means
-- there is one definition of "a valid customer reference" and it cannot drift.
CREATE TRIGGER validate_customer_ref
  BEFORE INSERT OR UPDATE ON rik.customer_period_ration_eligibility
  FOR EACH ROW EXECUTE FUNCTION rik.trg_validate_customer_ref();

-- -------------------------------------------------------------------
-- 2c. THE VALUE IS PROTECTED, exactly as the legacy figure is.
-- -------------------------------------------------------------------
-- Mirrors rik.trg_protect_eligibility_value(): a Fresh or Dry figure moves
-- only through an audited adjustment row. Without this the new figures would
-- be directly writable and therefore LESS protected than the legacy one,
-- which would be a regression in protection rather than a new feature.
--
-- One deliberate difference: this guards INSERT as well as UPDATE. The legacy
-- trigger guards UPDATE only, which leaves a direct INSERT of a first value
-- unaudited. There is no reason to reproduce that on a new table, and the
-- apply trigger sets the transaction-local flag before its upsert, so the
-- sanctioned path passes either way.
CREATE FUNCTION rik.trg_protect_ration_eligibility_value() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.eligible_days IS NOT DISTINCT FROM OLD.eligible_days THEN
    RETURN NEW; -- not a change to the value; some other column moved
  END IF;

  IF coalesce(current_setting('rik.in_eligibility_adjustment', true), 'off') <> 'on' THEN
    RAISE EXCEPTION
      '% eligible days cannot be changed directly (customer %, period %). Insert a rik.eligibility_adjustments row carrying the same ration_type: the previous value, the delta, a reason and the staff member are part of the change, not a note beside it.',
      NEW.ration_type, NEW.customer_id, NEW.period_id
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION rik.trg_protect_ration_eligibility_value() OWNER TO postgres;

COMMENT ON FUNCTION rik.trg_protect_ration_eligibility_value() IS
  'Migration 0066. Refuses any direct write of a FRESH or DRY eligible-days value. The only sanctioned path is an insert into rik.eligibility_adjustments, whose trigger sets rik.in_eligibility_adjustment for the transaction. Binds every role including the owner.';

CREATE TRIGGER rik_cpre_protect_value
  BEFORE INSERT OR UPDATE OF eligible_days ON rik.customer_period_ration_eligibility
  FOR EACH ROW EXECUTE FUNCTION rik.trg_protect_ration_eligibility_value();

-- -------------------------------------------------------------------
-- 3. THE AUDIT CHAIN LEARNS THE RATION TYPE.
-- -------------------------------------------------------------------
-- NULLABLE, on purpose. NULL means "this adjustment moved the legacy
-- eligible_days column", which is what every row written before 0066 means
-- and what a legacy adjustment would still mean. So no backfill is needed and
-- no existing row changes meaning.
ALTER TABLE rik.eligibility_adjustments
  ADD COLUMN ration_type text;

ALTER TABLE rik.eligibility_adjustments
  ADD CONSTRAINT rik_elig_adj_ration_type_chk
    CHECK (ration_type IS NULL OR ration_type IN ('FRESH', 'DRY'));

COMMENT ON COLUMN rik.eligibility_adjustments.ration_type IS
  'Migration 0066. FRESH or DRY names the figure in rik.customer_period_ration_eligibility that this entry moved. NULL means the legacy rik.customer_period_eligibility.eligible_days, which is how every pre-0066 row reads.';

ALTER TABLE rik.eligibility_import_batches
  ADD COLUMN ration_type text;

ALTER TABLE rik.eligibility_import_batches
  ADD CONSTRAINT rik_elig_batches_ration_type_chk
    CHECK (ration_type IS NULL OR ration_type IN ('FRESH', 'DRY'));

COMMENT ON COLUMN rik.eligibility_import_batches.ration_type IS
  'Migration 0066. Which figure this upload applies to, chosen by the administrator on screen because the spreadsheet carries no such column - the same reason the period is chosen there. NULL on a pre-0066 batch.';

-- -------------------------------------------------------------------
-- 3a. THE APPLY TRIGGER GAINS A BRANCH. The legacy path is byte-identical.
-- -------------------------------------------------------------------
-- The ONLY change to an existing database function in this migration.
--
-- Read the two halves against each other: when NEW.ration_type IS NULL the
-- statements executed are exactly those of the pre-0066 function, in the same
-- order, with the same guard and the same messages. Nothing about the legacy
-- column's behaviour is altered. The ELSE branch is new and touches only the
-- new table.
CREATE OR REPLACE FUNCTION rik.trg_apply_eligibility_adjustment() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  current_days integer;
BEGIN
  IF NEW.ration_type IS NULL THEN
    -- ============ LEGACY PATH — UNCHANGED FROM MIGRATION 0045 ============
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

    -- Transaction-local, so the protection trigger can tell this write apart
    -- from any other. `true` scopes it to the transaction: it cannot leak into
    -- a later request on the same pooled connection.
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
  END IF;

  -- ============ FRESH / DRY PATH — NEW IN MIGRATION 0066 ============
  -- The same shape, against the new table, keyed additionally by ration type.
  SELECT eligible_days INTO current_days
    FROM rik.customer_period_ration_eligibility
   WHERE customer_id = NEW.customer_id
     AND period_id   = NEW.period_id
     AND ration_type = NEW.ration_type;

  -- Same guard, same reason: an adjustment prepared against a figure that has
  -- since moved must fail rather than overwrite someone else's correction.
  -- An officer with no row yet reads as 0, which is how the import computes
  -- its delta — note that this is the ABSENCE of a published figure, and the
  -- officer-facing read reports it as such rather than as nought days.
  IF coalesce(current_days, 0) <> NEW.previous_eligible_days THEN
    RAISE EXCEPTION
      '% eligible days have moved since this adjustment was prepared: the record now holds %, the adjustment claims %.',
      NEW.ration_type, coalesce(current_days, 0), NEW.previous_eligible_days
      USING ERRCODE = 'serialization_failure';
  END IF;

  PERFORM set_config('rik.in_eligibility_adjustment', 'on', true);

  INSERT INTO rik.customer_period_ration_eligibility
    (customer_id, period_id, ration_type, eligible_days, notes, created_by, updated_by)
  VALUES
    (NEW.customer_id, NEW.period_id, NEW.ration_type, NEW.new_eligible_days,
     NEW.reason, NEW.staff_id, NEW.staff_id)
  ON CONFLICT (customer_id, period_id, ration_type) DO UPDATE
    SET eligible_days = NEW.new_eligible_days,
        notes         = NEW.reason,
        updated_by    = NEW.staff_id,
        updated_at    = now();

  PERFORM set_config('rik.in_eligibility_adjustment', 'off', true);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION rik.trg_apply_eligibility_adjustment() IS
  'Applies an eligibility adjustment. ration_type NULL writes the legacy rik.customer_period_eligibility.eligible_days with exactly the behaviour migration 0045 gave it; FRESH or DRY writes rik.customer_period_ration_eligibility (migration 0066). Refuses a stale previous value either way.';

-- -------------------------------------------------------------------
-- 4. POSTCONDITIONS. Prove what was built, and prove what did not move.
-- -------------------------------------------------------------------
DO $$
DECLARE
  n           integer;
  before_rows integer := nullif(current_setting('esamagri.m0066_legacy_rows', true), '')::integer;
  before_sum  integer := nullif(current_setting('esamagri.m0066_legacy_sum',  true), '')::integer;
  def         text;
BEGIN
  -- A missing baseline would make every comparison below NULL, and a NULL
  -- condition does not raise — so the checks would pass by vacuity. Refuse
  -- instead: an unverifiable migration is a failed one.
  IF before_rows IS NULL OR before_sum IS NULL THEN
    RAISE EXCEPTION
      'Migration 0066 failed: the step-1 baseline of the legacy table was not recorded, so step 4 cannot prove it is unchanged. Roll back and re-run the whole script in one transaction.';
  END IF;

  -- 4a. The new table and its constraints exist.
  SELECT count(*) INTO n
    FROM pg_constraint
   WHERE conrelid = 'rik.customer_period_ration_eligibility'::regclass
     AND conname IN ('rik_cpre_pk','rik_cpre_uq','rik_cpre_ration_type_chk',
                     'rik_cpre_caps_chk','rik_cpre_notes_chk','rik_cpre_period_fk');
  IF n <> 6 THEN
    RAISE EXCEPTION 'Migration 0066 failed: expected 6 named constraints on the new table, found %.', n;
  END IF;

  SELECT count(*) INTO n
    FROM pg_trigger
   WHERE tgrelid = 'rik.customer_period_ration_eligibility'::regclass
     AND NOT tgisinternal;
  IF n <> 2 THEN
    RAISE EXCEPTION 'Migration 0066 failed: expected 2 triggers on the new table, found %.', n;
  END IF;

  -- 4b. The new table is EMPTY. This migration publishes no figure for anyone.
  SELECT count(*) INTO n FROM rik.customer_period_ration_eligibility;
  IF n <> 0 THEN
    RAISE EXCEPTION 'Migration 0066 failed: the new table should be empty, it holds % row(s).', n;
  END IF;

  -- 4c. THE LEGACY TABLE DID NOT MOVE. Not its shape, not its rows, not its
  --     values. This is the assertion the whole design exists to make true.
  SELECT count(*) INTO n FROM rik.customer_period_eligibility;
  IF n <> before_rows THEN
    RAISE EXCEPTION 'Migration 0066 failed: rik.customer_period_eligibility went from % row(s) to %.', before_rows, n;
  END IF;

  SELECT coalesce(sum(eligible_days), 0) INTO n FROM rik.customer_period_eligibility;
  IF n <> before_sum THEN
    RAISE EXCEPTION 'Migration 0066 failed: sum(eligible_days) went from % to %.', before_sum, n;
  END IF;

  SELECT count(*) INTO n
    FROM information_schema.columns
   WHERE table_schema = 'rik' AND table_name = 'customer_period_eligibility';
  IF n <> 9 THEN
    RAISE EXCEPTION 'Migration 0066 failed: rik.customer_period_eligibility should still have 9 columns, it has %.', n;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'rik' AND table_name = 'customer_period_eligibility'
       AND column_name = 'eligible_days' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'Migration 0066 failed: customer_period_eligibility.eligible_days is no longer NOT NULL.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'rik.customer_period_eligibility'::regclass
       AND conname = 'rik_customer_period_eligibility_uq'
  ) THEN
    RAISE EXCEPTION 'Migration 0066 failed: the legacy unique key is missing.';
  END IF;

  SELECT count(*) INTO n
    FROM pg_trigger
   WHERE tgrelid = 'rik.customer_period_eligibility'::regclass
     AND NOT tgisinternal;
  IF n <> 2 THEN
    RAISE EXCEPTION 'Migration 0066 failed: the legacy table should still have exactly 2 triggers, it has %.', n;
  END IF;

  -- 4d. The audit chain carries the type, and its append-only guard survived.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'rik' AND table_name = 'eligibility_adjustments'
       AND column_name = 'ration_type' AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'Migration 0066 failed: eligibility_adjustments.ration_type missing or not nullable.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'rik.eligibility_adjustments'::regclass
       AND tgname = 'eligibility_adjustment_immutable'
  ) THEN
    RAISE EXCEPTION 'Migration 0066 failed: the append-only guard on eligibility_adjustments is missing.';
  END IF;

  -- 4e. The apply trigger knows both paths.
  SELECT pg_get_functiondef('rik.trg_apply_eligibility_adjustment'::regproc) INTO def;
  IF def NOT LIKE '%customer_period_ration_eligibility%'
     OR def NOT LIKE '%customer_period_eligibility%' THEN
    RAISE EXCEPTION 'Migration 0066 failed: the apply trigger does not reference both tables.';
  END IF;

  RAISE NOTICE 'MIGRATION 0066 APPLIED. New table created and empty. Legacy eligibility unchanged: % row(s), sum %. No eligibility value was written.',
    before_rows, before_sum;
END $$;

COMMIT;

-- ===================================================================
--  AFTER COMMITTING, these read-only checks should all hold.
--  Run them and keep the output with the migration record.
-- ===================================================================
-- SELECT count(*) AS new_table_rows FROM rik.customer_period_ration_eligibility;         -- expect 0
-- SELECT count(*) AS legacy_rows,
--        coalesce(sum(eligible_days),0) AS legacy_sum
--   FROM rik.customer_period_eligibility;                                                -- expect unchanged
-- SELECT column_name, is_nullable, column_default
--   FROM information_schema.columns
--  WHERE table_schema='rik' AND table_name='customer_period_eligibility'
--  ORDER BY ordinal_position;                                                            -- expect 9 columns, unchanged
-- SELECT conname FROM pg_constraint
--  WHERE conrelid='rik.customer_period_ration_eligibility'::regclass ORDER BY conname;
-- SELECT tgname FROM pg_trigger
--  WHERE tgrelid='rik.customer_period_ration_eligibility'::regclass AND NOT tgisinternal
--  ORDER BY tgname;
