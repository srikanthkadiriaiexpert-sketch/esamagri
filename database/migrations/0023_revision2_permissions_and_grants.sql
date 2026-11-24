-- =============================================================================
-- Migration 0023: Phase 2 Revision 2 — permissions, role_permissions, grants
--
-- Two new permission codes (shared.announcement.manage,
-- rik.issue_schedule.manage), assigned per your Revision 2 correction #8:
-- SUPER_ADMIN can manage announcements for any audience; RIK_ADMIN and
-- PIF_ADMIN can manage announcements for their own module (the backend
-- must enforce which target_audience each may set — Section 6/8 of the
-- Revision 2 proposal, unchanged by this correction, since the DB's RBAC
-- model has no row/value-level scoping anywhere else either); RIK_ADMIN
-- alone gets rik.issue_schedule.manage.
--
-- Table/view grants follow the same "app_shared/app_rik own their base
-- table, app_pif only reads the customer-facing view" split as every
-- other cross-module read in this schema (shared.v_customer_profile).
--
-- One correction to what migration 0018's ALTER DEFAULT PRIVILEGES
-- auto-granted: that rule grants app_rik SELECT/INSERT/UPDATE/**DELETE**
-- on every future rik table, which is correct for most rik tables but
-- wrong for rik.issue_schedules specifically — this table follows the
-- soft-delete-only convention (Section 6 of the Revision 2 proposal;
-- same as shared.announcements), so DELETE is explicitly revoked here.
-- This is a narrow, targeted correction for this one new table, not a
-- change to the 0018 default-privileges rule itself (which stays exactly
-- as it was for every other rik table — no Phase 2 Revision 1 behavior is
-- altered).
-- =============================================================================

SET ROLE esamagri_owner;

INSERT INTO shared.permissions (id, code, module, description) VALUES
  (shared.uuid_generate_v7(), 'shared.announcement.manage', 'shared', 'Create/update/publish/unpublish/soft-delete shared.announcements rows (Phase 2 Revision 2).'),
  (shared.uuid_generate_v7(), 'rik.issue_schedule.manage',  'rik',    'Create/update/publish/unpublish/soft-delete rik.issue_schedules rows (Phase 2 Revision 2).');

INSERT INTO shared.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM shared.roles r, shared.permissions p
WHERE (r.name, p.code) IN (
  ('SUPER_ADMIN', 'shared.announcement.manage'),
  ('RIK_ADMIN',   'shared.announcement.manage'),
  ('RIK_ADMIN',   'rik.issue_schedule.manage'),
  ('PIF_ADMIN',   'shared.announcement.manage')
);

-- ---------------------------------------------------------------------------
-- shared.announcements: owned/managed by app_shared, same split as every
-- other shared-schema table (Section 02). No DELETE grant — soft delete
-- via UPDATE ... SET deleted_at = now() only.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON shared.announcements TO app_shared;
GRANT SELECT ON shared.v_active_announcements TO app_shared, app_rik, app_pif, app_reporting_rik, app_reporting_pif;

-- ---------------------------------------------------------------------------
-- rik.issue_schedules already received SELECT/INSERT/UPDATE/DELETE for
-- app_rik and SELECT for app_reporting_rik automatically, via the
-- ALTER DEFAULT PRIVILEGES rule migration 0018 set for the rik schema.
-- Narrow this one table back to the soft-delete-only policy:
-- ---------------------------------------------------------------------------
REVOKE DELETE ON rik.issue_schedules FROM app_rik;
REVOKE DELETE ON rik.v_issue_schedule FROM app_rik;

-- app_pif has no business reason to read or write rik.issue_schedules
-- directly (PIF has no structured schedule of its own, Section 1 of the
-- Revision 2 proposal) — no grant given, matching least privilege.

-- ---------------------------------------------------------------------------
-- rik.trg_validate_staff_ref() (migration 0021) calls
-- shared.assert_staff_user_exists(), so app_rik needs EXECUTE on it —
-- previously granted to app_pif only (migration 0018), since no rik table
-- needed it until now.
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION shared.assert_staff_user_exists(uuid) TO app_rik;

COMMENT ON FUNCTION shared.assert_staff_user_exists(uuid) IS
  'SECURITY DEFINER — validates a staff (shared.users) reference exists and is ACTIVE. EXECUTE granted to app_pif (Phase 3A: cashier_shifts.cashier_id, cash_movements.handled_by, pos_bills.cashier_id) and app_rik (Phase 2 Revision 2: rik.issue_schedules.created_by/updated_by via rik.trg_validate_staff_ref()). Phase 2 Section 04, Revision 1.';

RESET ROLE;
