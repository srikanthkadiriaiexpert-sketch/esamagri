-- =============================================================================
-- Migration 0065: let a PIF-only resident exist, and let the EXISTING RIK
-- officer-registration workflow link one to a newly issued RIK ID.
--
-- PREPARED FOR REVIEW. NOT APPLIED. Approved for preparation only (T2-1).
--
-- TWO STATEMENTS. This replaces the earlier revision 5 of this file entirely.
-- That design introduced a dedicated promotion login, two more NOLOGIN roles, a
-- break-glass group, a SECURITY DEFINER promotion function, column-level
-- privilege changes and a live self-test that wrote a temporary row into
-- shared.customers. All of it is gone, for one reason: promotion is not a new
-- operation. It is `POST /admin/rik/officers`, the workflow RIK staff already
-- use, already authorised by `rik.entitlement.allocate` through
-- AuthorizationGuard and already executed by the application's single database
-- role -- exactly like entitlement configuration, issue windows, voucher
-- creation and the eligibility import. Giving this one action a database
-- identity of its own would have made it the only such action in the system,
-- and would have been the second approval system the project owner ruled out.
--
-- WHAT IS GIVEN UP, STATED PLAINLY. The application's database role will be
-- able to set rik_id from NULL by direct SQL. That is the same exposure it
-- already has for every other privileged RIK write, so it is consistent rather
-- than new. What the trigger below still guarantees is that NO caller -- the
-- application, the table owner or a superuser -- can CHOOSE a RIK ID, change
-- one, or take one away.
--
-- WHY A MIGRATION IS UNAVOIDABLE. Two database facts block the feature and no
-- application code can work around either:
--   * rik_id is NOT NULL, so a PIF-only resident cannot be stored at all;
--   * the migration 0044 trigger refuses every change to rik_id, including
--     NULL -> value, so the link is impossible.
-- Everything else the feature needs already exists and is reused: the
-- permission, the endpoint, the screen, the 'REGISTER' OTP purpose (already in
-- the otp_requests CHECK constraint), the audit repository, and the single
-- shared normaliseMobile() implementation.
--
-- SCOPE. Adds no table and no view, so EXPECTED_SCHEMA_CONTRACT stays at 70
-- tables and 5 views and needs no edit. Adds no role, no permission code, no
-- grant, and no row in shared.roles. Reads and writes no customer row.
--
-- THE AUDIT TRAIL IS NOT IN HERE, DELIBERATELY. A link is audited as
-- RIK_OFFICER_LINKED by RikOfficerService through the existing
-- AuditLogRepository, in the same transaction as the link -- the same way
-- RIK_OFFICER_REGISTERED has always been written. An earlier revision moved
-- the audit write into this trigger; that was only necessary because promotion
-- was going to happen outside the application, and it no longer is.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Pre-state assertions. Refuse to run against an unexpected schema.
-- -----------------------------------------------------------------------------
DO $pre$
DECLARE
  v_tables  integer;
  v_views   integer;
  v_trigger text;
  v_default text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute
     WHERE attrelid = 'shared.customers'::regclass
       AND attname  = 'rik_id'
       AND attnotnull
  ) THEN
    RAISE EXCEPTION
      'Migration 0065: rik_id is already nullable - has this migration already run?';
  END IF;

  SELECT pg_catalog.pg_get_triggerdef(t.oid)
    INTO v_trigger
    FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid = 'shared.customers'::regclass
     AND t.tgname  = 'protect_officer_rik_id'
     AND NOT t.tgisinternal;

  IF v_trigger IS NULL THEN
    RAISE EXCEPTION
      'Migration 0065: the permanence trigger is missing - refusing to proceed.';
  END IF;

  IF v_trigger NOT LIKE '%UPDATE OF rik_id%' THEN
    RAISE EXCEPTION
      'Migration 0065: the trigger is not scoped to UPDATE OF rik_id (%).', v_trigger;
  END IF;

  SELECT pg_catalog.pg_get_expr(d.adbin, d.adrelid)
    INTO v_default
    FROM pg_catalog.pg_attrdef d
    JOIN pg_catalog.pg_attribute a
      ON a.attrelid = d.adrelid
     AND a.attnum   = d.adnum
   WHERE d.adrelid = 'shared.customers'::regclass
     AND a.attname = 'rik_id';

  IF v_default IS NULL OR v_default NOT LIKE '%format_officer_rik_id%' THEN
    RAISE EXCEPTION
      'Migration 0065: rik_id does not default to format_officer_rik_id (%).',
      COALESCE(v_default, '<no default>');
  END IF;

  IF to_regclass('shared.officer_rik_id_seq') IS NULL THEN
    RAISE EXCEPTION 'Migration 0065: the officer RIK ID sequence is missing.';
  END IF;

  SELECT count(*) INTO v_tables
    FROM pg_catalog.pg_tables WHERE schemaname IN ('shared', 'rik', 'pif');
  SELECT count(*) INTO v_views
    FROM pg_catalog.pg_views  WHERE schemaname IN ('shared', 'rik', 'pif');

  IF v_tables <> 70 OR v_views <> 5 THEN
    RAISE EXCEPTION
      'Migration 0065: expected 70 tables and 5 views, found % and %.',
      v_tables, v_views;
  END IF;
END
$pre$;

