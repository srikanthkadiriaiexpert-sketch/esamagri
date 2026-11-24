-- =============================================================================
-- Migration 0027: correct the delete policy on rik.entitlement_selections
-- Phase 3B STEP 11B — defect found while implementing the calculation engine.
--
-- THE DEFECT
-- ----------
-- Migration 0025 revoked DELETE on rik.entitlement_selections from
-- app_rik, grouping it with the configuration tables under the rule
-- "configuration is deactivated, never deleted, because a confirmed
-- selection depends on it".
--
-- That was too broad. A selection is not configuration:
--
--   * a DRAFT is working state. A customer who abandons a draft, or an
--     administrator clearing test data, has every reason to remove it,
--     and a partial unique index already allows only one open draft per
--     customer per period — so an undeletable abandoned draft blocks
--     that customer permanently.
--
--   * a CONFIRMED selection is the thing that genuinely must survive.
--
-- A blanket REVOKE could not tell those apart: it blocked the harmless
-- case and, because DELETE was simply unavailable, expressed the real
-- protection only as an absence.
--
-- THE FIX
-- -------
-- Restore DELETE, and protect the case that actually matters with a
-- trigger that refuses to remove a CONFIRMED selection. This is stricter
-- than the grant it replaces, not looser: previously a superuser or the
-- owner could delete confirmed history without resistance, and now
-- nothing can, regardless of role.
--
-- No table, column, constraint or index is dropped. rik.entitlement_pools,
-- rik.pool_scales, rik.pool_conversions and rik.provisions keep their
-- REVOKE exactly as 0025 set it — configuration is still never deleted.
-- =============================================================================

SET ROLE esamagri_owner;

CREATE OR REPLACE FUNCTION rik.trg_protect_confirmed_selection()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'CONFIRMED' THEN
    RAISE EXCEPTION
      'A confirmed RIK selection cannot be deleted (selection %). Cancel it instead.', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION rik.trg_protect_confirmed_selection() IS
  'Refuses deletion of a CONFIRMED rik.entitlement_selections row, so the rule snapshot that makes a past issue reproducible can never be destroyed. STEP 11B.';

CREATE TRIGGER protect_confirmed_selection
  BEFORE DELETE ON rik.entitlement_selections
  FOR EACH ROW EXECUTE FUNCTION rik.trg_protect_confirmed_selection();

-- Restore the grant the trigger now polices. Draft rows are removable;
-- confirmed rows are not, for anyone.
GRANT DELETE ON rik.entitlement_selections TO app_rik;

RESET ROLE;
