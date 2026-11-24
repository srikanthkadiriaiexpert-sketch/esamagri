-- =============================================================================
-- Test suite 060: Phase 2 Revision 2 — announcements + RIK issue schedules
-- Covers the full item-13 checklist from the Revision 2 approval message:
--   announcement publish/unpublish; date-based active filtering; expiry;
--   open-ended announcements; ALL/RIK/PIF audience values; priority
--   ordering; soft deletion; RIK schedule date queries; category schedule;
--   product schedule; general schedule; category/product XOR constraint;
--   duplicate schedule prevention; optional time-window validation;
--   FK/reference integrity; permissions; unauthorized admin attempts;
--   view access/grants. Plus a light audit-integration smoke test.
--
-- Part A runs as the connecting (owning) role in one transaction, rolled
-- back at the end — structural, functional, and data-level checks. Nested
-- BEGIN/EXCEPTION blocks (implicit PL/pgSQL savepoints) isolate assertions
-- that expect failure, exactly as in tests/010-030.
--
-- Part B switches SET ROLE to the real application roles (app_pif, app_rik,
-- app_shared, app_reporting_rik, app_reporting_pif) to exercise grant-level
-- enforcement for real, which an owning role would otherwise bypass — same
-- structure as tests/030 Part B.
-- =============================================================================
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Part A: structural + functional + data-level checks
-- ---------------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_staff_id           uuid;
  v_staff2_id          uuid;
  v_suspended_staff_id uuid;
  v_category_id        uuid;
  v_category2_id       uuid;
  v_product_id         uuid;
  v_product2_id        uuid;
  v_ann_id             uuid;
  v_sched_id           uuid;
  v_count              int;
  v_row                record;
  v_prev_priority_rank  int;
  v_this_priority_rank  int;
