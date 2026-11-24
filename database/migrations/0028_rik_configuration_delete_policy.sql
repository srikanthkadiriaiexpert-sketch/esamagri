-- =============================================================================
-- Migration 0028: correct the delete policy on the four RIK configuration
-- tables (rik.entitlement_pools, rik.pool_scales, rik.pool_conversions,
-- rik.provisions).
--
-- Phase 3B STEP 11C — defect found while building the RIK administration
-- dashboard, which is the first thing that lets a human create these rows.
--
-- THE DEFECT
-- ----------
-- Migration 0025 revoked DELETE on all four configuration tables from
-- app_rik, under the rule:
--
--   "Configuration is DEACTIVATED (is_active = false) or CLOSED
--    (effective_to), never deleted — deleting a rule would destroy the
--    history a confirmed selection depends on."
--
-- The rule is right. The way it was expressed is too broad, in exactly
-- the way migration 0027 already found for rik.entitlement_selections:
-- a blanket REVOKE cannot tell the case that matters from the case that
-- does not.
--
--   * Configuration that has ACTUALLY BEEN USED — a pool, scale,
--     conversion or provision that appears in the rule_snapshot of a
--     CONFIRMED selection — genuinely must survive forever. That
--     snapshot is what makes a past issue reproducible, and a snapshot
--     whose referenced rows have vanished is a snapshot you cannot
--     explain to an auditor.
--
--   * Configuration that has NEVER been used is a different thing
--     entirely. Until STEP 11C these rows could only arrive by SQL, so
--     a mistake was rare and was fixed in SQL. Now a RIK administrator
--     creates them through a screen — and a mistyped pool, a scale
--     entered against the wrong diet, a provision created twice can
--     each be made in one click. Under a blanket REVOKE, every such
--     mistake is permanent: the best an administrator can do is set
--     is_active = false, and the wrong row sits in the configuration
--     list forever, next to the right one, for every administrator who
--     ever reads that screen afterwards.
--
-- A blanket REVOKE blocked the harmless case and, because DELETE was
-- simply unavailable, expressed the protection that matters only as an
-- absence — nothing anywhere actually asserted "used configuration is
-- permanent", so nothing enforced it against the owner or a superuser.
--
-- THE FIX
-- -------
-- Restore DELETE, and state the real rule as a trigger:
--
--   A configuration row cannot be deleted once it has been used to
--   produce a CONFIRMED entitlement selection.
--
-- This is STRICTER than the grant it replaces, not looser:
--
--   * Before, a superuser or the owner could delete a pool that a
--     confirmed selection's snapshot depended on, and nothing objected.
--     Now nothing can, regardless of role.
--
--   * The existing foreign keys already refuse to delete a pool,
--     provision or conversion that a selection LINE or an ELECTION
--     points at, confirmed or not. Those stay exactly as they are —
--     this trigger is an additional refusal, never a replacement. It
--     covers what the foreign keys cannot see: a row that appears only
--     inside a CONFIRMED rule_snapshot. rik.pool_scales has no foreign
--     key pointing at it at all, so for scales this trigger is the only
--     protection there has ever been.
--
-- The check is deliberately conservative: it matches the row's id
-- anywhere in the snapshot document rather than at a particular path,
-- so a snapshot shape that changes in a later step cannot quietly open
-- a hole. A false positive only refuses a delete; a false negative
-- would destroy history.
--
-- Deleting configuration is a rare administrative act (fixing a
-- mistake, not a routine operation), so a scan of the confirmed
-- selections is the right trade for a check that cannot be fooled by a
-- change of snapshot layout.
--
-- NOT CHANGED by this migration: no table, column, constraint or index
-- is added, altered or dropped; the effective-dating model is untouched;
-- deactivating or closing a rule remains the normal way to retire it,
-- and remains the ONLY way for any rule that has been used. The table
-- and view counts the schema contract guard checks are unchanged.
-- =============================================================================

SET ROLE esamagri_owner;

CREATE OR REPLACE FUNCTION rik.trg_protect_used_configuration()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Has any CONFIRMED selection's rule snapshot recorded this row?
  -- If so it is history, and history is not deletable by anyone.
  IF EXISTS (
    SELECT 1
      FROM rik.entitlement_selections s
     WHERE s.status = 'CONFIRMED'
       AND s.rule_snapshot IS NOT NULL
       AND s.rule_snapshot::text LIKE '%' || OLD.id::text || '%'
  ) THEN
    RAISE EXCEPTION
      'RIK configuration row % in %.% has been used by a confirmed entitlement selection and cannot be deleted. Deactivate it (is_active = false) or close it (effective_to) instead.',
      OLD.id, TG_TABLE_SCHEMA, TG_TABLE_NAME
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION rik.trg_protect_used_configuration() IS
  'Refuses deletion of a RIK configuration row that appears in the rule_snapshot of a CONFIRMED selection, so a past issue stays reproducible. Binds every role including the owner. STEP 11C.';

CREATE TRIGGER protect_used_configuration
  BEFORE DELETE ON rik.entitlement_pools
  FOR EACH ROW EXECUTE FUNCTION rik.trg_protect_used_configuration();

CREATE TRIGGER protect_used_configuration
  BEFORE DELETE ON rik.pool_scales
  FOR EACH ROW EXECUTE FUNCTION rik.trg_protect_used_configuration();

CREATE TRIGGER protect_used_configuration
  BEFORE DELETE ON rik.pool_conversions
  FOR EACH ROW EXECUTE FUNCTION rik.trg_protect_used_configuration();

CREATE TRIGGER protect_used_configuration
  BEFORE DELETE ON rik.provisions
  FOR EACH ROW EXECUTE FUNCTION rik.trg_protect_used_configuration();

-- Restore the grant the triggers now police. An unused configuration row
-- can be removed; a used one cannot, for anyone.
GRANT DELETE ON rik.entitlement_pools  TO app_rik;
GRANT DELETE ON rik.pool_scales        TO app_rik;
GRANT DELETE ON rik.pool_conversions   TO app_rik;
GRANT DELETE ON rik.provisions         TO app_rik;

RESET ROLE;
