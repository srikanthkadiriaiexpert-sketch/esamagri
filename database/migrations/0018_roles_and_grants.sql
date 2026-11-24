-- =============================================================================
-- Migration 0018: DB roles + least-privilege grants
-- Phase 2 Rev1 Section 02 (schema separation / role model), Section 24
-- (audit grants), Section 27 (idempotency).
--
-- SECURITY FIX applied here, not merely described: migrations 0001-0017 were
-- necessarily applied as the postgres superuser in this test environment.
-- That means every SECURITY DEFINER function created so far
-- (shared.log_audit_event, shared.assert_customer_exists,
-- shared.assert_staff_user_exists, shared.claim_idempotency_key,
-- shared.store_idempotent_response, shared.get_idempotent_response) is
-- currently OWNED BY postgres — meaning it would execute with full
-- superuser privileges whenever app_rik/app_pif calls it. That is exactly
-- the "SECURITY DEFINER privilege escalation" failure mode the Phase 3A
-- security checklist calls out, not a hypothetical one. This migration
-- creates a dedicated, non-superuser owner role (esamagri_owner) and
-- reassigns ownership of every object in shared/rik/pif to it before
-- granting anything to the application roles, then all downstream
-- migrations in this project apply as esamagri_owner (via SET ROLE below),
-- never as postgres. See docs/reconciliation-report.md and
-- docs/security-checklist.md.
--
-- Reconciliation note: Section 02 says app_rik/app_pif have "zero grants in
-- shared", naming shared.log_audit_event() as their only path into shared.
-- Section 24 separately says app_shared/app_rik/app_pif are granted
-- INSERT, SELECT directly on shared.audit_log. Resolved in favor of
-- Section 02's stricter reading (the Revision 1 architectural direction,
-- and consistent with "least privilege" in the Phase 3A brief): NO
-- application role gets a direct grant on shared.audit_log or
-- shared.idempotency_keys. All writes to both go exclusively through
-- SECURITY DEFINER functions. app_shared additionally gets SELECT (read)
-- on shared.audit_log for the SUPER_ADMIN "shared.audit_log.view" feature
-- (Section 23) — that is a read grant, not the INSERT/UPDATE/DELETE Section
-- 24's table literally describes, and is the only direct grant any
-- application role holds on shared.audit_log.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Roles
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'esamagri_owner') THEN
    CREATE ROLE esamagri_owner NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_shared') THEN
    CREATE ROLE app_shared NOSUPERUSER NOCREATEDB NOCREATEROLE LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rik') THEN
    CREATE ROLE app_rik NOSUPERUSER NOCREATEDB NOCREATEROLE LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_pif') THEN
    CREATE ROLE app_pif NOSUPERUSER NOCREATEDB NOCREATEROLE LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_reporting_rik') THEN
    CREATE ROLE app_reporting_rik NOSUPERUSER NOCREATEDB NOCREATEROLE LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_reporting_pif') THEN
    CREATE ROLE app_reporting_pif NOSUPERUSER NOCREATEDB NOCREATEROLE LOGIN;
  END IF;
END;
$$;

COMMENT ON ROLE esamagri_owner IS 'Object-owning / migration role. NOLOGIN — nothing connects as this role directly; migrations apply via SET ROLE from a superuser or a role granted membership out-of-band. Owns every object in shared/rik/pif, including every SECURITY DEFINER function, so those functions never execute with superuser privileges. This is the "break-glass migration role" referenced in Section 24 — the only role with UPDATE/DELETE on shared.audit_log by virtue of ownership, itself still blocked by the trigger backstop (migration 0005) unconditionally.';

-- All app_* roles are created with LOGIN and no password. A real password
-- must be set out-of-band (ALTER ROLE ... WITH PASSWORD '...') as part of
-- secret provisioning — never committed to a migration file, same
-- principle as the Section 31 bootstrap SUPER_ADMIN user. With no password
-- set, password authentication for these roles fails closed by default.

-- ---------------------------------------------------------------------------
-- 2. Reassign ownership of every existing object to esamagri_owner
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  s text;
BEGIN
  FOREACH s IN ARRAY ARRAY['shared','rik','pif'] LOOP
    EXECUTE format('ALTER SCHEMA %I OWNER TO esamagri_owner', s);
  END LOOP;

  FOR r IN
    SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('shared','rik','pif')
  LOOP
    EXECUTE format('ALTER TABLE %I.%I OWNER TO esamagri_owner', r.schemaname, r.tablename);
  END LOOP;

  FOR r IN
    SELECT schemaname, viewname FROM pg_views WHERE schemaname IN ('shared','rik','pif')
  LOOP
    EXECUTE format('ALTER VIEW %I.%I OWNER TO esamagri_owner', r.schemaname, r.viewname);
  END LOOP;

  FOR r IN
    SELECT n.nspname AS schema_name, p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('shared','rik','pif')
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO esamagri_owner', r.sig);
  END LOOP;
END;
$$;

-- All further object-creating statements in this project apply as
-- esamagri_owner from this point on, never as postgres.
SET ROLE esamagri_owner;

