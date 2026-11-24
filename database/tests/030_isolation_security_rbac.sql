-- =============================================================================
-- Test suite 030: cross-schema isolation, security, RBAC
--   #1  RIK/PIF inventory (and schema) separation — verified structurally
--   #15 Invalid customer/staff reference rejection (SECURITY DEFINER trigger
--       validation)
--   #16 Audit append-only protection (trigger backstop + role grants)
--   #18 RBAC permission boundaries (role_permissions scoping, PIF_CASHIER
--       excludes pif.product.manage, and DB-role least privilege)
--
-- Part A runs as esamagri_owner in one transaction (rolled back). Part B
-- switches SET ROLE to the real application roles to exercise grant-level
-- enforcement for real, which an owning role would otherwise bypass.
-- =============================================================================
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Part A: structural isolation + trigger-level validation + audit trigger
-- ---------------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_fk_count      int;
  v_customer_id   uuid;
  v_perm_count    int;
BEGIN
  -- =======================================================================
  -- #1 RIK/PIF schema separation — structural, not by convention
  -- =======================================================================
  SELECT count(*) INTO v_fk_count
  FROM information_schema.table_constraints tc
  JOIN information_schema.constraint_column_usage ccu
    ON tc.constraint_name = ccu.constraint_name AND tc.constraint_schema = ccu.constraint_schema
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND (
      (tc.table_schema = 'rik' AND ccu.table_schema = 'pif') OR
      (tc.table_schema = 'pif' AND ccu.table_schema = 'rik')
    );
  IF v_fk_count <> 0 THEN
    RAISE EXCEPTION 'FAIL #1: found % physical FK(s) crossing rik<->pif directly — schema isolation violated', v_fk_count;
  END IF;
  RAISE NOTICE 'PASS #1a: zero physical FKs cross rik<->pif directly (verified against information_schema, not by convention)';

  -- rik.inventory and pif.inventory are separate rows for the "same" real
  -- world product concept, keyed by each schema's own product_id — confirm
  -- there is no shared/overlapping row (i.e. a rik product_id can never
  -- resolve in pif.inventory or vice versa, since the tables are keyed to
  -- disjoint products tables).
  IF EXISTS (
    SELECT 1 FROM pif.inventory pi JOIN rik.inventory ri ON pi.product_id = ri.product_id
  ) THEN
    RAISE EXCEPTION 'FAIL #1: found a product_id present in both rik.inventory and pif.inventory — should be structurally impossible (disjoint products tables) unless a UUID collided';
  END IF;
  RAISE NOTICE 'PASS #1b: rik.inventory and pif.inventory are disjoint — no shared stock rows between modules';

  -- =======================================================================
  -- #15 Invalid customer/staff reference rejection
  -- =======================================================================
  BEGIN
    INSERT INTO rik.carts (id, customer_id) VALUES (shared.uuid_generate_v7(), '00000000-0000-0000-0000-000000000000');
    RAISE EXCEPTION 'FAIL #15: rik.carts with a nonexistent customer_id should have been rejected';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS #15a: rik.trg_validate_customer_ref / shared.assert_customer_exists rejects a nonexistent customer';
  END;

  INSERT INTO shared.customers (id, mobile_number, name, is_active)
  VALUES (shared.uuid_generate_v7(), '9990000030', 'Test Customer Inactive', false)
  RETURNING id INTO v_customer_id;

  BEGIN
    INSERT INTO pif.carts (id, customer_id) VALUES (shared.uuid_generate_v7(), v_customer_id);
    RAISE EXCEPTION 'FAIL #15: pif.carts with an inactive customer should have been rejected';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS #15b: shared.assert_customer_exists rejects a soft-inactive customer, not just a missing one';
  END;

  BEGIN
    INSERT INTO pif.cashier_shifts (id, cashier_id, opening_cash)
    VALUES (shared.uuid_generate_v7(), '00000000-0000-0000-0000-000000000000', 100.00);
    RAISE EXCEPTION 'FAIL #15: pif.cashier_shifts with a nonexistent cashier_id should have been rejected';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS #15c: pif.trg_validate_cashier_ref / shared.assert_staff_user_exists rejects a nonexistent staff reference';
  END;

  -- =======================================================================
  -- #16 Audit append-only protection
  -- =======================================================================
  DECLARE
    v_audit_id uuid;
  BEGIN
    SELECT shared.log_audit_event(NULL, 'TEST', 'shared', 'test.action', 'test_entity', shared.uuid_generate_v7())
    INTO v_audit_id;

    BEGIN
      UPDATE shared.audit_log SET action = 'tampered' WHERE id = v_audit_id;
      RAISE EXCEPTION 'FAIL #16: UPDATE on shared.audit_log should have been rejected unconditionally';
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS #16a: shared.trg_audit_log_immutable rejects UPDATE, even for the owning role';
    END;

    BEGIN
      DELETE FROM shared.audit_log WHERE id = v_audit_id;
      RAISE EXCEPTION 'FAIL #16: DELETE on shared.audit_log should have been rejected unconditionally';
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS #16b: shared.trg_audit_log_immutable rejects DELETE, even for the owning role';
    END;
  END;

  -- =======================================================================
  -- #18 RBAC permission boundaries (data-level: role_permissions scoping)
  -- =======================================================================
  SELECT count(*) INTO v_perm_count
  FROM shared.role_permissions rp
  JOIN shared.roles r ON r.id = rp.role_id
  JOIN shared.permissions p ON p.id = rp.permission_id
  WHERE r.name = 'PIF_CASHIER' AND p.code = 'pif.product.manage';
  IF v_perm_count <> 0 THEN
    RAISE EXCEPTION 'FAIL #18: PIF_CASHIER should not hold pif.product.manage (Section 23: deliberately excluded)';
  END IF;
  RAISE NOTICE 'PASS #18a: PIF_CASHIER deliberately excludes pif.product.manage, as seeded';

  IF NOT EXISTS (
    SELECT 1 FROM shared.role_permissions rp
    JOIN shared.roles r ON r.id = rp.role_id
    JOIN shared.permissions p ON p.id = rp.permission_id
    WHERE r.name = 'SUPER_ADMIN' AND p.code = 'shared.role.grant'
  ) THEN
    RAISE EXCEPTION 'FAIL #18: SUPER_ADMIN should hold shared.role.grant (Section 23: only role that can grant other roles)';
  END IF;
  RAISE NOTICE 'PASS #18b: SUPER_ADMIN correctly holds shared.role.grant';

  IF NOT EXISTS (
    SELECT 1 FROM shared.roles r WHERE r.name = 'CUSTOMER'
  ) THEN
    RAISE NOTICE 'PASS #18c: no CUSTOMER role exists — customers never appear in shared.roles/user_roles (Section 23)';
  ELSE
    RAISE EXCEPTION 'FAIL #18: a CUSTOMER role must never exist per Section 23''s explicit decision';
  END IF;

  RAISE NOTICE '=== 030 Part A: ALL CHECKS PASSED ===';
