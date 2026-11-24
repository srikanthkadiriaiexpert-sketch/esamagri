-- ===========================================================================
--  0059  Alternative-entitlement wording                     [pgAdmin variant]
-- ===========================================================================
--
--  WHAT THIS IS. Four UPDATE statements against one column — the English
--  sentence shown beside an alternative on the customer's Eggs and Meat
--  pages. Nothing else in the row is read or written.
--
--  WHY IT IS A MIGRATION AND NOT A CODE CHANGE. The sentences are not in the
--  front end. They are seeded content in rik.pool_conversions.description,
--  put there by migration 0026, and the customer app renders whatever the
--  API returns. The only place the old text appears in the repository is a
--  test fixture.
--
--      MEAT_TO_EGGS_EV  'Egg veg: take the meat entitlement as four additional eggs per day.'
--      MEAT_TO_EGGS_NV  'Non veg: take the meat entitlement as four additional eggs per day.'
--                   ->  'Four additional Eggs per day in lieu of meat'
--
--      EGGS_TO_MILK_EV  'Decline the egg entitlement and take milk instead.'
--      EGGS_TO_MILK_NV  'Decline the egg entitlement and take milk instead.'
--                   ->  'Collect milk in lieu of Eggs'
--
--  BOTH DIETARY VARIANTS CHANGE. The client quoted the Non-veg sentence, and
--  the replacement carries no dietary prefix. Leaving the Egg-veg row alone
--  would leave two different sentences in the app for the same choice, and
--  the requirement is that the Eggs and Meat pages read identically.
--
--  NO ENTITLEMENT RULE MOVES. `from_qty`, `to_qty`, `mode`,
--  `dietary_preference`, `from_pool_id`, `to_pool_id` and `display_order`
--  are not in any SET clause, and section 3 proves every one of them is
--  byte-for-byte what it was. A meat-to-eggs conversion is still 260 g of
--  meat to 4 eggs, still ELECTIVE, still scoped to the same diets, still in
--  the same order on the page. This migration cannot change what anybody is
--  entitled to; it changes what the sentence says.
--
--  HOW TO RUN IT. psql is the reliable path:
--
--    "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres ^
--      -d esamagri_staging -v ON_ERROR_STOP=1 -f <this file>
--
--  On success the last line is  MIGRATION 0059 APPLIED.
-- ===========================================================================

BEGIN;

DO $migration$
DECLARE
  n_rows      integer;
  fingerprint text;
  after_print text;
  n_updated   integer;
BEGIN
  -- -------------------------------------------------------------------
  -- 0. The right database, and only the right database.
  -- -------------------------------------------------------------------
  IF current_database() <> 'esamagri_staging' THEN
    RAISE EXCEPTION
      'Migration 0059 refused: connected to database %, expected esamagri_staging.',
      current_database();
  END IF;

  -- -------------------------------------------------------------------
  -- 1. Preconditions.
  -- -------------------------------------------------------------------
  SELECT count(*) INTO n_rows
    FROM rik.pool_conversions
   WHERE code IN ('MEAT_TO_EGGS_EV', 'MEAT_TO_EGGS_NV', 'EGGS_TO_MILK_EV', 'EGGS_TO_MILK_NV');

  IF n_rows <> 4 THEN
    RAISE EXCEPTION
      'Migration 0059 refused: expected the 4 seeded conversion options, found %.', n_rows;
  END IF;

  -- Everything about these rows EXCEPT the sentence, captured now and
  -- compared at the end. This is what makes "text only" a proven claim
  -- rather than an assurance.
  SELECT string_agg(
           code || '|' || from_pool_id::text || '|' || to_pool_id::text || '|' ||
           from_qty::text || '|' || to_qty::text || '|' || mode || '|' ||
           coalesce(dietary_preference, '-') || '|' || display_order::text,
           ',' ORDER BY code)
    INTO fingerprint
    FROM rik.pool_conversions;

  -- -------------------------------------------------------------------
  -- 2. The wording.
  -- -------------------------------------------------------------------
  UPDATE rik.pool_conversions
     SET description = 'Four additional Eggs per day in lieu of meat'
   WHERE code IN ('MEAT_TO_EGGS_EV', 'MEAT_TO_EGGS_NV');
  GET DIAGNOSTICS n_updated = ROW_COUNT;
  IF n_updated <> 2 THEN
    RAISE EXCEPTION 'Migration 0059 failed: expected to reword 2 meat-to-eggs rows, reworded %.', n_updated;
  END IF;

  UPDATE rik.pool_conversions
     SET description = 'Collect milk in lieu of Eggs'
   WHERE code IN ('EGGS_TO_MILK_EV', 'EGGS_TO_MILK_NV');
  GET DIAGNOSTICS n_updated = ROW_COUNT;
  IF n_updated <> 2 THEN
    RAISE EXCEPTION 'Migration 0059 failed: expected to reword 2 eggs-to-milk rows, reworded %.', n_updated;
  END IF;

  -- -------------------------------------------------------------------
  -- 3. Postconditions.
  -- -------------------------------------------------------------------
  SELECT count(*) INTO n_rows
    FROM rik.pool_conversions
   WHERE (code IN ('MEAT_TO_EGGS_EV', 'MEAT_TO_EGGS_NV')
          AND description = 'Four additional Eggs per day in lieu of meat')
      OR (code IN ('EGGS_TO_MILK_EV', 'EGGS_TO_MILK_NV')
          AND description = 'Collect milk in lieu of Eggs');
  IF n_rows <> 4 THEN
    RAISE EXCEPTION 'Migration 0059 failed: expected 4 reworded rows, found %.', n_rows;
  END IF;

  -- Not a single old sentence survives anywhere in the table.
  IF EXISTS (SELECT 1 FROM rik.pool_conversions
              WHERE description LIKE '%take the meat entitlement as four additional eggs%'
                 OR description LIKE '%Decline the egg entitlement%') THEN
    RAISE EXCEPTION 'Migration 0059 failed: an old sentence is still present.';
  END IF;

  -- THE CLAIM THAT MATTERS: every conversion rule is exactly as it was.
  SELECT string_agg(
           code || '|' || from_pool_id::text || '|' || to_pool_id::text || '|' ||
           from_qty::text || '|' || to_qty::text || '|' || mode || '|' ||
           coalesce(dietary_preference, '-') || '|' || display_order::text,
           ',' ORDER BY code)
    INTO after_print
    FROM rik.pool_conversions;

  IF after_print IS DISTINCT FROM fingerprint THEN
    RAISE EXCEPTION
      'Migration 0059 failed: a conversion rule changed. Only description may move.';
  END IF;

  RAISE NOTICE 'MIGRATION 0059 APPLIED: 4 descriptions reworded. Every pool, quantity, mode, dietary scope and display order verified unchanged.';
END
$migration$;

COMMIT;
