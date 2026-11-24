-- =============================================================================
-- Migration 0017: shared.claim_idempotency_key(), shared.store_idempotent_response(),
--                  shared.get_idempotent_response()
--
-- Reconciliation note (see docs/reconciliation-report.md): Section 02 states
-- app_rik/app_pif have "zero grants in shared" for writes, naming
-- shared.log_audit_event() as their sole write path into shared. Section 27
-- separately mandates a race-safe "INSERT ... ON CONFLICT DO NOTHING
-- RETURNING id" against shared.idempotency_keys for every listed operation,
-- described as raw SQL. Taken literally, those two statements conflict: a
-- role with zero write grants in shared cannot run a raw INSERT against
-- shared.idempotency_keys. Resolved the same way every other "rik/pif needs
-- a controlled write into shared" case in this document is resolved
-- (shared.log_audit_event, shared.assert_customer_exists): a SECURITY
-- DEFINER wrapper function, so app_rik/app_pif/app_shared keep zero direct
-- table grants on shared.idempotency_keys and the mandatory race-safe
-- ON CONFLICT semantics from Section 27 are preserved exactly. This is a
-- wrapping decision, not a change in the mandated behavior.
-- =============================================================================

CREATE OR REPLACE FUNCTION shared.claim_idempotency_key(
  p_idempotency_key   text,
  p_endpoint          text,
  p_principal_id      uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = shared, pg_catalog
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO shared.idempotency_keys (id, idempotency_key, endpoint, principal_id, created_at)
  VALUES (shared.uuid_generate_v7(), p_idempotency_key, p_endpoint, p_principal_id, now())
  ON CONFLICT (idempotency_key, endpoint) DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id; -- NULL means this (idempotency_key, endpoint) pair already exists — a duplicate request
END;
$$;

COMMENT ON FUNCTION shared.claim_idempotency_key(text, text, uuid) IS
  'SECURITY DEFINER — the sole write path into shared.idempotency_keys (Section 27). Race-safe: INSERT ... ON CONFLICT DO NOTHING RETURNING id, never SELECT-then-INSERT. Returns the new row id on first claim, NULL if (idempotency_key, endpoint) already exists (duplicate request — caller should fetch the cached response via shared.get_idempotent_response()).';

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION shared.store_idempotent_response(
  p_id        uuid,
  p_response  jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = shared, pg_catalog
AS $$
BEGIN
  UPDATE shared.idempotency_keys
  SET response_snapshot = p_response
  WHERE id = p_id;
END;
$$;

COMMENT ON FUNCTION shared.store_idempotent_response(uuid, jsonb) IS
  'SECURITY DEFINER — records the response snapshot for a claimed idempotency key (Section 27), called after the guarded operation completes successfully.';

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION shared.get_idempotent_response(
  p_idempotency_key   text,
  p_endpoint          text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = shared, pg_catalog
STABLE
AS $$
  SELECT response_snapshot
  FROM shared.idempotency_keys
  WHERE idempotency_key = p_idempotency_key
    AND endpoint = p_endpoint;
$$;

COMMENT ON FUNCTION shared.get_idempotent_response(text, text) IS
  'SECURITY DEFINER — fetches the stored response for a duplicate request so the caller can replay it instead of reprocessing (Section 27).';