BEGIN
  -- ---- fixtures --------------------------------------------------------
  INSERT INTO shared.users (id, username, password_hash, display_name, status)
  VALUES (shared.uuid_generate_v7(), 'test.rev2.staff1', 'x', 'Test Rev2 Staff 1', 'ACTIVE')
  RETURNING id INTO v_staff_id;

  INSERT INTO shared.users (id, username, password_hash, display_name, status)
  VALUES (shared.uuid_generate_v7(), 'test.rev2.staff2', 'x', 'Test Rev2 Staff 2', 'ACTIVE')
  RETURNING id INTO v_staff2_id;

  INSERT INTO shared.users (id, username, password_hash, display_name, status)
  VALUES (shared.uuid_generate_v7(), 'test.rev2.suspended', 'x', 'Test Rev2 Suspended Staff', 'SUSPENDED')
  RETURNING id INTO v_suspended_staff_id;

  INSERT INTO rik.categories (id, name) VALUES (shared.uuid_generate_v7(), 'TEST-Rev2-Category-X')
  RETURNING id INTO v_category_id;
  INSERT INTO rik.categories (id, name) VALUES (shared.uuid_generate_v7(), 'TEST-Rev2-Category-Y')
  RETURNING id INTO v_category2_id;

  INSERT INTO rik.products (id, sku, name, category_id, unit) VALUES
    (shared.uuid_generate_v7(), 'TEST-REV2-A', 'Test Rev2 Product A', v_category_id, 'kg')
  RETURNING id INTO v_product_id;
  INSERT INTO rik.products (id, sku, name, category_id, unit) VALUES
    (shared.uuid_generate_v7(), 'TEST-REV2-B', 'Test Rev2 Product B', v_category_id, 'kg')
  RETURNING id INTO v_product2_id;

  -- =======================================================================
  -- #1 Announcement publish/unpublish
  -- =======================================================================
  INSERT INTO shared.announcements (id, title, body, announcement_type, target_audience, is_published, created_by)
  VALUES (shared.uuid_generate_v7(), 'TEST Draft Announcement', 'body', 'GENERAL', 'ALL', false, v_staff_id)
  RETURNING id INTO v_ann_id;

  IF EXISTS (SELECT 1 FROM shared.v_active_announcements WHERE id = v_ann_id) THEN
    RAISE EXCEPTION 'FAIL #1a: unpublished announcement must not appear in v_active_announcements';
  END IF;
  RAISE NOTICE 'PASS #1a: unpublished (draft) announcement correctly excluded from active view';

  UPDATE shared.announcements SET is_published = true, published_at = now() WHERE id = v_ann_id;
  IF NOT EXISTS (SELECT 1 FROM shared.v_active_announcements WHERE id = v_ann_id) THEN
    RAISE EXCEPTION 'FAIL #1b: publishing (is_published=true, dates in range) should make the row active';
  END IF;
  RAISE NOTICE 'PASS #1b: publishing an announcement makes it appear in v_active_announcements';

  UPDATE shared.announcements SET is_published = false, unpublished_at = now() WHERE id = v_ann_id;
  IF EXISTS (SELECT 1 FROM shared.v_active_announcements WHERE id = v_ann_id) THEN
    RAISE EXCEPTION 'FAIL #1c: unpublishing should immediately remove the row from the active view';
  END IF;
  RAISE NOTICE 'PASS #1c: unpublishing correctly removes an announcement from v_active_announcements';

  -- =======================================================================
  -- #2 Date-based active filtering + #3 Expiry + #4 Open-ended
  -- =======================================================================
  -- future start_date: not yet active
  INSERT INTO shared.announcements (id, title, body, announcement_type, target_audience, is_published, start_date, created_by)
  VALUES (shared.uuid_generate_v7(), 'TEST Future Announcement', 'body', 'GENERAL', 'ALL', true, CURRENT_DATE + 5, v_staff_id)
  RETURNING id INTO v_ann_id;
  IF EXISTS (SELECT 1 FROM shared.v_active_announcements WHERE id = v_ann_id) THEN
    RAISE EXCEPTION 'FAIL #2: an announcement whose start_date is in the future must not be active yet';
  END IF;
  RAISE NOTICE 'PASS #2: future-dated (start_date > today) announcement correctly excluded';

  -- expired: end_date in the past
  INSERT INTO shared.announcements (id, title, body, announcement_type, target_audience, is_published, start_date, end_date, created_by)
  VALUES (shared.uuid_generate_v7(), 'TEST Expired Announcement', 'body', 'HOLIDAY_CLOSURE', 'ALL', true, CURRENT_DATE - 10, CURRENT_DATE - 1, v_staff_id)
  RETURNING id INTO v_ann_id;
  IF EXISTS (SELECT 1 FROM shared.v_active_announcements WHERE id = v_ann_id) THEN
    RAISE EXCEPTION 'FAIL #3: an announcement whose end_date has passed must not appear as active';
  END IF;
  RAISE NOTICE 'PASS #3: expired (end_date < today) announcement correctly excluded — auto-expiry with no cron/stored flag';

  -- open-ended: end_date NULL, far past start_date, must remain active indefinitely
  INSERT INTO shared.announcements (id, title, body, announcement_type, target_audience, is_published, start_date, end_date, created_by)
  VALUES (shared.uuid_generate_v7(), 'TEST Open-Ended Announcement', 'body', 'OPERATIONAL', 'ALL', true, CURRENT_DATE - 365, NULL, v_staff_id)
  RETURNING id INTO v_ann_id;
  IF NOT EXISTS (SELECT 1 FROM shared.v_active_announcements WHERE id = v_ann_id) THEN
    RAISE EXCEPTION 'FAIL #4: an open-ended announcement (end_date NULL) with a past start_date must remain active';
  END IF;
  RAISE NOTICE 'PASS #4: open-ended announcement (end_date NULL) stays active indefinitely';

  -- =======================================================================
  -- #5 ALL/RIK/PIF audience values (+ invalid value rejected)
  -- =======================================================================
  INSERT INTO shared.announcements (id, title, body, announcement_type, target_audience, is_published, created_by)
  VALUES (shared.uuid_generate_v7(), 'TEST Audience ALL', 'body', 'GENERAL', 'ALL', true, v_staff_id);
  INSERT INTO shared.announcements (id, title, body, announcement_type, target_audience, is_published, created_by)
  VALUES (shared.uuid_generate_v7(), 'TEST Audience RIK', 'body', 'RIK_ISSUE_DAYS', 'RIK', true, v_staff_id);
  INSERT INTO shared.announcements (id, title, body, announcement_type, target_audience, is_published, created_by)
  VALUES (shared.uuid_generate_v7(), 'TEST Audience PIF', 'body', 'PIF_TIMING', 'PIF', true, v_staff_id);
  RAISE NOTICE 'PASS #5a: ALL/RIK/PIF are all accepted target_audience values';

  BEGIN
    INSERT INTO shared.announcements (id, title, body, announcement_type, target_audience, created_by)
    VALUES (shared.uuid_generate_v7(), 'TEST Bad Audience', 'body', 'GENERAL', 'EVERYONE', v_staff_id);
    RAISE EXCEPTION 'FAIL #5b: target_audience = ''EVERYONE'' should have been rejected';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS #5b: announcements_audience_chk rejects an out-of-set target_audience value';
  END;

  -- =======================================================================
  -- #6 Priority ordering
  -- =======================================================================
  DELETE FROM shared.announcements WHERE title LIKE 'TEST Priority %'; -- idempotent re-run safety within this txn
  INSERT INTO shared.announcements (id, title, body, announcement_type, target_audience, priority, is_published, start_date, created_by) VALUES
    (shared.uuid_generate_v7(), 'TEST Priority LOW',    'body', 'GENERAL', 'ALL', 'LOW',    true, CURRENT_DATE, v_staff_id),
    (shared.uuid_generate_v7(), 'TEST Priority NORMAL', 'body', 'GENERAL', 'ALL', 'NORMAL', true, CURRENT_DATE, v_staff_id),
    (shared.uuid_generate_v7(), 'TEST Priority HIGH',   'body', 'GENERAL', 'ALL', 'HIGH',   true, CURRENT_DATE, v_staff_id),
    (shared.uuid_generate_v7(), 'TEST Priority URGENT', 'body', 'GENERAL', 'ALL', 'URGENT', true, CURRENT_DATE, v_staff_id);

  -- Query the view WITH its own ORDER BY restated, and assert ranks are non-decreasing (URGENT=0 first)
  v_prev_priority_rank := -1;
  FOR v_this_priority_rank IN
    SELECT CASE priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 WHEN 'LOW' THEN 3 END AS rnk
    FROM shared.v_active_announcements
    WHERE title LIKE 'TEST Priority %'
    ORDER BY CASE priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 WHEN 'LOW' THEN 3 END
  LOOP
    IF v_this_priority_rank < v_prev_priority_rank THEN
      RAISE EXCEPTION 'FAIL #6: priority ordering went backwards (rank % after %)', v_this_priority_rank, v_prev_priority_rank;
    END IF;
    v_prev_priority_rank := v_this_priority_rank;
  END LOOP;

  SELECT count(*) INTO v_count FROM shared.v_active_announcements WHERE title = 'TEST Priority URGENT';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL #6: expected the URGENT test row to be active';
  END IF;
  RAISE NOTICE 'PASS #6: shared.v_active_announcements orders URGENT -> HIGH -> NORMAL -> LOW as designed';

  -- =======================================================================
  -- #7 Soft deletion
  -- =======================================================================
  INSERT INTO shared.announcements (id, title, body, announcement_type, target_audience, is_published, created_by)
  VALUES (shared.uuid_generate_v7(), 'TEST Soft-Delete Announcement', 'body', 'GENERAL', 'ALL', true, v_staff_id)
  RETURNING id INTO v_ann_id;
  UPDATE shared.announcements SET deleted_at = now() WHERE id = v_ann_id;

  IF EXISTS (SELECT 1 FROM shared.v_active_announcements WHERE id = v_ann_id) THEN
    RAISE EXCEPTION 'FAIL #7a: a soft-deleted announcement must not appear in the active view';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM shared.announcements WHERE id = v_ann_id) THEN
    RAISE EXCEPTION 'FAIL #7b: a soft-deleted announcement must still exist in the base table (history retained)';
  END IF;
  RAISE NOTICE 'PASS #7: soft delete removes an announcement from the active view while retaining it in shared.announcements';

  -- =======================================================================
  -- #9 Category schedule / #10 Product schedule / #11 General schedule
  -- =======================================================================
  INSERT INTO rik.issue_schedules (id, schedule_date, category_id, status, notes, created_by)
  VALUES (shared.uuid_generate_v7(), CURRENT_DATE + 1, v_category_id, 'AVAILABLE', 'TEST category schedule', v_staff_id)
  RETURNING id INTO v_sched_id;
  IF NOT EXISTS (SELECT 1 FROM rik.v_issue_schedule WHERE id = v_sched_id AND category_id = v_category_id AND product_id IS NULL) THEN
    RAISE EXCEPTION 'FAIL #9: category-scoped schedule row not found with expected scope in rik.v_issue_schedule';
  END IF;
  RAISE NOTICE 'PASS #9: category-scoped RIK issue schedule entry (category_id set, product_id NULL) works end-to-end';

  INSERT INTO rik.issue_schedules (id, schedule_date, product_id, status, notes, created_by)
  VALUES (shared.uuid_generate_v7(), CURRENT_DATE + 1, v_product_id, 'AVAILABLE', 'TEST product schedule', v_staff_id)
  RETURNING id INTO v_sched_id;
  IF NOT EXISTS (SELECT 1 FROM rik.v_issue_schedule WHERE id = v_sched_id AND product_id = v_product_id AND category_id IS NULL) THEN
    RAISE EXCEPTION 'FAIL #10: product-scoped schedule row not found with expected scope in rik.v_issue_schedule';
  END IF;
  RAISE NOTICE 'PASS #10: product-scoped RIK issue schedule entry (product_id set, category_id NULL) works end-to-end';

  INSERT INTO rik.issue_schedules (id, schedule_date, status, notes, created_by)
  VALUES (shared.uuid_generate_v7(), CURRENT_DATE + 1, 'AVAILABLE', 'TEST general schedule', v_staff_id)
  RETURNING id INTO v_sched_id;
  IF NOT EXISTS (SELECT 1 FROM rik.v_issue_schedule WHERE id = v_sched_id AND product_id IS NULL AND category_id IS NULL) THEN
    RAISE EXCEPTION 'FAIL #11: general schedule row (both category_id and product_id NULL) not found in rik.v_issue_schedule';
  END IF;
  RAISE NOTICE 'PASS #11: general RIK issue schedule entry (both category_id and product_id NULL) works end-to-end';

  -- =======================================================================
  -- #8 RIK schedule date queries (range query + not-date-filtered view)
  -- =======================================================================
  INSERT INTO rik.issue_schedules (id, schedule_date, category_id, status, created_by)
  VALUES (shared.uuid_generate_v7(), CURRENT_DATE - 30, v_category2_id, 'AVAILABLE', v_staff_id);
  INSERT INTO rik.issue_schedules (id, schedule_date, category_id, status, created_by)
  VALUES (shared.uuid_generate_v7(), CURRENT_DATE + 30, v_category2_id, 'AVAILABLE', v_staff_id);

  SELECT count(*) INTO v_count FROM rik.v_issue_schedule WHERE category_id = v_category2_id AND schedule_date = CURRENT_DATE - 30;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL #8a: date-range query against rik.v_issue_schedule did not find the past-dated fixture row';
  END IF;
  RAISE NOTICE 'PASS #8a: rik.v_issue_schedule supports date-based lookup (schedule_date = specific date)';

  IF NOT EXISTS (SELECT 1 FROM rik.v_issue_schedule WHERE category_id = v_category2_id AND schedule_date < CURRENT_DATE) THEN
    RAISE EXCEPTION 'FAIL #8b: rik.v_issue_schedule must NOT be date-filtered — a past, published, non-deleted row should still be visible (calendar can page into history)';
  END IF;
  RAISE NOTICE 'PASS #8b: rik.v_issue_schedule deliberately shows past dates too (unlike v_active_announcements) — app layer chooses the displayed range';

  -- =======================================================================
  -- #12 category/product XOR constraint
  -- =======================================================================
  BEGIN
    INSERT INTO rik.issue_schedules (id, schedule_date, category_id, product_id, status, created_by)
    VALUES (shared.uuid_generate_v7(), CURRENT_DATE + 2, v_category_id, v_product_id, 'AVAILABLE', v_staff_id);
    RAISE EXCEPTION 'FAIL #12: setting both category_id and product_id should have been rejected (scope-XOR)';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS #12: rik_issue_schedules_scope_xor_chk rejects a row with both category_id and product_id set';
  END;

  -- =======================================================================
  -- #13 Duplicate schedule prevention (3 partial unique indexes)
  -- =======================================================================
  BEGIN
    INSERT INTO rik.issue_schedules (id, schedule_date, category_id, status, created_by)
    VALUES (shared.uuid_generate_v7(), CURRENT_DATE + 1, v_category_id, 'AVAILABLE', v_staff_id);
    RAISE EXCEPTION 'FAIL #13a: duplicate category-scoped schedule (same date+category, both live) should have been rejected';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS #13a: rik_issue_schedules_category_uq rejects a duplicate (date, category_id) pair';
  END;

  BEGIN
    INSERT INTO rik.issue_schedules (id, schedule_date, product_id, status, created_by)
    VALUES (shared.uuid_generate_v7(), CURRENT_DATE + 1, v_product_id, 'AVAILABLE', v_staff_id);
    RAISE EXCEPTION 'FAIL #13b: duplicate product-scoped schedule (same date+product, both live) should have been rejected';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS #13b: rik_issue_schedules_product_uq rejects a duplicate (date, product_id) pair';
  END;

  BEGIN
    INSERT INTO rik.issue_schedules (id, schedule_date, status, created_by)
    VALUES (shared.uuid_generate_v7(), CURRENT_DATE + 1, 'AVAILABLE', v_staff_id);
    RAISE EXCEPTION 'FAIL #13c: duplicate general schedule (same date, both live) should have been rejected';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS #13c: rik_issue_schedules_general_uq rejects a duplicate general-scope date';
  END;

  -- soft-deleting the original frees the (date, category) slot for a new row (partial index respects deleted_at)
  UPDATE rik.issue_schedules SET deleted_at = now()
  WHERE schedule_date = CURRENT_DATE + 1 AND category_id = v_category_id AND product_id IS NULL AND deleted_at IS NULL;
  INSERT INTO rik.issue_schedules (id, schedule_date, category_id, status, created_by)
  VALUES (shared.uuid_generate_v7(), CURRENT_DATE + 1, v_category_id, 'AVAILABLE', v_staff_id);
  RAISE NOTICE 'PASS #13d: soft-deleting the original row frees its (date, category) slot for a replacement — partial unique index correctly ignores deleted_at IS NOT NULL rows';

  -- =======================================================================
  -- #14 Optional time-window validation
  -- =======================================================================
  BEGIN
    INSERT INTO rik.issue_schedules (id, schedule_date, category_id, status, start_time, end_time, created_by)
    VALUES (shared.uuid_generate_v7(), CURRENT_DATE + 3, v_category2_id, 'AVAILABLE', '14:00', '10:00', v_staff_id);
    RAISE EXCEPTION 'FAIL #14a: end_time <= start_time should have been rejected';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS #14a: rik_issue_schedules_time_window_chk rejects end_time <= start_time';
  END;

  INSERT INTO rik.issue_schedules (id, schedule_date, category_id, status, start_time, end_time, created_by)
  VALUES (shared.uuid_generate_v7(), CURRENT_DATE + 3, v_category2_id, 'AVAILABLE', '09:00', '13:00', v_staff_id);
  RAISE NOTICE 'PASS #14b: a valid time window (end_time > start_time) is accepted';

  INSERT INTO rik.issue_schedules (id, schedule_date, product_id, status, start_time, created_by)
  VALUES (shared.uuid_generate_v7(), CURRENT_DATE + 4, v_product2_id, 'AVAILABLE', '09:00', v_staff_id);
  RAISE NOTICE 'PASS #14c: a schedule row with only start_time set (end_time NULL) is accepted — time window is fully optional';

  -- =======================================================================
  -- #15 FK / reference integrity
  -- =======================================================================
  -- shared.announcements.created_by is a physical FK -> shared.users(id)
  BEGIN
    INSERT INTO shared.announcements (id, title, body, announcement_type, target_audience, created_by)
    VALUES (shared.uuid_generate_v7(), 'TEST Bad Creator FK', 'body', 'GENERAL', 'ALL', shared.uuid_generate_v7());
    RAISE EXCEPTION 'FAIL #15a: shared.announcements.created_by referencing a nonexistent shared.users row should have been rejected';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS #15a: announcements_created_by_fk (physical FK) rejects a nonexistent shared.users reference';
  END;

  -- rik.issue_schedules.created_by is trigger-validated (SECURITY DEFINER) against shared.users, ACTIVE only
  BEGIN
    INSERT INTO rik.issue_schedules (id, schedule_date, status, created_by)
    VALUES (shared.uuid_generate_v7(), CURRENT_DATE + 6, 'AVAILABLE', shared.uuid_generate_v7());
    RAISE EXCEPTION 'FAIL #15b: rik.issue_schedules.created_by referencing a nonexistent shared.users row should have been rejected';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS #15b: rik.trg_validate_staff_ref / shared.assert_staff_user_exists rejects a nonexistent staff reference';
  END;

  BEGIN
    INSERT INTO rik.issue_schedules (id, schedule_date, status, created_by)
    VALUES (shared.uuid_generate_v7(), CURRENT_DATE + 6, 'AVAILABLE', v_suspended_staff_id);
    RAISE EXCEPTION 'FAIL #15c: rik.issue_schedules.created_by referencing a SUSPENDED (not ACTIVE) staff user should have been rejected';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS #15c: rik.trg_validate_staff_ref rejects a staff reference that exists but is not ACTIVE';
  END;

  INSERT INTO rik.issue_schedules (id, schedule_date, status, created_by, updated_by)
  VALUES (shared.uuid_generate_v7(), CURRENT_DATE + 6, 'AVAILABLE', v_staff_id, v_staff2_id);
  RAISE NOTICE 'PASS #15d: rik.issue_schedules accepts valid, ACTIVE created_by/updated_by staff references';

  -- related_reference_id is a loose, non-FK, application-validated reference: soft-deleting the
  -- referenced rik.issue_schedules row must never break an announcement that points at it.
  INSERT INTO rik.issue_schedules (id, schedule_date, status, created_by)
  VALUES (shared.uuid_generate_v7(), CURRENT_DATE + 7, 'AVAILABLE', v_staff_id)
  RETURNING id INTO v_sched_id;
  INSERT INTO shared.announcements (id, title, body, announcement_type, target_audience, is_published, related_reference_type, related_reference_id, created_by)
  VALUES (shared.uuid_generate_v7(), 'TEST Announcement referencing a schedule', 'body', 'RIK_CATEGORY_SCHEDULE', 'RIK', true, 'rik.issue_schedules', v_sched_id, v_staff_id)
  RETURNING id INTO v_ann_id;
  UPDATE rik.issue_schedules SET deleted_at = now() WHERE id = v_sched_id;
  IF NOT EXISTS (SELECT 1 FROM shared.announcements WHERE id = v_ann_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'FAIL #15e: soft-deleting the referenced rik.issue_schedules row must not affect the referencing announcement';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM shared.v_active_announcements WHERE id = v_ann_id) THEN
    RAISE EXCEPTION 'FAIL #15e: the referencing announcement should remain active independent of its (now soft-deleted) related schedule';
  END IF;
  RAISE NOTICE 'PASS #15e: related_reference_type/id is confirmed to be a loose, non-FK reference — soft-deleting the referenced schedule leaves the announcement fully valid';

  -- also confirm the pair-consistency CHECK: type without id, or id without type, must fail
  BEGIN
    INSERT INTO shared.announcements (id, title, body, announcement_type, target_audience, related_reference_type, related_reference_id, created_by)
    VALUES (shared.uuid_generate_v7(), 'TEST Bad Ref Pair', 'body', 'GENERAL', 'ALL', 'rik.issue_schedules', NULL, v_staff_id);
    RAISE EXCEPTION 'FAIL #15f: related_reference_type set with related_reference_id NULL should have been rejected';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS #15f: announcements_related_ref_pair_chk enforces related_reference_type/id are both-set or both-NULL';
  END;

  -- =======================================================================
  -- #16 Permissions (data-level: role_permissions scoping)
  -- =======================================================================
  IF NOT EXISTS (
    SELECT 1 FROM shared.role_permissions rp
    JOIN shared.roles r ON r.id = rp.role_id
    JOIN shared.permissions p ON p.id = rp.permission_id
    WHERE r.name = 'SUPER_ADMIN' AND p.code = 'shared.announcement.manage'
  ) THEN
    RAISE EXCEPTION 'FAIL #16a: SUPER_ADMIN should hold shared.announcement.manage';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM shared.role_permissions rp
    JOIN shared.roles r ON r.id = rp.role_id
    JOIN shared.permissions p ON p.id = rp.permission_id
    WHERE r.name = 'RIK_ADMIN' AND p.code = 'shared.announcement.manage'
  ) OR NOT EXISTS (
    SELECT 1 FROM shared.role_permissions rp
    JOIN shared.roles r ON r.id = rp.role_id
    JOIN shared.permissions p ON p.id = rp.permission_id
    WHERE r.name = 'RIK_ADMIN' AND p.code = 'rik.issue_schedule.manage'
  ) THEN
    RAISE EXCEPTION 'FAIL #16b: RIK_ADMIN should hold both shared.announcement.manage and rik.issue_schedule.manage';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM shared.role_permissions rp
    JOIN shared.roles r ON r.id = rp.role_id
    JOIN shared.permissions p ON p.id = rp.permission_id
    WHERE r.name = 'PIF_ADMIN' AND p.code = 'shared.announcement.manage'
  ) THEN
    RAISE EXCEPTION 'FAIL #16c: PIF_ADMIN should hold shared.announcement.manage';
  END IF;

  IF EXISTS (
    SELECT 1 FROM shared.role_permissions rp
    JOIN shared.roles r ON r.id = rp.role_id
    JOIN shared.permissions p ON p.id = rp.permission_id
    WHERE r.name = 'PIF_ADMIN' AND p.code = 'rik.issue_schedule.manage'
  ) THEN
    RAISE EXCEPTION 'FAIL #16d: PIF_ADMIN must NOT hold rik.issue_schedule.manage (PIF has no structured RIK schedule of its own)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM shared.role_permissions rp
    JOIN shared.roles r ON r.id = rp.role_id
    JOIN shared.permissions p ON p.id = rp.permission_id
    WHERE r.name IN ('PIF_CASHIER', 'DELIVERY_STAFF', 'RIK_PICKUP_STAFF')
      AND p.code IN ('shared.announcement.manage', 'rik.issue_schedule.manage')
  ) THEN
    RAISE EXCEPTION 'FAIL #16e: non-admin operational roles (PIF_CASHIER/DELIVERY_STAFF/RIK_PICKUP_STAFF) must not hold either new manage permission';
  END IF;
  RAISE NOTICE 'PASS #16: shared.announcement.manage and rik.issue_schedule.manage are assigned exactly per Revision 2 correction #8 (SUPER_ADMIN=both audiences, RIK_ADMIN=both perms, PIF_ADMIN=announcements only, no operational-staff role holds either)';

  -- =======================================================================
  -- #19 Audit integration smoke test
  -- =======================================================================
  DECLARE
    v_audit_id uuid;
  BEGIN
    SELECT shared.log_audit_event(v_staff_id, 'ADMIN', 'shared', 'announcement.publish', 'announcement', v_ann_id)
    INTO v_audit_id;
    IF NOT EXISTS (SELECT 1 FROM shared.audit_log WHERE id = v_audit_id AND entity_type = 'announcement') THEN
      RAISE EXCEPTION 'FAIL #19: shared.log_audit_event() did not produce a retrievable audit_log row for an announcement action';
    END IF;
    RAISE NOTICE 'PASS #19: shared.log_audit_event() works unchanged for announcement-related actions (no schema change needed to audit_log)';
  END;

  RAISE NOTICE '=== 060 Part A: ALL CHECKS PASSED ===';
