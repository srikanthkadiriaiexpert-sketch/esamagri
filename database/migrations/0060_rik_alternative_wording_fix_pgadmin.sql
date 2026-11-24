-- ===========================================================================
--  0060  Alternative-entitlement wording — corrects the lost 0059
-- ===========================================================================
--
--  WHY THIS EXISTS. 0059 was correct SQL that never committed. It is
--  BEGIN; DO …; COMMIT; and everything that reports success — the row
--  counts, the postconditions, the APPLIED notice — runs INSIDE the
--  transaction. When the trailing COMMIT did not reach the server the whole
--  thing rolled back, after the notice had already been printed.
--
--  SO THIS SCRIPT HAS NO BEGIN AND NO COMMIT. The DO block is a single
--  statement and, under autocommit, its own transaction: it commits when it
--  completes, and there is nothing left over to lose. The SELECT at the end
--  runs afterwards and shows COMMITTED rows — the proof 0059 could not give.
--
--  SCOPE. Four rows, one column. The WHERE clauses name the four codes
--  exactly and additionally require is_active AND effective_to IS NULL, so
--  only the four live rows you confirmed can match. No wildcard, no broad
--  update, nothing touched outside rik.pool_conversions.
--
--  NO ENTITLEMENT RULE MOVES. from_qty, to_qty, mode, dietary_preference,
--  from_pool_id, to_pool_id, display_order, is_active, effective_from and
--  effective_to appear in no SET clause, and section 3 proves every one of
--  them is unchanged across the whole table.
--
--  RUN IT WITH psql:
--    "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres ^
--      -d esamagri_staging -v ON_ERROR_STOP=1 -f <this file>
-- ===========================================================================

DO $fix$
DECLARE
  n_live      integer;
  n_updated   integer;
  fingerprint text;
  after_print text;
BEGIN
  IF current_database() <> 'esamagri_staging' THEN
    RAISE EXCEPTION
      'Migration 0060 refused: connected to database %, expected esamagri_staging.',
      current_database();
  END IF;

  -- The four live rows, as confirmed in pgAdmin.
  SELECT count(*) INTO n_live
    FROM rik.pool_conversions
   WHERE code IN ('MEAT_TO_EGGS_EV','MEAT_TO_EGGS_NV','EGGS_TO_MILK_EV','EGGS_TO_MILK_NV')
     AND is_active AND effective_to IS NULL;
  IF n_live <> 4 THEN
    RAISE EXCEPTION 'Migration 0060 refused: expected 4 live conversion rows, found %.', n_live;
  END IF;

  -- Every column except description, for every row in the table.
  SELECT string_agg(
           code || '|' || from_pool_id::text || '|' || to_pool_id::text || '|' ||
           from_qty::text || '|' || to_qty::text || '|' || mode || '|' ||
           coalesce(dietary_preference,'-') || '|' || display_order::text || '|' ||
           is_active::text || '|' || effective_from::text || '|' ||
           coalesce(effective_to::text,'-'),
           ',' ORDER BY code, effective_from)
    INTO fingerprint
    FROM rik.pool_conversions;

  UPDATE rik.pool_conversions
     SET description = 'Four additional Eggs per day in lieu of meat'
   WHERE code IN ('MEAT_TO_EGGS_EV','MEAT_TO_EGGS_NV')
     AND is_active AND effective_to IS NULL;
  GET DIAGNOSTICS n_updated = ROW_COUNT;
  IF n_updated <> 2 THEN
    RAISE EXCEPTION 'Migration 0060 failed: expected 2 meat-to-eggs rows, updated %.', n_updated;
  END IF;

  UPDATE rik.pool_conversions
     SET description = 'Collect milk in lieu of Eggs'
   WHERE code IN ('EGGS_TO_MILK_EV','EGGS_TO_MILK_NV')
     AND is_active AND effective_to IS NULL;
  GET DIAGNOSTICS n_updated = ROW_COUNT;
  IF n_updated <> 2 THEN
    RAISE EXCEPTION 'Migration 0060 failed: expected 2 eggs-to-milk rows, updated %.', n_updated;
  END IF;

  SELECT string_agg(
           code || '|' || from_pool_id::text || '|' || to_pool_id::text || '|' ||
           from_qty::text || '|' || to_qty::text || '|' || mode || '|' ||
           coalesce(dietary_preference,'-') || '|' || display_order::text || '|' ||
           is_active::text || '|' || effective_from::text || '|' ||
           coalesce(effective_to::text,'-'),
           ',' ORDER BY code, effective_from)
    INTO after_print
    FROM rik.pool_conversions;

  IF after_print IS DISTINCT FROM fingerprint THEN
    RAISE EXCEPTION 'Migration 0060 failed: a column other than description changed.';
  END IF;

  RAISE NOTICE '0060: 4 descriptions updated. Read the SELECT below — THAT is the committed truth, not this notice.';
END
$fix$;

-- Runs after the DO block has committed. These rows are durable.
SELECT code, description, is_active, effective_from, effective_to
  FROM rik.pool_conversions
 WHERE code IN ('MEAT_TO_EGGS_EV','MEAT_TO_EGGS_NV','EGGS_TO_MILK_EV','EGGS_TO_MILK_NV')
 ORDER BY code;
