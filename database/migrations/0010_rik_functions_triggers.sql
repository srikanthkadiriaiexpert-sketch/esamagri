-- =============================================================================
-- Migration 0010: RIK trigger functions + trigger wiring
--   rik.trg_validate_customer_ref()           — Section 04/11
--   rik.trg_validate_order_status_transition()— Section 08
--   rik.trg_validate_ledger_product_match()   — Section 05/15
-- =============================================================================

CREATE OR REPLACE FUNCTION rik.trg_validate_customer_ref()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM shared.assert_customer_exists(NEW.customer_id);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION rik.trg_validate_customer_ref() IS
  'Thin wrapper calling shared.assert_customer_exists(). Attached to every rik.* table carrying customer_id. Phase 2 Section 04, Revision 1.';

CREATE TRIGGER validate_customer_ref
  BEFORE INSERT OR UPDATE OF customer_id ON rik.carts
  FOR EACH ROW EXECUTE FUNCTION rik.trg_validate_customer_ref();

CREATE TRIGGER validate_customer_ref
  BEFORE INSERT OR UPDATE OF customer_id ON rik.orders
  FOR EACH ROW EXECUTE FUNCTION rik.trg_validate_customer_ref();

CREATE TRIGGER validate_customer_ref
  BEFORE INSERT OR UPDATE OF customer_id ON rik.entitlements
  FOR EACH ROW EXECUTE FUNCTION rik.trg_validate_customer_ref();

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rik.trg_validate_order_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW; -- not a transition; some other column changed
  END IF;

  IF NOT (
    (OLD.status = 'DRAFT'              AND NEW.status = 'CONFIRMED')        OR
    (OLD.status = 'CONFIRMED'          AND NEW.status = 'READY')            OR
    (OLD.status = 'READY'              AND NEW.status = 'COLLECTED')        OR
    (OLD.status = 'READY'              AND NEW.status = 'OUT_FOR_DELIVERY') OR
    (OLD.status = 'OUT_FOR_DELIVERY'   AND NEW.status = 'DELIVERED')        OR
    (OLD.status = 'OUT_FOR_DELIVERY'   AND NEW.status = 'NOT_COLLECTED')    OR
    (OLD.status = 'READY'              AND NEW.status = 'NOT_COLLECTED')    OR
    (OLD.status IN ('DRAFT','CONFIRMED','READY','OUT_FOR_DELIVERY') AND NEW.status = 'CANCELLED') OR
    (OLD.status IN ('COLLECTED','DELIVERED','NOT_COLLECTED','CANCELLED') AND NEW.status = 'CLOSED')
  ) THEN
    RAISE EXCEPTION 'invalid rik.orders status transition: % -> % (order %)', OLD.status, NEW.status, OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status = 'COLLECTED' AND NEW.fulfillment_type <> 'PICKUP' THEN
    RAISE EXCEPTION 'COLLECTED is reachable only for PICKUP orders (order %, fulfillment_type=%)', OLD.id, NEW.fulfillment_type
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status IN ('OUT_FOR_DELIVERY','DELIVERED') AND NEW.fulfillment_type <> 'DELIVERY' THEN
    RAISE EXCEPTION '% is reachable only for DELIVERY orders (order %, fulfillment_type=%)', NEW.status, OLD.id, NEW.fulfillment_type
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION rik.trg_validate_order_status_transition() IS
  'Rejects a status write not reachable from the prior status per the Section 08 transition table, and enforces PICKUP/DELIVERY-only reachability for COLLECTED vs OUT_FOR_DELIVERY/DELIVERED.';

CREATE TRIGGER validate_status_transition
  BEFORE UPDATE OF status ON rik.orders
  FOR EACH ROW EXECUTE FUNCTION rik.trg_validate_order_status_transition();

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rik.trg_validate_ledger_product_match()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_reserve_product uuid;
BEGIN
  SELECT product_id INTO v_reserve_product
  FROM rik.entitlement_ledger
  WHERE id = NEW.related_entry_id;

  IF v_reserve_product IS DISTINCT FROM NEW.product_id THEN
    RAISE EXCEPTION 'entitlement_ledger % (type=%) product_id % does not match the RESERVE row % it closes (product_id %)',
      NEW.id, NEW.type, NEW.product_id, NEW.related_entry_id, v_reserve_product
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION rik.trg_validate_ledger_product_match() IS
  'Rejects a RELEASE/ISSUE row whose product_id does not match the RESERVE row it closes via related_entry_id — a category-mode RESERVE on Product B can only be closed as Product B. Phase 2 Section 05, 15.';

CREATE TRIGGER validate_ledger_product_match
  BEFORE INSERT ON rik.entitlement_ledger
  FOR EACH ROW
  WHEN (NEW.type IN ('RELEASE','ISSUE'))
  EXECUTE FUNCTION rik.trg_validate_ledger_product_match();
