-- =============================================================================
-- Migration 0024: revoke PUBLIC EXECUTE on SECURITY DEFINER functions
-- Final Phase 2 release audit — defect found in the SECURITY DEFINER /
-- least-privilege review (audit section 3).
--
-- PostgreSQL grants EXECUTE on a newly created function to PUBLIC by
-- default, unless explicitly revoked. Every migration that added a
-- SECURITY DEFINER function in `shared` (0005, 0017) followed it with an
-- explicit GRANT EXECUTE to the intended app roles (0018, 0023), but none
-- of them ever revoked the PUBLIC grant underneath — so those explicit
-- grants were redundant: every role, including the two read-only
-- reporting roles that were never meant to write anything, already had
-- EXECUTE via PUBLIC.
--
-- Reproduced directly during the audit: connected as app_reporting_rik
-- (which holds zero direct grants on shared.audit_log or
-- shared.idempotency_keys, confirmed structurally and by
-- tests/030_isolation_security_rbac.sql #18f) and successfully called
-- shared.log_audit_event(), inserting a real row into shared.audit_log.
-- The same path exposes shared.claim_idempotency_key() /
-- shared.store_idempotent_response() — both of which mutate
-- shared.idempotency_keys — to app_reporting_rik and app_reporting_pif.
--
-- This migration closes that gap with the minimum necessary change:
-- revoke the PUBLIC grant on each of the six SECURITY DEFINER functions
-- in `shared`. This changes nothing for app_shared/app_rik/app_pif (and
-- app_rik on assert_staff_user_exists) — they keep exactly the access
-- they have today via the explicit GRANTs already issued in 0005, 0017,
-- 0018, and 0023. It removes access only for app_reporting_rik,
-- app_reporting_pif, and any future role that was never explicitly
-- granted EXECUTE.
--
-- Not touched: shared.uuid_generate_v7() / uuid_v7_extract_timestamp()
-- (not SECURITY DEFINER, no side effects, intentionally universal) and
-- shared.trg_audit_log_immutable() (a trigger function, not independently
-- callable in a way this concern applies to).
-- =============================================================================

SET ROLE esamagri_owner;

REVOKE EXECUTE ON FUNCTION shared.log_audit_event(uuid, text, text, text, text, uuid, jsonb, jsonb, inet, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION shared.assert_customer_exists(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION shared.assert_staff_user_exists(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION shared.claim_idempotency_key(text, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION shared.store_idempotent_response(uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION shared.get_idempotent_response(text, text) FROM PUBLIC;

COMMENT ON FUNCTION shared.log_audit_event(uuid, text, text, text, text, uuid, jsonb, jsonb, inet, text) IS
  'SECURITY DEFINER — appends one row to shared.audit_log. EXECUTE restricted to app_shared/app_rik/app_pif (migration 0018) since migration 0024; PUBLIC EXECUTE was revoked after the final release audit found app_reporting_rik/app_reporting_pif could otherwise call it and write audit rows despite holding no table grant.';
COMMENT ON FUNCTION shared.assert_customer_exists(uuid) IS
  'SECURITY DEFINER — validates a customer (shared.customers) reference exists. EXECUTE restricted to app_rik/app_pif (migration 0018) since migration 0024 revoked the default PUBLIC grant.';
COMMENT ON FUNCTION shared.claim_idempotency_key(text, text, uuid) IS
  'SECURITY DEFINER — claims/reserves an idempotency key row, mutating shared.idempotency_keys. EXECUTE restricted to app_shared/app_rik/app_pif (migration 0018) since migration 0024 revoked the default PUBLIC grant.';
COMMENT ON FUNCTION shared.store_idempotent_response(uuid, jsonb) IS
  'SECURITY DEFINER — stores the cached response for an idempotency key, mutating shared.idempotency_keys. EXECUTE restricted to app_shared/app_rik/app_pif (migration 0018) since migration 0024 revoked the default PUBLIC grant.';
COMMENT ON FUNCTION shared.get_idempotent_response(text, text) IS
  'SECURITY DEFINER — reads back a cached idempotent response. EXECUTE restricted to app_shared/app_rik/app_pif (migration 0018) since migration 0024 revoked the default PUBLIC grant.';

RESET ROLE;