END;
$$;

ROLLBACK;

-- ---------------------------------------------------------------------------
-- Part B: DB-role-level least privilege, exercised as the real app roles
-- (an owning role bypasses grants entirely, so this must run as app_pif /
-- app_rik themselves to mean anything). No lasting writes: every statement
-- below is a read or an expected-to-fail write.
-- ---------------------------------------------------------------------------
BEGIN;
SET ROLE app_pif;
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM shared.customers LIMIT 1;
    RAISE EXCEPTION 'FAIL #18: app_pif should not have direct SELECT on shared.customers';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS #18d: app_pif has zero direct grants on shared.customers (Section 02)';
  END;

  BEGIN
    INSERT INTO shared.audit_log (id, module, action, entity_type, entity_id)
    VALUES (shared.uuid_generate_v7(), 'pif', 'test.action', 'x', shared.uuid_generate_v7());
    RAISE EXCEPTION 'FAIL #18: app_pif should not be able to INSERT into shared.audit_log directly';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS #18e: app_pif has no direct INSERT grant on shared.audit_log — writes only via shared.log_audit_event()';
  END;
END;
$$;
ROLLBACK;

BEGIN;
SET ROLE app_reporting_pif;
DO $$
BEGIN
  BEGIN
    INSERT INTO pif.categories (id, name) VALUES (shared.uuid_generate_v7(), 'should-fail');
    RAISE EXCEPTION 'FAIL #18: app_reporting_pif should be read-only';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS #18f: app_reporting_pif has no write grants (read-only reporting role, Section 02)';
  END;

  PERFORM count(*) FROM pif.categories;
  RAISE NOTICE 'PASS #18g: app_reporting_pif can SELECT from pif tables';
END;
$$;
ROLLBACK;

SELECT 'PASS: 030_isolation_security_rbac.sql complete' AS result;
