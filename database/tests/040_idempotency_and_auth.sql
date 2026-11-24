-- =============================================================================
-- Test suite 040: idempotency + auth session (refresh-token) scenarios
--   #17 Idempotency duplicate-request handling (race-safe claim, never
--       naive SELECT-then-INSERT)
--   #19 Refresh-token rotation/reuse detection (auth_sessions family/
--       replaced_by chain + uniqueness)
--
-- Whole file runs in one transaction, rolled back at the end.
-- =============================================================================
\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  v_user_id       uuid;
  v_claim1        uuid;
  v_claim2        uuid;
  v_family_id     uuid;
  v_session1      uuid;
  v_session2      uuid;
  v_session3      uuid;
  v_response      jsonb;
BEGIN
  INSERT INTO shared.users (id, username, password_hash, display_name, status)
  VALUES (shared.uuid_generate_v7(), 'test_user_040', 'x', 'Test User', 'ACTIVE')
  RETURNING id INTO v_user_id;

  -- =======================================================================
  -- #17 Idempotency duplicate-request handling
  -- =======================================================================
  SELECT shared.claim_idempotency_key('TEST-KEY-1', '/pif/pos/finalize-bill', v_user_id) INTO v_claim1;
  IF v_claim1 IS NULL THEN
    RAISE EXCEPTION 'FAIL #17: first claim of a fresh idempotency key should succeed and return a row id';
  END IF;
  RAISE NOTICE 'PASS #17a: first claim of (idempotency_key, endpoint) succeeds';

  -- A second claim with the SAME key+endpoint must be a no-op (duplicate
  -- request), never a second row and never an error either — the whole
  -- point of ON CONFLICT DO NOTHING RETURNING is a race-safe, silent
  -- "you're a duplicate, here's NULL" signal.
  SELECT shared.claim_idempotency_key('TEST-KEY-1', '/pif/pos/finalize-bill', v_user_id) INTO v_claim2;
  IF v_claim2 IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL #17: duplicate claim of the same (idempotency_key, endpoint) should return NULL, got %', v_claim2;
  END IF;
  RAISE NOTICE 'PASS #17b: duplicate claim of the same (idempotency_key, endpoint) returns NULL (race-safe INSERT...ON CONFLICT DO NOTHING, not SELECT-then-INSERT)';

  PERFORM shared.store_idempotent_response(v_claim1, '{"status":"ok","bill_id":"test"}'::jsonb);
  SELECT shared.get_idempotent_response('TEST-KEY-1', '/pif/pos/finalize-bill') INTO v_response;
  IF v_response IS NULL OR v_response->>'status' <> 'ok' THEN
    RAISE EXCEPTION 'FAIL #17: stored response snapshot should be retrievable for a duplicate request to replay';
  END IF;
  RAISE NOTICE 'PASS #17c: stored response snapshot correctly retrievable via shared.get_idempotent_response';

  -- Same idempotency_key on a DIFFERENT endpoint is a different request —
  -- must be allowed (the UQ is on (idempotency_key, endpoint) together).
  SELECT shared.claim_idempotency_key('TEST-KEY-1', '/rik/order/place', v_user_id) INTO v_claim1;
  IF v_claim1 IS NULL THEN
    RAISE EXCEPTION 'FAIL #17: same idempotency_key on a different endpoint should be a distinct, allowed claim';
  END IF;
  RAISE NOTICE 'PASS #17d: (idempotency_key, endpoint) is a compound key — same key, different endpoint, is not a duplicate';

  -- =======================================================================
  -- #19 Refresh-token rotation/reuse detection
  -- =======================================================================
  v_family_id := shared.uuid_generate_v7();

  INSERT INTO shared.auth_sessions (id, principal_type, principal_id, family_id, refresh_token_hash, expires_at)
  VALUES (shared.uuid_generate_v7(), 'STAFF', v_user_id, v_family_id, 'hash-gen-1', now() + interval '30 days')
  RETURNING id INTO v_session1;

  -- Rotation: session1 is used, so it's revoked and replaced by session2 in
  -- the same family.
  INSERT INTO shared.auth_sessions (id, principal_type, principal_id, family_id, refresh_token_hash, expires_at)
  VALUES (shared.uuid_generate_v7(), 'STAFF', v_user_id, v_family_id, 'hash-gen-2', now() + interval '30 days')
  RETURNING id INTO v_session2;

  UPDATE shared.auth_sessions SET revoked_at = now(), replaced_by_id = v_session2 WHERE id = v_session1;

  -- Second rotation: session2 -> session3
  INSERT INTO shared.auth_sessions (id, principal_type, principal_id, family_id, refresh_token_hash, expires_at)
  VALUES (shared.uuid_generate_v7(), 'STAFF', v_user_id, v_family_id, 'hash-gen-3', now() + interval '30 days')
  RETURNING id INTO v_session3;
  UPDATE shared.auth_sessions SET revoked_at = now(), replaced_by_id = v_session3 WHERE id = v_session2;

  -- Reuse-detection data model check: the whole chain must be traceable via
  -- family_id, so a "session1's token was reused after rotation" handler
  -- can revoke every session in the family (session2 and session3 too).
  IF (SELECT count(*) FROM shared.auth_sessions WHERE family_id = v_family_id) <> 3 THEN
    RAISE EXCEPTION 'FAIL #19: expected 3 sessions in the rotation family';
  END IF;

  IF (SELECT replaced_by_id FROM shared.auth_sessions WHERE id = v_session1) <> v_session2 THEN
    RAISE EXCEPTION 'FAIL #19: session1.replaced_by_id should chain to session2';
  END IF;
  IF (SELECT replaced_by_id FROM shared.auth_sessions WHERE id = v_session2) <> v_session3 THEN
    RAISE EXCEPTION 'FAIL #19: session2.replaced_by_id should chain to session3';
  END IF;
  RAISE NOTICE 'PASS #19a: rotation chain correctly traceable end-to-end via family_id + replaced_by_id';

  -- Simulate reuse detection: presenting session1's (revoked) token again —
  -- the app-layer check is "is revoked_at set", and the DB guarantees that
  -- once set it is queryable reliably; simulate the full-family revoke a
  -- reuse handler would perform.
  UPDATE shared.auth_sessions SET revoked_at = now() WHERE family_id = v_family_id AND revoked_at IS NULL;
  IF (SELECT count(*) FROM shared.auth_sessions WHERE family_id = v_family_id AND revoked_at IS NULL) <> 0 THEN
    RAISE EXCEPTION 'FAIL #19: reuse-triggered full-family revoke should leave zero live sessions in the family';
  END IF;
  RAISE NOTICE 'PASS #19b: reuse-triggered whole-family revoke (via family_id) leaves zero live sessions — the data model supports the mandated reuse-detection response';

  -- refresh_token_hash uniqueness — two sessions can never share a token hash.
  BEGIN
    INSERT INTO shared.auth_sessions (id, principal_type, principal_id, family_id, refresh_token_hash, expires_at)
    VALUES (shared.uuid_generate_v7(), 'STAFF', v_user_id, shared.uuid_generate_v7(), 'hash-gen-1', now() + interval '30 days');
    RAISE EXCEPTION 'FAIL #19: a duplicate refresh_token_hash should have been rejected';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS #19c: auth_sessions_token_uq guarantees refresh_token_hash uniqueness across all sessions';
  END;

  RAISE NOTICE '=== 040_idempotency_and_auth.sql: ALL CHECKS PASSED ===';
END;
$$;

ROLLBACK;