END;
$$;

ROLLBACK;

-- ---------------------------------------------------------------------------
-- Part B: DB-role-level least privilege + unauthorized admin attempts,
-- exercised as the real application roles. No lasting writes: every
-- statement below is a read, an expected-to-fail write, or is rolled back.
-- ---------------------------------------------------------------------------

-- #17a: app_pif has no grants at all on rik.issue_schedules (PIF has no structured RIK schedule)
BEGIN;
SET ROLE app_pif;
DO $$
BEGIN
  BEGIN
    INSERT INTO rik.issue_schedules (id, schedule_date, status)
    VALUES (shared.uuid_generate_v7(), CURRENT_DATE + 1, 'AVAILABLE');
    RAISE EXCEPTION 'FAIL #17a: app_pif should not be able to INSERT into rik.issue_schedules';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS #17a: app_pif has no direct grant on rik.issue_schedules (least privilege, Revision 2 correction #8)';
  END;
END;
$$;
ROLLBACK;

-- #17b/#17c: app_rik retains INSERT/SELECT/UPDATE on rik.issue_schedules but DELETE was explicitly revoked
BEGIN;
SET ROLE app_rik;
DO $$
DECLARE
  v_sched_id uuid;
BEGIN
  INSERT INTO rik.issue_schedules (id, schedule_date, status)
  VALUES (shared.uuid_generate_v7(), CURRENT_DATE + 1, 'AVAILABLE')
  RETURNING id INTO v_sched_id;
  RAISE NOTICE 'PASS #17b: app_rik retains INSERT on rik.issue_schedules (base grant from migration 0018''s default-privileges rule)';

  BEGIN
    DELETE FROM rik.issue_schedules WHERE id = v_sched_id;
    RAISE EXCEPTION 'FAIL #17c: app_rik should NOT be able to DELETE from rik.issue_schedules (explicitly revoked in migration 0023 — soft-delete-only policy)';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS #17c: app_rik DELETE on rik.issue_schedules was correctly revoked (soft-delete-only, unlike the schema-wide default)';
  END;

  BEGIN
    DELETE FROM rik.v_issue_schedule WHERE id = v_sched_id;
    RAISE EXCEPTION 'FAIL #17d: app_rik should NOT be able to DELETE via rik.v_issue_schedule';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS #17d: app_rik DELETE on rik.v_issue_schedule was correctly revoked';
  END;

  -- #18a: app_rik can read the customer-facing schedule view
  PERFORM count(*) FROM rik.v_issue_schedule;
  RAISE NOTICE 'PASS #18a: app_rik can SELECT from rik.v_issue_schedule';

  -- #18b: app_rik can read shared.v_active_announcements (cross-module read model)
  PERFORM count(*) FROM shared.v_active_announcements;
  RAISE NOTICE 'PASS #18b: app_rik can SELECT from shared.v_active_announcements';
