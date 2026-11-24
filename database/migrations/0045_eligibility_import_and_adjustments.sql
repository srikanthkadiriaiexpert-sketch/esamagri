-- ---------------------------------------------------------------------------
-- 0045_eligibility_import_and_adjustments.sql
--
-- STEP 15B PHASE B — make an officer's eligible days auditable, and give the
-- facility's weekly eligibility Excel a tracked, reviewable path into the
-- system.
--
-- RECONSTRUCTED, 8 October 2026. The original 0045 was lost with the working
-- container (see RECOVERY-REPORT.md). It is rebuilt from the approved Phase B
-- report together with the six surviving edit fragments of the original file,
-- which supplied several sections verbatim — the ledger's constraint block,
-- both reference-validation triggers, the grant/revoke block and part of the
-- verification block. Everything else is a reconstruction from the report,
-- NOT the recovered original bytes.
--
-- THE PROBLEM THIS SOLVES
--
-- rik.customer_period_eligibility is a CURRENT-VALUE table: one integer per
-- (customer, period). An UPDATE overwrites it and the previous value is gone.
-- Its only free-text field is `notes`, nullable and likewise overwritten, and
-- `created_by`/`updated_by` are bare uuids with no FK and no validation. The
-- question the facility has to be able to answer —
--
--     "who changed A. Singh's eligible days from 18 to 20, when, why, and
--      through which import?"
--
-- cannot be answered by that table at all. Nor can it be answered by an audit
-- log alone: a log OBSERVES a change, it cannot PREVENT an unexplained one.
--
-- HOW THE INVARIANT IS ENFORCED, AND WHY THIS WAY ROUND
--
-- Control is INVERTED. The application does not update eligibility and then
-- write a history row beside it, hoping both happen. It inserts an ADJUSTMENT,
-- and a trigger on that append-only table applies the value:
--
--     INSERT rik.eligibility_adjustments
--             |
--             +-- trg_apply_eligibility_adjustment (AFTER INSERT)
--                     * checks previous_eligible_days against reality
--                     * upserts rik.customer_period_eligibility
--
--     UPDATE rik.customer_period_eligibility (eligible_days)
--             |
--             +-- trg_protect_eligibility_value (BEFORE UPDATE OF)
--                     * refused unless it came from the trigger above
--
-- So there is exactly one way an existing eligible-day value can change, and
-- it leaves a row stating the previous value, the delta, the new value, a
-- non-blank reason, the staff member and the moment. Not by convention — by
-- construction.
--
-- WHY THE PROTECTION IS "BEFORE UPDATE OF eligible_days" AND NOT ALSO INSERT
--
-- Deliberate, and required. Seven existing integration suites insert
-- eligibility fixtures directly with raw SQL, and they are legitimate: a first
-- insert has no previous value to lose, so there is no history for it to
-- destroy. Guarding INSERT would have broken all seven for no gain. The
-- application's own first write still goes through an adjustment (the trigger
-- upserts), so the audit trail is complete for every change the application
-- makes, while a fixture that seeds a starting value remains possible.
--
-- WHY THE LEDGER CARRIES NO FOREIGN KEYS
--
-- rik.eligibility_adjustments is a HISTORY table, and it is modelled on the
-- one this project already has: shared.audit_log holds actor_id and entity_id
-- as bare uuids, with no foreign key, precisely so a recorded fact outlives
-- the rows it refers to. An append-only table with RESTRICT foreign keys is a
-- contradiction — the referenced row can never be removed, and nothing can
-- remove the reference either, so the keys do not protect history, they
-- freeze everything that history ever touched.
--
-- Integrity is not given up for that. It moves to WRITE time, where it
-- belongs and where it is in fact STRICTER than a foreign key would be:
-- validate_adjustment_refs (below) refuses an insert whose period, staff
-- member or import row does not exist, and the existing
-- rik.trg_validate_customer_ref refuses one whose customer is not a live
-- customer — something a foreign key cannot check at all. So a dangling
-- reference can never be WRITTEN; what can happen, years later, is that an
-- operational row the ledger refers to is removed and the ledger keeps its
-- account of what happened. That is the correct behaviour for a ledger.
--
-- WHAT THIS MIGRATION DOES NOT DO
--
--   * it does not touch the entitlement engine, or any pool, scale,
--     conversion or provision — all four counts are verified unchanged;
--   * it does not touch rik.entitlement_selections, its items, its elections
--     or any rule_snapshot. A confirmed selection carries its OWN frozen
--     eligible_days and is served from its snapshot, so changing the
--     operational value cannot reach it. That is asserted in the test suite
--     rather than assumed here;
--   * it adds no inventory, no stock, no purchasing and nothing in pif.
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP on

