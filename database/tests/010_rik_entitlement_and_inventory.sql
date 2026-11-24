-- =============================================================================
-- Test suite 010: RIK entitlement + inventory scenarios
--   #2  Entitlement calculation (rik.v_entitlement_balance correctness)
--   #3  Category entitlement across products (category-mode pool shared by
--       multiple products, per-product breakdown via
--       rik.v_entitlement_consumption_by_product)
--   #5  Duplicate RESERVE closure prevention (related_entry_id partial-UQ +
--       ledger product-match trigger)
--   #6  RIK reserve/release/issue full cycle correctness
--   #7  RIK invalid state transitions (rik.orders status trigger)
--   #10 Negative-stock prevention (rik.inventory CHECK constraints), RIK half
--
-- Whole file runs in one transaction, rolled back at the end — no residue
-- left in the database. Nested BEGIN/EXCEPTION blocks (each an implicit
-- PL/pgSQL savepoint) isolate assertions that expect failure.
-- =============================================================================
\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  v_customer_id       uuid;
  v_period_id          uuid;
  v_prod_a             uuid;
  v_prod_b             uuid;
  v_prod_c             uuid;
  v_category_id        uuid;
  v_ent_product_id      uuid; -- product-mode entitlement (Product A)
  v_ent_category_id     uuid; -- category-mode entitlement (covers B and C)
  v_reserve_id          uuid;
  v_reserve2_id         uuid;
  v_bad_id              uuid;
  v_available           numeric;
  v_reserved            numeric;
  v_row                 record;