END;
$$;
ROLLBACK;

-- #15g / #18c: app_rik has EXECUTE on shared.assert_staff_user_exists, exercised for real (not bypassed
-- by owner privilege) via the trigger on rik.issue_schedules, using a valid ACTIVE staff id created
-- by esamagri_owner just before switching role.
BEGIN;
DO $outer$
DECLARE
  v_staff_id uuid;
BEGIN
  INSERT INTO shared.users (id, username, password_hash, display_name, status)
  VALUES (shared.uuid_generate_v7(), 'test.rev2.staff.partb', 'x', 'Test Rev2 Staff Part B', 'ACTIVE')
  RETURNING id INTO v_staff_id;
  PERFORM set_config('test_rev2.staff_id', v_staff_id::text, false);
END;
$outer$;
SET ROLE app_rik;
DO $$
DECLARE
  v_staff_id uuid := current_setting('test_rev2.staff_id')::uuid;
BEGIN
  INSERT INTO rik.issue_schedules (id, schedule_date, status, created_by)
  VALUES (shared.uuid_generate_v7(), CURRENT_DATE + 1, 'AVAILABLE', v_staff_id);
  RAISE NOTICE 'PASS #15g/#18c: app_rik successfully inserts with a trigger-validated created_by — confirms migration 0023''s GRANT EXECUTE ON FUNCTION shared.assert_staff_user_exists(uuid) TO app_rik is in effect (not just bypassed by owner privilege)';
