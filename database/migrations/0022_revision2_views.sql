-- =============================================================================
-- Migration 0022: shared.v_active_announcements, rik.v_issue_schedule
-- Phase 2 Revision 2. These bring the authoritative view count to 5:
--   1. shared.v_customer_profile         (Phase 2 Rev1)
--   2. shared.v_active_announcements     (Revision 2, this file)
--   3. rik.v_entitlement_balance         (Phase 2 Rev1)
--   4. rik.v_entitlement_consumption_by_product (Phase 2 Rev1)
--   5. rik.v_issue_schedule              (Revision 2, this file)
-- 45 tables + 5 views. "45 tables + 3 views" is retired as of this
-- migration — see docs/reconciliation-report.md item 14.
-- =============================================================================

SET ROLE esamagri_owner;

CREATE VIEW shared.v_active_announcements AS
SELECT
  id, title, body, announcement_type, target_audience, priority,
  start_date, end_date, published_at, related_reference_type, related_reference_id,
  created_at, updated_at
FROM shared.announcements
WHERE is_published
  AND deleted_at IS NULL
  AND start_date <= CURRENT_DATE
  AND (end_date IS NULL OR end_date >= CURRENT_DATE)
ORDER BY
  CASE priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 WHEN 'LOW' THEN 3 END,
  start_date DESC;

COMMENT ON VIEW shared.v_active_announcements IS 'Customer-facing read model. "Active" = published, not soft-deleted, and today falls within [start_date, end_date-or-open-ended] — recomputed on every read, no stored/cached flag to keep in sync (this is the DB-level mechanism behind "old announcements automatically stop appearing as active after expiry"). Ordered URGENT-first. The backend service is responsible for filtering by target_audience for the requesting customer context before returning results to the app (Revision 2 correction #3) — this view exposes target_audience but does not itself restrict by it, since "which audience is asking" is a request-time concept the DB layer does not have.';

-- ---------------------------------------------------------------------------
CREATE VIEW rik.v_issue_schedule AS
SELECT
  id, schedule_date, category_id, product_id, status, start_time, end_time, notes,
  created_at, updated_at
FROM rik.issue_schedules
WHERE is_published
  AND deleted_at IS NULL
ORDER BY schedule_date;

COMMENT ON VIEW rik.v_issue_schedule IS 'Customer-facing RIK Issue Calendar read model. Deliberately NOT date-filtered (unlike v_active_announcements) so a calendar UI can page into history as well as forward; the app layer chooses the displayed date range.';

RESET ROLE;
