-- =============================================================================
-- Test suite 020: PIF billing + inventory scenarios
--   #8  PIF stock deduction (SALE transaction correctness)
--   #10 Negative-stock prevention (pif.inventory CHECK constraints), PIF half
--   #11 Finalized bill immutability (pif.pos_bill_items trigger backstop)
--   #12 Online-order/bill uniqueness (pos_bills.online_order_id UQ)
--   #13 COD duplicate prevention (cash_movements partial-UQ)
--   #14 Cash movement integrity (append-only + CHECK constraints)
--   #20 PIF invalid order state transitions (pif.orders status trigger)
--
-- Whole file runs in one transaction, rolled back at the end.
-- =============================================================================
\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  v_customer_id   uuid;
  v_staff_id      uuid;
  v_prod_id       uuid;
  v_bill_id       uuid;
  v_bill_item_id  uuid;
  v_shift_id      uuid;
  v_order_id      uuid;
  v_qty           numeric;
BEGIN
  -- ---- fixtures --------------------------------------------------------
  INSERT INTO shared.customers (id, mobile_number, name)
  VALUES (shared.uuid_generate_v7(), '9990000020', 'Test Customer PIF')
  RETURNING id INTO v_customer_id;

  INSERT INTO shared.users (id, username, password_hash, display_name, status)
  VALUES (shared.uuid_generate_v7(), 'test_cashier_020', 'x', 'Test Cashier', 'ACTIVE')
  RETURNING id INTO v_staff_id;

  INSERT INTO pif.products (id, sku, name, unit, selling_price)
  VALUES (shared.uuid_generate_v7(), 'TEST-PIF-A', 'Test PIF Product A', 'kg', 50.00)
  RETURNING id INTO v_prod_id;

  INSERT INTO pif.inventory (product_id, quantity_on_hand) VALUES (v_prod_id, 20);

  INSERT INTO pif.cashier_shifts (id, cashier_id, opening_cash)
  VALUES (shared.uuid_generate_v7(), v_staff_id, 500.00)
  RETURNING id INTO v_shift_id;

  -- =======================================================================
  -- #8 PIF stock deduction (a SALE transaction correctly deducts on_hand)
  -- =======================================================================
  INSERT INTO pif.pos_bills (id, bill_number, source, shift_id, cashier_id, customer_id, grand_total)
  VALUES (shared.uuid_generate_v7(), 'TEST-BILL-020-1', 'COUNTER', v_shift_id, v_staff_id, v_customer_id, 150.00)
  RETURNING id INTO v_bill_id;

  DECLARE
    v_sale_txn_id uuid;
  BEGIN
    INSERT INTO pif.inventory_transactions (id, product_id, type, qty, reference_type, reference_id)
    VALUES (shared.uuid_generate_v7(), v_prod_id, 'SALE', 3, 'PIF_POS_BILL', v_bill_id)
    RETURNING id INTO v_sale_txn_id;

    UPDATE pif.inventory SET quantity_on_hand = quantity_on_hand - 3 WHERE product_id = v_prod_id;

    INSERT INTO pif.pos_bill_items (id, bill_id, product_id, qty, unit_price, line_total, inventory_txn_id)
    VALUES (shared.uuid_generate_v7(), v_bill_id, v_prod_id, 3, 50.00, 150.00, v_sale_txn_id)
    RETURNING id INTO v_bill_item_id;
  END;

  SELECT quantity_on_hand INTO v_qty FROM pif.inventory WHERE product_id = v_prod_id;
  IF v_qty <> 17 THEN
    RAISE EXCEPTION 'FAIL #8: after selling 3 of 20, on_hand should be 17, got %', v_qty;
  END IF;
  RAISE NOTICE 'PASS #8: SALE transaction correctly deducts pif.inventory.quantity_on_hand';

  -- =======================================================================
  -- #10 Negative-stock prevention (PIF half)
  -- =======================================================================
  BEGIN
    UPDATE pif.inventory SET quantity_on_hand = -5 WHERE product_id = v_prod_id;
    RAISE EXCEPTION 'FAIL #10: negative quantity_on_hand should have been rejected';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS #10a (PIF): pif_inventory_on_hand_chk rejects negative stock';
  END;

  BEGIN
    UPDATE pif.inventory SET quantity_reserved = quantity_on_hand + 1 WHERE product_id = v_prod_id;
    RAISE EXCEPTION 'FAIL #10: quantity_reserved > quantity_on_hand should have been rejected';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS #10b (PIF): pif_inventory_reserved_chk rejects reserved > on_hand';
  END;

  -- Also exercise the row-lock read pattern Section 17 mandates (no
  -- overselling): a SELECT ... FOR UPDATE must succeed and return the
  -- current balance for the caller to check before deducting.
  PERFORM quantity_on_hand FROM pif.inventory WHERE product_id = v_prod_id FOR UPDATE;
  RAISE NOTICE 'PASS #10c (PIF): SELECT ... FOR UPDATE row-lock path on pif.inventory succeeds';

  -- =======================================================================
  -- #11 Finalized bill immutability
  -- =======================================================================
  UPDATE pif.pos_bills SET status = 'FINALIZED', finalized_at = now(), cash_received = 150.00, change_given = 0 WHERE id = v_bill_id;

  BEGIN
    UPDATE pif.pos_bill_items SET qty = 99 WHERE id = v_bill_item_id;
    RAISE EXCEPTION 'FAIL #11: editing a pos_bill_items row of a FINALIZED bill should have been rejected';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS #11: pif.trg_bill_items_immutable_after_finalize blocks edits once the parent bill is FINALIZED';
  END;

  -- =======================================================================
  -- #12 Online-order/bill uniqueness
  -- =======================================================================
  INSERT INTO pif.orders (id, order_number, customer_id, status)
  VALUES (shared.uuid_generate_v7(), 'TEST-ORD-PIF-020-1', v_customer_id, 'PLACED')
  RETURNING id INTO v_order_id;

  INSERT INTO pif.pos_bills (id, bill_number, source, customer_id, online_order_id, status, grand_total, finalized_at)
  VALUES (shared.uuid_generate_v7(), 'TEST-BILL-020-2', 'ONLINE', v_customer_id, v_order_id, 'FINALIZED', 75.00, now());

  BEGIN
    INSERT INTO pif.pos_bills (id, bill_number, source, customer_id, online_order_id, status, grand_total, finalized_at)
    VALUES (shared.uuid_generate_v7(), 'TEST-BILL-020-3', 'ONLINE', v_customer_id, v_order_id, 'FINALIZED', 75.00, now());
    RAISE EXCEPTION 'FAIL #12: a second pos_bills row for the same online_order_id should have been rejected';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS #12: pif_pos_bills_online_order_uq guarantees a 1:1 order<->bill link';
  END;

  -- =======================================================================
  -- #13 COD duplicate prevention
  -- =======================================================================
  INSERT INTO pif.cash_movements (id, movement_type, amount, order_id, handled_by)
  VALUES (shared.uuid_generate_v7(), 'COD_COLLECTED', 75.00, v_order_id, v_staff_id);

  BEGIN
    INSERT INTO pif.cash_movements (id, movement_type, amount, order_id, handled_by)
    VALUES (shared.uuid_generate_v7(), 'COD_COLLECTED', 75.00, v_order_id, v_staff_id);
    RAISE EXCEPTION 'FAIL #13: a second COD_COLLECTED movement for the same order should have been rejected';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS #13: pif_cash_movements_cod_order_uq guarantees one COD collection event per order';
  END;

  -- =======================================================================
  -- #14 Cash movement integrity
  -- =======================================================================
  BEGIN
    INSERT INTO pif.cash_movements (id, movement_type, amount, shift_id, bill_id, handled_by)
    VALUES (shared.uuid_generate_v7(), 'CASH_SALE', -10.00, v_shift_id, v_bill_id, v_staff_id);
    RAISE EXCEPTION 'FAIL #14: a non-positive cash movement amount should have been rejected';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS #14a: pif_cash_movements_amount_chk rejects amount <= 0 (direction is carried by movement_type, not sign)';
  END;

  BEGIN
    INSERT INTO pif.cash_movements (id, movement_type, amount, shift_id, bill_id, handled_by)
    VALUES (shared.uuid_generate_v7(), 'NOT_A_TYPE', 10.00, v_shift_id, v_bill_id, v_staff_id);
    RAISE EXCEPTION 'FAIL #14: an unrecognized movement_type should have been rejected';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS #14b: pif_cash_movements_type_chk rejects an unrecognized movement_type';
  END;

  INSERT INTO pif.cash_movements (id, movement_type, amount, shift_id, bill_id, handled_by)
  VALUES (shared.uuid_generate_v7(), 'CASH_SALE', 150.00, v_shift_id, v_bill_id, v_staff_id);
  -- Append-only enforcement for pif.cash_movements is role-grant-based
  -- (app_pif holds INSERT+SELECT only, migration 0018) rather than a
  -- trigger backstop, since this session runs as the owning role
  -- (esamagri_owner), which always bypasses grants. That enforcement is
  -- exercised for real in tests/030 by switching SET ROLE app_pif and
  -- attempting the UPDATE as the actual application role.

  PERFORM 1 FROM pif.cash_movements WHERE bill_id = v_bill_id AND movement_type = 'CASH_SALE';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FAIL #14: expected CASH_SALE cash_movements row not found';
  END IF;
  RAISE NOTICE 'PASS #14c: cash_movements row correctly recorded and attributable (handled_by, bill_id, shift_id)';

  -- =======================================================================
  -- #20 PIF invalid order state transitions
  -- =======================================================================
  DECLARE
    v_ord2 uuid;
  BEGIN
    INSERT INTO pif.orders (id, order_number, customer_id, status)
    VALUES (shared.uuid_generate_v7(), 'TEST-ORD-PIF-020-2', v_customer_id, 'PLACED')
    RETURNING id INTO v_ord2;

    -- invalid: PLACED -> DELIVERED (skips ACCEPTED..OUT_FOR_DELIVERY)
    BEGIN
      UPDATE pif.orders SET status = 'DELIVERED' WHERE id = v_ord2;
      RAISE EXCEPTION 'FAIL #20: PLACED -> DELIVERED should have been rejected';
    EXCEPTION WHEN check_violation THEN
      RAISE NOTICE 'PASS #20a: illegal skip-ahead transition on pif.orders rejected';
    END;

    -- valid path to DELIVERED
    UPDATE pif.orders SET status = 'ACCEPTED' WHERE id = v_ord2;
    UPDATE pif.orders SET status = 'PREPARING' WHERE id = v_ord2;
    UPDATE pif.orders SET status = 'READY_PICKED' WHERE id = v_ord2;
    UPDATE pif.orders SET status = 'OUT_FOR_DELIVERY' WHERE id = v_ord2;
    UPDATE pif.orders SET status = 'DELIVERED' WHERE id = v_ord2;

    -- invalid: DELIVERED -> CANCELLED (cancellation window is PLACED..DELIVERED
    -- per Section 19's literal wording, but once DELIVERED the goods are
    -- physically out — only forward to COD_COLLECTED/SALE_FINALIZED remains)
    -- NOTE: Section 19 literally says the window IS through DELIVERED, so
    -- DELIVERED -> CANCELLED must actually be ACCEPTED here, not rejected.
    -- Re-check with a fresh order for the true negative case instead.
    UPDATE pif.orders SET status = 'COD_COLLECTED' WHERE id = v_ord2;

    -- invalid: COD_COLLECTED -> CANCELLED (past the cancellation window)
    BEGIN
      UPDATE pif.orders SET status = 'CANCELLED' WHERE id = v_ord2;
      RAISE EXCEPTION 'FAIL #20: COD_COLLECTED -> CANCELLED should have been rejected (past the cancellation window)';
    EXCEPTION WHEN check_violation THEN
      RAISE NOTICE 'PASS #20b: cancellation rejected once past DELIVERED (COD_COLLECTED), per Section 19';
    END;

    UPDATE pif.orders SET status = 'SALE_FINALIZED' WHERE id = v_ord2;
    RAISE NOTICE 'PASS #20c: valid full path PLACED..DELIVERED->COD_COLLECTED->SALE_FINALIZED succeeds';
  END;

  DECLARE
    v_ord3 uuid;
  BEGIN
    INSERT INTO pif.orders (id, order_number, customer_id, status)
    VALUES (shared.uuid_generate_v7(), 'TEST-ORD-PIF-020-3', v_customer_id, 'PLACED')
    RETURNING id INTO v_ord3;
    -- valid: PLACED -> CANCELLED (within the cancellation window)
    UPDATE pif.orders SET status = 'CANCELLED' WHERE id = v_ord3;
    RAISE NOTICE 'PASS #20d: PLACED -> CANCELLED accepted (within the cancellation window)';
  END;

  RAISE NOTICE '=== 020_pif_billing_and_inventory.sql: ALL CHECKS PASSED ===';
END;
$$;

ROLLBACK;