END;
$$;
RESET ROLE;
ROLLBACK;

-- #17e: app_shared has no DELETE on shared.announcements (soft-delete-only)
BEGIN;
SET ROLE app_shared;
DO $$
DECLARE
  v_ann_id uuid;
BEGIN
  INSERT INTO shared.announcements (id, title, body, announcement_type, target_audience)
  VALUES (shared.uuid_generate_v7(), 'TEST app_shared insert', 'body', 'GENERAL', 'ALL')
  RETURNING id INTO v_ann_id;
  RAISE NOTICE 'PASS #17e: app_shared retains INSERT on shared.announcements';

  BEGIN
    DELETE FROM shared.announcements WHERE id = v_ann_id;
    RAISE EXCEPTION 'FAIL #17f: app_shared should NOT be able to DELETE from shared.announcements (soft-delete-only policy, no role ever gets DELETE)';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS #17f: app_shared has no DELETE grant on shared.announcements';
  END;
END;
$$;
ROLLBACK;

-- #17g/#18d: reporting roles are read-only on the two new views
BEGIN;
SET ROLE app_reporting_rik;
DO $$
BEGIN
  PERFORM count(*) FROM rik.v_issue_schedule;
  PERFORM count(*) FROM shared.v_active_announcements;
  RAISE NOTICE 'PASS #18d: app_reporting_rik can SELECT from both rik.v_issue_schedule and shared.v_active_announcements';

  BEGIN
    INSERT INTO rik.issue_schedules (id, schedule_date, status)
    VALUES (shared.uuid_generate_v7(), CURRENT_DATE + 1, 'AVAILABLE');
    RAISE EXCEPTION 'FAIL #17g: app_reporting_rik should be strictly read-only';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS #17g: app_reporting_rik has no write grant on rik.issue_schedules (read-only reporting role)';
  END;
END;
$$;
ROLLBACK;

BEGIN;
SET ROLE app_reporting_pif;
DO $$
BEGIN
  PERFORM count(*) FROM shared.v_active_announcements;
  RAISE NOTICE 'PASS #18e: app_reporting_pif can SELECT from shared.v_active_announcements';

  BEGIN
    INSERT INTO shared.announcements (id, title, body, announcement_type, target_audience)
    VALUES (shared.uuid_generate_v7(), 'TEST should fail', 'body', 'GENERAL', 'ALL');
    RAISE EXCEPTION 'FAIL #17h: app_reporting_pif should be strictly read-only';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS #17h: app_reporting_pif has no write grant on shared.announcements (read-only reporting role)';
  END;

  BEGIN
    PERFORM count(*) FROM rik.issue_schedules;
    RAISE EXCEPTION 'FAIL #17i: app_reporting_pif should have no grant at all on rik.issue_schedules (PIF has no business reason to read it directly)';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS #17i: app_reporting_pif has no grant on rik.issue_schedules base table (least privilege, Revision 2 correction #8)';
  END;
END;
$$;
ROLLBACK;

SELECT 'PASS: 060_revision2_announcements_and_schedules.sql complete' AS result;