-- ---------------------------------------------------------------------------
-- 3. Schema USAGE
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA shared TO app_shared, app_rik, app_pif, app_reporting_rik, app_reporting_pif;
GRANT USAGE ON SCHEMA rik    TO app_rik, app_reporting_rik;
GRANT USAGE ON SCHEMA pif    TO app_pif, app_reporting_pif;

-- ---------------------------------------------------------------------------
-- 4. app_shared — all of shared, per Section 02, with two explicit
--    exceptions: shared.audit_log (SELECT only; writes only via
--    shared.log_audit_event()) and shared.idempotency_keys (zero direct
--    grants; writes/reads only via the Section 27 wrapper functions).
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON
  shared.users, shared.customers, shared.customer_addresses,
  shared.roles, shared.permissions, shared.role_permissions, shared.user_roles,
  shared.settings, shared.auth_sessions, shared.otp_requests, shared.notification_outbox
TO app_shared;

GRANT SELECT ON shared.audit_log TO app_shared;

-- ---------------------------------------------------------------------------
-- 5. app_rik / app_pif — zero direct table grants in shared (Section 02).
--    Only shared.v_customer_profile (read) and the SECURITY DEFINER
--    functions they call.
-- ---------------------------------------------------------------------------
GRANT SELECT ON shared.v_customer_profile TO app_rik, app_pif, app_reporting_rik, app_reporting_pif;

GRANT EXECUTE ON FUNCTION shared.uuid_generate_v7() TO app_shared, app_rik, app_pif;
GRANT EXECUTE ON FUNCTION shared.log_audit_event(uuid, text, text, text, text, uuid, jsonb, jsonb, inet, text) TO app_shared, app_rik, app_pif;
GRANT EXECUTE ON FUNCTION shared.assert_customer_exists(uuid) TO app_rik, app_pif;
GRANT EXECUTE ON FUNCTION shared.assert_staff_user_exists(uuid) TO app_pif;
GRANT EXECUTE ON FUNCTION shared.claim_idempotency_key(text, text, uuid) TO app_shared, app_rik, app_pif;
GRANT EXECUTE ON FUNCTION shared.store_idempotent_response(uuid, jsonb) TO app_shared, app_rik, app_pif;
GRANT EXECUTE ON FUNCTION shared.get_idempotent_response(text, text) TO app_shared, app_rik, app_pif;

COMMENT ON FUNCTION shared.assert_staff_user_exists(uuid) IS
  'SECURITY DEFINER — validates a staff (shared.users) reference exists and is ACTIVE. EXECUTE granted to app_pif only (no rik.* table currently calls it); grant to app_rik too if a future RIK table adds a staff-reference trigger. Phase 2 Section 04, Revision 1.';

-- ---------------------------------------------------------------------------
-- 6. app_rik — all of rik, with append-only tables restricted to INSERT+SELECT.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON
  rik.categories, rik.products, rik.inventory,
  rik.entitlement_periods, rik.entitlements,
  rik.carts, rik.cart_items, rik.orders, rik.order_items
TO app_rik;

GRANT SELECT, INSERT ON rik.entitlement_ledger, rik.inventory_transactions, rik.order_status_history TO app_rik;

GRANT SELECT ON rik.v_entitlement_balance, rik.v_entitlement_consumption_by_product TO app_rik;

-- ---------------------------------------------------------------------------
-- 7. app_pif — all of pif, with append-only tables restricted to INSERT+SELECT.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON
  pif.categories, pif.tax_rates, pif.products, pif.inventory,
  pif.suppliers, pif.purchase_orders, pif.purchase_order_items,
  pif.goods_receipts, pif.goods_receipt_items,
  pif.cashier_shifts, pif.pos_bills, pif.pos_bill_items,
  pif.carts, pif.cart_items, pif.orders, pif.order_items,
  pif.returns, pif.return_items
TO app_pif;

GRANT SELECT, INSERT ON pif.inventory_transactions, pif.cash_movements TO app_pif;

-- ---------------------------------------------------------------------------
-- 8. Reporting roles — read-only.
-- ---------------------------------------------------------------------------
GRANT SELECT ON ALL TABLES IN SCHEMA rik TO app_reporting_rik;
GRANT SELECT ON ALL TABLES IN SCHEMA pif TO app_reporting_pif;

-- ---------------------------------------------------------------------------
-- 9. Default privileges for objects esamagri_owner creates in future
--    migrations, so a forgotten explicit GRANT doesn't silently leave a new
--    table inaccessible to its own module's app role. Append-only
--    exceptions (like rik.entitlement_ledger above) still need an explicit
--    narrower GRANT in the migration that creates them.
-- ---------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES FOR ROLE esamagri_owner IN SCHEMA rik
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rik;
ALTER DEFAULT PRIVILEGES FOR ROLE esamagri_owner IN SCHEMA rik
  GRANT SELECT ON TABLES TO app_reporting_rik;

ALTER DEFAULT PRIVILEGES FOR ROLE esamagri_owner IN SCHEMA pif
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_pif;
ALTER DEFAULT PRIVILEGES FOR ROLE esamagri_owner IN SCHEMA pif
  GRANT SELECT ON TABLES TO app_reporting_pif;

RESET ROLE;
