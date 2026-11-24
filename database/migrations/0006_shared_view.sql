-- =============================================================================
-- Migration 0006: shared.v_customer_profile
-- Phase 2 Rev1 Section 04: "the one and only door RIK and PIF have into
-- shared customer identity. Exposes customer_id, name, phone, quarter_block,
-- quarter_number, is_active — nothing else."
-- =============================================================================

CREATE VIEW shared.v_customer_profile AS
SELECT
  c.id             AS customer_id,
  c.name,
  c.mobile_number  AS phone,
  a.quarter_block,
  a.quarter_number,
  c.is_active
FROM shared.customers c
LEFT JOIN shared.customer_addresses a
  ON a.customer_id = c.id AND a.is_default
WHERE c.deleted_at IS NULL;

COMMENT ON VIEW shared.v_customer_profile IS
  'The only door rik/pif have into shared customer identity. app_rik/app_pif hold SELECT here and zero grant on shared.customers/customer_addresses directly. Phase 2 Section 02, 04.';