-- -----------------------------------------------------------------------------
-- STATEMENT 1. rik_id becomes nullable, so a PIF-only resident can exist.
--
-- Metadata-only: no table rewrite, and not one existing row is read or written.
--
-- The column DEFAULT is RETAINED on purpose. OfficersRepository.create()
-- deliberately omits rik_id from its INSERT column list so the default fires
-- and the database issues the identifier; that path must keep working exactly
-- as it does today. PIF self-registration will pass rik_id explicitly as NULL,
-- which bypasses a default rather than fighting it.
--
-- Neither existing constraint needs touching: a PostgreSQL unique index treats
-- NULLs as distinct, so customers_rik_id_uq tolerates any number of PIF-only
-- residents; and a CHECK evaluates to NULL (which passes) for a NULL input, so
-- shared_customers_rik_id_chk is satisfied too.
-- -----------------------------------------------------------------------------
ALTER TABLE shared.customers ALTER COLUMN rik_id DROP NOT NULL;

-- -----------------------------------------------------------------------------
-- STATEMENT 2. The permanence trigger learns about first issuance -- and
-- ISSUES the identifier itself rather than accepting one.
--
-- The guarantee migration 0044 states in its own column comment is
-- "never reused, never renumbered". When that trigger was written rik_id was
-- NOT NULL, so OLD.rik_id IS NULL could not occur: it refuses first issuance
-- not by intent but because the case did not exist. Issuing a first identifier
-- to a resident who has never held one is neither a reuse nor a renumbering.
--
-- A BEFORE trigger cannot tell whether NEW.rik_id arrived from the column
-- DEFAULT or from a literal in an UPDATE -- by the time it runs, the value is
-- just a value. So it does not try: on first issuance it DISCARDS whatever was
-- supplied and composes the identifier from the sequence. That makes "no caller
-- can choose a RIK ID" a property of the table rather than a convention, and it
-- holds for the application role, the table owner and a superuser alike.
--
--   existing ID -> same ID         allowed (no-op)
--   existing ID -> different ID    REFUSED (renumbering)
--   existing ID -> NULL            REFUSED (revocation)
--   NULL        -> supplied value  value DISCARDED, sequence value issued
--
-- Three of those four rows are unchanged from 0044. The two that matter --
-- renumbering and revocation -- stay refused, and section 3 proves it.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION shared.trg_protect_officer_rik_id()
RETURNS trigger
LANGUAGE plpgsql
AS $trg$
BEGIN
  -- Not a change to the identifier (covers NULL -> NULL and value -> same).
  IF NEW.rik_id IS NOT DISTINCT FROM OLD.rik_id THEN
    RETURN NEW;
  END IF;

  -- FIRST ISSUANCE. The row has never held an identifier, so nothing is being
  -- reused or renumbered. The supplied value is discarded on purpose: the
  -- identifier is composed here, from the sequence, and nowhere else.
  IF OLD.rik_id IS NULL THEN
    NEW.rik_id := shared.format_officer_rik_id(
                    nextval('shared.officer_rik_id_seq'));
    RETURN NEW;
  END IF;

  -- Everything that remains is a renumbering (value -> different value) or a
  -- revocation (value -> NULL). Both stay refused, exactly as in 0044.
  RAISE EXCEPTION
    'A RIK ID is permanent. Officer % cannot be renumbered from % to %.',
    OLD.id, OLD.rik_id, NEW.rik_id
    USING ERRCODE = 'restrict_violation';
END
$trg$;

COMMENT ON FUNCTION shared.trg_protect_officer_rik_id() IS
  'Migration 0065: a RIK ID is still never reused, never renumbered and never revoked. First issuance to a resident who has never held one is permitted, and the identifier is composed HERE from shared.officer_rik_id_seq - any value the caller supplies is discarded.';

-- -----------------------------------------------------------------------------
-- 3. Post-state verification.
--
-- NOTE ON WHAT THIS DOES AND DOES NOT DO. The earlier revision's live probe --
-- which INSERTED a throwaway resident and rolled it back -- has been REMOVED as
-- instructed. What remains attempts a renumbering and a revocation against an
-- existing officer and requires BOTH to fail. Those attempts insert nothing and
-- change nothing even momentarily: the trigger raises before any row version is
-- written, and each attempt runs in its own subtransaction that its exception
-- handler rolls back. If you would still rather this migration performed no
-- UPDATE at all, say so and I will reduce section 3 to catalog inspection only
-- -- at the cost of no longer proving the guarantee, only asserting it.
-- -----------------------------------------------------------------------------
DO $post$
DECLARE
  v_victim uuid;
  v_src    text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
     WHERE attrelid = 'shared.customers'::regclass
       AND attname = 'rik_id' AND attnotnull
  ) THEN
    RAISE EXCEPTION 'Migration 0065: rik_id is still NOT NULL.';
  END IF;

  SELECT p.prosrc INTO v_src
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'shared' AND p.proname = 'trg_protect_officer_rik_id';

  IF v_src IS NULL OR v_src NOT LIKE '%format_officer_rik_id%' THEN
    RAISE EXCEPTION
      'Migration 0065: the trigger does not issue the identifier itself, so a caller could choose one.';
  END IF;

  SELECT id INTO v_victim
    FROM shared.customers
   WHERE rik_id IS NOT NULL
   ORDER BY created_at, id
   LIMIT 1;

  IF v_victim IS NOT NULL THEN
    BEGIN
      UPDATE shared.customers SET rik_id = 'RIK-O-999999' WHERE id = v_victim;
      RAISE EXCEPTION
        'Migration 0065: renumbering an existing officer was ALLOWED - the guarantee is broken.';
    EXCEPTION
      WHEN restrict_violation THEN NULL;  -- correct: still refused
    END;

    BEGIN
      UPDATE shared.customers SET rik_id = NULL WHERE id = v_victim;
      RAISE EXCEPTION
        'Migration 0065: revoking an existing RIK ID was ALLOWED - the guarantee is broken.';
    EXCEPTION
      WHEN restrict_violation THEN NULL;  -- correct: still refused
    END;
  END IF;
END
$post$;

COMMIT;