BEGIN
  -- ---- fixtures --------------------------------------------------------
  INSERT INTO shared.customers (id, mobile_number, name)
  VALUES (shared.uuid_generate_v7(), '9990000010', 'Test Customer RIK')
  RETURNING id INTO v_customer_id;

  INSERT INTO rik.entitlement_periods (id, name, start_date, end_date, status)
  VALUES (shared.uuid_generate_v7(), 'TEST-2099-01', '2099-01-01', '2099-01-31', 'ACTIVE')
  RETURNING id INTO v_period_id;

  INSERT INTO rik.categories (id, name) VALUES (shared.uuid_generate_v7(), 'TEST-Category-X')
  RETURNING id INTO v_category_id;

  INSERT INTO rik.products (id, sku, name, category_id, unit) VALUES
    (shared.uuid_generate_v7(), 'TEST-RIK-A', 'Test Product A', v_category_id, 'kg')
  RETURNING id INTO v_prod_a;
  INSERT INTO rik.products (id, sku, name, category_id, unit) VALUES
    (shared.uuid_generate_v7(), 'TEST-RIK-B', 'Test Product B', v_category_id, 'kg')
  RETURNING id INTO v_prod_b;
  INSERT INTO rik.products (id, sku, name, category_id, unit) VALUES
    (shared.uuid_generate_v7(), 'TEST-RIK-C', 'Test Product C', v_category_id, 'kg')
  RETURNING id INTO v_prod_c;

  INSERT INTO rik.inventory (product_id, quantity_on_hand) VALUES
    (v_prod_a, 100), (v_prod_b, 100), (v_prod_c, 100);

  -- product-mode entitlement: 10kg of Product A
  INSERT INTO rik.entitlements (id, customer_id, product_id, period_id, allocated_qty, unit)
  VALUES (shared.uuid_generate_v7(), v_customer_id, v_prod_a, v_period_id, 10, 'kg')
  RETURNING id INTO v_ent_product_id;

  -- category-mode entitlement: 5kg from category X, redeemable as B or C
  INSERT INTO rik.entitlements (id, customer_id, category_id, period_id, allocated_qty, unit)
  VALUES (shared.uuid_generate_v7(), v_customer_id, v_category_id, v_period_id, 5, 'kg')
  RETURNING id INTO v_ent_category_id;

  -- =======================================================================
  -- #2 Entitlement calculation
  -- =======================================================================
  SELECT available INTO v_available FROM rik.v_entitlement_balance WHERE entitlement_id = v_ent_product_id;
  IF v_available <> 10 THEN
    RAISE EXCEPTION 'FAIL #2: fresh product-mode entitlement available should be 10, got %', v_available;
  END IF;

  -- RESERVE 4kg of Product A
  INSERT INTO rik.entitlement_ledger (id, entitlement_id, product_id, type, qty, reference_type, reference_id)
  VALUES (shared.uuid_generate_v7(), v_ent_product_id, v_prod_a, 'RESERVE', 4, 'TEST', shared.uuid_generate_v7())
  RETURNING id INTO v_reserve_id;

  SELECT available INTO v_available FROM rik.v_entitlement_balance WHERE entitlement_id = v_ent_product_id;
  IF v_available <> 6 THEN
    RAISE EXCEPTION 'FAIL #2: after RESERVE 4, available should be 6, got %', v_available;
  END IF;

  -- ISSUE closes the reserve
  INSERT INTO rik.entitlement_ledger (id, entitlement_id, product_id, type, qty, related_entry_id, reference_type, reference_id)
  VALUES (shared.uuid_generate_v7(), v_ent_product_id, v_prod_a, 'ISSUE', 4, v_reserve_id, 'TEST', shared.uuid_generate_v7());

  SELECT available INTO v_available
  FROM rik.v_entitlement_balance WHERE entitlement_id = v_ent_product_id;
  -- after ISSUE, the RESERVE row is closed (no longer "open"), issued=4, so available = 10 - 0(open reserve) - 4(issued) = 6
  IF v_available <> 6 THEN
    RAISE EXCEPTION 'FAIL #2: after ISSUE closing the RESERVE, available should remain 6, got %', v_available;
  END IF;
  RAISE NOTICE 'PASS #2: rik.v_entitlement_balance tracks Allocated/Reserved/Issued/Available correctly';

  -- =======================================================================
  -- #3 Category entitlement across products
  -- =======================================================================
  -- RESERVE 2kg against Product B, then 1kg against Product C, both drawing
  -- from the SAME category-mode entitlement pool.
  INSERT INTO rik.entitlement_ledger (id, entitlement_id, product_id, type, qty, reference_type, reference_id)
  VALUES (shared.uuid_generate_v7(), v_ent_category_id, v_prod_b, 'RESERVE', 2, 'TEST', shared.uuid_generate_v7())
  RETURNING id INTO v_reserve2_id;

  INSERT INTO rik.entitlement_ledger (id, entitlement_id, product_id, type, qty, reference_type, reference_id)
  VALUES (shared.uuid_generate_v7(), v_ent_category_id, v_prod_c, 'RESERVE', 1, 'TEST', shared.uuid_generate_v7());

  SELECT available INTO v_available FROM rik.v_entitlement_balance WHERE entitlement_id = v_ent_category_id;
  IF v_available <> 2 THEN -- 5 allocated - 2(B) - 1(C) = 2
    RAISE EXCEPTION 'FAIL #3: category pool available should be 2 after 2kg(B)+1kg(C) reserved, got %', v_available;
  END IF;

  SELECT total_reserved INTO v_reserved
  FROM rik.v_entitlement_consumption_by_product
  WHERE entitlement_id = v_ent_category_id AND product_id = v_prod_b;
  IF v_reserved <> 2 THEN
    RAISE EXCEPTION 'FAIL #3: per-product breakdown for Product B should show 2 reserved, got %', v_reserved;
  END IF;
  RAISE NOTICE 'PASS #3: one category-mode pool correctly shared and broken down across multiple products';

  -- =======================================================================
  -- #5 Duplicate RESERVE closure prevention
  -- =======================================================================
  -- A second RELEASE/ISSUE against the same already-closed RESERVE (v_reserve_id
  -- was already closed by an ISSUE above) must fail on the partial-UQ.
  BEGIN
    INSERT INTO rik.entitlement_ledger (id, entitlement_id, product_id, type, qty, related_entry_id, reference_type, reference_id)
    VALUES (shared.uuid_generate_v7(), v_ent_product_id, v_prod_a, 'RELEASE', 4, v_reserve_id, 'TEST', shared.uuid_generate_v7());
    RAISE EXCEPTION 'FAIL #5: a second closure of an already-closed RESERVE should have been rejected';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS #5a: rik_ent_ledger_related_uq rejects a duplicate closure of the same RESERVE';
  END;

  -- A RELEASE/ISSUE whose product_id does not match the RESERVE it closes
  -- must fail on the product-match trigger.
  BEGIN
    INSERT INTO rik.entitlement_ledger (id, entitlement_id, product_id, type, qty, related_entry_id, reference_type, reference_id)
    VALUES (shared.uuid_generate_v7(), v_ent_category_id, v_prod_c, 'RELEASE', 2, v_reserve2_id, 'TEST', shared.uuid_generate_v7());
    RAISE EXCEPTION 'FAIL #5: closing a Product B RESERVE with a Product C RELEASE should have been rejected';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS #5b: rik.trg_validate_ledger_product_match rejects a product mismatch on RESERVE closure';
  END;

  -- =======================================================================
  -- #6 RIK reserve/release/issue full cycle correctness
  -- =======================================================================
  -- Uses a fresh period so this doesn't collide with the (customer_id,
  -- product_id, period_id) partial-UQ already exercised by v_ent_product_id.
  DECLARE
    v_period2_id uuid;
    v_cycle_ent_id uuid;
    v_cycle_reserve uuid;
    v_avail numeric;
  BEGIN
    INSERT INTO rik.entitlement_periods (id, name, start_date, end_date, status)
    VALUES (shared.uuid_generate_v7(), 'TEST-2099-02', '2099-02-01', '2099-02-28', 'ACTIVE')
    RETURNING id INTO v_period2_id;

    INSERT INTO rik.entitlements (id, customer_id, product_id, period_id, allocated_qty, unit)
    VALUES (shared.uuid_generate_v7(), v_customer_id, v_prod_a, v_period2_id, 8, 'kg')
    RETURNING id INTO v_cycle_ent_id;

    -- RESERVE 5
    INSERT INTO rik.entitlement_ledger (id, entitlement_id, product_id, type, qty, reference_type, reference_id)
    VALUES (shared.uuid_generate_v7(), v_cycle_ent_id, v_prod_a, 'RESERVE', 5, 'TEST', shared.uuid_generate_v7())
    RETURNING id INTO v_cycle_reserve;

    SELECT available INTO v_avail FROM rik.v_entitlement_balance WHERE entitlement_id = v_cycle_ent_id;
    IF v_avail <> 3 THEN RAISE EXCEPTION 'FAIL #6: after RESERVE 5 of 8, available should be 3, got %', v_avail; END IF;

    -- RELEASE it back in full (order cancelled)
    INSERT INTO rik.entitlement_ledger (id, entitlement_id, product_id, type, qty, related_entry_id, reference_type, reference_id)
    VALUES (shared.uuid_generate_v7(), v_cycle_ent_id, v_prod_a, 'RELEASE', 5, v_cycle_reserve, 'TEST', shared.uuid_generate_v7());

    SELECT available INTO v_avail FROM rik.v_entitlement_balance WHERE entitlement_id = v_cycle_ent_id;
    IF v_avail <> 8 THEN RAISE EXCEPTION 'FAIL #6: after RELEASE, available should return to 8, got %', v_avail; END IF;
    RAISE NOTICE 'PASS #6: RESERVE -> RELEASE cycle correctly returns qty to available';
  END;

  -- =======================================================================
  -- #7 RIK invalid state transitions
  -- =======================================================================
  DECLARE
    v_order_id uuid;
  BEGIN
    INSERT INTO rik.orders (id, order_number, customer_id, status, fulfillment_type)
    VALUES (shared.uuid_generate_v7(), 'TEST-ORD-RIK-1', v_customer_id, 'DRAFT', 'PICKUP')
    RETURNING id INTO v_order_id;

    -- valid: DRAFT -> CONFIRMED
    UPDATE rik.orders SET status = 'CONFIRMED' WHERE id = v_order_id;

    -- invalid: CONFIRMED -> COLLECTED (must go through READY first)
    BEGIN
      UPDATE rik.orders SET status = 'COLLECTED' WHERE id = v_order_id;
      RAISE EXCEPTION 'FAIL #7: CONFIRMED -> COLLECTED should have been rejected (skips READY)';
    EXCEPTION WHEN check_violation THEN
      RAISE NOTICE 'PASS #7a: illegal skip-ahead transition rejected';
    END;

    -- invalid: READY -> DELIVERED for a PICKUP order (wrong fulfillment path)
    UPDATE rik.orders SET status = 'READY' WHERE id = v_order_id;
    BEGIN
      UPDATE rik.orders SET status = 'OUT_FOR_DELIVERY' WHERE id = v_order_id;
      RAISE EXCEPTION 'FAIL #7: READY -> OUT_FOR_DELIVERY should have been rejected for a PICKUP order';
    EXCEPTION WHEN check_violation THEN
      RAISE NOTICE 'PASS #7b: DELIVERY-only transition rejected for a PICKUP order';
    END;

    -- valid: READY -> COLLECTED (correct PICKUP path), then COLLECTED -> CLOSED
    UPDATE rik.orders SET status = 'COLLECTED' WHERE id = v_order_id;
    UPDATE rik.orders SET status = 'CLOSED' WHERE id = v_order_id;
    RAISE NOTICE 'PASS #7c: valid PICKUP path DRAFT->CONFIRMED->READY->COLLECTED->CLOSED succeeds';
  END;

  -- =======================================================================
  -- #10 Negative-stock prevention (RIK half)
  -- =======================================================================
  BEGIN
    UPDATE rik.inventory SET quantity_on_hand = -1 WHERE product_id = v_prod_a;
    RAISE EXCEPTION 'FAIL #10: negative quantity_on_hand should have been rejected';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS #10a (RIK): rik_inventory_on_hand_chk rejects negative stock';
  END;
  BEGIN
    UPDATE rik.inventory SET quantity_reserved = quantity_on_hand + 1 WHERE product_id = v_prod_a;
    RAISE EXCEPTION 'FAIL #10: quantity_reserved > quantity_on_hand should have been rejected';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS #10b (RIK): rik_inventory_reserved_chk rejects reserved > on_hand';
  END;

  RAISE NOTICE '=== 010_rik_entitlement_and_inventory.sql: ALL CHECKS PASSED ===';
END;
$$;

ROLLBACK;
