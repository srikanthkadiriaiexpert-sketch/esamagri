-- =============================================================================
-- Migration 0016: PIF trigger functions + trigger wiring
--   pif.trg_validate_customer_ref()             — Section 04/06
--   pif.trg_validate_cashier_ref()               — Section 04/06
--   pif.trg_validate_handled_by_ref()            — Section 04/21
--   pif.trg_validate_order_status_transition()   — Section 19
--   pif.trg_validate_bill_status_transition()    — Section 18
--   pif.trg_bill_items_immutable_after_finalize()— Section 18 (see note below)
--
-- Reconciliation note (see docs/reconciliation-report.md): Section 18 states
-- the "no UPDATE to pos_bill_items once the parent bill is FINALIZED" rule
-- is an application-layer rule because "cross-row temporal rules aren't
-- expressible as a plain CHECK". A plain CHECK cannot do this, but a trigger
-- can — the same reasoning Phase 2 itself uses for shared.audit_log
-- (Section 24's trigger backstop). Implementing the identical documented
-- rule as a DB-level trigger backstop is not a new business rule; it is the
-- more robust mechanism for a rule Phase 2 already specifies, consistent
-- with the audit_log precedent, and is required to satisfy the "finalized
-- bill immutability" DB-level test scenario from the Phase 3A brief.
-- =============================================================================

CREATE OR REPLACE FUNCTION pif.trg_validate_customer_ref()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM shared.assert_customer_exists(NEW.customer_id);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION pif.trg_validate_customer_ref() IS
  'Thin wrapper calling shared.assert_customer_exists(). Attached to every pif.* table carrying customer_id. shared.assert_customer_exists() itself no-ops on NULL (e.g. an anonymous COUNTER pos_bills row). Phase 2 Section 04, Revision 1.';

CREATE TRIGGER validate_customer_ref
  BEFORE INSERT OR UPDATE OF customer_id ON pif.carts
  FOR EACH ROW EXECUTE FUNCTION pif.trg_validate_customer_ref();

CREATE TRIGGER validate_customer_ref
  BEFORE INSERT OR UPDATE OF customer_id ON pif.orders
  FOR EACH ROW EXECUTE FUNCTION pif.trg_validate_customer_ref();

CREATE TRIGGER validate_customer_ref
  BEFORE INSERT OR UPDATE OF customer_id ON pif.pos_bills
  FOR EACH ROW EXECUTE FUNCTION pif.trg_validate_customer_ref();

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pif.trg_validate_cashier_ref()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM shared.assert_staff_user_exists(NEW.cashier_id);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION pif.trg_validate_cashier_ref() IS
  'Thin wrapper calling shared.assert_staff_user_exists() against NEW.cashier_id. Attached to pif.cashier_shifts and pif.pos_bills. No-ops on NULL (pos_bills.cashier_id is nullable for ONLINE). Phase 2 Section 04, Revision 1.';

CREATE TRIGGER validate_cashier_ref
  BEFORE INSERT OR UPDATE OF cashier_id ON pif.cashier_shifts
  FOR EACH ROW EXECUTE FUNCTION pif.trg_validate_cashier_ref();

CREATE TRIGGER validate_cashier_ref
  BEFORE INSERT OR UPDATE OF cashier_id ON pif.pos_bills
  FOR EACH ROW EXECUTE FUNCTION pif.trg_validate_cashier_ref();

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pif.trg_validate_handled_by_ref()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM shared.assert_staff_user_exists(NEW.handled_by);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION pif.trg_validate_handled_by_ref() IS
  'Thin wrapper calling shared.assert_staff_user_exists() against NEW.handled_by. Attached to pif.cash_movements (handled_by is NOT NULL there). Phase 2 Section 04/21, Revision 1.';

CREATE TRIGGER validate_handled_by_ref
  BEFORE INSERT OR UPDATE OF handled_by ON pif.cash_movements
  FOR EACH ROW EXECUTE FUNCTION pif.trg_validate_handled_by_ref();

-- ---------------------------------------------------------------------------
-- pif.orders status transition — Section 19.
-- Linear path PLACED..DELIVERED->COD_COLLECTED->SALE_FINALIZED; cancellation
-- ("Cancellation/failure is valid from PLACED through DELIVERED") covers
-- both CANCELLED and NOT_DELIVERED and is NOT reachable from COD_COLLECTED
-- or SALE_FINALIZED, per Section 19's literal wording.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pif.trg_validate_order_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.status = 'PLACED'            AND NEW.status = 'ACCEPTED')        OR
    (OLD.status = 'ACCEPTED'          AND NEW.status = 'PREPARING')       OR
    (OLD.status = 'PREPARING'         AND NEW.status = 'READY_PICKED')    OR
    (OLD.status = 'READY_PICKED'      AND NEW.status = 'OUT_FOR_DELIVERY') OR
    (OLD.status = 'OUT_FOR_DELIVERY'  AND NEW.status = 'DELIVERED')       OR
    (OLD.status = 'DELIVERED'         AND NEW.status = 'COD_COLLECTED')   OR
    (OLD.status = 'COD_COLLECTED'     AND NEW.status = 'SALE_FINALIZED')  OR
    (OLD.status IN ('PLACED','ACCEPTED','PREPARING','READY_PICKED','OUT_FOR_DELIVERY','DELIVERED')
       AND NEW.status IN ('CANCELLED','NOT_DELIVERED'))
  ) THEN
    RAISE EXCEPTION 'invalid pif.orders status transition: % -> % (order %)', OLD.status, NEW.status, OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION pif.trg_validate_order_status_transition() IS
  'Rejects a status write not reachable from the prior status per the Section 19 lifecycle table. CANCELLED/NOT_DELIVERED reachable only from PLACED through DELIVERED, matching Section 19''s literal "valid from PLACED through DELIVERED" wording — not from COD_COLLECTED or SALE_FINALIZED. See docs/reconciliation-report.md for the ambiguity this resolves.';

