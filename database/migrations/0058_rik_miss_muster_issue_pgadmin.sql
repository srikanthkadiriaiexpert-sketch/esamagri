-- ===========================================================================
--  0058  Miss Muster issue schedules                         [pgAdmin variant]
-- ===========================================================================
--
--  WHAT THIS IS. One CHECK constraint widened, and nothing else. It lets a
--  ration period carry two further issue schedules alongside the three Fresh
--  and the one Dry it already has:
--
--      ration_type 'MISS_MUSTER_FRESH'  window_code 'MISS_MUSTER_FRESH'  seq 1
--      ration_type 'MISS_MUSTER_DRY'    window_code 'MISS_MUSTER_DRY'    seq 1
--
--  WHY TWO RATION TYPES AND NOT ONE WITH TWO SEQUENCE NUMBERS. Because 0047
--  scopes two of its own rules by ration_type, and both would misfire:
--
--    * `rik_issue_windows_no_overlap` is a GiST exclusion over
--      (period_id, ration_type, date range) among ACTIVE windows. Under a
--      single 'MISS_MUSTER' type the Fresh and Dry miss-muster schedules
--      could not cover the same day — but they are different commodities
--      collected separately, exactly as FRESH and DRY are, and must be free
--      to overlap.
--    * the `issue_window_sequence_order` trigger refuses a lower sequence
--      number starting later than a higher one, within one ration_type. It
--      would impose "Fresh before Dry" on two schedules that have no order
--      between them.
--
--  Giving each its own ration_type with sequence_no 1 makes each the exact
--  shape of the existing DRY schedule: one row, its own overlap scope, the
--  ordering trigger inert. No trigger, exclusion or index is modified.
--
--  WHAT IT DOES NOT DO. It adds no table, no column, no index, no role and
--  no grant. It writes no row: every Miss Muster schedule that ever exists
--  will have been entered by a named member of staff through the Admin
--  Portal. No existing window, revision or voucher is read or changed.
--
--  IT CANNOT REACH THE ENTITLEMENT ENGINE. rik.issue_windows is read by its
--  own repository and service, by the voucher service and by the fulfilment
--  service — and the latter two filter windows down to the ration type of
--  the VOUCHER they are serving. No voucher is ever MISS_MUSTER, because
--  nothing creates one, so a Miss Muster window is invisible to both. The
--  entitlement, conversion and eligibility services never read this table at
--  all. Quantities, ratios, dietary rules and balances are untouched.
--
--  WHY DROP AND RE-ADD RATHER THAN ALTER. Postgres has no "widen a CHECK" —
--  the constraint is replaced. Re-adding it revalidates every existing row,
--  so if any current window did not satisfy the new definition this
--  migration would fail here rather than leave the table half-governed.
--
--  HOW TO RUN IT. psql is the reliable path:
--
--    "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres ^
--      -d esamagri_staging -v ON_ERROR_STOP=1 -f <this file>
--
--  On success the last line is  MIGRATION 0058 APPLIED.
--  In the pgAdmin Query Tool: Ctrl+A first, then the toolbar Execute button.
-- ===========================================================================

BEGIN;

DO $migration$
DECLARE
  n_windows   integer;
  n_mm        integer;
  definition  text;
BEGIN
  -- -------------------------------------------------------------------
  -- 0. The right database, and only the right database.
  -- -------------------------------------------------------------------
  IF current_database() <> 'esamagri_staging' THEN
    RAISE EXCEPTION
      'Migration 0058 refused: connected to database %, expected esamagri_staging.',
      current_database();
  END IF;

  -- -------------------------------------------------------------------
  -- 1. Preconditions.
  -- -------------------------------------------------------------------
  IF to_regclass('rik.issue_windows') IS NULL THEN
    RAISE EXCEPTION 'Migration 0058 refused: rik.issue_windows does not exist. Apply 0047 first.';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO definition
    FROM pg_constraint
   WHERE conname = 'rik_issue_windows_identity_chk'
     AND conrelid = 'rik.issue_windows'::regclass;

  IF definition IS NULL THEN
    RAISE EXCEPTION 'Migration 0058 refused: rik_issue_windows_identity_chk not found.';
  END IF;

  IF definition LIKE '%MISS_MUSTER%' THEN
    RAISE EXCEPTION
      'Migration 0058 refused: the identity CHECK already allows MISS_MUSTER. This migration has already been applied.';
  END IF;

  -- Remembered so the postcondition can prove no window was lost or added.
  SELECT count(*) INTO n_windows FROM rik.issue_windows;

  -- -------------------------------------------------------------------
  -- 2. Widen the identity CHECK.
  --
  --    The first two branches are copied verbatim from 0047; only the two
  --    MISS_MUSTER branches are new. An unknown ration type, a code that
  --    disagrees with its type, a code that disagrees with its sort order
  --    and an invented fourth Fresh schedule all stay refused.
  -- -------------------------------------------------------------------
  ALTER TABLE rik.issue_windows DROP CONSTRAINT rik_issue_windows_identity_chk;

  ALTER TABLE rik.issue_windows ADD CONSTRAINT rik_issue_windows_identity_chk CHECK (
    (ration_type = 'FRESH' AND sequence_no BETWEEN 1 AND 3
       AND window_code = 'FRESH_' || sequence_no::text)
    OR
    (ration_type = 'DRY' AND sequence_no = 1 AND window_code = 'DRY')
    OR
    (ration_type = 'MISS_MUSTER' AND sequence_no = 1 AND window_code = 'MISS_MUSTER_FRESH')
    OR
    (ration_type = 'MISS_MUSTER' AND sequence_no = 2 AND window_code = 'MISS_MUSTER_DRY')
  );

  -- -------------------------------------------------------------------
  -- 3. Postconditions.
  -- -------------------------------------------------------------------
  SELECT pg_get_constraintdef(oid) INTO definition
    FROM pg_constraint
   WHERE conname = 'rik_issue_windows_identity_chk'
     AND conrelid = 'rik.issue_windows'::regclass;

  IF definition IS NULL OR definition NOT LIKE '%MISS_MUSTER_FRESH%'
     OR definition NOT LIKE '%MISS_MUSTER_DRY%' THEN
    RAISE EXCEPTION 'Migration 0058 failed: the new identity CHECK is not in place.';
  END IF;

  -- The existing branches must still be there: this widens, it never narrows.
  IF definition NOT LIKE '%FRESH_%' OR definition NOT LIKE '%DRY%' THEN
    RAISE EXCEPTION 'Migration 0058 failed: the Fresh or Dry branch was lost.';
  END IF;

  -- Not one schedule row was added, removed or rewritten.
  IF (SELECT count(*) FROM rik.issue_windows) <> n_windows THEN
    RAISE EXCEPTION 'Migration 0058 failed: the issue window count changed.';
  END IF;

  SELECT count(*) INTO n_mm FROM rik.issue_windows WHERE ration_type = 'MISS_MUSTER';
  IF n_mm <> 0 THEN
    RAISE EXCEPTION
      'Migration 0058 failed: expected no Miss Muster rows, found %. This migration seeds none.', n_mm;
  END IF;

  RAISE NOTICE 'MIGRATION 0058 APPLIED: rik.issue_windows now accepts MISS_MUSTER_FRESH and MISS_MUSTER_DRY. % existing schedules untouched, 0 Miss Muster rows created.', n_windows;
END
$migration$;

COMMIT;