SET ROLE esamagri_owner;

-- ---------------------------------------------------------------------------
-- 1. Batch reference numbers
--
-- A third identifier namespace, deliberately unmistakable from the other two:
--   RIK-O-######   an officer          (migration 0044)
--   RIK-######     a confirmation      (migration 0029)
--   ELIG-YYYY-###### an eligibility import batch
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'S' AND n.nspname = 'rik' AND c.relname = 'eligibility_import_seq'
  ) THEN
    CREATE SEQUENCE rik.eligibility_import_seq AS bigint START WITH 1 INCREMENT BY 1 NO CYCLE;
  END IF;
END;
$$;

-- Six digits minimum, widening beyond six. Same lesson as 0044: a fixed-width
-- numeric template overflows to '######' and lpad() truncates, so neither is
-- used here either.
CREATE OR REPLACE FUNCTION rik.format_import_batch_ref(n bigint, yr integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT 'ELIG-' || yr::text || '-' ||
         CASE WHEN n < 1000000 THEN lpad(n::text, 6, '0') ELSE n::text END;
$$;

COMMENT ON FUNCTION rik.format_import_batch_ref(bigint, integer) IS
  'STEP 15B Phase B: renders an eligibility import batch reference as ELIG-YYYY-###### — six digits minimum, widening rather than overflowing.';

-- ---------------------------------------------------------------------------
-- 2. The batch header
--
-- One row per upload. A SECOND upload for the same period is a second batch,
-- never an overwrite: the period is not unique here on purpose, so the
-- facility can re-import a corrected sheet and both attempts stay on record
-- with their own references, counts and decisions.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rik.eligibility_import_batches (
  id                uuid        NOT NULL DEFAULT shared.uuid_generate_v7(),
  batch_ref         text        NOT NULL,
  period_id         uuid        NOT NULL,
  file_name         text        NOT NULL,
  /** sha256 of the uploaded bytes, so an identical re-upload is recognisable. */
  file_hash         text        NOT NULL,
  file_size_bytes   bigint      NOT NULL,
  status            text        NOT NULL DEFAULT 'PENDING_REVIEW',
  total_rows        integer     NOT NULL DEFAULT 0,
  matched_changed   integer     NOT NULL DEFAULT 0,
  matched_no_change integer     NOT NULL DEFAULT 0,
  exception_rows    integer     NOT NULL DEFAULT 0,
  applied_rows      integer     NOT NULL DEFAULT 0,
  uploaded_by       uuid        NOT NULL,
  uploaded_at       timestamptz NOT NULL DEFAULT now(),
  decided_by        uuid,
  decided_at        timestamptz,
  CONSTRAINT rik_elig_batches_pk PRIMARY KEY (id),
  CONSTRAINT rik_elig_batches_ref_uq UNIQUE (batch_ref),
  CONSTRAINT rik_elig_batches_period_fk FOREIGN KEY (period_id)
    REFERENCES rik.entitlement_periods (id),
  CONSTRAINT rik_elig_batches_uploaded_by_fk FOREIGN KEY (uploaded_by) REFERENCES shared.users (id),
  CONSTRAINT rik_elig_batches_decided_by_fk  FOREIGN KEY (decided_by)  REFERENCES shared.users (id),
  CONSTRAINT rik_elig_batches_status_chk CHECK (
    status IN ('PENDING_REVIEW', 'APPLIED', 'DISCARDED')
  ),
  CONSTRAINT rik_elig_batches_counts_chk CHECK (
    total_rows >= 0 AND matched_changed >= 0 AND matched_no_change >= 0
    AND exception_rows >= 0 AND applied_rows >= 0
    AND total_rows = matched_changed + matched_no_change + exception_rows
    AND applied_rows <= matched_changed
  ),
  CONSTRAINT rik_elig_batches_file_chk CHECK (
    btrim(file_name) <> '' AND btrim(file_hash) <> '' AND file_size_bytes > 0
  ),
  -- A decided batch names who decided and when; a pending one names neither.
  CONSTRAINT rik_elig_batches_decision_chk CHECK (
    (status = 'PENDING_REVIEW' AND decided_by IS NULL AND decided_at IS NULL)
    OR (status <> 'PENDING_REVIEW' AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
  ),
  -- Only an applied batch can have applied anything.
  CONSTRAINT rik_elig_batches_applied_chk CHECK (status = 'APPLIED' OR applied_rows = 0)
);

CREATE INDEX IF NOT EXISTS rik_elig_batches_period_idx ON rik.eligibility_import_batches (period_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS rik_elig_batches_status_idx ON rik.eligibility_import_batches (status);

-- ---------------------------------------------------------------------------
-- 3. The rows — what the sheet said, beside what the system made of it
--
-- Both are kept. An exception is only reviewable months later if the raw
-- values are still there: "the sheet said 7.5" is actionable, "invalid
-- number" is not.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rik.eligibility_import_rows (
  id                     uuid    NOT NULL DEFAULT shared.uuid_generate_v7(),
  batch_id               uuid    NOT NULL,
  /** 1-based row number in the sheet, so a reviewer can find it. */
  sheet_row              integer NOT NULL,
  raw_name               text    NOT NULL,
  raw_mobile             text    NOT NULL,
  raw_eligible_days      text    NOT NULL,
  normalised_mobile      text,
  matched_customer_id    uuid,
  matched_rik_id         text,
  system_name            text,
  system_official_name   text,
  previous_eligible_days integer,
  imported_eligible_days integer,
  delta                  integer,
  outcome                text    NOT NULL,
  exception_reason       text,
  CONSTRAINT rik_elig_rows_pk PRIMARY KEY (id),
  CONSTRAINT rik_elig_rows_batch_fk FOREIGN KEY (batch_id)
    REFERENCES rik.eligibility_import_batches (id) ON DELETE CASCADE,
  CONSTRAINT rik_elig_rows_customer_fk FOREIGN KEY (matched_customer_id)
    REFERENCES shared.customers (id),
  CONSTRAINT rik_elig_rows_sheet_row_uq UNIQUE (batch_id, sheet_row),
  CONSTRAINT rik_elig_rows_sheet_row_chk CHECK (sheet_row > 0),
  CONSTRAINT rik_elig_rows_outcome_chk CHECK (
    outcome IN (
      'MATCHED_CHANGED',
      'MATCHED_NO_CHANGE',
      'UNMATCHED_MOBILE_NOT_FOUND',
      'NAME_MISMATCH',
      'DUPLICATE_IN_FILE',
      'INVALID_MOBILE',
      'INVALID_ELIGIBLE_DAYS',
      'MISSING_FIELD'
    )
  ),
  -- A matched row carries the whole resolved picture, or it is not matched.
  CONSTRAINT rik_elig_rows_matched_chk CHECK (
    outcome NOT IN ('MATCHED_CHANGED', 'MATCHED_NO_CHANGE')
    OR (matched_customer_id IS NOT NULL AND matched_rik_id IS NOT NULL
        AND imported_eligible_days IS NOT NULL AND previous_eligible_days IS NOT NULL
        AND delta IS NOT NULL)
  ),
  CONSTRAINT rik_elig_rows_exception_chk CHECK (
    outcome IN ('MATCHED_CHANGED', 'MATCHED_NO_CHANGE')
    OR (exception_reason IS NOT NULL AND btrim(exception_reason) <> '')
  ),
  -- MATCHED_NO_CHANGE means exactly that.
  CONSTRAINT rik_elig_rows_no_change_chk CHECK (outcome <> 'MATCHED_NO_CHANGE' OR delta = 0)
);

CREATE INDEX IF NOT EXISTS rik_elig_rows_batch_idx   ON rik.eligibility_import_rows (batch_id, sheet_row);
CREATE INDEX IF NOT EXISTS rik_elig_rows_outcome_idx ON rik.eligibility_import_rows (batch_id, outcome);
CREATE INDEX IF NOT EXISTS rik_elig_rows_customer_idx ON rik.eligibility_import_rows (matched_customer_id);

-- ---------------------------------------------------------------------------
-- 4. The adjustment ledger — append-only, and the only way a value changes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rik.eligibility_adjustments (
  id                     uuid        NOT NULL DEFAULT shared.uuid_generate_v7(),
  customer_id            uuid        NOT NULL,
  period_id              uuid        NOT NULL,
  previous_eligible_days integer     NOT NULL,
  delta                  integer     NOT NULL,
  new_eligible_days      integer     NOT NULL,
  reason                 text        NOT NULL,
  source                 text        NOT NULL,
  /** The import row that caused this, when it came from a batch. */
  import_row_id          uuid,
  staff_id               uuid        NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rik_elig_adj_pk PRIMARY KEY (id),
  -- No foreign keys: see "WHY THE LEDGER CARRIES NO FOREIGN KEYS" in the
  -- header. Every reference is validated at INSERT instead, by
  -- validate_adjustment_refs and validate_customer_ref below.
  CONSTRAINT rik_elig_adj_source_chk CHECK (source IN ('IMPORT', 'MANUAL')),
  -- Whole, non-negative, and internally consistent. Zero is a legal value;
  -- a zero DELTA is not an adjustment and is refused rather than recorded.
  CONSTRAINT rik_elig_adj_values_chk CHECK (
    previous_eligible_days >= 0 AND new_eligible_days >= 0 AND new_eligible_days <= 366
    AND new_eligible_days = previous_eligible_days + delta
    AND delta <> 0
  ),
  CONSTRAINT rik_elig_adj_reason_chk CHECK (btrim(reason) <> ''),
  -- An IMPORT adjustment names its row; a MANUAL one has none.
  CONSTRAINT rik_elig_adj_source_shape_chk CHECK (
    (source = 'IMPORT' AND import_row_id IS NOT NULL)
    OR (source = 'MANUAL' AND import_row_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS rik_elig_adj_officer_idx ON rik.eligibility_adjustments (customer_id, period_id, created_at DESC);
CREATE INDEX IF NOT EXISTS rik_elig_adj_row_idx     ON rik.eligibility_adjustments (import_row_id);

-- Idempotent repair: an earlier run of this migration created three foreign
-- keys on the ledger. They are dropped here so re-applying the file converges
-- on the ledger shape rather than leaving whichever shape was applied first.
ALTER TABLE rik.eligibility_adjustments DROP CONSTRAINT IF EXISTS rik_elig_adj_period_fk;
ALTER TABLE rik.eligibility_adjustments DROP CONSTRAINT IF EXISTS rik_elig_adj_row_fk;
ALTER TABLE rik.eligibility_adjustments DROP CONSTRAINT IF EXISTS rik_elig_adj_staff_fk;

-- `validate_customer_ref` is the project's existing guard that a customer id
-- names a live customer; reused here rather than reinvented.
DROP TRIGGER IF EXISTS validate_customer_ref ON rik.eligibility_adjustments;
CREATE TRIGGER validate_customer_ref
  BEFORE INSERT OR UPDATE ON rik.eligibility_adjustments
  FOR EACH ROW EXECUTE FUNCTION rik.trg_validate_customer_ref();

-- The other three references, checked where a foreign key would have checked
-- them — on the way in. A reference that does not resolve is refused by name,
-- so no adjustment is ever recorded against a period, a staff member or an
-- import row that does not exist.
CREATE OR REPLACE FUNCTION rik.trg_validate_adjustment_refs()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM rik.entitlement_periods WHERE id = NEW.period_id) THEN
    RAISE EXCEPTION 'Eligibility adjustment names an entitlement period that does not exist (%).', NEW.period_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM shared.users WHERE id = NEW.staff_id) THEN
    RAISE EXCEPTION 'Eligibility adjustment names a staff member who does not exist (%).', NEW.staff_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.import_row_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM rik.eligibility_import_rows WHERE id = NEW.import_row_id) THEN
    RAISE EXCEPTION 'Eligibility adjustment names an import row that does not exist (%).', NEW.import_row_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_adjustment_refs ON rik.eligibility_adjustments;
CREATE TRIGGER validate_adjustment_refs
  BEFORE INSERT ON rik.eligibility_adjustments
  FOR EACH ROW EXECUTE FUNCTION rik.trg_validate_adjustment_refs();

-- ---------------------------------------------------------------------------
-- 5. Append-only: an adjustment is a historical record
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rik.trg_eligibility_adjustment_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'rik.eligibility_adjustments is append-only. An eligible-day adjustment cannot be % once recorded; correct it with a further adjustment.',
    lower(TG_OP)
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS eligibility_adjustment_immutable ON rik.eligibility_adjustments;
CREATE TRIGGER eligibility_adjustment_immutable
  BEFORE UPDATE OR DELETE ON rik.eligibility_adjustments
  FOR EACH ROW EXECUTE FUNCTION rik.trg_eligibility_adjustment_immutable();

-- ---------------------------------------------------------------------------
-- 6. The adjustment APPLIES the value
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rik.trg_apply_eligibility_adjustment()
RETURNS trigger
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

DROP TRIGGER IF EXISTS apply_eligibility_adjustment ON rik.eligibility_adjustments;
CREATE TRIGGER apply_eligibility_adjustment
  AFTER INSERT ON rik.eligibility_adjustments
  FOR EACH ROW EXECUTE FUNCTION rik.trg_apply_eligibility_adjustment();

-- ---------------------------------------------------------------------------
-- 7. And nothing else may change the value
--
-- UPDATE OF eligible_days only. INSERT is deliberately not guarded — see the
-- header: seven existing suites seed a starting value by raw SQL, and a first
-- value has no history to destroy.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rik.trg_protect_eligibility_value()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.eligible_days IS NOT DISTINCT FROM OLD.eligible_days THEN
    RETURN NEW; -- not a change to the value; some other column moved
  END IF;

  IF coalesce(current_setting('rik.in_eligibility_adjustment', true), 'off') <> 'on' THEN
    RAISE EXCEPTION
      'Eligible days cannot be changed directly (% to % for customer %). Insert a rik.eligibility_adjustments row: the previous value, the delta, a reason and the staff member are part of the change, not a note beside it.',
      OLD.eligible_days, NEW.eligible_days, OLD.customer_id
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_eligibility_value ON rik.customer_period_eligibility;
CREATE TRIGGER protect_eligibility_value
  BEFORE UPDATE OF eligible_days ON rik.customer_period_eligibility
  FOR EACH ROW EXECUTE FUNCTION rik.trg_protect_eligibility_value();

-- ---------------------------------------------------------------------------
-- 8. Grants — least privilege, stated as REVOKEs where it has to be
-- ---------------------------------------------------------------------------
-- IMPORTANT: a GRANT here cannot NARROW anything. Migration 0018 set
--   ALTER DEFAULT PRIVILEGES … IN SCHEMA rik
--     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rik;
-- so every new table in this schema arrives with all four verbs already
-- granted, and a narrower GRANT is a no-op against that. Narrowing has to be
-- an explicit REVOKE — the same correction migration 0023 made for
-- rik.issue_schedules, for the same reason.
GRANT SELECT, INSERT, UPDATE ON rik.eligibility_import_batches TO app_rik;
GRANT SELECT, INSERT         ON rik.eligibility_import_rows     TO app_rik;
GRANT SELECT, INSERT         ON rik.eligibility_adjustments     TO app_rik;

-- The ledger is append-only by PRIVILEGE as well as by trigger. Two
-- independent mechanisms, because the trigger is the invariant and the
-- privilege is the blast radius: an application role that cannot be granted
-- the verb cannot reach the trigger to be refused by it.
REVOKE UPDATE, DELETE ON rik.eligibility_adjustments  FROM app_rik;
-- An import row is written once, at upload, and never revised: its outcome is
-- the record of what the sheet said and what the system made of it. Nothing
-- in the application updates one, so nothing needs the privilege.
REVOKE UPDATE, DELETE ON rik.eligibility_import_rows  FROM app_rik;
-- The batch header keeps UPDATE — confirm and discard move `status` — and, at
-- this migration, keeps DELETE. Migration 0046 revokes that too, after the
-- facility locked the decision that a batch is a historical audit record.

GRANT SELECT ON rik.eligibility_import_batches, rik.eligibility_import_rows,
                rik.eligibility_adjustments TO app_reporting_rik;
GRANT USAGE, SELECT ON SEQUENCE rik.eligibility_import_seq TO app_rik;

COMMENT ON TABLE rik.eligibility_import_batches IS
  'STEP 15B Phase B: one row per eligibility Excel upload. A repeated upload for the same period is a NEW batch, never an overwrite.';
COMMENT ON TABLE rik.eligibility_import_rows IS
  'STEP 15B Phase B: one row per spreadsheet row, holding the raw supplied values beside the system''s interpretation, so an exception stays understandable without the file.';
COMMENT ON TABLE rik.eligibility_adjustments IS
  'STEP 15B Phase B: append-only history of every change to an officer''s eligible days, and the ONLY way the value changes — a trigger on this table applies it.';

-- ---------------------------------------------------------------------------
-- 9. Verification — fail loudly rather than leave a half-applied change
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  pools  integer;
  scales integer;
  convs  integer;
  provs  integer;
  tabs   integer;
  vws    integer;
BEGIN
  -- The three tables exist.
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'rik' AND tablename = 'eligibility_import_batches')
     OR NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'rik' AND tablename = 'eligibility_import_rows')
     OR NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'rik' AND tablename = 'eligibility_adjustments') THEN
    RAISE EXCEPTION 'Migration 0045: one of the three Phase B tables was not created.';
  END IF;

  -- The invariant triggers are in place.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'rik.eligibility_adjustments'::regclass
                   AND tgname = 'apply_eligibility_adjustment' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Migration 0045: the adjustment-applies-the-value trigger is missing.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'rik.eligibility_adjustments'::regclass
                   AND tgname = 'eligibility_adjustment_immutable' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Migration 0045: the append-only trigger is missing.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'rik.customer_period_eligibility'::regclass
                   AND tgname = 'protect_eligibility_value' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Migration 0045: the eligibility protection trigger is missing.';
  END IF;

  -- It must guard UPDATE OF eligible_days ONLY. Guarding INSERT would break
  -- seven existing suites that legitimately seed a starting value.
  IF (SELECT pg_get_triggerdef(oid) FROM pg_trigger
       WHERE tgrelid = 'rik.customer_period_eligibility'::regclass
         AND tgname = 'protect_eligibility_value') NOT LIKE '%BEFORE UPDATE OF eligible_days%' THEN
    RAISE EXCEPTION 'Migration 0045: the protection trigger is not scoped to UPDATE OF eligible_days.';
  END IF;

  -- The ledger is a history table: no foreign key may remain on it, or an
  -- append-only row would pin every operational row it mentions forever.
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'rik.eligibility_adjustments'::regclass AND contype = 'f') THEN
    RAISE EXCEPTION
      'Migration 0045: rik.eligibility_adjustments still carries a foreign key; references are validated at INSERT instead.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'rik.eligibility_adjustments'::regclass
                   AND tgname = 'validate_adjustment_refs' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Migration 0045: the reference-validation trigger is missing — references would be unchecked.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'rik.eligibility_adjustments'::regclass
                   AND tgname = 'validate_customer_ref' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Migration 0045: the customer-reference trigger is missing.';
  END IF;

  -- Append-only by privilege as well as by trigger. Asserted because
  -- migration 0018's ALTER DEFAULT PRIVILEGES grants all four verbs to
  -- app_rik on arrival: without the REVOKE above this silently fails open.
  IF has_table_privilege('app_rik', 'rik.eligibility_adjustments', 'UPDATE')
     OR has_table_privilege('app_rik', 'rik.eligibility_adjustments', 'DELETE')
     OR has_table_privilege('app_rik', 'rik.eligibility_import_rows', 'UPDATE')
     OR has_table_privilege('app_rik', 'rik.eligibility_import_rows', 'DELETE') THEN
    RAISE EXCEPTION
      'Migration 0045: app_rik still holds UPDATE or DELETE on an append-only table — the REVOKE did not take.';
  END IF;
  -- And it must still hold what it needs.
  IF NOT has_table_privilege('app_rik', 'rik.eligibility_adjustments', 'INSERT')
     OR NOT has_table_privilege('app_rik', 'rik.eligibility_import_rows', 'INSERT')
     OR NOT has_table_privilege('app_rik', 'rik.eligibility_import_batches', 'UPDATE') THEN
    RAISE EXCEPTION 'Migration 0045: app_rik is missing a privilege the import path needs.';
  END IF;

  -- The batch reference widens past six digits.
  IF rik.format_import_batch_ref(1, 2026)       <> 'ELIG-2026-000001'  THEN
    RAISE EXCEPTION 'Migration 0045: batch ref for 1 is %.', rik.format_import_batch_ref(1, 2026);
  END IF;
  IF rik.format_import_batch_ref(1000000, 2026) <> 'ELIG-2026-1000000' THEN
    RAISE EXCEPTION 'Migration 0045: the batch ref does not widen past six digits — %.',
      rik.format_import_batch_ref(1000000, 2026);
  END IF;

  -- Nothing in the entitlement configuration moved.
  SELECT count(*) INTO pools  FROM rik.entitlement_pools;
  SELECT count(*) INTO scales FROM rik.pool_scales;
  SELECT count(*) INTO convs  FROM rik.pool_conversions;
  SELECT count(*) INTO provs  FROM rik.provisions;
  IF pools <> 18 OR scales <> 50 OR convs <> 7 OR provs <> 189 THEN
    RAISE EXCEPTION
      'Migration 0045: RIK configuration changed — pools %, scales %, conversions %, provisions %; expected 18/50/7/189.',
      pools, scales, convs, provs;
  END IF;

  -- Three tables added, no view added.
  SELECT count(*) INTO tabs FROM pg_tables WHERE schemaname IN ('shared', 'rik', 'pif');
  SELECT count(*) INTO vws  FROM pg_views  WHERE schemaname IN ('shared', 'rik', 'pif');
  IF tabs <> 59 OR vws <> 5 THEN
    RAISE EXCEPTION 'Migration 0045: expected 59 tables and 5 views, found % and %.', tabs, vws;
  END IF;
END;
$$;

RESET ROLE;
