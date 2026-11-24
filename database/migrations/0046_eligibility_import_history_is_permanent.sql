-- ---------------------------------------------------------------------------
-- 0046_eligibility_import_history_is_permanent.sql
--
-- STEP 15B PHASE B — FINAL DECISION on the one point left open by the Phase B
-- report: an eligibility import batch and its rows are HISTORICAL AUDIT
-- RECORDS, not working data.
--
-- THE DECISION, AS LOCKED
--
--   * application users may NOT delete an import batch;
--   * application users may NOT delete an import row;
--   * DISCARDED is a BUSINESS STATUS, not a physical deletion;
--   * the UPLOADED / APPLIED / DISCARDED history must stay queryable;
--   * physical deletion, if it is ever required, is a DBA act outside the
--     application workflow and outside this project phase.
--
-- WHY THIS IS A MIGRATION AND NOT AN EDIT TO 0045
--
-- 0045 is approved. Approved migrations are not rewritten — the project is
-- forward-only, so a decision taken after approval arrives as a new file.
--
-- WHY A REVOKE AND NOT A GRANT
--
-- The trap 0045's report flagged. Migration 0018 set
--
--     ALTER DEFAULT PRIVILEGES FOR ROLE esamagri_owner IN SCHEMA rik
--       GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rik;
--
-- so every new rik table arrives with all four verbs already granted and a
-- narrower GRANT is a no-op against it. Narrowing is only ever an explicit
-- REVOKE — the same correction migration 0023 made for rik.issue_schedules.
--
-- WHAT KEEPS WORKING, DELIBERATELY
--
--   batches   SELECT, INSERT, UPDATE   — upload records a batch, and confirm
--                                        and discard move `status`. UPDATE is
--                                        what makes DISCARDED a status rather
--                                        than a deletion, so it stays.
--   rows      SELECT, INSERT           — written once at upload, never revised.
--   ledger    SELECT, INSERT           — unchanged from 0045: append-only.
--
-- After this file, NOTHING the application role can do removes the record of
-- an upload. The three tables together answer "what did the facility send,
-- what did the system make of it, what was applied, by whom and when" for
-- every upload that ever happened, and no application code path can erase any
-- part of that answer.
--
-- WHAT THIS MIGRATION DOES NOT DO
--
-- It changes no table, no column, no constraint, no trigger and no row. It
-- revokes two privileges and asserts the result. It touches nothing in Phase
-- C, nothing in the entitlement engine, and no scale, pool, conversion or
-- provision.
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP on

SET ROLE esamagri_owner;

REVOKE DELETE ON rik.eligibility_import_batches FROM app_rik;
REVOKE DELETE ON rik.eligibility_import_rows    FROM app_rik;

COMMENT ON TABLE rik.eligibility_import_batches IS
  'STEP 15B Phase B: one row per eligibility Excel upload, and a permanent audit record. A repeated upload for the same period is a NEW batch, never an overwrite; DISCARDED is a status, not a deletion (migration 0046).';
COMMENT ON TABLE rik.eligibility_import_rows IS
  'STEP 15B Phase B: one row per spreadsheet row, holding the raw supplied values beside the system''s interpretation. Written once and never revised or removed by the application (migration 0046).';

-- ---------------------------------------------------------------------------
-- Verification — the privilege set is exactly the decision, in both directions
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- Removed.
  IF has_table_privilege('app_rik', 'rik.eligibility_import_batches', 'DELETE') THEN
    RAISE EXCEPTION 'Migration 0046: app_rik can still DELETE an import batch.';
  END IF;
  IF has_table_privilege('app_rik', 'rik.eligibility_import_rows', 'DELETE') THEN
    RAISE EXCEPTION 'Migration 0046: app_rik can still DELETE an import row.';
  END IF;

  -- Still absent from 0045, and must stay absent.
  IF has_table_privilege('app_rik', 'rik.eligibility_import_rows', 'UPDATE')
     OR has_table_privilege('app_rik', 'rik.eligibility_adjustments', 'UPDATE')
     OR has_table_privilege('app_rik', 'rik.eligibility_adjustments', 'DELETE') THEN
    RAISE EXCEPTION 'Migration 0046: an append-only table is writable again.';
  END IF;

  -- Retained, because the workflow needs them.
  IF NOT has_table_privilege('app_rik', 'rik.eligibility_import_batches', 'UPDATE') THEN
    RAISE EXCEPTION
      'Migration 0046: app_rik lost UPDATE on import batches — confirm and discard move `status` and would stop working.';
  END IF;
  IF NOT has_table_privilege('app_rik', 'rik.eligibility_import_batches', 'INSERT')
     OR NOT has_table_privilege('app_rik', 'rik.eligibility_import_rows', 'INSERT')
     OR NOT has_table_privilege('app_rik', 'rik.eligibility_adjustments', 'INSERT')
     OR NOT has_table_privilege('app_rik', 'rik.eligibility_import_batches', 'SELECT')
     OR NOT has_table_privilege('app_rik', 'rik.eligibility_import_rows', 'SELECT')
     OR NOT has_table_privilege('app_rik', 'rik.eligibility_adjustments', 'SELECT') THEN
    RAISE EXCEPTION 'Migration 0046: app_rik is missing a privilege the import path needs.';
  END IF;

  -- Reporting keeps its read.
  IF NOT has_table_privilege('app_reporting_rik', 'rik.eligibility_import_batches', 'SELECT') THEN
    RAISE EXCEPTION 'Migration 0046: reporting lost its read on import batches.';
  END IF;

  -- Nothing else moved.
  IF (SELECT count(*) FROM pg_tables WHERE schemaname IN ('shared', 'rik', 'pif')) <> 59
     OR (SELECT count(*) FROM pg_views WHERE schemaname IN ('shared', 'rik', 'pif')) <> 5 THEN
    RAISE EXCEPTION 'Migration 0046: the schema changed; this file only revokes two privileges.';
  END IF;
END;
$$;

RESET ROLE;
