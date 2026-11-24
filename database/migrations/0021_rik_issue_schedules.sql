-- =============================================================================
-- Migration 0021: rik.issue_schedules + rik.trg_validate_staff_ref()
-- Phase 2 Revision 2 (structured RIK issue calendar), approved with
-- corrections.
--
-- created_by/updated_by are trigger-validated against shared.users via the
-- existing SECURITY DEFINER mechanism (shared.assert_staff_user_exists),
-- per your Revision 2 correction #2: retain the approved cross-schema
-- DB-enforced validation pattern from Phase 2 Revision 1 for this
-- rik -> shared reference, rather than leaving it an unvalidated
-- attribution column. rik.trg_validate_staff_ref() is new — migration
-- 0018 already anticipated this ("grant to app_rik too if a future RIK
-- table adds a staff-reference trigger"); this is that table.
-- =============================================================================

SET ROLE esamagri_owner;

CREATE TABLE rik.issue_schedules (
  id              uuid        NOT NULL DEFAULT shared.uuid_generate_v7(),
  schedule_date   date        NOT NULL,
  category_id     uuid,
  product_id      uuid,
  status          text        NOT NULL DEFAULT 'SCHEDULED',
  start_time      time,
  end_time        time,
  notes           text,
  is_published    boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  updated_by      uuid,
  deleted_at      timestamptz,
  CONSTRAINT rik_issue_schedules_pk PRIMARY KEY (id),
  CONSTRAINT rik_issue_schedules_category_fk FOREIGN KEY (category_id) REFERENCES rik.categories (id),
  CONSTRAINT rik_issue_schedules_product_fk FOREIGN KEY (product_id) REFERENCES rik.products (id),
  CONSTRAINT rik_issue_schedules_scope_xor_chk CHECK (product_id IS NULL OR category_id IS NULL),
  CONSTRAINT rik_issue_schedules_status_chk CHECK (status IN ('SCHEDULED','AVAILABLE','LIMITED','UNAVAILABLE','CANCELLED')),
  CONSTRAINT rik_issue_schedules_time_window_chk CHECK (end_time IS NULL OR start_time IS NULL OR end_time > start_time)
);

CREATE INDEX rik_issue_schedules_date_idx ON rik.issue_schedules (schedule_date);
CREATE INDEX rik_issue_schedules_category_idx ON rik.issue_schedules (category_id);
CREATE INDEX rik_issue_schedules_product_idx ON rik.issue_schedules (product_id);

CREATE UNIQUE INDEX rik_issue_schedules_category_uq ON rik.issue_schedules (schedule_date, category_id)
  WHERE category_id IS NOT NULL AND product_id IS NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX rik_issue_schedules_product_uq ON rik.issue_schedules (schedule_date, product_id)
  WHERE product_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX rik_issue_schedules_general_uq ON rik.issue_schedules (schedule_date)
  WHERE category_id IS NULL AND product_id IS NULL AND deleted_at IS NULL;

COMMENT ON TABLE rik.issue_schedules IS 'Phase 2 Revision 2 — structured, machine-readable RIK ration issue calendar. Both category_id and product_id NULL means a general entry for that date (e.g. "RIK counter open, all categories"). Never both set (scope-XOR).';
COMMENT ON COLUMN rik.issue_schedules.deleted_at IS 'Soft delete. shared.announcements.related_reference_id may loosely point at a row here (non-FK) — soft-deleting a schedule row never breaks an announcement that referenced it (Revision 2 correction #7).';

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rik.trg_validate_staff_ref()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM shared.assert_staff_user_exists(NEW.created_by);
  PERFORM shared.assert_staff_user_exists(NEW.updated_by);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION rik.trg_validate_staff_ref() IS
  'Thin wrapper calling shared.assert_staff_user_exists() against NEW.created_by and NEW.updated_by. First use in the rik schema (pif has had the equivalent per-column triggers since Phase 3A) — added for rik.issue_schedules per Revision 2 correction #2, which asks that this table''s attribution columns be trigger-validated rather than left as the plain unvalidated created_by convention used elsewhere. shared.assert_staff_user_exists() no-ops on NULL, so a row with only one of the two columns set validates only the one that is set.';

CREATE TRIGGER validate_staff_ref
  BEFORE INSERT OR UPDATE OF created_by, updated_by ON rik.issue_schedules
  FOR EACH ROW EXECUTE FUNCTION rik.trg_validate_staff_ref();

RESET ROLE;
