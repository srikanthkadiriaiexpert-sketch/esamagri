-- =============================================================================
-- Rollback for migration 0065 (two-statement version).
--
-- PREPARED FOR REVIEW. NOT APPLIED.
--
-- READ THIS BEFORE RUNNING.
--
-- Section 2 is freely reversible at any time: it restores the migration 0044
-- trigger body, after which NULL -> value is refused again and no link is
-- possible by any path.
--
-- Section 3 -- restoring NOT NULL on rik_id -- is reversible ONLY while no
-- PIF-only resident exists. Once one resident has self-registered, the column
-- holds a NULL and SET NOT NULL cannot succeed without first linking or
-- deleting that resident's account. This script COUNTS the NULLs and REFUSES
-- rather than failing obscurely, and the whole rollback is rolled back when it
-- refuses.
--
-- In that situation the correct action is to run section 2 only (comment out
-- section 3): reverting the application code stops new PIF-only rows being
-- created, and a nullable rik_id with the original trigger restored is inert --
-- simply a column nothing writes NULL to any more. Plan on this being the
-- realistic path; statement 1 of the forward migration is effectively one-way.
--
-- NOT UNDONE, DELIBERATELY:
--   * RIK_OFFICER_LINKED rows already in shared.audit_log. That table is
--     append-only (migration 0006 blocks UPDATE and DELETE), and an audit trail
--     a rollback can erase is not an audit trail.
--   * RIK IDs already issued. The sequence never reuses a value, and a linked
--     resident is now a real officer with issue records against that ID.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Pre-state assertions.
-- -----------------------------------------------------------------------------
DO $pre$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
     WHERE tgrelid = 'shared.customers'::regclass
       AND tgname  = 'protect_officer_rik_id'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION
      'Rollback 0065: the permanence trigger is missing - refusing to proceed.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
     WHERE attrelid = 'shared.customers'::regclass
       AND attname = 'rik_id' AND attnotnull
  ) THEN
    RAISE EXCEPTION
      'Rollback 0065: rik_id is already NOT NULL - has this rollback already run?';
  END IF;
END
$pre$;

-- -----------------------------------------------------------------------------
-- 2. Restore the ORIGINAL migration 0044 trigger body.
--
--    CREATE OR REPLACE keeps the existing owner and security mode, and this
--    migration changed neither, so nothing else needs resetting.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION shared.trg_protect_officer_rik_id()
RETURNS trigger
LANGUAGE plpgsql
AS $trg$
BEGIN
  IF NEW.rik_id IS NOT DISTINCT FROM OLD.rik_id THEN
    RETURN NEW; -- not a change to the identifier
  END IF;

  RAISE EXCEPTION
    'A RIK ID is permanent. Officer % cannot be renumbered from % to %.',
    OLD.id, OLD.rik_id, NEW.rik_id
    USING ERRCODE = 'restrict_violation';
END
$trg$;

COMMENT ON FUNCTION shared.trg_protect_officer_rik_id() IS
  'STEP 15B Phase A: a RIK ID is permanent. Never reused, never renumbered.';

-- -----------------------------------------------------------------------------
-- 3. Restore NOT NULL on rik_id - ONLY if no PIF-only resident exists.
--    Comment out this block if the count below is non-zero and you intend to
--    keep those accounts. See the header.
-- -----------------------------------------------------------------------------
DO $notnull$
DECLARE
  v_nulls bigint;
BEGIN
  SELECT count(*) INTO v_nulls FROM shared.customers WHERE rik_id IS NULL;

  IF v_nulls > 0 THEN
    RAISE EXCEPTION
      'Rollback 0065 REFUSED: % PIF-only resident(s) hold a NULL rik_id. Restoring NOT NULL would require linking or deleting those accounts. Comment out section 3 and re-run to roll back the trigger only.',
      v_nulls;
  END IF;
END
$notnull$;

ALTER TABLE shared.customers ALTER COLUMN rik_id SET NOT NULL;

-- -----------------------------------------------------------------------------
-- 4. Post-state verification.
-- -----------------------------------------------------------------------------
DO $post$
DECLARE
  v_src text;
BEGIN
  SELECT p.prosrc INTO v_src
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'shared' AND p.proname = 'trg_protect_officer_rik_id';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'Rollback 0065: the trigger function is missing.';
  END IF;

  IF v_src LIKE '%format_officer_rik_id%' THEN
    RAISE EXCEPTION 'Rollback 0065: the original trigger body was not restored.';
  END IF;
END
$post$;

COMMIT;
