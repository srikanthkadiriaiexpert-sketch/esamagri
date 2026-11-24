-- =============================================================================
-- Migration 0030: record the pack sizes for the three cereal items that
-- were supplied with a pack LIMIT but no pack SIZE.
--
-- Phase 3B STEP 11E.
--
-- THE PROBLEM THIS FIXES
-- ----------------------
-- Maggi, Hakka Noodles and Maida were each configured with "maximum 2
-- packets" but no pack size, because none had been supplied. The STEP
-- 11D report raised this as a limitation with real consequences: the
-- engine converts a pack limit into a quantity ceiling by multiplying
-- packs by pack size, so with a NULL pack size the limit could not
-- bind. The screen displayed "Most packs: 2" truthfully while nothing
-- enforced it.
--
-- The facility has now supplied the three sizes. Recording them makes
-- the existing limit real, with no code change — which is the point of
-- a data-driven engine.
--
--   Maggi                       280 g   x 2 packets =  560 g ceiling
--   Hakka Noodles             1,000 g   x 2 packets = 2,000 g ceiling
--   All Purpose Flour / Maida   500 g   x 2 packets = 1,000 g ceiling
--
-- The 1:1 consumption ratios and the 2-packet limits are UNCHANGED;
-- only the previously missing pack size is filled in.
--
-- WHY A MIGRATION AND NOT THE ADMIN SCREEN
-- ----------------------------------------
-- These are catalogue values and a RIK administrator can edit every one
-- of them from the Pack sizes & limits screen built in STEP 11C — that
-- remains true after this migration and is the intended route for any
-- future change. This one-off is written as a migration so that every
-- environment starts from the facility's stated figures rather than
-- depending on somebody remembering to type them in after a deploy.
--
-- No schema change. No constraint, index, trigger or grant is touched.
-- Four columns on three rows.
-- =============================================================================

SET ROLE esamagri_owner;

UPDATE rik.provisions
   SET pack_size  = 280,
       updated_at = now()
 WHERE code = 'CER_MAGGI';

UPDATE rik.provisions
   SET pack_size  = 1000,
       updated_at = now()
 WHERE code = 'CER_HAKKA_NOODLES';

UPDATE rik.provisions
   SET pack_size  = 500,
       updated_at = now()
 WHERE code = 'CER_MAIDA';

-- Fail loudly rather than silently leaving a limit unenforceable: if a
-- code was renamed, this migration must not pass quietly.
DO $$
DECLARE
  missing integer;
BEGIN
  SELECT count(*) INTO missing
    FROM rik.provisions
   WHERE code IN ('CER_MAGGI', 'CER_HAKKA_NOODLES', 'CER_MAIDA')
     AND pack_size IS NULL;

  IF missing > 0 THEN
    RAISE EXCEPTION 'Migration 0030: % of the three cereal pack sizes were not applied.', missing;
  END IF;

  SELECT count(*) INTO missing
    FROM rik.provisions
   WHERE code IN ('CER_MAGGI', 'CER_HAKKA_NOODLES', 'CER_MAIDA');

  IF missing <> 3 THEN
    RAISE EXCEPTION 'Migration 0030: expected 3 cereal provisions, found %.', missing;
  END IF;
END;
$$;

RESET ROLE;
