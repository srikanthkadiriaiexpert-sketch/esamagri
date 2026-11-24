-- =============================================================================
-- Migration 0005: shared functions
--   shared.log_audit_event(...)          — Section 24, the only sanctioned
--                                           write path into shared.audit_log
--   shared.assert_customer_exists(uuid)  — Section 04/11, Revision 1
--   shared.assert_staff_user_exists(uuid)— Section 04/11, Revision 1
--   shared.trg_audit_log_immutable()     — Section 24, trigger backstop
--
-- All SECURITY DEFINER functions here set an explicit search_path (shared,
-- pg_catalog) and fully qualify every object reference, per Postgres's own
-- security guidance for SECURITY DEFINER functions — this is what closes
-- the "search_path hijack" privilege-escalation vector your security
-- checklist calls out. Ownership: these functions are owned by whichever
-- role applies this migration (the migration/admin role, which already has
-- full read/write on shared per Section 02) — never by app_rik/app_pif,
-- which are only ever granted EXECUTE (migration 0017).
-- =============================================================================

CREATE OR REPLACE FUNCTION shared.log_audit_event(
  p_actor_id      uuid,
  p_actor_role    text,
  p_module        text,
  p_action        text,
  p_entity_type   text,
  p_entity_id     uuid,
  p_before        jsonb DEFAULT NULL,
  p_after         jsonb DEFAULT NULL,
  p_ip_address    inet DEFAULT NULL,
  p_device_info   text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = shared, pg_catalog
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO shared.audit_log (
    id, actor_id, actor_role, module, action, entity_type, entity_id,
    before, after, ip_address, device_info, created_at
  ) VALUES (
    shared.uuid_generate_v7(), p_actor_id, p_actor_role, p_module, p_action,
    p_entity_type, p_entity_id, p_before, p_after, p_ip_address, p_device_info, now()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION shared.log_audit_event(uuid, text, text, text, text, uuid, jsonb, jsonb, inet, text) IS
  'SECURITY DEFINER — the only sanctioned write path into shared.audit_log (Section 24). app_rik/app_pif hold EXECUTE only, never INSERT on audit_log directly.';

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION shared.assert_customer_exists(p_customer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = shared, pg_catalog
AS $$
BEGIN
  IF p_customer_id IS NULL THEN
    RETURN; -- nullable columns validate only when set (e.g. pif.pos_bills.customer_id)
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM shared.customers
    WHERE id = p_customer_id
      AND deleted_at IS NULL
      AND is_active
  ) THEN
    RAISE EXCEPTION 'invalid customer reference: % (not found, soft-deleted, or inactive)', p_customer_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
END;
$$;

COMMENT ON FUNCTION shared.assert_customer_exists(uuid) IS
  'SECURITY DEFINER — validates a customer reference exists, is not soft-deleted, and is active. EXECUTE granted to app_rik/app_pif only; no SELECT grant on shared.customers is ever given to those roles. Phase 2 Section 04, Revision 1.';

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION shared.assert_staff_user_exists(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = shared, pg_catalog
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM shared.users
    WHERE id = p_user_id
      AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'invalid staff user reference: % (not found or not ACTIVE)', p_user_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
END;
$$;

COMMENT ON FUNCTION shared.assert_staff_user_exists(uuid) IS
  'SECURITY DEFINER — validates a staff (shared.users) reference exists and is ACTIVE. Used for pif.cashier_shifts.cashier_id and pif.cash_movements.handled_by. Phase 2 Section 04, Revision 1.';

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION shared.trg_audit_log_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'shared.audit_log is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

COMMENT ON FUNCTION shared.trg_audit_log_immutable() IS
  'Trigger backstop: unconditionally rejects UPDATE/DELETE on shared.audit_log regardless of role grants. Phase 2 Section 24.';

CREATE TRIGGER audit_log_no_mutate
  BEFORE UPDATE OR DELETE ON shared.audit_log
  FOR EACH ROW EXECUTE FUNCTION shared.trg_audit_log_immutable();