CREATE TRIGGER validate_status_transition
  BEFORE UPDATE OF status ON pif.orders
  FOR EACH ROW EXECUTE FUNCTION pif.trg_validate_order_status_transition();

-- ---------------------------------------------------------------------------
-- pif.pos_bills status transition — Section 18: OPEN -> FINALIZED ->
-- (CANCELLED | RETURNED), implemented literally per the arrow notation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pif.trg_validate_bill_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.status = 'OPEN'      AND NEW.status = 'FINALIZED') OR
    (OLD.status = 'FINALIZED' AND NEW.status IN ('CANCELLED','RETURNED'))
  ) THEN
    RAISE EXCEPTION 'invalid pif.pos_bills status transition: % -> % (bill %)', OLD.status, NEW.status, OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION pif.trg_validate_bill_status_transition() IS
  'OPEN -> FINALIZED -> (CANCELLED | RETURNED), Section 18. Literal reading of the arrow notation: an OPEN bill cannot be voided directly to CANCELLED. If real-world usage needs to void an unfinalized bill, that is a Phase 2 addendum, not a Phase 3A invention — see docs/reconciliation-report.md.';

CREATE TRIGGER validate_status_transition
  BEFORE UPDATE OF status ON pif.pos_bills
  FOR EACH ROW EXECUTE FUNCTION pif.trg_validate_bill_status_transition();

-- ---------------------------------------------------------------------------
-- pif.pos_bill_items immutability once the parent bill is FINALIZED —
-- Section 18. DB-level trigger backstop for the documented application rule
-- (see file header note).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pif.trg_bill_items_immutable_after_finalize()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_bill_status text;
BEGIN
  SELECT status INTO v_bill_status FROM pif.pos_bills WHERE id = OLD.bill_id;

  IF v_bill_status = 'FINALIZED' THEN
    RAISE EXCEPTION 'pif.pos_bill_items row % cannot be modified — parent bill % is FINALIZED (Section 18: corrections happen only via pif.returns)', OLD.id, OLD.bill_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION pif.trg_bill_items_immutable_after_finalize() IS
  'DB-level backstop for Section 18''s "no UPDATE to pos_bill_items once the parent bill is FINALIZED" rule — corrections only ever happen through a new pif.returns row. See file header note on why this is implemented as a trigger.';

CREATE TRIGGER bill_items_immutable_after_finalize
  BEFORE UPDATE ON pif.pos_bill_items
  FOR EACH ROW EXECUTE FUNCTION pif.trg_bill_items_immutable_after_finalize();
